// [INPUT]: Tao/Wry、Runtime、Preferences、Palboo.app 身份、共享 native_backdrop 与 AppKit 手势。
// [OUTPUT]: 原生红黄绿、Palboo 应用身份、置顶/Spaces、共用可逆路径的跨屏往返/中断恢复、页面重载后的呈现确认与旧交接清理、双向短过渡回退及同帧缩放。
// [POS]: 窗口子进程实现；系统管理最小化/放大/全屏，关闭沿用收回，普通几何独立于临时窗口状态。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

#[path = "window_chrome.rs"]
mod window_chrome;
#[path = "window_warp.rs"]
mod window_warp;

use crate::{config::Paths, lifecycle::Runtime, panel::Preferences};
use anyhow::Result;
use serde_json::{Value, json};
use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::macos::WindowBuilderExtMacOS,
    window::{Window, WindowBuilder},
};
use wry::WebViewBuilder;

#[derive(Clone, Copy, Debug)]
struct Pose {
    x: f64,
    y: f64,
    scale: f64,
    width: f64,
    height: f64,
    alpha: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum Motion {
    Enter,
    Return,
    Recover,
    Close,
}

#[derive(Clone, Copy)]
struct WindowPath {
    source: Pose,
    desktop: Pose,
    spatial: bool,
}
impl WindowPath {
    // q=0 是聊天内，q=1 是桌面。普通窗口和开发网格只负责绘制，同一 q 始终对应同一帧。
    fn sample(self, q: f64) -> (Pose, [f64; 2]) {
        let q = q.clamp(0., 1.);
        let eased = q.powi(3);
        let mix = |a, b| a + (b - a) * eased;
        let arc = if self.spatial {
            (std::f64::consts::PI * q).sin()
        } else {
            0.
        };
        let pose = Pose {
            x: mix(self.source.x, self.desktop.x),
            y: mix(self.source.y, self.desktop.y) + 10. * arc,
            width: mix(self.source.width, self.desktop.width),
            height: mix(self.source.height, self.desktop.height),
            scale: mix(self.source.scale, self.desktop.scale),
            alpha: if self.spatial {
                1.
            } else {
                self.source.alpha + (self.desktop.alpha - self.source.alpha) * q
            },
        };
        let strength = 0.74 * arc.powi(2);
        let dx = self.source.x + self.source.width / 2. - self.desktop.x - self.desktop.width / 2.;
        let dy =
            -(self.source.y + self.source.height / 2. - self.desktop.y - self.desktop.height / 2.);
        let bend = if dx.abs() > dy.abs() {
            [strength * dx.signum(), 0.]
        } else {
            [0., strength * if dy == 0. { 1. } else { dy.signum() }]
        };
        (pose, bend)
    }
}

struct WindowTransition {
    started: std::time::Instant,
    last_frame: std::time::Instant,
    duration: std::time::Duration,
    from: Pose,
    to: Pose,
    motion: Motion,
    spatial: bool,
    path: Option<WindowPath>,
    start_q: f64,
    end_q: f64,
    last_q: f64,
}

impl WindowTransition {
    fn progress(&self, now: std::time::Instant) -> f64 {
        (now.duration_since(self.started).as_secs_f64() / self.duration.as_secs_f64()).clamp(0., 1.)
    }
    fn q(&self, now: std::time::Instant) -> f64 {
        self.start_q + (self.end_q - self.start_q) * self.progress(now)
    }
    fn value(&self, now: std::time::Instant) -> (Pose, bool) {
        let progress = self.progress(now);
        if let Some(path) = self.path {
            return (path.sample(self.q(now)).0, progress >= 1.);
        }
        let eased = 1. - (1. - progress).powi(3);
        let mix = |a, b| a + (b - a) * eased;
        (
            Pose {
                x: mix(self.from.x, self.to.x),
                y: mix(self.from.y, self.to.y),
                width: mix(self.from.width, self.to.width),
                height: mix(self.from.height, self.to.height),
                scale: mix(self.from.scale, self.to.scale),
                alpha: mix(self.from.alpha, self.to.alpha),
            },
            progress >= 1.,
        )
    }
    fn bend(&self, now: std::time::Instant) -> [f64; 2] {
        self.path
            .map_or([0., 0.], |path| path.sample(self.q(now)).1)
    }
    fn frame(&mut self, now: std::time::Instant) -> (Pose, bool, [f64; 2]) {
        // 系统忙时保留中间帧，不让第一帧跨过整段动画。
        let delta = now.duration_since(self.last_frame);
        let max_step = std::time::Duration::from_millis(32);
        if delta > max_step {
            self.started += delta - max_step;
        }
        self.last_frame = now;
        self.last_q = self.q(now);
        let (pose, finished) = self.value(now);
        (pose, finished, self.bend(now))
    }
    fn reverse(self, motion: Motion) -> Self {
        let mut next = Self::new(self.from, self.to, motion, self.spatial);
        next.path = self.path;
        next.start_q = self.last_q;
        next.last_q = self.last_q;
        next.end_q = if motion == Motion::Return { 0. } else { 1. };
        next.duration = next
            .duration
            .mul_f64((next.end_q - next.start_q).abs().max(0.001));
        next
    }
    fn new(from: Pose, to: Pose, motion: Motion, spatial: bool) -> Self {
        let ms = match (motion, spatial) {
            (Motion::Enter, true) => 320,
            (Motion::Return | Motion::Recover, true) => 260,
            (Motion::Close, _) => 90,
            _ => 140,
        };
        let now = std::time::Instant::now();
        let returning = motion == Motion::Return;
        let path = (motion != Motion::Close).then_some(WindowPath {
            source: if returning { to } else { from },
            desktop: if returning { from } else { to },
            spatial,
        });
        Self {
            started: now,
            last_frame: now,
            duration: std::time::Duration::from_millis(ms),
            from,
            to,
            motion,
            spatial,
            path,
            start_q: if returning { 1. } else { 0. },
            end_q: if returning { 0. } else { 1. },
            last_q: if returning { 1. } else { 0. },
        }
    }
}

mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSApplication, NSEvent, NSRunningApplication, NSScreen, NSWindow, NSWindowButton,
        NSWorkspace,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use objc2_quartz_core::{CATransaction, CATransform3D};
    use serde_json::Value;
    use tao::{platform::macos::WindowExtMacOS, window::Window};

