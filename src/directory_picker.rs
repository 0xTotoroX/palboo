// [INPUT]: 已认证的本机设置请求、现有 Palboo App 窗口入口与原生 NSOpenPanel。
// [OUTPUT]: 用户选择的候选目录或取消；临时回执清理后返回，不保存读取授权。
// [POS]: 独立主线程原生选择器；不读写笔记，未安装 App 时保持 accessory。
// [PROTOCOL]: 变更时检查 src/AGENTS.md。
use crate::config::{Paths, write_private};
use anyhow::{Context, Result, ensure};
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSModalPanelWindowLevel, NSModalResponseOK,
    NSOpenPanel,
};
use objc2_foundation::NSString;
use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(180);

pub fn choose(paths: &Paths) -> Result<Option<PathBuf>> {
    let temporary = tempfile::Builder::new()
        .prefix("folder-picker-")
        .tempdir_in(&paths.root)?;
    let result = temporary.path().join("selection.json");
    let mut process = crate::window_process::spawn(
        &[
            "--data-dir".into(),
            paths.root.as_os_str().into(),
            "feature-window".into(),
            "--feature".into(),
            "directory-picker".into(),
            "--lease".into(),
            temporary.path().file_name().unwrap().into(),
        ],
        Stdio::null(),
    )?;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let exited = process.try_wait()?.is_some();
        if result.exists() {
            process.wait()?;
            return Ok(serde_json::from_slice(&std::fs::read(&result)?)?);
        }
        ensure!(Instant::now() < deadline, "文件夹选择已超时，请重试");
        ensure!(!exited, "无法打开文件夹选择窗口，请输入完整路径");
        std::thread::sleep(Duration::from_millis(40));
    }
}

pub fn run(paths: &Paths, lease: &str) -> Result<()> {
    ensure!(
        lease.starts_with("folder-picker-")
            && lease
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-'),
        "无效的文件夹选择请求"
    );
    let result = paths.root.join(lease).join("selection.json");
    ensure!(
        result.parent().is_some_and(|path| path.is_dir()),
        "文件夹选择请求已结束"
    );
    let mtm = MainThreadMarker::new().context("文件夹选择器必须在主线程运行")?;
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    app.finishLaunching();
    crate::window_process::ready()?;
    // 后台异常退出也不留下孤立选择窗口；只终止本次短期辅助进程。
    std::thread::spawn(|| {
        std::thread::sleep(TIMEOUT);
        std::process::exit(0);
    });
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(false);
    panel.setCanChooseDirectories(true);
    panel.setAllowsMultipleSelection(false);
    panel.setCanCreateDirectories(false);
    panel.setCanDownloadUbiquitousContents(false);
    panel.setMessage(Some(&NSString::from_str(crate::i18n::text(
        "选择 Obsidian 笔记库或 Markdown 文件夹",
        "Choose an Obsidian vault or Markdown folder",
    ))));
    panel.setLevel(NSModalPanelWindowLevel);
    panel.makeKeyAndOrderFront(None);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    let selection = if panel.runModal() == NSModalResponseOK {
        Some(
            panel
                .URL()
                .and_then(|url| url.path())
                .context("未能读取所选文件夹路径")?
                .to_string(),
        )
    } else {
        None
    };
    write_private(&result, &serde_json::to_vec(&selection)?)?;
    Ok(())
}
