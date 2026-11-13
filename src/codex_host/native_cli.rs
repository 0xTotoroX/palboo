// [INPUT]: Palboo 私有 CLI 交接记录、入口旁的会话记录、调用参数与原生父进程身份。
// [OUTPUT]: 私有入口分流主服务与辅助 CLI；普通 Palboo 清除继承的交接标记后正常启动。
// [POS]: 0.18 直启的进程边界；不修改官方包、不转换协议、不伪造 launcher 身份。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::direct::{self, Layout, Record};
use crate::{config::write_private, host::ProcessIdentity};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    ffi::{OsStr, OsString},
    os::unix::{
        fs::{DirBuilderExt, MetadataExt, PermissionsExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::Command,
};

const CONTEXT: &str = "PALBOO_NATIVE_CLI_CONTEXT";
const LEGACY_CONTEXT: &str = "CODEX_BUDDY_NATIVE_CLI_CONTEXT";

#[derive(Serialize, Deserialize)]
struct ContextRecord {
    executable: PathBuf,
    desktop: PathBuf,
    endpoint: String,
    stock: PathBuf,
    shim: PathBuf,
    #[serde(default)]
    service: Option<super::native_host::Launch>,
}

#[derive(Serialize, Deserialize)]
pub(super) struct Failure {
    pub message: String,
    pub desktop: Option<ProcessIdentity>,
    pub host_ancestors: Vec<ProcessIdentity>,
}

pub(super) fn failure(context: &Path) -> Result<Option<Failure>> {
    direct::read(
        &context
            .parent()
            .context("CLI 目录缺失")?
            .join("compatibility-error.json"),
    )
}

pub(super) fn prepare(layout: &Layout, record: &Record) -> Result<PathBuf> {
    let root = layout.root.join("codex-host-native-cli");
    if !root.exists() {
        std::fs::DirBuilder::new().mode(0o700).create(&root)?;
    }
    let metadata = std::fs::symlink_metadata(&root)?;
    ensure!(
        metadata.is_dir()
            && metadata.uid() == unsafe { libc::geteuid() }
            && metadata.mode() & 0o077 == 0,
        "原生 CLI 目录身份无效"
    );
    let directory = root.join(&record.lease);
    std::fs::DirBuilder::new().mode(0o700).create(&directory)?;
    let executable = directory.join("palboo");
    // 与协调进程分开保存；协调恢复、热更不能删除桌面仍在使用的入口。
    #[cfg(not(test))]
    let source = std::env::current_exe()?;
    #[cfg(test)]
    let source = std::env::var_os("PALBOO_TEST_CLI")
        .map(PathBuf::from)
        .context("原生夹具须显式指定 PALBOO_TEST_CLI 为已构建的 Palboo")?;
    std::fs::copy(source, &executable)?;
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))?;
    let context = directory.join("context.json");
    write_private(
        &context,
        &serde_json::to_vec(&ContextRecord {
            executable,
            desktop: record.resources.desktop.clone(),
            endpoint: record.endpoint.clone(),
            stock: record.resources.stock.clone(),
            shim: record.resources.shim.clone(),
            service: Some(super::native_host::Launch {
                installation: record.resources.installation.clone(),
                node: record.resources.node.clone(),
                runtime: record.resources.runtime.clone(),
                stock: record.resources.stock.clone(),
                data: layout.data.clone(),
            }),
        })?,
    )?;
    Ok(context)
}

pub(super) fn environment(context: &Path) -> Result<Vec<(String, String)>> {
    let record: ContextRecord = direct::read(context)?.context("原生 CLI 交接记录缺失")?;
    Ok(vec![
        (
            "CODEX_CLI_PATH".into(),
            record.executable.to_string_lossy().into_owned(),
        ),
        (CONTEXT.into(), context.to_string_lossy().into_owned()),
    ])
}