    pub fn glass_available() -> bool {
        crate::native_backdrop::glass_available()
    }

    pub fn reduce_motion() -> bool {
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
    }

    pub fn bundled_application() -> bool {
        NSRunningApplication::currentApplication()
            .bundleIdentifier()
            .is_some_and(|id| id.to_string() == "local.palboo.launcher")
    }

    pub fn maximized(window: &Window) -> bool {
        window.is_maximized() || window.fullscreen().is_some()
    }

    pub fn native_controls(window: &Window) -> Value {
        let native = native_window(window);
        let buttons: Vec<_> = [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton]
            .into_iter().filter_map(|kind| native.standardWindowButton(kind)).map(|button| {
                let frame = button.convertRect_toView(button.bounds(), None);
                let reachable = native.contentView().and_then(|root| unsafe { root.superview() })
                    .and_then(|parent| parent.hitTest(NSPoint::new(frame.origin.x + frame.size.width / 2., frame.origin.y + frame.size.height / 2.)))
                    .is_some_and(|hit| hit.isDescendantOf(&button));
                serde_json::json!({"visible":!button.isHidden(),"enabled":button.isEnabled(),
                    "reachable":reachable,
                    "x":frame.origin.x,"y":native.frame().size.height-frame.origin.y-frame.size.height,
                    "width":frame.size.width,"height":frame.size.height})
            }).collect();
        let app =
            NSApplication::sharedApplication(MainThreadMarker::new().expect("window main thread"));
        let identity = NSRunningApplication::currentApplication();
        let header_reachable = native.contentView().is_some_and(|root| {
            unsafe { root.superview() }
                .and_then(|parent| {
                    parent.hitTest(NSPoint::new(
                        native.frame().size.width - 38.,
                        native.frame().size.height - 34.,
                    ))
                })
                .is_some_and(|hit| hit.isDescendantOf(&root))
        });
        serde_json::json!({"buttons":buttons,"activationPolicy":app.activationPolicy().0,
            "hasAppIcon":app.applicationIconImage().is_some(),"headerContentReachable":header_reachable,
            "processId":std::process::id(),"bundleIdentifier":identity.bundleIdentifier().map(|s|s.to_string()),
            "bundlePath":identity.bundleURL().and_then(|url|url.path()).map(|s|s.to_string())})
    }

