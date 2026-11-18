// [INPUT]: CDP Client、Config、Model、主界面启动偏好与胶囊状态摘要。
// [OUTPUT]: 独立 Chat 大纲连接/清理及只读来源偏好；App、View、连接与无正文胶囊状态、共享字体与设置界面外观快照；临时响应超时保留会话，确认页面消失后按原选择策略重连；退出信号取消模型请求，开发模式锁定启动窗口；暂停清理或配置保存失败时恢复完整注入，恢复失败则重建连接。
// [POS]: 持有独立 tasks 服务； 后台业务状态层，为 server、requests 与 panel 提供一致状态；独立维护模型控制条服务及窗口监督。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use crate::{
    cdp::{Client, Target},
    config::{Config, Paths},
    model::{Model, ModelInfo},
};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Notify, RwLock, watch};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    #[serde(default)]
    pub page_kind: Option<String>,
    pub has_answer: bool,
    pub headings: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub status: String,
    pub message: String,
    pub endpoint: Option<String>,
    pub target_id: Option<String>,
    pub targets: Vec<Target>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub version: String,
    pub connection: Connection,
    pub desktop: DesktopStatus,
    pub model: ModelInfo,
    pub updated_at: u64,
    pub configuration_revision: u64,
    pub panel_preferences: crate::panel::Preferences,
    pub panel_theme: Option<String>,
    pub panel_font_base: f64,
    pub panel_colors: Value,
    pub panel_typography: Value,
    pub settings_appearance: Value,
}

#[derive(Clone)]
struct Session {
    client: Arc<Client>,
}

#[derive(Clone)]
struct Desired {
    endpoint: Option<String>,
    target_id: Option<String>,
    enabled: bool,
}

pub struct App {
    pub(crate) web_library: Arc<crate::web_library::Library>,
    pub(crate) model_requests: crate::model_requests::Requests,
    pub(crate) performance: Mutex<crate::performance::Monitor>,
    pub(crate) surfaces: Mutex<crate::surfaces::Surfaces>,
    pub(crate) chat_outline: Mutex<crate::chat_outline::Connections>,
    pub(crate) features: Mutex<crate::features::Features>,
    pub(crate) feature_operation: Mutex<()>,
    pub(crate) codex_host_operation: Mutex<()>,
    pub(crate) terminology_operation: Mutex<()>,
    pub(crate) terminology_import_changed: tokio::sync::Notify,
    pub tasks: Arc<crate::tasks::Service>,
    pub views: watch::Sender<View>,
    pub shutdown: Notify,
    pub closing: watch::Sender<bool>,
    pub paths: Paths,
    pub(crate) panel: Mutex<crate::panel::Panel>,
    pub(crate) model_control: Mutex<crate::model_control::Control>,
    pub(crate) model: RwLock<Model>,
    pub(crate) config: Mutex<Config>,
    pub(crate) settings_revision: std::sync::atomic::AtomicU64,
    pub(crate) generation_revision: std::sync::atomic::AtomicU64,
    session: RwLock<Option<Session>>,
    desired: RwLock<Desired>,
    pub(crate) transition: Mutex<()>,
    allow_fixture: bool,
}

