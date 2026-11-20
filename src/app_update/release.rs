// [INPUT]: 固定公开仓库的稳定 Release 清单与对应 DMG。
// [OUTPUT]: Release/Asset、fetch、download；有界下载及 SHA-256 校验。
// [POS]: 手动更新的唯一外网入口，不读令牌、不接受用户提供的下载地址。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::app_transition::Progress;
use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

const REPOSITORY: &str = "https://github.com/0xTotoroX/palboo";
const MANIFEST_URL: &str =
    "https://github.com/0xTotoroX/palboo/releases/latest/download/update.json";
const MAX_MANIFEST: usize = 16 * 1024;
const MAX_ASSET: u64 = 256 * 1024 * 1024;
#[derive(Serialize)]
pub struct Release {
    pub version: String,
    pub url: String,
    pub asset: Option<Asset>,
}
#[derive(Serialize, Deserialize)]
pub struct Asset {
    pub url: String,
    pub size: u64,
    pub sha256: String,
}
#[derive(Deserialize)]
struct Manifest {
    schema: u32,
    version: String,
    asset: Option<Asset>,
}

fn trusted_redirect(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && match url.host_str() {
            Some("github.com") => url
                .path()
                .starts_with("/0xTotoroX/palboo/releases/download/"),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => true,
            _ => false,
        }
}
fn client(timeout: u64) -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("Palboo/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .timeout(Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && trusted_redirect(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("更新地址不受信任")
            }
        }))
        .build()?)
}
fn parse(bytes: &[u8]) -> Result<Release> {
    let Manifest {
        schema,
        version,
        mut asset,
    } = serde_json::from_slice(bytes).context("更新清单无效")?;
    ensure!(schema == 1, "更新清单版本不受支持");
    let parsed = Version::parse(&version).context("更新版本无效")?;
    ensure!(
        parsed.pre.is_empty() && parsed.to_string() == version,
        "更新版本无效"
    );
    if let Some(asset) = &mut asset {
        ensure!(
            asset.url
                == format!(
                    "{REPOSITORY}/releases/download/v{version}/palboo-{version}-darwin-arm64.dmg"
                ),
            "更新附件来源无效"
        );
        ensure!(
            asset.size > 0 && asset.size <= MAX_ASSET,
            "更新附件大小超出限制"
        );
        ensure!(
            asset.sha256.len() == 64 && asset.sha256.bytes().all(|b| b.is_ascii_hexdigit()),
            "更新校验值无效"
        );
        asset.sha256.make_ascii_lowercase();
    }
    Ok(Release {
        url: format!("{REPOSITORY}/releases/tag/v{version}"),
        version,
        asset,
    })
}
pub async fn fetch() -> Result<Release> {
    fetch_manifest(client(20)?.get(MANIFEST_URL)).await
}

