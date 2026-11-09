// [INPUT]: Reader-only token, explicit Library grants and compiled local web assets.
// [OUTPUT]: A separate loopback origin for reads/bounded link previews, versioned saves and settings navigation.
// [POS]: No settings credential or configuration API; source writes are limited to existing Markdown.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::web_library::{Folder, Library, Preferences};
use anyhow::{Result, ensure};
use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
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
    #[serde(default)]
    sheet: String,
}
#[derive(Clone)]
pub(super) struct HttpState {
    pub library: Arc<Library>,
    pub port: u16,
    pub appearance: Option<tokio::sync::watch::Receiver<crate::state::View>>,
    pub app: Option<std::sync::Weak<crate::state::App>>,
}
#[derive(Clone)]
struct Access {
    token: String,
    folder: Folder,
    preferences: Preferences,
}
pub async fn start(
    app: Arc<crate::state::App>,
    mut closing: tokio::sync::watch::Receiver<bool>,
    appearance: tokio::sync::watch::Receiver<crate::state::View>,
) -> Result<JoinHandle<()>> {
    let library = app.web_library.clone();
    let previous_port = library.endpoint.lock().unwrap().port;
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", previous_port)).await {
        Ok(listener) => listener,
        Err(_) => tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?,
    };
    let port = listener.local_addr()?.port();
    {
        let preferences = library.preferences.lock().unwrap();
        let mut endpoint = library.endpoint.lock().unwrap();
        endpoint.port = port;
        if endpoint.token.is_empty() {
            endpoint.token = uuid::Uuid::new_v4().simple().to_string();
        }
        endpoint.reconcile(&preferences, &preferences);
        library.persist_endpoint(&preferences, &endpoint)?;
    }
    let router = router(HttpState {
        library,
        port,
        appearance: Some(appearance),
        app: Some(Arc::downgrade(&app)),
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
        .route(
            "/preferences",
            get(reader_preferences).post(save_reader_preferences),
        )
        .route("/{operation}", get(read))
        .route("/save", post(save))
        .route("/settings-open", post(open_settings))
        .route("/folder-open", post(open_folder))
        .layer(DefaultBodyLimit::max(super::files::MAX_NOTE as usize * 2))
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
    if request.method() != axum::http::Method::GET
        && headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) != Some(origin.as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let access = (|| {
        let preferences = state.library.preferences.lock().unwrap();
        let id = headers
            .get("x-palboo-folder")
            .map(|value| value.to_str())
            .transpose()
            .ok()?;
        let folder = preferences.folder(id.unwrap_or_default()).ok()?;
        let endpoint = state.library.endpoint.lock().unwrap();
        let token = endpoint.credential(&preferences, &folder)?.to_owned();
        Some(Access {
            token,
            preferences: preferences.scoped(&folder),
            folder,
        })
    })();
    let Some(access) = access else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"message":"笔记文件夹已移除，请从 Palboo 重新打开"})),
        )
            .into_response();
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
        ensure!(matches!(operation.as_str(), "catalog" | "search" | "note" | "resolve" | "preview" | "image" | "workbook"), "未知阅读请求");
        ensure!(input.q.len() <= 500 && input.id.len() <= 8192 && input.target.len() <= 8192 && input.sheet.len() <= 1024 && input.offset <= 100_000, "阅读请求过长");
        let preferences = access.preferences;
        let mut indexes = state.library.indexes.lock().unwrap();
        let index = indexes.entry(access.folder.id.clone()).or_default();
        check_access(&state.library, &access.folder, &access.token)?;
        if !index.ready(&preferences) || operation == "catalog" && input.refresh { index.refresh(&preferences)?; }
        let response = if operation == "image" {
            let (bytes, mime) = index.image(&preferences, &input.id, &input.target)?;
            Response::builder().header(header::CONTENT_TYPE, mime).body(Body::from(bytes))?
        } else {
            let value: Value = match operation.as_str() {
                "catalog" => {
                    let mut result = index.catalog();
                    result["name"] = json!(access.folder.name);
                    result["folder"] = json!(access.folder.id);
                    result["folders"] = json!(preferences.folders.iter().map(Folder::summary).collect::<Vec<_>>());
                    if let Some(appearance) = &state.appearance {
                        let view = appearance.borrow();
                        result["appearance"] = view.settings_appearance.clone();
                        result["language"] = json!(view.panel_preferences.language);
                        result["systemLanguage"] = json!(crate::i18n::system_locale());
                    }
                    result
                },
                "search" => index.search(&input.q, input.offset),
                "preview" => index.preview(&input.id, &input.target)?,
                "note" => index.note(&preferences, &input.id)?,
                "workbook" => index.workbook(&preferences, &input.id, &input.sheet, input.offset)?,
                "resolve" => { let (candidates, anchor) = index.resolve(&input.id, &input.target)?;
                    json!({"candidates":candidates.iter().map(|id|index.summary(id)).collect::<Vec<_>>(),"anchor":anchor}) },
                _ => unreachable!(),
            };
            Json(value).into_response()
        };
        check_access(&state.library, &access.folder, &access.token)?;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Edit {
    id: String,
    expected_version: String,
    markdown: String,
}
async fn save(
    State(state): State<HttpState>,
    Extension(access): Extension<Access>,
    Json(input): Json<Edit>,
) -> Response {
    let result = tokio::task::spawn_blocking(move || -> Result<Value> {
        ensure!(
            input.id.len() <= 8192 && input.expected_version.len() == 64,
            "阅读请求过长"
        );
        let mut indexes = state.library.indexes.lock().unwrap();
        let index = indexes.entry(access.folder.id.clone()).or_default();
        // Keep the grant locked through the write, so changing folders revokes old writes immediately.
        let current = state.library.preferences.lock().unwrap();
        let folder = current.folder(&access.folder.id)?;
        ensure!(
            folder.same_grants(&access.folder)
                && state
                    .library
                    .endpoint
                    .lock()
                    .unwrap()
                    .credential(&current, &folder)
                    == Some(access.token.as_str()),
            "授权目录已更新，请重新打开阅读器"
        );
        let preferences = current.scoped(&folder);
        if !index.ready(&preferences) {
            index.refresh(&preferences)?;
        }
        index.save(
            &preferences,
            &input.id,
            &input.expected_version,
            &input.markdown,
        )
    })
    .await;
    match result {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(error)) => (
            if error.is::<super::edit::Conflict>() {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            },
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"message":"保存失败，草稿已保留"})),
        )
            .into_response(),
    }
}
fn check_access(library: &Library, folder: &Folder, token: &str) -> Result<()> {
    let current = library.preferences.lock().unwrap();
    let selected = current.folder(&folder.id)?;
    ensure!(
        selected.same_grants(folder)
            && library
                .endpoint
                .lock()
                .unwrap()
                .credential(&current, &selected)
                == Some(token),
        "授权目录已更新，请重新打开阅读器"
    );
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenFolder {
    id: String,
}
async fn open_folder(
    State(state): State<HttpState>,
    Extension(access): Extension<Access>,
    Json(input): Json<OpenFolder>,
) -> Response {
    let result = (|| -> Result<Value> {
        ensure!(input.id.len() <= 80, "文件夹标识无效或重复");
        Ok(json!({"url":state.library.switch_folder(&access.folder, &access.token, &input.id)?}))
    })();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
    }
}
async fn open_settings(State(state): State<HttpState>) -> Response {
    let Some(app) = state.app.and_then(|app| app.upgrade()) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match app.open_settings_in_host(Some("sites")).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
    }
}

async fn reader_preferences(State(state): State<HttpState>) -> Response {
    let Some(app) = state.app.and_then(|app| app.upgrade()) else {
        return Json(json!({})).into_response();
    };
    match crate::backup::reader_preferences::read(&app.paths) {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
    }
}
async fn save_reader_preferences(
    State(state): State<HttpState>,
    Json(value): Json<Value>,
) -> Response {
    let Some(app) = state.app.and_then(|app| app.upgrade()) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    if *app.closing.borrow() {
        return StatusCode::CONFLICT.into_response();
    }
    match crate::backup::reader_preferences::save(&app.paths, value) {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"message":error.to_string()})),
        )
            .into_response(),
    }
}
