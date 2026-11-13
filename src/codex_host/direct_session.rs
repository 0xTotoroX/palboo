// [INPUT]: 私有直启请求、系统 LaunchServices、官方 Shim/Host/Controller 和原生身份。
// [OUTPUT]: Palboo 打开并监督本次 Codex；控制器重连；宿主真正退出后正常回收归属明确的兼容后台。
// [POS]: 替代官方 Desktop launcher 的协调子进程，跨 Palboo Dev 热更存续；不接管普通外部 Codex。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use super::direct::{self, Layout, Record, Request, Resources};
use crate::{config::Paths, host::ProcessIdentity};
use anyhow::{Context, Result, ensure};
use std::{os::unix::fs::OpenOptionsExt, path::Path, process::Stdio, time::Duration};

#[cfg(test)]
#[path = "direct_session_tests.rs"]
mod tests;

fn free_port() -> Result<u16> {
    Ok(std::net::TcpListener::bind(("127.0.0.1", 0))?
        .local_addr()?
        .port())
}

fn environment(
    resources: &Resources,
    layout: &Layout,
    record: &Record,
) -> Result<Vec<(String, String)>> {
    // 官方独立 Host 继续使用自己的监督进程身份；不把 Palboo PID 填入官方 launcher 记录。
    let mut environment: Vec<(String, String)> = [
        (
            "CODEXHOST_STOCK_CODEX_PATH",
            resources.stock.to_string_lossy().into_owned(),
        ),
        (
            "CODEXHOST_HOST_NODE_PATH",
            resources.node.to_string_lossy().into_owned(),
        ),
        (
            "CODEXHOST_HOST_RUNTIME_PATH",
            resources.runtime.to_string_lossy().into_owned(),
        ),
        (
            "CODEXHOST_LAUNCHER_EXECUTABLE",
            resources.installation.to_string_lossy().into_owned(),
        ),
        (
            "CODEXHOST_DATA_DIR",
            layout.data.to_string_lossy().into_owned(),
        ),
        (
            "CODEXHOST_SHARED_DATA_DIR",
            layout.data.to_string_lossy().into_owned(),
        ),
        ("CODEXHOST_CONTROL_PORT", record.port.to_string()),
        ("CODEXHOST_CONTROL_NONCE", record.nonce.clone()),
        ("CODEXHOST_REMOTE_SSH_MANAGED", "0".into()),
        ("CODEXHOST_WEB_SERVICE", "0".into()),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value))
    .collect();
    environment.extend(super::native_cli::environment(
        record.native_cli.as_deref().context("原生 CLI 入口缺失")?,
    )?);
    Ok(environment)
}

async fn controller(
    paths: &Paths,
    layout: &Layout,
    record: &mut Record,
) -> Result<tokio::process::Child> {
    let log = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(paths.root.join("codex-host.log"))?;
    let mut command = tokio::process::Command::new(&record.resources.node);
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("CODEXHOST_")
            || matches!(
                key.to_str(),
                Some("CODEX_CLI_PATH" | "NODE_OPTIONS" | "NODE_PATH")
            )
        {
            command.env_remove(key);
        }
    }
    command
        .arg("--disable-warning=UNDICI-EHPA")
        .arg(&record.resources.controller)
        .arg("--renderer-cdp-endpoint")
        .arg(&record.endpoint)
        .arg("--renderer")
        .arg(&record.resources.renderer)
        .arg("--attachment-port")
        .arg(record.port.to_string())
        .arg("--attachment-nonce")
        .arg(&record.nonce)
        .env("CODEXHOST_DATA_DIR", &layout.data)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    let mut child = command.spawn().context("无法启动 CodexHost 界面控制器")?;
    record.controller =
        Some(ProcessIdentity::read(child.id().context("控制器未启动")?)?.context("控制器已退出")?);
    record.state = "connecting".into();
    if let Err(error) = record.save(layout) {
        if let Some(identity) = &record.controller {
            stop_owned(identity).await?;
        }
        let _ = child.wait().await;
        return Err(error);
    }
    Ok(child)
}

