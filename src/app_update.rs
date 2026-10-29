// [INPUT]: 固定 GitHub Release、完整安装 App、现有后台身份与共享模式锁。
// [OUTPUT]: status/check/begin/worker；手动检查、下载、完整 App 原子替换与启动失败恢复。
// [POS]: 设置页的显式 App 更新，不更新源码、不重启 Codex、不替换单个 CLI。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
mod dock;
mod install;
mod release;
#[cfg(test)]
mod tests;

use crate::{
    app_mode,
    app_transition::Progress,
    config::{Paths, write_private},
    lifecycle::{self, Runtime},
};
use anyhow::{Context, Result, bail, ensure};
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    release_id: u64,
    asset_id: u64,
    version: String,
    current_version: String,
    expected_revision: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    update: Update,
    installed: install::AppIdentity,
    runtime: Runtime,
    data: PathBuf,
    return_url: String,
    language: String,
}
async fn installed() -> Result<install::AppIdentity> {
    let prefs = app_mode::read(&app_mode::shared_paths()?)?;
    let executable = app_mode::release_executable(&prefs)?;
    install::inspect(executable.ancestors().nth(3).context("App 位置无效")?).await
}
fn matches_executable(actual: &Path, expected: &Path) -> bool {
    // AppIdentity.path 已规范化；macOS 的 /var 等父目录别名不代表另一份安装。
    actual.canonicalize().is_ok_and(|path| path == expected)
}
pub async fn status(development: bool) -> Result<Value> {
    let prefs = app_mode::read(&app_mode::shared_paths()?)?;
    let app = installed().await;
    let current = std::env::current_exe()?;
    let reason = if development {
        Some("请先切回正式模式，再更新已安装的 App。")
    } else if let Ok(app) = &app {
        if !matches_executable(&current, &app.path.join("Contents/MacOS/palboo")) {
            Some("请从已安装的 Palboo.app 打开设置后更新。")
        } else if !install::writable(&app.path) {
            Some("App 所在位置不可写，请先将完整 App 移到可写的应用程序目录。")
        } else {
            None
        }
    } else {
        Some("请先安装完整 Palboo.app。")
    };
    Ok(
        json!({"currentVersion":app.as_ref().map(|a| a.version.as_str()).unwrap_or(crate::config::VERSION),"revision":prefs.revision,"canInstall":reason.is_none(),"reason":reason,"development":development,"checked":false}),
    )
}
pub async fn check(development: bool) -> Result<Value> {
    let mut value = status(development).await?;
    let release = release::fetch().await?;
    let current = Version::parse(value["currentVersion"].as_str().context("当前版本无效")?)?;
    value["hasUpdate"] = json!(
        Version::parse(&release.version)?
            .cmp_precedence(&current)
            .is_gt()
    );
    value["release"] = serde_json::to_value(release)?;
    value["checked"] = json!(true);
    Ok(value)
}
pub async fn begin(
    paths: &Paths,
    update: Update,
    development: bool,
    return_url: String,
) -> Result<Value> {
    ensure!(!development, "请先切回正式模式，再更新已安装的 App。");
    let control = app_mode::shared_paths()?;
    let guard = app_mode::mode_lock(&control)?;
    let prefs = app_mode::read(&control)?;
    ensure!(
        prefs.revision == update.expected_revision,
        "运行模式已更改，请重新检查更新"
    );
    let app = installed().await?;
    ensure!(
        matches_executable(
            &std::env::current_exe()?,
            &app.path.join("Contents/MacOS/palboo")
        ),
        "请从已安装的 Palboo.app 打开设置后更新。"
    );
    ensure!(
        app.version == update.current_version,
        "当前 App 已改变，请重新检查更新"
    );
    ensure!(
        install::writable(&app.path),
        "App 所在位置不可写，请先将完整 App 移到可写的应用程序目录。"
    );
    let runtime = Runtime::read(paths)?;
    ensure!(
        runtime.pid == std::process::id(),
        "后台身份已改变，请重新打开设置"
    );
    let file = control
        .root
        .join(format!(".app-update-{}.json", uuid::Uuid::new_v4()));
    write_private(
        &file,
        &serde_json::to_vec(&Request {
            update,
            installed: app,
            runtime,
            data: paths.root.clone(),
            return_url,
            language: crate::i18n::text("zh-CN", "en").into(),
        })?,
    )?;
    drop(guard);
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--data-dir")
        .arg(&paths.root)
        .args(["app-update-worker", "--request"])
        .arg(&file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    lifecycle::detach(&mut command);
    let mut child = command.spawn()?;
    let ready = PathBuf::from(format!("{}.ready", file.display()));
    for _ in 0..100 {
        if let Ok(bytes) = std::fs::read(&ready) {
            let _ = std::fs::remove_file(&ready);
            let value: Value = serde_json::from_slice(&bytes)?;
            ensure!(
                value.get("error").is_none(),
                "{}",
                value["error"].as_str().unwrap_or("更新准备失败")
            );
            return Ok(value);
        }
        if child.try_wait()?.is_some() {
            bail!("更新进程未能启动，原 App 保持不变");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    bail!("更新进程准备超时，原 App 保持不变")
}
pub async fn worker(file: &Path) -> Result<()> {
    let control = app_mode::shared_paths()?;
    ensure!(
        file.parent() == Some(control.root.as_path())
            && file
                .file_name()
                .is_some_and(|v| v.to_string_lossy().starts_with(".app-update-")),
        "更新请求位置无效"
    );
    let ready = PathBuf::from(format!("{}.ready", file.display()));
    let guard = match app_mode::mode_lock(&control) {
        Ok(guard) => guard,
        Err(error) => {
            write_private(
                &ready,
                &serde_json::to_vec(&json!({"error":error.to_string()}))?,
            )?;
            return Err(error);
        }
    };
    let request: Request = serde_json::from_slice(&std::fs::read(file)?)?;
    std::fs::remove_file(file)?;
    crate::app_transition::run(
        &ready,
        &request.return_url,
        Some(&request.language),
        "正在更新 Palboo…",
        "Updating Palboo…",
        guard,
        |progress| {
            let request = &request;
            let control = &control;
            async move { apply(control, request, &progress).await }
        },
    )
    .await
}
fn connection(view: &Value) -> Option<Value> {
    (view["connection"]["status"] == "connected").then(|| json!({"endpoint":view["connection"]["endpoint"],"targetId":view["connection"]["targetId"]}))
}
async fn resume(
    data: &Paths,
    app: &Path,
    previous_connection: Option<&Value>,
    started: &mut Option<Started>,
) -> Result<Value> {
    ensure_quiet(data).await?;
    let stale = Runtime::read(data).ok();
    let executable = app.join("Contents/MacOS/palboo");
    let log = data.root.join("service.log");
    if !log.exists() {
        write_private(&log, b"")?;
    }
    let log = std::fs::OpenOptions::new().append(true).open(log)?;
    let mut command = std::process::Command::new(&executable);
    command
        .arg("--data-dir")
        .arg(&data.root)
        .args(["serve", "--port", "0"])
        .env("PALBOO_START_DISCONNECTED", "1")
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    lifecycle::detach(&mut command);
    *started = Some(Started {
        child: command.spawn()?,
        runtime: None,
        ready: false,
    });
    let owned = started.as_mut().context("后台未启动")?;
    let runtime = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(status) = owned.child.try_wait()? {
                bail!("后台启动失败（{status}）");
            }
            if let Ok(runtime) = Runtime::read(data) {
                if stale
                    .as_ref()
                    .is_some_and(|old| old.pid == runtime.pid && old.token == runtime.token)
                {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
                ensure!(
                    runtime.pid == owned.child.id()
                        && matches_executable(&runtime.executable, &executable),
                    "恢复后的后台来自其他程序"
                );
                owned.runtime = Some(runtime.clone());
                if runtime.alive().await {
                    owned.ready = true;
                    break Ok::<Runtime, anyhow::Error>(runtime);
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .context("新后台启动超时")??;
    if data.load()?.performance.integration_enabled
        && let Some(connection) = previous_connection
    {
        runtime.request("connect", Some(connection.clone())).await?;
        app_mode::wait_for_release(&runtime, Some(connection), Duration::from_secs(20)).await?;
    }
    // 更新进程不携带开发设置地址，返回新后台的认证页面。
    Ok(json!({"url":format!("http://127.0.0.1:{}/#token={}",runtime.port,runtime.token)}))
}
struct Started {
    child: std::process::Child,
    runtime: Option<Runtime>,
    ready: bool,
}
impl Started {
    async fn stop(&mut self, data: &Paths) -> Result<()> {
        if self.child.try_wait()?.is_some() {
            return Ok(());
        }
        if let Some(runtime) = &self.runtime {
            if let Err(error) = lifecycle::stop_runtime(data, runtime).await {
                if self.ready {
                    return Err(error);
                }
                // 已写运行信息但从未就绪的本次子进程也需要回收，才能恢复旧包。
                if self.child.try_wait()?.is_none() {
                    self.child.kill()?;
                }
            }
        } else {
            // 只终止本次启动、尚未发布运行信息的子进程，不接管其他后台。
            self.child.kill()?;
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            while self.child.try_wait()?.is_none() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Ok::<(), anyhow::Error>(())
        })
        .await
        .context("本次启动的后台尚未退出")??;
        Ok(())
    }
}
async fn ensure_quiet(data: &Paths) -> Result<()> {
    if !data.runtime().exists() {
        return Ok(());
    }
    let runtime = Runtime::read(data)?;
    ensure!(
        runtime.pid > 1 && runtime.pid <= i32::MAX as u32,
        "后台进程信息无效"
    );
    ensure!(
        !runtime.alive().await && unsafe { libc::kill(runtime.pid as i32, 0) } != 0,
        "后台已被其他操作启动，未继续替换 App"
    );
    Ok(())
}
async fn apply(control: &Paths, request: &Request, progress: &Progress) -> Result<Value> {
    let prefs = app_mode::read(control)?;
    ensure!(
        prefs.revision == request.update.expected_revision,
        "运行模式已更改，请重新检查更新"
    );
    ensure!(
        installed().await? == request.installed,
        "当前 App 已改变，请重新检查更新"
    );
    let data = Paths::new(Some(request.data.clone()))?;
    let executable = request.installed.path.join("Contents/MacOS/palboo");
    ensure!(
        matches_executable(&request.runtime.executable, &executable)
            && app_mode::release_paths(&prefs)?.root == data.root,
        "当前后台不属于已登记的正式 App"
    );
    ensure!(
        !app_mode::development_running(&prefs).await?,
        "开发进程仍在运行，请先切回正式模式再更新"
    );
    let latest = release::fetch().await?;
    let asset = latest
        .asset
        .as_ref()
        .context("此版本仅提供源码，没有可安装的 DMG")?;
    ensure!(
        latest.id == request.update.release_id
            && latest.version == request.update.version
            && asset.id == request.update.asset_id,
        "更新信息已改变，请重新检查更新"
    );
    ensure!(
        Version::parse(&latest.version)?
            .cmp_precedence(&Version::parse(&request.installed.version)?)
            .is_gt(),
        "当前已经是此版本或更新版本"
    );
    let downloaded = tempfile::Builder::new()
        .prefix("app-download-")
        .tempdir_in(&control.root)?;
    let dmg = downloaded.path().join("update.dmg");
    release::download(asset, &dmg, progress).await?;
    *progress.write().await = json!({"phase":"verifying","message":crate::i18n::text("正在验证完整 App…", "Verifying the complete App…")});
    let prepared = install::prepare(&dmg, &request.installed, &latest.version).await?;
    ensure!(
        installed().await? == request.installed,
        "下载期间 App 已改变，未替换安装"
    );
    finish_install(control, request, progress, prepared, &latest.version, true).await
}
async fn finish_install(
    control: &Paths,
    request: &Request,
    progress: &Progress,
    mut prepared: install::Prepared,
    version: &str,
    repair_dock: bool,
) -> Result<Value> {
    let prefs = app_mode::read(control)?;
    ensure!(
        prefs.revision == request.update.expected_revision,
        "运行模式已更改，请重新检查更新"
    );
    let data = Paths::new(Some(request.data.clone()))?;
    let executable = request.installed.path.join("Contents/MacOS/palboo");
    let current = Runtime::read(&data)?;
    ensure!(
        current.pid == request.runtime.pid
            && current.token == request.runtime.token
            && matches_executable(&current.executable, &executable),
        "下载期间后台已改变，未替换安装"
    );
    let previous_connection = connection(&current.request("state", None).await?);
    *progress.write().await = json!({"phase":"installing","message":crate::i18n::text("正在更新并重启 Palboo…", "Updating and restarting Palboo…")});
    let receipt = control.root.join("last-app-update.json");
    let previous_receipt: Value = std::fs::read(&receipt)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    write_private(
        &receipt,
        &serde_json::to_vec_pretty(
            &json!({"phase":"installing","from":request.installed.version,"to":version,"app":request.installed.path,"previousApp":prepared.next}),
        )?,
    )?;
    // 全部验证完成后才正常关闭原后台；不强退旧进程，也不重新打开 Codex。
    let mut started = None;
    let outcome = async {
        lifecycle::stop_runtime(&data, &current).await?;
        ensure_quiet(&data).await?;
        prepared.activate()?;
        let value = resume(
            &data,
            &request.installed.path,
            previous_connection.as_ref(),
            &mut started,
        )
        .await?;
        let runtime = Runtime::read(&data)?;
        ensure!(
            runtime.version == version,
            "新后台版本与更新信息不符"
        );
        if repair_dock { dock::repair(&request.installed.path, &prepared.next, &control.root).await?; }
        let mut next = prefs.clone();
        next.revision += 1;
        next.executable = Some(executable.clone());
        app_mode::save(control, &next)?;
        write_private(&receipt, &serde_json::to_vec_pretty(
            &json!({"phase":"done","from":request.installed.version,"to":version,"app":request.installed.path,"previousApp":prepared.next}),
        )?)?;
        Ok::<Value, anyhow::Error>(value)
    }
    .await;
    match outcome {
        Ok(value) => {
            let previous = prepared.keep_previous();
            install::clean_previous(&previous_receipt, &request.installed.path, &previous);
            Ok(value)
        }
        Err(error) => {
            let restored = async {
                if let Some(owned) = &mut started {
                    owned.stop(&data).await?;
                } else if current.alive().await {
                    lifecycle::stop_runtime(&data, &current).await?;
                }
                ensure_quiet(&data).await?;
                prepared.rollback()?;
                app_mode::save(control, &prefs)?;
                let mut value = resume(
                    &data,
                    &request.installed.path,
                    previous_connection.as_ref(),
                    &mut None,
                )
                .await?;
                if repair_dock
                    && let Err(dock) =
                        dock::repair(&request.installed.path, &prepared.next, &control.root).await
                {
                    value["warning"] = json!(format!("Dock 入口恢复失败：{dock}"));
                }
                Ok::<Value, anyhow::Error>(value)
            }
            .await;
            match restored {
                Ok(value) => {
                    let mut message = format!(
                        "{error}；{}",
                        crate::i18n::text(
                            "已恢复原 App，配置保持不变。",
                            "Restored the previous App and kept your settings."
                        )
                    );
                    if let Some(warning) = value["warning"].as_str() {
                        message.push_str(&format!(" {warning}"));
                    }
                    let _ = write_private(
                        &receipt,
                        &serde_json::to_vec(
                            &json!({"phase":"rolledBack","from":request.installed.version,"to":version}),
                        )?,
                    );
                    *progress.write().await =
                        json!({"phase":"failed","message":message,"url":value["url"]});
                    bail!("{message}")
                }
                Err(restore) => {
                    let backup = prepared.previous_path();
                    bail!(
                        "{error}；恢复失败：{restore}。完整旧 App 保留在 {}，配置和数据未迁移。",
                        backup.display()
                    )
                }
            }
        }
    }
}
