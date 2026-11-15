import AppKit
import QuartzCore
private var previewEnglish = Locale.preferredLanguages.first?.hasPrefix("en") == true
private let previewMessages: [String: String] = [
    "尚未完成": "Not finished",
    "已完成": "Completed",
    "进行中": "In progress",
    "跟随系统": "System",
    "浅色": "Light",
    "深色": "Dark",
    "减少动态效果": "Reduce motion",
    "准备 Palboo": "Prepare Palboo",
    "打开 Codex": "Open Codex",
    "连接兼容服务": "Connect integration",
    "恢复工作台": "Restore workspace",
    "确认界面可用": "Check workspace readiness",
    "保存当前状态": "Save current state",
    "结束关联任务": "End linked tasks",
    "关闭兼容服务": "Close integration",
    "确认后台已退出": "Confirm background exit",
    "收起提示": "Hide notification",
    "继续预览": "Continue preview",
    "Palboo · 启停预览": "Palboo · Startup and exit preview",
    "Palboo · 菜单栏提示预览": "Palboo · Menu bar preview",
    "从菜单栏展开，逐行看见进展": "Follow each step from the menu bar",
    "仅演示；不会启停 ChatGPT 或 Palboo。": "Preview only. ChatGPT and Palboo keep running.",
    "播放启动": "Play startup",
    "播放退出": "Play exit",
    "模拟卡住": "Simulate a stall",
    "展开提示": "Show notification",
    "查看：启动过程": "View: starting",
    "查看：启动完成": "View: ready",
    "查看：退出过程": "View: exiting",
    "查看：退出完成": "View: fully exited",
    "查看：退出异常": "View: exit stalled",
    "材质：自动": "Material: automatic",
    "材质：液态玻璃": "Material: Liquid Glass",
    "材质：磨砂回退": "Material: frosted",
    "材质：哑光回退": "Material: matte",
    "进度：细线": "Progress: slim line",
    "进度：复古格栅": "Progress: retro segments",
    "进度：像素方块": "Progress: pixel blocks",
    "进度：能量槽": "Progress: energy meter",
    "提示：自动弹出": "Show automatically",
    "提示：仅菜单栏，不弹窗": "Menu bar only, no popup",
    "提示：不显示": "Notifications hidden",
    "位置：跟随菜单栏": "Position: below menu bar",
    "位置：记住拖动位置": "Position: remember drag",
    "回到菜单栏": "Return to menu bar",
    "细线": "Slim line",
    "复古格栅": "Retro segments",
    "像素方块": "Pixel blocks",
    "能量槽": "Energy meter",
    "拖动顶部调整位置；保留每步耗时，进度逐格点亮。": "Drag the header. Each step keeps its time; progress lights cell by cell.",
    "退出尚未完成": "Exit is still in progress",
    "Palboo 已完全退出": "Palboo has fully exited",
    "Palboo 已就绪": "Palboo is ready",
    "正在退出 Palboo": "Exiting Palboo",
    "正在启动 Palboo": "Starting Palboo",
    "兼容服务仍在退出": "Integration is still exiting",
    "已同步 Palboo 设置 · 仅影响预览": "Synced with Palboo settings · preview only",
    "未连接 Palboo；当前选择仅用于临时预览": "Palboo is offline. Choices are temporary.",
    "正在保存预览设置…": "Saving preview settings…",
    "预览设置已保存": "Preview settings saved",
    "未保存，请在 Palboo 设置页重试": "Not saved. Retry from Palboo settings."
]
private func L(_ text: String) -> String {
    let source = previewMessages.first(where: { $0.value == text })?.key ?? text
    return previewEnglish ? (previewMessages[source] ?? source) : source
}