    pub fn enable_window_controls(window: &Window, enabled: bool) {
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = native_window(window).standardWindowButton(kind) {
                button.setEnabled(enabled);
            }
        }
    }

    #[cfg(debug_assertions)]
    pub fn probe_window_controls(window: &Window, backdrop: &Backdrop) -> Value {
        let native = native_window(window);
        let original = native.frame();
        let mut samples = Vec::new();
        let mut live_resize = None;
        // 和拖动/缩放共用 AppKit frame 更新，逐次绘制后取样，不发送系统鼠标事件。
        for step in 0..24 {
            if step == 8 {
                live_resize = backdrop.0.begin_live_resize();
            }
            let phase = step % 8;
            let offset = f64::from(phase.min(7 - phase)) * 8.;
            let mut frame = original;
            if step < 8 {
                frame.origin.x += offset;
                frame.origin.y -= offset;
            } else {
                frame.size.width += offset;
                frame.size.height += offset;
                frame.origin.y -= offset;
                if step >= 16 {
                    frame.origin.x -= offset;
                }
            }
            set_interactive_frame(window, frame, backdrop);
            native.displayIfNeeded();
            // 提交 layer-backed view 的绘制后，同时检查标题栏与完整内容层。
            CATransaction::flush();
            let mut sample = native_controls(window);
            sample["surface"] = backdrop.0.geometry(native);
            samples.push(sample);
        }
        set_interactive_frame(window, original, backdrop);
        drop(live_resize);
        native.displayIfNeeded();
        CATransaction::flush();
        let mut sample = native_controls(window);
        sample["surface"] = backdrop.0.geometry(native);
        samples.push(sample);
        serde_json::json!(samples)
    }

    pub fn set_window_alpha(window: &Window, value: f64) {
        native_window(window).setAlphaValue(value.clamp(0., 1.));
    }

    pub fn pose(window: &Window) -> super::Pose {
        let native = native_window(window);
        let frame = native.frame();
        let origin = frame.origin;
        let scale = native
            .contentView()
            .and_then(|v| v.layer())
            .map_or(1., |l| l.transform().m11);
        super::Pose {
            x: origin.x,
            y: origin.y,
            scale,
            width: frame.size.width,
            height: frame.size.height,
            alpha: native.alphaValue(),
        }
    }

    pub fn apply_pose(window: &Window, pose: super::Pose, backdrop: &Backdrop) {
        let native = native_window(window);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        let frame = NSRect::new(
            NSPoint::new(pose.x, pose.y),
            NSSize::new(pose.width, pose.height),
        );
        let resized = native.frame().size != frame.size;
        if native.frame() != frame {
            native.setFrame_display(frame, false);
        }
        if resized {
            backdrop.resize_viewport(window, true);
        }
        if let Some(root) = native.contentView() {
            root.setWantsLayer(true);
            if let Some(layer) = root.layer() {
                let bounds = layer.bounds();
                let anchor = layer.anchorPoint();
                let scale = pose.scale;
                layer.setTransform(CATransform3D {
                    m11: scale,
                    m12: 0.,
                    m13: 0.,
                    m14: 0.,
                    m21: 0.,
                    m22: scale,
                    m23: 0.,
                    m24: 0.,
                    m31: 0.,
                    m32: 0.,
                    m33: 1.,
                    m34: 0.,
                    m41: (0.5 - anchor.x) * bounds.size.width * (1. - scale),
                    m42: (0.5 - anchor.y) * bounds.size.height * (1. - scale),
                    m43: 0.,
                    m44: 1.,
                });
            }
        }
        native.setAlphaValue(pose.alpha.clamp(0., 1.));
        CATransaction::commit();
    }

    pub fn warp_rect(pose: super::Pose) -> NSRect {
        let mtm = MainThreadMarker::new().expect("window main thread");
        let height = NSScreen::screens(mtm)
            .firstObject()
            .map_or(0., |s| s.frame().size.height);
        NSRect::new(
            NSPoint::new(pose.x, height - pose.y - pose.height),
            NSSize::new(pose.width, pose.height),
        )
    }

    pub fn anchor_pose(window: &Window, value: &Value) -> Option<super::Pose> {
        let x = value["x"].as_f64()?;
        let top = value["y"].as_f64()?;
        let width = value["width"].as_f64()?;
        let height = value["height"].as_f64()?;
        if ![x, top, width, height].iter().all(|n| n.is_finite())
            || !(24. ..=640.).contains(&width)
            || !(20. ..=720.).contains(&height)
        {
            return None;
        }
        let mtm = MainThreadMarker::new()?;
        let screens = NSScreen::screens(mtm);
        let primary = screens.firstObject()?.frame();
        let y = primary.size.height - top - height;
        let frame = native_window(window).frame();
        let frames: Vec<_> = screens.iter().map(|s| s.frame()).collect();
        if !anchor_on_displays(
            &frames,
            NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)),
            frame,
        ) {
            return None;
        }
        Some(super::Pose {
            x: x - 12.,
            y: y - 12.,
            width: width + 24.,
            height: height + 24.,
            scale: 0.98,
            alpha: 1.,
        })
    }

    // NSScreen 的全局逻辑坐标覆盖主屏、随航与负坐标屏幕，不要求两端同屏。
    // 两端独立校验仍连接的屏幕；不要把 backing pixels 混入网格坐标。
    pub(super) fn anchor_on_displays(screens: &[NSRect], source: NSRect, target: NSRect) -> bool {
        let contains = |r: NSRect, px: f64, py: f64| {
            px >= r.origin.x
                && py >= r.origin.y
                && px <= r.origin.x + r.size.width
                && py <= r.origin.y + r.size.height
        };
        let on_screen = |x, y| screens.iter().any(|r| contains(*r, x, y));
        [source.origin.x, source.origin.x + source.size.width]
            .into_iter()
            .all(|x| {
                [source.origin.y, source.origin.y + source.size.height]
                    .into_iter()
                    .all(|y| on_screen(x, y))
            })
            && on_screen(
                target.origin.x + target.size.width / 2.,
                target.origin.y + target.size.height / 2.,
            )
    }

    pub struct Backdrop(crate::native_backdrop::Backdrop);

    impl Backdrop {
        pub fn new(window: &Window) -> Self {
            Self(crate::native_backdrop::Backdrop::new(native_window(window)))
        }

        pub fn style(&self) -> Option<&'static str> {
            self.0.style()
        }

        pub fn resize_viewport(&self, window: &Window, interactive: bool) {
            self.0.resize_viewport(native_window(window), interactive);
        }

        pub fn update(&self, window: &Window, message: &Value) {
            self.0.update(native_window(window), message);
        }
    }

    // WebView IPC 已离开原鼠标事件栈。按 AppKit 的全局点坐标移动，避免窗口跳位；
    // Tao 在 macOS 不支持 drag_resize_window，因此同一手势也处理边角缩放。
    pub struct Gesture {
        mouse: NSPoint,
        frame: NSRect,
        resize_left: Option<bool>,
        _live_resize: Option<crate::native_backdrop::LiveResize>,
    }

    pub(super) fn native_window(window: &Window) -> &NSWindow {
        // Tao 持有 NSWindow，且本模块仅在窗口所属的主线程使用该借用。
        unsafe { &*(window.ns_window() as *const NSWindow) }
    }

    impl Gesture {
        pub fn start(
            window: &Window,
            resize_left: Option<bool>,
            backdrop: &Backdrop,
        ) -> Option<Self> {
            (NSEvent::pressedMouseButtons() & 1 != 0).then(|| Self {
                mouse: NSEvent::mouseLocation(),
                frame: native_window(window).frame(),
                resize_left,
                _live_resize: resize_left.and_then(|_| backdrop.0.begin_live_resize()),
            })
        }

        pub fn update(&self, window: &Window, backdrop: &Backdrop) -> bool {
            let mouse = NSEvent::mouseLocation();
            let (dx, dy) = (mouse.x - self.mouse.x, mouse.y - self.mouse.y);
            let mut frame = self.frame;
            if let Some(left) = self.resize_left {
                frame.size.width = (self.frame.size.width + if left { -dx } else { dx }).max(324.);
                frame.size.height = (self.frame.size.height - dy).max(364.);
                frame.origin.y += self.frame.size.height - frame.size.height;
                if left {
                    frame.origin.x += self.frame.size.width - frame.size.width;
                }
            } else {
                frame.origin.x += dx;
                frame.origin.y += dy;
            }
            set_interactive_frame(window, frame, backdrop);
            NSEvent::pressedMouseButtons() & 1 != 0
        }
    }

    fn set_interactive_frame(window: &Window, frame: NSRect, backdrop: &Backdrop) {
        let native = native_window(window);
        if native.frame() == frame {
            return;
        }
        let resized = native.frame().size != frame.size;
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        // 不在 setFrame 中提前显示旧网页尺寸；材质和 WebView 同步后再提交这一帧。
        native.setFrame_display(frame, false);
        if resized {
            backdrop.resize_viewport(window, true);
        }
        CATransaction::commit();
    }
}

