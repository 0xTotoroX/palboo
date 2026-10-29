// [INPUT]: 已核验的宿主程序、调试端口与系统 LaunchServices/进程状态。
// [OUTPUT]: 完整 App 启动与包路径识别；仅对 -600 有限重试，出现新实例即交由调用方核验连接。
// [POS]: lifecycle 的宿主启动边界；不退出宿主、不绕过 App 身份，不重置系统服务。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::host::desktop_process;
use anyhow::{Context, Result};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

pub(crate) fn bundled_application(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app"
        && contents.join("Info.plist").is_file())
    .then(|| app.to_path_buf())
}

pub(crate) async fn launch_desktop(
    executable: &Path,
    port: u16,
    profile: Option<&Path>,
) -> Result<()> {
    let executable = executable.canonicalize().context("桌面程序路径无效")?;
    let application = bundled_application(&executable);
    let mut command = if let Some(app) = &application {
        // 直接 spawn App 内部程序会继承启动器的 TCC 身份；由系统启动完整 App。
        // 普通启动不使用 -n，避免与用户同时打开应用时创建第二个实例。
        let mut command = Command::new("/usr/bin/open");
        command.arg("-a").arg(app);
        if profile.is_some() {
            command.arg("-n");
        }
        command.arg("--args");
        command
    } else {
        // 保留显式 --app 指定独立可执行文件的既有用法。
        Command::new(&executable)
    };
    command.args([
        "--remote-debugging-address=127.0.0.1",
        &format!("--remote-debugging-port={port}"),
    ]);
    if let Some(profile) = profile {
        command.arg(format!("--user-data-dir={}", profile.display()));
    }
    command.stdin(Stdio::null()).stdout(Stdio::null());
    if application.is_some() {
        let mut command = tokio::process::Command::from(command);
        command.stderr(Stdio::piped()).kill_on_drop(true);
        open_application(
            &mut command,
            || desktop_process(&executable).map(|pid| pid.is_some()),
            profile.is_none(),
            Duration::from_millis(750),
        )
        .await?;
    } else {
        use std::os::unix::process::CommandExt;
        command.stderr(Stdio::null());
        command.process_group(0);
        command.spawn().context("无法启动桌面 Codex")?;
    }
    Ok(())
}

async fn open_application(
    command: &mut tokio::process::Command,
    mut is_running: impl FnMut() -> Result<bool>,
    retry_missing_process: bool,
    retry_delay: Duration,
) -> Result<()> {
    for attempt in 0..3 {
        let output = tokio::time::timeout(Duration::from_secs(10), command.output())
            .await
            .context("系统启动 Codex 超时；未尝试其他启动方式")??;
        if output.status.success() {
            return Ok(());
        }
        let message = String::from_utf8_lossy(&output.stderr);
        let message = message.trim();
        let process_missing = message.contains("procNotFound")
            || message
                .split(|c: char| c != '-' && !c.is_ascii_digit())
                .any(|code| code == "-600");
        anyhow::ensure!(
            retry_missing_process && process_missing,
            "系统无法打开 Codex：{message}"
        );
        // 主进程先退出，LaunchServices 可能稍后才清理应用记录。
        // 一旦出现新实例就停止 open，由 lifecycle 核验实际调试连接。
        if is_running()? {
            return Ok(());
        }
        anyhow::ensure!(attempt < 2, "系统无法打开 Codex：{message}");
        tokio::time::sleep(retry_delay * (attempt + 1)).await;
        if is_running()? {
            return Ok(());
        }
    }
    unreachable!("the final failed attempt returns its original launch error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn open_fixture(directory: &Path, failures: u32, message: &str) -> tokio::process::Command {
        let mut command = tokio::process::Command::new("/bin/sh");
        command
            .args([
                "-c",
                r#"
count=0
if [ -f "$1" ]; then read -r count < "$1"; fi
count=$((count + 1))
printf '%s\n' "$count" > "$1"
if [ "$count" -le "$2" ]; then printf '%s\n' "$3" >&2; exit 1; fi
"#,
                "launch-fixture",
            ])
            .arg(directory.join("attempts"))
            .arg(failures.to_string())
            .arg(message)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    fn attempts(directory: &Path) -> u32 {
        std::fs::read_to_string(directory.join("attempts"))
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    const MISSING: &str = "_LSOpenURLsWithCompletionHandler() failed for the application /Fixture.app with error -600.";

    #[tokio::test]
    async fn retries_stale_launch_services_record_with_a_bound() {
        for failures in 0..=3 {
            let directory = tempfile::tempdir().unwrap();
            let mut command = open_fixture(directory.path(), failures, MISSING);
            let result = open_application(&mut command, || Ok(false), true, Duration::ZERO).await;
            assert_eq!(attempts(directory.path()), (failures + 1).min(3));
            if failures < 3 {
                result.unwrap();
            } else {
                assert_eq!(
                    result.unwrap_err().to_string(),
                    format!("系统无法打开 Codex：{MISSING}")
                );
            }
        }
    }

    #[tokio::test]
    async fn stops_reopening_when_a_host_appears_before_or_during_the_wait() {
        for appears_at in [1, 2] {
            let directory = tempfile::tempdir().unwrap();
            let mut command = open_fixture(directory.path(), 3, MISSING);
            let checks = Cell::new(0);
            open_application(
                &mut command,
                || {
                    checks.set(checks.get() + 1);
                    Ok(checks.get() == appears_at)
                },
                true,
                Duration::ZERO,
            )
            .await
            .unwrap();
            assert_eq!(checks.get(), appears_at);
            assert_eq!(attempts(directory.path()), 1);
        }
    }

    #[tokio::test]
    async fn preserves_other_errors_and_does_not_retry_isolated_profiles() {
        for (message, retry) in [
            ("permission denied (-54)", true),
            ("error -6000.", true),
            (MISSING, false),
        ] {
            let directory = tempfile::tempdir().unwrap();
            let mut command = open_fixture(directory.path(), 3, message);
            let error = open_application(
                &mut command,
                || panic!("must not inspect or reuse another instance"),
                retry,
                Duration::ZERO,
            )
            .await
            .unwrap_err();
            assert_eq!(error.to_string(), format!("系统无法打开 Codex：{message}"));
            assert_eq!(attempts(directory.path()), 1);
        }
    }

    #[tokio::test]
    async fn stops_when_process_identity_cannot_be_verified() {
        let directory = tempfile::tempdir().unwrap();
        let mut command = open_fixture(directory.path(), 3, MISSING);
        let error = open_application(
            &mut command,
            || anyhow::bail!("ambiguous host identity"),
            true,
            Duration::ZERO,
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "ambiguous host identity");
        assert_eq!(attempts(directory.path()), 1);
    }
}
