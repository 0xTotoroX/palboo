// [INPUT]: 合成控制器、隔离缓存和本机 Node 的语法/VM 检查。
// [OUTPUT]: 补丁升级、幂等、失败保留、安装隔离与 document 生命周期回归。
// [POS]: controller.rs 的单元与显式本机只读来源验收。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
use super::*;

const FIXTURE: &str = include_str!("../../tests/codex-host-controller-fixture.mjs");

#[tokio::test]
async fn renderer_override_is_validated_cached_and_keeps_official_files_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("official.mjs");
    let renderer_path = directory.path().join("renderer-extension.js");
    let original_controller = format!("{FIXTURE}\n{RENDERER_LOAD}\n");
    let original_renderer = renderer::tests::fixture();
    std::fs::write(&original, &original_controller).unwrap();
    std::fs::write(&renderer_path, &original_renderer).unwrap();
    let node = super::super::find_node().unwrap();
    let cache = directory.path().join("cache");
    let controller = prepare_in(&cache, &original, &node).await.unwrap().unwrap();
    let content = std::fs::read_to_string(&controller).unwrap();
    let encoded_path = content
        .lines()
        .find_map(|line| {
            line.strip_prefix("const rendererSource = await dependencies.readRenderer(")
                .and_then(|path| path.strip_suffix(");"))
        })
        .unwrap();
    let cached_renderer: PathBuf = serde_json::from_str(encoded_path).unwrap();
    let expected = renderer::patch(&original_renderer).unwrap().unwrap();
    assert_eq!(std::fs::read_to_string(&cached_renderer).unwrap(), expected);
    assert_eq!(
        std::fs::read_to_string(&original).unwrap(),
        original_controller
    );
    assert_eq!(
        std::fs::read_to_string(&renderer_path).unwrap(),
        original_renderer
    );
    std::fs::write(&cached_renderer, "broken").unwrap();
    assert_eq!(
        prepare_in(&cache, &original, &node).await.unwrap(),
        Some(controller.clone())
    );
    assert_eq!(std::fs::read_to_string(&cached_renderer).unwrap(), expected);
    std::fs::write(&renderer_path, "unknown upstream renderer").unwrap();
    assert!(prepare_in(&cache, &original, &node).await.is_err());
    std::fs::write(&renderer_path, original_renderer).unwrap();
    std::fs::write(
        &original,
        original_controller.replace(RENDERER_LOAD, "// unknown renderer loader"),
    )
    .unwrap();
    assert!(prepare_in(&cache, &original, &node).await.is_err());
    assert_eq!(std::fs::read_to_string(controller).unwrap(), content);
}

#[test]
fn patches_known_shapes_once_and_accepts_upstream_fix() {
    let fixed = patch(FIXTURE).unwrap().unwrap();
    assert!(!fixed.contains(UNBOUNDED));
    assert!(fixed.contains(BOUNDED));
    assert!(patch(&fixed).unwrap().is_none());
    let upstream = fixed.replace(
        "__palbooCodexHostReconcileV1",
        "__codexhostReconcileDraftRoutingV1",
    );
    assert!(patch(&upstream).unwrap().is_none());
    let finite = FIXTURE.replace(
        UNBOUNDED,
        "await renderer.command(\"Debugger.enable\", { maxScriptsCacheSize: 1048576 });",
    );
    let fixed = patch(&finite).unwrap().unwrap();
    assert!(fixed.contains("maxScriptsCacheSize: 1048576"));
    assert!(!fixed.contains("maxScriptsCacheSize: 0"));
}

#[test]
fn rejects_changed_or_ambiguous_shapes_instead_of_guessing() {
    for changed in [
        FIXTURE.replace(
            "(expression) => renderer.evaluate(expression)",
            "(value) => renderer.evaluate(value)",
        ),
        FIXTURE.replace(INSTALL_END, "    return { state: 'unknown' };\n  })()`;"),
        format!("{FIXTURE}\n{UNBOUNDED}"),
        FIXTURE.replace(
            UNBOUNDED,
            "await renderer.command(\"Debugger.enable\", { maxScriptsCacheSize: Infinity });",
        ),
        FIXTURE.replace(
            "installRendererLoadedModules(renderer)",
            "installChangedCatalog(renderer)",
        ),
    ] {
        assert!(patch(&changed).is_err());
    }
}

