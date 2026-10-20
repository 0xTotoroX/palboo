// [INPUT]: Embedded PALBOO installer, user's Node runtime and scoped Codex config.
// [OUTPUT]: Portable grokbot setup/login/connect/status/start/stop/uninstall CLI.
// [POS]: Optional integration lifecycle; never changes Codex chats or starts a Bot.
// [PROTOCOL]: Keep src/AGENTS.md and scripts/AGENTS.md in sync.
use anyhow::{Context, Result, bail, ensure};
use clap::Subcommand;
use std::{path::PathBuf, process::Command};
use toml_edit::{Document as DocumentMut, Item, Table, value};

#[derive(Subcommand)]
pub enum Action {
    #[command(about = "安装 BDK 并引导登录、账号确认与 Codex 接入")]
    Setup,
    #[command(about = "打开 BDK 官方登录流程")]
    Login,
    #[command(about = "核对账号后连接 MCP 和 Skill；可重复执行")]
    Connect {
        #[arg(long, help = "已核对 BDK 与 Grok Bot 登录同一账号")]
        confirm_account: bool,
    },
    #[command(about = "只读检查 BDK、服务、MCP、Skill 和名单状态")]
    Status,
    #[command(about = "启动 PALBOO 管理的 BDK 服务")]
    Start,
    #[command(about = "停止本机接入；不停止云端 Bot 任务")]
    Stop,
    #[command(about = "移除本工具注册的接入，保留 BDK 状态和登录")]
    Uninstall,
    #[command(hide = true)]
    Register {
        #[arg(long)]
        installation_id: String,
    },
    #[command(hide = true)]
    Unregister {
        #[arg(long)]
        installation_id: String,
    },
}
#[derive(rust_embed::RustEmbed)]
#[folder = "scripts/grokbot-setup/"]
struct SetupAssets;
#[derive(rust_embed::RustEmbed)]
#[folder = "scripts/grokbot-adapter/"]
struct AdapterAssets;
fn expected_server(id: &str) -> Table {
    let mut table = Table::new();
    table
        .decor_mut()
        .set_prefix(format!("\n# PALBOO Grok Bot installation {id}\n"));
    table["url"] = value("http://127.0.0.1:3417/v1/mcp");
    table["enabled_tools"] = value(toml_edit::Array::from_iter(["call_tool"]));
    table["tool_timeout_sec"] = value(180);
    table
}
fn edit_registration(text: &str, remove: bool, id: &str) -> Result<String> {
    uuid::Uuid::parse_str(id).context("无效的安装身份")?;
    let mut doc = text
        .parse::<DocumentMut>()
        .context("Codex 配置不是有效 TOML")?;
    let expected = expected_server(id);
    if let Some(actual) = doc.get("mcp_servers").and_then(|v| v.get("grokbot")) {
        let table = actual.as_table().context("MCP 配置已改变")?;
        ensure!(
            table
                .decor()
                .prefix()
                .and_then(|s| s.as_str())
                .is_some_and(|s| s
                    .lines()
                    .any(|l| l == format!("# PALBOO Grok Bot installation {id}"))),
            "已有 grokbot MCP 不属于本次安装，保留原配置"
        );
        let actual: toml::Value = format!("[grokbot]\n{table}").parse()?;
        let wanted: toml::Value = format!("[grokbot]\n{expected}").parse()?;
        ensure!(
            actual == wanted,
            "grokbot 配置已被修改，保留它；请在 Codex 中手动断开"
        );
        if !remove {
            return Ok(text.into());
        }
        doc["mcp_servers"]
            .as_table_mut()
            .context("MCP 配置已改变")?
            .remove("grokbot");
    } else if !remove {
        if doc.get("mcp_servers").is_none() {
            doc["mcp_servers"] = Item::Table(Table::new());
        }
        doc["mcp_servers"]
            .as_table_mut()
            .context("mcp_servers 需要标准 TOML 表，请先在 Codex 中检查")?
            .insert("grokbot", Item::Table(expected));
    }
    Ok(doc.to_string())
}
fn register(remove: bool, id: &str) -> Result<()> {
    use fs2::FileExt;
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or(dirs::home_dir().context("无法找到用户目录")?.join(".codex"));
    std::fs::create_dir_all(&home)?;
    let path = home.join("config.toml");
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(home.join("palboo-grokbot.lock"))?;
    lock.try_lock_exclusive()
        .context("另一个 PALBOO 接入操作正在写入配置")?;
    let original = match std::fs::read_to_string(&path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let updated = edit_registration(&original, remove, id)?;
    if updated != original {
        let backup = dirs::home_dir()
            .context("无法找到用户目录")?
            .join("Documents/Codex-Archive/backups/palboo-grokbot")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&backup)?;
        crate::config::write_private(&backup.join("config.toml"), original.as_bytes())?;
        ensure!(
            std::fs::read_to_string(&path).unwrap_or_default() == original,
            "Codex 配置在操作中发生变化，请重试"
        );
        crate::config::write_private(&path, updated.as_bytes())?;
    }
    Ok(())
}
pub fn run(action: Action) -> Result<()> {
    match action {
        Action::Register { installation_id } => return register(false, &installation_id),
        Action::Unregister { installation_id } => return register(true, &installation_id),
        _ => {}
    }
    let node = std::env::var_os("PALBOO_NODE").map(PathBuf::from).or_else(|| {
        ["node", "/opt/homebrew/bin/node", "/usr/local/bin/node"].into_iter().find(|p| Command::new(p).arg("--version").output().is_ok_and(|o| o.status.success())).map(PathBuf::from)
    }).context("Grok Bot 接入需要 Node.js 22.16+ 和 npm。请先从 https://nodejs.org 安装，再运行此命令；也可设置 PALBOO_NODE")?;
    let temp = tempfile::tempdir()?;
    for name in SetupAssets::iter() {
        let path = temp.path().join("grokbot-setup").join(name.as_ref());
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, SetupAssets::get(&name).unwrap().data)?;
    }
    for name in AdapterAssets::iter() {
        let path = temp.path().join("grokbot-adapter").join(name.as_ref());
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, AdapterAssets::get(&name).unwrap().data)?;
    }
    std::fs::write(
        temp.path().join("install-grokbot-adapter.mjs"),
        include_str!("../scripts/install-grokbot-adapter.mjs"),
    )?;
    let (name, confirm) = match action {
        Action::Setup => ("setup", false),
        Action::Login => ("login", false),
        Action::Connect { confirm_account } => ("connect", confirm_account),
        Action::Status => ("status", false),
        Action::Start => ("start", false),
        Action::Stop => ("stop", false),
        Action::Uninstall => ("uninstall", false),
        _ => unreachable!(),
    };
    let mut cmd = Command::new(node);
    cmd.arg(temp.path().join("grokbot-setup/main.mjs"))
        .arg(name)
        .env("PALBOO_HOST_CLI", std::env::current_exe()?);
    if confirm {
        cmd.arg("--confirm-account");
    }
    let result = cmd.status().context("无法运行 PALBOO 接入工具")?;
    if !result.success() {
        bail!("PALBOO 接入未完成；按上面的提示处理后重试")
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registration_preserves_other_config_and_refuses_foreign_or_changed_mcp() {
        let id = "10000000-0000-4000-8000-000000000000";
        let source = "# user comment\nmodel = \"example\"\n[mcp_servers.other]\nurl = \"https://example.com\"\n";
        let added = edit_registration(source, false, id).unwrap();
        assert!(added.starts_with(source));
        assert!(added.contains("enabled_tools = [\"call_tool\"]"));
        assert!(edit_registration(&added, false, "20000000-0000-4000-8000-000000000000").is_err());
        assert_eq!(edit_registration(&added, false, id).unwrap(), added);
        let removed = edit_registration(&added, true, id).unwrap();
        assert!(!removed.contains("mcp_servers.grokbot"));
        assert!(removed.contains("# user comment"));
        assert!(removed.contains("mcp_servers.other"));
        assert!(edit_registration(&added.replace("3417", "4444"), true, id).is_err());
    }
}
