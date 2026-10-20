// [INPUT]: Local BDK read-only catalog overlay; existing feature read lifecycle.
// [OUTPUT]: Bounded cached roster, or explicit unavailable state; no reply cursor reads.
// [POS]: PALBOO metadata transport. [PROTOCOL]: Keep src/AGENTS.md in sync.
use serde_json::{Value, json};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
struct Cache {
    at: Instant,
    value: Value,
}
static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();
pub async fn catalog(force: bool) -> Value {
    let mut cache = CACHE.get_or_init(|| Mutex::new(None)).lock().await;
    if !force
        && let Some(c) = cache.as_ref()
        && c.at.elapsed() < Duration::from_secs(5)
    {
        return c.value.clone();
    }
    let value = match fetch().await {
        Ok(value) => value,
        Err(_) => {
            json!({"version":1,"bots":[],"stale":true,"error":"无法同步 Grok Bot，请检查本地 BDK 接入和应用登录状态。"})
        }
    };
    *cache = Some(Cache {
        at: Instant::now(),
        value: value.clone(),
    });
    value
}
async fn fetch() -> anyhow::Result<Value> {
    // Fixture override exists only in debug builds and must remain loopback.
    let base = if cfg!(debug_assertions) {
        std::env::var("CODEX_BUDDY_TEST_GROKBOT_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3417".into())
    } else {
        "http://127.0.0.1:3417".into()
    };
    let url = reqwest::Url::parse(&base)?;
    anyhow::ensure!(
        url.scheme() == "http" && url.host_str() == Some("127.0.0.1"),
        "not loopback"
    );
    let mut response = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()?
        .post(format!("{base}/v1/tools/grokbot__list"))
        .json(&json!({"input":{}}))
        .send()
        .await?
        .error_for_status()?;
    anyhow::ensure!(
        response.content_length().unwrap_or(0) < 2_000_000,
        "catalog too large"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        anyhow::ensure!(bytes.len() + chunk.len() <= 2_000_000, "catalog too large");
        bytes.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&bytes)?;
    anyhow::ensure!(body["isError"] != true, "BDK catalog failed");
    let catalog = &body["result"]["catalog"];
    anyhow::ensure!(
        catalog["version"] == 1 && catalog["bots"].is_array(),
        "catalog overlay required"
    );
    Ok(catalog.clone())
}
