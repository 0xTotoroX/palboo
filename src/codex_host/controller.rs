// [INPUT]: 官方 CodexHost 控制器/Renderer、版本与所选 Node；仅生成 Palboo 自有缓存。
// [OUTPUT]: 经结构/语法校验的控制器及 Renderer 缓存、可选 --desktop-controller 路径与运行身份识别。
// [POS]: CodexHost 启动、更新和回退共用的内存兼容修复，不写官方安装。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

#[path = "renderer.rs"]
mod renderer;
const RENDERER_LOAD: &str =
    "const rendererSource = await dependencies.readRenderer(options.rendererPath);";

const DIRECT: &str = r#"function installRendererDraftPrewarmPolicyDirect(renderer) {
  return waitForDraftPrewarmPolicy(
    (expression) => renderer.evaluate(expression),
    directRendererInstaller()
  );
}"#;
const DIRECT_FIXED: &str = r#"function installRendererDraftPrewarmPolicyDirect(renderer) {
  return waitForDraftPrewarmPolicy(
    async () => {
      const status = await renderer.evaluate("window.__palbooCodexHostReconcileV1?.() ?? null");
      return status === null ? renderer.evaluate(directRendererInstaller()) : status;
    },
    ""
  );
}"#;
const INSTALL_END: &str =
    "    return { state: 'ready', reason: 'owned-request-bridge' };\n  })()`;";
