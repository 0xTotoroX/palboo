// [INPUT]: 已登记的完整 Palboo.app、当前模式可执行文件与窗口参数。
// [OUTPUT]: 经 LaunchServices 登记到原 App 的窗口进程，或未安装时的无 Dock 源码窗口。
// [POS]: panel/features 共用的进程生命周期；不创建第二个 App、不迁移业务配置。
// [PROTOCOL]: 变更时检查 src/AGENTS.md。
use anyhow::{Context, Result, ensure};
use objc2::rc::Retained;
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::{NSBundle, NSNumber, NSString};
use std::{
    ffi::OsString,
    io,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::process::ExitStatusExt,
    },
    path::Path,
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

pub enum WindowProcess {
    Standalone(Child),
    Application {
        app: Retained<NSRunningApplication>,
        pid: u32,
        exit: OwnedFd,
        exited: bool,
    },
}

impl WindowProcess {
    pub fn id(&self) -> u32 {
        match self {
            Self::Standalone(child) => child.id(),
            Self::Application { pid, .. } => *pid,
        }
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        match self {
            Self::Standalone(child) => child.try_wait(),
            Self::Application { exit, exited, .. } => {
                if !*exited {
                    // 后台没有 AppKit 主循环；用内核退出事件，避免缓存的 isTerminated。
                    let mut event: libc::kevent = unsafe { std::mem::zeroed() };
                    let timeout = libc::timespec {
                        tv_sec: 0,
                        tv_nsec: 0,
                    };
                    let count = unsafe {
                        libc::kevent(
                            exit.as_raw_fd(),
                            std::ptr::null(),
                            0,
                            &mut event,
                            1,
                            &timeout,
                        )
                    };
                    if count < 0 {
                        return Err(io::Error::last_os_error());
                    }
                    *exited = count > 0;
                }
                Ok(exited.then(|| ExitStatus::from_raw(0)))
            }
        }
    }

    pub fn kill(&mut self) -> io::Result<()> {
        if self.try_wait()?.is_some() {
            return Ok(());
        }
        match self {
            Self::Standalone(child) => child.kill(),
            Self::Application { app, .. } => {
                // NSRunningApplication 标识本次启动，不能用裸 PID 误杀复用该编号的进程。
                if app.forceTerminate() {
                    Ok(())
                } else {
                    Err(io::Error::other("无法关闭 Palboo 窗口"))
                }
            }
        }
    }

    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(status) = self.try_wait()? {
                return Ok(status);
            }
            if Instant::now() >= until {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "窗口尚未退出"));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for WindowProcess {
    fn drop(&mut self) {
        let _ = self.kill();
        let _ = self.wait();
    }
}

// 仅由 App 启动器设置；在当前 PID 完成 AppKit 身份登记后回执。
pub fn ready() -> Result<()> {
    if let Some(file) = std::env::var_os("PALBOO_WINDOW_READY_FILE") {
        crate::config::write_private(Path::new(&file), std::process::id().to_string().as_bytes())?;
    }
    Ok(())
}

pub fn spawn(arguments: &[OsString], stderr: Stdio) -> Result<WindowProcess> {
    let executable = std::env::current_exe()?;
    if let Some(bundle) = crate::app_mode::window_application()? {
        return launch(&bundle, &executable, arguments);
    }
    // 兼容未安装 App 的源码/测试入口；窗口保持 accessory，不生成 exec Dock 图标。
    Ok(WindowProcess::Standalone(
        Command::new(executable)
            .args(arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr)
            .spawn()?,
    ))
}

