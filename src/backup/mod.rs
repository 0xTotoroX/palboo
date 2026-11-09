// [INPUT]: Authenticated local requests, explicit archives/targets and service lifecycle.
// [OUTPUT]: Export, guarded preview/apply, Release/Dev copy and local undo; no cloud traffic.
// [POS]: One transfer coordinator shared by settings and CLI. Live restore reloads only Palboo.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
mod archive;
pub mod cli;
pub(crate) mod reader_preferences;
mod snapshot;
mod storage;
mod targets;
#[cfg(test)]
mod tests;
mod validate;
use crate::config::Paths;
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{Mutex, Notify};
pub const HTTP_LIMIT: usize = archive::LIMIT * 4 / 3 + 65536;
type FileChanges = BTreeMap<String, Option<Vec<u8>>>;
struct Plan {
    id: String,
    target: targets::Target,
    files: FileChanges,
    baseline: BTreeMap<String, String>,
    expires: u64,
    remote: Option<(crate::lifecycle::Runtime, String)>,
}
#[derive(Default)]
struct Inner {
    preview: Option<Plan>,
    pending: Option<Plan>,
    last: Option<Value>,
    remote_wait: Option<(crate::lifecycle::Runtime, String, String)>,
}
#[derive(Default)]
pub struct Coordinator {
    inner: Mutex<Inner>,
    pub restart: Notify,
    pub pending: AtomicBool,
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn recover(paths: &Paths) -> Result<()> {
    storage::recover(paths)
}
fn baseline(paths: &Paths, files: &FileChanges) -> Result<BTreeMap<String, String>> {
    files
        .keys()
        .map(|name| {
            Ok((
                name.clone(),
                storage::file_fingerprint(name, snapshot::read(&paths.root, name)?.as_deref())?,
            ))
        })
        .collect()
}
fn check(plan: &Plan) -> Result<Paths> {
    ensure!(plan.expires >= now(), "预览已过期，请重新预览");
    let paths = Paths::new(Some(plan.target.path.clone()))?;
    ensure!(
        baseline(&paths, &plan.files)? == plan.baseline,
        "目标配置在预览后已变化，请重新预览"
    );
    Ok(paths)
}
fn plan(target: targets::Target, files: FileChanges) -> Result<(Plan, Value)> {
    let paths = Paths::new(Some(target.path.clone()))?;
    let baseline = baseline(&paths, &files)?;
    let mut changes = Vec::new();
    for (name, after) in &files {
        let before = snapshot::read(&paths.root, name)?;
        if before == *after {
            continue;
        }
        let mut fields = Vec::new();
        if name != "secrets.json" && snapshot::FILES.contains(&name.as_str()) {
            let a = before
                .as_deref()
                .map(serde_json::from_slice)
                .transpose()?
                .unwrap_or(Value::Null);
            let b = after
                .as_deref()
                .map(serde_json::from_slice)
                .transpose()?
                .unwrap_or(Value::Null);
            snapshot::difference(&a, &b, "", &mut fields);
        }
        changes.push(json!({"file":name,"fields":fields,"secret":name=="secrets.json","removed":after.is_none()}));
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let summary =
        json!({"previewId":id,"target":target,"changes":changes,"restart":target.current});
    Ok((
        Plan {
            id,
            target,
            files,
            baseline,
            expires: now() + 600,
            remote: None,
        },
        summary,
    ))
}
impl Coordinator {
    pub async fn request(self: &Arc<Self>, paths: Paths, input: Value) -> Result<Value> {
        let mut inner = self.inner.lock().await;
        ensure!(
            !self.pending.load(Ordering::SeqCst),
            "正在恢复配置，请等待本地服务重新就绪"
        );
        let op = input["op"].as_str().unwrap_or("status").to_owned();
        if op == "status" {
            if let Some((runtime, remote_id, local_id)) = inner.remote_wait.clone()
                && let Ok(state) = relay(&runtime, json!({"op":"status"})).await
                && state["last"]["previewId"] == remote_id
            {
                let mut last = state["last"].clone();
                last["previewId"] = local_id.into();
                inner.last = Some(last);
                inner.remote_wait = None;
            }
            return Ok(
                json!({"targets":targets::list(&paths)?,"sections":archive::SECTIONS.iter().map(|(id,label)| json!({"id":id,"label":label,"default":!["data","machine","secrets"].contains(id)})).collect::<Vec<_>>(),"canUndo":storage::latest(&paths)?.is_some(),"last":inner.last}),
            );
        }
        if op == "apply" {
            ensure!(input["confirm"] == true, "请先确认预览中的覆盖范围");
            let preview = inner.preview.take().context("请先预览备份差异")?;
            ensure!(input["previewId"] == preview.id, "预览已失效，请重新预览");
            ensure!(preview.expires >= now(), "预览已过期，请重新预览");
            inner.last = None;
            if let Some((runtime, remote_id)) = &preview.remote {
                relay(
                    runtime,
                    json!({"op":"apply","previewId":remote_id,"confirm":true}),
                )
                .await?;
                inner.remote_wait = Some((runtime.clone(), remote_id.clone(), preview.id.clone()));
                return Ok(json!({"ok":true,"restarting":false,"remotePending":true}));
            }
            check(&preview)?;
            if preview.target.current {
                inner.pending = Some(preview);
                self.pending.store(true, Ordering::SeqCst);
                let this = self.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    this.restart.notify_one();
                });
                return Ok(json!({"ok":true,"restarting":true}));
            }
            let target_paths = Paths::new(Some(preview.target.path.clone()))?;
            let lock = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(target_paths.root.join("service.lock"))?;
            lock.try_lock_exclusive()
                .context("目标 Palboo 正在运行，请先停止目标环境后重试")?;
            check(&preview)?;
            let id = storage::commit(&target_paths, &preview.files)?;
            inner.last = Some(
                json!({"ok":true,"id":id,"target":preview.target.label,"previewId":preview.id}),
            );
            return Ok(json!({"ok":true,"restarting":false,"recoveryId":id}));
        }
        let target_id = input["target"].as_str().unwrap_or("current");
        let target = targets::find(&paths, target_id)?;
        let target_paths = Paths::new(Some(target.path.clone()))?;
        if op == "undo" {
            if !target.current
                && let Ok(runtime) = crate::lifecycle::Runtime::read(&target_paths)
                && runtime.alive().await
            {
                let mut summary = relay(&runtime, json!({"op":"undo"})).await?;
                let remote_id = summary["previewId"]
                    .as_str()
                    .context("目标预览响应无效")?
                    .to_owned();
                let id = uuid::Uuid::new_v4().simple().to_string();
                summary["previewId"] = id.clone().into();
                summary["target"] = serde_json::to_value(&target)?;
                inner.preview = Some(Plan {
                    id,
                    target,
                    files: BTreeMap::new(),
                    baseline: BTreeMap::new(),
                    expires: now() + 600,
                    remote: Some((runtime, remote_id)),
                });
                return Ok(summary);
            }
            let previous = storage::latest(&target_paths)?
                .context("没有可恢复的上次操作")?
                .after;
            let mut files = storage::undo_files(&target_paths)?;
            let has_data =
                files.contains_key("tasks.json") || files.contains_key("terminology-store.json");
            snapshot::prepare_undo(&target_paths, &mut files)?;
            let (preview, mut summary) = plan(target, files)?;
            summary["sections"] = if has_data { json!(["data"]) } else { json!([]) };
            ensure!(
                preview.baseline == previous,
                "目标配置在预览后已变化，请重新预览"
            );
            inner.preview = Some(preview);
            return Ok(summary);
        }
        let data = input["includeData"].as_bool().unwrap_or(false);
        let secrets = input["includeSecrets"].as_bool().unwrap_or(false);
        if op == "export" {
            let password = input["password"].as_str().unwrap_or("").to_owned();
            let result = tokio::task::spawn_blocking(move || {
                let archive = snapshot::stable_capture(&paths, data, secrets)?;
                let bytes = archive::encode(&archive, &password)?;
                Ok::<_, anyhow::Error>(json!({"data":archive::base64(&bytes),"filename":format!("palboo-{}{}.palboo{}", archive.created_at, if data { "-full" } else { "-settings" }, if password.is_empty() { "" } else { ".age" })}))
            }).await??;
            return Ok(result);
        }
        ensure!(["preview", "copy"].contains(&op.as_str()), "未知备份操作");
        let archive = if op == "copy" {
            let source = targets::find(&paths, input["source"].as_str().unwrap_or("current"))?;
            ensure!(source.path != target.path, "来源和目标不能相同");
            let source_version = source.version.as_ref().context("无法确认来源版本")?;
            ensure!(
                semver::Version::parse(source_version)?
                    <= semver::Version::parse(crate::config::VERSION)?,
                "来源版本较新，请先更新当前 Palboo"
            );
            snapshot::stable_capture(&Paths::new(Some(source.path))?, data, secrets)?
        } else {
            let bytes = archive::unbase64(input["data"].as_str().context("请选择备份文件")?)?;
            let password = input["password"].as_str().unwrap_or("").to_owned();
            tokio::task::spawn_blocking(move || archive::decode(&bytes, &password)).await??
        };
        let version = target
            .version
            .as_ref()
            .context("无法确认目标版本，请先正常启动一次目标 Palboo")?;
        ensure!(
            semver::Version::parse(version)? >= semver::Version::parse(&archive.app_version)?,
            "目标版本较旧，请更新后再导入此备份"
        );
        let selected: Vec<String> =
            serde_json::from_value(input["sections"].clone()).context("请选择要恢复的模块")?;
        if !target.current
            && let Ok(runtime) = crate::lifecycle::Runtime::read(&target_paths)
            && runtime.alive().await
        {
            let password = if archive.sections.contains_key("secrets") {
                uuid::Uuid::new_v4().to_string()
            } else {
                String::new()
            };
            let data = archive::base64(&archive::encode(&archive, &password)?);
            let mut summary = relay(&runtime, json!({"op":"preview","data":data,"password":password,"target":"current","sections":selected})).await.context("目标暂不支持在线恢复，请更新目标 Palboo，或停止目标环境后重试")?;
            let remote_id = summary["previewId"]
                .as_str()
                .context("目标预览响应无效")?
                .to_owned();
            let id = uuid::Uuid::new_v4().simple().to_string();
            summary["previewId"] = id.clone().into();
            summary["target"] = serde_json::to_value(&target)?;
            inner.preview = Some(Plan {
                id,
                target,
                files: BTreeMap::new(),
                baseline: BTreeMap::new(),
                expires: now() + 600,
                remote: Some((runtime, remote_id)),
            });
            return Ok(summary);
        }
        let mut names: FileChanges = selected
            .iter()
            .filter_map(|id| archive.sections.get(id))
            .flat_map(|section| section.files.keys().map(|name| (name.clone(), None)))
            .collect();
        if selected.iter().any(|id| id == "data") {
            names.extend(archive.attachments.keys().map(|name| (name.clone(), None)));
        }
        let expected = baseline(&target_paths, &names)?;
        let files = snapshot::build(&target_paths, &archive, &selected)?
            .into_iter()
            .map(|(name, bytes)| (name, Some(bytes)))
            .collect();
        let (preview, mut summary) = plan(target, files)?;
        ensure!(
            preview.baseline == expected,
            "目标配置在预览后已变化，请重新预览"
        );
        summary["sections"] = json!(selected);
        summary["available"] = json!(archive.sections.keys().collect::<Vec<_>>());
        summary["createdAt"] = archive.created_at.into();
        inner.preview = Some(preview);
        Ok(summary)
    }
    pub async fn finish(&self) {
        let mut inner = self.inner.lock().await;
        if let Some(plan) = inner.pending.take() {
            let result = check(&plan).and_then(|paths| storage::commit(&paths, &plan.files));
            inner.last = Some(match result {
                Ok(id) => json!({"ok":true,"id":id,"target":plan.target.label,"previewId":plan.id}),
                Err(error) => json!({"ok":false,"message":error.to_string(),"previewId":plan.id}),
            });
        }
        self.pending.store(false, Ordering::SeqCst);
    }
}

async fn relay(runtime: &crate::lifecycle::Runtime, body: Value) -> Result<Value> {
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(120))
        .build()?
        .post(format!("http://127.0.0.1:{}/api/backup", runtime.port))
        .bearer_auth(&runtime.token)
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    let result: Value = response.json().await?;
    ensure!(
        status.is_success(),
        "{}",
        result["message"]
            .as_str()
            .unwrap_or("目标环境不支持配置恢复")
    );
    Ok(result)
}
