// [INPUT]: 包内 CLI、共享模式记录、各模式既有配置与 AppKit。
// [OUTPUT]: 原生启停反馈、静默唤起已有会话、私有分段计时和失败重试；沿用共享主窗口，旧胶囊才调用 popout；经本 App 登记窗口与回执 PID；--check 只检查包内程序。
// [POS]: 统一的可移动 App 入口；正式模式独立运行，开发模式使用已登记的源码与 Node。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
import AppKit
import Foundation
import Darwin

func localized(_ chinese: String, _ english: String) -> String {
    #if LAUNCHER_UI_TEST
    if let language = ProcessInfo.processInfo.environment["PALBOO_NATIVE_TEST_LANGUAGE"] {
        return language == "zh" ? chinese : english
    }
    #endif
    let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    let file = root?.appendingPathComponent("palboo/panel.json")
    let prefs = file.flatMap { try? Data(contentsOf: $0) }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let cached = (try? Data(contentsOf: LifecycleNotice.cacheURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let preference = cached?["language"] as? String ?? prefs?["language"] as? String ?? "system"
    let language = preference == "system" ? (Locale.preferredLanguages.first ?? "en") : preference
    return language.lowercased().hasPrefix("zh") ? chinese : english
}

struct LaunchFailure: LocalizedError {
    let message: String
    var allowsRecovery = true
    var errorDescription: String? { message }
}

// 同一 App 会话贯穿包内 CLI、Dev 与关联退出；重试重置时间边界，热更接续同一私有事件文件。
final class StartupProgress {
    static let labels: [String: (String, String)] = [
        "exit-start": ("正在保存当前状态…", "Saving current state…"),
        "exit-tasks": ("正在结束关联任务…", "Finishing linked tasks…"),
        "exit-compatibility": ("正在关闭兼容服务…", "Closing the integration…"),
        "exit-backend": ("正在确认后台退出…", "Confirming background exit…"),
        "exit-failed": ("退出尚未完成", "Exit is still in progress"),
        "exit-cancelled": ("已恢复运行", "Running again"),
        "preparing": ("正在准备 Palboo…", "Preparing Palboo…"),
        "source": ("正在访问开发源码…", "Accessing development sources…"),
        "development": ("正在加载开发环境…", "Loading the development environment…"),
        "tools": ("正在检查开发环境…", "Checking development tools…"),
        "checking": ("正在检查已有程序…", "Checking the existing app…"),
        "web": ("正在构建开发界面…", "Building the development interface…"),
        "build": ("正在构建开发版…", "Building the development app…"),
        "compatibility": ("正在准备 CodexHost…", "Preparing CodexHost…"),
        "confirmation": ("等待确认是否重开 Codex…", "Waiting for confirmation to reopen Codex…"),
        "closing": ("正在等待 Codex 退出…", "Waiting for Codex to quit…"),
        "opening": ("正在打开 Codex…", "Opening Codex…"),
        "host": ("正在等待 Codex 就绪…", "Waiting for Codex…"),
        "renderer": ("Codex 已打开，正在连接 CodexHost…", "Codex is open. Connecting CodexHost…"),
        "connecting": ("正在连接 Palboo…", "Connecting Palboo…"),
        "workspace": ("正在准备工作台…", "Preparing the workspace…"),
        "presenting": ("正在显示工作台…", "Opening the workspace…")
    ]
    let directory: URL
    let file: URL
    private(set) var started = Date()
    private(set) var backendPID: pid_t?, supervisorPID: pid_t?
    private(set) var mode: String?
    private(set) var exiting = false
    private(set) var stages: [(phase: String, at: Date)] = []
    private var consumed = 0
    private(set) var outcome: String?

    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("palboo-startup-" + UUID().uuidString)
        file = directory.appendingPathComponent("events.jsonl")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        guard FileManager.default.createFile(atPath: file.path, contents: Data(), attributes: [.posixPermissions: 0o600]) else {
            try? FileManager.default.removeItem(at: directory)
            throw LaunchFailure(message: localized("无法准备启动状态。", "Could not prepare startup status."))
        }
        stages = [("preparing", started)]
    }
    deinit { try? FileManager.default.removeItem(at: directory) }
    var phase: String { stages.last?.phase ?? "preparing" }
    var message: String { Self.message(phase) }
    static func message(_ phase: String) -> String {
        let value = labels[phase] ?? labels["preparing"]!
        return localized(value.0, value.1)
    }
    @discardableResult func poll() -> [(phase: String, at: Date)] {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              ((attributes[.size] as? NSNumber)?.intValue ?? 262145) <= 262144,
              let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        let lines = text.components(separatedBy: "\n").dropLast()
        guard lines.count >= consumed else { return [] }
        var received: [(phase: String, at: Date)] = []
        for line in lines.dropFirst(consumed) {
            guard let data = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let phase = event["phase"] as? String,
                  let milliseconds = event["atMs"] as? Double else { continue }
            let at = Date(timeIntervalSince1970: milliseconds / 1000)
            guard at >= started.addingTimeInterval(-0.01), at <= Date().addingTimeInterval(2) else { continue }
            observeMode(event["mode"] as? String)
            if let pid = event["pid"] as? Int32, pid > 0 {
                if phase == "backend" || phase == "exit-backend" { backendPID = pid }
                if phase == "supervisor" { supervisorPID = pid }
            }
            guard Self.labels[phase] != nil else { continue }
            // A ready app may receive many hot-reload phases; only genuine exit starts a new flow.
            if outcome != nil && !exiting && phase != "exit-start" { continue }
            guard at >= (stages.last?.at ?? started), phase != self.phase else { continue }
            if phase == "exit-start" && !exiting { exiting = true; outcome = nil; started = at; stages = [] }
            guard stages.count < 128 else { continue }
            stages.append((phase, at))
            received.append((phase, at))
        }
        consumed = lines.count
        return received
    }
    func details(now: Date = Date()) -> String {
        stages.enumerated().map { index, stage in
            let end = index + 1 < stages.count ? stages[index + 1].at : now
            return "\(Self.message(stage.phase))  \(String(format: "%.1f", max(0, end.timeIntervalSince(stage.at))))s"
        }.joined(separator: "\n")
    }
    func mark(_ phase: String, ownerPID: pid_t? = nil, mode: String? = nil) {
        guard Self.labels[phase] != nil || ["mode", "backend", "supervisor"].contains(phase) else { return }
        var event: [String: Any] = ["phase": phase, "atMs": Date().timeIntervalSince1970 * 1000, "pid": ownerPID ?? ProcessInfo.processInfo.processIdentifier]
        if let mode, ["development", "release"].contains(mode) { event["mode"] = mode }
        guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
        let descriptor = Darwin.open(file.path, O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { return }
        defer { Darwin.close(descriptor) }
        (data + Data([10])).withUnsafeBytes { bytes in
            _ = Darwin.write(descriptor, bytes.baseAddress, bytes.count)
        }
    }
    func cancelExit() { exiting = false; outcome = nil }
    func observeMode(_ value: String?) { if let value, ["development", "release"].contains(value) { mode = value } }
    func observeOwners(backend: pid_t, supervisor: pid_t?, mode: String?) { backendPID = backend; supervisorPID = supervisor; observeMode(mode) }
    func restart() {
        poll(); started = Date(); stages = [("preparing", started)]; outcome = nil; exiting = false
        backendPID = nil; supervisorPID = nil; mode = nil
    }
    func finish(_ result: String) {
        poll()
        outcome = result
        let finished = Date()
        let records: [[String: Any]] = stages.enumerated().map { index, stage in
            let end = index + 1 < stages.count ? stages[index + 1].at : finished
            return ["phase": stage.phase, "durationMs": Int(max(0, end.timeIntervalSince(stage.at)) * 1000)]
        }
        var report: [String: Any] = ["schemaVersion": 1, "outcome": result,
            "startedAtMs": Int(started.timeIntervalSince1970 * 1000),
            "durationMs": Int(finished.timeIntervalSince(started) * 1000), "stages": records]
        if let mode { report["mode"] = mode }
        let root = ProcessInfo.processInfo.environment["PALBOO_LAUNCHER_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("palboo-launcher")
        if let root, let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let destination = root.appendingPathComponent(exiting ? "exit-last.json" : "startup-last.json")
            try? data.write(to: destination, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        }
    }
}
var startupProgress: StartupProgress?

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
    if let progress = startupProgress {
        var environment = ProcessInfo.processInfo.environment
        environment["PALBOO_STARTUP_PROGRESS"] = progress.file.path
        process.environment = environment
    }
    try process.run()
    // 一边读取一边等待，避免输出写满管道后相互等待。
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    var output = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard process.terminationStatus == 0 else {
        while output.hasPrefix("Error: ") {
            output = String(output.dropFirst("Error: ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        throw LaunchFailure(message: output.isEmpty ? localized("Palboo 启动失败（\(process.terminationStatus)）。", "Palboo could not start (\(process.terminationStatus)).") : output)
    }
    return output
}

var developmentTarget: pid_t?
var launchedDevelopment = false
var launchedMode: String?

func launch() throws {
    let cli = try bundledCLI()
    let volume = try Bundle.main.bundleURL.resourceValues(forKeys: [.volumeIsReadOnlyKey])
    if volume.volumeIsReadOnly == true {
        throw LaunchFailure(message: localized("请先将 Palboo 拖入“应用程序”文件夹，再打开。", "Drag Palboo into Applications before opening it."))
    }
    let result = try command(cli, ["app-mode", "launch"])
    let outcome = result.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    launchedMode = outcome?["mode"] as? String
    if outcome?["paused"] as? Bool == true {
        throw LaunchFailure(message: localized(
            "连接已暂停。请返回 ChatGPT 内已打开的 Palboo 设置页恢复连接。",
            "The connection is paused. Resume it from the Palboo settings page already open inside ChatGPT."), allowsRecovery: false)
    }
    if outcome?["mode"] as? String == "development" || outcome?["mainManaged"] as? Bool == true {
        launchedDevelopment = true
        developmentTarget = (outcome?["pid"] as? NSNumber)?.int32Value
        return
    }
    do {
        startupProgress?.mark("presenting")
        _ = try command(cli, ["popout"])
    } catch {
        // macOS 14 保留已连接的内嵌工作台，其余失败仍显示真实原因。
        if !error.localizedDescription.contains("桌面浮窗仅支持 macOS 15") { throw error }
    }
}

func launcherCommandModes() {
// 后台没有 AppKit 主循环。由同一启动器完成系统启动并回传真实 PID，随后退出。
if CommandLine.arguments.dropFirst().first == "--open-window" {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.createsNewApplicationInstance = true
    configuration.allowsRunningApplicationSubstitution = false
    configuration.activates = false
    configuration.addsToRecentItems = false
    configuration.arguments = ["--palboo-window"] + Array(CommandLine.arguments.dropFirst(2))
    configuration.environment = ProcessInfo.processInfo.environment.filter {
        !["__CFBundleIdentifier", "XPC_SERVICE_NAME", "XPC_FLAGS"].contains($0.key)
    }
    let responseDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("palboo-window-" + UUID().uuidString)
    do {
        try FileManager.default.createDirectory(at: responseDirectory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
    } catch { fputs("Could not prepare Palboo window receipt\n", stderr); exit(1) }
    let response = responseDirectory.appendingPathComponent("ready")
    configuration.environment["PALBOO_WINDOW_READY_FILE"] = response.path
    func finish(_ status: Int32, _ message: String) -> Never {
        try? FileManager.default.removeItem(at: responseDirectory)
        if status == 0 { print(message) } else { fputs("\(message)\n", stderr) }
        exit(status)
    }
    var launched: NSRunningApplication?
    NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { application, error in
        DispatchQueue.main.async {
            guard let application else { finish(1, error?.localizedDescription ?? "Could not open Palboo") }
            launched = application
        }
    }
    // exec 后 LaunchServices 的初始对象可能暂时没有 PID；窗口在 AppKit 就绪后亲自回执。
    Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
        if let data = try? String(contentsOf: response, encoding: .utf8), let pid = Int32(data), pid > 0 {
            finish(0, String(pid))
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        launched?.forceTerminate()
        finish(1, "Palboo window launch timed out")
    }
    RunLoop.main.run()
    exit(1)
}

// LaunchServices 先登记本 App，再由同一 PID 进入当前正式/开发窗口程序。
// 不初始化第二个 NSApplication，也不另开终端或子应用。
if CommandLine.arguments.dropFirst().first == "--palboo-window" {
    let args = Array(CommandLine.arguments.dropFirst(2))
    guard args.count >= 6,
          ["panel-window", "feature-window"].contains(args[3]),
          args[1] == "--data-dir", args.contains("--lease"),
          FileManager.default.isExecutableFile(atPath: args[0]) else {
        fputs("Invalid Palboo window request\n", stderr)
        exit(1)
    }
    let pointers = args.map { strdup($0) } + [nil]
    execv(args[0], pointers)
    fputs("Could not start Palboo window: \(String(cString: strerror(errno)))\n", stderr)
    exit(1)
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

}

#if !LAUNCHER_TEST
final class Launcher: NSObject, NSApplicationDelegate {
    let notice = LifecycleNotice()
    private static let restartPhases: Set<String> = [
        "tools", "web", "build", "confirmation", "closing", "opening", "host"
    ]
    private var timer: Timer?, starting = false, exitObserved = false, completionShown = false
    private var silentReopen = false
    private var finishedAt: Date?, failure = "", canRecover = false
    private weak var activeAlertWindow: NSWindow?
    private func refresh() {
        guard let progress = startupProgress else { return }
        let received = progress.poll(); notice.updateTimes()
        if notice.runtimeMode != progress.mode { notice.runtimeMode = progress.mode; notice.render(animate: false) }
        if !starting && !progress.exiting { notice.attachProgress(progress.file) { progress.observeOwners(backend: $0, supervisor: $1, mode: $2) } }
        if starting {
            for stage in received {
                let index: Int
                switch stage.phase {
                case "confirmation", "closing", "opening", "host": index = 1
                case "renderer", "connecting": index = 2
                case "workspace": index = 3
                case "presenting": index = 4
                default: index = 0
                }
                if index >= notice.completed { notice.liveStage(index, text: StartupProgress.message(stage.phase), at: stage.at) }
            }
            // 常规唤起也会读取源码和等待工作台，只有实际进入启动准备时才恢复自动弹出。
            if silentReopen && received.contains(where: { Self.restartPhases.contains($0.phase) }) {
                silentReopen = false
                if notice.displayPicker.indexOfSelectedItem == 0 { notice.show() }
            }
            return
        }
        guard progress.exiting && !completionShown else { return }
        if !exitObserved {
            exitObserved = true; notice.retryAction = nil; notice.beginLive(exiting: true, at: progress.started)
            failure = localized("关联服务尚未完成退出，请稍后查看。", "Linked services have not finished exiting yet.")
        }
        for stage in progress.stages {
            if let index = ["exit-tasks": 1, "exit-compatibility": 2, "exit-backend": 3][stage.phase] {
                notice.liveStage(index, at: stage.at)
            }
        }
        switch progress.phase {
        case "exit-start": break
        case "exit-tasks": break
        case "exit-compatibility": break
        case "exit-backend":
            if let backend = progress.backendPID {
                let owners = [backend] + (progress.supervisorPID.map { [$0] } ?? [])
                if owners.allSatisfy({ Darwin.kill($0, 0) != 0 && errno == ESRCH }) {
                    completionShown = true; progress.finish("exited")
                    #if LAUNCHER_UI_TEST
                    print("native exit waited for the owned process to stop")
                    #endif
                    notice.liveSuccess(exiting: true) { NSApp.terminate(nil) }
                } else if Date().timeIntervalSince(progress.stages.last!.at) > 30 {
                    if progress.outcome == nil { progress.finish("failed") }
                    notice.liveFailure(localized("退出尚未完成", "Exit is still in progress"))
                }
            }
        case "exit-failed":
            if progress.outcome == nil { progress.finish("failed") }
            notice.liveFailure(localized("退出尚未完成", "Exit is still in progress"))
        case "exit-cancelled": notice.hide(); exitObserved = false; progress.cancelExit()
        default: break
        }
    }
    @objc private func details() {
        let alert = NSAlert()
        alert.messageText = localized("Palboo 运行详情", "Palboo activity details")
        alert.informativeText = failure + "\n\n" + (startupProgress?.details(now: finishedAt ?? Date()) ?? "")
        alert.addButton(withTitle: localized("好", "OK"))
        if canRecover { alert.addButton(withTitle: localized("使用正式模式", "Use release mode")) }
        notice.hide(); activeAlertWindow = alert.window
        let result = alert.runModal(); activeAlertWindow = nil
        if result == .alertSecondButtonReturn { begin(recovering: true) }
        else if notice.displayPicker.indexOfSelectedItem == 0 { notice.show() }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        refresh()
        if let window = activeAlertWindow { window.makeKeyAndOrderFront(nil) }
        else if starting || (startupProgress?.exiting == true && startupProgress?.outcome == nil) {
            if (!starting || !silentReopen) && notice.displayPicker.indexOfSelectedItem != 2 { notice.show() }
        } else {
            begin(reopening: startupProgress?.outcome == "ready" && startupProgress?.exiting == false)
        }
        return false
    }
    private func finishDevelopment(generation: Int, attempt: Int = 0, requested: Bool = false) {
        guard notice.generation == generation, startupProgress?.exiting != true else { return }
        let targets = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
        let target = developmentTarget.flatMap { NSRunningApplication(processIdentifier: $0) }
            ?? (developmentTarget == nil && targets.count == 1 ? targets.first : nil)
        if target?.isActive == true { return }
        var didRequest = requested
        if let target, !requested {
            target.unhide()
            NSApp.yieldActivation(to: target)
            _ = target.activate(from: NSRunningApplication.current, options: [.activateAllWindows])
            didRequest = true
        }
        if attempt < 40 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                self.finishDevelopment(generation: generation, attempt: attempt + 1, requested: didRequest)
            }
            return
        }
        // Non-blocking feedback if macOS declines focus; never request Automation permission.
        let source = localized(
            "display notification \"工作台已就绪，请手动切换到 Palboo 或 Codex。\" with title \"Palboo\"",
            "display notification \"The workspace is ready. Switch to Palboo or Codex to continue.\" with title \"Palboo\"")
        NSAppleScript(source: source)?.executeAndReturnError(nil)
    }


    func applicationDidFinishLaunching(_ notification: Notification) {
        notice.setup(live: true)
        notice.detailsAction = { [weak self] in self?.details() }
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.refresh() }
        begin()
        #if LAUNCHER_UI_TEST
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.checkStartingUI() }
        #endif
    }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate(); notice.applicationWillTerminate(notification)
        if let progress = startupProgress { try? FileManager.default.removeItem(at: progress.directory) }
    }
    private func begin(recovering: Bool = false, reopening: Bool = false) {
        guard !starting else { if !silentReopen && notice.displayPicker.indexOfSelectedItem == 0 { notice.show() }; return }
        starting = true; finishedAt = nil; failure = ""; exitObserved = false; completionShown = false
        silentReopen = reopening
        launchedDevelopment = false; developmentTarget = nil; launchedMode = nil
        if let progress = startupProgress { progress.restart() } else { startupProgress = try? StartupProgress() }
        notice.retryAction = { [weak self] in self?.begin() }
        notice.runtimeMode = nil
        notice.beginLive(exiting: false, showAutomatically: !reopening)
        DispatchQueue.global(qos: .userInitiated).async {
            var errorText: String?, recovery = true, cancelled = false
            do {
                if recovering { _ = try command(bundledCLI(), ["app-mode", "recover"]) }
                try launch()
            } catch {
                cancelled = error.localizedDescription.contains("已取消重开")
                if !cancelled { errorText = error.localizedDescription; recovery = (error as? LaunchFailure)?.allowsRecovery ?? true }
            }
            let message = errorText, allowsRecovery = recovery, wasCancelled = cancelled
            DispatchQueue.main.async {
                startupProgress?.observeMode(launchedMode)
                self.refresh(); self.starting = false; self.finishedAt = Date()
                startupProgress?.finish(message != nil ? "failed" : wasCancelled ? "cancelled" : "ready")
                if let message {
                    self.failure = message; self.canRecover = allowsRecovery && self.savedDevelopmentMode()
                    self.notice.liveFailure(localized("启动未完成", "Startup did not complete"))
                    #if LAUNCHER_UI_TEST
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.checkFailedUI() }
                    #endif
                } else if wasCancelled { NSApp.terminate(nil) }
                else {
                    self.notice.liveSuccess(exiting: false) {
                        #if LAUNCHER_UI_TEST
                        self.checkStartupCompletion()
                        #else
                        if launchedDevelopment { self.finishDevelopment(generation: self.notice.generation) }
                        #endif
                    }
                }
            }
        }
    }
    private func savedDevelopmentMode() -> Bool {
        let root = LifecycleNotice.cacheURL.deletingLastPathComponent()
        guard let data = try? Data(contentsOf: root.appendingPathComponent("app-mode.json")),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return state["mode"] as? String == "development"
    }
    #if LAUNCHER_UI_TEST
    private var checkedFailure = false
    private var completedStartups = 0
    private var fixtureBackend: Process?
    private func checkStartupCompletion() {
        precondition(!notice.panel.isVisible, "startup completion callback ran before the notice closed")
        precondition(notice.modeLabel.isHidden && startupProgress?.mode == "release", "saved Dev preference overrode the actual release session")
        completedStartups += 1
        switch completedStartups {
        case 1:
            precondition(Date().timeIntervalSince(finishedAt!) >= 1.9, "startup completion was not held")
            print("native startup completion held and dismissed before handoff")
            _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
            startupProgress?.mark("compatibility")
            startupProgress?.mark("connecting")
            startupProgress?.mark("workspace")
            _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
            precondition(starting && !notice.panel.isVisible, "revealing the existing workspace showed startup")
        case 2:
            precondition(silentReopen, "normal reveal took the startup path")
            print("native ready reopen and duplicate clicks remained silent")
            _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
            precondition(starting && !notice.panel.isVisible)
            startupProgress?.mark("opening")
            refresh()
            precondition(notice.panel.isVisible, "a real restart during reopen did not show progress")
        default:
            precondition(!silentReopen && Date().timeIntervalSince(finishedAt!) >= 1.9)
            print("native reopen needing restart showed progress")
            checkExitUI()
        }
    }
    private func checkExitUI() {
        for _ in 0..<140 { startupProgress?.mark("build") }
        refresh()
        precondition(startupProgress?.outcome == "ready" && startupProgress?.phase == "presenting" && !exitObserved, "hot reload changed the completed startup")
        startupProgress?.mark("exit-start"); startupProgress?.mark("exit-failed"); refresh()
        precondition(notice.failed && startupProgress?.outcome == "failed" && !completionShown)
        startupProgress?.mark("exit-cancelled"); refresh()
        precondition(!notice.panel.isVisible && startupProgress?.exiting == false)
        let child = Process(); child.executableURL = URL(fileURLWithPath: "/bin/sleep"); child.arguments = ["1"]
        try! child.run(); fixtureBackend = child
        startupProgress?.mark("exit-start")
        startupProgress?.mark("exit-tasks")
        startupProgress?.mark("exit-compatibility")
        startupProgress?.mark("exit-backend", ownerPID: child.processIdentifier)
        refresh()
        precondition(notice.exiting && notice.completed == 3 && !completionShown && notice.panel.isVisible)
        precondition(notice.panel.standardWindowButton(.closeButton) == nil)
    }
    private func checkStartingUI() {
        precondition(starting && notice.panel.isVisible && !notice.panel.styleMask.contains(.titled))
        precondition(notice.palette.colors["accent"] == "#23bc98" && notice.palette.theme == "dark", "cold startup lost cached theme")
        let original = notice.panel
        startupProgress?.mark("mode", mode: "development")
        startupProgress?.mark("source"); startupProgress?.mark("build"); refresh()
        precondition(!notice.modeLabel.isHidden && notice.completed == 0)
        precondition(notice.content.bounds.contains(notice.modeLabel.frame))
        startupProgress?.mark("confirmation"); startupProgress?.mark("opening")
        startupProgress?.mark("renderer"); refresh()
        precondition(notice.timings.count == 2 && startupProgress?.stages.suffix(3).map(\.phase) == ["confirmation", "opening", "renderer"])
        precondition(notice.completed == 2 && notice.content.bounds.contains(notice.progress.frame))
        notice.hide(); precondition(starting)
        _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false); begin()
        precondition(notice.panel === original && notice.panel.isVisible)
        print("native startup visible; progress, geometry and reopen verified")
    }
    private func checkFailedUI() {
        precondition(!checkedFailure && !starting && notice.failed && !notice.retryButton.isHidden)
        precondition(notice.rows[notice.completed].text.stringValue != notice.heading.stringValue, "failure hid the actual unfinished step")
        checkedFailure = true
        let previous = startupProgress!.started
        _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
        precondition(starting && startupProgress!.started > previous)
        print("native error controls, request cleanup and retry verified")
    }
    #endif
}
#endif
@main struct PalbooLauncher {
    static func main() {
        launcherCommandModes()
        #if LAUNCHER_TEST
// 合成 CLI 的编译期测试入口，正式 App 不包含此分支。
do {
    startupProgress = try StartupProgress()
    try launch()
    startupProgress?.finish("ready")
} catch {
    startupProgress?.finish(error.localizedDescription.contains("已取消重开") ? "cancelled" : "failed")
    if !error.localizedDescription.contains("已取消重开") {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

        if let progress = startupProgress { try? FileManager.default.removeItem(at: progress.directory) }
        #else
        let application = NSApplication.shared
        let delegate = Launcher(); application.delegate = delegate
        application.setActivationPolicy(.accessory); application.run()
        #endif
    }
}