fn publish_window_controls(
    webview: &wry::WebView,
    window: &Window,
    normal: Option<Pose>,
    hidden: bool,
) {
    let frame = macos::pose(window);
    let state = json!({"maximized":macos::maximized(window),"minimized":window.is_minimized(),"fullscreen":window.fullscreen().is_some(),"hidden":hidden,"nativeChrome":macos::native_controls(window),"collectionBehavior":macos::native_window(window).collectionBehavior().bits(),"normalFrame":normal.map(|p|json!({"x":p.x,"y":p.y,"width":p.width,"height":p.height}))});
    let mut state = state;
    state["visible"] = json!(window.is_visible());
    state["frame"] = json!({"X":frame.x,"Y":frame.y,"Width":frame.width,"Height":frame.height});
    let _ = webview.evaluate_script(&format!("window.__buddyWindowControls?.update({state});"));
}

// 独立子进程在主线程运行系统窗口；后台退出会回收它。
pub fn run(paths: &Paths, lease: &str, activate: bool) -> Result<()> {
    run_surface(paths, lease, activate, None)
}

pub fn run_surface(
    paths: &Paths,
    lease: &str,
    activate: bool,
    feature: Option<&str>,
) -> Result<()> {
    crate::panel::require_popout(crate::panel::popout_supported())?;
    let runtime = Runtime::read(paths)?;
    let prefs = Preferences::read(paths);
    let mut event_loop = EventLoopBuilder::<Value>::with_user_event().build();
    {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        event_loop.set_activation_policy(if macos::bundled_application() {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        });
    }
    crate::window_process::ready()?;
    let size = (prefs.ui.width + 24., prefs.ui.height + 24.);
    let window = WindowBuilder::new()
        .with_title(if crate::assets::development().is_some() {
            crate::i18n::text("Palboo · 开发版", "Palboo · Dev")
        } else {
            "Palboo"
        })
        .with_decorations(true)
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true)
        .with_automatic_window_tabbing(false)
        .with_transparent(true)
        .with_focused(false)
        .with_visible(false)
        .with_always_on_top(prefs.always_on_top)
        .with_inner_size(LogicalSize::new(size.0, size.1))
        .with_min_inner_size(LogicalSize::new(324., 364.))
        .build(&event_loop)?;
    {
        use objc2_app_kit::NSWindowCollectionBehavior;
        use tao::platform::macos::WindowExtMacOS;
        // 半透明网页的逐像素系统阴影会让字形出现重影。
        window.set_has_shadow(false);
        // 置顶只改变层级；主窗口仍归属单个桌面，并可在调度中心拖到其他桌面。
        // 不沿用非普通层级默认的 Transient，也不使用贴边窗口的跨桌面策略。
        let native = macos::native_window(&window);
        let behavior = native.collectionBehavior()
            & !(NSWindowCollectionBehavior::Transient
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::MoveToActiveSpace);
        native.setCollectionBehavior(
            behavior
                | NSWindowCollectionBehavior::Managed
                | NSWindowCollectionBehavior::FullScreenPrimary,
        );
    }
    if let Some(position) = prefs.position {
        window.set_outer_position(PhysicalPosition::new(position.x as i32, position.y as i32));
    } else if let Some(monitor) = window.primary_monitor() {
        let origin = monitor.position();
        let size = monitor.size();
        window.set_outer_position(PhysicalPosition::new(
            origin.x + size.width as i32 - window.outer_size().width as i32 - 48,
            origin.y + 96,
        ));
    }
    keep_on_screen(&window);
    macos::set_window_alpha(&window, 0.);
    let page = format!(
        "http://127.0.0.1:{}/{}",
        runtime.port,
        if feature.is_some() {
            "feature.html"
        } else {
            "panel"
        }
    );
    let url = format!(
        "{page}#token={}&lease={lease}{}",
        runtime.token,
        feature
            .map(|id| format!("&feature={id}"))
            .unwrap_or_default()
    );
    let proxy = event_loop.create_proxy();
    let allowed = page.clone();
    let builder = WebViewBuilder::new()
        .with_incognito(crate::assets::development().is_some())
        .with_url(url)
        .with_transparent(true)
        .with_focused(false)
        .with_navigation_handler(move |url| {
            url == allowed || url.starts_with(&format!("{allowed}#"))
        })
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_ipc_handler(move |request| {
            if request.body().len() <= 8192
                && let Ok(value) = serde_json::from_str::<Value>(request.body())
            {
                let _ = proxy.send_event(value);
            }
        });
    let builder = builder
        // 浮窗不抢占焦点，也可能暂时被遮挡；投影与租约不能随 WebKit 后台页面一起暂停。
        .with_background_throttling(wry::BackgroundThrottlingPolicy::Disabled)
        .with_initialization_script(format!(
            "window.__buddyNativeSurface = true; window.__buddyNativeChrome = true; window.__companionNativeMotion = true; window.__companionNativeBackdrop = true; window.__companionNativeGlass = {};",
            macos::glass_available()
        ));
    let webview = builder.build(&window)?;

    let mut gesture: Option<macos::Gesture> = None;
    let backdrop = macos::Backdrop::new(&window);
    let window_chrome = window_chrome::WindowChrome::install(macos::native_window(&window));
    let mut reported_glass_style = None;
    let mut window_transition: Option<WindowTransition> = None;
    let mut return_origin: Option<Pose> = None;
    let mut held_return: Option<WindowTransition> = None;
    let mut presentation_reported = false;
    let experimental_genie = cfg!(debug_assertions)
        && (crate::assets::development().is_some()
            || crate::brand::env("PALBOO_DEV_GENIE").as_deref() == Ok("1"));
    let mut warp = window_warp::WindowWarp::load(
        macos::native_window(&window).windowNumber() as i32,
        experimental_genie,
    );
    let mut motion_pose: Option<Pose> = None;
    let mut warp_source = macos::native_window(&window).frame().size;
    let mut next_motion_frame = std::time::Instant::now();
    let mut normal_window_pose = Some(macos::pose(&window));
    let mut normal_pose_update: Option<std::time::Instant> = None;
    let mut controls_enabled = true;
    let mut last_window_state = (false, false, false);
    let mut return_after_fullscreen = false;
    let mut deferred_return: Option<Value> = None;
    let event_loop_proxy = event_loop.create_proxy();
    let mut window_hidden = true;
    let mut scope_hidden = false;
    event_loop.run(move |event, _, control| {
        *control = ControlFlow::Wait;
        // 通知观察者与原生窗口同寿命，不在普通事件或 drawRect 中布局标题栏。
        let _ = &window_chrome;
        match event {
            Event::Reopen { .. } => {
                let _ = event_loop_proxy.send_event(json!({"kind":"reveal"}));
            }
            Event::UserEvent(message) => match message["kind"].as_str().unwrap_or_default() {
                "backdrop" => {
                    backdrop.update(&window, &message);
                    let style = backdrop.style();
                    if reported_glass_style != style {
                        reported_glass_style = style;
                        let _ = webview.evaluate_script(&format!(
                            "window.__companionNativeGlassStyle = {};",
                            json!(style)
                        ));
                    }
                }
                "scope-visible" => {
                    let hidden = message["value"] == false;
                    if scope_hidden != hidden {
                        scope_hidden = hidden;
                        window.set_visible(!scope_hidden && !window_hidden);
                    }
                }
                "window-state" => publish_window_controls(&webview, &window, normal_window_pose, window_hidden),
                #[cfg(debug_assertions)]
                "native-chrome-probe" if window_transition.is_none() && gesture.is_none() => {
                    let samples = macos::probe_window_controls(&window, &backdrop);
                    let _ = webview.evaluate_script(&format!("window.__companionNativeChromeProbe = {samples};"));
                }
                "hide" => {
                    if window_transition.is_none() && gesture.is_none() {
                        window.set_visible(false);
                        window_hidden = true;
                    }
                    publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
                }
                "toggle-maximize" => {
                    if window_transition.is_none() && gesture.is_none() {
                        if window.fullscreen().is_some() {
                            window.set_fullscreen(None);
                        } else if window.is_maximized() {
                            if let Some(normal) = normal_window_pose {
                                macos::apply_pose(&window, normal, &backdrop);
                                keep_on_screen(&window);
                            }
                        } else {
                            window.set_maximized(true);
                        }
                    }
                    publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
                }
                "minimize" if window_transition.is_none() && gesture.is_none() => window.set_minimized(true),
                // 合成原生验收通过真实系统按钮发送动作，不申请鼠标/屏幕权限。
                #[cfg(debug_assertions)]
                "native-fullscreen" if window_transition.is_none() && gesture.is_none() => {
                    window.set_fullscreen(if window.fullscreen().is_some() { None } else { Some(tao::window::Fullscreen::Borderless(None)) });
                }
                #[cfg(debug_assertions)]
                "native-window-button" if window_transition.is_none() && gesture.is_none() => {
                    use objc2_app_kit::NSWindowButton;
                    let button = match message["button"].as_str() {
                        Some("close") => Some(NSWindowButton::CloseButton),
                        Some("minimize") => Some(NSWindowButton::MiniaturizeButton),
                        Some("zoom") => Some(NSWindowButton::ZoomButton),
                        _ => None,
                    };
                    if let Some(button) = button.and_then(|kind| macos::native_window(&window).standardWindowButton(kind)) {
                        // 只调用本窗口已安装的三个标准系统按钮。
                        unsafe { button.performClick(None); }
                    }
                }
                "reveal" => {
                    window.set_minimized(false);
                    window.set_visible(!scope_hidden);
                    if !scope_hidden { window.set_focus(); }
                    window_hidden = false;
                    publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
                }
                "show" => {
                    // 页面重载会替换 JS 回调；重新确认呈现，并退掉旧页面未完成的交接。
                    // 返回途中的 frame 可能已缩向入口，桌面终点仍取原来的普通窗口位置。
                    let mut target = return_origin.take()
                        .or_else(|| window_transition.as_ref().and_then(|t| t.path).map(|p| p.desktop))
                        .unwrap_or_else(|| macos::pose(&window));
                    presentation_reported = false;
                    window_transition = None;
                    held_return = None;
                    deferred_return = None;
                    return_after_fullscreen = false;
                    motion_pose = None;
                    if let Some(warp) = &mut warp { warp.reset(); }
                    target.alpha = 1.;
                    target.scale = 1.;
                    let mut anchor = macos::anchor_pose(&window, &message["anchor"])
                        .filter(|p| p.height >= 364. || warp.as_ref().is_some_and(|w| w.available()));
                    let mut from = anchor.unwrap_or(target);
                    from.alpha = if anchor.is_some() { 1. } else { 0. };
                    if anchor.is_none() { from.scale = 0.98; }
                    if macos::reduce_motion() { from = target; }
                    warp_source = macos::native_window(&window).frame().size;
                    let mut genie_entry = false;
                    if warp.as_ref().is_some_and(|w| w.available()) && anchor.is_some() && !macos::reduce_motion() {
                        macos::set_window_alpha(&window, 0.);
                        if let Some(warp) = &mut warp {
                            // 显示前先把整窗压到来源区域，避免首帧露出完整矩形。
                            warp.apply(macos::warp_rect(from), warp_source, [0., 0.]);
                            genie_entry = warp.available();
                        }
                    }
                    if !genie_entry {
                        if anchor.is_some_and(|p| p.height < 364.) {
                            anchor = None;
                            from = Pose { scale: 0.98, alpha: 0., ..target };
                        }
                        macos::apply_pose(&window, from, &backdrop);
                    } else { macos::set_window_alpha(&window, from.alpha); }
                    window.set_visible(!scope_hidden);
                    window_hidden = false;
                    publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
                    if activate && !scope_hidden { window.set_focus(); }
                    if macos::reduce_motion() {
                        presentation_reported = true;
                        let _ = webview.evaluate_script("window.__companionPopout?.presented(); window.__companionPopout?.motionFinished();");
                    } else {
                        window_transition = Some(WindowTransition::new(from, target, Motion::Enter, anchor.is_some()));
                    }
                }
                "return" => {
                    if window.fullscreen().is_some() {
                        // 收回命令在系统退出全屏后重放，避免移动全屏 Space 中的窗口。
                        window.set_fullscreen(None);
                        deferred_return = Some(message);
                        *control = ControlFlow::Wait;
                        return;
                    }
                    warp_source = macos::native_window(&window).frame().size;
                    let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                    // 重复收回不重设路径；入场中反向保留稳定桌面终点和已绘制进度。
                    if window_transition.as_ref().is_some_and(|t| t.motion == Motion::Return) || held_return.is_some() { return; }
                    let active = window_transition.take();
                    return_origin = Some(active.as_ref().and_then(|t| t.path).map_or(Pose { scale: 1., alpha: 1., ..from }, |p| p.desktop));
                    if macos::reduce_motion() {
                        window_transition = None;
                        let _ = webview.evaluate_script("window.__companionPopout?.returned(true);");
                    } else {
                        let target = macos::anchor_pose(&window, &message["anchor"])
                            .filter(|p| p.height >= 364. || warp.as_ref().is_some_and(|w| w.available()));
                        // 小入口、无效坐标或私有曲面不可用时，沿入场的短缩放/淡入反向收回。
                        // 动画完成后才交还内容；取消或交接失败仍可从当前帧恢复原窗口。
                        window_transition = Some(match active {
                            Some(transition) if matches!(transition.motion, Motion::Enter | Motion::Recover) => transition.reverse(Motion::Return),
                            _ => WindowTransition::new(from, target.unwrap_or(Pose { scale: 0.98, alpha: 0., ..from }), Motion::Return, target.is_some()),
                        });
                    }
                }
                "cancel-return" => {
                    deferred_return = None;
                    if motion_pose.is_none() { warp_source = macos::native_window(&window).frame().size; }
                    if let Some(target) = return_origin.take() {
                        let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                        if macos::reduce_motion() {
                            if let Some(warp) = &mut warp { warp.reset(); }
                            motion_pose = None;
                            macos::apply_pose(&window, target, &backdrop);
                            window_transition = None;
                            held_return = None;
                            let _ = webview.evaluate_script("window.__companionPopout?.motionFinished();");
                        } else {
                            window_transition = Some(window_transition.take().or_else(|| held_return.take())
                                .map_or_else(|| WindowTransition::new(from, target, Motion::Recover, false), |transition| transition.reverse(Motion::Recover)));
                        }
                    }
                    let _ = webview.evaluate_script("window.__companionPopout?.returned(false);");
                }
                "close" if !window_transition.as_ref().is_some_and(|t| t.motion == Motion::Close) => {
                    gesture = None;
                    window.set_ignore_cursor_events(true).ok();
                    let from = motion_pose.unwrap_or_else(|| macos::pose(&window));
                    if macos::reduce_motion() || from.alpha <= 0. {
                        *control = ControlFlow::Exit;
                    } else {
                        window_transition = Some(WindowTransition::new(from, Pose { alpha: 0., ..from }, Motion::Close, false));
                    }
                }
                "cancel-gesture" => {
                    gesture = None;
                    let _ = webview.evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
                }
                "drag" | "resize" if macos::maximized(&window) => {
                    let _ = webview.evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
                }
                "drag" | "resize" => {
                    // 先结束旧手势，防止两个 WebKit live-resize 生命周期交叉。
                    drop(gesture.take());
                    if let Some(warp) = &mut warp { warp.reset(); }
                    if window_transition.is_some() || return_origin.is_some() {
                        window_transition = None;
                        return_origin = None;
                    held_return = None;
                        let current = motion_pose.take().unwrap_or_else(|| macos::pose(&window));
                        macos::apply_pose(&window, Pose { scale: 1., alpha: 1., ..current }, &backdrop);
                        let _ = webview.evaluate_script("window.__companionPopout?.returned(false); window.__companionPopout?.motionFinished();");
                        if !presentation_reported {
                            presentation_reported = true;
                            let _ = webview.evaluate_script("window.__companionPopout?.presented();");
                        }
                    }
                    let resize = (message["kind"] == "resize").then_some(message["corner"] == "bl");
                    gesture = macos::Gesture::start(&window, resize, &backdrop);
                    if gesture.is_none() {
                        let _ = webview.evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
                    }
                }
                "pin" => window.set_always_on_top(message["value"] == true),
                "position" if macos::maximized(&window) => {}
                "position" => {
                    if let (Some(x), Some(y)) = (message["x"].as_f64(), message["y"].as_f64()) {
                        window.set_outer_position(PhysicalPosition::new(x as i32, y as i32));
                    }
                }
                "size" if window_transition.is_some() || macos::maximized(&window) => {
                    let _ = webview.evaluate_script(&format!("window.__companionPopout?.resized({});", message["id"]));
                }
                "size" => {
                    let width = message["width"].as_f64().filter(|n| n.is_finite()).unwrap_or(428.).max(324.);
                    let height = message["height"].as_f64().filter(|n| n.is_finite()).unwrap_or(444.).max(364.);
                    window.set_min_inner_size(Some(LogicalSize::new(324., 364.)));
                    let old = window.outer_size();
                    let position = window.outer_position().ok();
                    window.set_inner_size(LogicalSize::new(width, height));
                    if let Some(position) = position {
                        let next_width = (width * window.scale_factor()).round() as i32;
                        window.set_outer_position(PhysicalPosition::new(
                            position.x + (old.width as i32 - next_width) / 2,
                            position.y,
                        ));
                    }
                    keep_on_screen(&window);
                    let _ = webview.evaluate_script(&format!(
                        "window.__companionPopout?.resized({});",
                        message["id"]
                    ));
                }
                _ => {}
            },
            Event::WindowEvent {
                event: WindowEvent::Resized(_),
                ..
            } => {
                backdrop.resize_viewport(&window, true);
                normal_pose_update = Some(std::time::Instant::now() + std::time::Duration::from_millis(200));
                publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
            }
            Event::WindowEvent {
                event: WindowEvent::Moved(position),
                ..
            } => {
                normal_pose_update = Some(std::time::Instant::now() + std::time::Duration::from_millis(200));
                let _ = webview.evaluate_script(&format!(
                    "window.__companionPopout?.moved({});",
                    json!({"x":position.x,"y":position.y})
                ));
                publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if window.fullscreen().is_some() {
                    return_after_fullscreen = true;
                    window.set_fullscreen(None);
                } else {
                    let _ = webview.evaluate_script("window.__companionPopout?.dock();");
                }
            }
            _ => {}
        }
        let current_window_state = (macos::maximized(&window), window.is_minimized(), window.fullscreen().is_some());
        if current_window_state != last_window_state {
            last_window_state = current_window_state;
            publish_window_controls(&webview, &window, normal_window_pose, window_hidden);
        }
        if return_after_fullscreen && window.fullscreen().is_none() {
            return_after_fullscreen = false;
            let _ = webview.evaluate_script("window.__companionPopout?.dock();");
        }
        if window.fullscreen().is_none() && let Some(message) = deferred_return.take() {
            let _ = event_loop_proxy.send_event(message);
        }
        if !matches!(*control, ControlFlow::Exit)
            && let Some(active) = &gesture
        {
            if active.update(&window, &backdrop) {
                *control = ControlFlow::WaitUntil(
                    std::time::Instant::now() + std::time::Duration::from_millis(16),
                );
            } else {
                gesture = None;
                keep_on_screen(&window);
                let _ = webview
                    .evaluate_script("window.__companionFloatingPanel?.nativeGestureEnded();");
            }
        }
        if !matches!(*control, ControlFlow::Exit)
            && let Some(transition) = &mut window_transition
        {
            let now = std::time::Instant::now();
            if now < next_motion_frame {
                *control = ControlFlow::WaitUntil(next_motion_frame);
                return;
            }
            next_motion_frame = now + std::time::Duration::from_millis(16);
            let (pose, finished, bend) = transition.frame(now);
            let motion = transition.motion;
            let current_bend = bend;
            motion_pose = Some(pose);
            let use_warp = (transition.spatial || (motion == Motion::Close && motion_pose.is_some()))
                && warp.as_ref().is_some_and(|w| w.available());
            if use_warp {
                if let Some(warp) = &mut warp { warp.apply(macos::warp_rect(pose), warp_source, current_bend); }
                macos::set_window_alpha(&window, pose.alpha);
                if warp.as_ref().is_some_and(|w| !w.available()) { macos::apply_pose(&window, pose, &backdrop); }
            } else { macos::apply_pose(&window, pose, &backdrop); }
            // 已在来源位置接住第一帧即可撤走内嵌，不必等整段移动完成。
            if motion == Motion::Enter && !presentation_reported && pose.alpha >= 0.55 {
                presentation_reported = true;
                let _ = webview.evaluate_script("window.__companionPopout?.presented();");
            }
            if finished {
                if motion != Motion::Return || !use_warp {
                    if let Some(warp) = &mut warp { warp.reset(); }
                    if motion != Motion::Close { macos::apply_pose(&window, pose, &backdrop); }
                    motion_pose = None;
                }
                let status = warp.as_ref().map_or(json!({"supported":false}), |warp| warp.status());
                let _ = webview.evaluate_script(&format!("window.__companionNativeWarp = {status};"));
                held_return = if motion == Motion::Return { window_transition.take() } else { None };
                window_transition = None;
                match motion {
                    Motion::Close => *control = ControlFlow::Exit,
                    Motion::Return => { let _ = webview.evaluate_script("window.__companionPopout?.returned(true);"); }
                    Motion::Enter | Motion::Recover => {
                        let _ = webview.evaluate_script("window.__companionPopout?.motionFinished();");
                    }
                }
            } else {
                *control = ControlFlow::WaitUntil(
                    std::time::Instant::now() + std::time::Duration::from_millis(16),
                );
            }
        }
        let enabled = window_transition.is_none() && return_origin.is_none() && gesture.is_none();
        if controls_enabled != enabled {
            controls_enabled = enabled;
            macos::enable_window_controls(&window, enabled);
        }
        if let Some(deadline) = normal_pose_update {
            if std::time::Instant::now() >= deadline {
                normal_pose_update = None;
                // 系统 zoom 会逐步改变 frame；只在几何稳定后接纳普通尺寸。
                if enabled && !macos::maximized(&window) && !window.is_minimized() {
                    normal_window_pose = Some(macos::pose(&window));
                }
            } else if !matches!(*control, ControlFlow::Exit) {
                let next = match *control { ControlFlow::WaitUntil(next) => next.min(deadline), _ => deadline };
                *control = ControlFlow::WaitUntil(next);
            }
        }
    })
}