// [INPUT]: Synthetic phases, native AppKit and optional local preview preferences.
// [OUTPUT]: Standalone draggable menu-bar notification preview; no application lifecycle actions.
// [POS]: npm run dev:status; only lifecyclePreview can be saved through the existing appearance API.
// [PROTOCOL]: Keep scripts/AGENTS.md in sync.
final class DragHeader: NSView {
    var moved: (() -> Void)?, changing: (() -> Void)?, enabled: (() -> Bool)?
    private var startPointer: NSPoint?, startOrigin = NSPoint.zero
    var dragging: Bool { startPointer != nil }
    override func mouseDown(with event: NSEvent) {
        guard enabled?() != false, let window else { return }
        startPointer = NSEvent.mouseLocation; startOrigin = window.frame.origin
    }
    override func mouseDragged(with event: NSEvent) {
        guard let start = startPointer, let window else { return }
        let point = NSEvent.mouseLocation
        window.setFrameOrigin(NSPoint(x: startOrigin.x + point.x - start.x, y: startOrigin.y + point.y - start.y))
        changing?()
    }
    override func mouseUp(with event: NSEvent) {
        guard startPointer != nil else { return }; startPointer = nil; moved?()
    }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
}
final class Canvas: NSView { override var isFlipped: Bool { true } }
final class BrandEyes: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.labelColor.setFill()
        for x: CGFloat in [7, 24] {
            NSBezierPath(roundedRect: NSRect(x: x, y: 5, width: 7, height: 21), xRadius: 3.5, yRadius: 3.5).fill()
        }
        NSColor(calibratedRed: 0.957, green: 0.639, blue: 0.678, alpha: 1).setFill()
        for x: CGFloat in [3, 33] { NSBezierPath(ovalIn: NSRect(x: x, y: 24, width: 4, height: 4)).fill() }
    }
    static func menuImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 18), flipped: false) { _ in
            NSColor.black.setFill()
            for x: CGFloat in [4, 12] { NSBezierPath(roundedRect: NSRect(x: x, y: 3, width: 4, height: 12), xRadius: 2, yRadius: 2).fill() }
            return true
        }
        image.isTemplate = true; return image
    }
}
final class StepRow: NSView {
    let mark = NSImageView(), text = NSTextField(labelWithString: ""), duration = NSTextField(labelWithString: "")
    var active = false
    override init(frame: NSRect) {
        super.init(frame: frame); wantsLayer = true
        mark.frame = NSRect(x: 0, y: 6, width: 16, height: 16)
        mark.symbolConfiguration = .init(pointSize: 12, weight: .semibold)
        text.frame = NSRect(x: 28, y: 3, width: 218, height: 22); text.font = .systemFont(ofSize: 13)
        duration.frame = NSRect(x: 249, y: 4, width: 59, height: 20)
        duration.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular); duration.alignment = .right; duration.textColor = .secondaryLabelColor
        for v in [mark, text, duration] { addSubview(v) }
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    func update(_ title: String, done: Bool, failed: Bool, reduce: Bool) {
        text.stringValue = L(title); active = !done && !failed
        text.textColor = done ? .secondaryLabelColor : .labelColor
        let symbol = failed ? "exclamationmark.circle.fill" : done ? "checkmark" : "arrow.right"
        mark.image = NSImage(systemSymbolName: symbol, accessibilityDescription: failed ? "尚未完成" : done ? "已完成" : "进行中")
        mark.contentTintColor = failed ? .systemOrange : done ? .secondaryLabelColor : .controlAccentColor
        mark.wantsLayer = true; mark.layer?.removeAnimation(forKey: "working")
        if active && !reduce {
            let pulse = CABasicAnimation(keyPath: "opacity"); pulse.fromValue = 1; pulse.toValue = 0.35
            pulse.autoreverses = true; pulse.repeatCount = .infinity; pulse.duration = 0.75
            mark.layer?.add(pulse, forKey: "working")
        }
    }
}
final class Progress: NSView {
    var fraction: Double = 0, failed = false
    var shownCells = 0, cellGeneration = 0, cellHistory = [Int]()
    override var isFlipped: Bool { true }
    override init(frame: NSRect) { super.init(frame: frame) }
    required init?(coder: NSCoder) { fatalError() }
    func update(_ value: Double, animate: Bool, failed: Bool) {
        fraction = value; self.failed = failed; cellGeneration += 1
        let stamp = cellGeneration, target = max(0, min(20, Int(value * 20 + 0.001)))
        if !animate || failed || target <= shownCells { shownCells = target; cellHistory = [target]; needsDisplay = true; return }
        advanceCell(to: target, generation: stamp)
    }
    private func advanceCell(to target: Int, generation stamp: Int) {
        guard stamp == cellGeneration else { return }
        shownCells = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? target : min(target, shownCells + 1)
        cellHistory.append(shownCells); needsDisplay = true
        if shownCells < target {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.065) { [weak self] in self?.advanceCell(to: target, generation: stamp) }
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        let color = failed ? NSColor.systemOrange : NSColor.controlAccentColor
        let track = color.withAlphaComponent(0.13)
        let gap: CGFloat = 3
        let width = (bounds.width - gap * 19) / 20
        for i in 0..<20 {
            (i < shownCells ? color : track).setFill()
            let x = CGFloat(i) * (width + gap)
            let path = NSBezierPath(); path.move(to: NSPoint(x: x+3, y: 0)); path.line(to: NSPoint(x: x+width, y: 0)); path.line(to: NSPoint(x: x+width-3, y: 12)); path.line(to: NSPoint(x: x, y: 12)); path.close(); path.fill()
        }
    }
}
final class Preview: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 356, height: 160), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let controls = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 610, height: 326), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let dragHeader = DragHeader(), saveStatus = NSTextField(labelWithString: ""), displayPicker = NSPopUpButton(), placementPicker = NSPopUpButton()
    var pinnedTop: NSPoint?, syncing = false, revision: Int = -1, preferenceTimer: Timer?, saving = false, loading = false
    var savedScreen: Int?
    var loadedPreferences: NSDictionary?
    var preferencePosition = NSPoint(x: 0.85, y: 0.12)
    var dataDirectory: URL? { guard let i = CommandLine.arguments.firstIndex(of: "--connection-dir"), i + 1 < CommandLine.arguments.count else { return nil }; return URL(fileURLWithPath: CommandLine.arguments[i+1]) }
    let shell = Canvas(), content = Canvas(), eyes = BrandEyes(), heading = NSTextField(labelWithString: "")
    let progress = Progress(frame: NSRect(x: 24, y: 120, width: 308, height: 4)), count = NSTextField(labelWithString: "")
    let theme = NSSegmentedControl(labels: ["跟随系统", "浅色", "深色"], trackingMode: .selectOne, target: nil, action: nil)
    let material = NSPopUpButton(), snapshot = NSPopUpButton(), motion = NSButton(checkboxWithTitle: "减少动态效果", target: nil, action: nil)
    var statusItem: NSStatusItem!, closeButton: NSButton!, retryButton: NSButton!, surface: NSView?
    var rows: [StepRow] = [], steps: [String] = [], timings: [Double] = [], completed = 0, exiting = false, failed = false, generation = 0
    var started = Date(), phaseStarted = Date(), ticker: Timer?, localMonitor: Any?
    var playbackActivity: NSObjectProtocol?
    var materialName = "", reportedSize = NSSize.zero
    var reduce: Bool { motion.state == .on || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    let startSteps = ["准备 Palboo", "打开 Codex", "连接兼容服务", "恢复工作台", "确认界面可用"]
    let exitSteps = ["保存当前状态", "结束关联任务", "关闭兼容服务", "确认后台已退出"]
    func label(_ title: String, _ frame: NSRect, size: CGFloat = 13, weight: NSFont.Weight = .regular) -> NSTextField {
        let v = NSTextField(labelWithString: L(title)); v.frame = frame; v.font = .systemFont(ofSize: size, weight: weight); return v
    }
    func button(_ title: String, _ frame: NSRect, _ action: Selector) -> NSButton {
        let b = NSButton(title: L(title), target: self, action: action); b.frame = frame; b.bezelStyle = .rounded; return b
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        panel.isReleasedWhenClosed = false; panel.isOpaque = false; panel.backgroundColor = .clear
        panel.isMovableByWindowBackground = false; panel.hasShadow = true; panel.hidesOnDeactivate = false; panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.contentView = shell
        shell.wantsLayer = true; shell.layer?.cornerRadius = 18; shell.layer?.masksToBounds = true
        dragHeader.frame = NSRect(x: 0, y: 0, width: 314, height: 65)
        dragHeader.enabled = { [weak self] in self?.saving == false }
        dragHeader.changing = { [weak self] in
            guard let self else { return }; placementPicker.selectItem(at: 1)
            pinnedTop = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        }
        dragHeader.moved = { [weak self] in self?.rememberPosition() }
        content.addSubview(dragHeader)
        eyes.frame = NSRect(x: 22, y: 16, width: 40, height: 34); content.addSubview(eyes)
        heading.frame = NSRect(x: 76, y: 21, width: 236, height: 23); heading.font = .systemFont(ofSize: 15, weight: .semibold)
        closeButton = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "收起提示")!, target: self, action: #selector(hide))
        closeButton.frame = NSRect(x: 318, y: 21, width: 20, height: 22); closeButton.isBordered = false; closeButton.contentTintColor = .secondaryLabelColor
        count.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular); count.textColor = .secondaryLabelColor; count.alignment = .right
        for v: NSView in [heading, closeButton!, progress, count] { content.addSubview(v) }
        content.addSubview(dragHeader, positioned: .above, relativeTo: nil)
        retryButton = button("继续预览", .zero, #selector(playExit)); content.addSubview(retryButton)
        statusItem = NSStatusBar.system.statusItem(withLength: 28)
        statusItem.button?.image = BrandEyes.menuImage(); statusItem.button?.toolTip = "Palboo · 启停预览"
        statusItem.button?.target = self; statusItem.button?.action = #selector(toggle)
        controls.title = "Palboo · 菜单栏提示预览"; controls.isReleasedWhenClosed = false; controls.delegate = self
        let c = Canvas(); controls.contentView = c
        c.addSubview(label("从菜单栏展开，逐行看见进展", NSRect(x: 24, y: 18, width: 520, height: 28), size: 19, weight: .semibold))
        let hint = label("仅演示；不会启停 ChatGPT 或 Palboo。", NSRect(x: 24, y: 51, width: 520, height: 20)); hint.textColor = .secondaryLabelColor; c.addSubview(hint)
        c.addSubview(button("播放启动", NSRect(x: 24, y: 86, width: 112, height: 28), #selector(playStart)))
        c.addSubview(button("播放退出", NSRect(x: 145, y: 86, width: 112, height: 28), #selector(playExit)))
        c.addSubview(button("模拟卡住", NSRect(x: 266, y: 86, width: 112, height: 28), #selector(showFailure)))
        c.addSubview(button("展开提示", NSRect(x: 387, y: 86, width: 159, height: 28), #selector(show)))
        snapshot.addItems(withTitles: ["查看：启动过程", "查看：启动完成", "查看：退出过程", "查看：退出完成", "查看：退出异常"])
        snapshot.frame = NSRect(x: 24, y: 128, width: 232, height: 28); snapshot.target = self; snapshot.action = #selector(selectSnapshot); c.addSubview(snapshot)
        material.addItems(withTitles: ["材质：自动", "材质：液态玻璃", "材质：磨砂回退", "材质：哑光回退"])
        material.frame = NSRect(x: 278, y: 128, width: 268, height: 28); material.target = self; material.action = #selector(changeSavedChoice); c.addSubview(material)
        theme.frame = NSRect(x: 24, y: 172, width: 283, height: 28); theme.selectedSegment = 0; theme.target = self; theme.action = #selector(changeAppearance); c.addSubview(theme)
        motion.frame = NSRect(x: 333, y: 174, width: 200, height: 24); motion.target = self; motion.action = #selector(changeAppearance); c.addSubview(motion)
        displayPicker.addItems(withTitles: ["提示：自动弹出", "提示：仅菜单栏，不弹窗", "提示：不显示"])
        displayPicker.frame = NSRect(x: 24, y: 214, width: 254, height: 28); displayPicker.target = self; displayPicker.action = #selector(changeSavedChoice); c.addSubview(displayPicker)
        placementPicker.addItems(withTitles: ["位置：跟随菜单栏", "位置：记住拖动位置"])
        placementPicker.frame = NSRect(x: 294, y: 214, width: 292, height: 28); placementPicker.target = self; placementPicker.action = #selector(changeSavedChoice); c.addSubview(placementPicker)
        c.addSubview(button("回到菜单栏", NSRect(x: 24, y: 254, width: 130, height: 28), #selector(resetPosition)))
        saveStatus.frame = NSRect(x: 170, y: 258, width: 416, height: 20); saveStatus.font = .systemFont(ofSize: 12); saveStatus.textColor = .secondaryLabelColor; c.addSubview(saveStatus)
        let foot = label("拖动顶部调整位置；保留每步耗时，进度逐格点亮。", NSRect(x: 24, y: 296, width: 562, height: 20), size: 12)
        foot.textColor = .secondaryLabelColor; c.addSubview(foot)
        localize(controls.contentView!); controls.title = L(controls.title)
        controls.center(); controls.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        loadPreferences()
        preferenceTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in self?.loadPreferences() }
        reset(exiting: false); completed = 2; timings = [0.6, 0.8]; render(animate: false)
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.hide(); return nil }; return event
        }
        NotificationCenter.default.addObserver(self, selector: #selector(changeAppearance), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(changeAppearance), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        if CommandLine.arguments.contains("--check") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.check(); NSApp.terminate(nil) } }
        else if CommandLine.arguments.contains("--motion-check") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.checkMotion() } }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { if self.displayPicker.indexOfSelectedItem == 0 { self.show() } } }
    }
    // 能力降级与系统减少透明度独立判断；预览可显式展示每个降级层。
    static func chooseMaterial(choice: Int, glassAvailable: Bool, reduceTransparency: Bool) -> Int {
        if reduceTransparency || choice == 3 { return 3 }
        if choice == 2 || !glassAvailable { return 2 }
        return 1
    }
    func makeSurface() {
        let appearance = theme.selectedSegment == 0 ? nil : NSAppearance(named: theme.selectedSegment == 1 ? .aqua : .darkAqua)
        panel.appearance = appearance; controls.appearance = appearance
        let available: Bool
        if #available(macOS 26.0, *) { available = true } else { available = false }
        let kind = Self.chooseMaterial(choice: material.indexOfSelectedItem, glassAvailable: available, reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency)
        if #available(macOS 26.0, *), let previous = surface as? NSGlassEffectView { previous.contentView = nil }
        content.removeFromSuperview(); surface?.removeFromSuperview()
        if kind == 1, #available(macOS 26.0, *) {
            let v = NSGlassEffectView(); v.cornerRadius = 18; v.style = .regular; v.contentView = content
            surface = v; materialName = "liquid-glass"
        } else if kind == 2 {
            let v = NSVisualEffectView(); v.material = .popover; v.blendingMode = .behindWindow; v.state = .active
            v.addSubview(content); surface = v; materialName = "frosted"
        } else {
            let v = Canvas(); v.wantsLayer = true
            panel.effectiveAppearance.performAsCurrentDrawingAppearance { v.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
            v.addSubview(content); surface = v; materialName = "matte"
        }
        surface!.frame = shell.bounds; surface!.autoresizingMask = [.width, .height]
        shell.addSubview(surface!); content.frame = shell.bounds; content.autoresizingMask = [.width, .height]
        eyes.needsDisplay = true
    }
    @objc func changeAppearance() { makeSurface(); render(animate: false, rebuild: false) }
    func reset(exiting value: Bool) {
        generation += 1; ticker?.invalidate(); ticker = nil
        if let activity = playbackActivity { ProcessInfo.processInfo.endActivity(activity); playbackActivity = nil }
        exiting = value; steps = value ? exitSteps : startSteps; completed = 0; failed = false; timings = []
        started = Date(); phaseStarted = Date()
    }
    @objc func playStart() { play(exiting: false) }
    @objc func playExit() { play(exiting: true) }
    func play(exiting: Bool) {
        reset(exiting: exiting); let stamp = generation
        playbackActivity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "Playing an isolated notification preview")
        render(); if displayPicker.indexOfSelectedItem == 0 { show() } else { hide() }
        ticker = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.updateTimes() }
        let intervals: [Double] = exiting ? [0.7, 1.1, 1.4, 0.7] : [0.7, 1.1, 1.8, 1.0, 0.7]
        var delay: Double = 0
        for interval in intervals {
            delay += interval
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, generation == stamp else { return }
                timings.append(Date().timeIntervalSince(phaseStarted)); completed += 1; phaseStarted = Date(); render()
                if completed == steps.count {
                    ticker?.invalidate(); ticker = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                        guard let self, generation == stamp else { return }; dismiss(stamp)
                    }
                }
            }
        }
    }
    @objc func selectSnapshot() {
        let value = snapshot.indexOfSelectedItem
        reset(exiting: value >= 2); completed = value == 1 || value == 3 ? steps.count : 2
        timings = Array(repeating: 0.8, count: completed); failed = value == 4; render(); if displayPicker.indexOfSelectedItem == 0 { show() } else { hide() }
    }
    @objc func showFailure() { snapshot.selectItem(at: 4); selectSnapshot() }
    func render(animate: Bool = true, rebuild: Bool = false) {
        let finished = completed == steps.count
        heading.stringValue = failed ? "退出尚未完成" : finished ? (exiting ? "Palboo 已完全退出" : "Palboo 已就绪") : (exiting ? "正在退出 Palboo" : "正在启动 Palboo")
        heading.stringValue = L(heading.stringValue)
        let visible = min(steps.count, completed + 1)
        let height = CGFloat(70 + visible * 30 + (failed ? 96 : 62))
        reportedSize = NSSize(width: 356, height: height)
        position(size: reportedSize, animate: animate && !reduce)
        if rebuild || surface == nil { makeSurface() }
        surface?.frame = shell.bounds; content.frame = shell.bounds
        while rows.count > visible { rows.removeLast().removeFromSuperview() }
        while rows.count < visible {
            let row = StepRow(frame: NSRect(x: 24, y: 70 + rows.count * 30, width: 308, height: 28)); content.addSubview(row); rows.append(row)
            if animate && !reduce {
                let appear = CABasicAnimation(keyPath: "opacity"); appear.fromValue = 0; appear.toValue = 1; appear.duration = 0.24; row.layer?.add(appear, forKey: "arrive")
            }
        }
        panel.effectiveAppearance.performAsCurrentDrawingAppearance {
            for (i, row) in rows.enumerated() { row.update(failed && i == completed ? "兼容服务仍在退出" : steps[i], done: i < completed, failed: failed && i == completed, reduce: reduce) }
            progress.frame = NSRect(x: 24, y: 78 + visible * 30, width: 308, height: 12)
            progress.update(Double(completed) / Double(steps.count), animate: animate && !reduce, failed: failed)
        }
        count.frame = NSRect(x: 244, y: progress.frame.maxY + 7, width: 88, height: 18); count.stringValue = "\(completed) / \(steps.count) " + (previewEnglish ? "steps" : "步")
        retryButton.isHidden = !failed; retryButton.frame = NSRect(x: 240, y: height - 38, width: 92, height: 26)
        statusItem.button?.toolTip = "Palboo · \(heading.stringValue)（预览）"
        updateTimes()
    }
    func updateTimes() {
        for (i, row) in rows.enumerated() {
            row.duration.stringValue = i < completed ? String(format: "%.1fs", i < timings.count ? timings[i] : 0.8) : failed ? (previewEnglish ? "Waiting" : "等待中") : String(format: "%.1fs", Date().timeIntervalSince(phaseStarted))
        }
    }
    func position(size: NSSize, animate: Bool) {
        if placementPicker.indexOfSelectedItem == 1, let point = pinnedTop {
            let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main!
            let v = screen.visibleFrame
            panel.setFrame(NSRect(x: max(v.minX + 8, min(point.x, v.maxX - size.width - 8)), y: max(v.minY + 8, min(point.y, v.maxY - 8) - size.height), width: size.width, height: size.height), display: true)
            return
        }
        var anchor: NSRect?
        if let b = statusItem?.button, let w = b.window {
            let candidate = w.frame
            // 状态栏按钮首帧可能仍为原点占位，只有真实菜单栏区域才能作锚点。
            if let screen = NSScreen.screens.first(where: { $0.frame.contains(NSPoint(x: candidate.midX, y: candidate.midY)) }),
               candidate.width > 1, candidate.height > 1, candidate.minY > screen.frame.maxY - 80 {
                anchor = candidate
            }
        }
        let screen = anchor.flatMap { a in NSScreen.screens.first { $0.frame.contains(NSPoint(x: a.midX, y: a.midY)) } } ?? NSScreen.main!
        let visible = screen.visibleFrame
        let right = min(visible.maxX - 12, max(visible.minX + size.width + 12, (anchor?.midX ?? visible.maxX - 180) + size.width / 2))
        let top = visible.maxY - 8
        panel.setFrame(NSRect(x: right - size.width, y: top - size.height, width: size.width, height: size.height), display: true, animate: false)
    }
    @objc func toggle() { panel.isVisible ? hide() : show() }
    @objc func show() { guard displayPicker.indexOfSelectedItem != 2 else { return }; position(size: reportedSize, animate: false); panel.alphaValue = 1; panel.orderFrontRegardless() }
    @objc func hide() { panel.orderOut(nil) }
    func dismiss(_ stamp: Int) {
        if let activity = playbackActivity { ProcessInfo.processInfo.endActivity(activity); playbackActivity = nil }
        if reduce { hide(); return }
        NSAnimationContext.runAnimationGroup({ c in c.duration = 0.2; panel.animator().alphaValue = 0 }, completionHandler: { [weak self] in
            guard let self, generation == stamp else { return }; hide(); panel.alphaValue = 1
        })
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationWillTerminate(_ notification: Notification) {
        ticker?.invalidate(); preferenceTimer?.invalidate(); if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
        if let monitor = localMonitor { NSEvent.removeMonitor(monitor) }
        if let dir = dataDirectory, dir.lastPathComponent.hasPrefix("palboo-notice-") {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("runtime.json"))
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("panel.json"))
            try? FileManager.default.removeItem(at: dir)
        }
    }
    func localize(_ view: NSView) {
        if let menu = view as? NSPopUpButton { for item in menu.itemArray { item.title = L(item.title) } }
        else if let button = view as? NSButton { button.title = L(button.title) }
        else if let label = view as? NSTextField { label.stringValue = L(label.stringValue) }
        if let segments = view as? NSSegmentedControl { for i in 0..<segments.segmentCount { segments.setLabel(L(segments.label(forSegment: i) ?? ""), forSegment: i) } }
        for child in view.subviews { localize(child) }
    }
    func loadPreferences() {
        guard !saving, !loading, !dragHeader.dragging, let dir = dataDirectory else { return }
        if revision == -1, let bytes = try? Data(contentsOf: dir.appendingPathComponent("panel.json")),
           let root = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] { acceptPreferences(root) }
        guard let request = appearanceRequest() else { return }
        loading = true
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }; loading = false
                if !saving, error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data,
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { acceptPreferences(root) }
            }
        }.resume()
    }
    func appearanceRequest() -> URLRequest? {
        guard let dir = dataDirectory,
              let bytes = try? Data(contentsOf: dir.appendingPathComponent("runtime.json")),
              let runtime = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
              let port = runtime["port"] as? Int, port > 0, port < 65536,
              let token = runtime["token"] as? String,
              let url = URL(string: "http://127.0.0.1:\(port)/api/appearance") else { return nil }
        var request = URLRequest(url: url); request.timeoutInterval = 3
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
    func acceptPreferences(_ root: [String: Any]) {
        guard !saving, !dragHeader.dragging, let rev = root["revision"] as? Int, rev > revision,
              let prefs = root["lifecyclePreview"] as? [String: Any] else { return }
        revision = rev
        let language = root["language"] as? String ?? "system"
        let english = language == "en" || (language == "system" && Locale.preferredLanguages.first?.hasPrefix("en") == true)
        let changedLanguage = previewEnglish != english
        previewEnglish = english
        if !changedLanguage, loadedPreferences?.isEqual(to: prefs) == true { return }
        loadedPreferences = prefs as NSDictionary
        localize(controls.contentView!); controls.title = L(controls.title)
        syncing = true
        material.selectItem(at: ["auto", "glass", "frosted", "matte"].firstIndex(of: prefs["material"] as? String ?? "") ?? 0)
        displayPicker.selectItem(at: ["popup", "menu", "hidden"].firstIndex(of: prefs["display"] as? String ?? "") ?? 0)
        placementPicker.selectItem(at: prefs["placement"] as? String == "remember" ? 1 : 0)
        if let p = prefs["position"] as? [String: Double] { preferencePosition = NSPoint(x: p["x"] ?? 0.85, y: p["y"] ?? 0.12) }
        savedScreen = prefs["screen"] as? Int
        restorePosition(); statusItem.isVisible = displayPicker.indexOfSelectedItem != 2
        if displayPicker.indexOfSelectedItem != 0 { hide() }
        if !steps.isEmpty { changeAppearance() }
        saveStatus.stringValue = L("已同步 Palboo 设置 · 仅影响预览")
        syncing = false
    }
    func restorePosition() {
        guard placementPicker.indexOfSelectedItem == 1 else { pinnedTop = nil; return }
        let remembered = NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue == savedScreen }
        guard let v = (remembered ?? panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        pinnedTop = NSPoint(x: v.minX + 8 + max(0, v.width - 372) * preferencePosition.x, y: v.maxY - 8 - max(0, v.height - 340) * preferencePosition.y)
    }
    func rememberPosition() {
        placementPicker.selectItem(at: 1)
        pinnedTop = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        if let screen = panel.screen {
            savedScreen = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
            let v = screen.visibleFrame
            preferencePosition = NSPoint(x: min(1, max(0, (panel.frame.minX - v.minX - 8) / max(1, v.width - 372))), y: min(1, max(0, (v.maxY - 8 - panel.frame.maxY) / max(1, v.height - 340))))
        }
        savePreferences()
    }
    @objc func resetPosition() { placementPicker.selectItem(at: 0); changeSavedChoice() }
    @objc func changeSavedChoice() {
        restorePosition(); statusItem.isVisible = displayPicker.indexOfSelectedItem != 2
        if displayPicker.indexOfSelectedItem != 0 { hide() }
        changeAppearance(); savePreferences()
    }
    func savePreferences() {
        guard !syncing, !saving,
              !CommandLine.arguments.contains("--check"), !CommandLine.arguments.contains("--motion-check") else { return }
        guard var request = appearanceRequest() else {
            saveStatus.stringValue = L("未连接 Palboo；当前选择仅用于临时预览"); return
        }
        let prefs: [String: Any] = ["display": ["popup", "menu", "hidden"][displayPicker.indexOfSelectedItem], "material": ["auto", "glass", "frosted", "matte"][material.indexOfSelectedItem], "progress": "energy", "placement": placementPicker.indexOfSelectedItem == 0 ? "menu" : "remember", "position": ["x": preferencePosition.x, "y": preferencePosition.y], "screen": savedScreen.map { $0 as Any } ?? NSNull()]
        request.httpMethod = "POST"; request.timeoutInterval = 5
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["expectedRevision": revision, "lifecyclePreview": prefs])
        saving = true; saveStatus.stringValue = L("正在保存预览设置…")
        for control in [displayPicker, placementPicker, material] { control.isEnabled = false }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }; saving = false
                for control in [displayPicker, placementPicker, material] { control.isEnabled = true }
                if error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data,
                   let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], value["lifecyclePreview"] != nil {
                    revision = value["revision"] as? Int ?? revision; saveStatus.stringValue = L("预览设置已保存")
                } else { saveStatus.stringValue = L("未保存，请在 Palboo 设置页重试"); revision = -1 }
            }
        }.resume()
    }
    func checkMotion() {
        displayPicker.selectItem(at: 0); placementPicker.selectItem(at: 0); theme.selectedSegment = 2; changeAppearance(); playStart()
        let top = panel.frame.maxY
        let deadline = Date().addingTimeInterval(5)
        func checkFirstStep() {
            guard self.completed >= 1 && self.progress.shownCells >= 4 else {
                precondition(Date() < deadline, "first step animation timed out")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { checkFirstStep() }; return
            }
            let cells = self.progress.cellHistory
            if !self.reduce {
                for count in 1...4 { precondition(cells.contains(count), "missing cell \(count): \(cells)") }
                for i in 1..<cells.count { precondition(cells[i] - cells[i-1] <= 1) }
            }
            let proceed = { [self] in
            precondition(completed >= 1 && rows.count >= 2)
            precondition(abs(panel.frame.maxY - top) < 1, "top before=\(top), after=\(panel.frame.maxY)")
            precondition(content.bounds.contains(progress.frame))
            playExit()
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.25) { [self] in
                precondition(exiting && completed == exitSteps.count && progress.fraction == 1)
                precondition(panel.isVisible)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 6.4) { [self] in
                precondition(!panel.isVisible)
                showFailure(); precondition(failed && panel.isVisible && progress.fraction == 0.5)
                toggle(); precondition(!panel.isVisible); toggle(); precondition(panel.isVisible)
                let output = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("motion-check.json")
                let result: [String: Any] = ["passed": true, "cellsAdvanceIndividually": true, "rowsAppend": true, "topAnchorStable": true, "previousPlaybackCancelled": true, "completionHoldAndDismiss": true, "failureRetained": true, "menuToggle": true, "applicationActions": false]
                try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output)
                NSApp.terminate(nil)
            }
            }; proceed()
        }
        checkFirstStep()
    }
    func check() {
        var checks = 0
        precondition(!panel.styleMask.contains(.titled)); precondition(panel.standardWindowButton(.closeButton) == nil)
        precondition(statusItem.button?.image?.isTemplate == true)
        precondition(Self.chooseMaterial(choice: 0, glassAvailable: false, reduceTransparency: false) == 2)
        precondition(Self.chooseMaterial(choice: 0, glassAvailable: true, reduceTransparency: true) == 3)
        for appearance in [1, 2] { theme.selectedSegment = appearance
            for choice in [0, 1, 2, 3] { material.selectItem(at: choice); makeSurface()
                for reduced in [false, true] { motion.state = reduced ? .on : .off
                    for flow in [false, true] { reset(exiting: flow)
                        for step in 0...steps.count {
                            completed = step; timings = Array(repeating: 0.8, count: step); render(animate: false)
                            precondition(rows.count == min(step + 1, steps.count))
                            precondition(abs(progress.fraction - Double(step) / Double(steps.count)) < 0.001)
                            precondition(content.bounds.contains(progress.frame) && content.bounds.contains(count.frame), "material=\(materialName) step=\(step) shell=\(shell.bounds) surface=\(surface!.frame) content=\(content.bounds) progress=\(progress.frame) count=\(count.frame)")
                            for row in rows {
                                precondition(content.bounds.contains(row.frame))
                                precondition(row.text.attributedStringValue.size().width < row.text.frame.width)
                                precondition(row.subviews.count == 3)
                                precondition(row.text.frame.maxX < row.duration.frame.minX)
                                precondition(!reduced || row.mark.layer?.animation(forKey: "working") == nil)
                            }
                            checks += 1
                        }
                    }
                    reset(exiting: true); completed = 2; failed = true; render(animate: false)
                    precondition(!retryButton.isHidden && content.bounds.contains(retryButton.frame)); checks += 1
                }
            }
        }
        displayPicker.selectItem(at: 0); placementPicker.selectItem(at: 0)
        reset(exiting: false); render(animate: false)
        precondition(content.hitTest(NSPoint(x: 100, y: 30)) === dragHeader)
        let origin = panel.frame; panel.setFrameOrigin(NSPoint(x: origin.minX - 100, y: origin.minY - 80))
        rememberPosition(); let moved = panel.frame
        for step in 0...steps.count { completed = step; render(animate: false)
            precondition(abs(panel.frame.minX - moved.minX) < 1)
            precondition(abs(panel.frame.maxY - moved.maxY) < 1)
            precondition(progress.fraction == Double(step) / Double(steps.count)); checks += 1
        }
        displayPicker.selectItem(at: 1); changeSavedChoice(); playStart(); precondition(!panel.isVisible)
        show(); precondition(panel.isVisible)
        displayPicker.selectItem(at: 2); changeSavedChoice(); show(); precondition(!panel.isVisible && !statusItem.isVisible)
        resetPosition(); precondition(pinnedTop == nil)
        for english in [false, true] {
            previewEnglish = english
            for flow in [false, true] { reset(exiting: flow)
                for step in 0...steps.count { completed = step; render(animate: false)
                    precondition(heading.attributedStringValue.size().width <= heading.frame.width, "heading overflow: \(heading.stringValue)")
                    for row in rows { precondition(row.text.attributedStringValue.size().width <= row.text.frame.width) }
                    checks += 1
                }
            }
        }
        let report: [String: Any] = ["passed": true, "checks": checks, "borderless": true, "statusBar": true, "transparentBrand": true, "dragHitRegion": true, "dragPositionSurvivesPhases": true, "selectedEnergyStyle": true, "noPopupModes": true, "perStepTimesOnly": true, "bilingualGeometry": true, "supportedDeployment": "macOS 14+", "fallbacksExercisedOnCurrentOS": ["frosted", "matte"], "olderOSRun": false, "screenshots": false, "applicationActions": false]
        let output = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("check.json")
        try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output)
        print("PASS \(checks) native states")
    }
}
let app = NSApplication.shared; app.setActivationPolicy(.accessory)
let delegate = Preview(); app.delegate = delegate; app.run()
