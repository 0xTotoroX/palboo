// [INPUT]: Palboo 私有 CLI 交接记录、调用参数与原生父进程身份。
// [OUTPUT]: 仅桌面主 app-server 进入官方 Shim，辅助命令及接入准备失败转交官方 CLI；私有失败关系供协调读取。
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
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("-c" | "--config" | "--enable" | "--disable") => {
                if args.next().is_none() {
                    return false;
                }
            }
            Some(value) if value.starts_with("--config=") || value.starts_with("-c=") => {}
            // 桌面主服务的已核实参数；单独的辅助 app-server 不能凭同名进入兼容层。
            Some("app-server") => return args.any(|arg| arg == "--analytics-default-enabled"),
            _ => return false,
        }
    }
    false
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

pub(crate) fn dispatch() -> Result<()> {
    let Some(context) = std::env::var_os(CONTEXT) else {
        return Ok(());
    };
    let context = Path::new(&context);
    let record: ContextRecord = direct::read(context)?.context("原生 CLI 交接记录缺失")?;
    ensure!(
        std::env::current_exe()?.canonicalize()? == record.executable.canonicalize()?
            && record.executable.parent() == context.parent(),
        "原生 CLI 入口身份不匹配"
    );
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let parent = ProcessIdentity::read(std::process::id())
        .ok()
        .flatten()
        .and_then(|process| process.parent().ok().flatten());
    // 只有本次指定桌面直接启动的主服务才接入兼容层；未知或间接调用保留原生行为。
    let mut main = app_server(&args)
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
        for values in [
            vec!["--version"],
            vec!["exec-server"],
            vec!["-c", "app-server"],
            vec!["exec", "app-server"],
            vec!["app-server", "--listen", "stdio://"],
            vec!["--unknown", "app-server"],
        ] {
            assert!(!app_server(&args(&values)));
        }
        assert!(desktop_origin(None));
        assert!(desktop_origin(Some(OsStr::new("Codex Desktop"))));
        assert!(!desktop_origin(Some(OsStr::new("codex-computer-use"))));
    }
}
