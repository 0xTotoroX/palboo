// [INPUT]: Shared notification renderer and isolated checks.
// [OUTPUT]: Standalone preview application.
// [POS]: npm run dev:status; does not run product lifecycle actions.
// [PROTOCOL]: Keep scripts/AGENTS.md in sync.
import AppKit
@main struct PreviewApp {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate = LifecycleNotice(); app.delegate = delegate; app.run()
    }
}
