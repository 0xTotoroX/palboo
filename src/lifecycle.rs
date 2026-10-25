// [INPUT]: Paths、私有 runtime 信息、系统进程与本地产物。
// [OUTPUT]: start/stop/status/doctor/launch/update 与 Runtime 认证 JSON/原始术语文件请求；完整 App 核对后台来源并拒绝单文件升级；宿主 App 经 LaunchServices 启动并保留自身权限归属；host-only 仅准备宿主；显式 --restart-running 沿用宿主重开策略。
// [POS]: CLI 进程管理层，负责复用服务和本地更新回滚；Dev 设置入口优先使用监督进程地址。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::config::{self, Paths, VERSION, write_private};
use crate::host::{desktop_process, find_desktop, process_debug_endpoint};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
pub struct Runtime {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub version: String,
    pub executable: PathBuf,
}

impl Runtime {
    pub fn read(paths: &Paths) -> Result<Self> {
        serde_json::from_slice(&std::fs::read(paths.runtime())?).context("运行信息无效")
    }
    pub fn url(&self) -> String {
        crate::assets::settings_url()
            .unwrap_or_else(|| format!("http://127.0.0.1:{}/#token={}", self.port, self.token))
    }
    pub async fn request(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let client = config::local_client();
        let url = format!("http://127.0.0.1:{}/api/{path}", self.port);
        let request = if let Some(body) = body {
            client.post(url).json(&body)
        } else {
            client.get(url)
        };
        let response = request.bearer_auth(&self.token).send().await?;
        Self::response(response).await
    }
    pub async fn upload_terminology(&self, name: &str, bytes: Vec<u8>) -> Result<Value> {
        let response = config::local_client()
            .post(format!(
                "http://127.0.0.1:{}/api/terminology/file",
                self.port
            ))
            .query(&[("name", name)])
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .bearer_auth(&self.token)
            .body(bytes)
            .send()
            .await?;
        Self::response(response).await
    }
    async fn response(response: reqwest::Response) -> Result<Value> {
        let status = response.status();
        let value: Value = response.json().await?;
        if !status.is_success() {
            bail!(
                "{}",
                value["message"].as_str().unwrap_or("本地服务请求失败")
            );
        }
        Ok(value)
    }
    pub async fn alive(&self) -> bool {
        self.request("state", None).await.is_ok()
    }
}

pub async fn start(
    paths: &Paths,
    port: u16,
    endpoint: Option<&str>,
    no_open: bool,
    allow_fixture: bool,
) -> Result<()> {
    start_binary(
        paths,
        port,
        endpoint,
        no_open,
        allow_fixture,
        &std::env::current_exe()?,
    )
    .await
}

async fn start_binary(
    paths: &Paths,
    port: u16,
    endpoint: Option<&str>,
    no_open: bool,
    allow_fixture: bool,
    executable: &Path,
) -> Result<()> {
    if bundled_application(executable).is_some()
        && let Ok(runtime) = Runtime::read(paths)
        && runtime.alive().await
        && !runtime_matches(&runtime, executable)
    {
        // 仅正常停止当前数据目录的 Palboo；移动/升级 App 不重开 Codex。
        stop_runtime(paths, &runtime).await?;
    }
    if let Ok(runtime) = Runtime::read(paths)
        && runtime.alive().await
    {
        anyhow::ensure!(
            bundled_application(executable).is_none() || runtime_matches(&runtime, executable),
            "另一来源的 Palboo 后台已启动，请先正常退出后重试"
        );
        if let Some(endpoint) = endpoint {
            runtime
                .request("connect", Some(json!({"endpoint":endpoint})))
                .await?;
        }
        if !no_open {
            webbrowser::open(&runtime.url()).context("无法自动打开浏览器")?;
        }
        println!("Palboo 已在运行：http://127.0.0.1:{}", runtime.port);
        return Ok(());
    }
    let log_path = paths.root.join("service.log");
    if !log_path.exists() {
        write_private(&log_path, b"")?;
    }
    let log = std::fs::OpenOptions::new().append(true).open(log_path)?;
    let mut command = Command::new(executable);
    command
        .arg("--data-dir")
        .arg(&paths.root)
        .arg("serve")
        .arg("--port")
        .arg(port.to_string());
    if let Some(endpoint) = endpoint {
        command.arg("--cdp").arg(endpoint);
    }
    if allow_fixture {
        command.arg("--allow-fixture");
    }
    command
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    detach(&mut command);
    let mut child = command.spawn().context("无法启动后台服务")?;
    for _ in 0..80 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if let Ok(runtime) = Runtime::read(paths)
            && runtime.alive().await
        {
            anyhow::ensure!(
                bundled_application(executable).is_none() || runtime_matches(&runtime, executable),
                "另一来源的 Palboo 后台已启动，请先正常退出后重试"
            );
            if !no_open {
                webbrowser::open(&runtime.url()).context("服务已启动，但无法自动打开浏览器")?;
            }
            println!("Palboo 已启动：http://127.0.0.1:{}", runtime.port);
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            bail!(
                "后台启动失败（{status}），请查看 {}",
                paths.root.join("service.log").display()
            );
        }
    }
    bail!("后台启动超时，请运行 doctor 检查")
}

