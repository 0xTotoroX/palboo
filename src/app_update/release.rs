// [INPUT]: 固定公开仓库的稳定 Release 与 GitHub 提供的附件摘要。
// [OUTPUT]: Release/Asset、fetch、download；有界下载及 SHA-256 校验。
// [POS]: 手动更新的唯一外网入口，不读令牌、不接受用户提供的下载地址。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::app_transition::Progress;
use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

const REPOSITORY: &str = "https://github.com/0xTotoroX/palboo";
const MAX_ASSET: u64 = 256 * 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub id: u64,
    pub version: String,
    pub url: String,
    pub asset: Option<Asset>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: u64,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}
fn client(timeout: u64) -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("Palboo/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .timeout(Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && url.port_or_known_default() == Some(443)
                && url.username().is_empty()
                && url.password().is_none()
                && matches!(
                    url.host_str(),
                    Some(
                        "api.github.com"
                            | "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("更新地址不受信任")
            }
        }))
        .build()?)
}
pub fn parse(value: &Value) -> Result<Release> {
    ensure!(
        value["draft"] == false && value["prerelease"] == false,
        "更新不是已公开的正式版本"
    );
    let tag = value["tag_name"].as_str().context("更新版本无效")?;
    let version = Version::parse(tag.strip_prefix('v').context("更新标签无效")?)?;
    ensure!(
        version.pre.is_empty() && version.build.is_empty() && tag == format!("v{version}"),
        "更新标签无效"
    );
    let version = version.to_string();
    let expected_name = format!("palboo-{version}-darwin-arm64.dmg");
    let assets = value["assets"].as_array().context("更新附件信息无效")?;
    let found: Vec<_> = assets
        .iter()
        .filter(|asset| asset["name"] == expected_name)
        .collect();
    ensure!(found.len() <= 1, "更新附件重复，未选择安装包");
    let asset = found
        .first()
        .map(|asset| -> Result<Asset> {
            let url = format!("{REPOSITORY}/releases/download/{tag}/{expected_name}");
            ensure!(
                asset["browser_download_url"] == url && asset["state"] == "uploaded",
                "更新附件来源或状态无效"
            );
            let size = asset["size"].as_u64().context("更新附件大小无效")?;
            ensure!(size > 0 && size <= MAX_ASSET, "更新附件大小超出限制");
            let sha256 = asset["digest"]
                .as_str()
                .and_then(|v| v.strip_prefix("sha256:"))
                .context("更新缺少 SHA-256 校验值")?;
            ensure!(
                sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit()),
                "更新校验值无效"
            );
            Ok(Asset {
                id: asset["id"]
                    .as_u64()
                    .filter(|id| *id > 0)
                    .context("更新附件身份无效")?,
                url,
                size,
                sha256: sha256.to_ascii_lowercase(),
            })
        })
        .transpose()?;
    Ok(Release {
        id: value["id"]
            .as_u64()
            .filter(|id| *id > 0)
            .context("更新身份无效")?,
        url: format!("{REPOSITORY}/releases/tag/{tag}"),
        version,
        asset,
    })
}
pub async fn fetch() -> Result<Release> {
    let response = client(20)?
        .get("https://api.github.com/repos/0xTotoroX/palboo/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .context("无法连接 GitHub，请稍后重试")?;
    ensure!(
        response.status().is_success(),
        "GitHub 更新检查失败（{}），请稍后重试",
        response.status().as_u16()
    );
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(bytes.len() + chunk.len() <= 2 * 1024 * 1024, "更新信息过大");
        bytes.extend_from_slice(&chunk);
    }
    parse(&serde_json::from_slice(&bytes)?)
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
    fn release() -> Value {
        json!({"id":7,"tag_name":"v1.3.0","draft":false,"prerelease":false,"assets":[{"id":8,"name":"palboo-1.3.0-darwin-arm64.dmg","size":100,"state":"uploaded","digest":format!("sha256:{}", "a".repeat(64)),"browser_download_url":"https://github.com/0xTotoroX/palboo/releases/download/v1.3.0/palboo-1.3.0-darwin-arm64.dmg"}]})
    }
    #[test]
    fn accepts_exact_published_asset_and_distinguishes_source_only_releases() {
        assert_eq!(parse(&release()).unwrap().asset.unwrap().size, 100);
        let mut source_only = release();
        source_only["assets"] = json!([]);
        assert!(parse(&source_only).unwrap().asset.is_none());
    }
    #[test]
    fn rejects_untrusted_incomplete_and_ambiguous_updates() {
        for (field, value) in [
            ("draft", json!(true)),
            ("prerelease", json!(true)),
            ("tag_name", json!("v1.3.0-beta.1")),
            ("tag_name", json!("v01.3.0")),
        ] {
            let mut item = release();
            item[field] = value;
            assert!(parse(&item).is_err());
        }
        for (field, value) in [
            (
                "browser_download_url",
                json!("https://example.com/palboo.dmg"),
            ),
            ("state", json!("new")),
            ("size", json!(MAX_ASSET + 1)),
            ("digest", json!(null)),
        ] {
            let mut item = release();
            item["assets"][0][field] = value;
            assert!(parse(&item).is_err());
        }
        let mut item = release();
        item["assets"] = json!([item["assets"][0], item["assets"][0]]);
        assert!(parse(&item).is_err());
    }
    #[tokio::test]
    async fn downloads_require_exact_length_and_digest_and_never_overwrite_files() {
        let root = tempfile::tempdir().unwrap();
        let bytes = b"synthetic signed distribution";
        let mut asset = parse(&release()).unwrap().asset.unwrap();
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
                "Verified public release v{}; asset {} ({} bytes)",
                release.version, asset.id, asset.size
            );
        } else {
            println!(
                "Public release v{} is source-only; no installation offered",
                release.version
            );
        }
    }
}
