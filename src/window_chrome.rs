// [INPUT]: 主窗口的 AppKit 几何通知与标准红黄绿按钮。
// [OUTPUT]: 在原生布局结束后同步定位标题栏，不从网页 drawRect 反向修改窗口布局。
// [POS]: panel_window 私有标题栏适配；沿用系统按钮、动作和全屏管理。
// [PROTOCOL]: 变更时更新此头部，然后检查 src/AGENTS.md。

use objc2::{DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained, sel};
use objc2_app_kit::{
    NSView, NSViewFrameDidChangeNotification, NSWindow, NSWindowButton,
    NSWindowDidBecomeKeyNotification, NSWindowDidChangeBackingPropertiesNotification,
    NSWindowDidDeminiaturizeNotification, NSWindowDidEndLiveResizeNotification,
    NSWindowDidExitFullScreenNotification, NSWindowDidMoveNotification,
    NSWindowDidResizeNotification, NSWindowStyleMask,
};
use objc2_foundation::{
    MainThreadMarker, NSNotification, NSNotificationCenter, NSObject, NSPoint, NSRect, NSSize,
};
use objc2_quartz_core::CATransaction;
use std::cell::Cell;

pub struct ChromeState {
    updating: Cell<bool>,
    frames: Vec<(Retained<NSView>, bool)>,
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "PalbooWindowChrome"]
    #[thread_kind = MainThreadOnly]
    #[ivars = ChromeState]
    pub struct WindowChrome;

    impl WindowChrome {
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
                NSWindowDidExitFullScreenNotification,
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

    fn layout(&self, window: &NSWindow) {
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) || self.ivars().updating.get()
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
