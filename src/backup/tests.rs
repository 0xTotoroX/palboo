// [INPUT]: Isolated synthetic profiles, archives and interrupted transactions.
// [OUTPUT]: Backup round-trip, selective preservation, encryption and rollback regression checks.
// [POS]: No host, real credentials, user directories or network services are used.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::*;
fn profile() -> (tempfile::TempDir, Paths) {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::new(Some(dir.path().into())).unwrap();
    paths.save(&Default::default()).unwrap();
    (dir, paths)
}
#[test]
fn portable_round_trip_preserves_target_credentials_and_connection() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    let mut config = a.load().unwrap();
    config.stepwise.quick_prompts[0].prompt = "synthetic source instruction".into();
    a.save(&config).unwrap();
    let mut target = b.load().unwrap();
    target.cdp_endpoint = Some("http://127.0.0.1:12345".into());
    target.codex_bin = Some("/synthetic/local/codex".into());
    b.save(&target).unwrap();
    b.save_keys(Some("synthetic-target-secret"), None).unwrap();
    let archive = snapshot::capture(&a, false, false).unwrap();
    let encoded = archive::encode(&archive, "").unwrap();
    assert!(!String::from_utf8_lossy(&encoded).contains("synthetic-target-secret"));
    let decoded = archive::decode(&encoded, "").unwrap();
    let files = snapshot::build(&b, &decoded, &["settings".into()])
        .unwrap()
        .into_iter()
        .map(|(k, v)| (k, Some(v)))
        .collect();
    storage::commit(&b, &files).unwrap();
    let restored = b.load().unwrap();
    assert_eq!(
        restored.stepwise.quick_prompts[0].prompt,
        "synthetic source instruction"
    );
    assert_eq!(restored.cdp_endpoint, target.cdp_endpoint);
    assert_eq!(restored.codex_bin, target.codex_bin);
    assert_eq!(
        b.load_key().unwrap().as_deref(),
        Some("synthetic-target-secret")
    );
}
#[test]
fn all_sections_restore_and_pause_external_work() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    a.save_keys(Some("synthetic-transfer-secret"), None)
        .unwrap();
    let archive = snapshot::capture(&a, true, true).unwrap();
    let selected = archive.sections.keys().cloned().collect::<Vec<_>>();
    let files = snapshot::build(&b, &archive, &selected)
        .unwrap()
        .into_iter()
        .map(|(k, v)| (k, Some(v)))
        .collect();
    storage::commit(&b, &files).unwrap();
    assert_eq!(
        b.load_key().unwrap().as_deref(),
        Some("synthetic-transfer-secret")
    );
    let tasks: Value =
        serde_json::from_slice(&std::fs::read(b.root.join("tasks.json")).unwrap()).unwrap();
    assert_eq!(tasks["syncEnabled"], false);
    assert!(tasks["inflight"].is_null());
    assert!(crate::terminology_import::Store::load(&b.root).is_ok());
}
#[test]
fn encryption_rejects_wrong_password_and_tampering() {
    let (_a, a) = profile();
    a.save_keys(Some("synthetic-transfer-secret"), None)
        .unwrap();
    let archive = snapshot::capture(&a, false, true).unwrap();
    assert!(archive::encode(&archive, "").is_err());
    let mut encoded = archive::encode(&archive, "test passphrase for synthetic backup").unwrap();
    assert!(!String::from_utf8_lossy(&encoded).contains("synthetic-transfer-secret"));
    assert!(archive::decode(&encoded, "wrong passphrase").is_err());
    assert!(
        archive::decode(&encoded, "test passphrase for synthetic backup")
            .unwrap()
            .sections
            .contains_key("secrets")
    );
    let last = encoded.len() - 1;
    encoded[last] ^= 1;
    assert!(archive::decode(&encoded, "test passphrase for synthetic backup").is_err());
}
#[test]
fn preview_rejects_concurrent_changes_and_unknown_versions() {
    let (_a, a) = profile();
    let files = BTreeMap::from([("config.json".into(), Some(b"{}".to_vec()))]);
    let target = targets::Target {
        id: "current".into(),
        label: "test".into(),
        path: a.root.clone(),
        version: Some(crate::config::VERSION.into()),
        current: true,
    };
    let (preview, _) = plan(target, files).unwrap();
    let mut config = a.load().unwrap();
    config.model = Some("concurrent".into());
    a.save(&config).unwrap();
    assert!(check(&preview).is_err());
    let mut archive = snapshot::capture(&a, false, false).unwrap();
    archive.version = 99;
    assert!(archive.check().is_err());
}
#[test]
fn transaction_rolls_back_after_crash_and_undo_restores_absent_files() {
    let (_a, a) = profile();
    let prior = std::fs::read(a.config()).unwrap();
    let files = BTreeMap::from([
        ("config.json".into(), Some(b"{}".to_vec())),
        (
            "reader-preferences.json".into(),
            Some(b"{\"sidebarWidth\":300}".to_vec()),
        ),
    ]);
    storage::commit(&a, &files).unwrap();
    let journal = std::fs::read(a.root.join("backups/latest.json")).unwrap();
    std::fs::write(a.root.join("backup-transaction.json"), journal).unwrap();
    storage::recover(&a).unwrap();
    assert_eq!(std::fs::read(a.config()).unwrap(), prior);
    assert!(!a.root.join("reader-preferences.json").exists());
    storage::commit(&a, &files).unwrap();
    let undo = storage::undo_files(&a).unwrap();
    storage::commit(&a, &undo).unwrap();
    assert_eq!(std::fs::read(a.config()).unwrap(), prior);
    assert!(!a.root.join("reader-preferences.json").exists());
}
#[test]
fn rejects_path_traversal_links_and_secret_smuggling() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    assert!(snapshot::check_attachment("terminology-imports/../secrets.json").is_err());
    std::os::unix::fs::symlink(&b.root, a.root.join("terminology-imports")).unwrap();
    assert!(snapshot::read(&a.root, "terminology-imports/secrets.json").is_err());
    let mut archive = snapshot::capture(&b, false, false).unwrap();
    archive
        .sections
        .get_mut("settings")
        .unwrap()
        .files
        .insert("secrets.json".into(), json!({"apiKey":"synthetic"}));
    assert!(archive.check().is_err());
}

