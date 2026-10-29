// [INPUT]: 已校验的 DMG、完整 App 目录和 macOS 文件/签名工具。
// [OUTPUT]: AppIdentity、Prepared、inspect、prepare；同卷原子交换及可恢复旧 App。
// [POS]: 更新器的本机安装边界，不读取业务配置、不启动宿主。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::CString,
    os::unix::{ffi::OsStrExt, fs::MetadataExt},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub path: PathBuf,
    pub version: String,
    device: u64,
    inode: u64,
    modified: i64,
    modified_nanos: i64,
}
pub async fn output(mut command: Command) -> Result<String> {
    command.kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .context("安装工具响应超时")??;
    ensure!(
        result.status.success(),
        "安装工具执行失败：{}",
        String::from_utf8_lossy(&result.stderr).trim()
    );
    Ok(String::from_utf8(result.stdout)?)
}
pub async fn inspect(path: &Path) -> Result<AppIdentity> {
    ensure!(
        !std::fs::symlink_metadata(path)?.file_type().is_symlink(),
        "App 位置是符号链接，请使用完整 App 的实际位置"
    );
    let path = path.canonicalize()?;
    let contents = path.join("Contents");
    let mut command = Command::new("/usr/bin/plutil");
    command
        .args(["-convert", "json", "-o", "-"])
        .arg(contents.join("Info.plist"));
    let info: Value = serde_json::from_str(&output(command).await?)?;
    ensure!(
        info["CFBundleIdentifier"] == "local.palboo.launcher"
            && info["CFBundleExecutable"] == "PalbooLauncher",
        "目标不是完整 Palboo.app"
    );
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(contents.join("Resources/manifest.json"))?)?;
    ensure!(
        manifest["name"] == "palboo"
            && manifest["arch"] == "arm64"
            && manifest["platform"] == "darwin",
        "App 分发信息无效"
    );
    let version = manifest["version"]
        .as_str()
        .context("App 版本信息无效")?
        .to_owned();
    let parsed = semver::Version::parse(&version)?;
    ensure!(
        info["CFBundleShortVersionString"]
            == format!("{}.{}.{}", parsed.major, parsed.minor, parsed.patch),
        "App 版本信息不一致"
    );
    let meta = std::fs::metadata(contents.join("MacOS/palboo"))?;
    Ok(AppIdentity {
        path,
        version,
        device: meta.dev(),
        inode: meta.ino(),
        modified: meta.mtime(),
        modified_nanos: meta.mtime_nsec(),
    })
}
pub fn writable(app: &Path) -> bool {
    if app.to_string_lossy().contains("/AppTranslocation/") {
        return false;
    }
    let Some(parent) = app.parent() else {
        return false;
    };
    let Ok(path) = CString::new(parent.as_os_str().as_bytes()) else {
        return false;
    };
    // 仅检查当前用户权限；不安装提权服务或自动请求管理员权限。
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}
fn safe_contents(root: &Path, current: &Path) -> Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            ensure!(
                entry.path().canonicalize()?.starts_with(root),
                "App 包含指向包外的链接"
            );
        } else if metadata.is_dir() {
            safe_contents(root, &entry.path())?;
        } else {
            ensure!(metadata.is_file(), "App 包含不支持的文件类型");
        }
    }
    Ok(())
}
pub async fn validate(app: &Path, expected: &str) -> Result<()> {
    let root = app.canonicalize()?;
    safe_contents(&root, &root)?;
    ensure!(
        inspect(app).await?.version == expected,
        "下载 App 版本与更新信息不符"
    );
    let mut command = Command::new("/usr/bin/codesign");
    command.args(["--verify", "--deep", "--strict"]).arg(app);
    output(command).await.context("App 签名校验失败")?;
    let contents = app.join("Contents");
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(contents.join("Resources/manifest.json"))?)?;
    let files = manifest["files"]
        .as_object()
        .context("App 缺少包内校验信息")?;
    ensure!(files.contains_key("MacOS/palboo"), "App 缺少程序校验值");
    for (path, digest) in files {
        ensure!(
            Path::new(path)
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_))),
            "App 校验路径无效"
        );
        ensure!(
            digest.as_str()
                == Some(
                    format!("{:x}", Sha256::digest(std::fs::read(contents.join(path))?)).as_str()
                ),
            "App 包内校验失败"
        );
    }
    let mut command = Command::new(contents.join("MacOS/PalbooLauncher"));
    command.arg("--check");
    ensure!(
        output(command).await?.trim() == format!("palboo {expected}"),
        "新 App 无法在当前系统运行，原 App 保持不变"
    );
    Ok(())
}

