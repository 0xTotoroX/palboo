// [INPUT]: 主窗口的 AppKit 几何通知与标准红黄绿按钮。
// [OUTPUT]: 普通窗口的标题栏定位、全屏过渡状态及全屏原生退出按钮。
// [POS]: panel_window 私有标题栏适配；沿用系统按钮、动作和全屏管理。
// [PROTOCOL]: 变更时更新此头部，然后检查 src/AGENTS.md。

use objc2::{DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained, sel};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSButton, NSView, NSViewFrameDidChangeNotification, NSWindow,
    NSWindowButton, NSWindowDidBecomeKeyNotification,
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
    updating: Cell<bool>,
    fullscreen_transition_until: Cell<Option<Instant>>,
    fullscreen_exit: Option<Retained<NSButton>>,
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
            let Some(window) = notification.object().and_then(|object| object.downcast::<NSWindow>().ok()) else {
                return;
            };
            let name = notification.name();
            let starting = unsafe {
                name.isEqualToString(NSWindowWillEnterFullScreenNotification)
                    || name.isEqualToString(NSWindowWillExitFullScreenNotification)
            };
            // AppKit 没有公开的全屏失败通知。异常中断后允许下一次几何事件恢复排版。
            self.ivars().fullscreen_transition_until.set(
                starting.then(|| Instant::now() + Duration::from_secs(3)),
            );
            if !starting && window.styleMask().contains(NSWindowStyleMask::FullScreen) {
                self.show_fullscreen_exit(&window);
            } else if !starting {
                if let Some(button) = &self.ivars().fullscreen_exit {
                    button.removeFromSuperview();
                }
                self.layout(&window);
            }
        }

        #[unsafe(method(windowGeometryChanged:))]
        fn geometry_changed(&self, notification: &NSNotification) {
            let window = notification.object().and_then(|object| {
                object.downcast::<NSWindow>().ok().or_else(|| {
                    notification.object()?.downcast::<NSView>().ok()?.window()
                })
            });
            if let Some(window) = window {
                self.layout(&window);
            }
        }
    }
);

impl WindowChrome {
    pub fn install(window: &NSWindow) -> Retained<Self> {
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
            updating: Cell::new(false),
            fullscreen_transition_until: Cell::new(None),
            fullscreen_exit: NSWindow::standardWindowButton_forStyleMask(
                NSWindowButton::ZoomButton,
                window.styleMask() | NSWindowStyleMask::FullScreen,
                mtm,
            ),
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
        this.layout(window);
        this
    }

    pub fn fullscreen_transitioning(&self) -> bool {
        self.ivars()
            .fullscreen_transition_until
            .get()
            .is_some_and(|until| Instant::now() < until)
    }

    pub fn fullscreen_exit(&self) -> Option<&NSButton> {
        self.ivars()
            .fullscreen_exit
            .as_deref()
            .filter(|button| button.window().is_some())
    }

    pub fn keep_fullscreen_exit_above_content(&self) {
        if let Some(button) = self.fullscreen_exit()
            && let Some(root) = unsafe { button.superview() }
            && root.subviews().lastObject().as_deref() != Some(button.as_ref())
        {
            root.addSubview(button);
        }
    }

    fn show_fullscreen_exit(&self, window: &NSWindow) {
        let (Some(button), Some(root)) = (&self.ivars().fullscreen_exit, window.contentView())
        else {
            return;
        };
        let y = if root.isFlipped() {
            27.
        } else {
            root.bounds().size.height - 27. - button.frame().size.height
        };
        button.setFrameOrigin(NSPoint::new(66., y));
        button.setAutoresizingMask(if root.isFlipped() {
            NSAutoresizingMaskOptions::ViewMaxYMargin
        } else {
            NSAutoresizingMaskOptions::ViewMinYMargin
        });
        unsafe {
            button.setTarget(Some(window));
            button.setAction(Some(sel!(toggleFullScreen:)));
        }
        let label = NSString::from_str(crate::i18n::text("退出全屏", "Exit Full Screen"));
        button.setToolTip(Some(&label));
        unsafe {
            let _: () = msg_send![button, setAccessibilityLabel: &*label];
        }
        button.setEnabled(true);
        root.addSubview(button);
    }

    fn layout(&self, window: &NSWindow) {
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
        self.ivars().updating.set(true);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        if let Some(frame_view) = unsafe { container.superview() } {
            frame_view.layoutSubtreeIfNeeded();
        }
        let frame = NSRect::new(
            NSPoint::new(0., window.frame().size.height - 56.),
            NSSize::new(100., 56.),
        );
        if container.frame() != frame {
            container.setFrame(frame);
        }
        container.layoutSubtreeIfNeeded();
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
