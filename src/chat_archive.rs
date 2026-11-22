// [INPUT]: 本机认证设置或 CLI 的预览、确认请求，以及当前桌面连接。
// [OUTPUT]: 当前宿主负责的短时预览和实际批量归档结果。
// [POS]: 仅允许固定归档操作，不接收脚本、聊天 ID 列表或宿主路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::state::App;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

pub(crate) const PATH: &str = "chat-archive";
pub(crate) const TIMEOUT: Duration = Duration::from_secs(180);

pub(crate) async fn command(app: &App, input: Value) -> Result<Value> {
    let (operation, id) = match input["op"].as_str() {
        Some("preview") => ("preview", None),
        Some("apply") => {
            let id = input["id"].as_str().context("缺少有效的归档预览标识")?;
            ensure!(uuid::Uuid::parse_str(id).is_ok(), "缺少有效的归档预览标识");
            ("apply", Some(id))
        }
        _ => bail!("未知的本地聊天归档操作"),
    };
    let client = app.desktop_client().await.context("尚未连接 Codex")?;
    let expression = format!(
        r#"(async () => {{
          const run = window.__companionFloatingPanel?.archiveLocalChats;
          if (!run) return {{ error: '当前 ChatGPT 桌面版无法批量归档本地聊天。' }};
          try {{ return await run({}, {}); }}
          catch (error) {{ return {{ error: String(error?.message || error) }}; }}
        }})()"#,
        json!(operation),
        json!(id),
    );
    let result = client.evaluate_with_timeout(expression, TIMEOUT).await?;
    if let Some(error) = result["error"].as_str() {
        bail!("{error}");
    }
    // Once writes begin, retain the observed partial result even if a different
    // window has since connected. A preview from a former window is unusable.
    if operation == "preview" {
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
