// [INPUT]: Private mode preferences, bundled release CLI and registered Dev supervisor.
// [OUTPUT]: Unified App launch, connection-confirmed mode handover and revision-checked preference recovery.
// [POS]: One-shot mode worker; keeps release and per-source Dev data in their original places.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::{
    config::{Paths, write_private},
    lifecycle::{self, Runtime},
};
use anyhow::{Context, Result, bail, ensure};
use axum::{
    Json, Router,
    response::Html,
    routing::{get, post},
};
use clap::Subcommand;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Notify, RwLock};

#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Release,
    Development,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub release_data: Option<PathBuf>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub source: Option<PathBuf>,
    #[serde(default)]
    pub node: Option<PathBuf>,
    #[serde(default)]
    pub executable: Option<PathBuf>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub expected_revision: u64,
    pub mode: Mode,
    pub source: Option<PathBuf>,
    pub node: Option<PathBuf>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Handover {
    update: Update,
    previous: Mode,
    connection: Option<Value>,
    return_url: String,
    #[serde(default)]
    language: Option<String>,
}
#[derive(Subcommand)]
pub enum Command {
    Launch,
    Status,
    Bind,
    Recover,
    #[command(hide = true)]
    InstallGuard {
        #[arg(long)]
        executable: PathBuf,
        #[arg(long)]
        data: PathBuf,
    },
    Register {
        #[arg(long)]
        active: bool,
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        node: PathBuf,
    },
    #[command(hide = true)]
    Worker {
        #[arg(long)]
        request: PathBuf,
    },
}

pub fn shared_paths() -> Result<Paths> {
    if let Some(path) = std::env::var_os("PALBOO_LAUNCHER_HOME") {
        return Paths::new(Some(path.into()));
    }
    Paths::new(Some(
        dirs::data_local_dir()
            .context("无法找到数据目录")?
            .join("palboo-launcher"),
    ))
}
fn read(paths: &Paths) -> Result<Preferences> {
    let path = paths.root.join("app-mode.json");
    if !path.exists() {
        return Ok(Preferences::default());
    }
    serde_json::from_slice(&std::fs::read(path)?).context("运行模式配置无法读取，原数据已保留")
}
fn save(paths: &Paths, value: &Preferences) -> Result<()> {
    write_private(
        &paths.root.join("app-mode.json"),
        &serde_json::to_vec_pretty(value)?,
    )
}
fn mode_lock(paths: &Paths) -> Result<std::fs::File> {
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(paths.root.join("app-mode.lock"))?;
    file.try_lock_exclusive()
        .context("正在启动或切换运行模式，请稍后再试")?;
    Ok(file)
}
fn release_executable(prefs: &Preferences) -> Result<PathBuf> {
    let current = std::env::current_exe()?;
    let path = if current.ends_with("Contents/MacOS/palboo") {
        current
    } else {
        prefs
            .executable
            .clone()
            .context("请先安装完整 Palboo.app")?
    };
    ensure!(
        path.ends_with("Contents/MacOS/palboo") && path.is_file(),
        "正式 App 不可用，请重新安装完整 Palboo.app"
    );
    Ok(path)
}
fn validate_development(prefs: &mut Preferences) -> Result<()> {
    let source = prefs
        .source
        .as_ref()
        .context("请先选择 Palboo 源码目录")?
        .canonicalize()
        .context("开发源码目录不可达，请重新选择或使用正式模式")?;
    let package: Value = serde_json::from_slice(&std::fs::read(source.join("package.json"))?)?;
    ensure!(
        package["name"] == "palboo" && source.join("scripts/app-mode.mjs").is_file(),
        "请选择支持模式切换的 Palboo 源码目录"
    );
    if prefs.node.is_none() {
        prefs.node = find_node();
    }
    let node = prefs
        .node
        .as_ref()
        .context("请填写 Node.js 程序路径")?
        .canonicalize()
        .context("Node.js 不可达，请重新选择或使用正式模式")?;
    ensure!(node.is_file(), "Node.js 路径不是可执行文件");
    prefs.source = Some(source);
    prefs.node = Some(node);
    Ok(())
}
pub fn status(development: bool) -> Result<Value> {
    let prefs = read(&shared_paths()?)?;
    Ok(
        json!({"mode":if development { Mode::Development } else { Mode::Release },
        "preferredMode":prefs.mode,"revision":prefs.revision,"source":prefs.source,"node":prefs.node,
        "configured":prefs.source.is_some(),"releaseAvailable":release_executable(&prefs).is_ok()}),
    )
}

