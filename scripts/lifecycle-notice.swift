import AppKit
import QuartzCore
var previewEnglish = Locale.preferredLanguages.first?.hasPrefix("en") == true
private let previewMessages: [String: String] = [
    "尚未完成": "Not finished",
    "已完成": "Completed",
    "进行中": "In progress",
    "跟随 ChatGPT": "ChatGPT",
    "建立连接": "Connect Codex",
    "重试": "Retry",
    "详情": "Details",
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
    "在 ChatGPT 所在屏幕看见进展": "Follow progress on ChatGPT’s display",
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
    "位置：跟随 ChatGPT 居中": "Position: center on ChatGPT display",
    "位置：记住拖动位置": "Position: remember drag",
    "恢复居中": "Restore center",
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


// [INPUT]: Caller-owned real or preview phases, AppKit, cached/live host appearance and notification preferences.
// [OUTPUT]: Shared borderless notification and menu feedback; rendering never starts or stops applications.
// [POS]: Palboo App launcher and standalone preview; private cache reads and authenticated appearance/event attachment.
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
struct HostPalette: Equatable {
    let theme: String
    var colors: [String: String] = [:]
    var dark: Bool { theme == "dark" }
    var text: NSColor { color("text", fallback: dark ? .white : NSColor(white: 0.12, alpha: 1)) }
    var muted: NSColor { color("muted", fallback: text.withAlphaComponent(0.65)) }
    var background: NSColor { color("surface", fallback: color("page", fallback: dark ? NSColor(white: 0.094, alpha: 1) : .white)) }
    var accent: NSColor { color("accent", fallback: text) }
    var danger: NSColor { color("danger", fallback: dark ? NSColor(srgbRed: 1, green: 0.52, blue: 0.51, alpha: 1) : NSColor(srgbRed: 0.70, green: 0.14, blue: 0.09, alpha: 1)) }
    func color(_ role: String, fallback: NSColor) -> NSColor { Self.parse(colors[role] ?? "", dark: dark) ?? fallback }
    static func read(_ value: [String: Any], previous: HostPalette?) -> HostPalette? {
        guard let mode = value["theme"] as? String, ["light", "dark"].contains(mode), let source = value["colors"] as? [String: String] else { return nil }
        var result = previous?.theme == mode ? previous! : HostPalette(theme: mode)
        var accepted = false
        for role in ["page", "surface", "text", "muted", "accent", "danger"] {
            if let value = source[role], parse(value, dark: mode == "dark") != nil { result.colors[role] = value; accepted = true }
        }
        return accepted ? result : nil
    }
    static func parse(_ raw: String, dark: Bool) -> NSColor? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard value.count <= 256 else { return nil }
        if value == "transparent" { return .clear }
        if value == "white" { return .white }; if value == "black" { return .black }
        if value.hasPrefix("light-dark("), value.hasSuffix(")") {
            let body = String(value.dropFirst(11).dropLast())
            var depth = 0
            for i in body.indices {
                if body[i] == "(" { depth += 1 }; if body[i] == ")" { depth -= 1 }
                if body[i] == "," && depth == 0 { return parse(dark ? String(body[body.index(after: i)...]) : String(body[..<i]), dark: dark) }
            }
            return nil
        }
        if value.hasPrefix("#") {
            var hex = String(value.dropFirst())
            if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard [6, 8].contains(hex.count), let number = UInt64(hex, radix: 16) else { return nil }
            let rgba = hex.count == 6 ? (number << 8) | 255 : number
            return NSColor(srgbRed: CGFloat((rgba >> 24) & 255) / 255, green: CGFloat((rgba >> 16) & 255) / 255, blue: CGFloat((rgba >> 8) & 255) / 255, alpha: CGFloat(rgba & 255) / 255)
        }
        guard (value.hasPrefix("rgb(") || value.hasPrefix("rgba(")), value.hasSuffix(")"), let start = value.firstIndex(of: "(") else { return nil }
        let parts = value[value.index(after: start)..<value.index(before: value.endIndex)].split { $0 == "," || $0 == "/" || $0.isWhitespace }
        guard [3, 4].contains(parts.count) else { return nil }
        var components = [CGFloat]()
        for (index, part) in parts.enumerated() {
            let percent = part.hasSuffix("%")
            guard let value = Double(percent ? part.dropLast() : part), value.isFinite else { return nil }
            components.append(CGFloat(max(0, min(1, value / (percent ? 100 : index == 3 ? 1 : 255)))))
        }
        return NSColor(srgbRed: components[0], green: components[1], blue: components[2], alpha: components.count == 4 ? components[3] : 1)
    }
}
final class BrandEyes: NSView {
    var color = NSColor.labelColor
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
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
        text.frame = NSRect(x: 28, y: 3, width: 218, height: 22); text.font = .systemFont(ofSize: 13); text.lineBreakMode = .byTruncatingTail
        duration.frame = NSRect(x: 249, y: 4, width: 59, height: 20)
        duration.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular); duration.alignment = .right; duration.textColor = .secondaryLabelColor
        for v in [mark, text, duration] { addSubview(v) }
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    func update(_ title: String, done: Bool, failed: Bool, reduce: Bool, palette: HostPalette) {
        text.stringValue = L(title); text.toolTip = text.stringValue; active = !done && !failed
        text.textColor = done ? palette.muted : palette.text; duration.textColor = palette.muted
        let symbol = failed ? "exclamationmark.circle.fill" : done ? "checkmark" : "arrow.right"
        mark.image = NSImage(systemSymbolName: symbol, accessibilityDescription: failed ? "尚未完成" : done ? "已完成" : "进行中")
        mark.contentTintColor = failed ? palette.danger : done ? palette.muted : palette.accent
        mark.wantsLayer = true; mark.layer?.removeAnimation(forKey: "working")
        if active && !reduce {
            let pulse = CABasicAnimation(keyPath: "opacity"); pulse.fromValue = 1; pulse.toValue = 0.35
            pulse.autoreverses = true; pulse.repeatCount = .infinity; pulse.duration = 0.75
            mark.layer?.add(pulse, forKey: "working")
        }
    }
}
final class Progress: NSView {
    var accent = NSColor.labelColor, danger = NSColor.systemRed
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
        let color = failed ? danger : accent
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
final class LifecycleNotice: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 356, height: 160), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let controls = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 610, height: 326), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    let dragHeader = DragHeader(), saveStatus = NSTextField(labelWithString: ""), displayPicker = NSPopUpButton(), placementPicker = NSPopUpButton()
    var pinnedTop: NSPoint?, syncing = false, revision: Int = -1, preferenceTimer: Timer?, saving = false, loading = false
    var savedScreen: Int?, lastHostScreen: Int?
    var loadedPreferences: NSDictionary?
    var live = false, liveDataDirectory: URL?, liveTitle: String?, liveStepText: String?
    var retryAction: (() -> Void)?, detailsAction: (() -> Void)?
    var cacheBytes: Data?
    var attachedRuntime: Data?, attaching = false, lastAttach = Date.distantPast
    let liveDetails = NSButton(), modeLabel = NSTextField(labelWithString: "")
    var runtimeMode: String?
    var hostPalettes: [String: HostPalette] = [:], hostTheme: String?, hostReducedMotion = false
    var preferencePosition = NSPoint(x: 0.85, y: 0.12)
    var dataDirectory: URL? { if live { return liveDataDirectory }; guard let i = CommandLine.arguments.firstIndex(of: "--connection-dir"), i + 1 < CommandLine.arguments.count else { return nil }; return URL(fileURLWithPath: CommandLine.arguments[i+1]) }
    let shell = Canvas(), content = Canvas(), eyes = BrandEyes(), heading = NSTextField(labelWithString: "")
    let progress = Progress(frame: NSRect(x: 24, y: 120, width: 308, height: 4)), count = NSTextField(labelWithString: "")
    let theme = NSSegmentedControl(labels: ["跟随 ChatGPT", "浅色", "深色"], trackingMode: .selectOne, target: nil, action: nil)
    let material = NSPopUpButton(), snapshot = NSPopUpButton(), motion = NSButton(checkboxWithTitle: "减少动态效果", target: nil, action: nil)
    var statusItem: NSStatusItem!, closeButton: NSButton!, retryButton: NSButton!, surface: NSView?
    var rows: [StepRow] = [], steps: [String] = [], timings: [Double] = [], completed = 0, exiting = false, failed = false, generation = 0
    var started = Date(), phaseStarted = Date(), failedAt: Date?, ticker: Timer?, dismissalTimer: Timer?, localMonitor: Any?
    var playbackActivity: NSObjectProtocol?
    var materialName = "", reportedSize = NSSize.zero
    var reduce: Bool { motion.state == .on || hostReducedMotion || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    var palette: HostPalette {
        let mode = theme.selectedSegment == 1 ? "light" : theme.selectedSegment == 2 ? "dark" : hostTheme ?? (NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? "dark" : "light")
        return hostPalettes[mode] ?? HostPalette(theme: mode)
    }
    let startSteps = ["准备 Palboo", "打开 Codex", "连接兼容服务", "恢复工作台", "确认界面可用"]
    let exitSteps = ["保存当前状态", "结束关联任务", "关闭兼容服务", "确认后台已退出"]
    func label(_ title: String, _ frame: NSRect, size: CGFloat = 13, weight: NSFont.Weight = .regular) -> NSTextField {
        let v = NSTextField(labelWithString: L(title)); v.frame = frame; v.font = .systemFont(ofSize: size, weight: weight); return v
    }
    func button(_ title: String, _ frame: NSRect, _ action: Selector) -> NSButton {
        let b = NSButton(title: L(title), target: self, action: action); b.frame = frame; b.bezelStyle = .rounded; return b
    }
    func applicationDidFinishLaunching(_ notification: Notification) { setup(live: false) }
    func setup(live value: Bool) {
        live = value
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
        modeLabel.frame = NSRect(x: 76, y: 45, width: 236, height: 14)
        modeLabel.font = .systemFont(ofSize: 10, weight: .medium); modeLabel.isHidden = true
        closeButton = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "收起提示")!, target: self, action: #selector(hide))
        closeButton.frame = NSRect(x: 318, y: 21, width: 20, height: 22); closeButton.isBordered = false; closeButton.contentTintColor = .secondaryLabelColor
        count.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular); count.textColor = .secondaryLabelColor; count.alignment = .right
        for v: NSView in [heading, modeLabel, closeButton!, progress, count] { content.addSubview(v) }
        content.addSubview(dragHeader, positioned: .above, relativeTo: nil)
        retryButton = button("继续预览", .zero, #selector(retryRequested)); content.addSubview(retryButton)
        statusItem = NSStatusBar.system.statusItem(withLength: 28)
        statusItem.button?.image = BrandEyes.menuImage(); statusItem.button?.toolTip = "Palboo · 启停预览"
        statusItem.button?.target = self; statusItem.button?.action = #selector(toggle)
        controls.title = "Palboo · 菜单栏提示预览"; controls.isReleasedWhenClosed = false; controls.delegate = self
        let c = Canvas(); controls.contentView = c
        c.addSubview(label("在 ChatGPT 所在屏幕看见进展", NSRect(x: 24, y: 18, width: 520, height: 28), size: 19, weight: .semibold))
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
        placementPicker.addItems(withTitles: ["位置：跟随 ChatGPT 居中", "位置：记住拖动位置"])
        placementPicker.frame = NSRect(x: 294, y: 214, width: 292, height: 28); placementPicker.target = self; placementPicker.action = #selector(changeSavedChoice); c.addSubview(placementPicker)
        c.addSubview(button("恢复居中", NSRect(x: 24, y: 254, width: 130, height: 28), #selector(resetPosition)))
        saveStatus.frame = NSRect(x: 170, y: 258, width: 416, height: 20); saveStatus.font = .systemFont(ofSize: 12); saveStatus.textColor = .secondaryLabelColor; c.addSubview(saveStatus)
        let foot = label("拖动顶部调整位置；保留每步耗时，进度逐格点亮。", NSRect(x: 24, y: 296, width: 562, height: 20), size: 12)
        foot.textColor = .secondaryLabelColor; c.addSubview(foot)
        localize(controls.contentView!); controls.title = L(controls.title)
        if !live { controls.center(); controls.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
        if !CommandLine.arguments.contains("--check") && !CommandLine.arguments.contains("--motion-check") { loadCache() }
        if !live { loadPreferences() }
        preferenceTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            guard let self else { return }; if live { loadCache() } else { loadPreferences() }
            if panel.isVisible && placementPicker.indexOfSelectedItem == 0 && !dragHeader.dragging { position(size: reportedSize, animate: false) }
        }
        reset(exiting: false)
        if !live { completed = 2; timings = [0.6, 0.8] }
        render(animate: false)
        NotificationCenter.default.addObserver(self, selector: #selector(changeAppearance), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(changeAppearance), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        if live { return }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.hide(); return nil }; return event
        }
        #if LIFECYCLE_PREVIEW
        if CommandLine.arguments.contains("--check") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.check(); NSApp.terminate(nil) } }
        else if CommandLine.arguments.contains("--motion-check") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.checkMotion() } }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { if self.displayPicker.indexOfSelectedItem == 0 { self.show() } } }
        #endif
    }
    // 能力降级与系统减少透明度独立判断；预览可显式展示每个降级层。
    static func chooseMaterial(choice: Int, glassAvailable: Bool, reduceTransparency: Bool) -> Int {
        if reduceTransparency || choice == 3 { return 3 }
        if choice == 2 || !glassAvailable { return 2 }
        return 1
    }
    func makeSurface() {
        let appearance = NSAppearance(named: palette.dark ? .darkAqua : .aqua)
        panel.appearance = appearance; controls.appearance = appearance
        let available: Bool
        if #available(macOS 26.0, *) { available = true } else { available = false }
        let kind = Self.chooseMaterial(choice: material.indexOfSelectedItem, glassAvailable: available, reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency)
        if #available(macOS 26.0, *), let previous = surface as? NSGlassEffectView { previous.contentView = nil }
        content.removeFromSuperview(); surface?.removeFromSuperview()
        if kind == 1, #available(macOS 26.0, *) {
            let v = NSGlassEffectView(); v.cornerRadius = 18; v.style = .regular; v.contentView = content
            v.tintColor = palette.background.withAlphaComponent(0.12)
            surface = v; materialName = "liquid-glass"
        } else if kind == 2 {
            let v = NSVisualEffectView(); v.material = .popover; v.blendingMode = .behindWindow; v.state = .active
            v.wantsLayer = true; v.layer?.backgroundColor = palette.background.withAlphaComponent(0.12).cgColor
            v.addSubview(content); surface = v; materialName = "frosted"
        } else {
            let v = Canvas(); v.wantsLayer = true
            v.layer?.backgroundColor = palette.background.cgColor
            v.addSubview(content); surface = v; materialName = "matte"
        }
        surface!.frame = shell.bounds; surface!.autoresizingMask = [.width, .height]
        shell.addSubview(surface!); content.frame = shell.bounds; content.autoresizingMask = [.width, .height]
        updateColors()
    }
    func updateColors() {
        let colors = palette
        eyes.color = colors.text; eyes.needsDisplay = true
        heading.textColor = colors.text; count.textColor = colors.muted; closeButton?.contentTintColor = colors.muted; retryButton?.contentTintColor = colors.accent
        modeLabel.textColor = colors.muted
        progress.accent = colors.accent; progress.danger = colors.danger; progress.needsDisplay = true
        for (i, row) in rows.enumerated() where i < steps.count { row.update(live && i == completed ? (liveStepText ?? steps[i]) : failed && i == completed ? "兼容服务仍在退出" : steps[i], done: i < completed, failed: failed && i == completed, reduce: reduce, palette: colors) }
        if CommandLine.arguments.contains("--report-theme") {
            func rgba(_ value: NSColor) -> [Double] {
                guard let c = value.usingColorSpace(.sRGB) else { return [] }
                return [c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent].map { (Double($0) * 1_000_000).rounded() / 1_000_000 }
            }
            let report: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "hostTheme": hostTheme ?? "unknown", "previewTheme": colors.theme, "nativeAppearance": panel.appearance?.name.rawValue ?? "", "hostAccent": colors.colors["accent"] ?? "", "progressRGBA": rgba(progress.accent), "activeStepRGBA": rows.first(where: { $0.active }).flatMap { $0.mark.contentTintColor }.map(rgba) ?? [], "textRGBA": rgba(heading.textColor ?? colors.text), "backgroundRGBA": rgba(colors.background)]
            let path = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("theme.json")
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: path, options: .atomic) }
        }
    }
    @objc func changeAppearance() { makeSurface(); render(animate: false, rebuild: false) }
    func reset(exiting value: Bool) {
        generation += 1; ticker?.invalidate(); ticker = nil
        dismissalTimer?.invalidate(); dismissalTimer = nil
        if let activity = playbackActivity { ProcessInfo.processInfo.endActivity(activity); playbackActivity = nil }
        exiting = value; steps = value ? exitSteps : startSteps; completed = 0; failed = false; timings = []
        started = Date(); phaseStarted = Date(); failedAt = nil
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
        heading.stringValue = liveTitle ?? L(heading.stringValue)
        modeLabel.stringValue = previewEnglish ? "Development" : "开发版"
        modeLabel.isHidden = runtimeMode != "development"
        let visible = min(steps.count, completed + 1)
        let height = CGFloat(70 + steps.count * 30 + (failed ? 96 : 62))
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
            updateColors()
            progress.frame = NSRect(x: 24, y: 78 + steps.count * 30, width: 308, height: 12)
            progress.update(Double(completed) / Double(steps.count), animate: animate && !reduce, failed: failed)
        }
        count.frame = NSRect(x: 244, y: progress.frame.maxY + 7, width: 88, height: 18); count.stringValue = "\(completed) / \(steps.count) " + (previewEnglish ? "steps" : "步")
        retryButton.isHidden = !failed; retryButton.frame = NSRect(x: 240, y: height - 38, width: 92, height: 26)
        statusItem.button?.toolTip = "Palboo · \(heading.stringValue)" + (live ? "" : (previewEnglish ? " (Preview)" : "（预览）"))
        updateTimes()
    }
    func updateTimes() {
        if failed && failedAt == nil { failedAt = Date() }
        for (i, row) in rows.enumerated() {
            row.duration.stringValue = i < completed ? String(format: "%.1fs", i < timings.count ? timings[i] : 0.8) : String(format: "%.1fs", max(0, (failedAt ?? Date()).timeIntervalSince(phaseStarted)))
        }
    }
    func position(size: NSSize, animate: Bool) {
        if placementPicker.indexOfSelectedItem == 1, let point = pinnedTop {
            let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main!
            let v = screen.visibleFrame
            panel.setFrame(NSRect(x: max(v.minX + 8, min(point.x, v.maxX - size.width - 8)), y: max(v.minY + 8, min(point.y, v.maxY - 8) - size.height), width: size.width, height: size.height), display: true)
            return
        }
        guard let screen = hostScreen() else { return }
        let v = screen.visibleFrame
        let frame = NSRect(x: (v.midX - size.width / 2).rounded(), y: (v.midY - size.height / 2).rounded(), width: size.width, height: size.height)
        if panel.frame != frame { panel.setFrame(frame, display: true, animate: false) }
    }
    // Match the existing edge container's largest-overlap rule; WindowServer uses a top-left origin.
    static func screenIndex(window: CGRect, screens: [CGRect], primaryTop: CGFloat) -> Int? {
        guard window.width > 0, window.height > 0,
              [window.minX, window.minY, window.width, window.height, primaryTop].allSatisfy({ $0.isFinite }) else { return nil }
        let cocoa = CGRect(x: window.minX, y: primaryTop - window.maxY, width: window.width, height: window.height)
        var best: Int?, area: CGFloat = 0
        for (index, screen) in screens.enumerated() {
            let overlap = cocoa.intersection(screen)
            let candidate = overlap.isNull ? 0 : overlap.width * overlap.height
            if candidate > area { best = index; area = candidate }
        }
        return best
    }
    func hostScreen() -> NSScreen? {
        let screens = NSScreen.screens
        guard let primary = screens.first else { return nil }
        let candidates = NSWorkspace.shared.runningApplications.filter { ["com.openai.chat", "com.openai.codex"].contains($0.bundleIdentifier ?? "") }
        // Current ChatGPT builds also use the Codex bundle identity; prefer the named ChatGPT app.
        let chatGPT = candidates.filter { $0.bundleURL?.lastPathComponent.lowercased() == "chatgpt.app" }
        let hostPIDs = Set((chatGPT.isEmpty ? candidates : chatGPT).map { Int($0.processIdentifier) })
        // Only read owner, layer, alpha and numeric bounds. No titles, pixels or chat content.
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        for window in windows {
            guard let pid = window[kCGWindowOwnerPID as String] as? Int, hostPIDs.contains(pid),
                  window[kCGWindowLayer as String] as? Int == 0,
                  (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width >= 280, rect.height >= 180,
                  let index = Self.screenIndex(window: rect, screens: screens.map { $0.frame }, primaryTop: primary.frame.maxY) else { continue }
            lastHostScreen = (screens[index].deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
            return screens[index]
        }
        return screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue == lastHostScreen } ?? panel.screen ?? NSScreen.main ?? primary
    }

    @objc func toggle() { panel.isVisible ? hide() : show() }
    @objc func show() { guard displayPicker.indexOfSelectedItem != 2 else { return }; position(size: reportedSize, animate: false); panel.alphaValue = 1; panel.orderFrontRegardless() }
    @objc func hide() { panel.orderOut(nil) }
    func dismiss(_ stamp: Int, after: @escaping () -> Void = {}) {
        guard generation == stamp else { return }
        dismissalTimer?.invalidate(); dismissalTimer = nil
        let finish = { [weak self] in
            guard let self, generation == stamp else { return }
            dismissalTimer = nil; hide(); panel.alphaValue = 1
            if let activity = playbackActivity { ProcessInfo.processInfo.endActivity(activity); playbackActivity = nil }
            after()
        }
        if reduce || !panel.isVisible { finish(); return }
        NSAnimationContext.runAnimationGroup { c in c.duration = 0.2; panel.animator().alphaValue = 0 }
        // 收起由独立的期限保证，不依赖淡出回调；交还焦点或退出必须在窗口移出之后。
        let timer = Timer(timeInterval: 0.2, repeats: false) { _ in finish() }
        dismissalTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationWillTerminate(_ notification: Notification) {
        ticker?.invalidate(); dismissalTimer?.invalidate(); preferenceTimer?.invalidate(); if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
        if let monitor = localMonitor { NSEvent.removeMonitor(monitor) }
        if !live, let dir = dataDirectory, dir.lastPathComponent.hasPrefix("palboo-notice-") {
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
    static var cacheURL: URL {
        let root = ProcessInfo.processInfo.environment["PALBOO_LAUNCHER_HOME"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("palboo-launcher")
        return root.appendingPathComponent("appearance-cache.json")
    }
    func loadCache() {
        guard let bytes = try? Data(contentsOf: Self.cacheURL), bytes.count <= 65536, bytes != cacheBytes,
              let root = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], root["schemaVersion"] as? Int == 1 else { return }
        cacheBytes = bytes
        acceptHostAppearance(root["settingsAppearance"] as? [String: Any])
        if live, let path = root["dataDirectory"] as? String, path.hasPrefix("/") {
            let next = URL(fileURLWithPath: path)
            if next != liveDataDirectory { revision = -1; loadedPreferences = nil; liveDataDirectory = next }
            acceptPreferences(root)
        }
    }
    @objc func retryRequested() { if live { retryAction?() } else { playExit() } }
    @objc func showLiveDetails() { detailsAction?() }
    func beginLive(exiting: Bool, at: Date = Date()) {
        reset(exiting: exiting); phaseStarted = at; liveTitle = exiting ? L("正在退出 Palboo") : L("正在启动 Palboo"); liveStepText = nil
        steps = exiting ? exitSteps : ["准备 Palboo", "打开 Codex", "建立连接", "恢复工作台", "确认界面可用"]
        liveDetails.isHidden = true
        render(animate: false)
        if displayPicker.indexOfSelectedItem == 0 { show() }
    }
    func liveStage(_ index: Int, text: String? = nil, at: Date = Date()) {
        guard live, !failed, index >= completed, index <= steps.count, index != completed || text != liveStepText else { return }
        while completed < index { timings.append(max(0, at.timeIntervalSince(phaseStarted))); phaseStarted = at; completed += 1 }
        liveStepText = text; render(); updateTimes()
    }
    func liveFailure(_ title: String) {
        guard !failed || liveTitle != title else { return }
        generation += 1; dismissalTimer?.invalidate(); dismissalTimer = nil
        failed = true; liveTitle = title; liveStepText = nil; render()
        retryButton.isHidden = retryAction == nil
        retryButton.title = L("重试")
        if detailsAction != nil {
            liveDetails.title = L("详情"); liveDetails.bezelStyle = .rounded; liveDetails.target = self; liveDetails.action = #selector(showLiveDetails)
            liveDetails.frame = NSRect(x: 138, y: reportedSize.height - 38, width: 92, height: 26)
            content.addSubview(liveDetails); liveDetails.isHidden = false
        }
        if displayPicker.indexOfSelectedItem == 0 { show() }
    }
    func liveSuccess(exiting: Bool, after: @escaping () -> Void) {
        failed = false; liveDetails.isHidden = true
        liveTitle = exiting ? L("Palboo 已完全退出") : L("Palboo 已就绪")
        liveStage(steps.count); let stamp = generation
        if !panel.isVisible { dismiss(stamp, after: after); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, generation == stamp else { return }; dismiss(stamp, after: after)
        }
    }
    func loadPreferences() {
        guard !saving, !loading, !dragHeader.dragging, let dir = dataDirectory else { return }
        if revision == -1, let bytes = try? Data(contentsOf: dir.appendingPathComponent("panel.json")),
           let root = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] { acceptHostAppearance(root["settingsAppearance"] as? [String: Any]); acceptPreferences(root) }
        guard let request = appearanceRequest(path: "state") else { return }
        loading = true
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }; loading = false
                if !saving, error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data,
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    acceptHostAppearance(root["settingsAppearance"] as? [String: Any])
                    if let prefs = root["panelPreferences"] as? [String: Any] { acceptPreferences(prefs) }
                }
            }
        }.resume()
    }
    func appearanceRequest(path: String = "appearance") -> URLRequest? {
        guard let dir = dataDirectory,
              let bytes = try? Data(contentsOf: dir.appendingPathComponent("runtime.json")),
              let runtime = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
              let port = runtime["port"] as? Int, port > 0, port < 65536,
              let token = runtime["token"] as? String,
              let url = URL(string: "http://127.0.0.1:\(port)/api/\(path)") else { return nil }
        var request = URLRequest(url: url); request.timeoutInterval = 3
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
    func attachProgress(_ file: URL, completion: @escaping (pid_t, pid_t?, String?) -> Void) {
        guard live, !attaching, Date().timeIntervalSince(lastAttach) > 2,
              let directory = dataDirectory, let bytes = try? Data(contentsOf: directory.appendingPathComponent("runtime.json")), bytes != attachedRuntime,
              var request = appearanceRequest(path: "startup-progress") else { return }
        request.httpMethod = "POST"; request.httpBody = try? JSONSerialization.data(withJSONObject: ["file": file.path])
        attaching = true; lastAttach = Date(); let stamp = generation
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }; self.attaching = false
                guard self.generation == stamp, self.dataDirectory == directory,
                      error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data,
                      let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let pid = value["pid"] as? Int32, pid > 0 else { return }
                self.attachedRuntime = bytes; completion(pid, value["supervisorPid"] as? Int32, value["mode"] as? String)
            }
        }.resume()
    }
    func acceptHostAppearance(_ snapshot: [String: Any]?) {
        guard let snapshot, let mode = snapshot["theme"] as? String,
              let current = HostPalette.read(snapshot, previous: hostPalettes[mode]) else { return }
        let before = palette, previousMotion = hostReducedMotion
        if let cached = snapshot["palettes"] as? [String: [String: Any]] {
            for (name, value) in cached where ["light", "dark"].contains(name) {
                if let parsed = HostPalette.read(value, previous: hostPalettes[name]), parsed.theme == name { hostPalettes[name] = parsed }
            }
        }
        hostPalettes[mode] = current; hostTheme = mode
        hostReducedMotion = snapshot["reducedMotion"] as? Bool ?? hostReducedMotion
        // Theme changes repaint existing progress; they never replay phases or change visibility.
        if !steps.isEmpty && (before != palette || previousMotion != hostReducedMotion) { makeSurface() }
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
        let prefs: [String: Any] = ["display": ["popup", "menu", "hidden"][displayPicker.indexOfSelectedItem], "material": ["auto", "glass", "frosted", "matte"][material.indexOfSelectedItem], "progress": "energy", "placement": placementPicker.indexOfSelectedItem == 0 ? "host-center" : "remember", "position": ["x": preferencePosition.x, "y": preferencePosition.y], "screen": savedScreen.map { $0 as Any } ?? NSNull()]
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
}
