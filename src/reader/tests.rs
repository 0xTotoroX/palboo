// [INPUT]: Synthetic vaults, local-only router and reader-specific authorization.
// [OUTPUT]: Read hashes, stable search pagination, links/images/spreadsheets, guarded edits and HTTP/endpoint tests.
// [POS]: No real user notes, host, network websites or credentials.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::*;
use crate::{
    config::Paths,
    web_library::{Library, ReaderEndpoint, website_url},
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tower::ServiceExt;
struct Fixture {
    _dir: tempfile::TempDir,
    vault: PathBuf,
    library: Arc<Library>,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let vault = base.join("笔记");
        std::fs::create_dir_all(vault.join("项目/附件")).unwrap();
        std::fs::create_dir_all(vault.join("其他")).unwrap();
        std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        std::fs::write(vault.join("首页.md"), "# 首页\n中文检索 needle\n[[项目/文章#章节|别名]] [[同名]]\n`[[其他/同名]]`\n```md\n[[其他/同名]]\n```\n").unwrap();
        std::fs::write(
            vault.join("项目/文章.md"),
            "# 文章\n## 章节\n正文 ^block\n[[../首页]]\n![[附件/测试.png|320]]",
        )
        .unwrap();
        std::fs::write(vault.join("项目/同名.md"), "a").unwrap();
        std::fs::write(vault.join("其他/同名.md"), "b").unwrap();
        std::fs::write(vault.join(".obsidian/秘密.md"), "hidden").unwrap();
        std::fs::write(vault.join("项目/附件/测试.png"), b"synthetic-image").unwrap();
        let library = Library::load(&Paths::new(Some(base.join("palboo"))).unwrap());
        library
            .save(serde_json::from_value(json!({"expectedRevision":0,"vault":vault})).unwrap())
            .unwrap();
        Self {
            _dir: dir,
            vault,
            library,
        }
    }
    fn index(&self) -> Index {
        let mut index = Index::default();
        index
            .refresh(&self.library.preferences.lock().unwrap())
            .unwrap();
        index
    }
}
#[test]
fn search_pages_match_instant_title_order_before_body_matches() {
    let f = Fixture::new();
    for n in 0..60 {
        std::fs::write(
            f.vault.join(format!("zz-project-{n:02}-group.md")),
            "# A note",
        )
        .unwrap();
    }
    std::fs::write(f.vault.join("a-body.md"), "# Body\nproject group").unwrap();
    let index = f.index();
    let first = index.search("project group", 0);
    let second = index.search("project group", 50);
    assert_eq!(first["total"], 61);
    let first = first["results"].as_array().unwrap();
    let second = second["results"].as_array().unwrap();
    assert_eq!(first.len(), 50);
    assert_eq!(second.len(), 11);
    assert!(
        first
            .iter()
            .all(|note| note["id"].as_str().unwrap().starts_with("zz-"))
    );
    assert_eq!(second.last().unwrap()["id"], "a-body.md");
    assert!(
        !first
            .iter()
            .any(|a| second.iter().any(|b| a["id"] == b["id"]))
    );
}
#[test]
fn searches_chinese_content_paths_and_resolves_real_backlinks() {
    let f = Fixture::new();
    let index = f.index();
    assert_eq!(index.catalog()["notes"].as_array().unwrap().len(), 4);
    assert_eq!(index.search("中文检索", 0)["results"][0]["id"], "首页.md");
    assert_eq!(index.search("NEEDLE", 0)["total"], 1);
    assert_eq!(
        index.search("项目 文章", 0)["results"][0]["id"],
        "项目/文章.md"
    );
    assert_eq!(
        index.resolve("首页.md", "项目/文章#章节").unwrap(),
        (vec!["项目/文章.md".into()], "章节".into())
    );
    assert_eq!(
        index.resolve("项目/文章.md", "../首页#^block").unwrap().0,
        vec!["首页.md"]
    );
    assert_eq!(index.resolve("首页.md", "同名").unwrap().0.len(), 2);
    assert_eq!(
        index.resolve("项目/文章.md", "同名").unwrap().0,
        vec!["项目/同名.md"]
    );
    let note = index
        .note(&f.library.preferences.lock().unwrap(), "其他/同名.md")
        .unwrap();
    assert_eq!(note["backlinks"], json!([]));
    assert_eq!(
        index
            .note(&f.library.preferences.lock().unwrap(), "项目/文章.md")
            .unwrap()["backlinks"][0]["id"],
        "首页.md"
    );
}
#[test]
fn refresh_detects_changes_rename_delete_and_reads_do_not_modify_sources() {
    let f = Fixture::new();
    let file = f.vault.join("首页.md");
    let before = Sha256::digest(std::fs::read(&file).unwrap());
    let mut index = f.index();
    let p = f.library.preferences.lock().unwrap().clone();
    index.search("needle", 0);
    index.note(&p, "首页.md").unwrap();
    index.image(&p, "项目/文章.md", "附件/测试.png").unwrap();
    index.refresh(&p).unwrap();
    assert_eq!(before, Sha256::digest(std::fs::read(&file).unwrap()));
    std::fs::write(&file, "changed content").unwrap();
    index.refresh(&p).unwrap();
    assert_eq!(index.search("needle", 0)["total"], 0);
    assert_eq!(index.search("changed", 0)["total"], 1);
    std::fs::rename(&file, f.vault.join("移动.md")).unwrap();
    index.refresh(&p).unwrap();
    assert!(index.note(&p, "首页.md").is_err());
    std::fs::remove_file(f.vault.join("移动.md")).unwrap();
    index.refresh(&p).unwrap();
    assert_eq!(index.search("changed", 0)["total"], 0);
}
#[test]
fn no_follow_descriptors_refuse_symlinks_traversal_hidden_and_ungranted_images() {
    let f = Fixture::new();
    let outside = f._dir.path().canonicalize().unwrap().join("outside.png");
    std::fs::write(&outside, "private").unwrap();
    std::os::unix::fs::symlink(&outside, f.vault.join("leak.png")).unwrap();
    std::os::unix::fs::symlink(outside.parent().unwrap(), f.vault.join("escape")).unwrap();
    let index = f.index();
    let p = f.library.preferences.lock().unwrap().clone();
    for path in [
        "../outside.png",
        "%2e%2e/outside.png",
        "leak.png",
        "escape/outside.png",
        ".obsidian/秘密.md",
        "file:///etc/passwd",
    ] {
        assert!(index.image(&p, "首页.md", path).is_err(), "{path}");
    }
    assert!(files::read(std::slice::from_ref(&f.vault), &outside, 100).is_err());
    assert!(index.note(&p, "../outside.png").is_err());
    assert!(
        index
            .resolve("首页.md", "%2e%2e/secret")
            .unwrap()
            .0
            .is_empty()
    );
    assert_eq!(
        index.image(&p, "项目/文章.md", "附件/测试.png").unwrap().0,
        b"synthetic-image"
    );
}
#[test]
fn attachment_grants_are_explicit_revisioned_and_revoke_the_old_reader_token() {
    let f = Fixture::new();
    let attachments = f._dir.path().canonicalize().unwrap().join("附件");
    std::fs::create_dir(&attachments).unwrap();
    std::fs::write(attachments.join("shared.png"), "shared").unwrap();
    f.library.endpoint.lock().unwrap().token = "old".into();
    let update = json!({"expectedRevision":1,"attachments":[attachments]});
    f.library
        .save(serde_json::from_value(update.clone()).unwrap())
        .unwrap();
    assert_ne!(f.library.endpoint.lock().unwrap().token, "old");
    assert!(
        f.library
            .save(serde_json::from_value(update).unwrap())
            .is_err()
    );
    assert_eq!(
        f.index()
            .image(
                &f.library.preferences.lock().unwrap(),
                "首页.md",
                "shared.png"
            )
            .unwrap()
            .0,
        b"shared"
    );
}
#[test]
fn sites_validate_schemes_credentials_identity_and_persist_order() {
    let f = Fixture::new();
    for url in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://a:b@example.com",
        "//example.com",
        "https://example.com\n",
    ] {
        assert!(website_url(url).is_err());
    }
    let sites = json!([{"id":"two","name":"幕布","url":"https://mubu.com/"},{"id":"one","name":"Cubox","url":"https://cubox.pro/"}]);
    f.library
        .save(serde_json::from_value(json!({"expectedRevision":1,"sites":sites})).unwrap())
        .unwrap();
    assert_eq!(f.library.snapshot()["sites"], sites);
    assert_eq!(f.library.destination("one").unwrap(), "https://cubox.pro/");
    assert!(f.library.destination("missing").is_err());
}
#[tokio::test]
async fn reader_http_rejects_main_credentials_foreign_origins_and_unscoped_writes() {
    let f = Fixture::new();
    *f.library.endpoint.lock().unwrap() = ReaderEndpoint {
        port: 12345,
        token: "reader-only".into(),
        ..Default::default()
    };
    let router = http::router(http::HttpState {
        library: f.library.clone(),
        port: 12345,
        appearance: None,
        app: None,
    });
    for (method, path, host, token, origin, status) in [
        ("GET", "/api/catalog", "127.0.0.1:12345", "", None, 401),
        (
            "GET",
            "/api/catalog",
            "127.0.0.1:12345",
            "main-token",
            None,
            401,
        ),
        (
            "GET",
            "/api/catalog",
            "evil.test:12345",
            "reader-only",
            None,
            403,
        ),
        (
            "GET",
            "/api/catalog",
            "127.0.0.1:12345",
            "reader-only",
            Some("https://evil.test"),
            403,
        ),
        (
            "POST",
            "/api/note",
            "127.0.0.1:12345",
            "reader-only",
            None,
            403,
        ),
        (
            "GET",
            "/api/settings",
            "127.0.0.1:12345",
            "reader-only",
            None,
            400,
        ),
        (
            "GET",
            "/api/catalog",
            "127.0.0.1:12345",
            "reader-only",
            None,
            200,
        ),
        (
            "GET",
            "/api/image?id=%E9%A6%96%E9%A1%B5.md&target=..%2Foutside.png",
            "127.0.0.1:12345",
            "reader-only",
            None,
            400,
        ),
    ] {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("Host", host)
            .header("Authorization", format!("Bearer {token}"));
        if let Some(origin) = origin {
            request = request.header("Origin", origin);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), status, "{method} {path} {host}");
        if status == 200 {
            assert_eq!(response.headers()["cache-control"], "no-store");
            let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
            let value: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["notes"].as_array().unwrap().len(), 4);
        }
    }
}

