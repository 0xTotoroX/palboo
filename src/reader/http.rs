// [INPUT]: Reader-only token, explicit Library grants and compiled local web assets.
// [OUTPUT]: A separate loopback origin serving read-only catalog/search/note/link/image endpoints.
// [POS]: No settings routes, cookies, external fetches or source writes; shutdown follows the owning backend.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::web_library::{Library, Preferences, ReaderEndpoint};
use anyhow::{Result, ensure};
use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::task::JoinHandle;

#[derive(Deserialize, Default)]
struct Input {
    #[serde(default)]
    id: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    refresh: bool,
}
#[derive(Clone)]
pub(super) struct HttpState {
    pub library: Arc<Library>,
    pub port: u16,
    pub appearance: Option<tokio::sync::watch::Receiver<crate::state::View>>,
}
#[derive(Clone)]
struct Access {
    token: String,
    preferences: Preferences,
}
pub async fn start(
    library: Arc<Library>,
    mut closing: tokio::sync::watch::Receiver<bool>,
    appearance: tokio::sync::watch::Receiver<crate::state::View>,
) -> Result<JoinHandle<()>> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    *library.endpoint.lock().unwrap() = ReaderEndpoint {
        port,
        token: uuid::Uuid::new_v4().simple().to_string(),
    };
    let router = router(HttpState {
        library,
        port,
        appearance: Some(appearance),
    });
    Ok(tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                if !*closing.borrow() {
                    let _ = closing.changed().await;
                }
            })
            .await;
    }))
}
pub(super) fn router(state: HttpState) -> Router {
    let api = Router::new()
        .route("/{operation}", get(read))
        .route_layer(middleware::from_fn_with_state(state.clone(), authorize));
    Router::new()
        .nest("/api", api)
        .route("/", get(page))
        .route("/assets/{*path}", get(asset))
        .layer(middleware::from_fn_with_state(state.clone(), boundary))
        .with_state(state)
}
async fn boundary(State(state): State<HttpState>, request: Request, next: Next) -> Response {
    let expected = format!("127.0.0.1:{}", state.port);
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(expected.as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let image = request.uri().path() == "/api/image";
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert(
        "cross-origin-resource-policy",
        "same-origin".parse().unwrap(),
    );
    headers.insert("content-security-policy", (if image { "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } else { "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: http: https:; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }).parse().unwrap());
    response
}
async fn authorize(State(state): State<HttpState>, mut request: Request, next: Next) -> Response {
    let origin = format!("http://127.0.0.1:{}", state.port);
    let headers = request.headers();
    if headers
        .get(header::ORIGIN)
        .is_some_and(|v| v.to_str().ok() != Some(origin.as_str()))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let access = {
        let preferences = state.library.preferences.lock().unwrap();
        let token = state.library.endpoint.lock().unwrap().token.clone();
        Access {
            token,
            preferences: preferences.clone(),
        }
    };
    if access.token.is_empty()
        || headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            != Some(format!("Bearer {}", access.token).as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"message":"阅读凭据已过期，请从 Palboo 重新打开阅读器"})),
        )
            .into_response();
    }
    request.extensions_mut().insert(access);
    next.run(request).await
}
async fn page() -> Response {
    crate::server::reader_asset("reader.html")
}
async fn asset(Path(path): Path<String>) -> Response {
    crate::server::reader_asset(&format!("assets/{path}"))
}
async fn read(
    State(state): State<HttpState>,
    Extension(access): Extension<Access>,
    Path(operation): Path<String>,
    Query(input): Query<Input>,
) -> Response {
    let result = tokio::task::spawn_blocking(move || -> Result<Response> {
        ensure!(matches!(operation.as_str(), "catalog" | "search" | "note" | "resolve" | "image"), "未知阅读请求");
        ensure!(input.q.len() <= 500 && input.id.len() <= 8192 && input.target.len() <= 8192 && input.offset <= 100_000, "阅读请求过长");
        let preferences = access.preferences;
        let mut index = state.library.index.lock().unwrap();
        ensure!(state.library.endpoint.lock().unwrap().token == access.token, "阅读凭据已过期，请从 Palboo 重新打开阅读器");
        if !index.ready(&preferences) || operation == "catalog" && input.refresh { index.refresh(&preferences)?; }
        let response = if operation == "image" {
            let (bytes, mime) = index.image(&preferences, &input.id, &input.target)?;
            Response::builder().header(header::CONTENT_TYPE, mime).body(Body::from(bytes))?
        } else {
            let value: Value = match operation.as_str() {
                "catalog" => {
                    let mut result = index.catalog();
                    if let Some(appearance) = &state.appearance {
                        let view = appearance.borrow();
                        result["appearance"] = view.settings_appearance.clone();
                        result["language"] = json!(view.panel_preferences.language);
                        result["systemLanguage"] = json!(crate::i18n::system_locale());
                    }
                    result
                },
                "search" => index.search(&input.q, input.offset),
                "note" => index.note(&preferences, &input.id)?,
                "resolve" => { let (candidates, anchor) = index.resolve(&input.id, &input.target)?;
                    json!({"candidates":candidates.iter().map(|id|index.summary(id)).collect::<Vec<_>>(),"anchor":anchor}) },
                _ => unreachable!(),
            };
            Json(value).into_response()
        };
        let current = state.library.preferences.lock().unwrap();
        ensure!(current.vault == preferences.vault && current.attachments == preferences.attachments && state.library.endpoint.lock().unwrap().token == access.token, "授权目录已更新，请重新打开阅读器");
        Ok(response)
    }).await;
    match result {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"message":"读取失败，请重试"})),
        )
            .into_response(),
    }
}
