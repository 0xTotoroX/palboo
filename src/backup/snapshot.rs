// [INPUT]: Palboo-owned persisted preferences and explicit section selection.
// [OUTPUT]: Complete configuration projections, field-level previews and target-preserving restore files.
// [POS]: Separates portable preferences, private data, secrets and machine-local grants.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::archive::{Archive, Files, SECTIONS, Section};
use crate::config::{Paths, VERSION};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub const FILES: &[&str] = &[
    "config.json",
    "panel.json",
    "features.json",
    "surfaces.json",
    "model-control.json",
    "web-library.json",
    "tasks.json",
    "terminology-settings.json",
    "terminology-store.json",
    "terminology-library.json",
    "terminology-manual.json",
    "secrets.json",
    "reader-preferences.json",
];
pub fn read(root: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    let path = root.join(name);
    let mut ancestor = root.to_path_buf();
    for part in Path::new(name).components() {
        let std::path::Component::Normal(part) = part else {
            anyhow::bail!("备份路径无效");
        };
        ancestor.push(part);
        if let Ok(meta) = std::fs::symlink_metadata(&ancestor) {
            ensure!(
                !meta.file_type().is_symlink(),
                "配置和导入原件不能位于链接内"
            );
        }
    }
    match std::fs::symlink_metadata(&path) {
        Ok(meta) => {
            ensure!(
                meta.is_file() && !meta.file_type().is_symlink(),
                "配置或原件必须是普通文件"
            );
            ensure!(meta.len() <= super::archive::LIMIT as u64, "配置或原件过大");
            Ok(Some(std::fs::read(path)?))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn load(root: &Path, name: &str, default: Value) -> Result<Value> {
    read(root, name)?
        .map(|b| serde_json::from_slice(&b).context("配置文件损坏，原数据未改动"))
        .unwrap_or(Ok(default))
}
fn take(value: &mut Value, keys: &[&str]) -> Value {
    let mut out = json!({});
    for key in keys {
        if let Some(v) = value.as_object_mut().and_then(|o| o.remove(*key)) {
            out[*key] = v;
        }
    }
    out
}
fn section(archive: &mut Archive, id: &str, file: &str, value: Value) {
    archive
        .sections
        .entry(id.into())
        .or_insert_with(|| Section {
            version: 1,
            files: BTreeMap::new(),
        })
        .files
        .insert(file.into(), value);
}
pub fn capture(paths: &Paths, data: bool, secrets: bool) -> Result<Archive> {
    let mut out = Archive {
        format: "palboo-backup".into(),
        version: 1,
        app_version: VERSION.into(),
        created_at: super::now(),
        sections: BTreeMap::new(),
        attachments: BTreeMap::new(),
    };
    let root = &paths.root;
    let mut config = serde_json::to_value(paths.load()?)?;
    if let Some(raw) = read(root, "config.json")? {
        merge(&mut config, &serde_json::from_slice(&raw)?);
    }
    let mut machine = take(&mut config, &["cdpEndpoint", "targetId", "codexBin"]);
    machine["codexHost"] = take(
        &mut config["codexHost"],
        &["executable", "previousExecutable", "revision"],
    );
    machine["performance"] = take(
        &mut config["performance"],
        &["integrationEnabled", "revision"],
    );
    section(&mut out, "settings", "config.json", config);
    section(&mut out, "machine", "config.json", machine);
    let mut panel = load(
        root,
        "panel.json",
        serde_json::to_value(crate::panel::Preferences::default())?,
    )?;
    crate::panel::normalize_backup(&mut panel);
    take(
        &mut panel,
        &[
            "revision",
            "webRevision",
            "detached",
            "returnOpen",
            "settingsTarget",
        ],
    );
    if panel["ui"].is_object() {
        take(&mut panel["ui"], &["open", "dockOpen", "activeTab"]);
    }
    section(
        &mut out,
        "machine",
        "panel.json",
        take(&mut panel, &["position"]),
    );
    section(&mut out, "appearance", "panel.json", panel);
    let mut surfaces = serde_json::to_value(
        serde_json::from_value::<crate::surfaces::Preferences>(load(
            root,
            "surfaces.json",
            serde_json::to_value(crate::surfaces::Preferences::default())?,
        )?)?,
    )?;
    section(
        &mut out,
        "machine",
        "surfaces.json",
        json!({"edge":take(&mut surfaces["edge"], &["screen"])}),
    );
    section(&mut out, "surfaces", "surfaces.json", surfaces);
    let mut features = crate::features::backup_preferences(&load(
        root,
        "features.json",
        json!({"main":{},"features":{}}),
    )?)?;
    if let Some(prefs) = features["features"].as_object_mut() {
        for pref in prefs.values_mut() {
            take(pref, &["open"]);
        }
    }
    take(&mut features["main"], &["layoutPresetsRevision"]);
    section(&mut out, "layout", "features.json", features);
    section(
        &mut out,
        "models",
        "model-control.json",
        crate::model_control::backup_preferences(&load(
            root,
            "model-control.json",
            serde_json::to_value(crate::model_control::Preferences::default())?,
        )?)?,
    );
    let mut reading = load(
        root,
        "web-library.json",
        serde_json::to_value(crate::web_library::Preferences::default())?,
    )?;
    take(&mut reading, &["revision"]);
    section(
        &mut out,
        "machine",
        "web-library.json",
        take(&mut reading, &["vault", "attachments", "folders"]),
    );
    section(&mut out, "reading", "web-library.json", reading);
    section(
        &mut out,
        "reading",
        "reader-preferences.json",
        load(root, "reader-preferences.json", json!({}))?,
    );
    let mut tasks = load(
        root,
        "tasks.json",
        serde_json::to_value(crate::tasks::model::Store::default())?,
    )?;
    section(
        &mut out,
        "tasks",
        "tasks.json",
        take(
            &mut tasks,
            &["boardEnabled", "viewMode", "columns", "windowSize"],
        ),
    );
    take(&mut tasks, &["revision", "inflight"]);
    // Bindings are retained for recovery, but imports always pause remote synchronization.
    section(
        &mut out,
        "machine",
        "tasks.json",
        take(&mut tasks, &["bindings", "bindingSource", "syncEnabled"]),
    );
    if data {
        section(&mut out, "data", "tasks.json", tasks);
    }
    let mut terms = load(
        root,
        "terminology-settings.json",
        serde_json::to_value(crate::terminology::Preferences::default())?,
    )?;
    take(&mut terms, &["revision"]);
    let personal = take(&mut terms, &["favorites", "mastered"]);
    section(&mut out, "terminology", "terminology-settings.json", terms);
    if data {
        section(&mut out, "data", "terminology-settings.json", personal);
        section(
            &mut out,
            "data",
            "terminology-store.json",
            serde_json::to_value(crate::terminology_import::Store::load(root)?)?,
        );
        for file in [
            "terminology-store.json",
            "terminology-library.json",
            "terminology-manual.json",
        ] {
            if let Some(bytes) = read(root, file)? {
                section(&mut out, "data", file, serde_json::from_slice(&bytes)?);
            }
        }
        if let Some(store) = out.sections["data"].files.get("terminology-store.json") {
            for job in store["jobs"].as_array().into_iter().flatten() {
                if let (Some(id), Some(file)) = (job["id"].as_str(), job["file"].as_str()) {
                    let path = format!("terminology-imports/{id}/{file}");
                    check_attachment(&path)?;
                    let bytes = read(root, &path)?.context("术语导入原件缺失，未生成不完整备份")?;
                    out.attachments.insert(path, super::archive::base64(&bytes));
                }
            }
        }
    }
    if secrets {
        section(
            &mut out,
            "secrets",
            "secrets.json",
            load(
                root,
                "secrets.json",
                json!({"apiKey":null,"jevApiKey":null}),
            )?,
        );
    }
    out.check()?;
    Ok(out)
}
pub fn stable_capture(paths: &Paths, data: bool, secrets: bool) -> Result<Archive> {
    for _ in 0..3 {
        let first = capture(paths, data, secrets)?;
        let second = capture(paths, data, secrets)?;
        if fingerprint(&first)? == fingerprint(&second)? {
            return Ok(second);
        }
    }
    anyhow::bail!("配置正在变化，请稍后重试");
}
pub fn fingerprint(archive: &Archive) -> Result<String> {
    Ok(super::digest(&serde_json::to_vec(&(
        &archive.sections,
        &archive.attachments,
    ))?))
}
pub fn check_attachment(path: &str) -> Result<()> {
    let parts: Vec<_> = path.split('/').collect();
    ensure!(
        parts.len() == 3
            && parts[0] == "terminology-imports"
            && parts[1].len() == 32
            && parts[1].bytes().all(|b| b.is_ascii_hexdigit())
            && !parts[2].is_empty()
            && ![".", ".."].contains(&parts[2])
            && !parts[2].contains(['\\', '\0']),
        "导入原件路径无效"
    );
    Ok(())
}
pub fn check_section(id: &str, files: &Files) -> Result<()> {
    let allowed: &[&str] = match id {
        "settings" => &["config.json"],
        "appearance" => &["panel.json"],
        "layout" => &["features.json"],
        "surfaces" => &["surfaces.json"],
        "models" => &["model-control.json"],
        "reading" => &["web-library.json", "reader-preferences.json"],
        "tasks" => &["tasks.json"],
        "terminology" => &["terminology-settings.json"],
        "data" => &[
            "tasks.json",
            "terminology-settings.json",
            "terminology-store.json",
            "terminology-library.json",
            "terminology-manual.json",
        ],
        "machine" => &[
            "config.json",
            "panel.json",
            "surfaces.json",
            "web-library.json",
            "tasks.json",
        ],
        "secrets" => &["secrets.json"],
        _ => &[],
    };
    ensure!(
        !files.is_empty() && files.keys().all(|key| allowed.contains(&key.as_str())),
        "备份包含不属于该模块的文件"
    );
    for (file, value) in files {
        check_fields(id, file, value)?;
    }
    Ok(())
}
// A selected portable section cannot smuggle machine grants or personal data in a shared file.
fn check_fields(id: &str, file: &str, value: &Value) -> Result<()> {
    fn only(value: &Value, keys: &[&str]) -> bool {
        value
            .as_object()
            .is_some_and(|object| object.keys().all(|key| keys.contains(&key.as_str())))
    }
    fn without(value: &Value, keys: &[&str]) -> bool {
        value
            .as_object()
            .is_some_and(|object| keys.iter().all(|key| !object.contains_key(*key)))
    }
    let valid = match (id, file) {
        ("settings", _) => {
            without(value, &["cdpEndpoint", "targetId", "codexBin"])
                && value
                    .get("codexHost")
                    .is_none_or(|v| without(v, &["executable", "previousExecutable", "revision"]))
                && value
                    .get("performance")
                    .is_none_or(|v| without(v, &["integrationEnabled", "revision"]))
        }
        ("appearance", _) => {
            without(
                value,
                &[
                    "position",
                    "revision",
                    "webRevision",
                    "detached",
                    "returnOpen",
                    "settingsTarget",
                ],
            ) && value
                .get("ui")
                .is_none_or(|v| without(v, &["open", "dockOpen", "activeTab"]))
        }
        ("surfaces", _) => value.get("edge").is_none_or(|v| without(v, &["screen"])),
        ("reading", "web-library.json") => without(value, &["vault", "attachments", "folders"]),
        ("tasks", _) => only(
            value,
            &["boardEnabled", "viewMode", "columns", "windowSize"],
        ),
        ("terminology", _) => without(value, &["favorites", "mastered"]),
        ("data", "tasks.json") => only(value, &["schema", "tasks", "deletedReminders"]),
        ("data", "terminology-settings.json") => only(value, &["favorites", "mastered"]),
        ("machine", "config.json") => {
            only(
                value,
                &[
                    "cdpEndpoint",
                    "targetId",
                    "codexBin",
                    "codexHost",
                    "performance",
                ],
            ) && value
                .get("codexHost")
                .is_none_or(|v| only(v, &["executable", "previousExecutable", "revision"]))
                && value
                    .get("performance")
                    .is_none_or(|v| only(v, &["integrationEnabled", "revision"]))
        }
        ("machine", "panel.json") => only(value, &["position"]),
        ("machine", "surfaces.json") => {
            only(value, &["edge"]) && value.get("edge").is_none_or(|v| only(v, &["screen"]))
        }
        ("machine", "web-library.json") => only(value, &["vault", "attachments", "folders"]),
        ("machine", "tasks.json") => only(value, &["bindings", "bindingSource", "syncEnabled"]),
        _ => true,
    };
    ensure!(valid, "备份字段不属于所选模块");
    Ok(())
}
// Restore owned top-level fields, replacing lists/dictionaries instead of guessing merges.
pub fn merge(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
}
pub fn build(
    paths: &Paths,
    source: &Archive,
    selected: &[String],
) -> Result<BTreeMap<String, Vec<u8>>> {
    source.check()?;
    ensure!(!selected.is_empty(), "请选择要恢复的模块");
    let selected: BTreeSet<_> = selected.iter().map(String::as_str).collect();
    let target = capture(paths, true, true)?;
    let mut merged = target.clone();
    for id in &selected {
        ensure!(SECTIONS.iter().any(|(key, _)| key == id), "未知备份模块");
        let section = source.sections.get(*id).context("备份不包含所选模块")?;
        merged.sections.insert((*id).into(), section.clone());
    }
    // Reconstruct split files in a fixed order, preserving local grants unless selected.
    let mut files = Files::new();
    for (id, _) in SECTIONS {
        if let Some(section) = merged.sections.get(*id) {
            for (file, value) in &section.files {
                let target = files.entry(file.clone()).or_insert_with(|| json!({}));
                if value.is_object() {
                    if *id == "machine" && file == "config.json" {
                        for key in ["codexHost", "performance"] {
                            merge(&mut target[key], &value[key]);
                        }
                        let mut value = value.clone();
                        take(&mut value, &["codexHost", "performance"]);
                        merge(target, &value);
                    } else if *id == "machine" && file == "surfaces.json" {
                        merge(&mut target["edge"], &value["edge"]);
                    } else {
                        merge(target, value);
                    }
                } else {
                    *target = value.clone();
                }
            }
        }
    }
    let touched: BTreeSet<_> = selected
        .iter()
        .flat_map(|id| source.sections[*id].files.keys().cloned())
        .collect();
    let mut out = BTreeMap::new();
    for name in touched {
        let mut value = files.remove(&name).context("备份文件缺失")?;
        let prior = load(&paths.root, &name, json!({}))?;
        super::validate::prepare(&name, &mut value, &prior, &selected)?;
        out.insert(name, serde_json::to_vec_pretty(&value)?);
    }
    if selected.contains("data") {
        for (path, bytes) in &source.attachments {
            out.insert(path.clone(), super::archive::unbase64(bytes)?);
        }
    }
    Ok(out)
}
// Undo restores user content while leaving external work paused and live revisions fresh.
pub fn prepare_undo(paths: &Paths, files: &mut super::FileChanges) -> Result<()> {
    let selected = BTreeSet::from(["data"]);
    for (name, bytes) in files {
        if !FILES.contains(&name.as_str()) {
            continue;
        }
        if let Some(bytes) = bytes {
            let mut value = serde_json::from_slice(bytes)?;
            let prior = load(&paths.root, name, json!({}))?;
            super::validate::prepare(name, &mut value, &prior, &selected)?;
            *bytes = serde_json::to_vec_pretty(&value)?;
        }
    }
    Ok(())
}
pub fn difference(before: &Value, after: &Value, prefix: &str, out: &mut Vec<String>) {
    if before == after || out.len() >= 200 {
        return;
    }
    if let (Some(a), Some(b)) = (before.as_object(), after.as_object()) {
        for key in a.keys().chain(b.keys()).collect::<BTreeSet<_>>() {
            difference(&before[key], &after[key], &format!("{prefix}/{key}"), out);
        }
    } else {
        out.push(prefix.to_owned());
    }
}