#[test]
fn markdown_save_is_versioned_atomic_and_keeps_newlines_permissions_and_indexes() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let p = f.library.preferences.lock().unwrap().clone();
    let file = f.vault.join("首页.md");
    std::fs::write(&file, "\u{feff}# 首页\r\n原文\r\n").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o640)).unwrap();
    let mut index = f.index();
    let version = index.note(&p, "首页.md").unwrap()["version"]
        .as_str()
        .unwrap()
        .to_owned();
    let saved = index
        .save(
            &p,
            "首页.md",
            &version,
            "# 首页\n新内容 unique-edit\n[[项目/文章]]\n",
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "\u{feff}# 首页\r\n新内容 unique-edit\r\n[[项目/文章]]\r\n"
    );
    assert_eq!(
        std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert_eq!(index.search("unique-edit", 0)["total"], 1);
    assert_eq!(
        index.note(&p, "项目/文章.md").unwrap()["backlinks"][0]["id"],
        "首页.md"
    );
    assert_ne!(saved["version"], version);
    assert!(
        index
            .save(&p, "首页.md", &version, "stale")
            .unwrap_err()
            .is::<edit::Conflict>()
    );
    assert!(!std::fs::read_dir(&f.vault).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".palboo-")
    }));
}

#[test]
fn markdown_save_refuses_external_edits_links_hidden_and_ungranted_files() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let f = Fixture::new();
    let p = f.library.preferences.lock().unwrap().clone();
    let mut index = f.index();
    let original = index.note(&p, "首页.md").unwrap();
    let version = original["version"].as_str().unwrap();
    let file = f.vault.join("首页.md");
    std::fs::write(&file, "external").unwrap();
    assert!(
        index
            .save(&p, "首页.md", version, "draft")
            .unwrap_err()
            .is::<edit::Conflict>()
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "external");
    for id in [
        "../outside.md",
        ".obsidian/秘密.md",
        "项目/附件/测试.png",
        "new.md",
    ] {
        assert!(index.save(&p, id, version, "draft").is_err());
    }
    let outside = f._dir.path().join("outside.md");
    std::fs::write(&outside, "outside").unwrap();
    std::fs::remove_file(&file).unwrap();
    symlink(&outside, &file).unwrap();
    assert!(
        index
            .save(&p, "首页.md", &edit::version(b"outside"), "draft")
            .is_err()
    );
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "outside");
    std::fs::remove_file(&file).unwrap();
    std::fs::hard_link(&outside, &file).unwrap();
    assert!(
        index
            .save(&p, "首页.md", &edit::version(b"outside"), "draft")
            .is_err()
    );
    std::fs::remove_file(&file).unwrap();
    std::fs::write(&file, "locked").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o444)).unwrap();
    assert!(
        index
            .save(&p, "首页.md", &edit::version(b"locked"), "draft")
            .is_err()
    );
}