const INSTALL_END_FIXED: &str = r#"    return { state: 'ready', reason: 'owned-request-bridge' };
    };
    Object.defineProperty(window, '__palbooCodexHostReconcileV1', {
      configurable: true, value: reconcile,
    });
    return reconcile();
  })()`;"#;
const UNBOUNDED: &str = "await renderer.command(\"Debugger.enable\");";
const BOUNDED: &str = "await renderer.command(\"Debugger.enable\", { maxScriptsCacheSize: 0 });";
const STRUCTURE_ERROR: &str = "CodexHost 控制器结构已变化，内存兼容补丁需更新；原安装保持不变";

fn replace_once(source: &mut String, old: &str, new: &str) -> Result<()> {
    ensure!(source.matches(old).count() == 1, STRUCTURE_ERROR);
    *source = source.replacen(old, new, 1);
    Ok(())
}

fn patch(source: &str) -> Result<Option<String>> {
    let catalog = source
        .split_once("async function installRendererLoadedModules(renderer) {")
        .context(STRUCTURE_ERROR)?
        .1;
    let catalog = catalog.split("\n// ").next().unwrap_or(catalog);
    let mut result = source.to_owned();
    if catalog.contains(UNBOUNDED) {
        replace_once(&mut result, UNBOUNDED, BOUNDED)?;
    } else {
        let limit = catalog
            .split_once("maxScriptsCacheSize: ")
            .and_then(|(_, tail)| tail.split([',', '}']).next())
            .and_then(|value| value.trim().parse::<u64>().ok());
        ensure!(limit.is_some(), STRUCTURE_ERROR);
    }
    if source.contains(DIRECT) {
        // 仅包装已有协调逻辑；Host/Composer/连接检查保留在闭包里，每次仍执行。
        replace_once(
            &mut result,
            "    const connected = (routing)",
            "    const reconcile = () => {\n    const connected = (routing)",
        )?;
        replace_once(&mut result, INSTALL_END, INSTALL_END_FIXED)?;
        replace_once(&mut result, DIRECT, DIRECT_FIXED)?;
    } else {
        // 上游采用已知的 document 级安装修复后直接复用，不再叠加补丁。
        ensure!(
            source.contains("function installRendererDraftPrewarmPolicyDirect(renderer) {")
                && (source.contains("__codexhostReconcileDraftRoutingV1?.() ?? null")
                    || source.contains("__palbooCodexHostReconcileV1?.() ?? null")),
            STRUCTURE_ERROR
        );
    }
    Ok((result != source).then_some(result))
}

fn cache_root() -> Result<PathBuf> {
    Ok(dirs::data_local_dir()
        .context("无法找到应用数据目录")?
        .join("palboo/codex-host-controllers"))
}

fn source_directory(cache: &Path, source: &Path) -> Result<PathBuf> {
    let source = std::fs::canonicalize(source).context("无法读取 CodexHost 控制器")?;
    Ok(cache.join(format!(
        "{:x}",
        Sha256::digest(source.as_os_str().as_encoded_bytes())
    )))
}

pub(super) async fn prepare(
    executable: &Path,
    version: (u64, u64, u64),
    desktop: &Path,
    node: Option<&Path>,
) -> Result<Option<PathBuf>> {
    if version < (0, 17, 1) {
        return Ok(None);
    }
    let source = super::resource_root(executable)?.join("app/desktop-controller.mjs");
    let bundled = desktop
        .parent()
        .context("Codex 程序路径无效")?
        .join("../Resources/cua_node/bin/node");
    prepare_in(&cache_root()?, &source, node.unwrap_or(&bundled)).await
}

async fn prepare_in(cache: &Path, source: &Path, node: &Path) -> Result<Option<PathBuf>> {
    let original = std::fs::read_to_string(source).context("无法读取 CodexHost 控制器")?;
    let mut patched = patch(&original)?.unwrap_or_else(|| original.clone());
    let renderer_source = source.with_file_name("renderer-extension.js");
    if original.contains(RENDERER_LOAD) || renderer_source.is_file() {
        ensure!(
            original.matches(RENDERER_LOAD).count() == 1,
            STRUCTURE_ERROR
        );
        let renderer_original =
            std::fs::read_to_string(renderer_source).context("无法读取 CodexHost Renderer")?;
        if let Some(renderer_fixed) = renderer::patch(&renderer_original)? {
            let directory = source_directory(cache, source)?
                .join(format!("{:x}", Sha256::digest(renderer_fixed.as_bytes())));
            let renderer_path =
                write_validated(&directory, "renderer-extension.js", &renderer_fixed, node).await?;
            replace_once(
                &mut patched,
                RENDERER_LOAD,
                &format!(
                    "const rendererSource = await dependencies.readRenderer({});",
                    serde_json::to_string(&renderer_path)?
                ),
            )?;
        }
    }
    if patched == original {
        return Ok(None);
    }
    let directory =
        source_directory(cache, source)?.join(format!("{:x}", Sha256::digest(patched.as_bytes())));
    Ok(Some(
        write_validated(&directory, "desktop-controller.mjs", &patched, node).await?,
    ))
}

async fn write_validated(
    directory: &Path,
    filename: &str,
    content: &str,
    node: &Path,
) -> Result<PathBuf> {
    let output = directory.join(filename);
    if std::fs::read(&output).ok().as_deref() == Some(content.as_bytes()) {
        return Ok(output);
    }
    std::fs::create_dir_all(&directory)?;
    let mut temporary = tempfile::Builder::new()
        .suffix(".mjs")
        .tempfile_in(&directory)?;
    temporary.write_all(content.as_bytes())?;
    temporary.as_file().sync_all()?;
    super::output(
        node,
        &[
            "--check",
            temporary.path().to_str().context("控制器路径无效")?,
        ],
        Duration::from_secs(10),
    )
    .await
    .context("CodexHost 内存兼容补丁校验失败，原安装保持不变")?;
    // 校验完成后才发布；失败不改变官方包或已缓存的可用版本。
    temporary.persist(&output).map_err(|error| error.error)?;
    Ok(output)
}

pub(super) fn matches_running(source: &Path, args: &str) -> bool {
    cache_root()
        .ok()
        .is_some_and(|cache| matches_in(&cache, source, args))
}

fn matches_in(cache: &Path, source: &Path, args: &str) -> bool {
    let Ok(directory) = source_directory(cache, source) else {
        return false;
    };
    let prefix = format!("{}/", directory.display());
    let Some((_, tail)) = args.split_once(&prefix) else {
        return false;
    };
    let Some(hash) = tail.get(..64) else {
        return false;
    };
    let Some(remainder) = tail.get(64..) else {
        return false;
    };
    let Some(end) = remainder.strip_prefix("/desktop-controller.mjs") else {
        return false;
    };
    // 绑定原安装的规范路径；新旧 Palboo 补丁可并存，不能接管其他安装。
    hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        && (end.is_empty() || end.starts_with(char::is_whitespace))
        && directory
            .join(hash)
            .join("desktop-controller.mjs")
            .is_file()
}

#[cfg(test)]
#[path = "controller_tests.rs"]
mod tests;
