// [INPUT]: Explicit local vault/attachment grants, saved website URLs and the host browser adapter.
// [OUTPUT]: Revisioned folders/sites and a loopback reader with independent folder credentials and indexes.
// [POS]: Business state for the optional sites feature; never writes to a vault or sends note text to a model.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::{
    config::{Paths, write_private},
    state::App,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub revision: u64,
    pub enabled: bool,
    pub vault: Option<PathBuf>,
    pub attachments: Vec<PathBuf>,
    pub folders: Vec<Folder>,
    pub sites: Vec<Site>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub attachments: Vec<PathBuf>,
}
impl Folder {
    pub(crate) fn same_grants(&self, other: &Self) -> bool {
        self.id == other.id && self.path == other.path && self.attachments == other.attachments
    }
    pub fn summary(&self) -> Value {
        json!({"id":self.id,"name":self.name})
    }
}
impl Preferences {
    fn migrate_folders(&mut self) {
        if self.folders.is_empty()
            && let Some(path) = &self.vault
        {
            self.folders.push(Folder {
                id: "obsidian".into(),
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                path: path.clone(),
                attachments: self.attachments.clone(),
            });
        }
    }
    fn sync_legacy(&mut self) {
        self.vault = self.folders.first().map(|folder| folder.path.clone());
        self.attachments = self
            .folders
            .first()
            .map(|folder| folder.attachments.clone())
            .unwrap_or_default();
    }
    pub fn folder(&self, id: &str) -> Result<Folder> {
        (if id.is_empty() {
            self.folders.first()
        } else {
            self.folders.iter().find(|folder| folder.id == id)
        })
        .cloned()
        .context("笔记文件夹已移除，请从 Palboo 重新打开")
    }
    pub fn scoped(&self, folder: &Folder) -> Self {
        let mut selected = self.clone();
        selected.vault = Some(folder.path.clone());
        selected.attachments = folder.attachments.clone();
        selected
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: String,
    pub name: String,
    pub url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub expected_revision: u64,
    pub enabled: Option<bool>,
    pub vault: Option<String>,
    pub attachments: Option<Vec<PathBuf>>,
    pub folders: Option<Vec<Folder>>,
    pub sites: Option<Vec<Site>>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ReaderEndpoint {
    pub port: u16,
    pub token: String,
    pub(crate) grants: Vec<ReaderGrant>,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct ReaderGrant {
    folder: Folder,
    token: String,
}
impl ReaderEndpoint {
    pub fn credential<'a>(&'a self, preferences: &Preferences, folder: &Folder) -> Option<&'a str> {
        if preferences
            .folders
            .first()
            .is_some_and(|first| first.same_grants(folder))
        {
            return (!self.token.is_empty()).then_some(self.token.as_str());
        }
        self.grants
            .iter()
            .find(|grant| grant.folder.same_grants(folder))
            .map(|grant| grant.token.as_str())
    }
    pub fn reconcile(&mut self, previous: &Preferences, next: &Preferences) {
        let grants: Vec<_> = next
            .folders
            .iter()
            .map(|folder| {
                let token = previous
                    .folders
                    .iter()
                    .find(|old| old.same_grants(folder))
                    .and_then(|old| self.credential(previous, old))
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
                ReaderGrant {
                    folder: folder.clone(),
                    token,
                }
            })
            .collect();
        self.token = grants
            .first()
            .map(|grant| grant.token.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
        self.grants = grants;
    }
}
#[derive(Serialize, Deserialize)]
struct SavedReaderEndpoint {
    revision: u64,
    vault: Option<PathBuf>,
    attachments: Vec<PathBuf>,
    #[serde(default)]
    folders: Vec<Folder>,
    endpoint: ReaderEndpoint,
}
pub struct Library {
    pub preferences: Mutex<Preferences>,
    pub indexes: Mutex<HashMap<String, crate::reader::Index>>,
    pub endpoint: Mutex<ReaderEndpoint>,
    path: PathBuf,
}
pub fn website_url(raw: &str) -> Result<String> {
    ensure!(
        raw.len() <= 8192 && !raw.chars().any(char::is_control),
        "网站地址无效"
    );
    let url = reqwest::Url::parse(raw.trim()).context("请输入完整的 HTTP 或 HTTPS 地址")?;
    ensure!(
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none(),
        "网站仅支持无用户名和密码的 HTTP 或 HTTPS 地址"
    );
    Ok(url.into())
}
fn directory(path: &std::path::Path) -> Result<PathBuf> {
    ensure!(path.is_absolute(), "请选择绝对目录路径");
    let path = path.canonicalize().context("目录不存在或无法读取")?;
    ensure!(
        path.is_dir() && path.parent().is_some(),
        "请选择具体的笔记或附件目录"
    );
    Ok(path)
}
impl Library {
    pub fn load(paths: &Paths) -> Arc<Self> {
        let path = paths
            .root
            .canonicalize()
            .unwrap_or_else(|_| paths.root.clone())
            .join("web-library.json");
        let mut preferences: Preferences = std::fs::read(&path)
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        preferences.migrate_folders();
        let endpoint = std::fs::read(path.with_file_name("reader-runtime.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SavedReaderEndpoint>(&bytes).ok())
            .filter(|saved| {
                saved.revision == preferences.revision
                    && saved.vault == preferences.vault
                    && saved.attachments == preferences.attachments
                    && (saved.folders == preferences.folders
                        || saved.folders.is_empty() && preferences.folders.len() <= 1)
                    && saved.endpoint.port > 0
                    && saved.endpoint.token.len() == 32
            })
            .map(|saved| saved.endpoint)
            .unwrap_or_default();
        Arc::new(Self {
            preferences: Mutex::new(preferences),
            indexes: Mutex::new(Default::default()),
            endpoint: Mutex::new(endpoint),
            path,
        })
    }
    pub(crate) fn persist_endpoint(
        &self,
        p: &Preferences,
        endpoint: &ReaderEndpoint,
    ) -> Result<()> {
        write_private(
            &self.path.with_file_name("reader-runtime.json"),
            &serde_json::to_vec(
                &json!({"revision":p.revision,"vault":p.vault,"attachments":p.attachments,"folders":p.folders,"endpoint":endpoint}),
            )?,
        )
    }
    pub fn enabled(&self) -> bool {
        self.preferences.lock().unwrap().enabled
    }
    pub fn snapshot(&self) -> Value {
        let p = self.preferences.lock().unwrap();
        json!({"revision":p.revision,"enabled":p.enabled,"vault":p.vault,"attachments":p.attachments,"folders":p.folders,"sites":p.sites,"vaults":known_vaults()})
    }
    pub fn view(&self) -> Value {
        let p = self.preferences.lock().unwrap();
        json!({"enabled":p.enabled,"configured":!p.folders.is_empty(),"folders":p.folders.iter().map(Folder::summary).collect::<Vec<_>>(),"sites":p.sites})
    }
    pub fn save(&self, patch: Update) -> Result<Value> {
        let mut p = self.preferences.lock().unwrap();
        ensure!(
            p.revision == patch.expected_revision,
            "网站设置已在其他窗口更新，请刷新后重试"
        );
        let mut next = p.clone();
        ensure!(
            patch.folders.is_none() || patch.vault.is_none() && patch.attachments.is_none(),
            "请分别保存笔记文件夹和旧版目录设置"
        );
        if let Some(enabled) = patch.enabled {
            next.enabled = enabled;
        }
        let legacy_roots = patch.vault.is_some() || patch.attachments.is_some();
        if let Some(vault) = patch.vault {
            next.vault = if vault.trim().is_empty() {
                None
            } else {
                Some(directory(std::path::Path::new(vault.trim()))?)
            };
        }
        if let Some(attachments) = patch.attachments {
            ensure!(attachments.len() <= 16, "最多授权 16 个附件目录");
            next.attachments = attachments
                .iter()
                .map(|p| directory(p))
                .collect::<Result<_>>()?;
            next.attachments.sort();
            next.attachments.dedup();
        }
        if legacy_roots {
            if let Some(path) = &next.vault {
                if let Some(first) = next.folders.first_mut() {
                    if first.path != *path {
                        first.name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into();
                    }
                    first.path = path.clone();
                    first.attachments = next.attachments.clone();
                } else {
                    next.migrate_folders();
                }
            } else if !next.folders.is_empty() {
                next.folders.remove(0);
            }
        }
        if let Some(folders) = patch.folders {
            next.folders = folders;
        }
        ensure!(next.folders.len() <= 16, "最多添加 16 个笔记文件夹");
        let mut folder_ids = std::collections::HashSet::new();
        let mut folder_paths = std::collections::HashSet::new();
        for folder in &mut next.folders {
            let unchanged_grant = p.folders.iter().any(|old| old.same_grants(folder));
            ensure!(
                !folder.id.is_empty()
                    && folder.id.len() <= 80
                    && folder
                        .id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-')
                    && folder_ids.insert(folder.id.clone()),
                "文件夹标识无效或重复"
            );
            if !unchanged_grant {
                folder.path = directory(&folder.path)?;
            }
            ensure!(
                folder_paths.insert(folder.path.clone()),
                "这个笔记文件夹已经添加"
            );
            folder.name = folder.name.trim().to_owned();
            ensure!(
                !folder.name.is_empty() && folder.name.chars().count() <= 120,
                "文件夹名称不能为空或过长"
            );
            ensure!(folder.attachments.len() <= 16, "最多授权 16 个附件目录");
            if !unchanged_grant {
                folder.attachments = folder
                    .attachments
                    .iter()
                    .map(|path| directory(path))
                    .collect::<Result<_>>()?;
            }
            folder.attachments.sort();
            folder.attachments.dedup();
            ensure!(
                !self.path.starts_with(&folder.path)
                    && folder
                        .attachments
                        .iter()
                        .all(|path| !self.path.starts_with(path)),
                "Palboo 数据目录不能位于笔记或附件目录内"
            );
        }
        next.sync_legacy();
        if let Some(mut sites) = patch.sites {
            ensure!(sites.len() <= 200, "最多保存 200 个网站");
            let mut ids = std::collections::HashSet::new();
            for site in &mut sites {
                ensure!(
                    !site.id.is_empty()
                        && site.id != "obsidian"
                        && site.id.len() <= 80
                        && site
                            .id
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-')
                        && ids.insert(site.id.clone()),
                    "网站标识无效或重复"
                );
                site.name = site.name.trim().to_owned();
                ensure!(
                    !site.name.is_empty() && site.name.chars().count() <= 120,
                    "网站名称不能为空或过长"
                );
                site.url = website_url(&site.url)?;
            }
            next.sites = sites;
        }
        // Data owned by Palboo must stay outside every authorized source root.
        if let Some(vault) = &next.vault {
            ensure!(
                !self.path.starts_with(vault),
                "Palboo 数据目录不能位于笔记库内"
            );
        }
        ensure!(
            next.attachments.iter().all(|p| !self.path.starts_with(p)),
            "Palboo 数据目录不能位于附件目录内"
        );
        next.revision += 1;
        write_private(&self.path, &serde_json::to_vec_pretty(&next)?)?;
        let changed_ids: Vec<_> = p
            .folders
            .iter()
            .filter(|old| !next.folders.iter().any(|folder| old.same_grants(folder)))
            .map(|folder| folder.id.clone())
            .collect();
        {
            let mut endpoint = self.endpoint.lock().unwrap();
            endpoint.reconcile(&p, &next);
        }
        *p = next;
        let result = serde_json::to_value(&*p)?;
        let _ = self.persist_endpoint(&p, &self.endpoint.lock().unwrap());
        drop(p);
        if !changed_ids.is_empty() {
            let mut indexes = self.indexes.lock().unwrap();
            for id in changed_ids {
                indexes.remove(&id);
            }
        }
        Ok(result)
    }
    pub fn destination(&self, id: &str) -> Result<String> {
        let p = self.preferences.lock().unwrap();
        if id == "obsidian" || id.starts_with("folder:") {
            let endpoint = self.endpoint.lock().unwrap();
            return reader_destination(
                &p,
                &endpoint,
                id.strip_prefix("folder:").unwrap_or_default(),
            );
        }
        let site = p
            .sites
            .iter()
            .find(|s| s.id == id)
            .context("网站已被移除，请刷新后重试")?;
        website_url(&site.url)
    }
    pub fn switch_folder(&self, source: &Folder, token: &str, target: &str) -> Result<String> {
        let p = self.preferences.lock().unwrap();
        let current = p.folder(&source.id)?;
        let endpoint = self.endpoint.lock().unwrap();
        ensure!(
            current.same_grants(source) && endpoint.credential(&p, &current) == Some(token),
            "授权目录已更新，请重新打开阅读器"
        );
        reader_destination(&p, &endpoint, target)
    }
}
fn reader_destination(p: &Preferences, endpoint: &ReaderEndpoint, id: &str) -> Result<String> {
    let folder = p.folder(id)?;
    ensure!(endpoint.port != 0, "本地阅读器尚未就绪");
    let token = endpoint
        .credential(p, &folder)
        .context("本地阅读器尚未就绪")?;
    Ok(format!(
        "http://127.0.0.1:{}/?folder={}#reader={}",
        endpoint.port, folder.id, token
    ))
}

fn known_vaults() -> Vec<String> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let path = home.join("Library/Application Support/obsidian/obsidian.json");
    let value = std::fs::read(path)
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        .unwrap_or(Value::Null);
    let mut paths: Vec<_> = value["vaults"]
        .as_object()
        .into_iter()
        .flat_map(|v| v.values())
        .filter_map(|v| v["path"].as_str())
        .filter(|p| std::path::Path::new(p).is_dir())
        .map(str::to_owned)
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

// The native picker only returns a draft path. Saving the grant remains a separate action.
pub async fn choose_directory(paths: &Paths) -> Result<Value> {
    static PICKER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let guard = PICKER.try_lock().context("文件夹选择窗口已经打开")?;
    let paths = paths.clone();
    let path = tokio::task::spawn_blocking(move || {
        let _guard = guard;
        crate::directory_picker::choose(&paths)
    })
    .await??;
    let path = path.map(|path| directory(&path)).transpose()?;
    Ok(json!({"path":path}))
}

impl App {
    pub(crate) async fn save_web_library(&self, patch: Update) -> Result<Value> {
        let before = self.web_library.enabled();
        let mut value = self.web_library.save(patch)?;
        let enabled = self.web_library.enabled();
        let settings = self.settings().await;
        self.sync_desktop_settings(&settings).await;
        if before != enabled
            && let Err(error) = self.set_feature_enabled("sites", enabled).await
        {
            value["presentationError"] = json!(format!("网站设置已保存，窗口更新失败：{error}"));
        }
        Ok(value)
    }
    pub(crate) async fn open_website(&self, id: &str) -> Result<Value> {
        let url = self.web_library.destination(id)?;
        let client = self
            .desktop_client()
            .await
            .context("ChatGPT 尚未连接，无法在应用内打开网页")?;
        client.request("Page.bringToFront", json!({})).await?;
        let result = client.evaluate_with_timeout(format!(
            "window.__companionFloatingPanel?.openWebsite?.({}) ?? {{ok:false,message:'网站入口尚未就绪，请稍后重试'}}", serde_json::to_string(&url)?
        ), Duration::from_secs(15)).await?;
        ensure!(
            result["ok"] == true,
            "{}",
            result["message"]
                .as_str()
                .unwrap_or("未能在 ChatGPT 内打开网页，请重试")
        );
        Ok(result)
    }
}
