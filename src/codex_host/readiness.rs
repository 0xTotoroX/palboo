// [INPUT]: 已核验的 CodexHost 运行身份与官方私有界面状态。
// [OUTPUT]: wait；App 的启动成功须等待本次 Controller 实际安装界面。
// [POS]: 启动反馈就绪门槛，不把 launcher ready 当作界面成功，不修复或删除官方记录。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::Running;
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    time::Duration,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    schema_version: u8,
    pid: u32,
    started_at: u64,
    renderer: Renderer,
}
#[derive(Deserialize)]
struct Renderer {
    state: String,
}

fn read(path: &Path) -> Result<Status> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file()
            && metadata.len() <= 16_384
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.mode() & 0o077 == 0,
        "界面状态不可用"
    );
    let mut bytes = Vec::new();
    file.take(16_385).read_to_end(&mut bytes)?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn installed(expected: &Running) -> Result<bool> {
    let root = dirs::data_local_dir()
        .context("应用数据目录不可用")?
        .join("codexhost");
    let descriptor: super::Descriptor =
        serde_json::from_slice(&std::fs::read(root.join("desktop-runtime-v1.json"))?)?;
    let file = dirs::home_dir()
        .context("用户目录不可用")?
        .join(".codexhost/diagnostics/desktop-controller-v1.json");
    installed_at(expected, &descriptor, &file).await
}

async fn installed_at(
    expected: &Running,
    descriptor: &super::Descriptor,
    file: &Path,
) -> Result<bool> {
    ensure!(
        descriptor.schema_version == 1 && descriptor.launcher_pid == expected.pid,
        "CodexHost 实例已变化"
    );
    let status = read(file)?;
    if status.schema_version != 1 || status.renderer.state != "installed" {
        return Ok(false);
    }
    let Some(process) = crate::host::ProcessIdentity::read(status.pid)? else {
        return Ok(false);
    };
    if process
        .parent()?
        .is_none_or(|parent| parent.pid != expected.pid)
    {
        return Ok(false);
    }
    // 官方 startedAt 为控制器初始化时间，排除 PID 复用和其他 Controller 的旧文件。
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis() as u64;
    if status.started_at.saturating_add(1000) < process.started_at_micros / 1000
        || status.started_at > now.saturating_add(1000)
    {
        return Ok(false);
    }
    let listeners = crate::host::listening_pids(descriptor.control_port).await?;
    Ok(listeners.len() == 1 && listeners.contains(&status.pid))
}

pub async fn wait(paths: &crate::config::Paths) -> Result<()> {
    let options = paths.load()?;
    if !options.performance.integration_enabled || !options.codex_host.enabled {
        return Ok(());
    }
    let Some(expected) = super::running().await? else {
        anyhow::bail!("Codex 已打开，但 CodexHost 尚未连接");
    };
    // 旧版本保持原启动契约；该状态格式由当前已支持的 0.18 起明确校验。
    if super::update::version_tuple(&super::version(&expected.executable).await?)? < (0, 18, 0) {
        return Ok(());
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    loop {
        if installed(&expected).await.unwrap_or(false) {
            return Ok(());
        }
        crate::startup::phase("renderer");
        ensure!(
            tokio::time::Instant::now() < deadline,
            "Codex 已打开，但 CodexHost 界面尚未连接。当前会话已保留，可以稍后重试。"
        );
        ensure!(
            super::running().await?.as_ref() == Some(&expected),
            "CodexHost 实例已变化，请重新打开 Palboo"
        );
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
    };

    #[tokio::test]
    async fn renderer_success_requires_current_process_parent_and_control_listener() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("controller");
        let process = crate::host::ProcessIdentity::read(std::process::id())
            .unwrap()
            .unwrap();
        let parent = process.parent().unwrap().unwrap();
        let expected = Running {
            pid: parent.pid,
            executable: parent.executable,
        };
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut descriptor = super::super::Descriptor {
            schema_version: 1,
            launcher_pid: expected.pid,
            control_port: listener.local_addr().unwrap().port(),
            nonce: "0".repeat(32),
        };
        let write = |state: &str, pid: u32, at: u64| {
            crate::config::write_private(&file, &serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"pid":pid,"startedAt":at,"renderer":{"state":state}})).unwrap()).unwrap();
        };
        let at = process.started_at_micros / 1000;
        for state in ["installing", "unavailable", "compatible"] {
            write(state, process.pid, at);
            assert!(!installed_at(&expected, &descriptor, &file).await.unwrap());
        }
        write("installed", process.pid, at);
        assert!(installed_at(&expected, &descriptor, &file).await.unwrap());
        write("installed", process.pid, at.saturating_sub(2000));
        assert!(!installed_at(&expected, &descriptor, &file).await.unwrap());
        write("installed", process.pid, u64::MAX);
        assert!(!installed_at(&expected, &descriptor, &file).await.unwrap());
        write("installed", parent.pid, at);
        assert!(!installed_at(&expected, &descriptor, &file).await.unwrap());
        write("installed", process.pid, at);
        descriptor.launcher_pid += 1;
        assert!(installed_at(&expected, &descriptor, &file).await.is_err());
        descriptor.launcher_pid = expected.pid;
        drop(listener);
        assert!(
            !installed_at(&expected, &descriptor, &file)
                .await
                .unwrap_or(false)
        );
    }

    #[tokio::test]
    #[ignore = "explicit read-only acceptance against the current native CodexHost"]
    async fn current_controller_is_installed() {
        let expected = super::super::running()
            .await
            .unwrap()
            .expect("CodexHost must already be running");
        assert!(installed(&expected).await.unwrap());
    }
    #[test]
    fn status_requires_private_regular_file_and_does_not_accept_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("status");
        fs::write(
            &file,
            br#"{"schemaVersion":1,"pid":123,"startedAt":42,"renderer":{"state":"installed"}}"#,
        )
        .unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read(&file).unwrap().renderer.state, "installed");
        let link = dir.path().join("link");
        symlink(&file, &link).unwrap();
        assert!(read(&link).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read(&file).is_err());
    }
}
