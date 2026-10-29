// [INPUT]: 临时完整 App、合成后台协议、真实同卷目录交换。
// [OUTPUT]: 更新成功、启动/重连失败回滚、配置与原连接保留的隔离验证。
// [POS]: 不访问 GitHub、真实 App、用户数据或 Codex。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::*;
use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
};
use std::{os::unix::fs::PermissionsExt, sync::Arc};
use tokio::sync::RwLock;

#[test]
fn parent_directory_aliases_match_without_accepting_an_executable_outside_the_app() {
    let root = tempfile::tempdir().unwrap();
    let actual = root.path().canonicalize().unwrap().join("real");
    std::fs::create_dir(&actual).unwrap();
    std::fs::write(actual.join("palboo"), "fixture").unwrap();
    let alias = root.path().join("alias");
    std::os::unix::fs::symlink(&actual, &alias).unwrap();
    assert!(matches_executable(
        &alias.join("palboo"),
        &actual.join("palboo")
    ));
    std::os::unix::fs::symlink("/usr/bin/true", actual.join("external")).unwrap();
    assert!(!matches_executable(
        Path::new("/usr/bin/true"),
        &actual.join("external")
    ));
}

struct Mock {
    data: Paths,
    connected: RwLock<Vec<Value>>,
    fail_connection: bool,
    originally_connected: bool,
}
async fn view(
    axum::extract::State(mock): axum::extract::State<Arc<Mock>>,
) -> (StatusCode, Json<Value>) {
    let Ok(runtime) = Runtime::read(&mock.data) else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({})));
    };
    let connected = (runtime.version == "1.2.0" && mock.originally_connected)
        || mock
            .connected
            .read()
            .await
            .iter()
            .any(|v| v["version"] == runtime.version);
    (
        StatusCode::OK,
        Json(json!({"connection":if connected {
        json!({"status":"connected","endpoint":"http://127.0.0.1:19999","targetId":"synthetic-chat"})
    } else { json!({"status":"disconnected"}) }})),
    )
}
async fn connect(
    axum::extract::State(mock): axum::extract::State<Arc<Mock>>,
    Json(value): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let runtime = Runtime::read(&mock.data).unwrap();
    mock.connected
        .write()
        .await
        .push(json!({"version":runtime.version,"connection":value}));
    if mock.fail_connection && runtime.version == "1.3.0" {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":"synthetic reconnect failure"})),
        )
    } else {
        (StatusCode::OK, Json(json!({"ok":true})))
    }
}
async fn shutdown(axum::extract::State(mock): axum::extract::State<Arc<Mock>>) -> Json<Value> {
    if let Ok(runtime) = Runtime::read(&mock.data) {
        // The only PIDs in this private fixture are sleep children spawned by resume.
        unsafe {
            libc::kill(runtime.pid as i32, libc::SIGTERM);
        }
        let _ = std::fs::remove_file(mock.data.runtime());
    }
    Json(json!({"ok":true}))
}
fn bundle(app: &Path, target: &Path, data: &Paths, port: u16, version: &str, fail: bool) {
    let contents = app.join("Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::create_dir_all(contents.join("Resources")).unwrap();
    std::fs::write(contents.join("Info.plist"), format!(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.palboo.launcher</string><key>CFBundleExecutable</key><string>PalbooLauncher</string><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#)).unwrap();
    std::fs::write(
        contents.join("Resources/manifest.json"),
        serde_json::to_vec(
            &json!({"name":"palboo","arch":"arm64","platform":"darwin","version":version}),
        )
        .unwrap(),
    )
    .unwrap();
    let runtime = json!({"pid":1,"port":port,"token":format!("fixture-{version}"),"version":version,"executable":target.join("Contents/MacOS/palboo")}).to_string().replace("\"pid\":1", "\"pid\":%s");
    let script = if fail {
        "#!/bin/sh\nexit 9\n".to_owned()
    } else {
        format!(
            "#!/bin/sh\n[ \"$PALBOO_START_DISCONNECTED\" = 1 ] || exit 8\nprintf '{runtime}' \"$$\" > '{}'\nexec /bin/sleep 120\n",
            data.runtime().display()
        )
    };
    let cli = contents.join("MacOS/palboo");
    std::fs::write(&cli, script).unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
}
async fn scenario(fail_start: bool, fail_connection: bool, connected: bool, enabled: bool) {
    let root = tempfile::tempdir().unwrap();
    // Canonical paths match production and avoid /var vs /private/var differences.
    let root_path = root.path().canonicalize().unwrap();
    let control = Paths::new(Some(root_path.join("control"))).unwrap();
    let data = Paths::new(Some(root_path.join("data"))).unwrap();
    let app = root_path.join("Palboo.app");
    let candidate = root_path.join("candidate.app");
    let config =
        serde_json::to_vec(&json!({"performance":{"integrationEnabled":enabled},"maxItems":7}))
            .unwrap();
    std::fs::write(data.root.join("config.json"), &config).unwrap();
    std::fs::write(data.root.join("service.lock"), "").unwrap();
    std::fs::write(data.root.join("personal-data"), "untouched").unwrap();
    let mock = Arc::new(Mock {
        data: data.clone(),
        connected: RwLock::new(vec![]),
        fail_connection,
        originally_connected: connected,
    });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(
        axum::serve(
            listener,
            Router::new()
                .route("/api/state", get(view))
                .route("/api/connect", post(connect))
                .route("/api/shutdown", post(shutdown))
                .with_state(mock.clone()),
        )
        .into_future(),
    );
    bundle(&app, &app, &data, port, "1.2.0", false);
    bundle(&candidate, &app, &data, port, "1.3.0", fail_start);
    let mut old = None;
    resume(&data, &app, None, &mut old).await.unwrap();
    let prefs = app_mode::Preferences {
        revision: 4,
        release_data: Some(data.root.clone()),
        executable: Some(app.join("Contents/MacOS/palboo")),
        source: Some(root_path.join("untouched-source")),
        ..Default::default()
    };
    app_mode::save(&control, &prefs).unwrap();
    let request = Request {
        update: Update {
            release_id: 1,
            asset_id: 2,
            version: "1.3.0".into(),
            current_version: "1.2.0".into(),
            expected_revision: 4,
        },
        installed: install::inspect(&app).await.unwrap(),
        runtime: Runtime::read(&data).unwrap(),
        data: data.root.clone(),
        return_url: "http://127.0.0.1:1/#fixture".into(),
        language: "zh-CN".into(),
    };
    let progress = Arc::new(RwLock::new(Value::Null));
    let result = finish_install(
        &control,
        &request,
        &progress,
        install::Prepared::fixture(&app, &candidate),
        "1.3.0",
        false,
    )
    .await;
    let failed = fail_start || fail_connection;
    let runtime = Runtime::read(&data).unwrap();
    // Stop the isolated backend before assertions so an assertion failure cannot leak it.
    let _ = runtime.request("shutdown", Some(json!({}))).await;
    for _ in 0..50 {
        if unsafe { libc::waitpid(runtime.pid as i32, std::ptr::null_mut(), libc::WNOHANG) } != 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    if let Some(mut old) = old {
        let _ = old.child.wait();
    }
    server.abort();
    assert_eq!(result.is_err(), failed, "{result:?}");
    assert_eq!(runtime.version, if failed { "1.2.0" } else { "1.3.0" });
    assert_eq!(
        install::inspect(&app).await.unwrap().version,
        runtime.version
    );
    assert_eq!(
        std::fs::read(data.root.join("config.json")).unwrap(),
        config
    );
    assert_eq!(
        std::fs::read_to_string(data.root.join("personal-data")).unwrap(),
        "untouched"
    );
    let saved = app_mode::read(&control).unwrap();
    assert_eq!(saved.revision, if failed { 4 } else { 5 });
    assert_eq!(saved.source, prefs.source);
    assert_eq!(saved.release_data, prefs.release_data);
    let record: Value =
        serde_json::from_slice(&std::fs::read(control.root.join("last-app-update.json")).unwrap())
            .unwrap();
    assert_eq!(record["phase"], if failed { "rolledBack" } else { "done" });
    if failed {
        assert_eq!(progress.read().await["phase"], "failed");
        assert!(
            progress.read().await["url"]
                .as_str()
                .unwrap()
                .contains("#token=")
        );
    } else {
        let backup = Path::new(record["previousApp"].as_str().unwrap());
        assert_eq!(install::inspect(backup).await.unwrap().version, "1.2.0");
    }
    let calls = mock.connected.read().await;
    if connected && enabled && !fail_start {
        assert!(!calls.is_empty());
        assert!(calls.iter().all(|call| call["connection"]
            == json!({"endpoint":"http://127.0.0.1:19999","targetId":"synthetic-chat"})));
    } else if !connected || !enabled {
        assert!(
            calls.is_empty(),
            "manual disconnect must remain disconnected"
        );
    }
}
#[tokio::test]
async fn replaces_whole_app_and_preserves_manual_disconnect_and_data() {
    scenario(false, false, false, true).await;
}
#[tokio::test]
async fn startup_failure_restores_previous_bundle_settings_and_connection() {
    scenario(true, false, true, true).await;
}
#[tokio::test]
async fn reconnect_failure_stops_only_the_new_child_and_rolls_back() {
    scenario(false, true, true, true).await;
}
#[tokio::test]
async fn successful_update_restores_only_the_original_connection() {
    scenario(false, false, true, true).await;
}
#[tokio::test]
async fn paused_integration_is_not_reenabled_by_an_update() {
    scenario(false, false, true, false).await;
}
#[tokio::test]
async fn an_owned_child_that_never_became_ready_can_be_reclaimed() {
    let root = tempfile::tempdir().unwrap();
    let data = Paths::new(Some(root.path().join("data"))).unwrap();
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let child = std::process::Command::new("/bin/sleep")
        .arg("120")
        .spawn()
        .unwrap();
    let runtime = Runtime {
        pid: child.id(),
        port,
        token: "synthetic-unready".into(),
        version: "1.3.0".into(),
        executable: "/bin/sleep".into(),
    };
    let mut started = Started {
        child,
        runtime: Some(runtime),
        ready: false,
    };
    let result = started.stop(&data).await;
    let exited = started.child.try_wait().unwrap().is_some();
    if !exited {
        let _ = started.child.kill();
        let _ = started.child.wait();
    }
    assert!(result.is_ok(), "{result:?}");
    assert!(exited);
}