async fn cli(path: &Path, arguments: &[&str], defer: bool) -> Result<()> {
    let mut command = tokio::process::Command::new(path);
    command
        .args(arguments)
        .env_remove("PALBOO_START_DISCONNECTED")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if defer {
        command.env("PALBOO_START_DISCONNECTED", "1");
    }
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(150), command.output())
        .await
        .context("程序响应超时")??;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(())
}
async fn dev(
    paths: &Paths,
    prefs: &Preferences,
    action: &str,
    connection: Option<&Value>,
) -> Result<Value> {
    let input = paths
        .root
        .join(format!(".app-mode-{}.json", uuid::Uuid::new_v4()));
    write_private(
        &input,
        &serde_json::to_vec(&json!({"action":action,"connection":connection}))?,
    )?;
    let result_path = PathBuf::from(format!("{}.result", input.display()));
    let log_path = paths.root.join("app-mode.log");
    if !log_path.exists() {
        write_private(&log_path, b"")?;
    }
    let log = std::fs::OpenOptions::new().append(true).open(log_path)?;
    let source = prefs.source.as_ref().context("开发源码未配置")?;
    let mut command = tokio::process::Command::new(prefs.node.as_ref().context("Node.js 未配置")?);
    command
        .arg(source.join("scripts/app-mode.mjs"))
        .arg(&input)
        .current_dir(source)
        .env_remove("PALBOO_START_DISCONNECTED")
        .env("PALBOO_HOME", release_paths(prefs)?.root)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(960), command.status())
        .await
        .context("开发环境准备超时")?;
    let result = std::fs::read(&result_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(result_path);
    let output = output.context("无法启动开发环境，请检查 Node.js 路径")?;
    let result = result.context("开发模式没有返回结果，请查看 app-mode.log")?;
    ensure!(
        output.success() && result.get("error").is_none(),
        "{}",
        result["error"].as_str().unwrap_or("开发模式操作失败")
    );
    Ok(result)
}
fn release_paths(prefs: &Preferences) -> Result<Paths> {
    match &prefs.release_data {
        Some(path) => Paths::new(Some(path.clone())),
        None => Paths::new(None),
    }
}
fn find_node() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|p| p.join("node"))
            .collect();
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ]);
    candidates.into_iter().find(|path| path.is_file())
}
async fn release(
    paths: &Paths,
    executable: &Path,
    connection: Option<&Value>,
    cold: bool,
) -> Result<Value> {
    let data = release_paths(&read(paths)?)?;
    let paths = &data;
    let data_dir = paths.root.to_str().context("数据目录不是有效文本")?;
    if cold {
        cli(
            executable,
            &[
                "--data-dir",
                data_dir,
                "launch",
                "--no-open",
                "--restart-running",
            ],
            false,
        )
        .await?;
    } else {
        // Start disconnected so an old saved target cannot briefly take over another chat.
        cli(
            executable,
            &["--data-dir", data_dir, "start", "--port", "0", "--no-open"],
            true,
        )
        .await?;
        let runtime = Runtime::read(paths)?;
        if paths.load()?.performance.integration_enabled {
            if let Some(connection) = connection {
                runtime.request("connect", Some(connection.clone())).await?;
            } else {
                cli(
                    executable,
                    &["--data-dir", data_dir, "launch", "--no-open"],
                    false,
                )
                .await?;
            }
        }
    }
    let runtime = Runtime::read(paths)?;
    if paths.load()?.performance.integration_enabled {
        wait_for_release(&runtime, connection, Duration::from_secs(20)).await?;
    }
    Ok(
        json!({"url":format!("http://127.0.0.1:{}/#token={}", runtime.port,runtime.token), "paused":!paths.load()?.performance.integration_enabled}),
    )
}