pub(super) fn remove(context: &Path, layout: &Layout) {
    let Some(directory) = context.parent() else {
        return;
    };
    if context.file_name() != Some(OsStr::new("context.json"))
        || directory.parent() != Some(layout.root.join("codex-host-native-cli").as_path())
        || directory
            .file_name()
            .and_then(OsStr::to_str)
            .is_none_or(|name| uuid::Uuid::parse_str(name).is_err())
    {
        return;
    }
    if !std::fs::symlink_metadata(directory).is_ok_and(|metadata| metadata.is_dir()) {
        return;
    }
    let _ = std::fs::remove_file(directory.join("palboo"));
    let _ = std::fs::remove_file(directory.join("compatibility-error.json"));
    let _ = std::fs::remove_file(context);
    let _ = std::fs::remove_dir(directory);
}

fn app_server(args: &[OsString]) -> bool {
    let mut args = args.iter();
    let mut server = false;
    let mut analytics = false;
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("-c" | "--config" | "--enable" | "--disable") => {
                if args.next().is_none() {
                    return false;
                }
            }
            Some(value) if value.starts_with("--config=") || value.starts_with("-c=") => {}
            Some("app-server") if !server => server = true,
            Some("--analytics-default-enabled") if server => analytics = true,
            // 启动配置/登出等短任务也带 app-server 和 analytics；必须检查完整参数，
            // 否则它退出后会留下失去桌面祖先的 Host。未知调用一律交还官方 CLI。
            _ => return false,
        }
    }
    server && analytics
}

fn desktop_origin(origin: Option<&OsStr>) -> bool {
    origin.is_none()
        || matches!(
            origin.and_then(OsStr::to_str),
            Some("Codex Desktop" | "codex-desktop")
        )
}

fn command(record: &ContextRecord, args: &[OsString], main: bool) -> Command {
    let mut command = Command::new(if main { &record.shim } else { &record.stock });
    command.args(args).env_remove(CONTEXT);
    super::native_host::restore_runtime_alias(&mut command, &record.executable, &record.stock);
    if main {
        command.env("CODEX_CLI_PATH", &record.shim);
    } else {
        // 只移除兼容路由；保留原生 originator、认证、插件和其他宿主设置。
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("CODEXHOST_") || key == "CODEX_CLI_PATH" {
                command.env_remove(key);
            }
        }
    }
    command
}

fn adjacent_context(executable: &Path) -> Result<Option<PathBuf>> {
    let Some(directory) = executable.parent() else {
        return Ok(None);
    };
    let Some(root) = directory.parent() else {
        return Ok(None);
    };
    if executable.file_name() != Some(OsStr::new("palboo"))
        || root.file_name() != Some(OsStr::new("codex-host-native-cli"))
        || directory
            .file_name()
            .and_then(OsStr::to_str)
            .is_none_or(|name| uuid::Uuid::parse_str(name).is_err())
    {
        return Ok(None);
    }
    // 原生工具只继承 Desktop 提供的 CLI 路径，不保证继承 Palboo 的交接变量。
    // 仅在私有会话入口旁读取记录；普通 Palboo 不搜索配置或接管 CLI 调用。
    for path in [root, directory] {
        let metadata = std::fs::symlink_metadata(path)?;
        ensure!(
            metadata.is_dir()
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.mode() & 0o077 == 0,
            "原生 CLI 目录身份无效"
        );
    }
    Ok(Some(directory.join("context.json")))
}