fn keep_on_screen(window: &Window) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let size = window.outer_size();
    let monitor = window
        .available_monitors()
        .find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            position.x >= origin.x
                && position.x < origin.x + size.width as i32
                && position.y >= origin.y
                && position.y < origin.y + size.height as i32
        })
        .or_else(|| window.primary_monitor());
    if let Some(monitor) = monitor {
        let origin = monitor.position();
        let bounds = monitor.size();
        let x = position.x.clamp(
            origin.x,
            (origin.x + bounds.width as i32 - size.width as i32).max(origin.x),
        );
        let y = position.y.clamp(
            origin.y + 48,
            (origin.y + bounds.height as i32 - size.height as i32 - 24).max(origin.y + 48),
        );
        if position.x != x || position.y != y {
            window.set_outer_position(PhysicalPosition::new(x, y));
        }
    }
}

#[cfg(test)]
mod motion_tests {
    use super::*;

    #[test]
    fn anchors_can_cross_screens_but_not_target_disconnected_displays() {
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        let rect = |x, y, w, h| NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
        let primary = rect(0., 0., 2048., 1152.);
        let source = rect(300., 600., 404., 376.);
        for (x, y) in [(171., -1155.), (-1539., 0.), (0., 1152.), (2048., 0.)] {
            let secondary = rect(x, y, 1539., 1155.);
            let target = rect(x + 100., y + 100., 428., 649.);
            assert!(macos::anchor_on_displays(
                &[primary, secondary],
                source,
                target
            ));
            assert!(macos::anchor_on_displays(
                &[primary, secondary],
                target,
                source
            ));
            assert!(!macos::anchor_on_displays(&[primary], source, target));
            assert!(!macos::anchor_on_displays(&[primary], target, source));
        }
    }

