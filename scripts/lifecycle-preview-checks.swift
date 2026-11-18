// [INPUT]: Shared native notice renderer and synthetic phases.
// [OUTPUT]: Isolated layout, color and timing checks; no real application actions.
// [POS]: Compiled only into the preview tool.
// [PROTOCOL]: Keep scripts/AGENTS.md in sync.
import AppKit

extension LifecycleNotice {
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
            let finishDeadline = Date().addingTimeInterval(12)
            func waitForCompletion() {
                guard self.completed == self.exitSteps.count else {
                    precondition(Date() < finishDeadline, "exit preview did not finish")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { waitForCompletion() }; return
                }
                precondition(self.exiting && self.progress.fraction == 1 && self.panel.isVisible)
                let finishedAt = Date(), dismissalDeadline = Date().addingTimeInterval(5)
                func waitForDismissal() {
                    if self.panel.isVisible {
                        precondition(Date() < dismissalDeadline, "completed preview did not dismiss")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { waitForDismissal() }; return
                    }
                    precondition(Date().timeIntervalSince(finishedAt) >= 1.8, "completion was not held")
                    self.showFailure(); precondition(self.failed && self.panel.isVisible && self.progress.fraction == 0.5)
                    self.toggle(); precondition(!self.panel.isVisible); self.toggle(); precondition(self.panel.isVisible)
                    self.checkLiveDismissal {
                        let output = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("motion-check.json")
                        let result: [String: Any] = ["passed": true, "cellsAdvanceIndividually": true, "rowsAppend": true, "topAnchorStable": true, "previousPlaybackCancelled": true, "completionHoldAndDismiss": true, "failureRetained": true, "menuToggle": true, "liveCallbackAfterDismissal": true, "lateFailureCancelsDismissal": true, "reducedMotionDismissal": true, "applicationActions": false]
                        try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output)
                        NSApp.terminate(nil)
                    }
                }
                waitForDismissal()
            }
            waitForCompletion()
            }; proceed()
        }
        checkFirstStep()
    }
    func checkLiveDismissal(_ finish: @escaping () -> Void) {
        // 只驱动真实提示逻辑，不连接后台或读取用户缓存。
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { preconditionFailure("live dismissal checks timed out") }
        preferenceTimer?.invalidate(); live = true; beginLive(exiting: false)
        liveSuccess(exiting: false) { [self] in
            precondition(!panel.isVisible && completed == steps.count)
            beginLive(exiting: true)
            var staleCallback = false
            liveSuccess(exiting: true) { staleCallback = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.liveFailure("Synthetic failure") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [self] in
                precondition(failed && panel.isVisible && !staleCallback, "late failure was dismissed by stale success")
                motion.state = .on; beginLive(exiting: false)
                liveSuccess(exiting: false) { [self] in
                    precondition(!panel.isVisible && completed == steps.count)
                    beginLive(exiting: true)
                    var callbacks = 0
                    liveSuccess(exiting: true) { callbacks += 1 }
                    precondition(panel.isVisible && callbacks == 0)
                    hide(); hide()
                    precondition(!panel.isVisible && callbacks == 1, "manual dismissal must hand off exactly once")
                    for display in [1, 2] {
                        displayPicker.selectItem(at: display); hide(); beginLive(exiting: false)
                        precondition(!panel.isVisible, "non-popup mode opened automatically")
                        if display == 1 { show(); precondition(panel.isVisible) }
                        var completedImmediately = false
                        liveSuccess(exiting: false) { completedImmediately = true }
                        precondition(completedImmediately && !panel.isVisible, "hidden notice delayed handoff")
                    }
                    finish()
                }
            }
        }
    }
    func check() {
        var checks = 0
        let purple: [String: Any] = ["theme": "dark", "colors": ["page": "#181818", "text": "#ffffff", "muted": "rgba(255, 255, 255, 0.71)", "accent": "#a67df2", "danger": "light-dark(#911e1b,#e02e2a)"]]
        theme.selectedSegment = 0
        let cellsBeforeTheme = progress.shownCells, phaseBeforeTheme = completed, visibleBeforeTheme = panel.isVisible
        acceptHostAppearance(purple)
        precondition(palette.theme == "dark" && palette.accent.isEqual(HostPalette.parse("#a67df2", dark: true)!))
        precondition(progress.accent.isEqual(palette.accent) && heading.textColor!.isEqual(palette.text))
        precondition(progress.shownCells == cellsBeforeTheme && completed == phaseBeforeTheme && panel.isVisible == visibleBeforeTheme)
        precondition(palette.danger.isEqual(HostPalette.parse("#e02e2a", dark: true)!))
        let retained = palette
        acceptHostAppearance(nil); acceptHostAppearance(["theme": "dark", "colors": ["accent": "invalid"]])
        precondition(palette == retained)
        let light: [String: Any] = ["theme": "light", "colors": ["page": "#fff", "text": "rgb(31 35 40)", "accent": "rgb(50% 25% 75% / 100%)"]]
        acceptHostAppearance(light); precondition(!palette.dark && panel.appearance?.name == .aqua)
        precondition(progress.accent.isEqual(palette.accent))
        acceptHostAppearance(purple); precondition(palette == retained && panel.appearance?.name == .darkAqua)
        precondition(HostPalette.parse("rgba(1, 2, 3, nan)", dark: false) == nil)
        precondition(HostPalette.parse("#00000000", dark: false)?.alphaComponent == 0)
        checks += 12
        let screens = [CGRect(x: 0, y: 0, width: 1440, height: 900), CGRect(x: 1440, y: -200, width: 1920, height: 1080), CGRect(x: -1024, y: 0, width: 1024, height: 768)]
        for (bounds, expected) in [(CGRect(x: 50, y: 50, width: 800, height: 600), 0), (CGRect(x: 1500, y: 100, width: 900, height: 700), 1), (CGRect(x: -900, y: 180, width: 700, height: 500), 2), (CGRect(x: 1300, y: 100, width: 700, height: 500), 1)] {
            precondition(Self.screenIndex(window: bounds, screens: screens, primaryTop: 900) == expected); checks += 1
        }
        precondition(Self.screenIndex(window: CGRect(x: 9999, y: 0, width: 400, height: 400), screens: screens, primaryTop: 900) == nil)
        precondition(Self.screenIndex(window: .zero, screens: screens, primaryTop: 900) == nil)

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
                            if let area = hostScreen()?.visibleFrame { precondition(abs(panel.frame.midX - area.midX) <= 0.5 && abs(panel.frame.midY - area.midY) <= 0.5) }
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
        let origin = panel.frame
        guard let screen = hostScreen() else { preconditionFailure("geometry checks require a visible screen") }
        let bottom = screen.visibleFrame.minY + 8
        panel.setFrameOrigin(NSPoint(x: origin.minX, y: bottom))
        rememberPosition(); let moved = panel.frame
        restorePosition()
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
            for mode in [nil, "development", "release"] as [String?] {
                runtimeMode = mode; render(animate: false)
                precondition(modeLabel.isHidden == (mode != "development"))
                precondition(modeLabel.attributedStringValue.size().width <= modeLabel.frame.width)
                precondition(modeLabel.frame.maxY < rows[0].frame.minY && modeLabel.frame.minY >= heading.frame.maxY)
                checks += 1
            }
            for flow in [false, true] { reset(exiting: flow)
                for step in 0...steps.count { completed = step; render(animate: false)
                    precondition(heading.attributedStringValue.size().width <= heading.frame.width, "heading overflow: \(heading.stringValue)")
                    for row in rows { precondition(row.text.attributedStringValue.size().width <= row.text.frame.width) }
                    checks += 1
                }
                completed = 2; failed = true; render(animate: false)
                precondition(rows[2].duration.attributedStringValue.size().width <= rows[2].duration.frame.width)
            }
        }
        let report: [String: Any] = ["passed": true, "checks": checks, "hostThemeSync": true, "invalidThemeRetained": true, "themeChangeKeepsProgress": true, "borderless": true, "statusBar": true, "transparentBrand": true, "dragHitRegion": true, "dragPositionSurvivesPhases": true, "selectedEnergyStyle": true, "centeredOnHostScreen": true, "multiScreenGeometry": true, "noPopupModes": true, "perStepTimesOnly": true, "bilingualGeometry": true, "supportedDeployment": "macOS 14+", "fallbacksExercisedOnCurrentOS": ["frosted", "matte"], "olderOSRun": false, "screenshots": false, "applicationActions": false]
        let output = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("check.json")
        try! JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output)
        print("PASS \(checks) native states")
    }
}
