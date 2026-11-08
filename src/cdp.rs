// [INPUT]: 本机 CDP 端点、WebSocket、assets 胶囊脚本与受限 binding。
// [OUTPUT]: 全目标只读发现供 Chat 独立筛选，主 Work 目标范围不变； 目标发现、无正文设置外观采样、Client 请求/事件/注入及开发实例归属检查及宿主窗口只读逻辑坐标；独立模型及额度适配器的文档生命周期与有界执行；暂停失败恢复完整脚本，开发重连仅回收本进程注入对象、正式注入保留接管语义，关闭只清理本实例。
// [POS]: 宿主连接基础层，被 state.rs 和 requests.rs 使用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use anyhow::{Context, Result, anyhow, bail};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

pub const PANEL_SCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/panel.js"));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing)]
    pub web_socket_debugger_url: String,
}

pub async fn discover(endpoint: &str, allow_fixture: bool) -> Result<Vec<Target>> {
    Ok(discover_all(endpoint)
        .await?
        .into_iter()
        .filter(|t| is_codex_target(t, allow_fixture))
        .collect())
}

pub(crate) async fn discover_all(endpoint: &str) -> Result<Vec<Target>> {
    let endpoint = crate::config::local_endpoint(endpoint)?;
    let response = crate::config::local_client()
        .get(format!("{endpoint}/json/list"))
        .send()
        .await
        .context("无法连接调试端点，请确认 Codex 已通过调试入口启动")?
        .error_for_status()?;
    let targets: Vec<Target> = response
        .json()
        .await
        .context("该端口没有返回 CDP 窗口列表")?;
    Ok(targets)
}

fn is_codex_target(target: &Target, allow_fixture: bool) -> bool {
    if target.kind != "page" {
        return false;
    }
    if let Ok(url) = reqwest::Url::parse(&target.url) {
        if url.scheme() == "app" && url.host_str() == Some("-") && url.path() == "/index.html" {
            return !url.query_pairs().any(|(key, value)| {
                key == "initialRoute" && (value.contains("overlay") || value.contains("settings"))
            });
        }
        return allow_fixture
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.path() == "/fixture";
    }
    false
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

// 归属只存于本进程和实际注入对象；跨连接恢复不复用其他进程或旧全局标记。
fn desktop_owner() -> &'static str {
    static OWNER: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    OWNER.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

const DESKTOP_AVAILABLE: &str = r#"![window.__companionDesktop, window.__companionFloatingPanel, window.__palbooModelControl].some(api => api && api.__palbooOwner !== __PALBOO_OWNER__)"#;
const DESKTOP_CLEANUP: &str = r#"(() => {
  const pending = window.__palbooPendingDesktop, owner = __PALBOO_OWNER__;
  pending?.get(owner)?.abort();
  pending?.delete(owner);
  if (pending?.size === 0) delete window.__palbooPendingDesktop;
  if (!(__PALBOO_AVAILABLE__)) return false;
  window.__companionDesktop?.destroy(); window.__companionFloatingPanel?.destroy(); window.__palbooModelControl?.dispose();
  return true;
})()"#;

const OWNED_SCRIPT: &str = r#"(() => {
  const owner = __PALBOO_OWNER__;
  const install = () => {
    if (__PALBOO_PROTECT__ && !(__PALBOO_AVAILABLE__)) throw new Error('目标窗口已有其他胶囊实例，未覆盖它');
    const before = [window.__companionDesktop, window.__companionFloatingPanel, window.__palbooModelControl];
    try {
      __PALBOO_SOURCE__
    } finally {
      // 即使后续初始化抛错，也保留已创建对象的真实归属。
      [window.__companionDesktop, window.__companionFloatingPanel, window.__palbooModelControl].forEach((api, index) => {
        if (api && api !== before[index]) Object.defineProperty(api, '__palbooOwner', {value: owner});
      });
    }
  };
  // 面板本身也等待 DOMContentLoaded；在其真正执行前重新校验并标记对象。
  if (__PALBOO_PANEL__ && document.readyState === 'loading') {
    const pending = window.__palbooPendingDesktop ||= new Map();
    pending.get(owner)?.abort();
    const controller = new AbortController();
    pending.set(owner, controller);
    document.addEventListener('DOMContentLoaded', () => {
      pending.delete(owner);
      if (!pending.size && window.__palbooPendingDesktop === pending) delete window.__palbooPendingDesktop;
      install();
    }, {once: true, signal: controller.signal});
  } else install();
  return true;
})()"#;

