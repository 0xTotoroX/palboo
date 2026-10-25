// [INPUT]: Authenticated local Runtime, explicit user files and backend catalogs.
// [OUTPUT]: Read-only catalogs, opaque glossary uploads and personal-only exports.
// [POS]: CLI file boundary; never writes live configuration or invokes a chat Agent.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::redacted;
use crate::lifecycle::Runtime;
use anyhow::{Context, Result, ensure};
use clap::{Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::Path,
};

#[derive(Subcommand)]
pub enum Catalog {
    /// 当前建议生成服务提供的模型列表；Codex 快切模型见 config get model-control
    Models,
    /// 本机显示器标识，供 surfaces.edge.screen 使用
    Displays,
    /// 读取已有 Bot 名单；--refresh 显式刷新，不编辑外部 Bot 配置
    Bots {
        #[arg(long)]
        refresh: bool,
    },
}
impl Catalog {
    pub(super) fn read(self) -> (&'static str, Option<Value>) {
        match self {
            Self::Models => ("settings/models", None),
            Self::Displays => ("surfaces/displays", None),
            Self::Bots { refresh } => (
                "features",
                Some(json!({"op":"bots-catalog","refresh":refresh})),
            ),
        }
    }
}
#[derive(Clone, Copy, ValueEnum)]
pub enum LibraryScope {
    Terminology,
}
#[derive(Clone, Copy, ValueEnum)]
pub enum ExportFormat {
    Json,
    Markdown,
}

pub(super) async fn import(runtime: &Runtime, path: &Path, dry_run: bool) -> Result<Value> {
    let file = std::fs::File::open(path).context("无法打开导入文件")?;
    ensure!(file.metadata()?.is_file(), "请提供普通文件");
    let mut bytes = Vec::new();
    file.take(crate::terminology_import::MAX_FILE as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        !bytes.is_empty() && bytes.len() <= crate::terminology_import::MAX_FILE,
        "文件需为 1 字节至 8 MB"
    );
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .context("文件名无效")?;
    if dry_run {
        return Ok(
            json!({"dryRun":true,"filename":name,"bytes":bytes.len(),"execution":"next-user-message","uploaded":false}),
        );
    }
    let current = runtime.upload_terminology(name, bytes).await?;
    Ok(json!({"queued":true,"execution":"next-user-message","current":current}))
}

pub(super) async fn export(
    runtime: &Runtime,
    format: ExportFormat,
    output: Option<&Path>,
) -> Result<()> {
    let result = runtime
        .request("terminology", Some(json!({"action":"export"})))
        .await?;
    let contents = match format {
        ExportFormat::Json => serde_json::to_string_pretty(&redacted(&result))?,
        ExportFormat::Markdown => result["markdown"]
            .as_str()
            .context("后台未返回术语文档")?
            .into(),
    };
    if let Some(path) = output {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .context("无法创建导出文件；已有文件不会被覆盖")?;
        file.write_all(contents.as_bytes())?;
        println!(
            "{}",
            json!({"exported":true,"file":path,"bytes":contents.len()})
        );
    } else {
        println!("{contents}");
    }
    Ok(())
}
