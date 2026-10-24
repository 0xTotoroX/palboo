// [INPUT]: OS roster/account/sidebar/UI-reference events, local BDK catalog and lifecycle.
// [OUTPUT]: Validated fresh or stale metadata with 60s health fallback; no reply cursor reads.
// [POS]: Palboo metadata transport. [PROTOCOL]: Keep src/AGENTS.md in sync.
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

// Only account, roster, saved sections and UI-reference events invalidate metadata.
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
        || (key.starts_with("sand.client.slice.account.")
            && [
                ".roster.last-roster",
                ".sidebar.last-sections",
                ".ui-agent-refs",
            ]
            .iter()
            .any(|suffix| key.ends_with(suffix)))
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
        && let Some(root) = crate::brand::env_os("PALBOO_TEST_GROKBOT_CACHE")
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
            json!({"version":1,"bots":[],"stale":true,"error":"Grok Bot 同步失败，请重试。"})
        }
    };
    c.at = Instant::now();
    c.value.clone()
}
async fn fetch() -> anyhow::Result<Value> {
    // Fixture override exists only in debug builds and must remain loopback.
    let base = if cfg!(debug_assertions) {
        crate::brand::env("PALBOO_TEST_GROKBOT_URL")
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
    anyhow::ensure!(valid_catalog(catalog), "catalog overlay required");
    Ok(catalog.clone())
}

fn valid_catalog(catalog: &Value) -> bool {
    let nonempty = |v: &Value| v.as_str().is_some_and(|s| !s.trim().is_empty());
    if catalog["version"] != 1
        || !nonempty(&catalog["account"])
        || !nonempty(&catalog["revision"])
        || !catalog["stale"].is_boolean()
    {
        return false;
    }
    let Some(bots) = catalog["bots"].as_array() else {
        return false;
    };
    let mut names = std::collections::HashMap::new();
    for bot in bots {
        if let Some(name) = bot["name"].as_str() {
            *names.entry(name).or_insert(0usize) += 1;
        }
    }
    let mut ids = std::collections::HashSet::new();
    bots.iter().all(|bot| {
        nonempty(&bot["id"])
            && ids.insert(bot["id"].as_str().unwrap())
            && nonempty(&bot["name"])
            && bot["available"].is_boolean()
            && bot.get("hidden").is_none_or(Value::is_boolean)
            && ["description", "preview"]
                .iter()
                .all(|key| bot.get(key).is_none_or(Value::is_string))
            && (!bot["available"].as_bool().unwrap()
                || names.get(bot["name"].as_str().unwrap()) == Some(&1))
    }) && catalog.get("sidebarError").is_none_or(Value::is_string)
        && valid_sidebar(catalog, bots)
}

fn valid_sidebar(catalog: &Value, bots: &[Value]) -> bool {
    let Some(sidebar) = catalog.get("sidebar") else {
        return true;
    };
    let Some(groups) = sidebar["groups"].as_array() else {
        return false;
    };
    if sidebar["version"] != 1 {
        return false;
    }
    let visible: std::collections::HashSet<_> = bots
        .iter()
        .filter(|b| b["hidden"] != true)
        .filter_map(|b| b["id"].as_str())
        .collect();
    let mut seen = std::collections::HashSet::new();
    let mut group_ids = std::collections::HashSet::new();
    for (index, group) in groups.iter().enumerate() {
        let Some(id) = group["id"].as_str().filter(|s| !s.trim().is_empty()) else {
            return false;
        };
        let Some(kind) = group["kind"].as_str() else {
            return false;
        };
        let Some(ids) = group["botIds"].as_array() else {
            return false;
        };
        if !group_ids.insert(id)
            || !group["name"].is_string()
            || !matches!(kind, "pinned" | "section" | "unassigned")
            || (kind == "pinned" && index != 0)
        {
            return false;
        }
        for id in ids {
            let Some(id) = id.as_str() else {
                return false;
            };
            if !visible.contains(id) || !seen.insert(id) {
                return false;
            }
        }
    }
    seen == visible
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sidebar_must_partition_visible_bots_without_forged_or_duplicate_ids() {
        let good = json!({"version":1,"account":"fixture","revision":"r1","stale":false,
            "bots":[{"id":"a","name":"A","available":true},
                    {"id":"b","name":"B","available":true,"hidden":true}],
            "sidebar":{"version":1,"groups":[{"id":"pins","kind":"pinned","name":"置顶","botIds":["a"]}]}});
        assert!(valid_catalog(&good));
        let mut cached = good.clone();
        cached["stale"] = json!(true);
        assert!(valid_catalog(&cached), "stale metadata remains readable");
        for ids in [
            json!([]),
            json!(["a", "a"]),
            json!(["a", "b"]),
            json!(["unknown"]),
        ] {
            let mut value = good.clone();
            value["sidebar"]["groups"][0]["botIds"] = ids;
            assert!(!valid_catalog(&value));
        }
        for invalid in [
            Value::Null,
            json!({"version":2,"groups":[]}),
            json!({"version":1}),
        ] {
            let mut value = good.clone();
            value["sidebar"] = invalid;
            assert!(!valid_catalog(&value));
        }
        let mut legacy = good.clone();
        legacy.as_object_mut().unwrap().remove("sidebar");
        legacy["sidebarError"] = json!("layout unavailable");
        assert!(valid_catalog(&legacy));
    }
    #[test]
    fn incomplete_catalogs_cannot_be_used_as_verified_identities() {
        let good = json!({"version":1,"account":"fixture","revision":"r1","stale":false,
            "bots":[{"id":"bot-1","name":"Synthetic Bot","available":true}]});
        assert!(valid_catalog(&good));
        for key in ["account", "revision", "stale"] {
            for invalid in [Value::Null, json!(""), json!(42)] {
                let mut value = good.clone();
                value[key] = invalid;
                assert!(!valid_catalog(&value), "invalid {key}");
            }
        }
        for key in ["id", "name", "available"] {
            let mut value = good.clone();
            value["bots"][0].as_object_mut().unwrap().remove(key);
            assert!(!valid_catalog(&value), "missing bot {key}");
        }
        for invalid in [
            Value::Null,
            json!("bot"),
            json!({"name":"Synthetic Bot","available":true}),
        ] {
            let mut value = good.clone();
            value["bots"][0] = invalid;
            assert!(!valid_catalog(&value));
        }
        let mut duplicated = good.clone();
        duplicated["bots"]
            .as_array_mut()
            .unwrap()
            .push(good["bots"][0].clone());
        assert!(!valid_catalog(&duplicated));
    }
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
    fn only_saved_catalog_keys_invalidate() {
        for key in [
            "sand.client.slice.client-meta.account-slot",
            "sand.client.slice.account.fixture.roster.last-roster",
            "sand.client.slice.account.fixture.sidebar.last-sections",
            "sand.client.slice.account.fixture.ui-agent-refs",
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
