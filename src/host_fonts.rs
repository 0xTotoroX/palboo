// [INPUT]: 本机已安装宿主的 App 身份、ASAR 索引及 CSS 字体声明。
// [OUTPUT]: 有界、按文件身份缓存的 OpenAI 字体目录与 WOFF2 字节，供认证设置页按需加载。
// [POS]: 只读本机资源；不接受文件路径、不安装字体、不联网、不随 Palboo 分发字体。
// [PROTOCOL]: 变更时同步 src/AGENTS.md 和设置页字体契约。
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

const MAX_HEADER: usize = 16 * 1024 * 1024;
const MAX_CSS: usize = 8 * 1024 * 1024;
const MAX_CSS_TOTAL: usize = 48 * 1024 * 1024;
const MAX_FONT: usize = 2 * 1024 * 1024;
const FACES: [(&str, &str, u16); 4] = [
    ("openai-sans-regular", "OpenAI Sans", 400),
    ("openai-sans-medium", "OpenAI Sans", 500),
    ("openai-sans-semibold", "OpenAI Sans", 600),
    ("openai-serif-light", "OpenAI Serif", 300),
];

#[derive(Clone, Serialize)]
pub struct FontInfo {
    id: &'static str,
    family: &'static str,
    weight: u16,
    style: &'static str,
}

struct Font {
    info: FontInfo,
    bytes: Arc<[u8]>,
}
#[derive(Default)]
struct Catalog {
    fonts: Vec<Font>,
}

#[derive(PartialEq)]
struct Source {
    app: PathBuf,
    archive: PathBuf,
    length: u64,
    modified: SystemTime,
    plist_modified: SystemTime,
}

type CachedCatalog = Option<(Source, Arc<Catalog>)>;
static CACHE: OnceLock<Mutex<CachedCatalog>> = OnceLock::new();

pub fn list() -> Vec<FontInfo> {
    catalog()
        .fonts
        .iter()
        .map(|font| font.info.clone())
        .collect()
}

pub fn font(id: &str) -> Option<Arc<[u8]>> {
    if !FACES.iter().any(|face| face.0 == id) {
        return None;
    }
    catalog()
        .fonts
        .iter()
        .find(|font| font.info.id == id)
        .map(|font| font.bytes.clone())
}

fn source() -> Option<Source> {
    let executable = crate::host::find_desktop()?.canonicalize().ok()?;
    let app = crate::host_launch::bundled_application(&executable)?;
    let archive = app.join("Contents/Resources/app.asar");
    let canonical = archive.canonicalize().ok()?;
    // Refuse resources redirected outside the recognized application bundle.
    if !canonical.starts_with(&app) {
        return None;
    }
    let metadata = fs::metadata(&canonical).ok()?;
    metadata.is_file().then_some(Source {
        plist_modified: fs::metadata(app.join("Contents/Info.plist"))
            .ok()?
            .modified()
            .ok()?,
        app,
        archive: canonical,
        length: metadata.len(),
        modified: metadata.modified().ok()?,
    })
}

fn catalog() -> Arc<Catalog> {
    let Some(source) = source() else {
        return Arc::default();
    };
    let Ok(mut cache) = CACHE.get_or_init(|| Mutex::new(None)).lock() else {
        return Arc::default();
    };
    if let Some((previous, catalog)) = cache.as_ref()
        && previous == &source
    {
        return catalog.clone();
    }
    // A failed or unsupported bundle is cached too; no repeated parsing on requests.
    let catalog = Arc::new(load_bundle(&source).unwrap_or_default());
    *cache = Some((source, catalog.clone()));
    catalog
}

fn load_bundle(source: &Source) -> Result<Catalog> {
    let identity = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
        .arg(source.app.join("Contents/Info.plist"))
        .output()?;
    ensure!(identity.status.success(), "Host identity unavailable");
    ensure!(
        matches!(
            String::from_utf8_lossy(&identity.stdout).trim(),
            "com.openai.codex" | "com.openai.chat"
        ),
        "Unsupported host"
    );
    read_archive(&source.archive)
}

