// [INPUT]: 合成窗口验收命令；仅操作明确给定的测试坐标。
// [OUTPUT]: 前台应用/屏幕安全区/事件投递权限，以及可选真实鼠标事件。
// [POS]: edge-native.mjs 的辅助；窗口几何复用 native-probe.swift。
// [PROTOCOL]: 由集成任务同步 tests/AGENTS.md。
import AppKit
import Foundation

NSApplication.shared.setActivationPolicy(.prohibited)
let args = CommandLine.arguments
func emit(_ value: Any) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)!)
}
switch args[1] {
case "state":
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    emit([
        "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
        "canPostEvents": CGPreflightPostEventAccess(),
        "pointer": [CGEvent(source: nil)!.location.x, CGEvent(source: nil)!.location.y],
        "buttons": NSEvent.pressedMouseButtons,
        "screens": NSScreen.screens.map { s -> [String: Any] in
            let notch = (s.auxiliaryTopLeftArea != nil && s.auxiliaryTopRightArea != nil)
                ? s.frame.width - s.auxiliaryTopLeftArea!.width - s.auxiliaryTopRightArea!.width : 0
            return ["x": s.frame.minX, "y": top - s.frame.maxY, "width": s.frame.width,
                    "height": s.frame.height, "notchWidth": notch, "notchHeight": s.safeAreaInsets.top]
        }
    ])
case "move", "click":
    guard CGPreflightPostEventAccess() else { fputs("Event posting unavailable; no permission requested\n", stderr); exit(2) }
    guard NSEvent.pressedMouseButtons == 0 else {
        fputs("Mouse button is held; no test input sent\n", stderr); exit(3)
    }
    let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    let source = CGEventSource(stateID: .hidSystemState)
    let previous = CGEvent(source: nil)!.location
    func send(_ type: CGEventType) {
        let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: .left)!
        event.flags = []
        event.setIntegerValueField(.mouseEventClickState, value: type == .mouseMoved ? 0 : 1)
        if type == .mouseMoved {
            event.setIntegerValueField(.mouseEventDeltaX, value: Int64((p.x - previous.x).rounded()))
            event.setIntegerValueField(.mouseEventDeltaY, value: Int64((p.y - previous.y).rounded()))
        }
        event.post(tap: .cghidEventTap)
    }
    send(.mouseMoved)
    // 等待系统处理短命探针发出的事件；回读失败时不继续点击。
    usleep(50000)
    let actual = CGEvent(source: nil)!.location
    guard abs(actual.x - p.x) <= 2 && abs(actual.y - p.y) <= 2 else {
        fputs("Mouse did not reach test point; requested=\(p), actual=\(actual); no click sent\n", stderr); exit(4)
    }
    if args[1] == "click" {
        send(.leftMouseDown)
        usleep(50000)
        send(.leftMouseUp)
        usleep(50000)
    }
    guard NSEvent.pressedMouseButtons == 0 else {
        fputs("Mouse button release was not confirmed\n", stderr); exit(5)
    }
    emit(["requested": [p.x, p.y], "actual": [actual.x, actual.y], "buttons": NSEvent.pressedMouseButtons])
default:
    fatalError("Unknown probe command")
}