fn bundled_application(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app"
        && contents.join("Info.plist").is_file())
    .then(|| app.to_path_buf())
}

fn runtime_matches(runtime: &Runtime, executable: &Path) -> bool {
    runtime.version == VERSION
        && std::fs::canonicalize(&runtime.executable)
            .ok()
            .zip(std::fs::canonicalize(executable).ok())
            .is_some_and(|(running, requested)| running == requested)
}

pub(crate) fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

pub async fn stop(paths: &Paths) -> Result<()> {
    let Ok(runtime) = Runtime::read(paths) else {
        println!("Palboo 未运行");
        return Ok(());
    };
    if !runtime.alive().await {
        println!("Palboo 未运行（发现旧运行信息）");
        return Ok(());
    }
    stop_runtime(paths, &runtime).await
}

async fn stop_runtime(paths: &Paths, runtime: &Runtime) -> Result<()> {
    // 使用已核验实例的地址和 token，不能重读后停止并发启动的新实例。
    let mut failure = runtime.request("shutdown", Some(json!({}))).await.err();
    for _ in 0..70 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let replaced = Runtime::read(paths).is_ok_and(|current| current.token != runtime.token);
        if !runtime.alive().await && (service_unlocked(paths) || replaced) {
            println!("Palboo 已停止");
            return Ok(());
        }
        // 原实例可能已由另一启动请求停止；仅在它尚未完成退出时保留请求错误。
        if let Some(error) = failure.take() {
            return Err(error);
        }
    }
    bail!("服务尚未完全停止，请检查 service.log")
}

fn service_unlocked(paths: &Paths) -> bool {
    use fs2::FileExt;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(paths.root.join("service.lock"))
        .is_ok_and(|file| file.try_lock_exclusive().is_ok())
}

pub async fn status(paths: &Paths) -> Result<()> {
    if let Ok(runtime) = Runtime::read(paths)
        && let Ok(view) = runtime.request("state", None).await
    {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"running":true,"pid":runtime.pid,"port":runtime.port,"version":runtime.version,"connection":view["connection"],"hasAnswer":view["desktop"]["hasAnswer"],"headings":view["desktop"]["headings"],"model":view["model"]})
            )?
        );
    } else {
        println!("{{\"running\":false}}");
    }
    Ok(())
}

pub async fn doctor(paths: &Paths, endpoint: Option<String>) -> Result<()> {
    let config = paths.load()?;
    let model = crate::model::Model::load(&config).with_key(paths.load_key()?);
    let candidates = endpoint
        .or(config.cdp_endpoint)
        .map(|e| vec![e])
        .unwrap_or_else(|| [9229, 9231, 9329].iter().map(|p| p.to_string()).collect());
    let mut checks = Vec::new();
    for endpoint in candidates {
        let result = crate::cdp::discover(&endpoint, false).await;
        checks.push(json!({"endpoint":endpoint,"reachable":result.is_ok(),"windows":result.as_ref().map(Vec::len).unwrap_or(0)}));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"version":VERSION,"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"dataDirectory":paths.root,"codexBinary":model.binary,"model":model.info(),"desktop":find_desktop(),"cdp":checks})
        )?
    );
    Ok(())
}