#[test]
fn undo_keeps_external_sync_paused_and_refreshes_revision() {
    let (_dir, paths) = profile();
    let mut original = serde_json::to_value(crate::tasks::model::Store::default()).unwrap();
    original["syncEnabled"] = true.into();
    original["revision"] = 1.into();
    let mut current = original.clone();
    current["syncEnabled"] = false.into();
    current["revision"] = 5.into();
    std::fs::write(
        paths.root.join("tasks.json"),
        serde_json::to_vec(&current).unwrap(),
    )
    .unwrap();
    let mut files = BTreeMap::from([(
        "tasks.json".into(),
        Some(serde_json::to_vec(&original).unwrap()),
    )]);
    snapshot::prepare_undo(&paths, &mut files).unwrap();
    let restored: Value = serde_json::from_slice(files["tasks.json"].as_ref().unwrap()).unwrap();
    assert_eq!(restored["syncEnabled"], false);
    assert_eq!(restored["revision"], 6);
    assert!(restored["inflight"].is_null());
}

#[test]
fn undo_accepts_legacy_missing_option_groups_and_restore_rejects_scalar_groups() {
    let (_dir, paths) = profile();
    let original =
        json!({"provider":"api", "model":"synthetic", "stepwise":{"generationMode":"manual"}});
    let mut files = BTreeMap::from([(
        "config.json".into(),
        Some(serde_json::to_vec(&original).unwrap()),
    )]);
    snapshot::prepare_undo(&paths, &mut files).unwrap();
    let restored: crate::config::Config =
        serde_json::from_slice(files["config.json"].as_ref().unwrap()).unwrap();
    assert_eq!(restored.model.as_deref(), Some("synthetic"));
    for key in ["codexHost", "performance"] {
        let mut archive = snapshot::capture(&paths, false, false).unwrap();
        archive
            .sections
            .get_mut("settings")
            .unwrap()
            .files
            .get_mut("config.json")
            .unwrap()[key] = "invalid scalar".into();
        assert!(snapshot::build(&paths, &archive, &["settings".into()]).is_err());
    }
    let mut archive = snapshot::capture(&paths, true, false).unwrap();
    archive
        .sections
        .get_mut("data")
        .unwrap()
        .files
        .get_mut("terminology-store.json")
        .unwrap()["jobs"] = json!(["invalid job"]);
    assert!(snapshot::build(&paths, &archive, &["data".into()]).is_err());
}

