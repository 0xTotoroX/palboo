// [INPUT]: Registered launcher paths, current data root and Git's local worktree inventory.
// [OUTPUT]: Explicit local transfer targets with stable identities and known application versions.
// [POS]: Discovery only; never switches App mode, starts a host or migrates data directories.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::config::Paths;
use anyhow::{Context, Result};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub label: String,
    pub path: PathBuf,
    pub version: Option<String>,
    pub current: bool,
}
fn package_version(path: &Path) -> Option<String> {
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path.join("package.json")).ok()?).ok()?;
    value["version"].as_str().map(str::to_owned)
}
pub fn list(paths: &Paths) -> Result<Vec<Target>> {
    let mut targets = vec![Target {
        id: "current".into(),
        label: "当前运行环境".into(),
        path: paths.root.clone(),
        version: Some(crate::config::VERSION.into()),
        current: true,
    }];
    let mut seen = BTreeSet::from([paths.root.clone()]);
    let control = crate::app_mode::read(&crate::app_mode::shared_paths()?)?;
    let release = control
        .release_data
        .or_else(|| dirs::data_local_dir().map(|p| p.join("palboo")));
    let release_version = control.executable.as_ref().and_then(|executable| {
        let output = std::process::Command::new(executable)
            .arg("--version")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8(output.stdout).ok()?;
        text.split_whitespace()
            .find(|part| semver::Version::parse(part).is_ok())
            .map(str::to_owned)
    });
    let mut add = |path: PathBuf, label: String, version: Option<String>| {
        if let Ok(path) = path.canonicalize()
            && path.is_dir()
            && seen.insert(path.clone())
        {
            targets.push(Target {
                id: super::digest(path.to_string_lossy().as_bytes()),
                label,
                path,
                version,
                current: false,
            });
        }
    };
    if let Some(path) = release {
        add(path, "正式版".into(), release_version);
    }
    if let Some(source) = control.source {
        let mut sources = vec![source.clone()];
        if let Ok(output) = std::process::Command::new("git")
            .arg("-C")
            .arg(&source)
            .args(["worktree", "list", "--porcelain", "-z"])
            .output()
            && output.status.success()
        {
            for field in output.stdout.split(|b| *b == 0) {
                if let Ok(field) = std::str::from_utf8(field)
                    && let Some(path) = field.strip_prefix("worktree ")
                {
                    sources.push(path.into());
                }
            }
        }
        for source in sources {
            let label = format!(
                "开发版 · {}",
                source.file_name().unwrap_or_default().to_string_lossy()
            );
            add(
                source.join("target/dev/real"),
                label,
                package_version(&source),
            );
        }
    }
    Ok(targets)
}
pub fn find(paths: &Paths, id: &str) -> Result<Target> {
    list(paths)?
        .into_iter()
        .find(|t| t.id == id)
        .context("目标来源已变化，请刷新后重选")
}
