// [INPUT]: OS roster/account file events, local BDK catalog and feature lifecycle.
// [OUTPUT]: Event-invalidated catalog with 60s health fallback; no reply cursor reads.
// [POS]: PALBOO metadata transport. [PROTOCOL]: Keep src/AGENTS.md in sync.
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

// The UI may read frequently; only roster/account file events invalidate metadata.
// No per-file content reads in the event handler, and no chat cache files are read.
struct RosterWatch {
    _watcher: RecommendedWatcher,
    generation: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
}
fn relevant(path: &Path) -> bool {
    let Some(name) = path
        .file_name()
        .and_then(|v| v.to_str())
        .and_then(|v| v.strip_suffix(".blob"))
    else {
        return false;
    };
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut bytes = Vec::new();
    for byte in name.bytes() {
        let n = match byte {
            b'a'..=b'z' => byte - b'a',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return false,
        };
        value = (value << 5) | u32::from(n);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((value >> bits) as u8);
        }
    }
    let key = String::from_utf8_lossy(&bytes);
    key == "sand.client.slice.client-meta.account-slot"
        || (key.starts_with("sand.client.slice.account.") && key.ends_with(".roster.last-roster"))
}
impl RosterWatch {
    fn new(root: &Path) -> notify::Result<Self> {
        let generation = Arc::new(AtomicU64::new(1));
        let failed = Arc::new(AtomicBool::new(false));
        let changed = generation.clone();
        let error = failed.clone();
        let watched = root.to_path_buf();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
                Ok(event)
                    if !matches!(event.kind, notify::EventKind::Access(_))
                        && (event.need_rescan()
                            || event.paths.is_empty()
                            || event.paths.iter().any(|p| p == &watched || relevant(p))) =>
                {
                    changed.fetch_add(1, Ordering::Relaxed);
                }
                Err(_) => {
                    error.store(true, Ordering::Relaxed);
                    changed.fetch_add(1, Ordering::Relaxed);
                }
                _ => {}
            })?;
        watcher.watch(root, RecursiveMode::NonRecursive)?;
        Ok(Self {
            _watcher: watcher,
            generation,
            failed,
        })
    }
}
struct Cache {
    at: Instant,
    value: Value,
    generation: u64,
    watcher: Option<RosterWatch>,
    auto_sync: bool,
}
static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();
fn cache_root() -> PathBuf {
    if cfg!(debug_assertions)
        && let Some(root) = std::env::var_os("CODEX_BUDDY_TEST_GROKBOT_CACHE")
    {
        return root.into();
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join("Library/Application Support/Grok Bot/sand-client-persistence")
}
pub async fn stop() {
    // Drop the OS subscription and cached account data when the feature stops.
    *CACHE.get_or_init(|| Mutex::new(None)).lock().await = None;
}
pub async fn pause_sync() {
    if let Some(c) = CACHE.get_or_init(|| Mutex::new(None)).lock().await.as_mut() {
        c.watcher = None;
        c.auto_sync = false;
    }
}
pub async fn catalog(force: bool, auto_sync: bool) -> Value {
    let mut cache = CACHE.get_or_init(|| Mutex::new(None)).lock().await;
    let c = cache.get_or_insert_with(|| Cache {
        at: Instant::now(),
        value: Value::Null,
        generation: 0,
        watcher: None,
        auto_sync: false,
    });
    let starting = auto_sync && !c.auto_sync;
    c.auto_sync = auto_sync;
    if !auto_sync {
        c.watcher = None;
        if !force && !c.value.is_null() {
            return c.value.clone();
        }
    }
    let generation = c
        .watcher
        .as_ref()
        .map_or(0, |w| w.generation.load(Ordering::Relaxed));
    let failed = c
        .watcher
        .as_ref()
        .is_some_and(|w| w.failed.load(Ordering::Relaxed));
    let retry = if c.value.get("error").is_some() {
        Duration::from_secs(5)
    } else {
        Duration::from_secs(60)
    };
    if !force
        && !starting
        && !c.value.is_null()
        && generation == c.generation
        && !failed
        && c.at.elapsed() < retry
    {
        return c.value.clone();
    }
    if auto_sync && (c.watcher.is_none() || failed || c.at.elapsed() >= Duration::from_secs(60)) {
        // Re-arm after directory replacement, watcher errors or missed OS events.
        c.watcher = RosterWatch::new(&cache_root()).ok();
    }
    // Capture before fetching: an event during HTTP must remain pending for the next read.
    c.generation = c
        .watcher
        .as_ref()
        .map_or(0, |w| w.generation.load(Ordering::Relaxed));
    c.value = match fetch().await {
        Ok(value) => value,
        Err(_) => {
            json!({"version":1,"bots":[],"stale":true,"error":"无法同步 Grok Bot。请在设置 → Grok Bot 复制接入 Prompt，交给 Agent 检查连接。"})
        }
    };
    c.at = Instant::now();
    c.value.clone()
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
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("local HTTP client")
    });
    let mut response = client
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

#[cfg(test)]
mod tests {
    use super::*;
    fn filename(key: &str) -> String {
        let alphabet = b"abcdefghijklmnopqrstuvwxyz234567";
        let (mut bits, mut value) = (0, 0u32);
        let mut output = String::new();
        for b in key.bytes() {
            value = (value << 8) | u32::from(b);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                output.push(alphabet[((value >> bits) & 31) as usize] as char);
            }
        }
        if bits > 0 {
            output.push(alphabet[((value << (5 - bits)) & 31) as usize] as char);
        }
        format!("{output}.blob")
    }
    #[test]
    fn only_roster_and_account_keys_invalidate() {
        for key in [
            "sand.client.slice.client-meta.account-slot",
            "sand.client.slice.account.fixture.roster.last-roster",
        ] {
            assert!(relevant(Path::new(&filename(key))));
        }
        assert!(!relevant(Path::new(&filename(
            "sand.client.slice.account.fixture.full-chat"
        ))));
        assert!(!relevant(Path::new("unknown.blob")));
    }
    #[tokio::test]
    async fn watches_atomic_replacement_and_releases_subscription() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join(filename(
            "sand.client.slice.account.fixture.roster.last-roster",
        ));
        std::fs::write(&target, "old").unwrap();
        let watch = RosterWatch::new(root.path()).unwrap();
        let initial = watch.generation.load(Ordering::Relaxed);
        let stage = root.path().join("stage");
        std::fs::write(&stage, "new").unwrap();
        std::fs::rename(&stage, &target).unwrap();
        tokio::time::timeout(Duration::from_secs(6), async {
            while watch.generation.load(Ordering::Relaxed) == initial {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("atomic roster replacement must invalidate");
        let counter = watch.generation.clone();
        drop(watch);
        let stopped = counter.load(Ordering::Relaxed);
        std::fs::write(target, "after close").unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(counter.load(Ordering::Relaxed), stopped);
    }
}
