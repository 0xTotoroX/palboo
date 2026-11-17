// [INPUT]: App 启动器创建的私有事件文件和本次启动阶段。
// [OUTPUT]: best-effort phase；只追加固定阶段、时间及受限实际模式，不记录日志正文、配置或凭据。
// [POS]: Swift / Rust / Dev 共用的短期启动反馈；文件移除后不再写入，不影响启动结果。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use std::{
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
static ATTACHED: Mutex<Option<PathBuf>> = Mutex::new(None);

pub(crate) fn attach(path: &Path) -> anyhow::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("无效的反馈路径"))?;
    anyhow::ensure!(
        path.file_name().is_some_and(|v| v == "events.jsonl")
            && parent
                .file_name()
                .is_some_and(|v| v.to_string_lossy().starts_with("palboo-startup-"))
            && parent.parent().map(std::fs::canonicalize).transpose()?
                == Some(std::fs::canonicalize(std::env::temp_dir())?),
        "无效的反馈路径"
    );
    let directory = std::fs::symlink_metadata(parent)?;
    anyhow::ensure!(
        directory.is_dir()
            && directory.uid() == unsafe { libc::geteuid() }
            && directory.mode() & 0o077 == 0,
        "反馈目录不可用"
    );
    let metadata = std::fs::symlink_metadata(path)?;
    anyhow::ensure!(
        metadata.is_file()
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.mode() & 0o077 == 0
            && metadata.len() < 262_144,
        "反馈文件不可用"
    );
    *ATTACHED.lock().unwrap() = Some(path.to_owned());
    phase("backend");
    Ok(())
}

pub fn phase(name: &str) {
    report(
        name,
        (name == "backend").then(|| {
            if crate::assets::development().is_some() {
                "development"
            } else {
                "release"
            }
        }),
    );
}

pub(crate) fn mode(development: bool) {
    report(
        "mode",
        Some(if development {
            "development"
        } else {
            "release"
        }),
    );
}

fn report(name: &str, mode: Option<&str>) {
    let attached = ATTACHED.lock().unwrap().clone();
    if let Some(file) =
        attached.or_else(|| std::env::var_os("PALBOO_STARTUP_PROGRESS").map(PathBuf::from))
    {
        let _ = append_event(&file, name, mode);
    }
}

#[cfg(test)]
fn append(path: &Path, name: &str) -> std::io::Result<()> {
    append_event(path, name, None)
}

fn append_event(path: &Path, name: &str, mode: Option<&str>) -> std::io::Result<()> {
    if !path.is_absolute() || !valid_phase(name) {
        return Ok(());
    }
    let mut file = OpenOptions::new()
        .append(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0
        || metadata.len() >= 262_144
    {
        return Ok(());
    }
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id();
    let mode = match mode {
        Some("development") => ",\"mode\":\"development\"",
        Some("release") => ",\"mode\":\"release\"",
        _ => "",
    };
    let event = format!("{{\"phase\":\"{name}\",\"atMs\":{at},\"pid\":{pid}{mode}}}\n");
    // 单次 O_APPEND 写入，允许 Rust 和 Dev 在同一启动链上依次报告。
    file.write_all(event.as_bytes())
}

fn valid_phase(name: &str) -> bool {
    matches!(
        name,
        "mode"
            | "backend"
            | "supervisor"
            | "exit-start"
            | "exit-tasks"
            | "exit-compatibility"
            | "exit-backend"
            | "exit-failed"
            | "exit-cancelled"
            | "preparing"
            | "source"
            | "development"
            | "tools"
            | "checking"
            | "web"
            | "build"
            | "compatibility"
            | "confirmation"
            | "closing"
            | "opening"
            | "host"
            | "renderer"
            | "connecting"
            | "workspace"
            | "presenting"
    )
}

pub struct Trace {
    offset: u64,
    pending: String,
}

impl Trace {
    pub fn new(path: &Path) -> Self {
        Self {
            offset: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            pending: String::new(),
        }
    }
    pub fn poll(&mut self, path: &Path) {
        let Ok(mut file) = std::fs::File::open(path) else {
            return;
        };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        let Ok(read) = file.take(65536).read_to_end(&mut bytes) else {
            return;
        };
        self.offset += read as u64;
        self.pending.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(end) = self.pending.find('\n') {
            let line = self.pending[..end].to_owned();
            self.pending.drain(..=end);
            if let Some(next) = trace_phase(&line) {
                phase(next);
            }
        }
        if self.pending.len() > 4096 {
            self.pending.clear();
        }
    }
}

fn trace_phase(line: &str) -> Option<&'static str> {
    if !line.starts_with("[codexhost startup +") {
        return None;
    }
    match line.split_once("] launcher: ")?.1 {
        "launching Codex Desktop" => Some("opening"),
        "Codex Desktop launched" | "waiting for Host chain" => Some("renderer"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
    };

    #[test]
    fn attaching_a_live_launcher_rejects_other_files_and_symlinks() {
        let root = tempfile::Builder::new()
            .prefix("palboo-startup-")
            .tempdir()
            .unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let file = root.path().join("events.jsonl");
        fs::write(&file, b"").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        attach(&file).unwrap();
        let event: serde_json::Value =
            serde_json::from_str(fs::read_to_string(&file).unwrap().trim()).unwrap();
        assert_eq!(event["phase"], "backend");
        assert_eq!(event["pid"], std::process::id());
        assert_eq!(event["mode"], "release");
        assert!(attach(&root.path().join("other.json")).is_err());
        fs::remove_file(&file).unwrap();
        let target = root.path().join("target");
        fs::write(&target, b"").unwrap();
        symlink(&target, &file).unwrap();
        assert!(attach(&file).is_err());
        *ATTACHED.lock().unwrap() = None;
    }

    #[test]
    fn progress_is_private_bounded_and_does_not_recreate_finished_requests() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("events");
        fs::write(&file, b"").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        append(&file, "build").unwrap();
        append(&file, "secret or arbitrary log").unwrap();
        let saved = fs::read_to_string(&file).unwrap();
        assert_eq!(saved.lines().count(), 1);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&saved).unwrap()["phase"],
            "build"
        );
        let link = root.path().join("link");
        symlink(&file, &link).unwrap();
        assert!(append(&link, "opening").is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        append(&file, "opening").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), saved);
        fs::remove_file(&file).unwrap();
        assert!(append(&file, "opening").is_err());
        assert!(!file.exists());
    }

    #[test]
    fn only_known_launcher_events_become_visible_progress() {
        assert_eq!(
            trace_phase("[codexhost startup +69ms] launcher: Codex Desktop launched"),
            Some("renderer")
        );
        assert_eq!(
            trace_phase("[codexhost startup +9ms] controller: publishing readiness"),
            None
        );
        assert_eq!(trace_phase("arbitrary output"), None);
    }
}