async fn wait_for_release(
    runtime: &Runtime,
    connection: Option<&Value>,
    timeout: Duration,
) -> Result<()> {
    let connected = async {
        loop {
            let state = runtime.request("state", None).await?;
            if state["connection"]["status"] == "connected" {
                if let Some(expected) = connection {
                    ensure!(
                        state["connection"]["targetId"] == expected["targetId"]
                            && state["connection"]["endpoint"] == expected["endpoint"],
                        "正式模式连接目标不一致"
                    );
                }
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    tokio::time::timeout(timeout, connected)
        .await
        .context("正式模式连接超时，请检查 Codex 是否就绪；运行模式设置未更改")?
}

async fn development_running(prefs: &Preferences) -> Result<bool> {
    let Some(source) = prefs.source.as_ref() else {
        return Ok(false);
    };
    let needle = source.join("scripts/dev.mjs");
    let output = tokio::process::Command::new("/bin/ps")
        .args(["-axo", "command="])
        .output()
        .await?;
    ensure!(output.status.success(), "无法核对开发进程，未切换模式");
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|line| line.contains(&needle.to_string_lossy().to_string())))
}
async fn switch(paths: &Paths, request: &Handover, progress: &Arc<RwLock<Value>>) -> Result<Value> {
    let old = read(paths)?;
    // The request records the actual serving mode. A failed cold recovery can leave
    // the saved preference different; revision remains the concurrent-write guard.
    ensure!(
        old.revision == request.update.expected_revision,
        "运行模式已被其他操作更改，请重新打开设置"
    );
    let mut next = old.clone();
    next.mode = request.update.mode;
    next.revision += 1;
    if request.update.source.is_some() {
        next.source = request.update.source.clone();
    }
    if request.update.node.is_some() {
        next.node = request.update.node.clone();
    }
    ensure!(
        request.previous != Mode::Development || old.source == next.source,
        "请先切回正式模式，再更换开发目录；worktree 可在开发来源页切换"
    );
    let executable = release_executable(&next)?;
    // Resolve every dependency before touching the currently running mode.
    cli(&executable, &["--version"], false).await?;
    if next.mode == Mode::Development {
        validate_development(&mut next)?;
        *progress.write().await = json!({"phase":"preparing","message":crate::i18n::text("正在编译开发源码，当前模式继续运行…", "Building development sources. The current mode stays active…")});
        dev(paths, &next, "prepare", None).await?;
    } else if request.previous == Mode::Development && development_running(&old).await? {
        let mut check = old.clone();
        validate_development(&mut check)?;
    }
    *progress.write().await = json!({"phase":"switching","message":crate::i18n::text("正在切换运行模式…", "Switching modes…")});
    let outcome = async {
        let value = if next.mode == Mode::Development {
            dev(paths, &next, "open", request.connection.as_ref()).await?
        } else {
            if request.previous == Mode::Development && development_running(&old).await? {
                dev(paths, &old, "stop", None).await?;
            }
            release(paths, &executable, request.connection.as_ref(), false).await?
        };
        next.executable = Some(executable.clone());
        save(paths, &next)?;
        Ok::<Value, anyhow::Error>(value)
    }
    .await;
    match outcome {
        Ok(value) => Ok(value),
        Err(error) => {
            let rollback = if request.previous == Mode::Development {
                if let Ok(runtime) = Runtime::read(&release_paths(&old)?) {
                    let _ = runtime.request("disconnect", Some(json!({}))).await;
                }
                dev(paths, &old, "open", request.connection.as_ref()).await
            } else {
                if next.mode == Mode::Development {
                    let _ = dev(paths, &next, "stop", None).await;
                }
                release(paths, &executable, request.connection.as_ref(), false).await
            };
            match rollback {
                Ok(value) => {
                    let message = format!("{error}；已恢复原模式。");
                    *progress.write().await =
                        json!({"phase":"failed","message":message,"url":value["url"]});
                    bail!("{message}")
                }
                Err(restore) => bail!("{error}；原模式恢复失败：{restore}。配置和数据已保留。"),
            }
        }
    }
}

pub async fn begin(
    update: Update,
    previous: Mode,
    connection: Option<Value>,
    return_url: String,
) -> Result<Value> {
    let paths = shared_paths()?;
    let prefs = read(&paths)?;
    let executable = release_executable(&prefs)?;
    let request = paths
        .root
        .join(format!(".app-switch-{}.json", uuid::Uuid::new_v4()));
    write_private(
        &request,
        &serde_json::to_vec(&Handover {
            update,
            previous,
            connection,
            return_url,
            language: Some(crate::i18n::text("zh-CN", "en").into()),
        })?,
    )?;
    let mut command = std::process::Command::new(executable);
    command
        .env_remove("PALBOO_START_DISCONNECTED")
        .arg("--data-dir")
        .arg(&paths.root)
        .args(["app-mode", "worker", "--request"])
        .arg(&request)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    lifecycle::detach(&mut command);
    let mut child = command.spawn()?;
    let ready = PathBuf::from(format!("{}.ready", request.display()));
    for _ in 0..100 {
        if let Ok(bytes) = std::fs::read(&ready) {
            let _ = std::fs::remove_file(&ready);
            let value: Value = serde_json::from_slice(&bytes)?;
            ensure!(value.get("error").is_none(), "{}", value["error"]);
            return Ok(value);
        }
        if child.try_wait()?.is_some() {
            bail!("切换进程未能启动，当前模式保持不变");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    bail!("切换进程准备超时，请稍后重试")
}

async fn worker(paths: &Paths, file: &Path) -> Result<()> {
    let ready = PathBuf::from(format!("{}.ready", file.display()));
    let guard = match mode_lock(paths) {
        Ok(guard) => guard,
        Err(error) => {
            write_private(
                &ready,
                &serde_json::to_vec(&json!({"error":error.to_string()}))?,
            )?;
            return Err(error);
        }
    };
    let request: Handover = serde_json::from_slice(&std::fs::read(file)?)?;
    if let Some(language) = &request.language {
        crate::i18n::set_language(language);
    }
    let _ = std::fs::remove_file(file);
    let token = uuid::Uuid::new_v4().simple().to_string();
    let route = format!("/switch/{token}");
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let progress = Arc::new(RwLock::new(
        json!({"phase":"preparing","message":crate::i18n::text("正在准备…", "Preparing…")}),
    ));
    let state = progress.clone();
    let acknowledged = Arc::new(Notify::new());
    let ack = acknowledged.clone();
    let page = TRANSITION_PAGE
        .replace("__STATE__", &format!("{route}/state"))
        .replace(
            "lang=\"zh-CN\"",
            crate::i18n::text("lang=\"zh-CN\"", "lang=\"en\""),
        )
        .replace(
            "正在切换运行模式…",
            crate::i18n::text("正在切换运行模式…", "Switching modes…"),
        )
        .replace(
            "返回设置",
            crate::i18n::text("返回设置", "Return to settings"),
        )
        .replace(
            "切换状态暂时不可达，请重新打开 Palboo。",
            crate::i18n::text(
                "切换状态暂时不可达，请重新打开 Palboo。",
                "Switch status is unavailable. Reopen Palboo.",
            ),
        )
        .replace(
            "未开始切换，请重新打开设置。",
            crate::i18n::text(
                "未开始切换，请重新打开设置。",
                "Switching has not started. Reopen settings.",
            ),
        );
    let router = Router::new()
        .route(
            &format!("{route}/state/start"),
            post(move || {
                let ack = ack.clone();
                async move {
                    ack.notify_one();
                    Json(json!({"ok":true}))
                }
            }),
        )
        .route(&route, get(move || async { Html(page) }))
        .route(
            &format!("{route}/state"),
            get(move || {
                let state = state.clone();
                async move { Json(state.read().await.clone()) }
            }),
        );
    let task = tokio::spawn(async move { axum::serve(listener, router).await });
    write_private(
        &ready,
        &serde_json::to_vec(&json!({"url":format!("http://127.0.0.1:{port}{route}")}))?,
    )?;
    let outcome = if tokio::time::timeout(Duration::from_secs(45), acknowledged.notified())
        .await
        .is_ok()
    {
        switch(paths, &request, &progress).await
    } else {
        Err(anyhow::anyhow!("切换页面未打开，当前模式保持不变。"))
    };
    match outcome {
        Ok(value) => *progress.write().await = json!({"phase":"done","url":value["url"]}),
        Err(error) => {
            if progress.read().await["phase"] != "failed" {
                *progress.write().await =
                    json!({"phase":"failed","message":error.to_string(),"url":request.return_url});
            }
        }
    }
    drop(guard);
    tokio::time::sleep(Duration::from_secs(120)).await;
    task.abort();
    Ok(())
}

pub async fn run(data_paths: &Paths, command: Command) -> Result<()> {
    let control = shared_paths()?;
    let paths = &control;
    match command {
        Command::Worker { request } => worker(paths, &request).await,
        Command::Status => {
            println!("{}", serde_json::to_string(&read(paths)?)?);
            Ok(())
        }
        Command::InstallGuard { executable, data } => {
            use std::io::{BufRead, Write};
            let _guard = mode_lock(paths)?;
            println!("ready");
            std::io::stdout().flush()?;
            for line in std::io::stdin().lock().lines() {
                match line?.as_str() {
                    "commit" => {
                        let mut prefs = read(paths)?;
                        ensure!(
                            executable.ends_with("Contents/MacOS/palboo") && executable.is_file(),
                            "安装程序未就绪"
                        );
                        prefs.executable = Some(executable.clone());
                        prefs.release_data = Some(data.clone());
                        prefs.revision += 1;
                        save(paths, &prefs)?;
                        println!("committed");
                        std::io::stdout().flush()?;
                    }
                    "quit" => break,
                    _ => bail!("未知安装操作"),
                }
            }
            Ok(())
        }
        Command::Recover => {
            let _guard = mode_lock(paths)?;
            let mut prefs = read(paths)?;
            ensure!(
                !development_running(&prefs).await?,
                "开发进程仍在运行，请恢复源码或 Node.js 后从设置切换；未强制停止进程"
            );
            let executable = release_executable(&prefs)?;
            let value = release(paths, &executable, None, true).await?;
            prefs.mode = Mode::Release;
            prefs.revision += 1;
            prefs.executable = Some(executable);
            save(paths, &prefs)?;
            println!("{value}");
            Ok(())
        }
        Command::Bind => {
            let _guard = mode_lock(paths)?;
            let mut prefs = read(paths)?;
            prefs.release_data = Some(data_paths.root.clone());
            prefs.executable = Some(release_executable(&prefs)?);
            prefs.revision += 1;
            save(paths, &prefs)
        }
        Command::Register {
            source,
            node,
            active,
        } => {
            let _guard = mode_lock(paths)?;
            let mut prefs = read(paths)?;
            prefs.release_data = Some(data_paths.root.clone());
            prefs.revision += 1;
            prefs.source = Some(source);
            prefs.node = Some(node);
            validate_development(&mut prefs)?;
            prefs.executable = Some(release_executable(&prefs)?);
            if active {
                dev(paths, &prefs, "status", None).await?;
                prefs.mode = Mode::Development;
            }
            save(paths, &prefs)
        }
        Command::Launch => {
            let _guard = mode_lock(paths)?;
            let mut prefs = read(paths)?;
            let executable = release_executable(&prefs)?;
            let mut value = if prefs.mode == Mode::Development {
                validate_development(&mut prefs)?;
                dev(paths, &prefs, "open", None).await?
            } else {
                release(paths, &executable, None, true).await?
            };
            prefs.executable = Some(executable);
            save(paths, &prefs)?;
            value["mode"] = json!(prefs.mode);
            println!("{value}");
            Ok(())
        }
    }
}

const TRANSITION_PAGE: &str = r#"<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Palboo</title><style>:root{color-scheme:light dark}body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:34em;padding:32px}h1{font-size:24px}p{line-height:1.7}a{color:inherit}</style><main><h1>Palboo</h1><p role="status">正在切换运行模式…</p><a hidden>返回设置</a></main><script>const p=document.querySelector('p'),a=document.querySelector('a');async function poll(){try{const r=await fetch('__STATE__',{cache:'no-store'}),s=await r.json();if(s.phase==='done'){location.replace(s.url);return}p.textContent=s.message;if(s.phase==='failed'){a.href=s.url;a.hidden=false;return}setTimeout(poll,700)}catch{p.textContent='切换状态暂时不可达，请重新打开 Palboo。'}}fetch('__STATE__/start',{method:'POST'}).then(poll).catch(()=>{p.textContent='未开始切换，请重新打开设置。'})</script></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn release_waits_for_connection_and_rejects_other_targets_and_timeout() {
        let state = Arc::new(RwLock::new(json!({"connection":{"status":"connecting"}})));
        let observed = Arc::new(Notify::new());
        let view = state.clone();
        let signal = observed.clone();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = Router::new().route(
            "/api/state",
            get(move || {
                let view = view.clone();
                let signal = signal.clone();
                async move {
                    let result = view.read().await.clone();
                    signal.notify_one();
                    Json(result)
                }
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let runtime = Arc::new(Runtime {
            pid: 0,
            port,
            token: "test".into(),
            version: "test".into(),
            executable: PathBuf::new(),
        });
        let waiting = {
            let runtime = runtime.clone();
            tokio::spawn(
                async move { wait_for_release(&runtime, None, Duration::from_secs(3)).await },
            )
        };
        observed.notified().await;
        assert!(
            !waiting.is_finished(),
            "HTTP availability must not finish the connection handoff"
        );
        *state.write().await = json!({"connection":{"status":"connected","endpoint":"http://127.0.0.1:1","targetId":"expected"}});
        waiting.await.unwrap().unwrap();
        let expected = json!({"endpoint":"http://127.0.0.1:1","targetId":"expected"});
        wait_for_release(&runtime, Some(&expected), Duration::from_secs(1))
            .await
            .unwrap();
        for wrong in [
            json!({"endpoint":"http://127.0.0.1:2","targetId":"expected"}),
            json!({"endpoint":"http://127.0.0.1:1","targetId":"other"}),
        ] {
            assert!(
                wait_for_release(&runtime, Some(&wrong), Duration::from_secs(1))
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("目标不一致")
            );
        }
        *state.write().await = json!({"connection":{"status":"connecting"}});
        let error = wait_for_release(&runtime, None, Duration::from_millis(80))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("连接超时"));
        assert!(!error.contains("恢复"));
        server.abort();
    }
}
