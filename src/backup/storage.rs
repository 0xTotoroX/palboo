// [INPUT]: Validated target-local files, exclusive service lock and expected snapshot identity.
// [OUTPUT]: Durable before-image, multi-file commit, crash rollback and last-operation undo.
// [POS]: Local transaction storage; never copies runtime leases or follows links.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::config::{Paths, write_private};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recovery {
    pub id: String,
    pub before: BTreeMap<String, Option<String>>,
    pub after: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_latest: Option<String>,
}
fn sync_directory(path: &Path) -> Result<()> {
    std::fs::File::open(path)?.sync_all()?;
    Ok(())
}
fn restore_latest(paths: &Paths, recovery: &Recovery) -> Result<()> {
    let latest = directory(&paths.root, "backups/latest.json")?;
    if let Some(previous) = &recovery.previous_latest {
        write_private(&latest, &super::archive::unbase64(previous)?)?;
    } else if latest.exists() {
        std::fs::remove_file(&latest)?;
    }
    sync_directory(latest.parent().unwrap())
}
fn owned(path: &str) -> Result<()> {
    if super::snapshot::FILES.contains(&path) {
        return Ok(());
    }
    super::snapshot::check_attachment(path)
}
fn directory(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut dir = root.to_path_buf();
    for part in Path::new(relative)
        .parent()
        .context("文件路径无效")?
        .components()
    {
        let std::path::Component::Normal(part) = part else {
            anyhow::bail!("备份路径无效");
        };
        dir.push(part);
        if dir.exists() {
            ensure!(
                !std::fs::symlink_metadata(&dir)?.file_type().is_symlink() && dir.is_dir(),
                "备份目录不能是链接"
            );
        } else {
            std::fs::create_dir(&dir)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(root.join(relative))
}
fn restore(paths: &Paths, recovery: &Recovery) -> Result<()> {
    for (name, bytes) in &recovery.before {
        owned(name)?;
        let path = directory(&paths.root, name)?;
        if let Some(bytes) = bytes {
            write_private(&path, &super::archive::unbase64(bytes)?)?;
        } else if path.exists() {
            ensure!(
                !std::fs::symlink_metadata(&path)?.file_type().is_symlink(),
                "恢复目标不能是链接"
            );
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}
pub fn recover(paths: &Paths) -> Result<()> {
    let journal = paths.root.join("backup-transaction.json");
    if !journal.exists() {
        return Ok(());
    }
    let recovery: Recovery = serde_json::from_slice(&std::fs::read(&journal)?)?;
    restore(paths, &recovery).context("未完成的恢复无法回退，已保留恢复记录")?;
    restore_latest(paths, &recovery)?;
    std::fs::remove_file(journal)?;
    sync_directory(&paths.root)?;
    Ok(())
}
pub fn latest(paths: &Paths) -> Result<Option<Recovery>> {
    let file = paths.root.join("backups/latest.json");
    if !file.exists() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&std::fs::read(file)?)?))
}
pub fn commit(paths: &Paths, files: &BTreeMap<String, Option<Vec<u8>>>) -> Result<String> {
    recover(paths)?;
    let mut recovery = Recovery {
        id: uuid::Uuid::new_v4().simple().to_string(),
        before: BTreeMap::new(),
        after: BTreeMap::new(),
        previous_latest: None,
    };
    for (name, bytes) in files {
        owned(name)?;
        directory(&paths.root, name)?;
        recovery.before.insert(
            name.clone(),
            super::snapshot::read(&paths.root, name)?.map(|b| super::archive::base64(&b)),
        );
        recovery
            .after
            .insert(name.clone(), file_fingerprint(name, bytes.as_deref())?);
    }
    let bytes = serde_json::to_vec(&recovery)?;
    let backup = format!("backups/{}.json", recovery.id);
    write_private(&directory(&paths.root, &backup)?, &bytes)?;
    sync_directory(&paths.root.join("backups"))?;
    let journal = paths.root.join("backup-transaction.json");
    recovery.previous_latest = super::snapshot::read(&paths.root, "backups/latest.json")?
        .map(|bytes| super::archive::base64(&bytes));
    write_private(&journal, &serde_json::to_vec(&recovery)?)?;
    sync_directory(&paths.root)?;
    let result = (|| -> Result<()> {
        for (name, bytes) in files {
            if let Some(bytes) = bytes {
                write_private(&paths.root.join(name), bytes)?;
            } else if paths.root.join(name).exists() {
                std::fs::remove_file(paths.root.join(name))?;
            }
            sync_directory(paths.root.join(name).parent().unwrap())?;
        }
        write_private(&directory(&paths.root, "backups/latest.json")?, &bytes)?;
        sync_directory(&paths.root.join("backups"))?;
        // A surviving journal always means roll back, including a crash after the final file.
        std::fs::remove_file(&journal)?;
        sync_directory(&paths.root)?;
        Ok(())
    })();
    if let Err(error) = result {
        restore(paths, &recovery).context("恢复失败且回退未完成，请保留恢复记录")?;
        restore_latest(paths, &recovery)?;
        std::fs::remove_file(journal)?;
        return Err(error.context("恢复失败，已回退原配置"));
    }
    Ok(recovery.id)
}
pub fn undo_files(paths: &Paths) -> Result<BTreeMap<String, Option<Vec<u8>>>> {
    let recovery = latest(paths)?.context("没有可恢复的上次操作")?;
    let mut out = BTreeMap::new();
    for (name, bytes) in recovery.before {
        owned(&name)?;
        let current = super::snapshot::read(&paths.root, &name)?;
        ensure!(
            recovery.after.get(&name) == Some(&file_fingerprint(&name, current.as_deref())?),
            "上次操作后配置已有更改，请使用备份文件选择性恢复"
        );
        // Missing original files are restored to their pre-operation effective defaults by the caller.
        if let Some(bytes) = bytes {
            out.insert(name, Some(super::archive::unbase64(&bytes)?));
        } else {
            out.insert(name, None);
        }
    }
    Ok(out)
}

// Runtime transitions may update revisions/open state; genuine preference edits still invalidate undo.
pub fn file_fingerprint(name: &str, bytes: Option<&[u8]>) -> Result<String> {
    let Some(bytes) = bytes else {
        return Ok("missing".into());
    };
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return Ok(super::digest(bytes));
    };
    if let Some(object) = value.as_object_mut() {
        for key in ["revision", "webRevision"] {
            object.remove(key);
        }
    }
    if name == "panel.json" {
        if let Some(object) = value.as_object_mut() {
            for key in ["detached", "returnOpen"] {
                object.remove(key);
            }
        }
        if let Some(object) = value["ui"].as_object_mut() {
            for key in ["open", "dockOpen", "activeTab"] {
                object.remove(key);
            }
        }
    }
    if name == "features.json" {
        if let Some(object) = value["main"].as_object_mut() {
            object.remove("layoutPresetsRevision");
        }
        if let Some(object) = value["features"].as_object_mut() {
            for item in object.values_mut() {
                if let Some(item) = item.as_object_mut() {
                    item.remove("open");
                }
            }
        }
    }
    Ok(super::digest(&serde_json::to_vec(&value)?))
}