impl App {
    pub fn new(
        paths: Paths,
        config: Config,
        endpoint: Option<String>,
        allow_fixture: bool,
    ) -> Arc<Self> {
        let desired = Desired {
            endpoint: endpoint.clone().or(config.cdp_endpoint.clone()),
            target_id: if endpoint.is_some() {
                None
            } else {
                config.target_id.clone()
            },
            enabled: config.performance.integration_enabled,
        };
        let model = Model::load(&config)
            .with_key(paths.load_key().ok().flatten())
            .with_jev_key(paths.load_named_key("jevApiKey").ok().flatten());
        let tasks = crate::tasks::Service::load(&paths);
        let model_control = crate::model_control::Control::load(&paths);
        let mut panel = crate::panel::Panel::load(&paths, allow_fixture);
        let mut features = crate::features::Features::load(&paths);
        features.restore_legacy_quick_prompts(model.options.quick_prompts_enabled);
        let web_library = crate::web_library::Library::load(&paths);
        if panel.prefs.startup.mode != "restore" {
            let terms = crate::terminology::library(&paths.root).is_ok_and(|v| !v.is_empty());
            features.apply_startup(
                &mut panel,
                &[
                    ("outline", model.options.answer_outline_enabled),
                    ("next", model.options.enabled),
                    ("prompts", model.options.quick_prompts_enabled),
                    ("bots", model.options.grokbot_enabled),
                    ("sites", web_library.enabled()),
                    (
                        "board",
                        tasks
                            .inner
                            .try_lock()
                            .is_ok_and(|inner| inner.store.board_enabled),
                    ),
                    ("model", model_control.preferences.enabled),
                    ("terms", terms),
                ],
            );
        }
        let (views, _) = watch::channel(View {
            version: crate::config::VERSION.into(),
            connection: Connection {
                status: "disconnected".into(),
                message: if desired.enabled {
                    "正在寻找桌面 Codex…"
                } else {
                    "Codex 集成已暂停，可在性能设置中重新开启。"
                }
                .into(),
                endpoint: desired.endpoint.clone(),
                target_id: None,
                targets: Vec::new(),
            },
            desktop: DesktopStatus::default(),
            model: model.info(),
            updated_at: now(),
            configuration_revision: 1,
            panel_preferences: panel.prefs.clone(),
            panel_theme: None,
            panel_font_base: 13.,
            panel_colors: json!({}),
            panel_typography: Value::Null,
            settings_appearance: Value::Null,
        });
        Arc::new(Self {
            web_library,
            performance: Mutex::new(crate::performance::Monitor::default()),
            surfaces: Mutex::new(crate::surfaces::Surfaces::load(&paths)),
            features: Mutex::new(features),
            feature_operation: Mutex::new(()),
            codex_host_operation: Mutex::new(()),
            terminology_operation: Mutex::new(()),
            terminology_import_changed: tokio::sync::Notify::new(),
            model_requests: Default::default(),
            tasks,
            views,
            shutdown: Notify::new(),
            closing: watch::channel(false).0,
            chat_outline: Mutex::new(crate::chat_outline::Connections::default()),
            panel: Mutex::new(panel),
            model_control: Mutex::new(model_control),
            paths,
            desired: RwLock::new(desired),
            model: RwLock::new(model),
            settings_revision: std::sync::atomic::AtomicU64::new(1),
            generation_revision: std::sync::atomic::AtomicU64::new(1),
            config: Mutex::new(config),
            session: RwLock::new(None),
            transition: Mutex::new(()),
            allow_fixture,
        })
    }

    pub(crate) async fn until_shutdown<T>(
        &self,
        request: impl std::future::Future<Output = Result<T>>,
    ) -> Result<T> {
        let mut closing = self.closing.subscribe();
        tokio::select! {
            biased;
            _ = closing.wait_for(|value| *value) => anyhow::bail!("服务正在退出，请求已取消"),
            result = request => result,
        }
    }

    pub fn view(&self) -> View {
        self.views.borrow().clone()
    }