fn desktop_available() -> String {
    DESKTOP_AVAILABLE.replace("__PALBOO_OWNER__", &json!(desktop_owner()).to_string())
}

fn owned_script(source: &str, panel: bool, protect_existing: bool) -> String {
    OWNED_SCRIPT
        .replace("__PALBOO_AVAILABLE__", DESKTOP_AVAILABLE)
        .replace("__PALBOO_OWNER__", &json!(desktop_owner()).to_string())
        .replace("__PALBOO_PANEL__", if panel { "true" } else { "false" })
        .replace(
            "__PALBOO_PROTECT__",
            if protect_existing { "true" } else { "false" },
        )
        .replace("__PALBOO_SOURCE__", source)
}

fn desktop_cleanup() -> String {
    DESKTOP_CLEANUP
        .replace("__PALBOO_AVAILABLE__", &desktop_available())
        .replace("__PALBOO_OWNER__", &json!(desktop_owner()).to_string())
}

enum Outbound {
    Request(Value),
    Close,
}

pub struct Client {
    sender: mpsc::Sender<Outbound>,
    pending: Pending,
    sequence: AtomicU64,
    closed: Arc<AtomicBool>,
    events: Mutex<Option<mpsc::Receiver<Value>>>,
    script_id: Mutex<Option<String>>,
    model_control_script_id: Mutex<Option<String>>,
    dev_revision: Mutex<String>,
    desktop_installed: AtomicBool,
    // 仅开发连接拒绝接管其他实例；正式模式保留旧版本及崩溃残留的既有接管语义。
    protect_existing: bool,
}

