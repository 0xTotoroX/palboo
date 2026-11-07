// [INPUT]: scripts/build-panel.mjs、ui/ 胶囊与大纲依赖模块、target/web 与 ui/shared/bridge/requests.js。
// [OUTPUT]: 校验 macOS arm64 目标，递归登记前端输入文件与目录，生成 OUT_DIR/panel.js 与 chat-outline.js。
// [POS]: Cargo 构建入口，调用项目已安装的 Node/esbuild 解析显式依赖。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn track(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    if path.is_dir() {
        let mut entries: Vec<PathBuf> = fs::read_dir(path)
            .expect("failed to read build input directory")
            .map(|entry| entry.expect("failed to read directory entry").path())
            .filter(|entry| {
                entry.file_name().is_none_or(|name| {
                    name != ".DS_Store" && !name.to_string_lossy().ends_with(".md")
                })
            })
            .collect();
        entries.sort();
        for entry in entries {
            track(&entry);
        }
    }
}

fn main() {
    assert!(
        env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
            && env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64"),
        "Palboo currently supports only macOS 14+ on Apple Silicon"
    );
    for path in [
        "ui/codex",
        "ui/surfaces",
        "ui/features",
        "ui/shared",
        "ui/terminology",
        "ui/settings/api.ts",
        "target/web",
        "scripts/build-panel.mjs",
        "package-lock.json",
    ] {
        track(Path::new(path));
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("panel.js");
    let status = Command::new("node")
        .arg("scripts/build-panel.mjs")
        .arg(output)
        .status()
        .expect("Node.js is required; install Node and run npm ci before building");
    assert!(
        status.success(),
        "panel module build failed; run npm ci and check imports"
    );
}