    #[test]
    fn spatial_entry_reverses_return_without_a_hidden_or_held_start() {
        for (width, height) in [(108., 70.), (428., 400.)] {
            let source = Pose {
                x: 300.,
                y: 400.,
                width,
                height,
                scale: 0.98,
                alpha: 1.,
            };
            let destination = Pose {
                x: 700.,
                y: 200.,
                width: 428.,
                height: 649.,
                scale: 1.,
                alpha: 1.,
            };
            let returning = WindowTransition::new(destination, source, Motion::Return, true);
            let entering = WindowTransition::new(
                Pose {
                    alpha: 0.,
                    ..source
                },
                destination,
                Motion::Enter,
                true,
            );
            for step in 0..=16 {
                let t = f64::from(step) / 16.;
                let enter_time = entering.started + entering.duration.mul_f64(t);
                let return_time = returning.started + returning.duration.mul_f64(1. - t);
                let (entry, _) = entering.value(enter_time);
                let (exit, _) = returning.value(return_time);
                for (a, b) in [
                    (entry.x, exit.x),
                    (entry.y, exit.y),
                    (entry.width, exit.width),
                    (entry.height, exit.height),
                    (entry.scale, exit.scale),
                ] {
                    assert!((a - b).abs() < 1e-8);
                }
                assert_eq!(entry.alpha, 1.);
                for (a, b) in entering
                    .bend(enter_time)
                    .into_iter()
                    .zip(returning.bend(return_time))
                {
                    assert!((a - b).abs() < 1e-8);
                }
                if step > 0 {
                    assert!(entry.x > source.x);
                }
                if step < 16 {
                    assert!(entry.height < destination.height);
                }
            }
        }
    }

