// [INPUT]: Explicit local vault/attachment grants, saved website URLs and the host browser adapter.
// [OUTPUT]: Revisioned local website preferences and an isolated read-only reader service.
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
    pub sites: Vec<Site>,
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
    pub sites: Option<Vec<Site>>,
}
#[derive(Default)]
pub struct ReaderEndpoint {
    pub port: u16,
    pub token: String,
}
pub struct Library {
    pub preferences: Mutex<Preferences>,
    pub index: Mutex<crate::reader::Index>,
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
        let preferences = std::fs::read(&path)
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        Arc::new(Self {
            preferences: Mutex::new(preferences),
            index: Mutex::new(Default::default()),
            endpoint: Mutex::new(Default::default()),
            path,
        })
    }
    pub fn enabled(&self) -> bool {
        self.preferences.lock().unwrap().enabled
    }
    pub fn snapshot(&self) -> Value {
        let p = self.preferences.lock().unwrap();
        json!({"revision":p.revision,"enabled":p.enabled,"vault":p.vault,"attachments":p.attachments,"sites":p.sites,"vaults":known_vaults()})
    }
    pub fn view(&self) -> Value {
        let p = self.preferences.lock().unwrap();
        json!({"enabled":p.enabled,"configured":p.vault.is_some(),"sites":p.sites})
    }
    pub fn save(&self, patch: Update) -> Result<Value> {
        let mut p = self.preferences.lock().unwrap();
        ensure!(
            p.revision == patch.expected_revision,
            "网站设置已在其他窗口更新，请刷新后重试"
        );
        let mut next = p.clone();
        if let Some(enabled) = patch.enabled {
            next.enabled = enabled;
        }
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
        let roots_changed = next.vault != p.vault || next.attachments != p.attachments;
        *p = next;
        let result = serde_json::to_value(&*p)?;
        // Grant snapshots and their credential change together under the preference lock.
        if roots_changed {
            self.endpoint.lock().unwrap().token = uuid::Uuid::new_v4().simple().to_string();
        }
        drop(p);
        if roots_changed {
            *self.index.lock().unwrap() = Default::default();
        }
        Ok(result)
    }
    pub fn destination(&self, id: &str) -> Result<String> {
        let p = self.preferences.lock().unwrap();
        if id == "obsidian" {
            ensure!(p.vault.is_some(), "请先在网站设置中选择 Obsidian 笔记库");
            let endpoint = self.endpoint.lock().unwrap();
            ensure!(endpoint.port != 0, "本地阅读器尚未就绪");
            return Ok(format!(
                "http://127.0.0.1:{}/#reader={}",
                endpoint.port, endpoint.token
            ));
        }
        let site = p
            .sites
            .iter()
            .find(|s| s.id == id)
            .context("网站已被移除，请刷新后重试")?;
        website_url(&site.url)
    }
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
