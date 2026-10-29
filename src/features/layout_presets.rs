// [INPUT]: Checked feature layouts, current surface membership and preset revisions.
// [OUTPUT]: Named layout snapshots and atomic apply/save/rename/delete without changing feature owners or business state.
// [POS]: Main-surface presentation preferences; persists inside features.json.
// [PROTOCOL]: Keep features/AGENTS.md in sync.
use super::*;
use std::collections::BTreeSet;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LayoutPreset {
    pub id: String,
    pub name: String,
    pub layout: FeatureLayout,
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 40 && !name.chars().any(char::is_control)
}

pub(super) fn sanitize(presets: &mut Vec<LayoutPreset>) {
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    presets.retain(|preset| {
        !preset.id.is_empty()
            && preset.id.len() <= 64
            && valid_name(&preset.name)
            && preset.layout.valid()
            && preset.layout.visible.is_some()
            && ids.insert(preset.id.clone())
            && names.insert(preset.name.trim().to_lowercase())
    });
    presets.truncate(32);
}

impl App {
    pub(super) async fn layout_preset_request(&self, input: &Value) -> Result<Value> {
        let _operation = self.feature_operation.lock().await;
        let mut features = self.features.lock().await;
        let op = input["op"].as_str().unwrap_or("");
        let expected = input["expectedRevision"]
            .as_u64()
            .context("缺少布局预设版本")?;
        ensure!(
            expected == features.main.pref.layout_presets_revision,
            "布局预设已在其他窗口更新，请刷新后重试"
        );
        let previous = features.main.pref.clone();
        let id = input["id"].as_str();
        let index = id.and_then(|id| {
            features
                .main
                .pref
                .layout_presets
                .iter()
                .position(|preset| preset.id == id)
        });
        if id.is_some() {
            ensure!(index.is_some(), "布局预设已删除，请刷新后重试");
        }
        if matches!(op, "main-preset-save" | "main-preset-apply") {
            ensure!(
                features.main.target.is_none()
                    && features
                        .entries
                        .values()
                        .all(|entry| entry.pending.is_none() && entry.closing.is_none()),
                "功能正在交接，请稍后重试"
            );
            let placement = input["placement"].as_str().context("缺少布局位置")?;
            ensure!(
                placement == features.main.pref.placement,
                "主界面位置已变化，请刷新后重试"
            );
            if let Some(lease) = input.get("lease") {
                ensure!(
                    placement == "desktop"
                        && lease.as_str() == Some(features.main.lease.as_str())
                        && !features.main.lease.is_empty(),
                    "主窗口归属已变化"
                );
            }
            let expected_layout: Option<FeatureLayout> =
                serde_json::from_value(input.get("expectedLayout").context("缺少原布局")?.clone())?;
            ensure!(
                expected_layout.as_ref() == features.main.pref.layouts.get(placement),
                "布局已在其他窗口更新，请重新调整"
            );
            let mut layout: FeatureLayout = if op == "main-preset-apply" {
                features.main.pref.layout_presets[index.context("缺少布局预设")?]
                    .layout
                    .clone()
            } else {
                serde_json::from_value(input["layout"].clone())?
            };
            let available: Vec<String> = features
                .entries
                .iter()
                .filter(|(_, entry)| entry.pref.open && entry.pref.placement == placement)
                .map(|(id, _)| id.clone())
                .collect();
            if layout.visible.is_none() {
                layout.visible = Some(available.clone());
            }
            ensure!(layout.valid(), "分栏布局或功能组合无效");
            ensure!(
                layout
                    .visible
                    .as_ref()
                    .unwrap()
                    .iter()
                    .all(|id| available.contains(id)),
                "预设包含未在主界面打开的功能，请先开启或移回主界面"
            );
            if op == "main-preset-apply" {
                features.main.pref.layouts.insert(placement.into(), layout);
            } else {
                let name = input["name"].as_str().context("缺少预设名称")?.trim();
                ensure!(valid_name(name), "预设名称需为 1–40 个字");
                ensure!(
                    !features
                        .main
                        .pref
                        .layout_presets
                        .iter()
                        .any(|preset| Some(preset.id.as_str()) != id
                            && preset.name.to_lowercase() == name.to_lowercase()),
                    "已存在同名布局预设"
                );
                let preset = LayoutPreset {
                    id: id
                        .map(str::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    name: name.into(),
                    layout,
                };
                if let Some(index) = index {
                    features.main.pref.layout_presets[index] = preset;
                } else {
                    ensure!(
                        features.main.pref.layout_presets.len() < 32,
                        "最多保存 32 个布局预设"
                    );
                    features.main.pref.layout_presets.push(preset);
                }
            }
        } else {
            let index = index.context("缺少布局预设")?;
            match op {
                "main-preset-rename" => {
                    let name = input["name"].as_str().context("缺少预设名称")?.trim();
                    ensure!(valid_name(name), "预设名称需为 1–40 个字");
                    ensure!(
                        !features
                            .main
                            .pref
                            .layout_presets
                            .iter()
                            .enumerate()
                            .any(|(other, preset)| other != index
                                && preset.name.to_lowercase() == name.to_lowercase()),
                        "已存在同名布局预设"
                    );
                    features.main.pref.layout_presets[index].name = name.into();
                }
                "main-preset-delete" => {
                    features.main.pref.layout_presets.remove(index);
                }
                _ => bail!("未知布局预设操作"),
            }
        }
        if op != "main-preset-apply" {
            features.main.pref.layout_presets_revision =
                features.main.pref.layout_presets_revision.saturating_add(1);
        }
        if let Err(error) = features.save(&self.paths) {
            features.main.pref = previous;
            return Err(error);
        }
        Ok(features.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(visible: Value) -> Value {
        json!({"axis":"horizontal","groups":[{"ids":["outline"],"active":"outline","weight":0.4},{"ids":["next","prompts"],"active":"next","weight":0.6}],"visible":visible})
    }
    async fn fixture() -> (tempfile::TempDir, std::sync::Arc<App>) {
        let dir = tempfile::tempdir().unwrap();
        let app = App::new(
            Paths::new(Some(dir.path().into())).unwrap(),
            Default::default(),
            None,
            false,
        );
        {
            let mut features = app.features.lock().await;
            for id in ["outline", "next", "prompts"] {
                features.entries.insert(
                    id.into(),
                    Entry {
                        pref: Preference {
                            open: true,
                            ..Default::default()
                        },
                        owner: format!("owner-{id}"),
                        view: json!({"draft":"preserved","top":120}),
                        pending: None,
                        reveal: 1,
                        closing: None,
                    },
                );
            }
        }
        (dir, app)
    }
    async fn save(app: &App) -> Value {
        app.feature_request(json!({"op":"main-preset-save","placement":"sidebar","expectedRevision":0,"expectedLayout":null,"name":"对照","layout":layout(json!(["outline","next"]))})).await.unwrap()
    }

    #[tokio::test]
    async fn presets_persist_and_apply_without_reopening_features() {
        let (_dir, app) = fixture().await;
        let before = app.features.lock().await.snapshot()["features"].clone();
        let saved = save(&app).await;
        assert_eq!(saved["layoutPresetsRevision"], 1);
        assert_eq!(
            Features::load(&app.paths).snapshot()["layoutPresets"],
            saved["layoutPresets"]
        );
        let id = saved["layoutPresets"][0]["id"].clone();
        let applied = app.feature_request(json!({"op":"main-preset-apply","id":id,"placement":"sidebar","expectedRevision":1,"expectedLayout":null})).await.unwrap();
        assert_eq!(
            applied["layouts"]["sidebar"],
            layout(json!(["outline", "next"]))
        );
        assert_eq!(
            applied["features"], before,
            "visibility must not change owners, drafts, open state or leases"
        );
        assert_eq!(
            Features::load(&app.paths).snapshot()["layouts"],
            applied["layouts"]
        );
        let renamed = app.feature_request(json!({"op":"main-preset-rename","id":id,"expectedRevision":1,"name":"阅读与下一步"})).await.unwrap();
        assert_eq!(renamed["layoutPresetsRevision"], 2);
        assert_eq!(renamed["layoutPresets"][0]["name"], "阅读与下一步");
        let deleted = app
            .feature_request(json!({"op":"main-preset-delete","id":id,"expectedRevision":2}))
            .await
            .unwrap();
        assert_eq!(deleted["layoutPresets"], json!([]));
        assert_eq!(deleted["layouts"], applied["layouts"]);
    }

    #[tokio::test]
    async fn presets_reject_stale_layouts_revisions_and_other_surface_members() {
        let (_dir, app) = fixture().await;
        let saved = save(&app).await;
        let id = saved["layoutPresets"][0]["id"].clone();
        assert!(
            app.feature_request(json!({"op":"main-preset-delete","id":id,"expectedRevision":0}))
                .await
                .is_err()
        );
        assert!(app.feature_request(json!({"op":"main-preset-save","placement":"sidebar","expectedRevision":1,"expectedLayout":null,"name":"对照","layout":layout(json!(["next"]))})).await.is_err());
        app.feature_request(json!({"op":"main-layout","placement":"sidebar","expectedLayout":null,"layout":layout(json!(["next"]))})).await.unwrap();
        assert!(app.feature_request(json!({"op":"main-preset-apply","id":id,"placement":"sidebar","expectedRevision":1,"expectedLayout":null})).await.is_err());
        app.features
            .lock()
            .await
            .entries
            .get_mut("outline")
            .unwrap()
            .pref
            .placement = "edge".into();
        assert!(app.feature_request(json!({"op":"main-preset-apply","id":id,"placement":"sidebar","expectedRevision":1,"expectedLayout":layout(json!(["next"]))})).await.is_err());
        assert_eq!(
            app.features.lock().await.entries["outline"].pref.placement,
            "edge"
        );
        assert_eq!(
            app.features.lock().await.snapshot()["layouts"]["sidebar"],
            layout(json!(["next"]))
        );
    }

    #[tokio::test]
    async fn preset_write_failure_rolls_back_in_memory_revision() {
        let (_dir, app) = fixture().await;
        let saved = save(&app).await;
        std::fs::remove_file(app.paths.root.join("features.json")).unwrap();
        std::fs::create_dir(app.paths.root.join("features.json")).unwrap();
        assert!(app.feature_request(json!({"op":"main-preset-rename","id":saved["layoutPresets"][0]["id"],"expectedRevision":1,"name":"未保存"})).await.is_err());
        let current = app.features.lock().await.snapshot();
        assert_eq!(current["layoutPresets"], saved["layoutPresets"]);
        assert_eq!(current["layoutPresetsRevision"], 1);
    }

    #[test]
    fn visible_membership_is_nonempty_unique_and_part_of_the_layout() {
        for visible in [
            json!([]),
            json!(["next", "next"]),
            json!(["unknown"]),
            json!(["model"]),
        ] {
            let value: FeatureLayout = serde_json::from_value(layout(visible)).unwrap();
            assert!(!value.valid());
        }
        let mut legacy = layout(Value::Null);
        legacy.as_object_mut().unwrap().remove("visible");
        assert!(
            serde_json::from_value::<FeatureLayout>(legacy)
                .unwrap()
                .valid()
        );
    }
}
