// [INPUT]: 本机认证设置或 CLI 的计数、范围预览、确认请求及当前桌面连接。
// [OUTPUT]: 当前宿主负责的 CLI 分组数量、短时预览和实际批量归档结果。
// [POS]: 仅允许固定归档操作，不接收脚本、聊天 ID 列表或宿主路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::state::App;
use anyhow::{Context, Result, bail, ensure};
use clap::Args;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

pub(crate) const PATH: &str = "chat-archive";
pub(crate) const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Args, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Filters {
    /// 项目 ID（通过 --list 查看）或 projectless
    #[arg(long, conflicts_with_all = ["list", "confirm"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
    /// 日期依据：updated 或 created（默认 updated）
    #[arg(long, value_parser = ["updated", "created"], conflicts_with_all = ["list", "confirm", "inactive_days"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    date_field: Option<String>,
    /// 起始日期 YYYY-MM-DD，包含当天
    #[arg(long, conflicts_with_all = ["list", "confirm", "inactive_days"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    /// 结束日期 YYYY-MM-DD，包含当天
    #[arg(long, conflicts_with_all = ["list", "confirm", "inactive_days"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    through: Option<String>,
    /// 最近一次活动距今超过的天数
    #[arg(long, conflicts_with_all = ["list", "confirm"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    inactive_days: Option<u32>,
    /// 每个项目保留最近活动的聊天数量
    #[arg(long, conflicts_with_all = ["list", "confirm"])]
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_recent: Option<u32>,
    /// 保留置顶、运行中和有计划任务的聊天，停止于首次失败并复核结果
    #[arg(long, conflicts_with_all = ["list", "confirm"])]
    protect: bool,
}

impl Filters {
    pub(crate) fn verify_preview(&self, result: &Value) -> Result<()> {
        let expected = serde_json::to_value(self)?;
        let fields = expected
            .as_object()
            .context("归档规则无效，请检查项目、日期和保留数量。")?;
        ensure!(
            fields.iter().all(|(key, value)| {
                (key == "protect" && value.as_bool() == Some(false))
                    || result["filters"][key] == *value
            }),
            "当前 Palboo 连接未确认所选归档规则，请重新预览。"
        );
        Ok(())
    }
}

pub(crate) async fn command(app: &App, input: Value) -> Result<Value> {
    let (operation, id, cli) = match input["op"].as_str() {
        Some("list") => ("list", None, None),
        Some("preview") => {
            let cli = match &input["cli"] {
                Value::Null => None,
                Value::String(cli) if !cli.trim().is_empty() && cli.chars().count() <= 256 => {
                    Some(cli.as_str())
                }
                _ => bail!("无效的 CLI 归档范围"),
            };
            ("preview", None, cli)
        }
        Some("apply") => {
            let id = input["id"].as_str().context("缺少有效的归档预览标识")?;
            ensure!(uuid::Uuid::parse_str(id).is_ok(), "缺少有效的归档预览标识");
            ("apply", Some(id), None)
        }
        _ => bail!("未知的本地聊天归档操作"),
    };
    let filters = match input.get("filters") {
        Some(value) if operation == "preview" => {
            serde_json::from_value::<Filters>(value.clone())
                .context("归档规则无效，请检查项目、日期和保留数量。")?
        }
        None => Filters::default(),
        _ => bail!("归档规则只能随预览提供"),
    };
    let client = app.desktop_client().await.context("尚未连接 Codex")?;
    let expression = format!(
        r#"(async () => {{
          const run = window.__companionFloatingPanel?.archiveLocalChats;
          if (!run) return {{ error: '当前 ChatGPT 桌面版无法批量归档本地聊天。' }};
          try {{ return await run({}, {}, {}, {}); }}
          catch (error) {{ return {{ error: String(error?.message || error) }}; }}
        }})()"#,
        json!(operation),
        json!(id),
        json!(cli),
        json!(filters),
    );
    let result = client.evaluate_with_timeout(expression, TIMEOUT).await?;
    if let Some(error) = result["error"].as_str() {
        bail!("{error}");
    }
    if operation == "preview" {
        filters.verify_preview(&result)?;
    }
    // Once writes begin, retain the observed partial result even if a different
    // window has since connected. A preview from a former window is unusable.
    if operation != "apply" {
        ensure!(
            app.desktop_client()
                .await
                .is_some_and(|active| Arc::ptr_eq(&client, &active)),
            "Codex 连接已变化，请重试"
        );
    }
    ensure!(
        result.is_object(),
        "未能取得本地聊天归档结果，请在已归档的聊天中核查。"
    );
    Ok(result)
}