#[tokio::test]
async fn caches_validated_copy_without_mutating_install_and_repairs_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let original = dir.path().join("official.mjs");
    std::fs::write(&original, FIXTURE).unwrap();
    let cache = dir.path().join("cache");
    let node = super::super::find_node().expect("Node is required by repository tests");
    let first = prepare_in(&cache, &original, &node).await.unwrap().unwrap();
    let modified = first.metadata().unwrap().modified().unwrap();
    assert_eq!(std::fs::read_to_string(&original).unwrap(), FIXTURE);
    assert_eq!(
        prepare_in(&cache, &original, &node).await.unwrap(),
        Some(first.clone())
    );
    assert_eq!(first.metadata().unwrap().modified().unwrap(), modified);
    std::fs::write(&first, "corrupt cached copy").unwrap();
    assert_eq!(
        prepare_in(&cache, &original, &node).await.unwrap(),
        Some(first.clone())
    );
    assert_eq!(
        std::fs::read_to_string(&first).unwrap(),
        patch(FIXTURE).unwrap().unwrap()
    );

    let other = dir.path().join("new-version.mjs");
    std::fs::write(&other, format!("{FIXTURE}\n// next upstream revision\n")).unwrap();
    let next = prepare_in(&cache, &other, &node).await.unwrap().unwrap();
    assert_ne!(next, first);
    assert!(first.is_file());
    let args = format!("node {} --attachment-port 123", first.display());
    assert!(matches_in(&cache, &original, &args));
    assert!(!matches_in(&cache, &other, &args));
    assert!(!matches_in(
        &cache,
        &original,
        &format!("node {}.invalid", first.display())
    ));
    // 升级 Palboo 后允许已有的旧补丁继续运行，但不覆盖/复用不同内容。
    std::fs::write(&original, format!("{FIXTURE}\n// changed in-place\n")).unwrap();
    let changed = prepare_in(&cache, &original, &node).await.unwrap().unwrap();
    assert_ne!(changed, first);
    assert!(matches_in(&cache, &original, &args));

    std::fs::write(&other, format!("{FIXTURE}\ninvalid syntax {{")).unwrap();
    assert!(prepare_in(&cache, &other, &node).await.is_err());
    assert!(first.is_file() && next.is_file() && changed.is_file());
    assert_eq!(
        std::fs::read_to_string(&next).unwrap(),
        patch(&format!("{FIXTURE}\n// next upstream revision\n"))
            .unwrap()
            .unwrap()
    );
}

#[tokio::test]
async fn fixed_upstream_and_legacy_versions_need_no_override() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("fixed.mjs");
    std::fs::write(&source, patch(FIXTURE).unwrap().unwrap()).unwrap();
    assert!(
        prepare_in(
            &dir.path().join("cache"),
            &source,
            Path::new("/unused/node")
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(!dir.path().join("cache").exists());
    assert!(
        prepare(
            Path::new("/unused/codexhost"),
            (0, 10, 2),
            Path::new("/unused/Codex"),
            None
        )
        .await
        .unwrap()
        .is_none()
    );
}

#[tokio::test]
async fn runtime_keeps_current_ownership_reinstalls_on_reload_and_retries_small_calls() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("official.mjs");
    std::fs::write(&source, FIXTURE).unwrap();
    let node = super::super::find_node().unwrap();
    let fixed = prepare_in(dir.path(), &source, &node)
        .await
        .unwrap()
        .unwrap();
    let script = r#"
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const controller = vm.createContext({ setTimeout });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), controller);
(async () => {
  const commands = [];
  await controller.installRendererLoadedModules({ command: async (method, params) => commands.push([method, params]) });
  assert.equal(commands[0][0], 'Debugger.enable');
  assert.equal(commands[0][1].maxScriptsCacheSize, 0);
  let target, page;
  const reset = (manager) => {
    target = { manager };
    target.__fixtureRouting = { forComposer: () => target.manager };
    page = vm.createContext({ window: target });
  };
  reset({ id: 'first' });
  const expressions = [];
  const renderer = { evaluate: async expression => { expressions.push(expression); return vm.runInContext(expression, page); } };
  const fullCount = () => expressions.filter(value => value.length > 60000).length;
  const check = () => controller.installRendererDraftPrewarmPolicyDirect(renderer);
  await check();
  for (let index = 0; index < 100; index++) await check();
  assert.equal(fullCount(), 1);
  target.manager = { id: 'replacement' };
  await check(); assert.equal(target.__fixtureOwner.id, 'replacement');
  assert.equal(expressions.at(-1).length < 200, true);
  reset({ id: 'new-document' });
  await check(); assert.equal(fullCount(), 2);
  reset(null);
  const pending = check();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fullCount(), 3);
  target.manager = { id: 'mounted' };
  await pending; assert.equal(fullCount(), 3);
  await assert.rejects(controller.installRendererDraftPrewarmPolicyDirect({ evaluate: async () => ({ state: 'invalid' }) }), /invalid installation status/);
})().catch(error => { console.error(error); process.exitCode = 1; });
"#;
    let result = std::process::Command::new(&node)
        .args(["-e", script])
        .arg(&fixed)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[tokio::test]
#[ignore = "explicitly validates local official artifacts without launching Desktop"]
async fn installed_official_controllers_generate_valid_overrides() {
    let sources = std::env::var_os("PALBOO_TEST_CODEXHOST_CONTROLLERS")
        .expect("explicit controller sources required");
    let cache = PathBuf::from(
        std::env::var_os("PALBOO_TEST_CODEXHOST_CACHE").expect("explicit cache required"),
    );
    let node = super::super::find_node().unwrap();
    for source in std::env::split_paths(&sources) {
        let before = std::fs::read(&source).unwrap();
        let derived = prepare_in(&cache, &source, &node).await.unwrap().unwrap();
        assert_eq!(std::fs::read(&source).unwrap(), before);
        println!(
            "source={} controller={}",
            source.display(),
            derived.display()
        );
    }
}
