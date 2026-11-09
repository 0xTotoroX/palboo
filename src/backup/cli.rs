// [INPUT]: Explicit local transfer commands and optional passphrase file/stdin.
// [OUTPUT]: Private backup files, redacted previews and guarded application through the existing service.
// [POS]: Thin CLI client; does not edit running configuration files directly.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use clap::Subcommand;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    path::PathBuf,
};
#[derive(Subcommand)]
pub enum Command {
    /// 列出本机来源、配置模块和上次恢复结果
    Status,
    /// 导出配置；包含密钥时必须提供密码文件（- 表示标准输入）
    Export {
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        include_data: bool,
        #[arg(long)]
        include_secrets: bool,
        #[arg(long)]
        password_file: Option<PathBuf>,
    },
    /// 只预览导入差异，返回 apply 使用的 previewId
    Preview {
        #[arg(long)]
        file: PathBuf,
        #[arg(long, default_value = "current")]
        target: String,
        #[arg(long, value_delimiter = ',')]
        sections: Vec<String>,
        #[arg(long)]
        password_file: Option<PathBuf>,
    },
    /// 只预览本机环境之间的复制
    Copy {
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
        #[arg(long, value_delimiter = ',')]
        sections: Vec<String>,
    },
    /// 应用刚才预览的覆盖范围；预览后目标改变则拒绝
    Apply {
        #[arg(long)]
        preview_id: String,
        #[arg(long)]
        confirm: bool,
    },
    /// 预览恢复上次操作前的配置；之后仍需 apply
    Undo {
        #[arg(long, default_value = "current")]
        target: String,
    },
}
fn password(file: Option<PathBuf>) -> Result<String> {
    let Some(file) = file else {
        return Ok(String::new());
    };
    let mut value = String::new();
    if file.as_os_str() == "-" {
        std::io::stdin().take(1025).read_to_string(&mut value)?;
    } else {
        std::fs::File::open(file)?
            .take(1025)
            .read_to_string(&mut value)?;
    }
    ensure!(value.len() <= 1024, "备份密码过长");
    Ok(value.trim_end_matches(['\r', '\n']).to_owned())
}
fn sections(values: Vec<String>) -> Vec<String> {
    if values.is_empty() {
        super::archive::SECTIONS
            .iter()
            .filter(|(id, _)| !["data", "machine", "secrets"].contains(id))
            .map(|(id, _)| (*id).into())
            .collect()
    } else {
        values
    }
}
pub async fn run(paths: &crate::config::Paths, command: Command) -> Result<()> {
    let mut output = None;
    let body = match command {
        Command::Status => json!({"op":"status"}),
        Command::Export {
            output: file,
            include_data,
            include_secrets,
            password_file,
        } => {
            ensure!(!file.exists(), "输出文件已存在，请选择新文件");
            output = Some(file);
            json!({"op":"export","includeData":include_data,"includeSecrets":include_secrets,"password":password(password_file)?})
        }
        Command::Preview {
            file,
            target,
            sections: selected,
            password_file,
        } => {
            ensure!(
                std::fs::metadata(&file)?.len() <= super::archive::LIMIT as u64,
                "备份超过 128 MB"
            );
            json!({"op":"preview","data":super::archive::base64(&std::fs::read(file)?),"target":target,"sections":sections(selected),"password":password(password_file)?})
        }
        Command::Copy {
            source,
            target,
            sections: selected,
        } => {
            let selected = sections(selected);
            json!({"op":"copy","source":source,"target":target,"includeData":selected.iter().any(|s|s=="data"),"includeSecrets":selected.iter().any(|s|s=="secrets"),"sections":selected})
        }
        Command::Apply {
            preview_id,
            confirm,
        } => json!({"op":"apply","previewId":preview_id,"confirm":confirm}),
        Command::Undo { target } => json!({"op":"undo","target":target}),
    };
    let runtime = crate::lifecycle::Runtime::read(paths).context("请先打开 Palboo 本地服务")?;
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(120))
        .build()?
        .post(format!("http://127.0.0.1:{}/api/backup", runtime.port))
        .bearer_auth(runtime.token)
        .json(&body)
        .send()
        .await?;
    let status = response.status();
    let result: Value = response.json().await?;
    ensure!(
        status.is_success(),
        "{}",
        result["message"].as_str().unwrap_or("备份操作失败")
    );
    if let Some(output) = output {
        let bytes = super::archive::unbase64(result["data"].as_str().context("备份响应无效")?)?;
        let parent = output
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist_noclobber(&output)?;
        println!("{}", json!({"ok":true,"output":output}));
    } else {
        println!("{}", serde_json::to_string_pretty(&result)?);
    }
    Ok(())
}