#[test]
fn legacy_preferences_remain_readable_and_future_task_schemas_are_rejected() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    for (file, value) in [
        (
            "features.json",
            json!({"outline":{"placement":"desktop","open":true,"size":[840,620]}}),
        ),
        (
            "model-control.json",
            json!({"enabled":true,"edge":"left","theme":"matte"}),
        ),
        ("panel.json", json!({"ui":{"material":"liquid"}})),
        ("surfaces.json", json!({})),
    ] {
        std::fs::write(a.root.join(file), serde_json::to_vec(&value).unwrap()).unwrap();
    }
    let mut archive = snapshot::capture(&a, true, false).unwrap();
    let selected = vec![
        "layout".into(),
        "models".into(),
        "appearance".into(),
        "surfaces".into(),
    ];
    let files = snapshot::build(&b, &archive, &selected).unwrap();
    let layout: Value = serde_json::from_slice(&files["features.json"]).unwrap();
    assert_eq!(layout["main"]["placement"], "desktop");
    let panel: Value = serde_json::from_slice(&files["panel.json"]).unwrap();
    assert_eq!(panel["ui"]["material"], "frosted");
    let models: Value = serde_json::from_slice(&files["model-control.json"]).unwrap();
    assert_eq!(models["enabled"], true);
    assert!(models.get("edge").is_none());
    archive
        .sections
        .get_mut("data")
        .unwrap()
        .files
        .get_mut("tasks.json")
        .unwrap()["schema"] = 1.into();
    let files = snapshot::build(&b, &archive, &["data".into()]).unwrap();
    let tasks: Value = serde_json::from_slice(&files["tasks.json"]).unwrap();
    assert_eq!(
        tasks["schema"], 1,
        "legacy migration remains with the task service"
    );
    assert_eq!(tasks["syncEnabled"], false);
    archive
        .sections
        .get_mut("data")
        .unwrap()
        .files
        .get_mut("tasks.json")
        .unwrap()["schema"] = 99.into();
    assert!(snapshot::build(&b, &archive, &["data".into()]).is_err());
}
#[test]
fn portable_sections_cannot_restore_machine_grants_or_personal_records() {
    let (_a, a) = profile();
    let (_b, b) = profile();
    for (section, file, field, value) in [
        ("reading", "web-library.json", "vault", json!("/")),
        ("reading", "web-library.json", "folders", json!([])),
        ("tasks", "tasks.json", "tasks", json!([])),
        (
            "terminology",
            "terminology-settings.json",
            "favorites",
            json!(["synthetic"]),
        ),
        ("appearance", "panel.json", "position", json!([1, 2])),
    ] {
        let mut archive = snapshot::capture(&a, false, false).unwrap();
        archive
            .sections
            .get_mut(section)
            .unwrap()
            .files
            .get_mut(file)
            .unwrap()[field] = value;
        assert!(archive.check().is_err(), "{section}/{field}");
        assert!(snapshot::build(&b, &archive, &[section.into()]).is_err());
    }
    let mut archive = snapshot::capture(&a, false, false).unwrap();
    archive
        .sections
        .get_mut("machine")
        .unwrap()
        .files
        .get_mut("web-library.json")
        .unwrap()["vault"] = json!("/");
    assert!(
        snapshot::build(&b, &archive, &["machine".into()]).is_err(),
        "legacy folder grants use the same root restriction"
    );
}
