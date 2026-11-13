// [INPUT]: 官方共享 Host 就绪记录、映射锁 PID、所选安装与 macOS 进程身份。
// [OUTPUT]: 冷启动识别同安装 0.18+ 共享后台；关联退出在官方双锁内核验固定通道并正常关闭原实例。
// [POS]: 兼容层进程归属及生命周期边界；不删除记录、不强杀或替换后台。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(super) struct ReadyOwner {
    pid: u32,
    started_at_micros: u64,
    executable: PathBuf,
    runtime: PathBuf,
    version: String,
}

fn process_identity(pid: u32) -> Result<(u64, PathBuf)> {
    let identity = crate::host::ProcessIdentity::read(pid)?.context("CodexHost 共享后台已退出")?;
    Ok((identity.started_at_micros, identity.executable))
}

#[derive(Clone)]
pub(crate) struct Lease {
    installation: PathBuf,
    data: PathBuf,
    owner: ReadyOwner,
    channel: Channel,
    supervisor: Option<crate::host::ProcessIdentity>,
    launcher_guard: PathBuf,
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
struct Channel {
    version: u32,
    owner: String,
    pid: u32,
    port: u16,
    token: String,
}

pub(super) fn ready_process(
    installation: &Path,
    data: &Path,
) -> Result<Option<crate::host::ProcessIdentity>> {
    let Some(owner) = super::direct::read::<ReadyOwner>(&data.join("shared-host-ready.json"))?
    else {
        return Ok(None);
    };
    let Some(process) = crate::host::ProcessIdentity::read(owner.pid)? else {
        return Ok(None);
    };
    if process.started_at_micros != owner.started_at_micros {
        return Ok(None);
    }
    ensure!(
        owns_store_lock(
            installation,
            &data.join("mapping-store/store.lock"),
            owner.pid
        )?,
        "现有 CodexHost 后台身份不符，已保留"
    );
    Ok(Some(process))
}

fn channel(data: &Path, pid: u32) -> Result<Channel> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let mut matches = Vec::new();
    for entry in std::fs::read_dir(data.join("client-hosts"))? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&format!("host-{pid}-")) || !name.ends_with(".json") {
            continue;
        }
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(entry.path())?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file()
                && metadata.len() <= 4096
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.mode() & 0o77 == 0,
            "CodexHost 控制通道文件身份无效"
        );
        let mut bytes = Vec::new();
        file.by_ref().take(4097).read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= 4096, "CodexHost 控制通道记录过大");
        let record: Channel = serde_json::from_slice(&bytes)?;
        ensure!(
            record.version == 1
                && record.owner == "service"
                && record.pid == pid
                && record.port > 0
                && record.token.len() == 64
                && record.token.bytes().all(|b| b.is_ascii_hexdigit()),
            "CodexHost 控制通道身份不符"
        );
        matches.push(record);
    }
    ensure!(matches.len() == 1, "无法确认 CodexHost 唯一控制通道");
    Ok(matches.remove(0))
}

impl Lease {
    pub(crate) fn capture(installation: &Path, data: PathBuf) -> Result<Self> {
        Self::capture_at(
            installation,
            data,
            dirs::data_local_dir()
                .context("无法找到启动互斥目录")?
                .join("codexhost/launcher-v1.lock"),
        )
    }

    pub(super) fn capture_at(
        installation: &Path,
        data: PathBuf,
        launcher_guard: PathBuf,
    ) -> Result<Self> {
        let owner: ReadyOwner =
            serde_json::from_slice(&std::fs::read(data.join("shared-host-ready.json"))?)?;
        let lock = data.join("mapping-store/store.lock");
        let pid = serde_json::from_slice::<serde_json::Value>(&std::fs::read(&lock)?)?["pid"]
            .as_u64()
            .context("CodexHost 锁身份无效")?;
        ensure!(
            pid == u64::from(owner.pid) && owns_store_lock(installation, &lock, owner.pid)?,
            "CodexHost 共享后台归属不符"
        );
        let identity =
            crate::host::ProcessIdentity::read(owner.pid)?.context("CodexHost 已退出")?;
        let supervisor = identity.parent()?.filter(|parent| {
            parent.executable.canonicalize().is_ok_and(|actual| {
                installation
                    .canonicalize()
                    .is_ok_and(|expected| actual == expected)
            })
        });
        let channel = channel(&data, owner.pid)?;
        Ok(Self {
            installation: installation.into(),
            data,
            owner,
            channel,
            supervisor,
            launcher_guard,
        })
    }

