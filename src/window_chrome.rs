// [INPUT]: 主窗口的 AppKit 几何通知与标准红黄绿按钮。
// [OUTPUT]: 原窗口的标题栏定位、全屏过渡与置顶状态及全屏原生红黄绿。
// [POS]: panel_window 私有标题栏适配；沿用系统按钮、动作和全屏管理。
// [PROTOCOL]: 变更时更新此头部，然后检查 src/AGENTS.md。

use objc2::{DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained, sel};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSButton, NSFloatingWindowLevel, NSNormalWindowLevel, NSView,
    NSViewFrameDidChangeNotification, NSWindow, NSWindowButton, NSWindowDidBecomeKeyNotification,
    NSWindowDidChangeBackingPropertiesNotification, NSWindowDidDeminiaturizeNotification,
    NSWindowDidEndLiveResizeNotification, NSWindowDidEnterFullScreenNotification,
    NSWindowDidExitFullScreenNotification, NSWindowDidMoveNotification,
    NSWindowDidResizeNotification, NSWindowStyleMask, NSWindowWillEnterFullScreenNotification,
    NSWindowWillExitFullScreenNotification,
};
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSNotificationCenter, NSObject, NSPoint, NSRect, NSSize,
    NSString,
};
use objc2_quartz_core::CATransaction;
use std::{
    cell::Cell,
    time::{Duration, Instant},
};

pub struct ChromeState {
    window: Retained<NSWindow>,
    updating: Cell<bool>,
    pinned: Cell<bool>,
    fullscreen_transition_until: Cell<Option<Instant>>,
    fullscreen_buttons: Vec<(NSWindowButton, Retained<NSButton>)>,
    frames: Vec<(Retained<NSView>, bool)>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "PalbooWindowChrome"]
    #[thread_kind = MainThreadOnly]
    #[ivars = ChromeState]
    pub struct WindowChrome;

    impl WindowChrome {
        #[unsafe(method(fullscreenChanged:))]
        fn fullscreen_changed(&self, notification: &NSNotification) {
            if !self.owns_notification(notification) {
                return;
            }
            let window = &self.ivars().window;
            let name = notification.name();
            let starting = unsafe {
                name.isEqualToString(NSWindowWillEnterFullScreenNotification)
                    || name.isEqualToString(NSWindowWillExitFullScreenNotification)
            };
            // AppKit 没有公开的全屏失败通知。异常中断后允许下一次几何事件恢复排版。
            self.ivars().fullscreen_transition_until.set(
                starting.then(|| Instant::now() + Duration::from_secs(3)),
            );
            if starting {
                window.setLevel(NSNormalWindowLevel);
                for (_, button) in &self.ivars().fullscreen_buttons {
                    button.setEnabled(false);
                }
            } else if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
                self.show_fullscreen_buttons();
            } else {
                for (_, button) in &self.ivars().fullscreen_buttons {
                    button.removeFromSuperview();
                }
                self.set_pinned(self.ivars().pinned.get());
                self.layout();
            }
        }

        #[unsafe(method(windowGeometryChanged:))]
        fn geometry_changed(&self, notification: &NSNotification) {
            if self.owns_notification(notification) {
                self.layout();
            }
        }
    }
);

