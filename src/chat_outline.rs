// [INPUT]: Connected host endpoint, outline/language preferences and standalone Chat script.
// [OUTPUT]: Separate leased read-only outline clients for ChatGPT webviews; cleanup on disable/disconnect/exit.
// [POS]: Ordinary Chat integration; never replaces the Work session or installs a write/model binding.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::{
    cdp::{Client, Target},
    state::App,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::{collections::HashMap, sync::Arc, time::Duration};

fn is_chat_target(target: &Target) -> bool {
    if target.kind != "webview" {
        return false;
    }
    reqwest::Url::parse(&target.url).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("chatgpt.com")
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
    })
}

struct Connection {
    client: Arc<Client>,
    script_id: Option<String>,
    revision: String,
}
impl Connection {
    async fn close(self) {
        if let Some(id) = self.script_id {
            let _ = self
                .client
                .request(
                    "Page.removeScriptToEvaluateOnNewDocument",
                    json!({"identifier":id}),
                )
                .await;
        }
        let _ = self
            .client
            .evaluate("window.__palbooChatOutlinePending?.(); window.__palbooChatOutline?.destroy(); true".into())
            .await;
        self.client.close().await;
    }

    async fn sync(&mut self, revision: &str, script: &str, language: &str) -> Result<()> {
        if self.revision != revision {
            if let Some(id) = self.script_id.take() {
                self.client
                    .request(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        json!({"identifier":id}),
                    )
                    .await?;
            }
            self.client.request("Page.enable", json!({})).await?;
            let result = self
                .client
                .request(
                    "Page.addScriptToEvaluateOnNewDocument",
                    json!({"source":script}),
                )
                .await?;
            self.script_id = Some(
                result["identifier"]
                    .as_str()
                    .context("Chat outline script id missing")?
                    .into(),
            );
            self.client.evaluate(script.into()).await?;
            self.revision = revision.into();
        }
        // Reinstall after an expired lease or a document that loaded before Page.enable.
        let ready = self
            .client
            .evaluate("Boolean(window.__palbooChatOutline)".into())
            .await?;
        if ready != true {
            self.client.evaluate(script.into()).await?;
        }
        let settings = json!({"enabled":true,"language":language,"systemLanguage":crate::i18n::system_locale()});
        self.client
            .evaluate(format!(
                "window.__palbooChatOutline?.update({settings}); true"
            ))
            .await?;
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct Connections {
    endpoint: String,
    clients: HashMap<String, Connection>,
}
impl Connections {
    pub(crate) async fn clear(&mut self) {
        for (_, connection) in self.clients.drain() {
            connection.close().await;
        }
        self.endpoint.clear();
    }

    async fn sync(&mut self, endpoint: &str, language: &str) -> Result<()> {
        if self.endpoint != endpoint {
            self.clear().await;
            self.endpoint = endpoint.into();
        }
        let targets = crate::cdp::discover_all(endpoint).await?;
        let targets: Vec<_> = targets.into_iter().filter(is_chat_target).collect();
        let obsolete: Vec<_> = self
            .clients
            .keys()
            .filter(|id| !targets.iter().any(|t| &t.id == *id))
            .cloned()
            .collect();
        for id in obsolete {
            if let Some(connection) = self.clients.remove(&id) {
                connection.close().await;
            }
        }
        let (revision, script) = crate::assets::chat_outline_script();
        for target in targets {
            let id = target.id.clone();
            if !self.clients.contains_key(&id) {
                match Client::connect(&target.web_socket_debugger_url).await {
                    Ok(client) => {
                        self.clients.insert(
                            id.clone(),
                            Connection {
                                client,
                                script_id: None,
                                revision: String::new(),
                            },
                        );
                    }
                    Err(_) => continue,
                }
            }
            if self
                .clients
                .get_mut(&id)
                .unwrap()
                .sync(&revision, &script, language)
                .await
                .is_err()
                && let Some(connection) = self.clients.remove(&id)
            {
                connection.close().await;
            }
        }
        Ok(())
    }
}

pub(crate) async fn watch(app: Arc<App>) {
    let mut closing = app.closing.subscribe();
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = closing.wait_for(|value| *value) => break,
            _ = interval.tick() => {}
        }
        let mut connections = app.chat_outline.lock().await;
        if let Some((endpoint, language)) = app.chat_outline_source().await {
            // Failure never changes the Work connection; the page lease expires without renewals.
            let _ = connections.sync(&endpoint, &language).await;
        } else {
            connections.clear().await;
        }
    }
    app.chat_outline.lock().await.clear().await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::Value;
    use tokio::{net::TcpListener, sync::Mutex};
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    #[tokio::test]
    async fn independent_client_replaces_navigation_scripts_and_cleans_up_without_work_bindings() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let calls = Arc::new(Mutex::new(Vec::<Value>::new()));
        let observed = calls.clone();
        let peer = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let mut script_number = 0;
            while let Some(Ok(Message::Text(raw))) = socket.next().await {
                let request: Value = serde_json::from_str(&raw).unwrap();
                let result = match request["method"].as_str().unwrap() {
                    "Page.addScriptToEvaluateOnNewDocument" => {
                        script_number += 1;
                        json!({"identifier":format!("chat-{script_number}")})
                    }
                    "Runtime.evaluate" => json!({"result":{"value":true}}),
                    _ => json!({}),
                };
                observed.lock().await.push(request.clone());
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
        let mut connection = Connection {
            client: Client::connect(&url).await.unwrap(),
            script_id: None,
            revision: String::new(),
        };
        connection
            .sync("one", "/* synthetic outline */", "zh-CN")
            .await
            .unwrap();
        connection
            .sync("one", "/* synthetic outline */", "en")
            .await
            .unwrap();
        connection
            .sync("two", "/* updated outline */", "en")
            .await
            .unwrap();
        connection.close().await;
        peer.await.unwrap();
        let calls = calls.lock().await;
        let count = |method| calls.iter().filter(|call| call["method"] == method).count();
        assert_eq!(count("Page.addScriptToEvaluateOnNewDocument"), 2);
        assert_eq!(count("Page.removeScriptToEvaluateOnNewDocument"), 2);
        assert_eq!(count("Runtime.addBinding"), 0);
        let expressions: Vec<_> = calls
            .iter()
            .filter_map(|call| call["params"]["expression"].as_str())
            .collect();
        assert_eq!(
            expressions
                .iter()
                .filter(|expr| expr.contains(".update("))
                .count(),
            3
        );
        assert!(expressions.contains(
            &"window.__palbooChatOutlinePending?.(); window.__palbooChatOutline?.destroy(); true"
        ));
        assert!(
            !expressions
                .iter()
                .any(|expr| expr.contains("__companionFloatingPanel"))
        );
    }

    #[test]
    fn only_official_chat_webviews_on_the_connected_host_are_eligible() {
        let target = |kind: &str, url: &str| Target {
            id: "fixture".into(),
            title: String::new(),
            url: url.into(),
            kind: kind.into(),
            web_socket_debugger_url: String::new(),
        };
        assert!(is_chat_target(&target(
            "webview",
            "https://chatgpt.com/c/fixture"
        )));
        assert!(is_chat_target(&target("webview", "https://chatgpt.com/")));
        for (kind, url) in [
            ("page", "https://chatgpt.com/c/fixture"),
            ("iframe", "https://chatgpt.com/"),
            ("webview", "http://chatgpt.com/"),
            ("webview", "https://chatgpt.com.evil.test/"),
            ("webview", "https://example.com/?next=https://chatgpt.com"),
            ("webview", "https://chatgpt.com:8443/"),
            ("webview", "https://user@chatgpt.com/"),
            ("page", "app://-/index.html"),
        ] {
            assert!(!is_chat_target(&target(kind, url)), "{kind} {url}");
        }
    }
}