fn member(file: &mut File, base: u64, entry: &Value, limit: usize) -> Result<Vec<u8>> {
    ensure!(
        entry.get("unpacked").is_none() && entry.get("link").is_none(),
        "External ASAR member"
    );
    let size = entry["size"].as_u64().context("Missing member size")?;
    ensure!(
        size > 0 && size <= limit as u64,
        "Member size exceeds limit"
    );
    let offset = entry["offset"]
        .as_str()
        .context("Missing member offset")?
        .parse::<u64>()?;
    let start = base.checked_add(offset).context("Invalid member offset")?;
    ensure!(
        start
            .checked_add(size)
            .is_some_and(|end| end <= file.metadata().map(|m| m.len()).unwrap_or(0)),
        "Member outside archive"
    );
    ensure!(
        entry["integrity"]["algorithm"] == "SHA256",
        "Missing integrity"
    );
    let expected = entry["integrity"]["hash"]
        .as_str()
        .context("Missing hash")?;
    let mut bytes = vec![0; size as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut bytes)?;
    ensure!(
        format!("{:x}", Sha256::digest(&bytes)) == expected,
        "Member hash mismatch"
    );
    Ok(bytes)
}

fn local_asset(name: &str, extension: &str) -> bool {
    name.len() <= 160
        && name.ends_with(extension)
        && !name.contains("..")
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
}

// Parse only the packaged declarations we support. Unknown CSS syntax simply
// leaves the browser's ordinary fallback in place; never resolve external URLs.
fn declarations(css: &str) -> Result<BTreeMap<usize, String>> {
    let mut faces = BTreeMap::new();
    for rule in css.split("@font-face").skip(1) {
        let Some(rule) = rule
            .trim_start()
            .strip_prefix('{')
            .and_then(|r| r.split('}').next())
        else {
            continue;
        };
        let props: BTreeMap<_, _> = rule
            .split(';')
            .filter_map(|v| v.split_once(':'))
            .map(|(k, v)| (k.trim(), v.trim().trim_matches(['\'', '"'])))
            .collect();
        let Some(index) = FACES.iter().position(|(_, family, weight)| {
            props.get("font-family") == Some(family)
                && props.get("font-weight").and_then(|w| w.parse::<u16>().ok()) == Some(*weight)
                && props
                    .get("font-style")
                    .is_none_or(|style| *style == "normal")
        }) else {
            continue;
        };
        let Some(src) = props
            .get("src")
            .and_then(|s| s.strip_prefix("url("))
            .and_then(|s| s.split(')').next())
        else {
            continue;
        };
        let src = src.trim().trim_matches(['\'', '"']);
        let name = src.strip_prefix("./").unwrap_or(src);
        if !local_asset(name, ".woff2") {
            continue;
        }
        if let Some(previous) = faces.insert(index, name.to_owned()) {
            ensure!(previous == name, "Ambiguous font face");
        }
    }
    Ok(faces)
}