impl Client {
    pub async fn connect(url: &str) -> Result<Arc<Self>> {
        let parsed = reqwest::Url::parse(url)?;
        if parsed.scheme() != "ws"
            || !matches!(
                parsed.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
            )
        {
            bail!("拒绝非本机 WebSocket 目标");
        }
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(4),
            tokio_tungstenite::connect_async(url),
        )
        .await??;
        let (mut write, mut read) = socket.split();
        let (sender, mut receiver) = mpsc::channel(32);
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let (events_tx, events_rx) = mpsc::channel(32);
        let client = Arc::new(Self {
            sender,
            pending: pending.clone(),
            sequence: AtomicU64::new(1),
            closed: closed.clone(),
            events: Mutex::new(Some(events_rx)),
            script_id: Mutex::new(None),
            model_control_script_id: Mutex::new(None),
            dev_revision: Mutex::new(String::new()),
            desktop_installed: AtomicBool::new(false),
            protect_existing: crate::assets::development().is_some(),
        });
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    outgoing = receiver.recv() => match outgoing {
                        Some(Outbound::Request(value)) => if write.send(Message::Text(value.to_string().into())).await.is_err() { break; },
                        _ => { let _ = write.close().await; break; }
                    },
                    incoming = read.next() => match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                                if let Some(id) = value["id"].as_u64()
                                    && let Some(reply) = pending.lock().await.remove(&id) {
                                    let result = if value.get("error").is_some() { Err("Codex 调试命令失败，可能正在刷新页面".to_owned()) } else { Ok(value["result"].clone()) };
                                    let _ = reply.send(result);
                                } else if value["method"] == "Runtime.bindingCalled" && value["params"]["name"] == "__companionHostRequest" {
                                    let _ = events_tx.try_send(value["params"].clone());
                                }
                            }
                        },
                        Some(Ok(Message::Ping(payload))) if write.send(Message::Pong(payload.clone())).await.is_err() => break,
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                        _ => {}
                    }
                }
            }
            closed.store(true, Ordering::SeqCst);
            for (_, reply) in pending.lock().await.drain() {
                let _ = reply.send(Err("Codex 连接已关闭".into()));
            }
        });
        Ok(client)
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.request_with_timeout(method, params, Duration::from_secs(5))
            .await
    }

    async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        if self.is_closed() {
            bail!("Codex 连接已关闭");
        }
        let id = self.sequence.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if self
            .sender
            .send(Outbound::Request(
                json!({"id":id,"method":method,"params":params}),
            ))
            .await
            .is_err()
        {
            self.pending.lock().await.remove(&id);
            bail!("Codex 连接已关闭");
        }
        let result = tokio::time::timeout(timeout, receiver).await;
        self.pending.lock().await.remove(&id);
        result
            .context("Codex 页面响应超时")?
            .context("Codex 请求已取消")?
            .map_err(|error| anyhow!(error))
    }

    pub async fn evaluate(&self, expression: String) -> Result<Value> {
        self.evaluate_with_timeout(expression, Duration::from_secs(5))
            .await
    }

    // The connected page owns this window; do not follow unrelated foreground apps.
    pub async fn window_bounds(&self) -> Result<Value> {
        // Electron's hosted chat renderer has no Browser-domain window identity.
        // Use the same global logical coordinates as the existing panel handoff.
        self.evaluate_with_timeout(
            "({left:screenX,top:screenY,width:outerWidth,height:outerHeight})".into(),
            Duration::from_millis(500),
        )
        .await
    }

    pub async fn evaluate_with_timeout(
        &self,
        expression: String,
        timeout: Duration,
    ) -> Result<Value> {
        let result = self
            .request_with_timeout(
                "Runtime.evaluate",
                json!({"expression":expression,"returnByValue":true,"awaitPromise":true}),
                timeout,
            )
            .await?;
        if result.get("exceptionDetails").is_some() {
            bail!("当前 Codex 页面结构不兼容，已停止操作");
        }
        Ok(result["result"]["value"].clone())
    }

    pub async fn desktop_status(
        &self,
        detached: bool,
        ui: Value,
        revision: u64,
        launcher_action: Value,
        typography: Value,
    ) -> Result<Value> {
        if let Some(dev) = crate::assets::development() {
            if self.evaluate(desktop_available()).await? != true {
                bail!("窗口已由其他胶囊接管，开发版停止覆盖");
            }
            let mut revision = self.dev_revision.lock().await;
            if *revision != dev.revision {
                let mut installed = self.script_id.lock().await;
                if let Some(identifier) = installed.take() {
                    self.request(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        json!({"identifier":identifier}),
                    )
                    .await?;
                }
                let script = owned_script(&dev.script, true, true);
                let result = self
                    .request(
                        "Page.addScriptToEvaluateOnNewDocument",
                        json!({"source":script}),
                    )
                    .await?;
                *installed = result["identifier"].as_str().map(str::to_owned);
                self.evaluate(script).await?;
                *revision = dev.revision.clone();
            }
        }
        let expression = format!(
            "(() => {{const p=window.__companionFloatingPanel; if (!window.__companionDesktop || !p || p.state.destroyed) return null; p.syncTypography?.({typography}); p.syncPanelPreferences({ui}, {revision}, {detached}, {launcher_action}); return {{desktop:p.desktopStatus(),ui:p.panelPreferences(),theme:p.state.theme,colors:p.panelAppearance().colors,fontBase:p.state.hostTypography.baseItemFontSize,typography:p.typography?.(),settingsAppearance:p.settingsAppearance?.()}};}})()"
        );
        let mut value = self.evaluate(expression.clone()).await?;
        if value.is_null() {
            self.evaluate(owned_script(
                &crate::assets::panel_script(),
                true,
                self.protect_existing,
            ))
            .await?;
            value = self.evaluate(expression).await?;
        }
        Ok(value)
    }

    pub async fn install_desktop(
        self: &Arc<Self>,
        app: std::sync::Weak<crate::state::App>,
    ) -> Result<()> {
        if self.protect_existing && self.evaluate(desktop_available()).await? != true {
            bail!("目标窗口已有其他胶囊实例，未覆盖它");
        }
        self.request("Runtime.enable", json!({})).await?;
        self.request("Page.enable", json!({})).await?;
        self.install_model_script().await?;
        self.request(
            "Runtime.addBinding",
            json!({"name":"__companionHostRequest"}),
        )
        .await?;
        self.desktop_installed.store(true, Ordering::SeqCst);
        let events = self
            .events
            .lock()
            .await
            .take()
            .context("桌面连接已经安装")?;
        crate::requests::listen(Arc::downgrade(self), app, events);
        self.install_panel_script().await
    }

    async fn install_model_script(&self) -> Result<()> {
        let model_script = concat!(
            include_str!("../ui/codex/codex-host.js"),
            "\n",
            include_str!("../ui/codex/model.js"),
            "\n",
            include_str!("../ui/codex/model-usage.js")
        );
        let model_script = owned_script(model_script, false, self.protect_existing);
        let installed_model = self
            .request(
                "Page.addScriptToEvaluateOnNewDocument",
                json!({"source":model_script}),
            )
            .await?;
        *self.model_control_script_id.lock().await =
            installed_model["identifier"].as_str().map(str::to_owned);
        self.evaluate(model_script).await?;
        Ok(())
    }

    async fn install_panel_script(&self) -> Result<()> {
        let script = owned_script(&crate::assets::panel_script(), true, self.protect_existing);
        let installed = self
            .request(
                "Page.addScriptToEvaluateOnNewDocument",
                json!({"source":script}),
            )
            .await?;
        *self.script_id.lock().await = installed["identifier"].as_str().map(str::to_owned);
        self.evaluate(script).await?;
        Ok(())
    }

    pub(crate) async fn restore_desktop(&self) -> Result<()> {
        // 同一连接的 binding 事件监听器仍然有效；只恢复脚本，不再接管事件接收器。
        for installed in [&self.script_id, &self.model_control_script_id] {
            let mut identifier = installed.lock().await;
            if let Some(value) = identifier.as_ref() {
                self.request(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    json!({"identifier":value}),
                )
                .await?;
                *identifier = None;
            }
        }
        self.install_model_script().await?;
        self.request(
            "Runtime.addBinding",
            json!({"name":"__companionHostRequest"}),
        )
        .await?;
        self.install_panel_script().await
    }

    pub(crate) async fn suspend_desktop(&self) -> Result<()> {
        anyhow::ensure!(
            self.evaluate(desktop_cleanup()).await? == true,
            "目标窗口归属已变化，未清理其他实例"
        );
        for installed in [&self.script_id, &self.model_control_script_id] {
            let mut identifier = installed.lock().await;
            if let Some(value) = identifier.as_ref() {
                self.request(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    json!({"identifier":value}),
                )
                .await?;
                *identifier = None;
            }
        }
        let clean = self.evaluate("!window.__companionFloatingPanel && !window.__palbooModelControl && !window.__palbooTerminology && !window.__palbooPromptEnhancer".into()).await?;
        anyhow::ensure!(clean == true, "宿主清理尚未完成，请重试；连接未报告为关闭");
        Ok(())
    }

    pub async fn close(&self) {
        if !self.is_closed() {
            let installed = self.desktop_installed.swap(false, Ordering::SeqCst);
            let owned = if installed || self.model_control_script_id.lock().await.is_some() {
                self.evaluate(desktop_cleanup()).await.ok() == Some(json!(true))
            } else {
                false
            };
            for script in [&self.model_control_script_id, &self.script_id] {
                if let Some(identifier) = script.lock().await.take() {
                    let _ = self
                        .request(
                            "Page.removeScriptToEvaluateOnNewDocument",
                            json!({"identifier":identifier}),
                        )
                        .await;
                }
            }
            if installed && owned {
                let _ = self
                    .request(
                        "Runtime.removeBinding",
                        json!({"name":"__companionHostRequest"}),
                    )
                    .await;
            }
        }
        let _ = self.sender.send(Outbound::Close).await;
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.sender.try_send(Outbound::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reconnect_recovers_owned_page_after_lost_restore_reply_and_rejects_foreign() {
        use std::process::Stdio;
        use tokio::io::{AsyncBufReadExt, BufReader};

        // Node 夹具在隔离 Chromium 中执行真实脚本，再丢弃恢复应答；不连接真实宿主。
        let mut peer = tokio::process::Command::new("node")
            .arg("tests/cdp-ownership-peer.mjs")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut stdout = BufReader::new(peer.stdout.take().unwrap());
        let mut endpoint = String::new();
        tokio::time::timeout(Duration::from_secs(20), stdout.read_line(&mut endpoint))
            .await
            .unwrap()
            .unwrap();
        let mut first = Client::connect(endpoint.trim()).await.unwrap();
        // 独立测试选择开发保护，不修改影响并行用例的进程环境变量。
        Arc::get_mut(&mut first).unwrap().protect_existing = true;
        first.install_desktop(std::sync::Weak::new()).await.unwrap();
        first.suspend_desktop().await.unwrap();
        first
            .request("Fixture.dropAfterNextPanel", json!({}))
            .await
            .unwrap();
        assert!(first.restore_desktop().await.is_err());
        assert!(first.is_closed());
        first.close().await;

        let mut second = Client::connect(endpoint.trim()).await.unwrap();
        Arc::get_mut(&mut second).unwrap().protect_existing = true;
        assert_eq!(
            second
                .evaluate("window.__companionDesktop.__palbooOwner".into())
                .await
                .unwrap(),
            desktop_owner()
        );
        second
            .install_desktop(std::sync::Weak::new())
            .await
            .unwrap();
        assert_eq!(second.evaluate(desktop_available()).await.unwrap(), true);
        second.evaluate("window.__companionDesktop = {__palbooOwner:'foreign', destroy(){window.foreignDestroyed=true}}; true".into()).await.unwrap();
        // 旧连接关闭也不能销毁已被其他实例替换的对象。
        second.close().await;
        let mut third = Client::connect(endpoint.trim()).await.unwrap();
        Arc::get_mut(&mut third).unwrap().protect_existing = true;
        assert!(third.install_desktop(std::sync::Weak::new()).await.is_err());
        assert_eq!(
            third
                .evaluate("Boolean(window.foreignDestroyed)".into())
                .await
                .unwrap(),
            false
        );
        third.close().await;
        // 正式模式仍按已有流程接管旧实例；只有 close/suspend 保持严格归属清理。
        let mut release = Client::connect(endpoint.trim()).await.unwrap();
        Arc::get_mut(&mut release).unwrap().protect_existing = false;
        release
            .install_desktop(std::sync::Weak::new())
            .await
            .unwrap();
        assert_eq!(release.evaluate(desktop_available()).await.unwrap(), true);
        assert_eq!(
            release
                .evaluate("Boolean(window.foreignDestroyed)".into())
                .await
                .unwrap(),
            true
        );
        release.close().await;
        drop(peer.stdin.take());
        assert!(
            tokio::time::timeout(Duration::from_secs(10), peer.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
    }

    #[test]
    fn excludes_avatar_and_unrelated_pages() {
        let target = |url: &str| Target {
            id: "x".into(),
            title: "Codex".into(),
            url: url.into(),
            kind: "page".into(),
            web_socket_debugger_url: String::new(),
        };
        assert!(is_codex_target(&target("app://-/index.html"), false));
        assert!(!is_codex_target(
            &target("app://-/index.html?initialRoute=%2Favatar-overlay"),
            false
        ));
        assert!(!is_codex_target(&target("https://chatgpt.com"), false));
        assert!(!is_codex_target(
            &target("http://127.0.0.1:8080/fixture"),
            false
        ));
        assert!(is_codex_target(
            &target("http://127.0.0.1:8080/fixture"),
            true
        ));
    }
}
