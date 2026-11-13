// [INPUT]: 官方共享 Host 就绪记录、映射锁 PID、所选安装与 macOS 进程身份。
// [OUTPUT]: 只读识别同一安装的 0.18+ 共享后台，允许上游正常复用其映射锁。
// [POS]: 冷启动预检的版本兼容边界；不删除记录、不停止或替换后台。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{
    ffi::CStr,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
struct ReadyOwner {
    pid: u32,
    started_at_micros: u64,
    executable: PathBuf,
    runtime: PathBuf,
    version: String,
}

fn process_identity(pid: u32) -> Result<(u64, PathBuf)> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of_val(&info) as i32;
    ensure!(
        unsafe {
            libc::proc_pidinfo(
                pid as i32,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        } == size,
        "无法核验 CodexHost 共享后台进程，记录已保留"
    );
    let mut buffer = [0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    ensure!(
        unsafe { libc::proc_pidpath(pid as i32, buffer.as_mut_ptr().cast(), buffer.len() as u32) }
            > 0,
        "无法核验 CodexHost 共享后台路径，记录已保留"
    );
    let executable = CStr::from_bytes_until_nul(&buffer)?.to_str()?.into();
    Ok((
        info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
        executable,
    ))
}

pub(super) fn owns_store_lock(installation: &Path, lock: &Path, pid: u32) -> Result<bool> {
    let root = super::resource_root(installation)?;
    let metadata: serde_json::Value = serde_json::from_slice(&std::fs::read(
        root.join("app/codexhost-distribution.json"),
    )?)?;
    let version = metadata["version"]
        .as_str()
        .context("CodexHost 版本信息无效")?;
    if super::update::version_tuple(version)? < (0, 18, 0) {
        return Ok(false);
    }
    let data = lock
        .parent()
        .and_then(Path::parent)
        .context("CodexHost 存储路径无效")?;
    let bytes = match std::fs::read(data.join("shared-host-ready.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let owner: ReadyOwner =
        serde_json::from_slice(&bytes).context("CodexHost 共享后台记录损坏，未清理")?;
    if owner.pid != pid
        || owner.version != version
        // 与上游安装比较使用相同的路径口径，别名也不能触发隐式服务替换。
        || owner.runtime != root.join("app/host-runtime.mjs")
        || !owner.runtime.is_file()
    {
        return Ok(false);
    }
    let (started, executable) = process_identity(pid)?;
    // PID、微秒级启动时间及原生路径共同确认同一进程，避免 PID 复用误认。
    Ok(owner.started_at_micros == started
        && owner.executable.canonicalize()? == executable.canonicalize()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shared_host_preflight_accepts_only_same_live_installation() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let installation = super::super::tests::fixture_install(
            &root.join("selected"),
            "0.18.0",
            Path::new("/unused"),
        );
        let runtime = root.join("selected/app/host-runtime.mjs");
        std::fs::write(&runtime, "").unwrap();
        let runtime = runtime.canonicalize().unwrap();
        let lock = root.join("mapping-store/store.lock");
        std::fs::create_dir_all(lock.parent().unwrap()).unwrap();
        let pid = std::process::id();
        let active_lock = json!({"pid":pid}).to_string();
        std::fs::write(&lock, &active_lock).unwrap();
        let (started, executable) = process_identity(pid).unwrap();
        let record = json!({"pid":pid,"started_at_micros":started,"executable":executable,"runtime":runtime,"version":"0.18.0"});
        let ready = root.join("shared-host-ready.json");
        let descriptor = root.join("desktop-runtime-v1.json");
        let check =
            || super::super::check_controller_records(&descriptor, &lock, Some(&installation));
        assert!(check().is_err());
        std::fs::write(&ready, record.to_string()).unwrap();
        check().unwrap();
        assert_eq!(std::fs::read_to_string(&lock).unwrap(), active_lock);
        assert_eq!(std::fs::read_to_string(&ready).unwrap(), record.to_string());
        let active_controller = json!({"schema_version":1,"launcher_pid":pid,"control_port":1,"nonce":"00000000000000000000000000000000"}).to_string();
        std::fs::write(&descriptor, &active_controller).unwrap();
        assert!(check().is_err());
        assert_eq!(
            std::fs::read_to_string(&descriptor).unwrap(),
            active_controller
        );
        std::fs::remove_file(&descriptor).unwrap();
        let mut variants = Vec::new();
        let alias = root.join("runtime-alias.mjs");
        std::os::unix::fs::symlink(&runtime, &alias).unwrap();
        for (key, value) in [
            ("pid", json!(pid + 1)),
            ("started_at_micros", json!(started + 1)),
            ("executable", json!(installation)),
            ("version", json!("0.18.1")),
            ("runtime", json!(installation)),
            ("runtime", json!(alias)),
        ] {
            let mut changed = record.clone();
            changed[key] = value;
            variants.push(changed.to_string());
        }
        variants.push("{incomplete".into());
        for changed in variants {
            std::fs::write(&ready, &changed).unwrap();
            assert!(check().is_err());
            assert_eq!(std::fs::read_to_string(&ready).unwrap(), changed);
            assert_eq!(std::fs::read_to_string(&lock).unwrap(), active_lock);
        }
        std::fs::write(&ready, record.to_string()).unwrap();
        super::super::tests::fixture_install(
            &root.join("selected"),
            "0.17.4",
            Path::new("/unused"),
        );
        assert!(check().is_err());
    }

    #[test]
    #[ignore = "explicit read-only check of an installed, running CodexHost 0.18+ shared service"]
    fn installed_shared_host_preflight_preserves_live_records() {
        let installation = std::env::var_os("PALBOO_TEST_CODEX_HOST")
            .map(PathBuf::from)
            .expect("set PALBOO_TEST_CODEX_HOST to the installed launcher");
        let data = dirs::home_dir().unwrap().join(".codexhost");
        let lock = data.join("mapping-store/store.lock");
        let ready = data.join("shared-host-ready.json");
        let descriptor = dirs::data_local_dir()
            .unwrap()
            .join("codexhost/desktop-runtime-v1.json");
        let before: Vec<_> = [&lock, &ready, &descriptor]
            .map(std::fs::read)
            .into_iter()
            .collect();
        let pid = serde_json::from_slice::<serde_json::Value>(before[0].as_ref().unwrap()).unwrap()
            ["pid"]
            .as_u64()
            .unwrap() as u32;
        assert!(owns_store_lock(&installation, &lock, pid).unwrap());
        super::super::check_controller_records(&descriptor, &lock, Some(&installation)).unwrap();
        for (path, previous) in [&lock, &ready, &descriptor].into_iter().zip(before) {
            match previous {
                Ok(bytes) => assert_eq!(std::fs::read(path).unwrap(), bytes),
                Err(error) => {
                    assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
                    assert!(!path.exists());
                }
            }
        }
    }
}
