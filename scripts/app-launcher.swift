// [INPUT]: 包内 CLI、共享模式记录、各模式既有配置与 AppKit。
// [OUTPUT]: 按模式启动工作台或暂停设置；开发窗口注册后交接焦点；--check 只检查包内程序。
// [POS]: 统一的可移动 App 入口；正式模式独立运行，开发模式使用已登记的源码与 Node。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
import AppKit
import Foundation

func localized(_ chinese: String, _ english: String) -> String {
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    let file = root?.appendingPathComponent("palboo/panel.json")
    let prefs = file.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let preference = prefs?["language"] as? String ?? "system"
    let language = preference == "system" ? (Locale.preferredLanguages.first ?? "en") : preference
    return language.lowercased().hasPrefix("zh") ? chinese : english
}

struct LaunchFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func bundledCLI() throws -> URL {
    guard let executable = Bundle.main.executableURL else {
        throw LaunchFailure(message: localized("无法定位 Palboo 应用。", "Could not locate the Palboo App."))
    }
    let cli = executable.deletingLastPathComponent().appendingPathComponent("palboo")
    guard FileManager.default.isExecutableFile(atPath: cli.path) else {
        throw LaunchFailure(message: localized("应用缺少主程序，请重新下载完整安装包。", "The App is missing its executable. Download the complete installer again."))
    }
    return cli
}

func command(_ cli: URL, _ arguments: [String]) throws -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = cli
    let controlRoot = ProcessInfo.processInfo.environment["PALBOO_LAUNCHER_HOME"].map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("palboo-launcher")
    let config = controlRoot.flatMap { try? Data(contentsOf: $0.appendingPathComponent("app-mode.json")) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let dataDir = config?["releaseData"] as? String
    process.arguments = (dataDir.map { ["--data-dir", $0] } ?? []) + arguments
    process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    // 一边读取一边等待，避免输出写满管道后相互等待。
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let output = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard process.terminationStatus == 0 else {
        throw LaunchFailure(message: output.isEmpty ? localized("Palboo 启动失败（\(process.terminationStatus)）。", "Palboo could not start (\(process.terminationStatus)).") : output)
    }
    return output
}

var developmentTarget: pid_t?
var launchedDevelopment = false
var pausedSettings: URL?

func launch() throws {
    let cli = try bundledCLI()
    let volume = try Bundle.main.bundleURL.resourceValues(forKeys: [.volumeIsReadOnlyKey])
    if volume.volumeIsReadOnly == true {
        throw LaunchFailure(message: localized("请先将 Palboo 拖入“应用程序”文件夹，再打开。", "Drag Palboo into Applications before opening it."))
    }
    let result = try command(cli, ["app-mode", "launch"])
    let outcome = result.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    if outcome?["mode"] as? String == "development" {
        launchedDevelopment = true
        developmentTarget = (outcome?["pid"] as? NSNumber)?.int32Value
        if outcome?["paused"] as? Bool == true, let url = outcome?["url"] as? String {
            pausedSettings = URL(string: url)
        }
        return
    }
    if outcome?["paused"] as? Bool == true {
        _ = try command(cli, ["start"])
    } else {
        do {
            _ = try command(cli, ["popout"])
        } catch {
            // macOS 14 保留已连接的内嵌工作台，其余失败仍显示真实原因。
            if !error.localizedDescription.contains("桌面浮窗仅支持 macOS 15") { throw error }
        }
    }
}

// 无连接、无配置写入的成品验收入口，也可从移动后的 App 直接调用。
if CommandLine.arguments.dropFirst().elementsEqual(["--check"]) {
    do {
        print(try command(bundledCLI(), ["--version"]))
        exit(0)
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

#if LAUNCHER_TEST
// 合成 CLI 的编译期测试入口，正式 App 不包含此分支。
do {
    try launch()
} catch {
    if !error.localizedDescription.contains("已取消重开") {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
#else
final class Launcher: NSObject, NSApplicationDelegate {
    private func finishDevelopment(attempt: Int = 0, requested: Bool = false) {
        let targets = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
        let target = developmentTarget.flatMap { NSRunningApplication(processIdentifier: $0) }
            ?? (developmentTarget == nil && targets.count == 1 ? targets.first : nil)
        if let target, target.isActive {
            NSApp.terminate(nil)
            return
        }
        var didRequest = requested
        if let target, !requested {
            target.unhide()
            NSApp.yieldActivation(to: target)
            _ = target.activate(from: NSRunningApplication.current, options: [.activateAllWindows])
            didRequest = true
        }
        if attempt < 40 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.finishDevelopment(attempt: attempt + 1, requested: didRequest)
            }
            return
        }
        // Non-blocking feedback if macOS declines focus; never request Automation permission.
        let source = localized(
            "display notification \"工作台已就绪，请手动切换到 Palboo 或 Codex。\" with title \"Palboo\"",
            "display notification \"The workspace is ready. Switch to Palboo or Codex to continue.\" with title \"Palboo\"")
        NSAppleScript(source: source)?.executeAndReturnError(nil)
        NSApp.terminate(nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.global(qos: .userInitiated).async {
            var failure: String?
            do {
                try launch()
            } catch {
                if !error.localizedDescription.contains("已取消重开") {
                    failure = error.localizedDescription
                }
            }
            let message = failure
            DispatchQueue.main.async {
                if let message {
                    NSApp.activate(ignoringOtherApps: true)
                    let alert = NSAlert()
                    alert.messageText = "Palboo"
                    alert.informativeText = message
                    alert.addButton(withTitle: localized("好", "OK"))
                    alert.addButton(withTitle: localized("使用正式模式", "Use release mode"))
                    if alert.runModal() == .alertSecondButtonReturn {
                        DispatchQueue.global(qos: .userInitiated).async {
                            do {
                                let cli = try bundledCLI()
                                _ = try command(cli, ["app-mode", "recover"])
                                _ = try command(cli, ["start"])
                            } catch {
                                DispatchQueue.main.sync {
                                    let failed = NSAlert(); failed.messageText = "Palboo"
                                    failed.informativeText = error.localizedDescription; failed.runModal()
                                }
                            }
                            DispatchQueue.main.async { NSApp.terminate(nil) }
                        }
                        return
                    }
                }
                if message == nil && launchedDevelopment {
                    if let pausedSettings {
                        NSWorkspace.shared.open(pausedSettings)
                    } else {
                        self.finishDevelopment()
                        return
                    }
                }
                NSApp.terminate(nil)
            }
        }
    }
}
let application = NSApplication.shared
let delegate = Launcher()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
#endif
