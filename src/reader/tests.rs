// [INPUT]: Synthetic vaults, local-only router and reader-specific authorization.
// [OUTPUT]: Read-only/hash, search/link/image, traversal/symlink and HTTP boundary regression tests.
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
async fn reader_http_never_accepts_main_credentials_foreign_origins_or_writes() {
    let f = Fixture::new();
    *f.library.endpoint.lock().unwrap() = ReaderEndpoint {
        port: 12345,
        token: "reader-only".into(),
    };
    let router = http::router(http::HttpState {
        library: f.library.clone(),
        port: 12345,
        appearance: None,
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
            405,
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
