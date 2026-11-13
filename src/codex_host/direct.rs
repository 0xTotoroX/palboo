// [INPUT]: Palboo 配置、官方组件、私有启动请求及原生进程身份。
// [OUTPUT]: 0.18 系列直接启动、运行身份和丢失协调进程后的原会话恢复。
// [POS]: 以 Palboo 自身的协调子进程替代上游 Desktop launcher；不新增 App、不伪造上游运行记录。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md。
use super::{Options, Running};
use crate::{
    config::{Paths, write_private},
    host::ProcessIdentity,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs::File,
    io::Read,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

#[derive(Clone)]
pub(super) struct Layout {
    pub root: PathBuf,
    pub upstream: PathBuf,
    pub data: PathBuf,
}
impl Layout {
    pub fn current() -> Result<Self> {
        Ok(Self {
            root: crate::app_mode::shared_paths()?.root,
            upstream: dirs::data_local_dir()
                .context("应用目录不可用")?
                .join("codexhost"),
            data: dirs::home_dir()
                .context("用户目录不可用")?
                .join(".codexhost"),
        })
    }
    pub fn record(&self) -> PathBuf {
        self.root.join("codex-host-session.json")
    }
    pub fn diagnostics(&self) -> PathBuf {
        self.data.join("diagnostics/desktop-controller-v1.json")
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Resources {
    pub installation: PathBuf,
    pub desktop: PathBuf,
    pub node: PathBuf,
    pub stock: PathBuf,
    pub shim: PathBuf,
    pub runtime: PathBuf,
    pub controller: PathBuf,
    pub renderer: PathBuf,
}
impl Resources {
    pub async fn prepare(options: &Options, desktop: &Path) -> Result<Self> {
        let (installation, desktop, node, controller) =
            super::prepare(options, Some(desktop)).await?;
        let version = super::update::version_tuple(&super::version(&installation).await?)?;
        ensure!(
            version.0 == 0 && version.1 == 18,
            "当前 CodexHost 版本尚未验证直接启动，请使用 0.18 系列"
        );
        let root = super::resource_root(&installation)?;
        let inspected = super::output(&installation, &["inspect"], Duration::from_secs(10)).await?;
        let stock = inspected
            .lines()
            .find_map(|line| line.strip_prefix("executable_codex_cli="))
            .context("缺少 Codex CLI 路径")?;
        Ok(Self {
            installation: installation.canonicalize()?,
            node: node
                .unwrap_or(
                    desktop
                        .parent()
                        .context("宿主路径无效")?
                        .join("../Resources/cua_node/bin/node"),
                )
                .canonicalize()?,
            desktop: desktop.canonicalize()?,
            stock: PathBuf::from(stock).canonicalize()?,
            shim: root.join("libexec/codexhost-shim").canonicalize()?,
            runtime: root.join("app/host-runtime.mjs").canonicalize()?,
            controller: controller
                .unwrap_or(root.join("app/desktop-controller.mjs"))
                .canonicalize()?,
            renderer: root.join("app/renderer-extension.js").canonicalize()?,
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Record {
    pub schema: u32,
    pub lease: String,
    pub manager: ProcessIdentity,
    pub desktop: Option<ProcessIdentity>,
    pub controller: Option<ProcessIdentity>,
    pub resources: Resources,
    pub endpoint: String,
    pub port: u16,
    pub nonce: String,
    pub state: String,
}
impl Record {
    pub fn running(&self) -> Running {
        Running {
            pid: self.manager.pid,
            executable: self.resources.installation.clone(),
        }
    }
    pub fn descriptor(&self) -> super::Descriptor {
        super::Descriptor {
            schema_version: 1,
            launcher_pid: self.manager.pid,
            control_port: self.port,
            nonce: self.nonce.clone(),
        }
    }
    pub fn save(&self, layout: &Layout) -> Result<()> {
        write_private(&layout.record(), &serde_json::to_vec(self)?)
    }
    pub fn matches(&self, running: &Running) -> bool {
        self.running() == *running
    }
}

#[derive(Serialize, Deserialize)]
pub(super) struct Request {
    pub caller: ProcessIdentity,
    pub lease: String,
    pub revision: u64,
    pub resources: Resources,
    pub recovery: Option<Record>,
}

pub(super) fn read<T: DeserializeOwned>(file: &Path) -> Result<Option<T>> {
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(file)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let meta = file.metadata()?;
    ensure!(
        meta.is_file()
            && meta.len() <= 32768
            && meta.uid() == unsafe { libc::geteuid() }
            && meta.mode() & 0o077 == 0,
        "启动记录身份无效，已保留"
    );
    let mut bytes = Vec::new();
    file.take(32769).read_to_end(&mut bytes)?;
    Ok(Some(serde_json::from_slice(&bytes)?))
}
pub(super) fn record(layout: &Layout) -> Result<Option<Record>> {
    let result = read::<Record>(&layout.record())?;
    if let Some(record) = &result {
        ensure!(
            record.schema == 1
                && uuid::Uuid::parse_str(&record.lease).is_ok()
                && record.port > 0
                && record.nonce.len() == 32
                && record.nonce.bytes().all(|b| b.is_ascii_hexdigit()),
            "启动记录损坏，已保留"
        );
    }
    Ok(result)
}
pub(super) fn lock(path: &Path) -> Result<File> {
    use fs2::FileExt;
    std::fs::create_dir_all(path.parent().context("启动锁目录无效")?)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.uid() == unsafe { libc::geteuid() },
        "启动锁身份无效，已保留"
    );
    file.try_lock_exclusive()
        .context("另一个启动或退出操作尚未完成，请稍后重试")?;
    Ok(file)
}
pub(super) fn remove_matching(layout: &Layout, lease: &str) -> Result<()> {
    if record(layout)?.is_some_and(|record| record.lease == lease) {
        std::fs::remove_file(layout.record())?;
    }
    Ok(())
}

fn runner(layout: &Layout, lease: &str) -> Result<PathBuf> {
    ensure!(uuid::Uuid::parse_str(lease).is_ok(), "启动请求身份无效");
    Ok(layout
        .root
        .join("codex-host-sessions")
        .join(lease)
        .join("palboo"))
}
fn prepare_runner(layout: &Layout, lease: &str) -> Result<PathBuf> {
    let root = layout.root.join("codex-host-sessions");
    if !root.exists() {
        std::fs::DirBuilder::new().mode(0o700).create(&root)?;
    }
    let meta = std::fs::symlink_metadata(&root)?;
    ensure!(
        meta.is_dir() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0,
        "启动协调目录身份无效"
    );
    let executable = runner(layout, lease)?;
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(executable.parent().unwrap())?;
    // App 原子更新及 Dev 二进制替换会改变 macOS 的原生进程路径；每次会话固定自己的副本。
    std::fs::copy(std::env::current_exe()?, &executable)?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))?;
    Ok(executable)
}
fn remove_runner(layout: &Layout, lease: &str) {
    if let Ok(executable) = runner(layout, lease) {
        let _ = std::fs::remove_file(&executable);
        let _ = std::fs::remove_dir(executable.parent().unwrap());
    }
}
pub(super) fn clean_previous_runner(layout: &Layout, previous: &Record) {
    if previous.manager.alive().is_ok_and(|alive| !alive)
        && runner(layout, &previous.lease).ok().as_ref() == Some(&previous.manager.executable)
    {
        remove_runner(layout, &previous.lease);
    }
}

pub async fn running() -> Result<Option<Running>> {
    let Some(record) = record(&Layout::current()?)? else {
        return Ok(None);
    };
    if !record.manager.alive()? {
        ensure!(
            !record
                .desktop
                .as_ref()
                .is_some_and(|p| p.alive().unwrap_or(true)),
            "Palboo 启动协调已退出，请重新打开 Palboo 恢复原会话"
        );
        ensure!(
            !record
                .controller
                .as_ref()
                .is_some_and(|p| p.alive().unwrap_or(true)),
            "原 CodexHost 控制器仍在运行，未接管"
        );
        return Ok(None);
    }
    ensure!(
        record
            .desktop
            .as_ref()
            .is_some_and(|p| p.alive().unwrap_or(false)),
        "Palboo 正在准备或关闭 Codex"
    );
    Ok(Some(record.running()))
}
pub(crate) fn manager(running: &Running) -> Result<Option<ProcessIdentity>> {
    Layout::current()
        .and_then(|layout| record(&layout))
        .map(|record| record.filter(|r| r.matches(running)).map(|r| r.manager))
}
pub async fn installed(running: &Running) -> Result<Option<bool>> {
    let layout = Layout::current()?;
    let Some(record) = record(&layout)?.filter(|r| r.matches(running)) else {
        return Ok(None);
    };
    if !record.manager.alive()? || record.state != "ready" {
        return Ok(Some(false));
    }
    Ok(Some(
        super::readiness::installed_at(running, &record.descriptor(), &layout.diagnostics())
            .await?,
    ))
}

pub async fn recover(paths: &Paths) -> Result<()> {
    let layout = Layout::current()?;
    let Some(record) = record(&layout)? else {
        return Ok(());
    };
    if record.manager.alive()?
        || !record
            .desktop
            .as_ref()
            .is_some_and(|p| p.alive().unwrap_or(false))
    {
        return Ok(());
    }
    ensure!(
        record.running().managed_by(paths),
        "原会话不属于此 Palboo，未接管"
    );
    let _lock = lock(&layout.root.join("codex-host-recovery.lock"))?;
    let config = paths.load()?;
    let resources = record.resources.clone();
    spawn(
        paths,
        Request {
            caller: ProcessIdentity::read(std::process::id())?.context("启动进程已退出")?,
            lease: uuid::Uuid::new_v4().to_string(),
            revision: config.codex_host.revision,
            resources,
            recovery: Some(record),
        },
    )
    .await?;
    Ok(())
}

pub async fn launch(paths: &Paths, options: &Options, desktop: &Path) -> Result<String> {
    let resources = Resources::prepare(options, desktop).await?;
    spawn(
        paths,
        Request {
            caller: ProcessIdentity::read(std::process::id())?.context("启动进程已退出")?,
            lease: uuid::Uuid::new_v4().to_string(),
            revision: options.revision,
            resources,
            recovery: None,
        },
    )
    .await
}
async fn spawn(paths: &Paths, request: Request) -> Result<String> {
    let layout = Layout::current()?;
    let file = paths
        .root
        .join(format!("codex-host-start-{}.json", request.lease));
    write_private(&file, &serde_json::to_vec(&request)?)?;
    let log = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(paths.root.join("codex-host.log"))?;
    let executable = prepare_runner(&layout, &request.lease)?;
    let mut command = std::process::Command::new(&executable);
    command
        .arg("--data-dir")
        .arg(&paths.root)
        .arg("codex-host-session")
        .arg("--request")
        .arg(&file)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    crate::lifecycle::detach(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            remove_runner(&layout, &request.lease);
            return Err(error.into());
        }
    };
    let mut recorded = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    loop {
        if let Some(status) = child.try_wait()? {
            let error = read::<serde_json::Value>(&file.with_extension("result"))?
                .and_then(|v| v["error"].as_str().map(str::to_owned));
            let _ = std::fs::remove_file(&file);
            let _ = std::fs::remove_file(file.with_extension("result"));
            remove_runner(&layout, &request.lease);
            anyhow::bail!(
                "{}",
                error.unwrap_or_else(|| format!("Palboo 启动协调未完成（{status}）"))
            );
        }
        if let Some(record) =
            record(&layout)?.filter(|r| r.lease == request.lease && r.manager.pid == child.id())
        {
            if !recorded {
                write_private(
                    &paths.root.join("codex-host-owned.json"),
                    &serde_json::to_vec(&record.running())?,
                )?;
                recorded = true;
            }
            if record.state == "ready" {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(record.endpoint);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            anyhow::bail!("Codex 尚未就绪；现有启动过程已保留，可以稍后重新打开 Palboo");
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub async fn run(paths: &Paths, file: &Path) -> Result<()> {
    let request: Request = read(file)?.context("启动请求已失效")?;
    ensure!(
        request.caller.alive()?
            && ProcessIdentity::read(std::process::id())?
                .context("启动协调身份无效")?
                .parent()?
                .as_ref()
                == Some(&request.caller),
        "启动请求归属已变化"
    );
    std::fs::remove_file(file)?;
    let layout = Layout::current()?;
    let lease = request.lease.clone();
    let result = super::direct_session::run(paths, layout.clone(), request).await;
    if let Err(error) = &result {
        write_private(
            &file.with_extension("result"),
            &serde_json::to_vec(&serde_json::json!({"error":error.to_string()}))?,
        )?;
    }
    if std::env::current_exe().ok() == runner(&layout, &lease).ok() {
        remove_runner(&layout, &lease);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_runner_is_private_executable_and_independent_of_installation() {
        let directory = tempfile::tempdir().unwrap();
        let layout = Layout {
            root: directory.path().canonicalize().unwrap(),
            upstream: PathBuf::new(),
            data: PathBuf::new(),
        };
        let lease = uuid::Uuid::new_v4().to_string();
        let executable = prepare_runner(&layout, &lease).unwrap();
        assert_ne!(executable, std::env::current_exe().unwrap());
        assert_eq!(
            std::fs::metadata(&executable).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(executable.parent().unwrap())
                .unwrap()
                .mode()
                & 0o777,
            0o700
        );
        let output = std::process::Command::new(&executable)
            .arg("--list")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "copied coordinator could not execute: {:?}",
            output.status
        );
        remove_runner(&layout, &lease);
        assert!(!executable.exists());
        assert!(std::env::current_exe().unwrap().is_file());
    }
}
