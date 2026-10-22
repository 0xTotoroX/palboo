// [INPUT]: PALBOO environment variables and the previous product data directory.
// [OUTPUT]: Legacy environment fallback and locked, reversible default-directory migration.
// [POS]: Product identity compatibility; never changes CODEX_HOME or business data.
// [PROTOCOL]: Keep src/AGENTS.md and installation guidance in sync.
use anyhow::{Context, Result, bail};
use fs2::FileExt;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

pub fn env_os(name: &str) -> Option<OsString> {
    let normalized = name
        .strip_prefix("CODEX_BUDDY_")
        .map(|suffix| format!("PALBOO_{suffix}"));
    let name = normalized.as_deref().unwrap_or(name);
    std::env::var_os(name).or_else(|| {
        name.strip_prefix("PALBOO_")
            .and_then(|suffix| std::env::var_os(format!("CODEX_BUDDY_{suffix}")))
    })
}

pub fn env(name: &str) -> std::result::Result<String, std::env::VarError> {
    env_os(name)
        .ok_or(std::env::VarError::NotPresent)?
        .into_string()
        .map_err(std::env::VarError::NotUnicode)
}

pub fn default_directory(parent: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(parent)?;
    let guard = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(parent.join(".palboo-migration.lock"))?;
    guard.lock_exclusive()?;
    let target = parent.join("palboo");
    let candidates = ["codex-buddy", "codex-companion"]
        .map(|name| parent.join(name))
        .into_iter()
        .filter(|path| path.exists())
        .collect::<Vec<_>>();
    let independent = candidates
        .iter()
        .filter(|path| {
            !target.exists()
                || std::fs::canonicalize(path).ok() != std::fs::canonicalize(&target).ok()
        })
        .collect::<Vec<_>>();
    if independent.is_empty() {
        return Ok(target);
    }
    if target.exists() || independent.len() > 1 {
        bail!("发现多份独立应用数据，未合并或覆盖。请用 --data-dir 指定要使用的目录后处理迁移。");
    }
    let source = independent[0];
    let service = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(source.join("service.lock"))?;
    service
        .try_lock_exclusive()
        .context("旧版辅助程序仍在运行，请先正常停止旧版再迁移；无需退出 ChatGPT")?;
    std::fs::rename(source, &target).context("无法迁移旧数据目录，原数据保留")?;
    // The alias keeps an old launcher from creating a second, empty database.
    if let Err(error) = std::os::unix::fs::symlink(&target, source) {
        std::fs::rename(&target, source).context("创建兼容入口失败，自动恢复旧目录也失败")?;
        return Err(error).context("创建旧数据路径兼容入口失败，已恢复旧目录");
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_preserves_bytes_and_old_path_and_is_repeatable() {
        let parent = tempfile::tempdir().unwrap();
        let old = parent.path().join("codex-buddy");
        std::fs::create_dir(&old).unwrap();
        let bytes = b"{\"private\":\"fixture\",\"unknown\":{\"preserve\":true}}";
        std::fs::write(old.join("config.json"), bytes).unwrap();
        let new = default_directory(parent.path()).unwrap();
        assert_eq!(new.file_name().unwrap(), "palboo");
        assert_eq!(std::fs::read(new.join("config.json")).unwrap(), bytes);
        assert_eq!(
            std::fs::canonicalize(old).unwrap(),
            std::fs::canonicalize(&new).unwrap()
        );
        assert_eq!(default_directory(parent.path()).unwrap(), new);
    }

    #[test]
    fn migration_refuses_a_live_service_or_two_independent_directories() {
        let parent = tempfile::tempdir().unwrap();
        let old = parent.path().join("codex-buddy");
        std::fs::create_dir(&old).unwrap();
        let held = std::fs::File::create(old.join("service.lock")).unwrap();
        held.lock_exclusive().unwrap();
        assert!(default_directory(parent.path()).is_err());
        assert!(old.exists());
        drop(held);
        std::fs::create_dir(parent.path().join("palboo")).unwrap();
        assert!(default_directory(parent.path()).is_err());
        assert!(old.exists());
    }
}
