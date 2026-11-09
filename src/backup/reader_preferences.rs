// [INPUT]: Reader-only layout preferences previously stored in browser localStorage.
// [OUTPUT]: Bounded durable preferences included in local configuration backups.
// [POS]: Shared with the reader's own authenticated endpoint; excludes reading history and credentials.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Result, ensure};
use serde_json::{Value, json};
pub fn validate(value: &Value) -> Result<()> {
    let Some(object) = value.as_object() else {
        anyhow::bail!("阅读器设置无效");
    };
    ensure!(object.len() <= 3, "阅读器设置字段无效");
    for (key, value) in object {
        ensure!(
            match key.as_str() {
                "sidebarWidth" | "infoWidth" =>
                    value.as_f64().is_some_and(|v| (160.0..=640.0).contains(&v)),
                "sidebarPinned" => value.is_boolean(),
                _ => false,
            },
            "阅读器设置值无效"
        );
    }
    Ok(())
}
pub fn read(paths: &crate::config::Paths) -> Result<Value> {
    let value = super::snapshot::read(&paths.root, "reader-preferences.json")?
        .map(|bytes| serde_json::from_slice(&bytes))
        .transpose()?
        .unwrap_or_else(|| json!({}));
    validate(&value)?;
    Ok(value)
}
pub fn save(paths: &crate::config::Paths, value: Value) -> Result<Value> {
    static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITES.lock().unwrap_or_else(|poison| poison.into_inner());
    validate(&value)?;
    let mut current = read(paths)?;
    super::snapshot::merge(&mut current, &value);
    crate::config::write_private(
        &paths.root.join("reader-preferences.json"),
        &serde_json::to_vec(&current)?,
    )?;
    Ok(current)
}
