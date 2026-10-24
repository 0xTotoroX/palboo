// [INPUT]: App 包内 palboo 可执行程序、当前用户的既有配置与 AppKit。
// [OUTPUT]: 双击连接并显示工作台；--check 仅检查包内程序；升级时正常停止旧后台。
// [POS]: 可移动的分发 App 入口，不依赖源码、Node 或维护者的绝对路径。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
import AppKit
import Foundation

struct LaunchFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func bundledCLI() throws -> URL {
    guard let executable = Bundle.main.executableURL else {
        throw LaunchFailure(message: "无法定位 Palboo 应用。")
    }
    let cli = executable.deletingLastPathComponent().appendingPathComponent("palboo")
    guard FileManager.default.isExecutableFile(atPath: cli.path) else {
        throw LaunchFailure(message: "应用缺少主程序，请重新下载完整安装包。")
    }
    return cli
}

func command(_ cli: URL, _ arguments: [String]) throws -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = cli
    process.arguments = arguments
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
        throw LaunchFailure(message: output.isEmpty ? "Palboo 启动失败（\(process.terminationStatus)）。" : output)
    }
    return output
}

func launch() throws {
    let cli = try bundledCLI()
    let volume = try Bundle.main.bundleURL.resourceValues(forKeys: [.volumeIsReadOnlyKey])
    if volume.volumeIsReadOnly == true {
        throw LaunchFailure(message: "请先将 Palboo 拖入“应用程序”文件夹，再打开。")
    }
    let result = try command(cli, ["launch", "--no-open", "--restart-running"])
    if result.contains("Codex 集成已暂停") {
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
                    alert.addButton(withTitle: "好")
                    alert.runModal()
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