impl WindowChrome {
    pub fn install(window: &NSWindow, pinned: bool) -> Retained<Self> {
        let mtm = MainThreadMarker::new().expect("window main thread");
        let mut frames = Vec::new();
        if let Some(parent) = window
            .standardWindowButton(NSWindowButton::CloseButton)
            .and_then(|button| unsafe { button.superview() })
        {
            if let Some(container) = unsafe { parent.superview() } {
                frames.push((
                    container.clone(),
                    container.postsFrameChangedNotifications(),
                ));
            }
            frames.push((parent.clone(), parent.postsFrameChangedNotifications()));
        }
        let this = Self::alloc(mtm).set_ivars(ChromeState {
            window: objc2::Message::retain(window),
            updating: Cell::new(false),
            pinned: Cell::new(pinned),
            fullscreen_transition_until: Cell::new(None),
            fullscreen_buttons: [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ]
            .into_iter()
            .filter_map(|kind| {
                NSWindow::standardWindowButton_forStyleMask(
                    kind,
                    window.styleMask() | NSWindowStyleMask::FullScreen,
                    mtm,
                )
                .map(|button| (kind, button))
            })
            .collect(),
            frames,
        });
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        let center = NSNotificationCenter::defaultCenter();
        // object 限定本窗口，通知在 AppKit 几何更新栈内同步执行。
        for name in unsafe {
            [
                NSWindowDidResizeNotification,
                NSWindowDidMoveNotification,
                NSWindowDidBecomeKeyNotification,
                NSWindowDidDeminiaturizeNotification,
                NSWindowDidChangeBackingPropertiesNotification,
                NSWindowDidEndLiveResizeNotification,
            ]
        } {
            unsafe {
                center.addObserver_selector_name_object(
                    &this,
                    sel!(windowGeometryChanged:),
                    Some(name),
                    Some(window),
                );
            }
        }
        for name in unsafe {
            [
                NSWindowWillEnterFullScreenNotification,
                NSWindowDidEnterFullScreenNotification,
                NSWindowWillExitFullScreenNotification,
                NSWindowDidExitFullScreenNotification,
            ]
        } {
            unsafe {
                center.addObserver_selector_name_object(
                    &this,
                    sel!(fullscreenChanged:),
                    Some(name),
                    Some(window),
                );
            }
        }
        // AppKit 可能在窗口通知之后才排布标题栏；跟随真实 frame 变化，仍不介入绘制。
        for (view, _) in &this.ivars().frames {
            view.setPostsFrameChangedNotifications(true);
            unsafe {
                center.addObserver_selector_name_object(
                    &this,
                    sel!(windowGeometryChanged:),
                    Some(NSViewFrameDidChangeNotification),
                    Some(view),
                );
            }
        }
        this.layout();
        this
    }

    fn owns_notification(&self, notification: &NSNotification) -> bool {
        // 全屏菜单栏会把原标题栏视图移到 AppKit 的 companion window。
        // 保留的 view 仍会通知，不能把它的新 window 当作 Palboo 窗口排版。
        notification
            .object()
            .and_then(|object| {
                object
                    .downcast::<NSWindow>()
                    .ok()
                    .or_else(|| notification.object()?.downcast::<NSView>().ok()?.window())
            })
            .is_some_and(|window| std::ptr::eq(&*window, &*self.ivars().window))
    }

