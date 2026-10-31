// [INPUT]: Fresh account-verified catalog and one explicitly selected Bot's local transcript.
// [OUTPUT]: Latest delivered reply text; never writes caches, reads credentials or advances BDK cursors.
// [POS]: On-demand Bot reader. [PROTOCOL]: Keep features/AGENTS.md in sync.
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

const SYNC: &str = "请先在 Grok Bot 中打开此 Bot，同步完整回答后重试。";
const CHANGED: &str = "Bot 资料已变化，请返回最近消息后重试。";
const FORMAT: &str = "Grok Bot 回答格式已变化，请更新接入。";

fn cache_file(root: &Path, key: &str) -> PathBuf {
    let alphabet = b"abcdefghijklmnopqrstuvwxyz234567";
    let (mut bits, mut value) = (0, 0u32);
    let mut out = String::new();
    for byte in key.bytes() {
        value = (value << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(alphabet[((value >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(alphabet[((value << (5 - bits)) & 31) as usize] as char);
    }
    root.join(format!("{out}.blob"))
}

fn signature(path: &Path) -> Result<(u64, u64, i64, i64, i64, i64)> {
    let m = fs::metadata(path).context(SYNC)?;
    Ok((
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    ))
}

pub fn read(root: &Path, catalog: &Value, input: &Value) -> Result<Value> {
    ensure!(
        catalog["stale"] == false && catalog["revision"] == input["revision"],
        "{CHANGED}"
    );
    let bot = catalog["bots"]
        .as_array()
        .and_then(|bots| {
            bots.iter().find(|b| {
                b["id"] == input["botId"]
                    && b["name"] == input["agent"]
                    && b["available"] == true
                    && b["hidden"] != true
            })
        })
        .context(CHANGED)?;
    let id = bot["id"].as_str().context(CHANGED)?;
    let mut observed = Vec::new();
    let mut read = |key: &str, version: u64, limit: u64| -> Result<Value> {
        let path = cache_file(root, key);
        let before = signature(&path)?;
        ensure!(before.1 <= limit, "{SYNC}");
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .context(SYNC)?
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .context(SYNC)?;
        ensure!(bytes.len() as u64 <= limit, "{SYNC}");
        ensure!(signature(&path)? == before, "{CHANGED}");
        let data: Value = serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!(FORMAT))?;
        ensure!(data["schemaVersion"] == version, "{FORMAT}");
        observed.push((path, before));
        Ok(data["value"].clone())
    };
    let slot = read("sand.client.slice.client-meta.account-slot", 1, 4096)?;
    let slot = slot.as_str().context(CHANGED)?;
    ensure!(
        catalog["account"] == format!("{:x}", Sha256::digest(slot.as_bytes())),
        "{CHANGED}"
    );
    // Match encodeURIComponent used by the account-scoped application cache.
    let encoded: String = slot
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let prefix = format!("sand.client.slice.account.{encoded}.");
    let roster = read(&format!("{prefix}roster.last-roster"), 4, 2_000_000)?;
    let row = roster["rows"]
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|r| r["id"] == id && r["name"] == bot["name"])
        })
        .context(CHANGED)?;
    let transcript = read(&format!("{prefix}transcript.replicas.{id}"), 1, 8_000_000)?;
    let result = latest(&transcript, row)?;
    for (path, stamp) in observed {
        ensure!(signature(&path)? == stamp, "{CHANGED}");
    }
    Ok(
        json!({"botId":id,"agent":bot["name"],"revision":catalog["revision"],
        "messageId":result.0,"text":result.1,"hasAttachments":result.2}),
    )
}

fn latest(transcript: &Value, row: &Value) -> Result<(String, String, bool)> {
    let entries = transcript["entries"].as_array().context(FORMAT)?;
    let newest = row["newestEntryId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .context(SYNC)?;
    ensure!(entries.iter().any(|e| e["id"] == newest), "{SYNC}");
    ensure!(entries.windows(2).all(|pair| matches!((pair[0]["seq"].as_u64(), pair[1]["seq"].as_u64()), (Some(a), Some(b)) if a < b)), "{FORMAT}");
    let Some(last) = entries.iter().rposition(|e| e["kind"] == "send-message") else {
        // A truncated cache cannot prove that this Bot has never replied.
        ensure!(
            transcript["precedingTimestampMs"].as_f64().unwrap_or(0.0) <= 0.0,
            "{SYNC}"
        );
        return Ok((String::new(), String::new(), false));
    };
    let request = entries[last]["requestId"]
        .as_str()
        .filter(|s| !s.is_empty());
    let start = request.map_or(last, |request| {
        entries[..=last]
            .iter()
            .rposition(|e| e["requestId"].as_str() != Some(request))
            .map_or(0, |i| i + 1)
    });
    ensure!(
        start > 0 || transcript["precedingTimestampMs"].as_f64().unwrap_or(0.0) <= 0.0,
        "{SYNC}"
    );
    let mut texts = Vec::new();
    let mut attachments = false;
    for entry in &entries[start..=last] {
        if entry["kind"] != "send-message" {
            continue;
        }
        match entry["message"]["type"].as_str() {
            Some("text") => texts.push(entry["message"]["content"].as_str().context(FORMAT)?),
            Some("attachment") => attachments = true,
            _ => anyhow::bail!(FORMAT),
        }
    }
    Ok((
        entries[last]["id"].as_str().context(FORMAT)?.into(),
        texts.join("\n\n"),
        attachments,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn delivery(seq: u64, request: &str, text: &str) -> Value {
        json!({"id":format!("e{seq}"),"seq":seq,"kind":"send-message","requestId":request,"message":{"type":"text","content":text}})
    }
    #[test]
    fn latest_keeps_all_text_in_the_latest_delivery_without_internal_messages() {
        let long = "完整回答\n".repeat(3000);
        let transcript = json!({"entries":[delivery(1,"old","旧回答"),
            {"id":"e2","seq":2,"kind":"message","requestId":"new","content":"PRIVATE_INPUT"},
            delivery(3,"new","第一部分"),delivery(4,"new",&long)],"precedingTimestampMs":1});
        let (_, text, attachments) = latest(&transcript, &json!({"newestEntryId":"e4"})).unwrap();
        assert_eq!(text, format!("第一部分\n\n{long}"));
        assert!(!attachments);
    }
    #[test]
    fn incomplete_or_outdated_replicas_are_never_presented_as_full_replies() {
        let partial = json!({"entries":[delivery(1,"new","片段")],"precedingTimestampMs":123});
        assert!(latest(&partial, &json!({"newestEntryId":"e1"})).is_err());
        assert!(latest(&partial, &json!({"newestEntryId":"e2"})).is_err());
    }

    #[test]
    fn scoped_file_reads_validate_account_identity_schema_and_preserve_sources() {
        let root = tempfile::tempdir().unwrap();
        let slot = "fixture@example.test";
        let account = format!("{:x}", Sha256::digest(slot.as_bytes()));
        let catalog = json!({"revision":"r1","account":account,"stale":false,
            "bots":[{"id":"bot-1","name":"合成 Bot","available":true}]});
        let input = json!({"botId":"bot-1","agent":"合成 Bot","revision":"r1"});
        let write = |key: &str, schema: u64, value: Value| {
            let path = cache_file(root.path(), key);
            fs::write(
                &path,
                serde_json::to_vec(&json!({"schemaVersion":schema,"value":value})).unwrap(),
            )
            .unwrap();
            path
        };
        write("sand.client.slice.client-meta.account-slot", 1, json!(slot));
        let prefix = "sand.client.slice.account.fixture%40example.test.";
        write(
            &format!("{prefix}roster.last-roster"),
            4,
            json!({"rows":[{"id":"bot-1","name":"合成 Bot","newestEntryId":"e2"}]}),
        );
        let transcript = json!({"entries":[delivery(1,"old","旧回答"),delivery(2,"new",&"完整正文".repeat(200))],"precedingTimestampMs":1});
        let path = write(
            &format!("{prefix}transcript.replicas.bot-1"),
            1,
            transcript.clone(),
        );
        let original = fs::read(&path).unwrap();
        let result = read(root.path(), &catalog, &input).unwrap();
        assert_eq!(result["text"], "完整正文".repeat(200));
        assert_eq!(fs::read(&path).unwrap(), original);
        let mut wrong = input.clone();
        wrong["revision"] = json!("old");
        assert!(read(root.path(), &catalog, &wrong).is_err());
        let mut wrong = catalog.clone();
        wrong["account"] = json!("other");
        assert!(read(root.path(), &wrong, &input).is_err());
        let mut wrong = catalog.clone();
        wrong["bots"][0]["hidden"] = json!(true);
        assert!(read(root.path(), &wrong, &input).is_err());
        write(
            &format!("{prefix}transcript.replicas.bot-1"),
            99,
            transcript,
        );
        assert!(read(root.path(), &catalog, &input).is_err());
    }
}