pub struct Prepared {
    // 保留到新程序就绪；失败原子交换回来，成功保留上一版供恢复。
    stage: Option<tempfile::TempDir>,
    pub next: PathBuf,
    pub target: PathBuf,
    swapped: bool,
}
pub async fn prepare(dmg: &Path, current: &AppIdentity, version: &str) -> Result<Prepared> {
    let stage = tempfile::Builder::new()
        .prefix(".palboo-update-")
        .tempdir_in(current.path.parent().context("App 位置无效")?)
        .context("App 所在位置不可写，请将完整 App 移到可写位置后重试")?;
    let mount = tempfile::Builder::new().prefix("mount-").tempdir()?;
    let mut command = Command::new("/usr/bin/hdiutil");
    command.arg("verify").arg(dmg);
    output(command).await?;
    let mut command = Command::new("/usr/bin/hdiutil");
    command
        .args([
            "attach",
            "-readonly",
            "-nobrowse",
            "-noautoopen",
            "-mountpoint",
        ])
        .arg(mount.path())
        .arg(dmg);
    output(command).await?;
    let next = stage.path().join("Palboo.app");
    let result = async {
        let source = mount.path().join("Palboo.app");
        validate(&source, version).await?;
        let mut command = Command::new("/usr/bin/ditto");
        command.arg(&source).arg(&next);
        output(command).await?;
        validate(&next, version).await
    }
    .await;
    let mut command = Command::new("/usr/bin/hdiutil");
    command.arg("detach").arg(mount.path());
    let detached = output(command).await;
    result?;
    detached?;
    crate::config::write_private(
        &stage.path().join("owner.json"),
        &serde_json::to_vec(
            &serde_json::json!({"application":"local.palboo.launcher","target":current.path}),
        )?,
    )?;
    Ok(Prepared {
        stage: Some(stage),
        next,
        target: current.path.clone(),
        swapped: false,
    })
}
fn swap(left: &Path, right: &Path) -> Result<()> {
    let left = CString::new(left.as_os_str().as_bytes())?;
    let right = CString::new(right.as_os_str().as_bytes())?;
    // 同卷交换保证安装路径一直存在；不支持时拒绝，不降级为先删除旧 App。
    let result = unsafe { libc::renamex_np(left.as_ptr(), right.as_ptr(), libc::RENAME_SWAP) };
    ensure!(
        result == 0,
        "无法原子替换 App：{}",
        std::io::Error::last_os_error()
    );
    Ok(())
}
impl Prepared {
    #[cfg(test)]
    pub(super) fn fixture(target: &Path, candidate: &Path) -> Self {
        let stage = tempfile::Builder::new()
            .prefix(".palboo-update-")
            .tempdir_in(target.parent().unwrap())
            .unwrap();
        let next = stage.path().join("Palboo.app");
        std::fs::rename(candidate, &next).unwrap();
        crate::config::write_private(
            &stage.path().join("owner.json"),
            &serde_json::to_vec(
                &serde_json::json!({"application":"local.palboo.launcher","target":target}),
            )
            .unwrap(),
        )
        .unwrap();
        Self {
            stage: Some(stage),
            next,
            target: target.to_owned(),
            swapped: false,
        }
    }
    pub fn previous_path(&self) -> &Path {
        if self.swapped {
            &self.next
        } else {
            &self.target
        }
    }
    pub fn activate(&mut self) -> Result<()> {
        ensure!(!self.swapped, "更新已经安装");
        swap(&self.target, &self.next)?;
        self.swapped = true;
        Ok(())
    }
    pub fn rollback(&mut self) -> Result<()> {
        if self.swapped {
            swap(&self.target, &self.next)?;
            self.swapped = false;
        }
        Ok(())
    }
    pub fn keep_previous(&mut self) -> PathBuf {
        if let Some(stage) = self.stage.take() {
            let _ = stage.keep();
        }
        self.next.clone()
    }
}
pub fn clean_previous(record: &Value, app: &Path, kept: &Path) {
    let clean = || -> Result<()> {
        ensure!(
            record["phase"] == "done" && record["app"].as_str() == app.to_str(),
            "非本安装的备份"
        );
        let previous = Path::new(record["previousApp"].as_str().context("无备份")?);
        let parent = previous.parent().context("备份路径无效")?;
        ensure!(
            previous != kept
                && previous.file_name() == Some(std::ffi::OsStr::new("Palboo.app"))
                && parent.parent() == app.parent()
                && parent
                    .file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with(".palboo-update-")),
            "非更新器备份目录"
        );
        ensure!(
            !std::fs::symlink_metadata(parent)?.file_type().is_symlink(),
            "备份目录已改变"
        );
        let owner: Value = serde_json::from_slice(&std::fs::read(parent.join("owner.json"))?)?;
        ensure!(
            owner["application"] == "local.palboo.launcher"
                && owner["target"].as_str() == app.to_str(),
            "备份归属不符"
        );
        for entry in std::fs::read_dir(parent)? {
            ensure!(
                matches!(
                    entry?.file_name().to_str(),
                    Some("Palboo.app" | "owner.json")
                ),
                "备份目录包含其他内容"
            );
        }
        std::fs::remove_dir_all(parent)?;
        Ok(())
    };
    // 只清理被新备份替代且归属明确的上一轮副本；无法确认时保留。
    let _ = clean();
}
impl Drop for Prepared {
    fn drop(&mut self) {
        if self.swapped && self.stage.is_some() {
            // 异常退出路径优先保留上一版；不能让 TempDir 删除唯一恢复副本。
            self.keep_previous();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_bundle_swap_and_rollback_preserve_siblings() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("Palboo.app");
        std::fs::create_dir(&app).unwrap();
        std::fs::write(app.join("version"), "old").unwrap();
        std::fs::write(root.path().join("data"), "untouched").unwrap();
        let stage = tempfile::tempdir_in(root.path()).unwrap();
        let next = stage.path().join("Palboo.app");
        std::fs::create_dir(&next).unwrap();
        std::fs::write(next.join("version"), "new").unwrap();
        let mut update = Prepared {
            stage: Some(stage),
            target: app.clone(),
            next,
            swapped: false,
        };
        update.activate().unwrap();
        assert_eq!(std::fs::read_to_string(app.join("version")).unwrap(), "new");
        update.rollback().unwrap();
        assert_eq!(std::fs::read_to_string(app.join("version")).unwrap(), "old");
        assert_eq!(
            std::fs::read_to_string(root.path().join("data")).unwrap(),
            "untouched"
        );
    }
    #[test]
    fn external_symlinks_are_rejected_before_running_candidate() {
        let root = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/usr/bin/true", root.path().join("launcher")).unwrap();
        assert!(safe_contents(root.path(), root.path()).is_err());
    }
    #[test]
    fn successful_swap_keeps_previous_bundle_and_cleanup_requires_ownership() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("Palboo.app");
        let candidate = root.path().join("candidate.app");
        for path in [&app, &candidate] {
            std::fs::create_dir(path).unwrap();
        }
        std::fs::write(app.join("version"), "old").unwrap();
        std::fs::write(candidate.join("version"), "new").unwrap();
        let mut prepared = Prepared::fixture(&app, &candidate);
        prepared.activate().unwrap();
        let backup = prepared.keep_previous();
        drop(prepared);
        assert_eq!(std::fs::read_to_string(app.join("version")).unwrap(), "new");
        assert_eq!(
            std::fs::read_to_string(backup.join("version")).unwrap(),
            "old"
        );
        let record = serde_json::json!({"phase":"done","app":app,"previousApp":backup});
        clean_previous(&record, &app, &backup);
        assert!(backup.exists(), "the current recovery copy must remain");
        std::fs::write(backup.parent().unwrap().join("keep"), "user file").unwrap();
        clean_previous(&record, &app, &root.path().join("next"));
        assert!(backup.exists(), "unexpected sibling files block cleanup");
        std::fs::remove_file(backup.parent().unwrap().join("keep")).unwrap();
        clean_previous(&record, &app, &root.path().join("next"));
        assert!(!backup.exists());
        assert_eq!(std::fs::read_to_string(app.join("version")).unwrap(), "new");
    }
    #[tokio::test]
    #[ignore = "explicit local DMG validation; never activates or touches an installed App"]
    async fn verifies_distribution_in_an_isolated_app_directory() {
        let dmg = PathBuf::from(
            std::env::var_os("PALBOO_UPDATE_TEST_DMG")
                .expect("set PALBOO_UPDATE_TEST_DMG to a local distribution"),
        );
        let version = std::env::var("PALBOO_UPDATE_TEST_VERSION")
            .unwrap_or_else(|_| crate::config::VERSION.to_owned());
        let root = tempfile::tempdir().unwrap();
        let app = root.path().canonicalize().unwrap().join("Palboo.app");
        std::fs::create_dir(&app).unwrap();
        std::fs::write(app.join("keep"), "untouched").unwrap();
        let current = AppIdentity {
            path: app.clone(),
            version: "0.0.0".into(),
            device: 0,
            inode: 0,
            modified: 0,
            modified_nanos: 0,
        };
        let prepared = prepare(&dmg, &current, &version).await.unwrap();
        assert_eq!(inspect(&prepared.next).await.unwrap().version, version);
        assert_eq!(
            std::fs::read_to_string(app.join("keep")).unwrap(),
            "untouched"
        );
    }
}
