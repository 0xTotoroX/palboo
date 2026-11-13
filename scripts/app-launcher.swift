// [INPUT]: 包内 CLI、共享模式记录、各模式既有配置与 AppKit。
// [OUTPUT]: 原生启动反馈、私有分段计时和失败重试；沿用共享主窗口，旧胶囊才调用 popout；经本 App 登记窗口与回执 PID；--check 只检查包内程序。
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
    let preference = prefs?["language"] as? String ?? "system"
    let language = preference == "system" ? (Locale.preferredLanguages.first ?? "en") : preference
    return language.lowercased().hasPrefix("zh") ? chinese : english
}

struct LaunchFailure: LocalizedError {
    let message: String
    var allowsRecovery = true
    var errorDescription: String? { message }
}

// 同一请求贯穿包内 CLI 和 Dev，旧进程无法写入下一次重试的事件文件。
final class StartupProgress {
    static let labels: [String: (String, String)] = [
        "preparing": ("正在准备 Palboo…", "Preparing Palboo…"),
        "tools": ("正在检查开发环境…", "Checking development tools…"),
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
    let started = Date()
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
    func poll() {
        guard outcome == nil,
              let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              ((attributes[.size] as? NSNumber)?.intValue ?? 262145) <= 262144,
              let text = try? String(contentsOf: file, encoding: .utf8) else { return }
        let lines = text.components(separatedBy: "\n").dropLast()
        guard lines.count >= consumed else { return }
        for line in lines.dropFirst(consumed) {
            guard stages.count < 128, let data = line.data(using: .utf8),
                  let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let phase = event["phase"] as? String, Self.labels[phase] != nil,
                  let milliseconds = event["atMs"] as? Double else { continue }
            let at = Date(timeIntervalSince1970: milliseconds / 1000)
            guard at >= started.addingTimeInterval(-0.01), at <= Date().addingTimeInterval(2),
                  at >= (stages.last?.at ?? started), phase != self.phase else { continue }
            stages.append((phase, at))
        }
        consumed = lines.count
    }
    func details(now: Date = Date()) -> String {
        stages.enumerated().map { index, stage in
            let end = index + 1 < stages.count ? stages[index + 1].at : now
            return "\(Self.message(stage.phase))  \(String(format: "%.1f", max(0, end.timeIntervalSince(stage.at))))s"
        }.joined(separator: "\n")
    }
    func mark(_ phase: String) {
        guard Self.labels[phase] != nil,
              let data = try? JSONSerialization.data(withJSONObject: ["phase": phase, "atMs": Date().timeIntervalSince1970 * 1000]) else { return }
        let descriptor = Darwin.open(file.path, O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { return }
        defer { Darwin.close(descriptor) }
        (data + Data([10])).withUnsafeBytes { bytes in
            _ = Darwin.write(descriptor, bytes.baseAddress, bytes.count)
        }
    }
    func finish(_ result: String) {
        poll()
        outcome = result
        let finished = Date()
        let records: [[String: Any]] = stages.enumerated().map { index, stage in
            let end = index + 1 < stages.count ? stages[index + 1].at : finished
            return ["phase": stage.phase, "durationMs": Int(max(0, end.timeIntervalSince(stage.at)) * 1000)]
        }
        let report: [String: Any] = ["schemaVersion": 1, "outcome": result,
            "startedAtMs": Int(started.timeIntervalSince1970 * 1000),
            "durationMs": Int(finished.timeIntervalSince(started) * 1000), "stages": records]
        let root = ProcessInfo.processInfo.environment["PALBOO_LAUNCHER_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("palboo-launcher")
        if let root, let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let destination = root.appendingPathComponent("startup-last.json")
            try? data.write(to: destination, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        }
        try? FileManager.default.removeItem(at: directory)
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

func launch() throws {
    let cli = try bundledCLI()
    let volume = try Bundle.main.bundleURL.resourceValues(forKeys: [.volumeIsReadOnlyKey])
    if volume.volumeIsReadOnly == true {
        throw LaunchFailure(message: localized("请先将 Palboo 拖入“应用程序”文件夹，再打开。", "Drag Palboo into Applications before opening it."))
    }
    let result = try command(cli, ["app-mode", "launch"])
    let outcome = result.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
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
#else
final class Launcher: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private weak var activeAlertWindow: NSWindow?
    private var progressWindow: NSWindow?
    private var contentStack: NSStackView?
    private let status = NSTextField(wrappingLabelWithString: "")
    private let elapsed = NSTextField(labelWithString: "")
    private let failureLabel = NSTextField(wrappingLabelWithString: "")
    private let spinner = NSProgressIndicator()
    private var timer: Timer?
    private var starting = false
    private var finishedAt: Date?
    private lazy var retryButton = NSButton(title: localized("重试", "Retry"), target: self, action: #selector(retry))
    private lazy var detailButton = NSButton(title: localized("详情", "Details"), target: self, action: #selector(details))
    private lazy var closeButton = NSButton(title: localized("关闭", "Close"), target: self, action: #selector(close))
    private lazy var recoverButton = NSButton(title: localized("使用正式模式", "Use release mode"), target: self, action: #selector(recover))

    private func showProgress() {
        if progressWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 170),
                styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
            window.title = "Palboo"
            window.isReleasedWhenClosed = false
            window.delegate = self
            window.collectionBehavior.insert(.moveToActiveSpace)
            let icon = NSImageView()
            icon.image = NSImage(named: NSImage.applicationIconName)
            icon.imageScaling = .scaleProportionallyDown
            icon.setAccessibilityLabel("Palboo")
            spinner.style = .spinning
            spinner.controlSize = .small
            status.font = .systemFont(ofSize: 16, weight: .medium)
            elapsed.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            elapsed.textColor = .secondaryLabelColor
            failureLabel.font = .systemFont(ofSize: 13)
            failureLabel.maximumNumberOfLines = 5
            failureLabel.lineBreakMode = .byTruncatingTail
            let progressRow = NSStackView(views: [spinner, status])
            progressRow.orientation = .horizontal
            progressRow.alignment = .centerY
            progressRow.spacing = 10
            let text = NSStackView(views: [progressRow, elapsed, failureLabel])
            text.orientation = .vertical
            text.alignment = .leading
            text.spacing = 10
            let header = NSStackView(views: [icon, text])
            header.spacing = 18
            header.alignment = .top
            let buttons = NSStackView(views: [recoverButton, detailButton, closeButton, retryButton])
            buttons.spacing = 8
            for button in [recoverButton, detailButton, closeButton, retryButton] { button.bezelStyle = .rounded }
            let content = NSStackView(views: [header, buttons])
            contentStack = content
            content.orientation = .vertical
            content.alignment = .trailing
            content.spacing = 22
            content.translatesAutoresizingMaskIntoConstraints = false
            window.contentView!.addSubview(content)
            NSLayoutConstraint.activate([
                icon.widthAnchor.constraint(equalToConstant: 52), icon.heightAnchor.constraint(equalToConstant: 52),
                content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
                content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
                content.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
                content.bottomAnchor.constraint(lessThanOrEqualTo: window.contentView!.bottomAnchor, constant: -20),
                header.widthAnchor.constraint(equalTo: content.widthAnchor)
            ])
            window.center()
            progressWindow = window
        }
        fitProgress()
        progressWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func fitProgress() {
        guard let window = progressWindow, let content = contentStack else { return }
        window.contentView?.layoutSubtreeIfNeeded()
        let height = max(170, min(520, content.fittingSize.height + 44))
        if abs(window.contentLayoutRect.height - height) > 1 {
            let top = window.frame.maxY
            window.setContentSize(NSSize(width: 480, height: height))
            window.setFrameOrigin(NSPoint(x: window.frame.minX, y: top - window.frame.height))
            window.contentView?.layoutSubtreeIfNeeded()
        }
    }
    private func refresh(now: Date = Date()) {
        guard starting, let progress = startupProgress else { return }
        progress.poll()
        status.stringValue = progress.message
        let seconds = Int(now.timeIntervalSince(progress.started))
        elapsed.stringValue = localized("已等待 \(seconds) 秒", "Elapsed: \(seconds)s")
        elapsed.isHidden = seconds < 10
        detailButton.isHidden = seconds < 10
        fitProgress()
    }
    @objc private func details() {
        let alert = NSAlert()
        alert.messageText = localized("启动详情", "Startup details")
        let timing = startupProgress?.details(now: finishedAt ?? Date()) ?? status.stringValue
        alert.informativeText = failureLabel.isHidden ? timing : failureLabel.stringValue + "\n\n" + timing
        _ = runAlert(alert)
    }
    @objc private func close() { NSApp.terminate(nil) }
    @objc private func retry() { begin() }
    @objc private func recover() { begin(recovering: true) }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if starting { sender.orderOut(nil) } else { NSApp.terminate(nil) }
        return false
    }

    private func runAlert(_ alert: NSAlert) -> NSApplication.ModalResponse {
        let window = alert.window
        window.level = .floating
        window.collectionBehavior.insert(.moveToActiveSpace)
        activeAlertWindow = window
        defer { activeAlertWindow = nil }
        NSApp.activate(ignoringOtherApps: true)
        window.orderFrontRegardless()
        return alert.runModal()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let window = activeAlertWindow {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        } else {
            showProgress()
        }
        return false
    }

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
        begin()
        #if LAUNCHER_UI_TEST
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.checkStartingUI() }
        #endif
    }

    #if LAUNCHER_UI_TEST
    // 编译期原生验收：仅合成 App 使用；读取本窗口几何，不截图或请求系统权限。
    private var checkedFailure = false
    private func checkGeometry() {
        guard let window = progressWindow, let content = window.contentView else { fatalError("missing startup window") }
        content.layoutSubtreeIfNeeded()
        for view in [status, elapsed, failureLabel, retryButton, closeButton, detailButton, recoverButton] where !view.isHidden {
            let rect = view.convert(view.bounds, to: content)
            precondition(rect.width > 0 && rect.height > 0 && content.bounds.insetBy(dx: -1, dy: -1).contains(rect), "startup control outside window: \(rect)")
        }
    }
    private func checkStartingUI() {
        precondition(starting && progressWindow?.isVisible == true)
        let original = progressWindow
        startupProgress?.mark("renderer")
        refresh(now: Date().addingTimeInterval(11))
        precondition(!elapsed.isHidden && !detailButton.isHidden && startupProgress?.phase == "renderer")
        checkGeometry()
        _ = windowShouldClose(progressWindow!)
        precondition(progressWindow?.isVisible == false && starting)
        _ = applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
        begin()
        precondition(progressWindow === original && progressWindow?.isVisible == true)
        print("native startup visible; progress, elapsed, geometry and reopen verified")
    }
    private func checkFailedUI() {
        guard !checkedFailure else { fatalError("retry failed") }
        checkedFailure = true
        precondition(!starting && !retryButton.isHidden && !closeButton.isHidden && !recoverButton.isHidden)
        checkGeometry()
        let previousFile = startupProgress!.file
        precondition(!FileManager.default.fileExists(atPath: previousFile.path))
        retry()
        precondition(starting && previousFile != startupProgress!.file)
        print("native error controls, request cleanup and retry verified")
    }
    #endif

    private func begin(recovering: Bool = false) {
        guard !starting else { showProgress(); return }
        starting = true
        finishedAt = nil
        launchedDevelopment = false
        developmentTarget = nil
        startupProgress = try? StartupProgress()
        status.stringValue = StartupProgress.message("preparing")
        failureLabel.stringValue = ""
        failureLabel.isHidden = true
        elapsed.isHidden = true
        for button in [retryButton, closeButton, recoverButton, detailButton] { button.isHidden = true }
        spinner.isHidden = false
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { spinner.startAnimation(nil) }
        showProgress()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.refresh() }
        DispatchQueue.global(qos: .userInitiated).async {
            var failure: String?
            var allowsRecovery = true
            var cancelled = false
            do {
                if recovering { _ = try command(bundledCLI(), ["app-mode", "recover"]) }
                try launch()
            } catch {
                cancelled = error.localizedDescription.contains("已取消重开")
                if !cancelled {
                    failure = error.localizedDescription
                    allowsRecovery = (error as? LaunchFailure)?.allowsRecovery ?? true
                }
            }
            let message = failure
            let canRecover = allowsRecovery
            let wasCancelled = cancelled
            DispatchQueue.main.async {
                self.timer?.invalidate()
                self.timer = nil
                self.refresh()
                self.starting = false
                self.finishedAt = Date()
                startupProgress?.finish(message != nil ? "failed" : wasCancelled ? "cancelled" : "ready")
                self.spinner.stopAnimation(nil)
                self.spinner.isHidden = true
                if let message {
                    self.status.stringValue = localized("启动未完成", "Startup did not complete")
                    self.failureLabel.stringValue = message
                    self.failureLabel.isHidden = false
                    self.retryButton.isHidden = false
                    self.closeButton.isHidden = false
                    self.detailButton.isHidden = false
                    self.recoverButton.isHidden = !canRecover || !self.savedDevelopmentMode()
                    self.showProgress()
                    #if LAUNCHER_UI_TEST
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.checkFailedUI() }
                    #endif
                    return
                }
                self.status.stringValue = wasCancelled ? localized("已取消启动", "Startup cancelled") : localized("已就绪", "Ready")
                DispatchQueue.main.asyncAfter(deadline: .now() + (wasCancelled ? 0 : 0.25)) {
                    self.progressWindow?.orderOut(nil)
                    if launchedDevelopment && !wasCancelled { self.finishDevelopment() }
                    else { NSApp.terminate(nil) }
                }
            }
        }
    }

    private func savedDevelopmentMode() -> Bool {
        let root = ProcessInfo.processInfo.environment["PALBOO_LAUNCHER_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("palboo-launcher")
        guard let root, let data = try? Data(contentsOf: root.appendingPathComponent("app-mode.json")),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return state["mode"] as? String == "development"
    }
}
let application = NSApplication.shared
let delegate = Launcher()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
#endif
