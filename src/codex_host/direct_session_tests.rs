// [INPUT]: 独立原生 App 与合成 CDP/Controller/共享 Host；真实系统进程身份和锁。
// [OUTPUT]: 生产协调逻辑的启动门控、恢复、无页面保留、正常退出及竞态回归。
// [POS]: direct_session 的原生单元验收；不关闭真实 ChatGPT，不替代真实聊天冷启动验收。
// [PROTOCOL]: 变更时同步 codex_host/AGENTS.md 与 tests/AGENTS.md。
use super::*;
use crate::config::write_private;
use serde_json::json;
use std::{fs, process::Command};

struct Fixture {
    directory: tempfile::TempDir,
    paths: Paths,
    layout: Layout,
    resources: Resources,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::Builder::new()
            .prefix("palboo-session-")
            .tempdir()
            .unwrap();
        let root = directory.path().canonicalize().unwrap();
        let paths = Paths::new(Some(root.join("palboo"))).unwrap();
        let layout = Layout {
            root: root.join("launcher"),
            upstream: root.join("upstream"),
            data: root.join("data"),
        };
        for path in [
            &layout.root,
            &layout.upstream,
            &layout.data,
            &root.join("package/bin"),
            &root.join("package/libexec"),
            &root.join("package/app"),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        let app = root.join("Synthetic.app");
        fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        fs::write(app.join("Contents/Info.plist"), format!(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>local.palboo.fixture.{}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>"#, uuid::Uuid::new_v4().simple())).unwrap();
        let desktop = app.join("Contents/MacOS/Fixture");
        let source = root.join("fixture.swift");
        fs::write(
            &source,
            include_str!("../../tests/direct-session-fixture.swift"),
        )
        .unwrap();
        let build = Command::new("xcrun")
            .arg("swiftc")
            .arg(&source)
            .arg("-o")
            .arg(&desktop)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        let installation = root.join("package/bin/codexhost");
        let shim = root.join("package/libexec/codexhost-shim");
        let stock = root.join("package/bin/stock");
        for path in [&installation, &shim, &stock] {
            fs::copy(&desktop, path).unwrap();
            assert!(
                Command::new("/usr/bin/codesign")
                    .args(["--force", "--sign", "-"])
                    .arg(path)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        }
        assert!(
            Command::new("/usr/bin/codesign")
                .args(["--force", "--sign", "-"])
                .arg(app)
                .output()
                .unwrap()
                .status
                .success()
        );
        let runtime = root.join("package/app/host-runtime.mjs");
        fs::write(
            &runtime,
            include_str!("../../tests/direct-session-fixture.mjs"),
        )
        .unwrap();
        fs::write(
            root.join("package/app/codexhost-distribution.json"),
            r#"{"version":"0.18.0"}"#,
        )
        .unwrap();
        let resources = Resources {
            installation,
            desktop,
            node: super::super::find_node().unwrap().canonicalize().unwrap(),
            stock,
            shim,
            runtime: runtime.clone(),
            controller: runtime.clone(),
            renderer: runtime,
        };
        let mut config = paths.load().unwrap();
        config.codex_host.enabled = true;
        paths.save(&config).unwrap();
        Self {
            directory,
            paths,
            layout,
            resources,
        }
    }
    fn request(&self, recovery: Option<Record>) -> Request {
        Request {
            caller: ProcessIdentity::read(std::process::id()).unwrap().unwrap(),
            lease: uuid::Uuid::new_v4().to_string(),
            revision: self.paths.load().unwrap().codex_host.revision,
            resources: self.resources.clone(),
            recovery,
        }
    }
    fn start(&self, request: Request) -> tokio::task::JoinHandle<Result<()>> {
        let paths = self.paths.clone();
        let layout = self.layout.clone();
        let resources = self.resources.clone();
        tokio::spawn(async move { run_prepared(&paths, layout, request, resources).await })
    }
    fn publish_service(&self) -> bool {
        let Some(pid) = direct::read::<u32>(&self.layout.data.join("service-pid")).unwrap() else {
            return false;
        };
        let process = ProcessIdentity::read(pid).unwrap().unwrap();
        write_private(&self.layout.data.join("shared-host-ready.json"), json!({"pid": pid, "started_at_micros": process.started_at_micros, "executable": process.executable, "runtime": self.resources.runtime, "version": "0.18.0"}).to_string().as_bytes()).unwrap();
        true
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this unique temporary process tree; collect native identities before signaling.
        let root = self.directory.path().canonicalize().unwrap();
        let output = Command::new("/bin/ps")
            .args(["-axo", "pid=,args="])
            .output()
            .unwrap();
        let identities: Vec<_> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (pid, args) = line.trim().split_once(char::is_whitespace)?;
                if !args.contains(root.to_str()?) {
                    return None;
                }
                ProcessIdentity::read(pid.parse().ok()?).ok().flatten()
            })
            .collect();
        for identity in identities {
            if identity.alive().unwrap_or(false) {
                unsafe {
                    libc::kill(identity.pid as i32, libc::SIGTERM);
                }
            }
        }
    }
}
async fn until(mut predicate: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    while !predicate() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "fixture did not reach expected state"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
#[ignore = "requires a macOS GUI session; launches only an isolated synthetic App"]
async fn native_direct_session_survives_reconnect_recovers_and_cleans_owned_tree() {
    let fixture = Fixture::new();
    let mut stale = fixture.request(None);
    stale.revision += 1;
    assert!(
        run_prepared(
            &fixture.paths,
            fixture.layout.clone(),
            stale,
            fixture.resources.clone()
        )
        .await
        .is_err()
    );
    assert!(!fixture.layout.record().exists());
    let worker = fixture.start(fixture.request(None));
    until(|| fixture.layout.data.join("service-pid").exists()).await;
    assert!(
        direct::record(&fixture.layout)
            .unwrap()
            .unwrap()
            .controller
            .is_none(),
        "后台尚未完成身份发布，不能提前注入 Controller"
    );
    until(|| fixture.publish_service()).await;
    until(|| {
        direct::record(&fixture.layout)
            .unwrap()
            .is_some_and(|r| r.controller.is_some())
    })
    .await;
    assert!(
        !fixture
            .layout
            .upstream
            .join("desktop-runtime-v1.json")
            .exists()
    );
    let before = direct::record(&fixture.layout).unwrap().unwrap();
    let native_cli = before.native_cli.clone().unwrap();
    assert!(native_cli.exists());
    direct::remove_matching(&fixture.layout, "another-lease").unwrap();
    assert!(fixture.layout.record().exists());
    let desktop = before.desktop.clone().unwrap();
    assert!(direct::lock(&fixture.layout.root.join("codex-host-session.lock")).is_err());
    assert!(direct::lock(&fixture.layout.upstream.join("launcher-v1.lock")).is_err());
    assert!(
        run_prepared(
            &fixture.paths,
            fixture.layout.clone(),
            fixture.request(None),
            fixture.resources.clone()
        )
        .await
        .is_err()
    );
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_ne!(
        direct::record(&fixture.layout).unwrap().unwrap().state,
        "ready"
    );
    fs::write(fixture.layout.data.join("allow-installed"), "").unwrap();
    until(|| {
        direct::record(&fixture.layout)
            .unwrap()
            .is_some_and(|r| r.state == "ready")
    })
    .await;
    // A closed page/disconnected CDP does not end the native session.
    fs::write(fixture.layout.data.join("no-page"), "").unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(desktop.alive().unwrap());
    assert!(!worker.is_finished());
    fs::remove_file(fixture.layout.data.join("no-page")).unwrap();
    // Controller exit is recovered without opening or replacing Desktop.
    stop_owned(before.controller.as_ref().unwrap())
        .await
        .unwrap();
    until(|| {
        direct::record(&fixture.layout)
            .unwrap()
            .is_some_and(|r| r.state == "ready" && r.controller != before.controller)
    })
    .await;
    assert_eq!(
        direct::record(&fixture.layout)
            .unwrap()
            .unwrap()
            .desktop
            .as_ref(),
        Some(&desktop)
    );
    // Abrupt loss of the coordinating future leaves a recoverable native tree.
    worker.abort();
    let _ = worker.await;
    // A fresh launch must not silently adopt an already running native App.
    assert!(
        run_prepared(
            &fixture.paths,
            fixture.layout.clone(),
            fixture.request(None),
            fixture.resources.clone()
        )
        .await
        .is_err()
    );
    let mut lost = direct::record(&fixture.layout).unwrap().unwrap();
    lost.manager.started_at_micros += 1; // same PID, different native identity cannot count as alive
    lost.save(&fixture.layout).unwrap();
    assert!(!lost.manager.alive().unwrap());
    let old_controller = lost.controller.clone().unwrap();
    let mut wrong = lost.clone();
    wrong.endpoint = "http://127.0.0.1:1".into();
    assert!(
        run_prepared(
            &fixture.paths,
            fixture.layout.clone(),
            fixture.request(Some(wrong)),
            fixture.resources.clone()
        )
        .await
        .is_err()
    );
    assert!(desktop.alive().unwrap());
    assert!(old_controller.alive().unwrap());
    let recovered = fixture.start(fixture.request(Some(lost)));
    until(|| {
        direct::record(&fixture.layout)
            .unwrap()
            .is_some_and(|r| r.state == "ready" && r.controller.as_ref() != Some(&old_controller))
    })
    .await;
    assert_eq!(
        direct::record(&fixture.layout)
            .unwrap()
            .unwrap()
            .native_cli
            .as_ref(),
        Some(&native_cli)
    );
    assert!(native_cli.exists(), "恢复协调不能删除原生工具入口");
    assert!(
        fixture
            .layout
            .data
            .join(format!("controller-stopped-{}", old_controller.pid))
            .exists()
    );
    assert_eq!(
        direct::record(&fixture.layout)
            .unwrap()
            .unwrap()
            .desktop
            .as_ref(),
        Some(&desktop)
    );
    let controller = direct::record(&fixture.layout)
        .unwrap()
        .unwrap()
        .controller
        .unwrap();
    stop_owned(&desktop).await.unwrap();
    tokio::time::timeout(Duration::from_secs(15), recovered)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(!controller.alive().unwrap());
    assert!(fixture.layout.data.join("service-stopped").exists());
    assert!(!fixture.layout.record().exists());
    assert!(!native_cli.exists());
    assert!(direct::lock(&fixture.layout.upstream.join("launcher-v1.lock")).is_ok());
}

#[test]
fn private_records_reject_symlinks_and_public_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("record");
    write_private(&original, b"42").unwrap();
    let alias = directory.path().join("alias");
    symlink(&original, &alias).unwrap();
    assert!(direct::read::<u32>(&alias).is_err());
    assert!(direct::lock(&alias).is_err());
    fs::set_permissions(&original, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(direct::read::<u32>(&original).is_err());
    assert_eq!(fs::read(&original).unwrap(), b"42");
}

#[tokio::test]
#[ignore = "requires a macOS GUI session; launches only an isolated synthetic App"]
async fn native_direct_session_falls_back_without_controller_when_host_fails() {
    let fixture = Fixture::new();
    fs::write(fixture.layout.data.join("fail-host"), b"").unwrap();
    let worker = fixture.start(fixture.request(None));
    until(|| {
        direct::record(&fixture.layout)
            .unwrap()
            .is_some_and(|r| r.state == "native")
    })
    .await;
    let record = direct::record(&fixture.layout).unwrap().unwrap();
    let desktop = record.desktop.as_ref().unwrap();
    let context = record.native_cli.as_ref().unwrap();
    assert!(desktop.alive().unwrap());
    assert!(record.controller.is_none());
    assert!(fixture.paths.load().unwrap().codex_host.enabled);
    assert!(direct::lock(&fixture.layout.upstream.join("launcher-v1.lock")).is_ok());
    let failure = super::super::native_cli::failure(context).unwrap().unwrap();
    assert_eq!(failure.desktop.as_ref(), Some(desktop));
    assert!(failure.message.contains("后台未能启动"));
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .unwrap();
    let stock = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let (pid, executable) = line.trim().split_once(char::is_whitespace)?;
            (Path::new(executable.trim()) == fixture.resources.stock).then(|| {
                ProcessIdentity::read(pid.parse().unwrap())
                    .unwrap()
                    .unwrap()
            })
        })
        .expect("官方模式进程应在移除兼容环境后正常运行");
    assert!(super::super::native_host::descendant(&stock, desktop).unwrap());
    stop_owned(desktop).await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), worker)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(!stock.alive().unwrap());
    assert!(!context.exists());
    assert!(!fixture.layout.record().exists());
}