pub async fn launch(
    paths: &Paths,
    executable: Option<PathBuf>,
    isolated: bool,
    no_open: bool,
    restart_running: bool,
    host_only: bool,
) -> Result<()> {
    let config = paths.load()?;
    if !host_only && !config.performance.integration_enabled {
        start(paths, config::DEFAULT_PORT, None, no_open, false).await?;
        println!("Codex 集成已暂停");
        return Ok(());
    }
    if config.codex_host.enabled {
        anyhow::ensure!(!isolated, "CodexHost 不支持独立 profile 启动");
        let (_, desktop, _) =
            crate::codex_host::prepare(&config.codex_host, executable.as_deref()).await?;
        if crate::codex_host::running().await?.is_none()
            && let Some(pid) = desktop_process(&desktop)?
        {
            // Preserve the existing refusal to quit independent profiles.
            process_debug_endpoint(pid)?;
            anyhow::ensure!(
                restart_running,
                "启用 CodexHost 需要重开 Codex；请结束任务后从 Palboo 启动入口应用更改"
            );
            if !restart_approved(config.host_restart_policy, || {
                confirm_codex_host_restart(true)
            })? {
                bail!("已取消重开，Codex 保持运行");
            }
            quit_desktop(
                &desktop,
                pid,
                config.host_restart_policy == config::HostRestartPolicy::Force,
                Duration::from_secs(30),
            )
            .await?;
        }
        let endpoint = crate::codex_host::launch(paths, &config.codex_host, Some(&desktop)).await?;
        return finish_launch(paths, &endpoint, no_open, host_only, true).await;
    }
    if let Some(endpoint) = paths.load()?.cdp_endpoint
        && desktop_ready(&endpoint).await
    {
        return finish_launch(paths, &endpoint, no_open, host_only, false).await;
    }
    let executable = executable
        .or_else(find_desktop)
        .context("未找到桌面 Codex，请使用 --app 指定可执行文件")?;
    if !isolated && let Some(pid) = desktop_process(&executable)? {
        // A host update may change the port; discover the existing process before
        // treating a stale saved endpoint as permission to restart it.
        if let Some(endpoint) = process_debug_endpoint(pid)? {
            for _ in 0..20 {
                if desktop_ready(&endpoint).await {
                    return finish_launch(paths, &endpoint, no_open, host_only, true).await;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            bail!("Codex 已开启调试端口，但页面尚未就绪。请稍后重试；未重启宿主。")
        }
        if !restart_running {
            bail!(
                "ChatGPT / Codex 已打开但没有调试连接。请从 Palboo App 打开，或使用 launch --restart-running 按启动设置重开；当前应用已保留。"
            )
        }
        let policy = paths.load()?.host_restart_policy;
        if !restart_approved(policy, confirm_desktop_restart)? {
            bail!("已取消重开，ChatGPT 保持运行。")
        }
        quit_desktop(
            &executable,
            pid,
            policy == config::HostRestartPolicy::Force,
            Duration::from_secs(30),
        )
        .await?;
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let profile = if isolated {
        let profile = paths.root.join("desktop-profile");
        std::fs::create_dir_all(&profile)?;
        Some(profile)
    } else {
        None
    };
    launch_desktop(&executable, port, profile.as_deref()).await?;
    let endpoint = format!("http://127.0.0.1:{port}");
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if desktop_ready(&endpoint).await {
            return finish_launch(paths, &endpoint, no_open, host_only, true).await;
        }
    }
    bail!(
        "未能连接新启动的 Codex。请检查应用是否已打开，并稍后再次打开 Palboo；不会继续退出或循环重启。"
    )
}

async fn launch_desktop(executable: &Path, port: u16, profile: Option<&Path>) -> Result<()> {
    let executable = executable.canonicalize().context("桌面程序路径无效")?;
    let application = bundled_application(&executable);
    let mut command = if let Some(app) = &application {
        // 直接 spawn App 内部程序会继承启动器的 TCC 身份；由系统启动完整 App。
        // 普通启动不使用 -n，避免与用户同时打开应用时创建第二个实例。
        let mut command = Command::new("/usr/bin/open");
        command.arg("-a").arg(app);
        if profile.is_some() {
            command.arg("-n");
        }
        command.arg("--args");
        command
    } else {
        // 保留显式 --app 指定独立可执行文件的既有用法。
        Command::new(&executable)
    };
    command.args([
        "--remote-debugging-address=127.0.0.1",
        &format!("--remote-debugging-port={port}"),
    ]);
    if let Some(profile) = profile {
        command.arg(format!("--user-data-dir={}", profile.display()));
    }
    command.stdin(Stdio::null()).stdout(Stdio::null());
    if application.is_some() {
        let output = tokio::time::timeout(
            Duration::from_secs(10),
            tokio::process::Command::from(command)
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("系统启动 Codex 超时；未尝试其他启动方式")??;
        anyhow::ensure!(
            output.status.success(),
            "系统无法打开 Codex：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    } else {
        command.stderr(Stdio::null());
        detach(&mut command);
        command.spawn().context("无法启动桌面 Codex")?;
    }
    Ok(())
}

// Dev uses the same host policy without starting or modifying the installed backend.
async fn finish_launch(
    paths: &Paths,
    endpoint: &str,
    no_open: bool,
    host_only: bool,
    update_target: bool,
) -> Result<()> {
    if host_only {
        println!("{endpoint}");
        return Ok(());
    }
    if update_target {
        let mut config = paths.load()?;
        config.cdp_endpoint = Some(endpoint.to_owned());
        config.target_id = None;
        paths.save(&config)?;
    }
    start(paths, config::DEFAULT_PORT, Some(endpoint), no_open, false).await?;
    println!("桌面 Codex 调试连接已就绪");
    Ok(())
}

fn restart_approved(
    policy: config::HostRestartPolicy,
    confirm: impl FnOnce() -> Result<bool>,
) -> Result<bool> {
    match policy {
        config::HostRestartPolicy::Ask => confirm(),
        config::HostRestartPolicy::Force => Ok(true),
    }
}

fn confirm_desktop_restart() -> Result<bool> {
    confirm_restart(crate::i18n::text(
        "ChatGPT / Codex 已打开，但没有调试连接。是否正常退出后重开，以启用 Palboo？正在执行的任务可能中断。",
        "ChatGPT / Codex is open without a debugging connection. Quit and reopen it to connect Palboo? Running tasks may be interrupted.",
    ))
}

pub(crate) fn approve_codex_host_disable(policy: config::HostRestartPolicy) -> Result<bool> {
    restart_approved(policy, || confirm_codex_host_restart(false))
}

fn confirm_codex_host_restart(enabled: bool) -> Result<bool> {
    let message = if enabled {
        crate::i18n::text(
            "启用 CodexHost 需要退出并重开 Codex。请先结束正在执行的任务。",
            "Enabling CodexHost requires quitting and reopening Codex. Finish running tasks first.",
        )
    } else {
        crate::i18n::text(
            "停用 CodexHost 需要退出并重开 Codex。正在执行的任务可能中断。",
            "Disabling CodexHost requires quitting and reopening Codex. Running tasks may be interrupted.",
        )
    };
    confirm_restart(message)
}

fn confirm_restart(message: &str) -> Result<bool> {
    let cancel = crate::i18n::text("取消", "Cancel");
    let restart = crate::i18n::text("退出并重开", "Quit and reopen");
    let script = format!(
        r#"
        tell current application
            activate
            set choice to display dialog "{message}" with title "Palboo" buttons {{"{cancel}", "{restart}"}} default button "{cancel}"
            return button returned of choice
        end tell
    "#
    );
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()?;
    if !output.status.success() {
        if String::from_utf8_lossy(&output.stderr).contains("(-128)") {
            return Ok(false);
        }
        bail!("无法显示重开确认，Codex 保持运行");
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == restart)
}

pub(crate) async fn quit_desktop(
    executable: &Path,
    pid: i32,
    force: bool,
    timeout: Duration,
) -> Result<()> {
    use objc2_app_kit::NSRunningApplication;
    // Recheck identity after the potentially long confirmation dialog.
    if desktop_process(executable)? != Some(pid) {
        bail!("宿主进程已变化，请重新打开 Palboo；未退出其他进程。")
    }
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .context("无法识别宿主应用；未退出进程。")?;
    if !(if force {
        app.forceTerminate()
    } else {
        app.terminate()
    }) {
        bail!("宿主退出请求未被接受；未尝试强制退出或打开第二个实例。")
    }
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        if desktop_process(executable)?.is_none() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    bail!("宿主尚未退出，重开已停止。请处理应用中的提示后重试；不会自动升级为强制退出。")
}

async fn desktop_ready(endpoint: &str) -> bool {
    let Ok(targets) = crate::cdp::discover(endpoint, false).await else {
        return false;
    };
    let Some(target) = targets.first() else {
        return false;
    };
    let Ok(client) = crate::cdp::Client::connect(&target.web_socket_debugger_url).await else {
        return false;
    };
    let ready = client
        .evaluate("!!document.body && document.readyState !== 'loading'".into())
        .await
        .is_ok_and(|value| value == true);
    // Drop this read-only probe without touching the injected capsule owned by a service.
    drop(client);
    ready
}

pub async fn update(paths: &Paths, from: &Path, expected_hash: &str) -> Result<()> {
    let current = std::env::current_exe()?;
    anyhow::ensure!(
        bundled_application(&current).is_none(),
        "请下载 DMG 并替换完整 Palboo.app；不能单独更新 App 内的主程序"
    );
    let bytes = std::fs::read(from).context("无法读取升级文件")?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected_hash.to_lowercase() {
        bail!("SHA-256 不匹配，原程序保持不变");
    }
    let result = Command::new(from)
        .arg("--version")
        .output()
        .context("升级文件无法在此平台运行")?;
    if !result.status.success() || !String::from_utf8_lossy(&result.stdout).starts_with("palboo ") {
        bail!("升级文件不是可运行的 Palboo");
    }
    let previous = paths.root.join("previous-binary");
    std::fs::copy(&current, &previous).context("无法保留上一版本")?;
    let runtime = Runtime::read(paths).ok();
    let was_running = if let Some(runtime) = &runtime {
        runtime.alive().await
    } else {
        false
    };
    if was_running {
        stop(paths).await?;
    }
    if let Err(error) = replace_binary(&current, &bytes) {
        if was_running {
            let _ = start_binary(
                paths,
                runtime.as_ref().unwrap().port,
                None,
                true,
                false,
                &current,
            )
            .await;
        }
        return Err(error);
    }
    if was_running
        && let Err(error) = start_binary(
            paths,
            runtime.as_ref().unwrap().port,
            None,
            true,
            false,
            &current,
        )
        .await
    {
        replace_binary(&current, &std::fs::read(&previous)?)?;
        let _ = start_binary(
            paths,
            runtime.as_ref().unwrap().port,
            None,
            true,
            false,
            &current,
        )
        .await;
        bail!("新版未能启动，已恢复上一版本：{error}");
    }
    println!(
        "Palboo 已升级，配置已保留。上一版本：{}",
        previous.display()
    );
    Ok(())
}

fn replace_binary(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let mut staging = tempfile::NamedTempFile::new_in(path.parent().context("程序路径错误")?)?;
    staging.write_all(bytes)?;
    staging
        .as_file()
        .set_permissions(std::fs::Permissions::from_mode(0o755))?;
    staging.as_file().sync_all()?;
    staging.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod restart_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires a macOS graphical login session to launch the fixture App"]
    async fn app_launch_keeps_its_own_permission_identity_and_reuses_the_running_instance() {
        use objc2::rc::Retained;
        use objc2_app_kit::NSRunningApplication;

        struct Cleanup(Vec<Retained<NSRunningApplication>>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for app in &self.0 {
                    app.forceTerminate();
                }
            }
        }
        let mut cleanup = Cleanup(Vec::new());
        let dir = tempfile::tempdir().unwrap();
        let contents = dir.path().join("Launch Fixture.app/Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::write(contents.join("Info.plist"), format!(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.palboo.launch-fixture.{}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>"#, uuid::Uuid::new_v4())).unwrap();
        let source = dir.path().join("fixture.m");
        std::fs::write(&source, r#"
#import <Cocoa/Cocoa.h>
#include <dlfcn.h>
#include <unistd.h>
@interface Delegate : NSObject <NSApplicationDelegate>
@end
@implementation Delegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSArray *args = NSProcessInfo.processInfo.arguments;
    NSURL *directory = [NSBundle.mainBundle.bundleURL URLByDeletingLastPathComponent];
    for (NSString *arg in args) {
        if ([arg hasPrefix:@"--user-data-dir="]) {
            directory = [NSURL fileURLWithPath:[arg substringFromIndex:16] isDirectory:YES];
        }
    }
    // 仅测试进程读取自身归属；不访问受保护文件或请求系统权限。
    pid_t (*responsible)(pid_t) = dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
    NSDictionary *report = @{@"pid": @(getpid()), @"responsiblePid": @(responsible ? responsible(getpid()) : -1), @"args": args};
    NSData *data = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
    [data writeToURL:[directory URLByAppendingPathComponent:@"launch.json"] atomically:YES];
    [NSTimer scheduledTimerWithTimeInterval:15 repeats:NO block:^(NSTimer *timer) { [NSApp terminate:nil]; }];
}
@end
int main(void) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        Delegate *delegate = [Delegate new];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [app run];
    }
    return 0;
}
"#).unwrap();
        let executable = contents.join("MacOS/fixture");
        let build = Command::new("/usr/bin/clang")
            .args(["-framework", "Cocoa", "-w"])
            .arg(source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        let signed = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(contents.parent().unwrap())
            .output()
            .unwrap();
        assert!(
            signed.status.success(),
            "{}",
            String::from_utf8_lossy(&signed.stderr)
        );
        let profile = dir.path().join("Isolated profile with spaces");
        std::fs::create_dir(&profile).unwrap();
        for profile in [None, Some(profile.as_path())] {
            let report = profile.unwrap_or(dir.path()).join("launch.json");
            launch_desktop(&executable, 49123, profile).await.unwrap();
            for _ in 0..100 {
                if report.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let value: Value = serde_json::from_slice(&std::fs::read(report).unwrap()).unwrap();
            let pid = value["pid"].as_i64().unwrap() as i32;
            cleanup
                .0
                .push(NSRunningApplication::runningApplicationWithProcessIdentifier(pid).unwrap());
            assert_eq!(
                value["responsiblePid"], value["pid"],
                "fixture inherited launcher permissions: {value}"
            );
            let args = value["args"].as_array().unwrap();
            assert!(args.contains(&json!("--remote-debugging-address=127.0.0.1")));
            assert!(args.contains(&json!("--remote-debugging-port=49123")));
            if let Some(profile) = profile {
                assert!(args.contains(&json!(format!("--user-data-dir={}", profile.display()))));
            } else {
                launch_desktop(&executable, 49124, None).await.unwrap();
                assert_eq!(desktop_process(&executable).unwrap(), Some(pid));
            }
            quit_desktop(&executable, pid, false, Duration::from_secs(3))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn app_handoff_stops_only_the_observed_instance_when_runtime_changes() {
        use std::sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        };
        for vanished in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let paths = Paths::new(Some(dir.path().to_owned())).unwrap();
            let executable = dir.path().join("Palboo.app/Contents/MacOS/palboo");
            std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
            std::fs::write(&executable, b"fixture").unwrap();
            std::fs::write(
                dir.path().join("Palboo.app/Contents/Info.plist"),
                b"fixture",
            )
            .unwrap();
            let next_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let next = Runtime {
                pid: 2,
                port: next_listener.local_addr().unwrap().port(),
                token: "new-instance".into(),
                version: VERSION.into(),
                executable: executable.clone(),
            };
            // 新实例没有 shutdown 路由，任何误停都会失败。
            let next_server = tokio::spawn(async move {
                axum::serve(
                    next_listener,
                    axum::Router::new().route(
                        "/api/state",
                        axum::routing::get(|| async { axum::Json(json!({})) }),
                    ),
                )
                .await
                .unwrap()
            });
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let old = Runtime {
                pid: 1,
                port: listener.local_addr().unwrap().port(),
                token: "old-instance".into(),
                version: "0.0.0-fixture".into(),
                executable: executable.clone(),
            };
            std::fs::write(paths.runtime(), serde_json::to_vec(&old).unwrap()).unwrap();
            let stopped = Arc::new(AtomicBool::new(false));
            let observed = stopped.clone();
            let shutdown = stopped.clone();
            let runtime_path = paths.runtime();
            let next_bytes = serde_json::to_vec(&next).unwrap();
            let router = axum::Router::new()
                .route(
                    "/api/state",
                    axum::routing::get(move || {
                        let stopped = observed.load(Ordering::SeqCst);
                        if vanished {
                            observed.store(true, Ordering::SeqCst);
                        }
                        std::fs::write(&runtime_path, &next_bytes).unwrap();
                        async move {
                            (
                                if stopped {
                                    axum::http::StatusCode::SERVICE_UNAVAILABLE
                                } else {
                                    axum::http::StatusCode::OK
                                },
                                axum::Json(json!({})),
                            )
                        }
                    }),
                )
                .route(
                    "/api/shutdown",
                    axum::routing::post(move |headers: axum::http::HeaderMap| async move {
                        assert_eq!(headers["authorization"], "Bearer old-instance");
                        shutdown.store(true, Ordering::SeqCst);
                        (
                            if vanished {
                                axum::http::StatusCode::UNAUTHORIZED
                            } else {
                                axum::http::StatusCode::OK
                            },
                            axum::Json(json!({})),
                        )
                    }),
                );
            let old_server =
                tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
            let result = start_binary(&paths, 0, None, true, false, &executable).await;
            old_server.abort();
            next_server.abort();
            assert!(result.is_ok(), "{result:?}");
            assert!(stopped.load(Ordering::SeqCst));
            assert_eq!(Runtime::read(&paths).unwrap().token, next.token);
        }
    }

    #[tokio::test]
    async fn quits_only_the_selected_fixture_app_and_never_escalates_a_refusal() {
        struct Fixture(std::process::Child);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let contents = dir.path().join("Restart Fixture.app/Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::write(contents.join("Info.plist"), r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.palboo.restart-fixture</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>"#).unwrap();
        let source = dir.path().join("fixture.m");
        std::fs::write(&source, r#"
#import <Cocoa/Cocoa.h>
@interface Delegate : NSObject <NSApplicationDelegate>
@end
@implementation Delegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [@"ready" writeToFile:[NSString stringWithUTF8String:getenv("READY_FILE")] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)app {
    [@"requested" writeToFile:[NSString stringWithUTF8String:getenv("QUIT_FILE")] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    return getenv("REFUSE_QUIT") ? NSTerminateCancel : NSTerminateNow;
}
@end
int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        Delegate *delegate = [Delegate new];
        [app setDelegate:delegate];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [app run];
    }
    return 0;
}
"#).unwrap();
        let executable = contents.join("MacOS/fixture");
        let build = Command::new("/usr/bin/clang")
            .args(["-framework", "Cocoa", "-w"])
            .arg(&source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        for (name, force, refuse) in [
            ("normal", false, false),
            ("force", true, false),
            ("refuse", false, true),
        ] {
            let ready = dir.path().join(format!("{name}-ready"));
            let quit = dir.path().join(format!("{name}-quit"));
            let mut cmd = Command::new(&executable);
            cmd.env("READY_FILE", &ready)
                .env("QUIT_FILE", &quit)
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if refuse {
                cmd.env("REFUSE_QUIT", "1");
            }
            let mut child = Fixture(cmd.spawn().unwrap());
            for _ in 0..100 {
                if ready.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(ready.exists(), "fixture did not launch");
            let result = quit_desktop(
                &executable,
                child.0.id() as i32,
                force,
                Duration::from_secs(2),
            )
            .await;
            if refuse {
                assert!(result.is_err());
                assert!(
                    child.0.try_wait().unwrap().is_none(),
                    "normal quit must not escalate"
                );
                assert!(quit.exists());
            } else {
                assert!(result.is_ok(), "{name}: {result:?}");
                assert_eq!(
                    quit.exists(),
                    !force,
                    "only normal quit invokes the delegate"
                );
            }
        }
    }

    #[tokio::test]
    async fn host_only_reuses_ready_host_without_backend_or_config_changes() {
        use futures_util::{SinkExt, StreamExt};
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().to_owned())).unwrap();
        let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let websocket = format!("ws://{}", socket.local_addr().unwrap());
        let probe = tokio::spawn(async move {
            let (stream, _) = socket.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let request = ws.next().await.unwrap().unwrap().into_text().unwrap();
            let request: serde_json::Value = serde_json::from_str(&request).unwrap();
            assert_eq!(request["method"], "Runtime.evaluate");
            ws.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "id": request["id"], "result": {"result": {"value": true}}
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        });
        let http = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", http.local_addr().unwrap());
        let router = axum::Router::new().route("/json/list", axum::routing::get(move || async move {
            axum::Json(json!([{"id":"fixture", "title":"Synthetic", "type":"page", "url":"app://-/index.html", "webSocketDebuggerUrl":websocket}]))
        }));
        let http_task = tokio::spawn(async move {
            axum::serve(http, router).await.unwrap();
        });
        let config = config::Config {
            cdp_endpoint: Some(endpoint),
            target_id: Some("original".into()),
            ..Default::default()
        };
        paths.save(&config).unwrap();
        let before = std::fs::read(paths.root.join("config.json")).unwrap();
        let result = launch(
            &paths,
            Some(dir.path().join("must-not-be-started")),
            false,
            true,
            true,
            true,
        )
        .await;
        http_task.abort();
        assert!(result.is_ok(), "{result:?}");
        probe.await.unwrap();
        assert_eq!(
            std::fs::read(paths.root.join("config.json")).unwrap(),
            before
        );
        assert!(!paths.root.join("runtime.json").exists());
    }

    #[tokio::test]
    async fn paused_launch_reuses_settings_without_preparing_or_connecting_host() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(dir.path().to_owned())).unwrap();
        let mut config = config::Config::default();
        config.performance.integration_enabled = false;
        config.codex_host.enabled = true;
        paths.save(&config).unwrap();
        let before = std::fs::read(paths.root.join("config.json")).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let runtime = Runtime {
            pid: std::process::id(),
            port: listener.local_addr().unwrap().port(),
            token: "synthetic".into(),
            version: config::VERSION.into(),
            executable: dir.path().join("unused"),
        };
        std::fs::write(paths.runtime(), serde_json::to_vec(&runtime).unwrap()).unwrap();
        // No connect route: any attempt to reconnect makes launch fail.
        let router = axum::Router::new().route(
            "/api/state",
            axum::routing::get(|| async {
                axum::Json(json!({"connection":{"status":"disconnected"}}))
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let result = launch(
            &paths,
            Some(dir.path().join("must-not-be-started")),
            false,
            true,
            true,
            false,
        )
        .await;
        server.abort();
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(
            std::fs::read(paths.root.join("config.json")).unwrap(),
            before
        );
    }

    #[test]
    fn cancellation_and_failed_confirmation_never_authorize_restart() {
        assert!(!restart_approved(config::HostRestartPolicy::Ask, || Ok(false)).unwrap());
        assert!(restart_approved(config::HostRestartPolicy::Ask, || bail!("no GUI")).is_err());
        assert!(restart_approved(config::HostRestartPolicy::Ask, || Ok(true)).unwrap());
        assert!(
            restart_approved(config::HostRestartPolicy::Force, || panic!(
                "must not prompt"
            ))
            .unwrap()
        );
    }

    #[test]
    fn discovers_changed_debug_ports_from_process_arguments() {
        assert_eq!(
            crate::host::debug_endpoint_from_args(
                "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=51952"
            ),
            Some("http://127.0.0.1:51952".into())
        );
        assert_eq!(
            crate::host::debug_endpoint_from_args(
                "a path with spaces --remote-debugging-port 9229"
            ),
            Some("http://127.0.0.1:9229".into())
        );
        for args in [
            "--remote-debugging-port=0",
            "--remote-debugging-port=70000",
            "--remote-debugging-port=bad",
            "--fake-remote-debugging-port=9229",
        ] {
            assert!(crate::host::debug_endpoint_from_args(args).is_none());
        }
    }
}