    #[cfg(debug_assertions)]
    pub fn probe_foreign_window(&self) -> bool {
        use objc2_app_kit::NSBackingStoreType;
        let mtm = MainThreadMarker::new().expect("window main thread");
        let other = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::ZERO, NSSize::new(320., 240.)),
                NSWindowStyleMask::Titled | NSWindowStyleMask::Closable,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe {
            other.setReleasedWhenClosed(false);
        }
        let untouched = other
            .standardWindowButton(NSWindowButton::CloseButton)
            .and_then(|button| unsafe { button.superview() })
            .and_then(|parent| unsafe { parent.superview() })
            .is_some_and(|container| {
                let frame = container.frame();
                let notification = unsafe {
                    NSNotification::notificationWithName_object(
                        NSViewFrameDidChangeNotification,
                        Some(&container),
                    )
                };
                // 模拟已迁入系统全屏辅助窗口的标题栏视图继续发送通知。
                self.geometry_changed(sel!(windowGeometryChanged:), &notification);
                container.frame() == frame
            });
        other.close();
        untouched
    }

    pub fn set_pinned(&self, pinned: bool) {
        self.ivars().pinned.set(pinned);
        let window = &self.ivars().window;
        let floating = pinned
            && !self.fullscreen_transitioning()
            && !window.styleMask().contains(NSWindowStyleMask::FullScreen);
        window.setLevel(if floating {
            NSFloatingWindowLevel
        } else {
            NSNormalWindowLevel
        });
    }

    pub fn fullscreen_transitioning(&self) -> bool {
        self.ivars()
            .fullscreen_transition_until
            .get()
            .is_some_and(|until| Instant::now() < until)
    }

    pub fn button(&self, kind: NSWindowButton) -> Option<Retained<NSButton>> {
        self.ivars()
            .fullscreen_buttons
            .iter()
            .find(|(button_kind, button)| *button_kind == kind && button.window().is_some())
            .map(|(_, button)| button.clone())
            .or_else(|| self.ivars().window.standardWindowButton(kind))
    }

    pub fn buttons(&self) -> Vec<Retained<NSButton>> {
        [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .into_iter()
        .filter_map(|kind| self.button(kind))
        .collect()
    }

    pub fn keep_fullscreen_buttons_above_content(&self) {
        if let Some((_, last)) = self.ivars().fullscreen_buttons.last()
            && let Some(root) = unsafe { last.superview() }
            && root.subviews().lastObject().as_deref() != Some(last.as_ref())
        {
            for (_, button) in &self.ivars().fullscreen_buttons {
                root.addSubview(button);
            }
        }
    }

    fn show_fullscreen_buttons(&self) {
        let window = &self.ivars().window;
        let Some(root) = window.contentView() else {
            return;
        };
        for (index, (kind, button)) in self.ivars().fullscreen_buttons.iter().enumerate() {
            let y = if root.isFlipped() {
                27.
            } else {
                root.bounds().size.height - 27. - button.frame().size.height
            };
            button.setFrameOrigin(NSPoint::new(26. + index as f64 * 20., y));
            button.setAutoresizingMask(if root.isFlipped() {
                NSAutoresizingMaskOptions::ViewMaxYMargin
            } else {
                NSAutoresizingMaskOptions::ViewMinYMargin
            });
            unsafe {
                button.setTarget(Some(&**window));
                button.setAction(Some(match *kind {
                    NSWindowButton::CloseButton => sel!(performClose:),
                    NSWindowButton::MiniaturizeButton => sel!(miniaturize:),
                    _ => sel!(toggleFullScreen:),
                }));
            }
            let label = NSString::from_str(match *kind {
                NSWindowButton::CloseButton => crate::i18n::text("收回聊天", "Return to Chat"),
                NSWindowButton::MiniaturizeButton => crate::i18n::text("最小化", "Minimize"),
                _ => crate::i18n::text("退出全屏", "Exit Full Screen"),
            });
            button.setToolTip(Some(&label));
            unsafe {
                let _: () = msg_send![button, setAccessibilityLabel: &*label];
            }
            button.setEnabled(*kind != NSWindowButton::MiniaturizeButton);
            root.addSubview(button);
        }
    }

    fn layout(&self) {
        let window = &self.ivars().window;
        if self.fullscreen_transitioning()
            || window.styleMask().contains(NSWindowStyleMask::FullScreen)
            || self.ivars().updating.get()
        {
            return;
        }
        let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(parent) = (unsafe { close.superview() }) else {
            return;
        };
        let Some(container) = (unsafe { parent.superview() }) else {
            return;
        };
        if !container
            .window()
            .is_some_and(|owner| std::ptr::eq(&*owner, &**window))
        {
            return;
        }
        self.ivars().updating.set(true);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        let frame = NSRect::new(
            NSPoint::new(0., window.frame().size.height - 56.),
            NSSize::new(100., 56.),
        );
        if container.frame() != frame {
            container.setFrame(frame);
        }
        for (index, kind) in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .into_iter()
        .enumerate()
        {
            if let Some(button) = window.standardWindowButton(kind) {
                let origin = parent.convertPoint_fromView(
                    NSPoint::new(
                        26. + index as f64 * 20.,
                        window.frame().size.height - 27. - button.frame().size.height,
                    ),
                    None,
                );
                if button.frame().origin != origin {
                    button.setFrameOrigin(origin);
                }
            }
        }
        CATransaction::commit();
        self.ivars().updating.set(false);
    }
}

impl Drop for WindowChrome {
    fn drop(&mut self) {
        unsafe {
            NSNotificationCenter::defaultCenter().removeObserver(self);
        }
        for (view, enabled) in &self.ivars().frames {
            view.setPostsFrameChangedNotifications(*enabled);
        }
    }
}
