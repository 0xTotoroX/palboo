// [INPUT]: 官方 GitHub Release 元数据、npm 已校验完整性的原生分发包和独立版本目录。
// [OUTPUT]: 检查更新、发出启动提醒、准备与验证固定版本；按已保存选择和活动进程清理历史版本。
// [POS]: 复用上游包，不调用会全局覆盖并重启 Codex 的上游 updater。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use super::{Options, executable, find_node, find_tool, output, version};
use crate::config::Paths;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
pub const BASELINE: &str = "0.10.2";
pub fn version_tuple(value: &str) -> Result<(u64, u64, u64)> {
    let parts: Vec<_> = value.split('.').collect();
    ensure!(
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())),
        "版本号无效"
    );
    Ok((parts[0].parse()?, parts[1].parse()?, parts[2].parse()?))
}
pub async fn check() -> Result<Value> {
    let release: Value = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("PALBOO")
        .build()?
        .get("https://api.github.com/repos/BytePioneer-AI/codex-host/releases/latest")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let version = release["tag_name"]
        .as_str()
        .context("官方版本信息无效")?
        .trim_start_matches('v');
    version_tuple(version)?;
    Ok(
        json!({"version":version,"url":format!("https://github.com/BytePioneer-AI/codex-host/releases/tag/v{version}")}),
    )
}
pub async fn notify(version: &str) -> Result<()> {
    let title = crate::i18n::text("CodexHost 有新版本", "CodexHost update available");
    let message = crate::i18n::text(
        "在 Palboo 的「兼容集成」中检查并安装更新。",
        "Check for updates in Compatibility integrations in Palboo.",
    );
    let script = r#"on run argv
        display notification (item 2 of argv) with title (item 1 of argv)
    end run"#;
    output(
        std::path::Path::new("/usr/bin/osascript"),
        &["-e", script, "--", &format!("{title} · {version}"), message],
        Duration::from_secs(5),
    )
    .await?;
    Ok(())
}
pub async fn install(paths: &Paths, requested: &str) -> Result<PathBuf> {
    ensure!(
        version_tuple(requested)? >= version_tuple(BASELINE)?,
        "安装版本不能低于 {BASELINE}"
    );
    let root = paths.root.join("codex-host-versions");
    std::fs::create_dir_all(&root)?;
    let target = root.join(requested);
    let relative = "node_modules/@codexhost/cli-darwin-arm64/bin/codexhost";
    if target.exists() {
        let path = target.join(relative);
        ensure!(
            version(&path).await? == requested,
            "已下载版本校验失败，原安装保持不变"
        );
        output(&path, &["inspect"], Duration::from_secs(10)).await?;
        return Ok(path);
    }
    let node = find_node().context("安装 CodexHost 需要 Node.js 22 或更新版本")?;
    let node_version = output(&node, &["--version"], Duration::from_secs(5)).await?;
    ensure!(
        version_tuple(node_version.trim_start_matches('v'))?.0 >= 22,
        "需要 Node.js 22 或更新版本"
    );
    let stage = tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(&root)?;
    let npm = find_tool("npm").context("未找到 npm，请先安装 Node.js")?;
    let npm = std::fs::canonicalize(npm)?;
    output(
        &node,
        &[
            npm.to_str().context("npm 路径无效")?,
            "install",
            "--prefix",
            stage.path().to_str().context("安装路径无效")?,
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
            &format!("@codexhost/cli-darwin-arm64@{requested}"),
        ],
        Duration::from_secs(180),
    )
    .await?;
    let path = stage.path().join(relative);
    ensure!(
        version(&path).await? == requested,
        "下载版本不一致，原安装保持不变"
    );
    output(&path, &["inspect"], Duration::from_secs(10))
        .await
        .context("新版本无法识别当前 Codex，原安装保持不变")?;
    std::fs::rename(stage.path(), &target).context("无法保存下载版本，原安装保持不变")?;
    Ok(target.join(relative))
}

pub(super) async fn cleanup(paths: &Paths, options: &Options) -> Result<()> {
    let root = paths.root.join("codex-host-versions");
    if !root.exists() {
        return Ok(());
    }
    // 更新只选择下次启动版本；旧启动器或控制器仍可能使用安装内的资源。
    let processes = output(
        std::path::Path::new("/bin/ps"),
        &["-axww", "-o", "comm=,args="],
        Duration::from_secs(5),
    )
    .await?;
    cleanup_with_processes(paths, options, &processes)
}