fn launch(bundle: &Path, executable: &Path, arguments: &[OsString]) -> Result<WindowProcess> {
    let metadata = NSBundle::bundleWithPath(&NSString::from_str(&bundle.to_string_lossy()))
        .context("Palboo.app 不可用，请重新安装完整 App")?;
    ensure!(
        metadata
            .bundleIdentifier()
            .is_some_and(|id| id.to_string() == "local.palboo.launcher"),
        "App 身份不匹配"
    );
    ensure!(
        metadata
            .objectForInfoDictionaryKey(&NSString::from_str("PalbooWindowHostVersion"))
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .is_some_and(|n| n.intValue() == 1),
        "请更新完整 Palboo.app 后打开桌面窗口"
    );
    let output = Command::new(bundle.join("Contents/MacOS/PalbooLauncher"))
        .arg("--open-window")
        .arg(executable)
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .context("无法启动 Palboo App 入口")?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    let pid: u32 = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .context("窗口进程身份无效")?;
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
        .context("Palboo 窗口进程已退出")?;
    let tracked = (|| -> io::Result<OwnedFd> {
        let fd = unsafe { libc::kqueue() };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let exit = unsafe { OwnedFd::from_raw_fd(fd) };
        let event = libc::kevent {
            ident: pid as usize,
            filter: libc::EVFILT_PROC,
            flags: libc::EV_ADD | libc::EV_ONESHOT,
            fflags: libc::NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        if unsafe { libc::kevent(fd, &event, 1, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(exit)
    })();
    match tracked {
        Ok(exit) => Ok(WindowProcess::Application {
            app,
            pid,
            exit,
            exited: false,
        }),
        Err(error) => {
            app.forceTerminate();
            Err(error.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a macOS graphical login session; only launches a synthetic App"]
    fn app_identity_survives_exec_and_tracks_actual_window_lifetime() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("Palboo.app");
        let contents = app.join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.palboo.launcher</string>
<key>CFBundleExecutable</key><string>PalbooLauncher</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>PalbooWindowHostVersion</key><integer>1</integer>
<key>LSUIElement</key><true/></dict></plist>"#,
        )
        .unwrap();
        let launcher = dir.path().join("launcher.swift");
        std::fs::write(&launcher, include_str!("../scripts/app-launcher.swift")).unwrap();
        let source = dir.path().join("fixture.swift");
        std::fs::write(&source, r#"import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
try! String(getpid()).write(toFile:ProcessInfo.processInfo.environment["PALBOO_WINDOW_READY_FILE"]!,atomically:true,encoding:.utf8)
let directory = URL(fileURLWithPath:CommandLine.arguments[2])
DispatchQueue.main.asyncAfter(deadline:.now()+0.2) {
 let current = NSRunningApplication.current
 let state:[String:Any] = ["pid":getpid(),"bundle":current.bundleURL!.path,"id":current.bundleIdentifier!]
 try! JSONSerialization.data(withJSONObject:state).write(to:directory.appendingPathComponent("identity.json"))
}
Timer.scheduledTimer(withTimeInterval:0.05,repeats:true) { _ in
 if FileManager.default.fileExists(atPath:directory.appendingPathComponent("exit").path) { app.terminate(nil) }
}
DispatchQueue.main.asyncAfter(deadline:.now()+15) { app.terminate(nil) }
app.run()
"#).unwrap();
        let executable = dir.path().join("external window");
        for (source, output) in [
            (&launcher, contents.join("MacOS/PalbooLauncher")),
            (&source, executable.clone()),
        ] {
            let result = Command::new("xcrun")
                .arg("swiftc")
                .arg(source)
                .arg("-o")
                .arg(output)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let args = [
            "--data-dir".into(),
            dir.path().as_os_str().to_owned(),
            "panel-window".into(),
            "--lease".into(),
            "fixture".into(),
        ];
        let mut first = launch(&app, &executable, &args).unwrap();
        let report = dir.path().join("identity.json");
        for _ in 0..100 {
            if report.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let identity: serde_json::Value =
            serde_json::from_slice(&std::fs::read(report).unwrap()).unwrap();
        assert_eq!(identity["pid"], first.id());
        assert_eq!(identity["id"], "local.palboo.launcher");
        assert_eq!(
            Path::new(identity["bundle"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            app.canonicalize().unwrap()
        );
        assert!(first.try_wait().unwrap().is_none());
        std::fs::write(dir.path().join("exit"), "").unwrap();
        assert!(first.wait().unwrap().success());
        std::fs::remove_file(dir.path().join("exit")).unwrap();
        let mut second = launch(&app, &executable, &args).unwrap();
        assert_ne!(second.id(), first.id());
        second.kill().unwrap();
        assert!(second.wait().unwrap().success());
        // 已退出的旧实例不能影响同一 App 的下一次窗口进程。
        first.kill().unwrap();
    }
}