async fn fetch_manifest(request: reqwest::RequestBuilder) -> Result<Release> {
    let response = request
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .context("无法连接 GitHub，请稍后重试")?;
    ensure!(
        response.status() != reqwest::StatusCode::NOT_FOUND,
        "当前发布版没有更新清单，请到 GitHub 发布页查看。"
    );
    ensure!(
        response.status().is_success(),
        "GitHub 更新检查失败（{}），请稍后重试",
        response.status().as_u16()
    );
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(bytes.len() + chunk.len() <= MAX_MANIFEST, "更新信息过大");
        bytes.extend_from_slice(&chunk);
    }
    parse(&bytes)
}
pub async fn download(asset: &Asset, destination: &Path, progress: &Progress) -> Result<()> {
    let response = client(300)?
        .get(&asset.url)
        .send()
        .await?
        .error_for_status()?;
    if let Some(size) = response.content_length() {
        ensure!(size == asset.size, "下载大小与发布信息不符");
    }
    write_download(asset, destination, progress, response.bytes_stream()).await
}
async fn write_download<S, B, E>(
    asset: &Asset,
    destination: &Path,
    progress: &Progress,
    mut stream: S,
) -> Result<()>
where
    S: futures_util::Stream<Item = std::result::Result<B, E>> + Unpin,
    B: AsRef<[u8]>,
    E: std::error::Error + Send + Sync + 'static,
{
    ensure!(
        asset.size > 0 && asset.size <= MAX_ASSET,
        "更新附件大小超出限制"
    );
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .await?;
    let mut digest = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let chunk = chunk.as_ref();
        received += chunk.len() as u64;
        ensure!(received <= asset.size, "下载大小超出发布信息");
        digest.update(chunk);
        file.write_all(chunk).await?;
        *progress.write().await = json!({"phase":"downloading","message":format!("{} {}%", crate::i18n::text("正在下载更新…", "Downloading update…"), received * 100 / asset.size)});
    }
    file.sync_all().await?;
    ensure!(
        received == asset.size && format!("{:x}", digest.finalize()) == asset.sha256,
        "下载校验失败，原 App 保持不变"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn manifest() -> Value {
        json!({"schema":1,"version":"1.3.0","asset":{"size":100,"sha256":"a".repeat(64),"url":"https://github.com/0xTotoroX/palboo/releases/download/v1.3.0/palboo-1.3.0-darwin-arm64.dmg"}})
    }
    fn parse_json(value: &Value) -> Result<Release> {
        parse(&serde_json::to_vec(value).unwrap())
    }
    #[test]
    fn accepts_exact_published_asset_and_distinguishes_source_only_manifests() {
        let mut item = manifest();
        item["asset"]["sha256"] = json!("A".repeat(64));
        let release = parse_json(&item).unwrap();
        assert_eq!(release.url, format!("{REPOSITORY}/releases/tag/v1.3.0"));
        let asset = release.asset.unwrap();
        assert_eq!(asset.size, 100);
        assert_eq!(asset.sha256, "a".repeat(64));
        item["asset"] = Value::Null;
        assert!(parse_json(&item).unwrap().asset.is_none());
    }
    #[test]
    fn rejects_untrusted_or_invalid_manifests() {
        for (field, value) in [
            ("schema", json!(2)),
            ("version", json!("1.3.0-beta.1")),
            ("version", json!("01.3.0")),
            ("version", json!("1.4.0")),
        ] {
            let mut item = manifest();
            item[field] = value;
            assert!(parse_json(&item).is_err());
        }
        for (field, value) in [
            ("url", json!("https://example.com/palboo.dmg")),
            ("size", json!(0)),
            ("size", json!(MAX_ASSET + 1)),
            ("sha256", json!(null)),
            ("sha256", json!("g".repeat(64))),
        ] {
            let mut item = manifest();
            item["asset"][field] = value;
            assert!(parse_json(&item).is_err());
        }
        assert!(parse(b"<html>Gateway</html>").is_err());
    }

    #[test]
    fn only_official_download_routes_can_be_followed() {
        for (url, trusted) in [
            (
                "https://github.com/0xTotoroX/palboo/releases/download/v1.3.0/update.json",
                true,
            ),
            ("https://release-assets.githubusercontent.com/file", true),
            (
                "https://github.com/other/palboo/releases/download/v1.3.0/update.json",
                false,
            ),
            (
                "https://api.github.com/repos/0xTotoroX/palboo/releases/latest",
                false,
            ),
            (
                "https://user@release-assets.githubusercontent.com/file",
                false,
            ),
            ("http://release-assets.githubusercontent.com/file", false),
            (
                "https://release-assets.githubusercontent.com:8080/file",
                false,
            ),
        ] {
            assert_eq!(
                trusted_redirect(&reqwest::Url::parse(url).unwrap()),
                trusted,
                "{url}"
            );
        }
    }

    #[tokio::test]
    async fn checks_static_manifest_when_api_returns_403() {
        use axum::{Router, http::StatusCode, routing::get};
        let url = reqwest::Url::parse(MANIFEST_URL).unwrap();
        assert_eq!(url.host_str(), Some("github.com"));
        let app = Router::new()
            .route(
                url.path(),
                get(|headers: axum::http::HeaderMap| async move {
                    assert_eq!(headers["cache-control"], "no-cache");
                    axum::Json(manifest())
                }),
            )
            .route(
                "/repos/0xTotoroX/palboo/releases/latest",
                get(|| async { StatusCode::FORBIDDEN }),
            )
            .route("/too-large", get(|| async { " ".repeat(MAX_MANIFEST + 1) }));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(axum::serve(listener, app).into_future());
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            client
                .get(format!("{origin}/repos/0xTotoroX/palboo/releases/latest"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let release = fetch_manifest(client.get(format!("{origin}{}", url.path())))
            .await
            .unwrap();
        assert_eq!(release.version, "1.3.0");
        assert_eq!(release.asset.unwrap().sha256, "a".repeat(64));
        let error = fetch_manifest(client.get(format!("{origin}/missing")))
            .await
            .err()
            .unwrap();
        assert!(error.to_string().contains("没有更新清单"));
        let error = fetch_manifest(client.get(format!("{origin}/too-large")))
            .await
            .err()
            .unwrap();
        assert!(error.to_string().contains("更新信息过大"));
        server.abort();
    }
    #[tokio::test]
    async fn downloads_require_exact_length_and_digest_and_never_overwrite_files() {
        let root = tempfile::tempdir().unwrap();
        let bytes = b"synthetic signed distribution";
        let mut asset = parse_json(&manifest()).unwrap().asset.unwrap();
        asset.size = bytes.len() as u64;
        asset.sha256 = format!("{:x}", Sha256::digest(bytes));
        let progress = std::sync::Arc::new(tokio::sync::RwLock::new(Value::Null));
        for (name, content, valid) in [
            ("valid", bytes.as_slice(), true),
            ("short", &bytes[..5], false),
            ("corrupt", b"synthetic signed distributioN", false),
            ("large", b"synthetic signed distributionEXTRA", false),
        ] {
            let stream = futures_util::stream::iter(content.chunks(4).map(Ok::<_, std::io::Error>));
            let path = root.path().join(name);
            assert_eq!(
                write_download(&asset, &path, &progress, stream)
                    .await
                    .is_ok(),
                valid
            );
        }
        let file = root.path().join("existing");
        std::fs::write(&file, "keep").unwrap();
        let stream = futures_util::stream::iter([Ok::<_, std::io::Error>(bytes)]);
        assert!(
            write_download(&asset, &file, &progress, stream)
                .await
                .is_err()
        );
        assert_eq!(std::fs::read(&file).unwrap(), b"keep");
        let stream = futures_util::stream::iter([
            Ok(bytes.as_slice()),
            Err(std::io::Error::other("connection interrupted")),
        ]);
        assert!(
            write_download(&asset, &root.path().join("interrupted"), &progress, stream)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    #[ignore = "explicit public GitHub network check; temporary download only, never installs"]
    async fn checks_official_release_and_verifies_published_download() {
        let release = fetch().await.unwrap();
        let root = tempfile::tempdir().unwrap();
        let progress = std::sync::Arc::new(tokio::sync::RwLock::new(Value::Null));
        if let Some(asset) = release.asset {
            download(&asset, &root.path().join("distribution.dmg"), &progress)
                .await
                .unwrap();
            println!(
                "Verified public release v{} ({} bytes)",
                release.version, asset.size
            );
        } else {
            println!(
                "Public release v{} is source-only; no installation offered",
                release.version
            );
        }
    }
}