    #[test]
    fn lift_starts_visible_at_source_and_finishes_at_rest() {
        let from = Pose {
            x: 300.,
            y: 400.,
            width: 428.,
            height: 400.,
            scale: 0.98,
            alpha: 0.,
        };
        let to = Pose {
            x: 700.,
            y: 200.,
            width: 428.,
            height: 649.,
            scale: 1.,
            alpha: 1.,
        };
        let motion = WindowTransition::new(from, to, Motion::Enter, true);
        let (handoff, _) = motion.value(motion.started + std::time::Duration::from_millis(50));
        assert!(handoff.alpha >= 0.55);
        let (first, _) = motion.value(motion.started);
        assert_eq!(first.x, from.x);
        assert_eq!(first.height, from.height);
        assert_eq!(first.alpha, 1.);
        assert!(handoff.x > from.x && handoff.height > from.height);
        let (last, finished) = motion.value(motion.started + motion.duration);
        assert!(finished);
        assert_eq!(last.x, to.x);
        assert!((last.y - to.y).abs() < 1e-9);
        assert_eq!(last.height, to.height);
        assert_eq!(last.scale, 1.);
        assert_eq!(last.alpha, 1.);
        let mut close = WindowTransition::new(to, Pose { alpha: 0., ..to }, Motion::Close, false);
        let (first, finished, _) =
            close.frame(close.started + std::time::Duration::from_millis(250));
        assert!(!finished && first.alpha > 0. && first.alpha < 1.);
    }