fn cleanup_with_processes(paths: &Paths, options: &Options, processes: &str) -> Result<()> {
    let root = paths.root.join("codex-host-versions");
    let metadata = std::fs::symlink_metadata(&root)?;
    ensure!(
        metadata.is_dir(),
        "CodexHost 版本目录不是普通目录，跳过清理"
    );
    let root = std::fs::canonicalize(root)?;
    let retained: Vec<_> = [executable(options), options.previous_executable.clone()]
        .into_iter()
        .flatten()
        .flat_map(|path| {
            let resolved = std::fs::canonicalize(&path).ok();
            std::iter::once(path).chain(resolved)
        })
        .collect();
    for entry in std::fs::read_dir(&root)? {
        let entry = entry?;
        let name = entry.file_name();
        if !entry.file_type()?.is_dir()
            || name
                .to_str()
                .is_none_or(|name| version_tuple(name).is_err())
        {
            continue;
        }
        let directory = entry.path();
        let original = paths.root.join("codex-host-versions").join(&name);
        if retained
            .iter()
            .any(|path| path.starts_with(&directory) || path.starts_with(&original))
            || [directory.as_path(), original.as_path()]
                .iter()
                .any(|path| processes.contains(&format!("{}/", path.display())))
        {
            continue;
        }
        std::fs::remove_dir_all(&directory).context("无法清理 CodexHost 历史版本")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn installation(paths: &Paths, version: &str) -> PathBuf {
        let executable = paths.root.join(format!(
            "codex-host-versions/{version}/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost"
        ));
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, []).unwrap();
        executable
    }

    #[test]
    fn cleanup_retains_selected_previous_and_running_until_next_pass() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let obsolete = installation(&paths, "0.10.2");
        let running = installation(&paths, "0.16.1");
        let previous = installation(&paths, "0.17.3");
        let selected = installation(&paths, "0.17.4");
        let options = Options {
            executable: Some(selected.clone()),
            previous_executable: Some(previous.clone()),
            ..Default::default()
        };
        let controller = running
            .parent()
            .unwrap()
            .join("../app/desktop-controller.mjs");
        cleanup_with_processes(&paths, &options, &format!("node {}", controller.display()))
            .unwrap();
        assert!(!obsolete.exists());
        assert!(running.exists());
        assert!(previous.exists());
        assert!(selected.exists());
        cleanup_with_processes(&paths, &options, "").unwrap();
        assert!(!running.exists());
        assert!(previous.exists());
        assert!(selected.exists());
    }

    #[test]
    fn cleanup_preserves_external_installs_symlinks_and_staging_directories() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().join("palboo"))).unwrap();
        let selected = installation(&paths, "0.17.4");
        let external = dir.path().join("external");
        std::fs::create_dir(&external).unwrap();
        let marker = external.join("keep");
        std::fs::write(&marker, "untouched").unwrap();
        let root = paths.root.join("codex-host-versions");
        symlink(&external, root.join("0.10.2")).unwrap();
        let stage = tempfile::Builder::new()
            .prefix("install-")
            .tempdir_in(&root)
            .unwrap();
        let unknown = root.join("custom");
        std::fs::create_dir(&unknown).unwrap();
        // 配置通过符号链接指向私有版本时也必须保留该版本。
        let alias = dir.path().join("selected");
        symlink(&selected, &alias).unwrap();
        cleanup_with_processes(
            &paths,
            &Options {
                executable: Some(alias),
                previous_executable: Some(marker.clone()),
                ..Default::default()
            },
            "",
        )
        .unwrap();
        assert!(selected.exists());
        assert!(marker.exists());
        assert!(root.join("0.10.2").is_symlink());
        assert!(stage.path().exists());
        assert!(unknown.exists());
    }

    #[test]
    fn cleanup_refuses_a_symlinked_versions_root() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().join("palboo"))).unwrap();
        let external = dir.path().join("external");
        std::fs::create_dir_all(external.join("0.10.2")).unwrap();
        symlink(&external, paths.root.join("codex-host-versions")).unwrap();
        assert!(cleanup_with_processes(&paths, &Options::default(), "").is_err());
        assert!(external.join("0.10.2").exists());
    }

    #[tokio::test]
    async fn cleanup_protects_a_real_running_executable() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().into())).unwrap();
        let running = installation(&paths, "0.16.1");
        std::fs::copy("/bin/sleep", &running).unwrap();
        let mut child = tokio::process::Command::new(&running)
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        // exec 完成后再采样进程列表。
        tokio::time::sleep(Duration::from_millis(50)).await;
        cleanup(&paths, &Options::default()).await.unwrap();
        assert!(running.exists());
        child.kill().await.unwrap();
        child.wait().await.unwrap();
        cleanup(&paths, &Options::default()).await.unwrap();
        assert!(!running.exists());
    }
}