fn read_archive(path: &Path) -> Result<Catalog> {
    let mut file = File::open(path)?;
    let mut prefix = [0u8; 16];
    file.read_exact(&mut prefix)?;
    let u32_at =
        |offset| u32::from_le_bytes(prefix[offset..offset + 4].try_into().unwrap()) as usize;
    let header_size = u32_at(4);
    let json_size = u32_at(12);
    ensure!(
        u32_at(0) == 4 && json_size > 0 && header_size <= MAX_HEADER,
        "Invalid ASAR header"
    );
    ensure!(
        json_size.checked_add(8).is_some_and(|n| n <= header_size),
        "Invalid header length"
    );
    let base = 8 + header_size as u64;
    ensure!(base <= file.metadata()?.len(), "Truncated archive");
    let mut bytes = vec![0; json_size];
    file.read_exact(&mut bytes)?;
    let header: Value = serde_json::from_slice(&bytes)?;
    let assets = header
        .pointer("/files/webview/files/assets/files")
        .and_then(Value::as_object)
        .context("No webview assets")?;
    let mut faces = BTreeMap::new();
    let mut total = 0usize;
    for (name, entry) in assets {
        if !local_asset(name, ".css") {
            continue;
        }
        let size = entry["size"].as_u64().context("Missing CSS size")?;
        ensure!(size <= MAX_CSS as u64, "CSS too large");
        total = total
            .checked_add(size as usize)
            .context("CSS budget overflow")?;
        ensure!(total <= MAX_CSS_TOTAL, "CSS budget exceeded");
        let css = member(&mut file, base, entry, MAX_CSS)?;
        for (index, name) in declarations(std::str::from_utf8(&css)?)? {
            if let Some(previous) = faces.insert(index, name.clone()) {
                ensure!(previous == name, "Ambiguous font mapping");
            }
        }
    }
    let mut fonts = Vec::new();
    for (index, name) in faces {
        let entry = assets.get(&name).context("Font member missing")?;
        let bytes = member(&mut file, base, entry, MAX_FONT)?;
        if bytes.len() < 48 || &bytes[..4] != b"wOF2" {
            bail!("Invalid WOFF2 signature");
        }
        let (id, family, weight) = FACES[index];
        fonts.push(Font {
            info: FontInfo {
                id,
                family,
                weight,
                style: "normal",
            },
            bytes: bytes.into(),
        });
    }
    Ok(Catalog { fonts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(css: &str, invalid: Option<&str>) -> tempfile::NamedTempFile {
        use std::io::Write;
        let mut font = vec![0u8; 64];
        font[..4].copy_from_slice(b"wOF2");
        let mut entries = serde_json::Map::new();
        let mut body = Vec::new();
        for (name, bytes) in [
            ("style.css", css.as_bytes()),
            ("abc123.woff2", font.as_slice()),
        ] {
            let mut entry = json!({
                "offset": body.len().to_string(), "size": bytes.len(),
                "integrity": {"algorithm": "SHA256", "hash": format!("{:x}", Sha256::digest(bytes))}
            });
            if name.ends_with("woff2") {
                match invalid {
                    Some("hash") => entry["integrity"]["hash"] = json!("0".repeat(64)),
                    Some("offset") => entry["offset"] = json!(u64::MAX.to_string()),
                    Some("size") => entry["size"] = json!(MAX_FONT + 1),
                    Some("link") => entry["link"] = json!("/etc/passwd"),
                    Some("unpacked") => entry["unpacked"] = json!(true),
                    _ => {}
                }
            }
            entries.insert(name.into(), entry);
            body.extend_from_slice(bytes);
        }
        let header = serde_json::to_vec(
            &json!({"files":{"webview":{"files":{"assets":{"files":entries}}}}}),
        )
        .unwrap();
        let size = (header.len() + 8).next_multiple_of(4);
        let mut file = tempfile::NamedTempFile::new().unwrap();
        for value in [4, size as u32, size as u32 - 4, header.len() as u32] {
            file.write_all(&value.to_le_bytes()).unwrap();
        }
        file.write_all(&header).unwrap();
        file.write_all(&vec![0; size - 8 - header.len()]).unwrap();
        file.write_all(&body).unwrap();
        file
    }

    const CSS: &str = "@font-face{font-family:'OpenAI Sans';font-style:normal;font-weight:400;src:url('./abc123.woff2') format('woff2')}";

    #[test]
    fn resolves_only_declared_supported_fonts_with_verified_bytes() {
        let file = fixture(CSS, None);
        let catalog = read_archive(file.path()).unwrap();
        assert_eq!(catalog.fonts.len(), 1);
        assert_eq!(catalog.fonts[0].info.id, "openai-sans-regular");
        assert_eq!(&catalog.fonts[0].bytes[..4], b"wOF2");
        for css in [
            CSS.replace("OpenAI Sans", "Unrelated Font"),
            CSS.replace("./abc123.woff2", "../abc123.woff2"),
            CSS.replace("./abc123.woff2", "https://example.com/abc123.woff2"),
            CSS.replace("./abc123.woff2", "/etc/passwd"),
        ] {
            assert!(
                read_archive(fixture(&css, None).path())
                    .unwrap()
                    .fonts
                    .is_empty()
            );
        }
        assert!(font("../../style.css").is_none());
    }

    #[test]
    fn rejects_corruption_external_members_and_ambiguous_faces() {
        for invalid in ["hash", "offset", "size", "link", "unpacked"] {
            assert!(
                read_archive(fixture(CSS, Some(invalid)).path()).is_err(),
                "{invalid}"
            );
        }
        let duplicate = format!("{CSS}{}", CSS.replace("abc123", "different"));
        assert!(declarations(&duplicate).is_err());
        let file = fixture(CSS, None);
        file.as_file().set_len(18).unwrap();
        assert!(read_archive(file.path()).is_err());
    }

    #[test]
    #[ignore = "read-only acceptance against the locally installed App, no font files emitted"]
    fn installed_host_font_catalog_is_readable() {
        let fonts = list();
        assert_eq!(
            fonts.len(),
            4,
            "expected locally verified OpenAI Sans/Serif faces"
        );
        for face in fonts {
            assert!(font(face.id).is_some());
        }
    }
}