    pub fn supervise(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(750));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut attempts = 0;
            loop {
                interval.tick().await;
                self.supervise_features().await;
                self.supervise_panel().await;
                let prefs = self.appearance().await;
                self.views.send_if_modified(|view| {
                    if view.panel_preferences == prefs {
                        return false;
                    }
                    view.panel_preferences = prefs;
                    true
                });
                let session = self.session.read().await.clone();
                if session.is_some() {
                    let guard = self.transition.lock().await;
                    if self.desktop_client().await.is_some()
                        && let Err(error) = self.refresh().await
                    {
                        self.handle_refresh_failure(&error).await;
                    }
                    drop(guard);
                } else {
                    attempts += 1;
                    if attempts % 4 == 1 && self.desired.read().await.enabled {
                        let _guard = self.transition.lock().await;
                        let desired = self.desired.read().await.clone();
                        if !desired.enabled
                            || self
                                .session
                                .read()
                                .await
                                .as_ref()
                                .is_some_and(|s| !s.client.is_closed())
                        {
                            continue;
                        }
                        if let Err(error) = self.establish(&desired).await {
                            tracing::debug!(error = %error, "宿主连接建立失败");
                            self.update_connection(
                                "disconnected",
                                "未发现可连接的 Codex。请通过调试启动入口打开，或指定本机端口。",
                            );
                        }
                    }
                }
            }
        })
    }

    fn update_connection(&self, status: &str, message: &str) {
        self.views.send_if_modified(|view| {
            if view.connection.status == status && view.connection.message == message {
                return false;
            }
            view.connection.status = status.into();
            view.connection.message = message.into();
            view.updated_at = now();
            true
        });
    }

    async fn handle_refresh_failure(&self, error: &anyhow::Error) {
        tracing::debug!(%error, "宿主状态刷新失败");
        if error.is::<tokio::time::error::Elapsed>()
            && let Some(client) = self.desktop_client().await
            && !client.is_closed()
        {
            let connection = self.view().connection;
            // The old WebSocket can remain open after the renderer replaces its page.
            let target_gone = if let (Some(endpoint), Some(id)) = (
                connection.endpoint.as_deref(),
                connection.target_id.as_deref(),
            ) {
                crate::cdp::discover_all(endpoint)
                    .await
                    .is_ok_and(|targets| targets.iter().all(|target| target.id != id))
            } else {
                false
            };
            if target_gone {
                client.mark_target_gone();
            } else if !client.is_closed() {
                self.update_connection(
                    "unresponsive",
                    "Codex 页面暂未响应，保留当前界面并等待恢复…",
                );
                return;
            }
        }
        self.clear_connection("disconnected", "Codex 连接中断，正在重连…")
            .await;
    }

    async fn establish(self: &Arc<Self>, desired: &Desired) -> Result<()> {
        let pinned = self.allow_fixture
            || crate::assets::development().is_some()
            || desired.target_id.is_some();
        let endpoints = crate::host::endpoints(desired.endpoint.as_deref(), pinned)?;
        let mut found = None;
        for endpoint in endpoints {
            if let Ok(targets) = crate::cdp::discover(&endpoint, self.allow_fixture).await
                && !targets.is_empty()
            {
                found = Some((endpoint, targets));
                break;
            }
        }
        let (endpoint, targets) = found.context("没有发现可连接的 Codex 窗口")?;
        let target = if let Some(id) = &desired.target_id {
            targets
                .iter()
                .find(|target| &target.id == id)
                .context("所选 Codex 窗口已关闭，请重新选择窗口")?
        } else {
            &targets[0]
        };
        let client = Client::connect(&target.web_socket_debugger_url).await?;
        self.save_connection_target(&endpoint, &desired.target_id)
            .await?;
        let session = Session {
            client: client.clone(),
        };
        *self.session.write().await = Some(session);
        if let Err(error) = client.install_desktop(Arc::downgrade(self)).await {
            self.clear_connection("disconnected", "桌面浮窗安装失败，正在等待重连…")
                .await;
            return Err(error);
        }
        self.views.send_modify(|view| {
            view.connection = Connection {
                status: "connected".into(),
                message: "已连接桌面 Codex".into(),
                endpoint: Some(endpoint),
                target_id: Some(target.id.clone()),
                targets: targets.clone(),
            };
            view.desktop = DesktopStatus::default();
            view.updated_at = now();
        });
        Ok(())
    }

    async fn save_connection_target(
        &self,
        endpoint: &str,
        target_id: &Option<String>,
    ) -> Result<()> {
        let mut config = self.config.lock().await;
        if config.cdp_endpoint.as_deref() != Some(endpoint) || &config.target_id != target_id {
            let mut next = config.clone();
            next.cdp_endpoint = Some(endpoint.into());
            next.target_id = target_id.clone();
            self.paths.save(&next)?;
            *config = next;
        }
        Ok(())
    }

    pub async fn connect(
        self: &Arc<Self>,
        endpoint: Option<String>,
        target_id: Option<String>,
    ) -> Result<()> {
        let endpoint = endpoint
            .filter(|value| !value.trim().is_empty())
            .map(|value| crate::config::local_endpoint(&value))
            .transpose()?;
        if crate::assets::development().is_some() {
            let desired = self.desired.read().await;
            if endpoint != desired.endpoint || target_id != desired.target_id {
                anyhow::bail!("开发模式锁定启动时的真实窗口；切换窗口请退出后用 --target 重启。");
            }
        }
        let _guard = self.transition.lock().await;
        // Automatic startup may have connected while this request waited for the lock.
        // Reuse only a live session for the same requested target; never tear it down twice.
        let desired = self.desired.read().await;
        let connection = self.view().connection;
        let desired_endpoint = desired
            .endpoint
            .as_deref()
            .and_then(|value| crate::config::local_endpoint(value).ok());
        let connected_endpoint = connection
            .endpoint
            .as_deref()
            .and_then(|value| crate::config::local_endpoint(value).ok());
        let same_target = ((desired.endpoint.is_none() || desired_endpoint.is_some())
            && desired_endpoint == endpoint
            && desired.target_id == target_id)
            || (endpoint.is_some()
                && target_id.is_some()
                && connected_endpoint == endpoint
                && connection.target_id == target_id);
        if desired.enabled
            && same_target
            && connection.status == "connected"
            && self
                .session
                .read()
                .await
                .as_ref()
                .is_some_and(|s| !s.client.is_closed())
        {
            drop(desired);
            if let Some(connected_endpoint) = connected_endpoint {
                self.save_connection_target(&connected_endpoint, &target_id)
                    .await?;
            }
            *self.desired.write().await = Desired {
                endpoint,
                target_id,
                enabled: true,
            };
            return Ok(());
        }
        drop(desired);
        {
            let mut config = self.config.lock().await;
            if !config.performance.integration_enabled {
                let mut next = config.clone();
                next.performance.integration_enabled = true;
                next.performance.revision += 1;
                self.paths.save(&next)?;
                *config = next;
            }
        }
        self.clear_connection("connecting", "正在连接桌面 Codex…")
            .await;
        let desired = Desired {
            endpoint,
            target_id,
            enabled: true,
        };
        *self.desired.write().await = desired.clone();
        match self.establish(&desired).await {
            Ok(()) => Ok(()),
            Err(error) => {
                self.update_connection("disconnected", "连接失败，请检查调试端口和 Codex 窗口。");
                Err(error)
            }
        }
    }

    pub(crate) async fn chat_outline_source(&self) -> Option<(String, String)> {
        if *self.closing.borrow()
            || !self.desired.read().await.enabled
            || !self.model.read().await.options.answer_outline_enabled
            || self
                .session
                .read()
                .await
                .as_ref()
                .is_none_or(|s| s.client.is_closed())
        {
            return None;
        }
        Some((
            self.view().connection.endpoint?,
            self.appearance().await.language,
        ))
    }

    async fn clear_connection(&self, status: &str, message: &str) {
        let old = self.session.write().await.take();
        if let Some(old) = old {
            old.client.close().await;
        }
        self.chat_outline.lock().await.clear().await;
        self.views.send_modify(|view| {
            view.connection.status = status.into();
            view.connection.message = message.into();
            view.connection.target_id = None;
            view.desktop = DesktopStatus::default();
            view.updated_at = now();
        });
    }

    pub async fn host_page_allowed(&self) -> bool {
        let kind = self.view().desktop.page_kind;
        let ui = self.appearance().await.ui;
        match kind.as_deref() {
            Some("new-chat") => ui.sidebar_new_chat,
            Some("dots") => ui.sidebar_dots,
            _ => true,
        }
    }

    pub async fn disconnect(&self) {
        let _guard = self.transition.lock().await;
        self.desired.write().await.enabled = false;
        self.clear_connection("disconnected", "已断开连接，点击连接可继续。")
            .await;
    }

    pub(crate) async fn update_performance(
        self: &Arc<Self>,
        patch: crate::performance::Update,
    ) -> Result<Value> {
        let _guard = self.transition.lock().await;
        let previous = self.config.lock().await.performance.clone();
        anyhow::ensure!(
            patch.expected_revision == previous.revision,
            "性能设置已在其他窗口更新，请重新读取后再保存"
        );
        let mut preferences = previous.clone();
        if let Some(value) = patch.integration_enabled {
            preferences.integration_enabled = value;
        }
        if let Some(value) = patch.monitoring_enabled {
            preferences.monitoring_enabled = value;
        }
        if preferences == previous {
            return Ok(self.performance_state(false).await);
        }
        let mut suspended = None;
        if previous.integration_enabled
            && !preferences.integration_enabled
            && let Some(client) = self.desktop_client().await
        {
            let ready = client.evaluate("(async()=>{if(window.__buddyFeatureFlush && !(await window.__buddyFeatureFlush())) return false; return true})()".into()).await?;
            anyhow::ensure!(
                ready == true,
                "工作台正在编辑或交接，请稍后关闭连接；当前草稿已保留"
            );
            if let Err(error) = client.suspend_desktop().await {
                self.restore_failed_pause(&client).await;
                return Err(error);
            }
            suspended = Some(client);
        }
        preferences.revision += 1;
        {
            let mut config = self.config.lock().await;
            let mut next = config.clone();
            next.performance = preferences.clone();
            if let Err(error) = self.paths.save(&next) {
                drop(config);
                if let Some(client) = suspended {
                    self.restore_failed_pause(&client).await;
                }
                return Err(error);
            }
            *config = next;
        }
        self.desired.write().await.enabled = preferences.integration_enabled;
        let mut connection_error = None;
        if !preferences.integration_enabled {
            self.clear_connection("disconnected", "Codex 集成已暂停；设置和独立提醒事项同步保留。重新开启即可连接。仍可使用独立窗口中的本地任务。") .await;
        } else if !previous.integration_enabled {
            let desired = self.desired.read().await.clone();
            if let Err(error) = self.establish(&desired).await {
                connection_error = Some(error.to_string());
                self.update_connection("disconnected", "已开启集成，正在等待原 Codex 窗口连接。");
            }
        }
        if !preferences.monitoring_enabled {
            *self.performance.lock().await = crate::performance::Monitor::default();
            if let Some(client) = self.desktop_client().await {
                let _ = client
                    .evaluate("window.__companionFloatingPanel?.stopPerformance?.(); true".into())
                    .await;
            }
        }
        let mut result = self.performance_state(false).await;
        if let Some(error) = connection_error {
            result["connectionError"] = json!(error);
        }
        Ok(result)
    }

    async fn restore_failed_pause(&self, client: &Client) {
        if client.restore_desktop().await.is_err() {
            // 保留原启用意愿；不把残缺注入报告为已连接，由监督循环重新建立完整连接。
            self.clear_connection("disconnected", "暂停未完成，正在恢复原 Codex 连接…")
                .await;
        }
    }

    pub(crate) async fn sync_desktop_settings(&self, settings: &Value) {
        let session = self.session.read().await.clone();
        if let Some(session) = session {
            let _ = session
                .client
                .evaluate(format!(
                    "window.__companionFloatingPanel?.syncSettings({settings}); true"
                ))
                .await;
        }
    }

    pub(crate) async fn desktop_client(&self) -> Option<Arc<Client>> {
        self.session
            .read()
            .await
            .as_ref()
            .map(|session| session.client.clone())
    }

    async fn refresh(&self) -> Result<()> {
        let client = self.desktop_client().await.context("尚未连接 Codex")?;
        let (detached, ui, revision, web_revision) = self.panel_host_state().await;
        let preferences = self.panel.lock().await.prefs.clone();
        let launcher_action = json!({"action":preferences.launcher_action,"doubleAction":preferences.launcher_double_action,"contextAction":preferences.launcher_context_action,"language":preferences.language,"systemLanguage":crate::i18n::system_locale(),"restoreSavedUi":revision > 0});
        let mut typography = json!(preferences.typography);
        typography["surfaces"] = json!(preferences.surface_typography);
        let result = client
            .desktop_status(detached, ui, web_revision, launcher_action, typography)
            .await?;
        self.observe_panel_ui(revision, result["ui"].clone())
            .await?;
        let desktop = serde_json::from_value(result["desktop"].clone())?;
        let theme = result["theme"].as_str().map(String::from);
        let colors = result["colors"].clone();
        let font_base = result["fontBase"].as_f64().unwrap_or(13.);
        let typography = result["typography"].clone();
        let settings_appearance = result["settingsAppearance"].clone();
        self.views.send_if_modified(|view| {
            if view.desktop == desktop
                && view.panel_theme == theme
                && view.panel_font_base == font_base
                && view.panel_colors == colors
                && (!typography.is_object() || view.panel_typography == typography)
                && (!settings_appearance.is_object()
                    || view.settings_appearance == settings_appearance)
                && view.connection.status == "connected"
            {
                return false;
            }
            view.desktop = desktop;
            view.panel_theme = theme;
            view.panel_font_base = font_base;
            view.panel_colors = colors;
            if typography.is_object() {
                view.panel_typography = typography;
            }
            if settings_appearance.is_object() {
                view.settings_appearance = settings_appearance;
            }
            view.connection.status = "connected".into();
            view.connection.message = "已连接桌面 Codex".into();
            view.updated_at = now();
            true
        });
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod connection_tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    #[tokio::test]
    async fn waiting_connect_reuses_the_session_established_while_it_was_queued() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (finish, finished) = tokio::sync::oneshot::channel();
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            tokio::select! {
                _ = finished => {},
                message = socket.next() => panic!("live session was touched by a duplicate connect: {message:?}"),
            }
        });
        let client = Client::connect(&format!("ws://{address}")).await.unwrap();
        let guard = app.transition.lock().await;
        let endpoint = format!("http://{address}");
        let pending = tokio::spawn({
            let app = app.clone();
            let endpoint = endpoint.clone();
            async move {
                app.connect(Some(endpoint), Some("synthetic-target".into()))
                    .await
            }
        });
        tokio::task::yield_now().await;
        *app.desired.write().await = Desired {
            endpoint: Some("obsolete invalid saved endpoint".into()),
            target_id: None,
            enabled: true,
        };
        *app.session.write().await = Some(Session {
            client: client.clone(),
        });
        app.views.send_modify(|v| {
            v.connection.status = "connected".into();
            v.connection.endpoint = Some(address.port().to_string());
            v.connection.target_id = Some("synthetic-target".into());
        });
        drop(guard);
        tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(Arc::ptr_eq(&app.desktop_client().await.unwrap(), &client));
        assert!(!client.is_closed());
        assert!(
            app.connect(Some("https://example.invalid:9999".into()), None)
                .await
                .is_err()
        );
        assert!(Arc::ptr_eq(&app.desktop_client().await.unwrap(), &client));
        assert_eq!(
            app.desired.read().await.target_id.as_deref(),
            Some("synthetic-target")
        );
        assert_eq!(
            app.paths.load().unwrap().target_id.as_deref(),
            Some("synthetic-target")
        );
        finish.send(()).unwrap();
        peer.await.unwrap();
    }

    #[tokio::test]
    async fn failed_pause_restores_all_scripts_or_releases_the_session() {
        for (fail_restore, fail_cleanup) in [(false, false), (true, false), (false, true)] {
            let temp = tempfile::tempdir().unwrap();
            let paths = Paths::new(Some(temp.path().into())).unwrap();
            let config = Config::default();
            paths.save(&config).unwrap();
            let app = App::new(paths.clone(), config, None, true);
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("ws://{}", listener.local_addr().unwrap());
            let installs = Arc::new(std::sync::Mutex::new(Vec::new()));
            let observed = installs.clone();
            let replies = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let observed_replies = replies.clone();
            let peer = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                let mut count = 0;
                let mut cleanup_failed = false;
                while let Some(Ok(message)) = socket.next().await {
                    if !message.is_text() {
                        break;
                    }
                    let request: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    if fail_cleanup
                        && !cleanup_failed
                        && request["method"] == "Page.removeScriptToEvaluateOnNewDocument"
                    {
                        cleanup_failed = true;
                        socket.send(Message::Text(json!({"id":request["id"],"error":{"message":"synthetic cleanup failure"}}).to_string().into())).await.unwrap();
                        continue;
                    }
                    if request["method"] == "Runtime.evaluate" {
                        let expression = request["params"]["expression"].as_str().unwrap_or("");
                        if expression == "synthetic post-restore binding probe" {
                            socket.send(Message::Text(json!({"method":"Runtime.bindingCalled","params":{"name":"__companionHostRequest","executionContextId":7,"payload":json!({"id":"after-restore","path":"/stepwise/settings"}).to_string()}}).to_string().into())).await.unwrap();
                        }
                        if expression.starts_with("window.__companionDesktop?.complete(") {
                            observed_replies.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        }
                    }
                    let result = if request["method"] == "Page.addScriptToEvaluateOnNewDocument" {
                        count += 1;
                        let kind = if request["params"]["source"]
                            .as_str()
                            .is_some_and(|source| source.contains(crate::cdp::PANEL_SCRIPT))
                        {
                            "panel"
                        } else {
                            "model"
                        };
                        observed.lock().unwrap().push(kind);
                        if fail_restore && count > 2 {
                            socket.send(Message::Text(json!({"id":request["id"],"error":{"message":"synthetic restore failure"}}).to_string().into())).await.unwrap();
                            continue;
                        }
                        json!({"identifier":count.to_string()})
                    } else if request["method"] == "Runtime.evaluate" {
                        json!({"result":{"value":true}})
                    } else {
                        json!({})
                    };
                    socket
                        .send(Message::Text(
                            json!({"id":request["id"],"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                }
            });
            let client = Client::connect(&endpoint).await.unwrap();
            *app.session.write().await = Some(Session {
                client: client.clone(),
            });
            client.install_desktop(Arc::downgrade(&app)).await.unwrap();
            app.views
                .send_modify(|view| view.connection.status = "connected".into());
            // A directory at the atomic-save destination forces a real filesystem failure.
            std::fs::remove_file(paths.config()).unwrap();
            std::fs::create_dir(paths.config()).unwrap();
            let result = app
                .update_performance(crate::performance::Update {
                    expected_revision: 0,
                    integration_enabled: Some(false),
                    monitoring_enabled: None,
                })
                .await;
            assert!(result.is_err());
            assert!(app.config.lock().await.performance.integration_enabled);
            assert_eq!(app.config.lock().await.performance.revision, 0);
            assert!(app.desired.read().await.enabled);
            if fail_restore {
                assert!(app.desktop_client().await.is_none());
                assert_eq!(app.view().connection.status, "disconnected");
            } else {
                assert!(Arc::ptr_eq(&app.desktop_client().await.unwrap(), &client));
                assert_eq!(
                    *installs.lock().unwrap(),
                    vec!["model", "panel", "model", "panel"]
                );
                assert_eq!(app.view().connection.status, "connected");
                client
                    .evaluate("synthetic post-restore binding probe".into())
                    .await
                    .unwrap();
                tokio::time::timeout(Duration::from_secs(2), async {
                    while replies.load(std::sync::atomic::Ordering::SeqCst) == 0 {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                assert_eq!(replies.load(std::sync::atomic::Ordering::SeqCst), 1);
            }
            app.disconnect().await;
            tokio::time::timeout(Duration::from_secs(2), peer)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test]
    async fn integration_pause_persists_without_touching_feature_data_and_monitoring_is_opt_in() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(Some(temp.path().into())).unwrap();
        let config = Config::default();
        paths.save(&config).unwrap();
        let app = App::new(paths.clone(), config, None, true);
        let state = app.performance_state(true).await;
        assert!(state["sample"].is_null());
        let feature_before = app.feature_state().await;
        let paused = app
            .update_performance(crate::performance::Update {
                expected_revision: 0,
                integration_enabled: Some(false),
                monitoring_enabled: None,
            })
            .await
            .unwrap();
        assert_eq!(paused["preferences"]["integrationEnabled"], false);
        assert!(!app.desired.read().await.enabled);
        assert!(!paths.load().unwrap().performance.integration_enabled);
        assert_eq!(feature_before, app.feature_state().await);
        let cold = App::new(paths.clone(), paths.load().unwrap(), None, true);
        assert!(!cold.desired.read().await.enabled);
        assert!(cold.view().connection.message.contains("暂停"));
        assert!(
            app.update_performance(crate::performance::Update {
                expected_revision: 0,
                integration_enabled: Some(true),
                monitoring_enabled: None,
            })
            .await
            .is_err()
        );
        app.update_performance(crate::performance::Update {
            expected_revision: 1,
            integration_enabled: None,
            monitoring_enabled: Some(true),
        })
        .await
        .unwrap();
        let first = app.performance_state(true).await;
        let second = app.performance_state(true).await;
        assert_eq!(
            first["sample"], second["sample"],
            "rapid requests share one sample"
        );
        assert!(first["sample"]["backend"]["cpuPercent"].is_null());
        app.update_performance(crate::performance::Update {
            expected_revision: 2,
            integration_enabled: None,
            monitoring_enabled: Some(false),
        })
        .await
        .unwrap();
        assert!(app.performance_state(true).await["sample"].is_null());
    }

    #[tokio::test]
    async fn response_timeout_preserves_session_then_fresh_reply_restores_status() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        let ui = json!(app.appearance().await.ui);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let (close, closed) = tokio::sync::oneshot::channel();
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let first: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            // The delayed response must be discarded, not mistaken for the next read.
            tokio::time::sleep(Duration::from_millis(100)).await;
            socket
                .send(Message::Text(
                    json!({"id":first["id"],"result":{"result":{"value":"stale"}}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
            let second: Value =
                serde_json::from_str(socket.next().await.unwrap().unwrap().to_text().unwrap())
                    .unwrap();
            assert_eq!(second["method"], "Runtime.evaluate");
            assert!(
                !second["params"]["expression"]
                    .as_str()
                    .unwrap()
                    .contains("destroy()")
            );
            socket.send(Message::Text(json!({"id":second["id"],"result":{"result":{"value":{
                "desktop":{"hasAnswer":true,"headings":4},"ui":ui,"theme":"dark","fontBase":16.,"colors":{}
            }}}}).to_string().into())).await.unwrap();
            let _ = closed.await;
            socket.close(None).await.unwrap();
        });
        let client = Client::connect(&endpoint).await.unwrap();
        *app.session.write().await = Some(Session {
            client: client.clone(),
        });
        app.views.send_modify(|view| {
            view.connection.status = "connected".into();
            view.connection.target_id = Some("synthetic-target".into());
            view.desktop = DesktopStatus {
                page_kind: None,
                has_answer: true,
                headings: 4,
            };
            view.panel_theme = Some("dark".into());
            view.panel_font_base = 16.;
            view.panel_colors = json!({});
        });
        let failure = client
            .evaluate_with_timeout("synthetic slow read".into(), Duration::from_millis(20))
            .await
            .unwrap_err();
        assert!(failure.is::<tokio::time::error::Elapsed>());
        app.handle_refresh_failure(&failure).await;
        assert!(Arc::ptr_eq(&app.desktop_client().await.unwrap(), &client));
        assert!(!client.is_closed());
        assert_eq!(app.view().connection.status, "unresponsive");
        assert_eq!(
            app.view().connection.target_id.as_deref(),
            Some("synthetic-target")
        );
        assert_eq!(app.view().desktop.headings, 4);
        app.refresh().await.unwrap();
        assert_eq!(app.view().connection.status, "connected");
        assert_eq!(app.view().desktop.headings, 4);
        close.send(()).unwrap();
        peer.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while !client.is_closed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        app.handle_refresh_failure(&failure).await;
        assert!(app.desktop_client().await.is_none());
        assert_eq!(app.view().connection.status, "disconnected");
        assert!(app.view().connection.target_id.is_none());
    }

    #[tokio::test]
    async fn response_timeout_releases_a_missing_target_without_waiting_for_cleanup() {
        use std::sync::atomic::{AtomicU8, Ordering};

        let discovery = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", discovery.local_addr().unwrap());
        let old_page = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let old_socket = format!("ws://{}", old_page.local_addr().unwrap());
        let listing = Arc::new(AtomicU8::new(0));
        let list = listing.clone();
        let targets = axum::Router::new().route(
            "/json/list",
            axum::routing::get(move || async move {
                let id = match list.load(Ordering::SeqCst) {
                    0 => "old-page",
                    1 => return Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
                    _ => "replacement-page",
                };
                Ok(axum::Json(json!([{
                    "id":id,"title":"Fixture","type":"page","url":"http://127.0.0.1/fixture",
                    "webSocketDebuggerUrl":old_socket,
                }])))
            }),
        );
        let server = tokio::spawn(async move { axum::serve(discovery, targets).await.unwrap() });
        let peer = tokio::spawn(async move {
            let (stream, _) = old_page.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            loop {
                match socket.next().await.unwrap().unwrap() {
                    Message::Text(text) => {
                        let request: Value = serde_json::from_str(&text).unwrap();
                        if request["params"]["expression"] == "unanswered status read" {
                            continue;
                        }
                        let result = match request["method"].as_str().unwrap() {
                            "Page.addScriptToEvaluateOnNewDocument" => json!({"identifier":"1"}),
                            "Runtime.evaluate" => {
                                assert!(
                                    !request["params"]["expression"]
                                        .as_str()
                                        .unwrap()
                                        .contains("pending?.delete(owner)")
                                );
                                json!({"result":{"value":true}})
                            }
                            "Page.removeScriptToEvaluateOnNewDocument" => {
                                panic!("cleanup on vanished page")
                            }
                            _ => json!({}),
                        };
                        socket
                            .send(Message::Text(
                                json!({"id":request["id"],"result":result})
                                    .to_string()
                                    .into(),
                            ))
                            .await
                            .unwrap();
                    }
                    Message::Close(_) => break,
                    message => panic!("unexpected message: {message:?}"),
                }
            }
        });
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        app.connect(Some(endpoint), None).await.unwrap();
        let old = app.desktop_client().await.unwrap();
        let error = old
            .evaluate_with_timeout("unanswered status read".into(), Duration::from_millis(30))
            .await
            .unwrap_err();
        for state in [0, 1] {
            listing.store(state, Ordering::SeqCst);
            app.handle_refresh_failure(&error).await;
            assert_eq!(app.view().connection.status, "unresponsive");
            assert!(!old.is_closed());
        }
        listing.store(2, Ordering::SeqCst);
        tokio::time::timeout(Duration::from_secs(1), app.handle_refresh_failure(&error))
            .await
            .unwrap();
        assert!(old.is_closed());
        assert!(app.desktop_client().await.is_none());
        assert_eq!(app.view().connection.status, "disconnected");
        assert!(app.view().connection.target_id.is_none());
        assert!(app.desired.read().await.enabled);
        assert!(app.desired.read().await.target_id.is_none());
        tokio::time::timeout(Duration::from_secs(1), peer)
            .await
            .unwrap()
            .unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn incompatible_response_still_releases_a_live_session() {
        let temp = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(temp.path().into())).unwrap(),
            Config::default(),
            None,
            true,
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            assert!(matches!(socket.next().await, Some(Ok(Message::Close(_)))));
        });
        let client = Client::connect(&endpoint).await.unwrap();
        *app.session.write().await = Some(Session { client });
        app.handle_refresh_failure(&anyhow::anyhow!("synthetic incompatible page"))
            .await;
        assert!(app.desktop_client().await.is_none());
        tokio::time::timeout(Duration::from_secs(1), peer)
            .await
            .unwrap()
            .unwrap();
    }
}
