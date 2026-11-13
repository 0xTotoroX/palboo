// [INPUT]: 本次桌面主 CLI 的真实父进程、官方 Host serve 与私有交接目录。
// [OUTPUT]: 保留桌面祖先关系的官方共享 Host；已有外部后台保留并拒绝接管。
// [POS]: 原生浏览器/桌面工具身份边界，不代理原生管道、不更改官方校验或安装包。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::{direct, shared_host};
use crate::host::ProcessIdentity;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize, Deserialize)]
pub(super) struct Launch {
    pub installation: PathBuf,
    pub node: PathBuf,
    pub runtime: PathBuf,
    pub stock: PathBuf,
    pub data: PathBuf,
}

pub(super) fn descendant(process: &ProcessIdentity, desktop: &ProcessIdentity) -> Result<bool> {
    let mut current = process.clone();
    for _ in 0..64 {
        if current == *desktop {
            return current.alive();
        }
        let Some(parent) = current.parent()? else {
            return Ok(false);
        };
        current = parent;
    }
    Ok(false)
}

fn ready(launch: &Launch, desktop: &ProcessIdentity) -> Result<bool> {
    let Some(owner) = shared_host::ready_process(&launch.installation, &launch.data)? else {
        return Ok(false);
    };
    ensure!(
        descendant(&owner, desktop)?,
        "现有 CodexHost 后台不属于本次桌面，已保留；请先正常退出原实例再重开"
    );
    Ok(true)
}

pub(super) fn owner_ancestry(launch: &Launch) -> Result<Vec<ProcessIdentity>> {
    let mut chain = Vec::new();
    let mut process = shared_host::ready_process(&launch.installation, &launch.data)?;
    while let Some(current) = process {
        process = current.parent()?;
        chain.push(current);
        if chain.len() >= 12 {
            break;
        }
    }
    Ok(chain)
}

pub(super) fn ensure(
    launch: &Launch,
    directory: &Path,
    desktop: &ProcessIdentity,
) -> Result<Option<std::process::Child>> {
    // 与官方 ensure/stop/restart 互斥；serve 不会重取调用方持有的锁。
    let _guard = direct::lock(&launch.data.join("shared-host-lifecycle.lock"))?;
    if ready(launch, desktop)? {
        return Ok(None);
    }
    let ready_file = directory.join("host-ready");
    let mut child = Command::new(&launch.installation)
        .args(["host", "serve", "--node"])
        .arg(&launch.node)
        .arg("--host-runtime")
        .arg(&launch.runtime)
        .arg("--data")
        .arg(&launch.data)
        .arg("--stock-codex")
        .arg(&launch.stock)
        .arg("--ready-file")
        .arg(&ready_file)
        .env_remove("PALBOO_NATIVE_CLI_CONTEXT")
        .env_remove("CODEX_CLI_PATH")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // 不 detach；随后 exec Shim 保持本 PID，官方 Host 仍是当前桌面的真实后代。
        .spawn()
        .context("无法准备本次桌面的 CodexHost 后台")?;
    let identity = ProcessIdentity::read(child.id())?.context("CodexHost 后台已退出")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let outcome = (|| {
        loop {
            ensure!(desktop.alive()?, "桌面已退出，启动已停止");
            if std::fs::read(&ready_file).is_ok_and(|bytes| bytes == b"ready\n")
                && ready(launch, desktop)?
            {
                return Ok(());
            }
            ensure!(
                child.try_wait()?.is_none(),
                "CodexHost 后台未能启动；未改动其他实例"
            );
            ensure!(Instant::now() < deadline, "本次 CodexHost 后台尚未就绪");
            std::thread::sleep(Duration::from_millis(25));
        }
    })();
    let _ = std::fs::remove_file(ready_file);
    let _ = std::fs::remove_file(directory.join("host-ready.node"));
    match outcome {
        Ok(()) => Ok(Some(child)),
        Err(error) => {
            stop_owned(&mut child, &identity);
            Err(error)
        }
    }
}

fn stop_owned(child: &mut std::process::Child, identity: &ProcessIdentity) {
    if identity.alive().unwrap_or(false) {
        unsafe {
            libc::kill(identity.pid as i32, libc::SIGTERM);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while child.try_wait().is_ok_and(|status| status.is_none()) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub(super) fn exec_failed(mut child: std::process::Child) {
    if let Ok(Some(identity)) = ProcessIdentity::read(child.id()) {
        stop_owned(&mut child, &identity);
    }
}