#[test]
fn spreadsheet_catalog_resolution_and_csv_paging_are_inert() {
    let f = Fixture::new();
    let csv = "名称,数值\n\"文本,带逗号\",=1+1\n<script>alert(1)</script>,12\n";
    std::fs::write(f.vault.join("项目/表格.csv"), csv).unwrap();
    let index = f.index();
    let p = f.library.preferences.lock().unwrap().clone();
    assert_eq!(
        index.resolve("首页.md", "项目/表格.csv").unwrap().0,
        vec!["项目/表格.csv"]
    );
    assert_eq!(index.search("表格", 0)["results"][0]["kind"], "spreadsheet");
    let preview = index.workbook(&p, "项目/表格.csv", "", 1).unwrap();
    assert_eq!(preview["totalRows"], 3);
    assert_eq!(preview["rows"][0], json!(["文本,带逗号", "=1+1"]));
    assert_eq!(preview["rows"][1][0], "<script>alert(1)</script>");
    assert_eq!(
        std::fs::read_to_string(f.vault.join("项目/表格.csv")).unwrap(),
        csv
    );
}

#[tokio::test]
async fn writes_require_same_origin_and_version_and_return_conflicts() {
    let f = Fixture::new();
    *f.library.endpoint.lock().unwrap() = ReaderEndpoint {
        port: 12345,
        token: "reader-only".into(),
        ..Default::default()
    };
    let router = http::router(http::HttpState {
        library: f.library.clone(),
        port: 12345,
        appearance: None,
        app: None,
    });
    let p = f.library.preferences.lock().unwrap().clone();
    let note = f.index().note(&p, "首页.md").unwrap();
    for (origin, token, status) in [
        (None, "reader-only", 403),
        (Some("https://evil.test"), "reader-only", 403),
        (Some("http://127.0.0.1:12345"), "wrong", 401),
        (Some("http://127.0.0.1:12345"), "reader-only", 200),
        (Some("http://127.0.0.1:12345"), "reader-only", 409),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/save")
            .header("Host", "127.0.0.1:12345")
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json");
        if let Some(origin) = origin {
            request = request.header("Origin", origin);
        }
        let response=router.clone().oneshot(request.body(Body::from(json!({"id":"首页.md","expectedVersion":note["version"],"markdown":"saved through authenticated editor"}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status().as_u16(), status);
    }
}

#[test]
fn reader_endpoint_survives_restart_but_not_revoked_grants() {
    let f = Fixture::new();
    let paths = Paths::new(Some(f._dir.path().canonicalize().unwrap().join("palboo"))).unwrap();
    let p = f.library.preferences.lock().unwrap().clone();
    f.library
        .persist_endpoint(
            &p,
            &ReaderEndpoint {
                port: 12345,
                token: "a".repeat(32),
                ..Default::default()
            },
        )
        .unwrap();
    let restored = Library::load(&paths);
    assert_eq!(restored.endpoint.lock().unwrap().token, "a".repeat(32));
    restored
        .save(
            serde_json::from_value(
                json!({"expectedRevision":p.revision,"vault":f.vault.join("项目")}),
            )
            .unwrap(),
        )
        .unwrap();
    let revoked = Library::load(&paths);
    assert_ne!(revoked.endpoint.lock().unwrap().token, "a".repeat(32));
    assert_eq!(revoked.endpoint.lock().unwrap().port, 12345);
}

#[test]
fn legacy_folder_configuration_loads_without_rewriting_sources_or_settings() {
    let f = Fixture::new();
    let paths = Paths::new(Some(f._dir.path().canonicalize().unwrap().join("palboo"))).unwrap();
    let file = paths.root.join("web-library.json");
    let legacy = json!({"revision":12,"enabled":true,"vault":f.vault,"attachments":[],"sites":[]})
        .to_string();
    std::fs::write(&file, &legacy).unwrap();
    let restored = Library::load(&paths);
    assert_eq!(restored.snapshot()["folders"][0]["path"], json!(f.vault));
    assert_eq!(restored.snapshot()["folders"][0]["id"], "obsidian");
    assert_eq!(std::fs::read_to_string(file).unwrap(), legacy);
    let invalid = json!({"expectedRevision":12,"folders":[{"id":"a","name":"A","path":f.vault},{"id":"b","name":"B","path":f.vault}]});
    assert!(
        restored
            .save(serde_json::from_value(invalid).unwrap())
            .is_err()
    );
    assert_eq!(restored.snapshot()["revision"], 12);
}

#[tokio::test]
async fn multiple_folder_tabs_isolate_reads_writes_tokens_and_revocation() {
    let f = Fixture::new();
    f.library.endpoint.lock().unwrap().port = 12345;
    let first_url = f.library.destination("obsidian").unwrap();
    let token = first_url.split("#reader=").nth(1).unwrap().to_owned();
    let other = f._dir.path().canonicalize().unwrap().join("其他笔记库");
    std::fs::create_dir(&other).unwrap();
    std::fs::write(other.join("首页.md"), "# other folder\nsecond-only").unwrap();
    let mut folders = f.library.snapshot()["folders"].as_array().unwrap().clone();
    folders.push(json!({"id":"second","name":"Other","path":other,"attachments":[]}));
    f.library
        .save(serde_json::from_value(json!({"expectedRevision":1,"folders":folders})).unwrap())
        .unwrap();
    assert_eq!(f.library.destination("obsidian").unwrap(), first_url);
    let second_url = f.library.destination("folder:second").unwrap();
    let second_token = second_url.split("#reader=").nth(1).unwrap().to_owned();
    assert_ne!(token, second_token);
    let paths = Paths::new(Some(f._dir.path().canonicalize().unwrap().join("palboo"))).unwrap();
    assert_eq!(
        Library::load(&paths).destination("folder:second").unwrap(),
        second_url
    );
    let router = http::router(http::HttpState {
        library: f.library.clone(),
        port: 12345,
        appearance: None,
        app: None,
    });
    async fn request(
        router: &axum::Router,
        path: &str,
        folder: &str,
        token: &str,
        body: Option<Value>,
    ) -> (u16, Value) {
        let mut request = Request::builder()
            .method(if body.is_some() { "POST" } else { "GET" })
            .uri(path)
            .header("Host", "127.0.0.1:12345")
            .header("Origin", "http://127.0.0.1:12345")
            .header("X-Palboo-Folder", folder)
            .header("Authorization", format!("Bearer {token}"));
        let payload = if let Some(body) = body {
            request = request.header("Content-Type", "application/json");
            Body::from(body.to_string())
        } else {
            Body::empty()
        };
        let response = router
            .clone()
            .oneshot(request.body(payload).unwrap())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    assert_eq!(
        request(&router, "/api/catalog", "second", &token, None)
            .await
            .0,
        401
    );
    let (status, first) = request(
        &router,
        "/api/note?id=%E9%A6%96%E9%A1%B5.md",
        "obsidian",
        &token,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert!(first["markdown"].as_str().unwrap().contains("needle"));
    let (status, second) = request(
        &router,
        "/api/note?id=%E9%A6%96%E9%A1%B5.md",
        "second",
        &second_token,
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert!(second["markdown"].as_str().unwrap().contains("second-only"));
    assert_eq!(request(&router,"/api/save","second",&second_token,Some(json!({"id":"首页.md","expectedVersion":second["version"],"markdown":"saved in second"}))).await.0,200);
    assert_eq!(
        std::fs::read_to_string(f.vault.join("首页.md")).unwrap(),
        first["markdown"].as_str().unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(other.join("首页.md")).unwrap(),
        "saved in second"
    );
    let (status, destination) = request(
        &router,
        "/api/folder-open",
        "obsidian",
        &token,
        Some(json!({"id":"second"})),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(destination["url"], second_url);
    folders.reverse();
    folders[0]["name"] = json!("Renamed");
    f.library
        .save(serde_json::from_value(json!({"expectedRevision":2,"folders":folders})).unwrap())
        .unwrap();
    assert_eq!(f.library.destination("folder:obsidian").unwrap(), first_url);
    assert_eq!(f.library.destination("folder:second").unwrap(), second_url);
    assert_eq!(
        request(&router, "/api/catalog", "obsidian", &token, None)
            .await
            .0,
        200
    );
    folders.remove(0);
    f.library
        .save(serde_json::from_value(json!({"expectedRevision":3,"folders":folders})).unwrap())
        .unwrap();
    assert_eq!(
        request(&router, "/api/catalog", "second", &second_token, None)
            .await
            .0,
        401
    );
    assert_eq!(
        request(&router, "/api/catalog", "obsidian", &token, None)
            .await
            .0,
        200
    );
    assert_eq!(
        std::fs::read_to_string(other.join("首页.md")).unwrap(),
        "saved in second"
    );
    assert_eq!(f.library.indexes.lock().unwrap().len(), 1);
}
