// [INPUT]: 已连接宿主的无正文外观、现有启停偏好与共享启动器目录。
// [OUTPUT]: 0600 原子主题缓存；断开保留末次颜色，重复快照不写盘。
// [POS]: 启动前的原生提示与运行中后台共用，不包含聊天、令牌或模型配置。
// [PROTOCOL]: 变更时更新 src/AGENTS.md。
use crate::{config::write_private, state::App};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};

fn palette(source: &Value) -> Option<Value> {
    let theme = source["theme"].as_str()?;
    if !["light", "dark"].contains(&theme) {
        return None;
    }
    let mut colors = serde_json::Map::new();
    for key in ["page", "surface", "text", "muted", "accent", "danger"] {
        if let Some(color) = source["colors"][key]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 256)
        {
            colors.insert(key.into(), json!(color));
        }
    }
    if colors.is_empty() {
        return None;
    }
    Some(json!({"theme":theme,"colors":colors}))
}

fn snapshot(previous: &Value, view: &crate::state::View, data: &Path) -> Option<Value> {
    let connected = view.connection.status == "connected";
    if !connected && previous["dataDirectory"].as_str() != data.to_str() {
        return None;
    }
    let mut appearance = previous["settingsAppearance"].clone();
    if connected && let Some(mut current) = palette(&view.settings_appearance) {
        let mut palettes = previous["settingsAppearance"]["palettes"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        for mode in ["light", "dark"] {
            if let Some(value) = palette(&view.settings_appearance["palettes"][mode]) {
                palettes.insert(mode.into(), value);
            }
        }
        palettes.insert(current["theme"].as_str().unwrap().into(), current.clone());
        current["palettes"] = json!(palettes);
        current["reducedMotion"] = json!(
            view.settings_appearance["reducedMotion"]
                .as_bool()
                .unwrap_or(false)
        );
        appearance = current;
    }
    let prefs = &view.panel_preferences;
    Some(
        json!({"schemaVersion":1,"dataDirectory":data,"revision":prefs.revision,
        "language":prefs.language,"lifecyclePreview":prefs.lifecycle_preview,"settingsAppearance":appearance}),
    )
}

pub(crate) fn watch(app: Arc<App>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(paths) = crate::app_mode::shared_paths() else {
            return;
        };
        let file = paths.root.join("appearance-cache.json");
        let mut last: Value = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        let mut views = app.views.subscribe();
        loop {
            let view = views.borrow_and_update().clone();
            if let Some(next) = snapshot(&last, &view, &app.paths.root)
                && next != last
                && let Ok(bytes) = serde_json::to_vec(&next)
                && write_private(&file, &bytes).is_ok()
            {
                last = next;
            }
            if views.changed().await.is_err() {
                break;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_survives_disconnect_and_excludes_private_fields() {
        let root = tempfile::tempdir().unwrap();
        let paths = crate::config::Paths::new(Some(root.path().into())).unwrap();
        let app = App::new(paths.clone(), crate::config::Config::default(), None, true);
        let mut view = app.view();
        view.connection.status = "connected".into();
        view.settings_appearance = json!({"theme":"dark","colors":{"accent":"#a67df2","page":"#181818","token":"do-not-copy"},"private":"do-not-copy"});
        let saved = snapshot(&Value::Null, &view, &paths.root).unwrap();
        assert!(!saved.to_string().contains("do-not-copy"));
        assert_eq!(saved["settingsAppearance"]["colors"]["accent"], "#a67df2");
        view.connection.status = "disconnected".into();
        view.settings_appearance = Value::Null;
        assert_eq!(snapshot(&saved, &view, &paths.root).unwrap(), saved);
        assert!(snapshot(&saved, &view, Path::new("/other-session")).is_none());
        let file = root.path().join("appearance-cache.json");
        write_private(&file, &serde_json::to_vec(&saved).unwrap()).unwrap();
        let reopened: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        assert_eq!(reopened, saved);
        view.connection.status = "connected".into();
        view.settings_appearance = json!({"theme":"light","colors":{"accent":"#7849d1"}});
        let next = snapshot(&reopened, &view, &paths.root).unwrap();
        assert_eq!(next["settingsAppearance"]["theme"], "light");
        assert_eq!(
            next["settingsAppearance"]["palettes"]["dark"]["colors"]["accent"],
            "#a67df2"
        );
    }
}