pub(crate) fn dispatch() -> Result<()> {
    let executable = std::env::current_exe()?.canonicalize()?;
    let explicit_context = std::env::var_os(CONTEXT);
    let Some(adjacent) = adjacent_context(&executable)? else {
        // Computer Use 等子进程可能将桌面的交接环境传给普通 Palboo。
        // 交接只属于私有会话入口；不读取外来记录，也不修改 Tokio 的全局环境。
        if explicit_context.is_some() || std::env::var_os(LEGACY_CONTEXT).is_some() {
            let error = Command::new(&executable)
                .args(std::env::args_os().skip(1))
                .env_remove(CONTEXT)
                .env_remove(LEGACY_CONTEXT)
                .exec();
            return Err(error).context("恢复 Palboo 普通入口失败");
        }
        return Ok(());
    };
    let context = explicit_context
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(adjacent);
    let context = context.as_path();
    let record: ContextRecord = direct::read(context)?.context("原生 CLI 交接记录缺失")?;
    ensure!(
        executable.canonicalize()? == record.executable.canonicalize()?
            && record.executable.parent() == context.parent(),
        "原生 CLI 入口身份不匹配"
    );
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let parent = ProcessIdentity::read(std::process::id())
        .ok()
        .flatten()
        .and_then(|process| process.parent().ok().flatten());
    // 只有本次指定桌面直接启动的主服务才接入兼容层；未知或间接调用保留原生行为。
    let mut main = explicit_context.is_some()
        && app_server(&args)
        && desktop_origin(std::env::var_os("CODEX_INTERNAL_ORIGINATOR_OVERRIDE").as_deref())
        && parent.as_ref().is_some_and(|p| {
            p.executable == record.desktop
                && crate::host::process_debug_endpoint(p.pid as i32)
                    .ok()
                    .flatten()
                    .as_ref()
                    == Some(&record.endpoint)
        });
    if main && failure(context)?.is_some() {
        main = false;
    }
    let service = if main && let Some(service) = &record.service {
        match super::native_host::ensure(
            service,
            context.parent().context("CLI 目录缺失")?,
            parent.as_ref().unwrap(),
        ) {
            Ok(child) => child,
            Err(error) => {
                // 兼容层接入失败不能变成官方桌面的致命启动错误。
                let failure = Failure {
                    message: error.to_string(),
                    desktop: parent.clone(),
                    host_ancestors: super::native_host::owner_ancestry(service).unwrap_or_default(),
                };
                let _ = write_private(
                    &context.parent().unwrap().join("compatibility-error.json"),
                    &serde_json::to_vec(&failure)?,
                );
                main = false;
                None
            }
        }
    } else {
        None
    };
    let error = command(&record, &args, main).exec();
    if let Some(child) = service {
        super::native_host::exec_failed(child);
    }
    Err(error).context("无法执行官方 Codex CLI")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adjacent_record_is_only_discovered_for_a_private_session_entry() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("codex-host-native-cli");
        let directory = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .unwrap();
        let executable = directory.join("palboo");
        assert_eq!(
            adjacent_context(&executable).unwrap(),
            Some(directory.join("context.json"))
        );
        for unrelated in [
            temporary.path().join("palboo"),
            root.join("not-a-session/palboo"),
            directory.join("another-program"),
        ] {
            assert!(adjacent_context(&unrelated).unwrap().is_none());
        }
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(adjacent_context(&executable).is_err());
    }

    #[test]
    fn only_recognized_desktop_app_server_uses_host() {
        let args = |values: &[&str]| values.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(app_server(&args(&[
            "-c",
            "features.code_mode_host=true",
            "app-server",
            "--analytics-default-enabled"
        ])));
        assert!(app_server(&args(&[
            "--config=x=y",
            "app-server",
            "--analytics-default-enabled"
        ])));
        assert!(app_server(&args(&[
            "app-server",
            "-c",
            "features.code_mode_host=true",
            "--analytics-default-enabled",
            "-c",
            "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=true"
        ])));
        for values in [
            vec!["--version"],
            vec!["exec-server"],
            vec!["-c", "app-server"],
            vec!["exec", "app-server"],
            vec!["app-server", "--listen", "stdio://"],
            vec!["--unknown", "app-server"],
            vec![
                "app-server",
                "--analytics-default-enabled",
                "--print-startup-config",
            ],
            vec![
                "app-server",
                "--analytics-default-enabled",
                "--startup-sign-out",
            ],
            vec!["app-server", "--analytics-default-enabled", "--help"],
            vec!["app-server", "--analytics-default-enabled", "--version"],
            vec![
                "app-server",
                "--analytics-default-enabled",
                "--listen",
                "stdio://",
            ],
            vec!["app-server", "--analytics-default-enabled", "--unknown"],
            vec!["app-server", "--analytics-default-enabled", "-c"],
        ] {
            assert!(!app_server(&args(&values)));
        }
        assert!(desktop_origin(None));
        assert!(desktop_origin(Some(OsStr::new("Codex Desktop"))));
        assert!(!desktop_origin(Some(OsStr::new("codex-computer-use"))));
    }
}
