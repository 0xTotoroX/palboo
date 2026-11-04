// [INPUT]: 已安装的官方 CodexHost Renderer 文本；只接受已验证的兼容结构。
// [OUTPUT]: 可选的 Palboo 缓存副本；探针使用实际 DOM 控件ID，模型控件兼容新版 power 回调。
// [POS]: controller 启动准备的私有源码转换，不修改官方分发或 Agent 配置。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
use anyhow::{Result, ensure};

const PROBE_ID: &str = "composerId: mounted.composerId,";
const DOM_ID: &str = "composerId: mounted.control.composerId,";
const OLD_MODEL: &str = "typeof props.onSelectReasoningEffort === \"function\" && \"reasoningEffort\" in props && isRecord(props.fallbackPowerSelection)";
const NEW_MODEL: &str = "\"reasoningEffort\" in props && ((typeof props.onSelectReasoningEffort === \"function\" && isRecord(props.fallbackPowerSelection)) || (element.getAttribute(\"data-composer-navigation-target\") === \"reasoning\" && typeof props.onCommitPower === \"function\" && Array.isArray(props.powerSelections)))";
const STRUCTURE_ERROR: &str = "CodexHost Renderer 结构已变化，界面兼容补丁需更新；原安装保持不变";

pub(super) fn patch(source: &str) -> Result<Option<String>> {
    ensure!(
        source.contains("function installRendererBindingProbe("),
        STRUCTURE_ERROR
    );
    ensure!(
        source.contains("function isNativeModelControlCandidate("),
        STRUCTURE_ERROR
    );
    let mut result = source.to_owned();
    if source.contains(PROBE_ID) {
        ensure!(source.matches(PROBE_ID).count() == 1, STRUCTURE_ERROR);
        result = result.replacen(PROBE_ID, DOM_ID, 1);
    } else {
        ensure!(source.matches(DOM_ID).count() == 1, STRUCTURE_ERROR);
    }
    if source.contains(OLD_MODEL) {
        ensure!(source.matches(OLD_MODEL).count() == 1, STRUCTURE_ERROR);
        result = result.replacen(OLD_MODEL, NEW_MODEL, 1);
    } else {
        ensure!(
            source.contains("typeof props.onCommitPower === \"function\"")
                && source.contains("Array.isArray(props.powerSelections)"),
            STRUCTURE_ERROR
        );
    }
    Ok((result != source).then_some(result))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    pub(crate) fn fixture() -> String {
        format!(
            r#"
function installRendererBindingProbe(mounted) {{
  return {{ {PROBE_ID} agent: mounted.agent }};
}}
const isRecord = value => value !== null && typeof value === 'object';
function isNativeModelControlCandidate(element) {{
  const props = element.props;
  return typeof props.onSelectModel === "function" && {OLD_MODEL};
}}
"#
        )
    }

    #[test]
    fn accepts_known_shapes_and_refuses_ambiguous_sources() {
        let source = fixture();
        let fixed = patch(&source).unwrap().unwrap();
        assert!(patch(&fixed).unwrap().is_none());
        for invalid in [
            source.replace(PROBE_ID, "composerId: unknown,"),
            format!("{source}\n{PROBE_ID}"),
            source.replace(OLD_MODEL, "unknownModelState"),
        ] {
            assert!(patch(&invalid).is_err());
        }
    }

    #[test]
    fn probe_tracks_real_controls_after_rebind_and_recognizes_power_model_trigger() {
        let fixed = patch(&fixture()).unwrap().unwrap();
        let script = format!(
            r#"{fixed}
const assert = require('node:assert/strict');
const mounted = {{ composerId: 'rebound-state', control: {{composerId: 'dom-control'}}, agent:'antigravity' }};
assert.equal(installRendererBindingProbe(mounted).composerId, 'dom-control');
const element = {{props:{{onSelectModel(){{}}, reasoningEffort:'high', onCommitPower(){{}}, powerSelections:[]}}, getAttribute:()=> 'reasoning'}};
assert.equal(isNativeModelControlCandidate(element), true);
element.getAttribute = () => 'permissions';
assert.equal(isNativeModelControlCandidate(element), false);
element.props = {{ onSelectModel(){{}}, onSelectReasoningEffort(){{}}, reasoningEffort:'high', fallbackPowerSelection:{{}} }};
assert.equal(isNativeModelControlCandidate(element), true);
"#
        );
        let result = std::process::Command::new(super::super::super::find_node().unwrap())
            .args(["-e", &script])
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    #[ignore = "explicit read-only installed source check; writes only the requested report artifact"]
    fn installed_renderer() {
        let path = std::env::var("PALBOO_CODEXHOST_RENDERER").unwrap();
        let source = std::fs::read_to_string(path).unwrap();
        let fixed = patch(&source).unwrap().unwrap_or(source);
        if let Ok(output) = std::env::var("PALBOO_CODEXHOST_RENDERER_OUTPUT") {
            std::fs::write(output, fixed).unwrap();
        }
    }
}