    #[test]
    fn reversing_a_return_starts_at_its_current_pose() {
        let from = Pose {
            x: 700.,
            y: 200.,
            width: 428.,
            height: 649.,
            scale: 1.,
            alpha: 1.,
        };
        let to = Pose {
            x: 300.,
            y: 400.,
            width: 428.,
            height: 400.,
            scale: 0.98,
            alpha: 1.,
        };
        let mut motion = WindowTransition::new(from, to, Motion::Return, true);
        let time = motion.started + std::time::Duration::from_millis(100);
        motion.last_frame = time;
        let (current, _, bend) = motion.frame(time);
        let reversed = motion.reverse(Motion::Recover);
        assert_eq!(reversed.bend(reversed.started), bend);
        let (first, _) = reversed.value(reversed.started);
        assert_eq!(first.x, current.x);
        assert_eq!(first.y, current.y);
        assert_eq!(first.height, current.height);
        assert_eq!(first.scale, current.scale);
        assert_eq!(first.alpha, 1.);
        let (end, finished) = reversed.value(reversed.started + reversed.duration);
        assert!(finished);
        assert_eq!(end.x, from.x);
        assert_eq!(end.height, from.height);
    }

    #[test]
    fn interrupted_entry_and_completed_return_keep_the_same_path() {
        let source = Pose {
            x: 200.,
            y: 300.,
            scale: 0.98,
            width: 420.,
            height: 400.,
            alpha: 1.,
        };
        let desktop = Pose {
            x: 800.,
            y: 100.,
            scale: 1.,
            width: 680.,
            height: 700.,
            alpha: 1.,
        };
        let mut entry = WindowTransition::new(source, desktop, Motion::Enter, true);
        let time = entry.started + entry.duration.mul_f64(0.4);
        entry.last_frame = time;
        let (visible, _, bend) = entry.frame(time);
        let mut returning = entry.reverse(Motion::Return);
        let (first, _) = returning.value(returning.started);
        assert_eq!(first.x, visible.x);
        assert_eq!(first.y, visible.y);
        assert_eq!(returning.bend(returning.started), bend);
        assert_eq!(returning.duration.as_millis(), 104);
        let end = returning.started + returning.duration;
        returning.last_frame = end;
        let (arrived, finished, _) = returning.frame(end);
        assert!(finished);
        assert_eq!(arrived.x, source.x);
        let recover = returning.reverse(Motion::Recover);
        assert_eq!(recover.value(recover.started).0.height, source.height);
        assert_eq!(
            recover.value(recover.started + recover.duration).0.height,
            desktop.height
        );
    }
}