    pub(crate) async fn stop(self, still_exited: impl Fn() -> Result<bool>) -> Result<()> {
        use fs2::FileExt;
        use std::time::{Duration, Instant};
        let owner_identity = crate::host::ProcessIdentity {
            pid: self.owner.pid,
            started_at_micros: self.owner.started_at_micros,
            executable: self.owner.executable.clone(),
        };
        // 前台后代可能已随桌面退出；不再依赖其已移除的官方记录，也不碰替代实例。
        if !owner_identity.alive()?
            && self
                .supervisor
                .as_ref()
                .is_none_or(|p| !p.alive().unwrap_or(true))
        {
            ensure!(still_exited()?, "宿主已恢复或身份不明，退出检查已停止");
            return Ok(());
        }
        // 与上游 ensure/restart/stop 共用互斥，重验后不会误停并发替换的新实例。
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut guards = Vec::new();
        // 与官方桌面启动、Host ensure/restart/stop 共用互斥，先阻止新桌面接入。
        for path in [
            &self.launcher_guard,
            &self.data.join("shared-host-lifecycle.lock"),
        ] {
            let guard = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)?;
            loop {
                match guard.try_lock_exclusive() {
                    Ok(()) => break,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        tokio::time::sleep(Duration::from_millis(50)).await
                    }
                    Err(error) => return Err(error).context("CodexHost 正在切换，未停止后台"),
                }
            }
            guards.push(guard);
        }
        let current = Self::capture(&self.installation, self.data.clone())?;
        ensure!(
            current.owner == self.owner,
            "CodexHost 共享后台已更换，未停止新实例"
        );
        ensure!(
            current.channel == self.channel,
            "CodexHost 控制通道已更换，未发送退出"
        );
        let supervisor = self
            .supervisor
            .as_ref()
            .context("无法核验 CodexHost 监督进程，未发送退出")?;
        let supervisor_now = crate::host::ProcessIdentity::read(supervisor.pid)?;
        ensure!(
            supervisor_now.as_ref() == Some(supervisor)
                || (supervisor_now.is_none() && owner_identity.parent()?.is_none()),
            "CodexHost 监督进程已更换，未发送退出"
        );
        let mut listeners = crate::host::listening_pids(self.channel.port).await?;
        listeners.sort_unstable();
        listeners.dedup();
        ensure!(
            listeners == [self.owner.pid],
            "CodexHost 控制端口归属已变化，未发送退出"
        );
        ensure!(still_exited()?, "宿主已恢复或身份不明，未发送退出");
        // 绑定原通道，不用会重新挑选最新通道的全局或 runtime stop。
        let response = crate::config::local_client()
            .post(format!(
                "http://127.0.0.1:{}/v1/shutdown",
                self.channel.port
            ))
            .bearer_auth(&self.channel.token)
            .json(&serde_json::json!({}))
            .send()
            .await?;
        ensure!(
            response.status().is_success(),
            "CodexHost 未确认正常退出；记录已保留"
        );
        let result: serde_json::Value = response.json().await?;
        ensure!(
            result["result"]["stopping"] == true,
            "CodexHost 退出响应无效，未重试"
        );
        let identity = crate::host::ProcessIdentity {
            pid: self.owner.pid,
            started_at_micros: self.owner.started_at_micros,
            executable: self.owner.executable,
        };
        let deadline = Instant::now() + Duration::from_secs(8);
        while identity.alive()? || supervisor.alive()? {
            ensure!(Instant::now() < deadline, "CodexHost 仍在退出，未强制终止");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok(())
    }
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

    struct Fixture {
        _directory: tempfile::TempDir,
        child: std::process::Child,
        data: PathBuf,
        installation: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let installation = super::super::tests::fixture_install(
                &directory.path().join("selected"),
                "0.18.0",
                Path::new("/unused"),
            );
            let data = directory.path().join("data");
            std::fs::create_dir_all(data.join("mapping-store")).unwrap();
            let runtime = installation
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("app/host-runtime.mjs");
            std::fs::write(
                &runtime,
                r#"import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
const data=process.argv[2];
const server=createServer((req,res)=>{
 writeFileSync(join(data,'stop-called'),JSON.stringify({method:req.method,path:req.url,authorized:req.headers.authorization==='Bearer '+'0'.repeat(64)}));
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({result:{stopping:true}}));
 setTimeout(()=>process.exit(0),10);
});
server.listen(0,'127.0.0.1',()=>{
 mkdirSync(join(data,'client-hosts'),{recursive:true,mode:0o700});
 writeFileSync(join(data,'client-hosts',`host-${process.pid}-fixture.json`),JSON.stringify({version:1,owner:'service',pid:process.pid,port:server.address().port,token:'0'.repeat(64)}),{mode:0o600});
});
"#,
            )
            .unwrap();
            let runtime = runtime.canonicalize().unwrap();
            let node = super::super::find_node().unwrap();
            let child = std::process::Command::new(node)
                .arg(&runtime)
                .arg(&data)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !data.join("client-hosts").exists() {
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            // 发布目录可能早于文件；等待完整原子就绪的合成通道。
            while std::fs::read_dir(data.join("client-hosts"))
                .unwrap()
                .count()
                == 0
            {
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            let (started, executable) = process_identity(child.id()).unwrap();
            std::fs::write(data.join("shared-host-ready.json"), json!({"pid":child.id(),"started_at_micros":started,"executable":executable,"runtime":runtime,"version":"0.18.0"}).to_string()).unwrap();
            std::fs::write(
                data.join("mapping-store/store.lock"),
                json!({"pid":child.id()}).to_string(),
            )
            .unwrap();
            std::fs::write(data.join("shared-host-lifecycle.lock"), "").unwrap();
            Self {
                _directory: directory,
                child,
                data,
                installation,
            }
        }

        fn lease(&self) -> Lease {
            let mut lease = Lease::capture(&self.installation, self.data.clone()).unwrap();
            // 单进程夹具代表已知的完整受控进程树，不等待测试运行器。
            lease.supervisor = crate::host::ProcessIdentity::read(self.child.id()).unwrap();
            lease.launcher_guard = self.data.join("launcher-v1.lock");
            std::fs::write(&lease.launcher_guard, "").unwrap();
            lease
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    #[tokio::test]
    async fn owned_shutdown_targets_captured_channel_and_preserves_records() {
        let fixture = Fixture::new();
        let ready = std::fs::read(fixture.data.join("shared-host-ready.json")).unwrap();
        let lock = std::fs::read(fixture.data.join("mapping-store/store.lock")).unwrap();
        fixture.lease().stop(|| Ok(true)).await.unwrap();
        let request: serde_json::Value =
            serde_json::from_slice(&std::fs::read(fixture.data.join("stop-called")).unwrap())
                .unwrap();
        assert_eq!(
            request,
            json!({"method":"POST","path":"/v1/shutdown","authorized":true})
        );
        assert_eq!(
            std::fs::read(fixture.data.join("shared-host-ready.json")).unwrap(),
            ready
        );
        assert_eq!(
            std::fs::read(fixture.data.join("mapping-store/store.lock")).unwrap(),
            lock
        );
    }

    #[tokio::test]
    async fn already_exited_foreground_tree_preserves_replacement_records() {
        let mut fixture = Fixture::new();
        let lease = fixture.lease();
        unsafe {
            libc::kill(fixture.child.id() as i32, libc::SIGTERM);
        }
        fixture.child.wait().unwrap();
        let ready = fixture.data.join("shared-host-ready.json");
        std::fs::write(&ready, b"replacement-owned-by-another-session").unwrap();
        assert!(lease.clone().stop(|| Ok(false)).await.is_err());
        lease.stop(|| Ok(true)).await.unwrap();
        assert_eq!(
            std::fs::read(&ready).unwrap(),
            b"replacement-owned-by-another-session"
        );
        assert!(!fixture.data.join("stop-called").exists());
    }

    #[tokio::test]
    async fn shutdown_refuses_replaced_owner_and_upstream_lifecycle_contention() {
        use fs2::FileExt;
        let fixture = Fixture::new();
        let lease = fixture.lease();
        let ready_path = fixture.data.join("shared-host-ready.json");
        let ready = std::fs::read(&ready_path).unwrap();
        let mut replacement: serde_json::Value = serde_json::from_slice(&ready).unwrap();
        replacement["started_at_micros"] = json!(lease.owner.started_at_micros + 1);
        std::fs::write(&ready_path, replacement.to_string()).unwrap();
        assert!(lease.stop(|| Ok(true)).await.is_err());
        assert!(!fixture.data.join("stop-called").exists());
        std::fs::write(&ready_path, ready).unwrap();
        let lease = fixture.lease();
        let guard = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(fixture.data.join("shared-host-lifecycle.lock"))
            .unwrap();
        guard.try_lock_exclusive().unwrap();
        assert!(lease.stop(|| Ok(true)).await.is_err());
        assert!(!fixture.data.join("stop-called").exists());
        assert!(
            crate::host::ProcessIdentity::read(fixture.child.id())
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn shutdown_preserves_service_when_host_recovers_or_port_belongs_to_another_process() {
        let fixture = Fixture::new();
        assert!(fixture.lease().stop(|| Ok(false)).await.is_err());
        assert!(!fixture.data.join("stop-called").exists());
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let entry = std::fs::read_dir(fixture.data.join("client-hosts"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let mut record: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&entry).unwrap()).unwrap();
        record["port"] = json!(listener.local_addr().unwrap().port());
        std::fs::write(entry, record.to_string()).unwrap();
        assert!(fixture.lease().stop(|| Ok(true)).await.is_err());
        assert!(!fixture.data.join("stop-called").exists());
        assert!(
            crate::host::ProcessIdentity::read(fixture.child.id())
                .unwrap()
                .is_some()
        );
    }

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
