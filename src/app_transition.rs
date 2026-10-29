// [INPUT]: 私有进度页回执、共享操作锁及一次性异步交接动作。
// [OUTPUT]: run；页面接手后才执行动作，退出后台后继续显示成功或恢复结果。
// [POS]: App 模式切换与手动更新共用的短期进度服务，无常驻管理器。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::config::write_private;
use anyhow::Result;
use axum::{
    Json, Router,
    response::Html,
    routing::{get, post},
};
use serde_json::{Value, json};
use std::{future::Future, path::Path, sync::Arc, time::Duration};
use tokio::sync::{Notify, RwLock};

pub type Progress = Arc<RwLock<Value>>;
pub async fn run<F, Fut>(
    ready: &Path,
    return_url: &str,
    language: Option<&str>,
    title_zh: &str,
    title_en: &str,
    guard: std::fs::File,
    operation: F,
) -> Result<()>
where
    F: FnOnce(Progress) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    if let Some(language) = language {
        crate::i18n::set_language(language);
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    let route = format!("/switch/{token}");
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let progress = Arc::new(RwLock::new(
        json!({"phase":"preparing","message":crate::i18n::text(title_zh, title_en)}),
    ));
    let state = progress.clone();
    let acknowledged = Arc::new(Notify::new());
    let ack = acknowledged.clone();
    let page = TRANSITION_PAGE
        .replace("__STATE__", &format!("{route}/state"))
        .replace(
            "lang=\"zh-CN\"",
            crate::i18n::text("lang=\"zh-CN\"", "lang=\"en\""),
        )
        .replace("正在切换运行模式…", crate::i18n::text(title_zh, title_en))
        .replace(
            "返回设置",
            crate::i18n::text("返回设置", "Return to settings"),
        )
        .replace(
            "切换状态暂时不可达，请重新打开 Palboo。",
            crate::i18n::text(
                "切换状态暂时不可达，请重新打开 Palboo。",
                "Switch status is unavailable. Reopen Palboo.",
            ),
        )
        .replace(
            "未开始切换，请重新打开设置。",
            crate::i18n::text(
                "未开始切换，请重新打开设置。",
                "Switching has not started. Reopen settings.",
            ),
        );
    let router = Router::new()
        .route(
            &format!("{route}/state/start"),
            post(move || {
                let ack = ack.clone();
                async move {
                    ack.notify_one();
                    Json(json!({"ok":true}))
                }
            }),
        )
        .route(&route, get(move || async { Html(page) }))
        .route(
            &format!("{route}/state"),
            get(move || {
                let state = state.clone();
                async move { Json(state.read().await.clone()) }
            }),
        );
    let task = tokio::spawn(async move { axum::serve(listener, router).await });
    write_private(
        ready,
        &serde_json::to_vec(&json!({"url":format!("http://127.0.0.1:{port}{route}")}))?,
    )?;
    let outcome = if tokio::time::timeout(Duration::from_secs(45), acknowledged.notified())
        .await
        .is_ok()
    {
        operation(progress.clone()).await
    } else {
        Err(anyhow::anyhow!(crate::i18n::text(
            "进度页面未打开，操作未执行。",
            "The progress page did not open. No changes were made."
        )))
    };
    match outcome {
        Ok(value) => *progress.write().await = json!({"phase":"done","url":value["url"]}),
        Err(error) => {
            if progress.read().await["phase"] != "failed" {
                *progress.write().await =
                    json!({"phase":"failed","message":error.to_string(),"url":return_url});
            }
        }
    }
    drop(guard);
    tokio::time::sleep(Duration::from_secs(120)).await;
    task.abort();
    Ok(())
}

const TRANSITION_PAGE: &str = r#"<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Palboo</title><style>:root{color-scheme:light dark}body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:34em;padding:32px}h1{font-size:24px}p{line-height:1.7}a{color:inherit}</style><main><h1>Palboo</h1><p role="status">正在切换运行模式…</p><a hidden>返回设置</a></main><script>const p=document.querySelector('p'),a=document.querySelector('a');async function poll(){try{const r=await fetch('__STATE__',{cache:'no-store'}),s=await r.json();if(s.phase==='done'){location.replace(s.url);return}p.textContent=s.message;if(s.phase==='failed'){a.href=s.url;a.hidden=false;return}setTimeout(poll,700)}catch{p.textContent='切换状态暂时不可达，请重新打开 Palboo。'}}fetch('__STATE__/start',{method:'POST'}).then(poll).catch(()=>{p.textContent='未开始切换，请重新打开设置。'})</script></html>"#;