async fn stop_owned(process: &ProcessIdentity) -> Result<()> {
    if !process.alive()? {
        return Ok(());
    }
    ensure!(
        unsafe { libc::kill(process.pid as i32, libc::SIGTERM) } == 0,
        "无法正常退出原控制器"
    );
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while process.alive()? {
        ensure!(
            tokio::time::Instant::now() < deadline,
            "原控制器仍在退出，未强制结束"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}

async fn shim_belongs_to_desktop(resources: &Resources, desktop: &ProcessIdentity) -> Result<bool> {
    let output = tokio::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .await?;
    ensure!(output.status.success(), "无法核验兼容链归属");
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, path)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        if Path::new(path.trim()).canonicalize().ok().as_ref() != Some(&resources.shim) {
            continue;
        }
        let Ok(pid) = pid.parse() else { continue };
        let Some(mut process) = ProcessIdentity::read(pid)? else {
            continue;
        };
        for _ in 0..8 {
            let Some(parent) = process.parent()? else {
                break;
            };
            if parent == *desktop {
                return Ok(true);
            }
            process = parent;
        }
    }
    Ok(false)
}

async fn launched_desktop(resources: &Resources, endpoint: &str) -> Result<ProcessIdentity> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(pid) = crate::host::desktop_process(&resources.desktop)? {
            ensure!(
                crate::host::process_debug_endpoint(pid)?.as_deref() == Some(endpoint),
                "Codex 被其他启动操作打开，已保留；未接管此实例"
            );
            return ProcessIdentity::read(pid as u32)?.context("Codex 已退出");
        }
        ensure!(
            tokio::time::Instant::now() < deadline,
            "系统尚未打开 Codex；未重复启动其他实例"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(super) async fn run(paths: &Paths, layout: Layout, request: Request) -> Result<()> {
    let config = paths.load()?;
    ensure!(
        config.codex_host.enabled && config.codex_host.revision == request.revision,
        "CodexHost 设置已变化，未启动"
    );
    let resources = Resources::prepare(
        &super::Options {
            executable: Some(request.resources.installation.clone()),
            ..config.codex_host
        },
        &request.resources.desktop,
    )
    .await?;
    run_prepared(paths, layout, request, resources).await
}

async fn run_prepared(
    paths: &Paths,
    layout: Layout,
    request: Request,
    resources: Resources,
) -> Result<()> {
    let _own_guard = direct::lock(&layout.root.join("codex-host-session.lock"))?;
    let upstream_guard = direct::lock(&layout.upstream.join("launcher-v1.lock"))?;
    let config = paths.load()?;
    ensure!(
        config.codex_host.enabled && config.codex_host.revision == request.revision,
        "CodexHost 设置已变化，未启动"
    );
    let manager = ProcessIdentity::read(std::process::id())?.context("启动协调进程身份不可用")?;
    let mut record = if let Some(previous) = request.recovery {
        ensure!(
            direct::record(&layout)?
                .is_some_and(|current| current.lease == previous.lease
                    && current.manager == previous.manager),
            "原会话身份已变化，未接管"
        );
        ensure!(!previous.manager.alive()?, "原协调进程仍在运行");
        let desktop = previous.desktop.as_ref().context("缺少原宿主身份")?;
        ensure!(
            desktop.alive()?
                && crate::host::process_debug_endpoint(desktop.pid as i32)?.as_deref()
                    == Some(&previous.endpoint),
            "原 Codex 已变化，未接管"
        );
        if let Some(controller) = &previous.controller {
            stop_owned(controller).await?;
        }
        direct::clean_previous_runner(&layout, &previous);
        Record {
            lease: request.lease,
            manager,
            resources,
            controller: None,
            state: "connecting".into(),
            ..previous
        }
    } else {
        ensure!(
            crate::host::desktop_process(&resources.desktop)?.is_none(),
            "Codex 已被其他操作打开，未接管"
        );
        if let Some(previous) = direct::record(&layout)? {
            ensure!(
                !previous.manager.alive()?
                    && !previous
                        .desktop
                        .as_ref()
                        .is_some_and(|p| p.alive().unwrap_or(true))
                    && !previous
                        .controller
                        .as_ref()
                        .is_some_and(|p| p.alive().unwrap_or(true)),
                "之前的启动尚未退出，记录已保留"
            );
            direct::clean_previous_runner(&layout, &previous);
        }
        super::check_controller_records(
            &layout.upstream.join("desktop-runtime-v1.json"),
            &layout.data.join("mapping-store/store.lock"),
            Some(&resources.installation),
        )?;
        ensure!(
            super::shared_host::ready_process(&resources.installation, &layout.data)?.is_none(),
            "现有 CodexHost 后台独立于本次桌面，已保留；请先正常退出原实例，再从 Palboo 打开"
        );
        Record {
            schema: 1,
            lease: request.lease,
            manager,
            desktop: None,
            controller: None,
            resources,
            endpoint: format!("http://127.0.0.1:{}", free_port()?),
            port: free_port()?,
            nonce: uuid::Uuid::new_v4().simple().to_string(),
            state: "opening".into(),
            native_cli: None,
        }
    };
    record.save(&layout)?;
    if record.desktop.is_none() {
        record.native_cli = Some(super::native_cli::prepare(&layout, &record)?);
        record.save(&layout)?;
        crate::startup::phase("opening");
        crate::host_launch::launch_with_environment(
            &record.resources.desktop,
            reqwest::Url::parse(&record.endpoint)?
                .port()
                .context("缺少启动端口")?,
            None,
            &environment(&record.resources, &layout, &record)?,
        )
        .await?;
        record.desktop = Some(launched_desktop(&record.resources, &record.endpoint).await?);
        record.save(&layout)?;
    }
    crate::startup::phase("renderer");
    let desktop = record.desktop.clone().context("缺少宿主身份")?;
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    let mut child = controller(paths, &layout, &mut record).await?;
    let mut missing = 0;
    let mut lease = None;
    let mut chain = false;
    let mut retry_at = tokio::time::Instant::now();
    let outcome: Result<()> = async {
        loop {
            tokio::select! {
                _ = term.recv() => break,
                _ = interrupt.recv() => break,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            }
            match desktop.alive() {
                Ok(false) => missing += 1,
                _ => missing = 0,
            }
            if missing >= 2 {
                break;
            }
            if child.try_wait()?.is_some() {
                record.state = "connecting".into();
                record.save(&layout)?;
                if tokio::time::Instant::now() < retry_at {
                    continue;
                }
                retry_at = tokio::time::Instant::now() + Duration::from_secs(5);
                child = controller(paths, &layout, &mut record).await?;
            }
            if !chain {
                chain = shim_belongs_to_desktop(&record.resources, &desktop)
                    .await
                    .unwrap_or(false);
            }
            let native_host =
                super::shared_host::ready_process(&record.resources.installation, &layout.data)
                    .ok()
                    .flatten()
                    .is_some_and(|owner| {
                        super::native_host::descendant(&owner, &desktop).unwrap_or(false)
                    });
            if !native_host && record.state == "ready" {
                record.state = "connecting".into();
                record.save(&layout)?;
            }
            if chain && lease.is_none() {
                lease = super::shared_host::Lease::capture_at(
                    &record.resources.installation,
                    layout.data.clone(),
                    layout.upstream.join("launcher-v1.lock"),
                )
                .ok();
            }
            if record.state != "ready"
                && chain
                && native_host
                && lease.is_some()
                && super::readiness::installed_at(
                    &record.running(),
                    &record.descriptor(),
                    &layout.diagnostics(),
                )
                .await
                .unwrap_or(false)
                && super::ready_endpoint(&record.resources.desktop)
                    .await
                    .is_ok_and(|endpoint| endpoint == record.endpoint)
            {
                record.state = "ready".into();
                record.save(&layout)?;
            }
        }
        Ok(())
    }
    .await;
    if let Some(controller) = &record.controller {
        stop_owned(controller).await?;
    }
    let _ = child.wait().await;
    // 先释放官方锁，由 Lease 在同一官方双锁内重验；并发重开时放弃退出共享服务。
    drop(upstream_guard);
    let exited =
        || Ok(!desktop.alive()? && crate::host::desktop_process(&desktop.executable)?.is_none());
    if exited()? {
        if let Some(lease) = lease {
            lease.stop(exited).await?;
        }
        direct::remove_matching(&layout, &record.lease)?;
        if let Some(context) = &record.native_cli {
            super::native_cli::remove(context, &layout);
        }
    } else {
        record.state = "detached".into();
        record.save(&layout)?;
    }
    outcome
}
