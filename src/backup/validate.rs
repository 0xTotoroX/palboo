// [INPUT]: Reconstructed preferences, target-local state and selected transfer modules.
// [OUTPUT]: Validated restore payloads with new revisions and paused external side effects.
// [POS]: Backup boundary; existing domain validators remain authoritative.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn keep(next: &mut Value, prior: &Value, keys: &[&str]) {
    // Missing legacy option groups use their normal defaults; malformed groups are
    // left intact for the domain decoder to reject instead of indexing a scalar.
    if next.is_null() {
        *next = json!({});
    }
    let Some(next) = next.as_object_mut() else {
        return;
    };
    for key in keys {
        if let Some(value) = prior.get(*key) {
            next.insert((*key).into(), value.clone());
        } else {
            next.remove(*key);
        }
    }
}
fn revision(next: &mut Value, prior: &Value, key: &str) {
    if next.is_null() {
        *next = json!({});
    }
    if let Some(next) = next.as_object_mut() {
        next.insert(
            key.into(),
            json!(prior[key].as_u64().unwrap_or(0).saturating_add(1)),
        );
    }
}
pub fn prepare(
    file: &str,
    value: &mut Value,
    prior: &Value,
    selected: &BTreeSet<&str>,
) -> Result<()> {
    ensure!(
        value.is_object() || file.ends_with("-library.json") || file.ends_with("-manual.json"),
        "配置格式无效"
    );
    match file {
        "config.json" => {
            keep(value, prior, &["cdpEndpoint", "targetId", "codexBin"]);
            keep(
                &mut value["codexHost"],
                &prior["codexHost"],
                &[
                    "executable",
                    "previousExecutable",
                    "enabled",
                    "revision",
                    "startupUpdate",
                ],
            );
            keep(
                &mut value["performance"],
                &prior["performance"],
                &["integrationEnabled", "revision"],
            );
            // Consent belongs to this installation and is never inherited from an archive.
            if value["stepwise"]["jev"].is_object() {
                value["stepwise"]["jev"]["consent"] = prior["stepwise"]["jev"]["consent"]
                    .as_bool()
                    .unwrap_or(false)
                    .into();
            }
            let mut config: crate::config::Config = serde_json::from_value(value.clone())?;
            if let Some(provider) = &config.provider {
                ensure!(
                    ["codex", "api"].contains(&provider.as_str()),
                    "模型来源无效"
                );
            }
            if let Some(url) = &config.base_url
                && !url.is_empty()
            {
                crate::model::api_base(url)?;
            }
            let options = &mut config.stepwise;
            ensure!(
                ["manual", "auto"].contains(&options.generation_mode.as_str()),
                "生成模式无效"
            );
            ensure!(
                [
                    "responses",
                    "chat_completions",
                    "anthropic_messages",
                    "auto"
                ]
                .contains(&options.protocol.as_str()),
                "API 协议无效"
            );
            ensure!(
                (1..=6).contains(&options.max_items)
                    && (128..=16000).contains(&options.max_output_tokens)
                    && (1000..=300000).contains(&options.timeout_ms),
                "生成参数超出范围"
            );
            ensure!(
                options.max_input_chars == 0 || (500..=32000).contains(&options.max_input_chars),
                "输入字符上限无效"
            );
            ensure!(
                options.quick_prompts.len() <= 8
                    && options
                        .quick_prompts
                        .iter()
                        .all(|p| !p.prompt.trim().is_empty()
                            && p.prompt.chars().count() <= 4000
                            && p.label.chars().count() <= 20),
                "常用语格式无效"
            );
            crate::directions::validate(
                &mut options.direction_library,
                &options.selected_directions,
            )?;
            options.jev.validate()?;
        }
        "panel.json" => {
            crate::panel::normalize_backup(value);
            keep(value, prior, &["detached", "returnOpen", "settingsTarget"]);
            keep(
                &mut value["ui"],
                &prior["ui"],
                &["open", "dockOpen", "activeTab"],
            );
            revision(value, prior, "revision");
            revision(value, prior, "webRevision");
            crate::panel::validate_backup(value)?;
        }
        "features.json" => {
            *value = crate::features::backup_preferences(value)?;
            let prior = crate::features::backup_preferences(prior)?;
            if let Some(features) = value["features"].as_object_mut() {
                for (id, prefs) in features {
                    keep(prefs, &prior["features"][id], &["open"]);
                }
            }
            revision(&mut value["main"], &prior["main"], "layoutPresetsRevision");
            crate::features::validate_backup(value)?;
        }
        "surfaces.json" => crate::surfaces::validate_backup(value)?,
        "model-control.json" => *value = crate::model_control::backup_preferences(value)?,
        "web-library.json" => {
            revision(value, prior, "revision");
            let prefs: crate::web_library::Preferences = serde_json::from_value(value.clone())?;
            let mut ids = BTreeSet::new();
            for site in &prefs.sites {
                ensure!(
                    !site.name.trim().is_empty() && ids.insert(&site.id),
                    "网站列表无效"
                );
                let url = reqwest::Url::parse(&site.url)?;
                ensure!(
                    ["http", "https"].contains(&url.scheme())
                        && url.username().is_empty()
                        && url.password().is_none(),
                    "网站地址无效"
                );
            }
            if selected.contains("machine") {
                let folders = prefs
                    .folders
                    .iter()
                    .flat_map(|folder| std::iter::once(&folder.path).chain(&folder.attachments));
                for path in folders.chain(prefs.vault.iter()).chain(&prefs.attachments) {
                    ensure!(
                        path.is_absolute()
                            && path.is_dir()
                            && path.canonicalize()?.parent().is_some(),
                        "备份中的阅读目录不可用，请取消本机目录与设备设置后重试"
                    );
                }
            }
        }
        "tasks.json" => {
            // Keep v1 for the existing task migration; never reinterpret a future schema as v2.
            ensure!(
                value["schema"]
                    .as_u64()
                    .is_some_and(|v| [1, 2].contains(&v)),
                "任务数据版本不受支持"
            );
            revision(value, prior, "revision");
            value["inflight"] = Value::Null;
            if selected.contains("data") || selected.contains("machine") {
                value["syncEnabled"] = false.into();
            }
            let store: crate::tasks::model::Store = serde_json::from_value(value.clone())?;
            let mut ids = BTreeSet::new();
            for task in &store.tasks {
                ensure!(
                    !task.id.is_empty() && ids.insert(&task.id),
                    "任务标识重复或为空"
                );
                task.fields.validate()?;
                ensure!(
                    store.columns.iter().any(|c| c.id == task.fields.column),
                    "任务分组与现有任务不兼容，请同时选择任务设置与数据"
                );
            }
        }
        "terminology-settings.json" => {
            revision(value, prior, "revision");
            let _: crate::terminology::Preferences = serde_json::from_value(value.clone())?;
        }
        "terminology-store.json" => {
            let _: crate::terminology_import::Store = serde_json::from_value(value.clone())?;
            ensure!(value["version"] == 1, "术语数据版本不受支持");
            revision(value, prior, "revision");
            if let Some(jobs) = value["jobs"].as_array_mut() {
                for job in jobs {
                    if job["status"] != "done" {
                        job["status"] = "error".into();
                        job["error"] = "从备份恢复，请手动重试".into();
                    }
                    job["attempt"] = Value::Null;
                    job["preparedAt"] = 0.into();
                    if let (Some(id), Some(file)) = (job["id"].as_str(), job["file"].as_str()) {
                        super::snapshot::check_attachment(&format!(
                            "terminology-imports/{id}/{file}"
                        ))?;
                    }
                }
            }
            let _: crate::terminology_import::Store = serde_json::from_value(value.clone())?;
        }
        "terminology-library.json" | "terminology-manual.json" => {
            let _: Vec<crate::terminology::Term> = serde_json::from_value(value.clone())?;
        }
        "secrets.json" => {
            ensure!(
                value
                    .as_object()
                    .context("密钥格式无效")?
                    .keys()
                    .all(|key| ["apiKey", "jevApiKey"].contains(&key.as_str())),
                "未知密钥字段"
            );
            for key in ["apiKey", "jevApiKey"] {
                ensure!(
                    value[key].is_null()
                        || value[key]
                            .as_str()
                            .is_some_and(|s| s.len() <= 8192 && !s.contains(['\r', '\n'])),
                    "密钥格式无效"
                );
            }
        }
        "reader-preferences.json" => super::reader_preferences::validate(value)?,
        _ => anyhow::bail!("不支持的备份文件"),
    }
    Ok(())
}
