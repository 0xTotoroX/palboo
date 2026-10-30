/*
 * [INPUT]: 当前源码、锁定依赖、release 计划、完整许可包与系统打包工具。
 * [OUTPUT]: patch=0 时生成完整 App 的 DMG；补丁版跳过，证据写入 target/reports。
 * [POS]: 本地与 CI 共用的打包入口，不上传、不安装、不更改版本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { prepareTestBinary } from './verify.mjs';
import { releasePlan } from './release-plan.mjs';
import { auditSource } from './source-audit.mjs';
import { auditArtifact } from './artifact-audit.mjs';
import { generateNotices } from './third-party-notices.mjs';
import { copyProjectLicenses } from './project-licenses.mjs';
import { buildApplication, packageDmg } from './package-app.mjs';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const plan = releasePlan(version);
if (!plan.installer) {
  console.log(`${version} 为补丁版本，不生成安装文件。`);
} else {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('当前只打包 macOS 14.0+ Apple Silicon 产物');
  auditSource(root);
  if (!readFileSync(join(root, 'Cargo.toml'), 'utf8').includes(`version = "${version}"`))
    throw new Error('Cargo 与网页版本不一致');
  const started = Date.now();
  const artifact = prepareTestBinary('release');
  auditArtifact(artifact.binary);
  const built = Date.now();
  mkdirSync(join(root, 'target/package'), { recursive: true });
  mkdirSync(join(root, 'target/reports'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  const staging = mkdtempSync(join(root, 'target/package/dmg-'));
  try {
    const resources = join(staging, 'resources');
    mkdirSync(resources);
    copyProjectLicenses(root, resources);
    generateNotices(resources);
    writeFileSync(
      join(resources, 'INSTALL.txt'),
      `Palboo ${version}

English

Drag Palboo.app to Applications, then double-click it. Release mode does not require Node.js or Rust.
Switch modes in Settings → Startup & Connection. Development mode requires a local Palboo source checkout and its Node.js/Rust toolchain; register it with npm run install:dev. Existing settings and data stay in their original locations.
Requires macOS 14 or later on Apple Silicon. Desktop windows require macOS 15 or later.
If macOS blocks the first launch, verify the download source, then open System Settings → Privacy & Security → Open Anyway. The App is locally signed and is not notarized by Apple.

Codex and optional Agents use your existing installations, accounts, and settings. No maintainer credentials, chats, or personal glossary are included.
If Codex is already running without a debugging connection, Palboo follows your launch preference and asks before reopening it. Settings remain in your user data directory when you move the App.
For later updates, use Settings → System → Startup & connection → App updates. Apps without the updater need one manual installation of this version. When updating manually, replace the complete Palboo.app; do not replace individual files inside the App.
When upgrading from CodexBuddy or Codex Companion, first stop the old background service with ~/.local/bin/codex-buddy stop or ~/.local/bin/codex-companion stop. If the old service is still running or separate data directories conflict, migration stops and preserves the existing data.

Source, usage, and releases: https://github.com/0xTotoroX/palboo
Licensed under GPL-3.0-only. Full licenses and third-party notices are in this Resources directory. Redistribution must include access to the complete corresponding source and required build materials.

简体中文

将 Palboo.app 拖入“应用程序”，再双击打开。正式模式无需 Node.js 或 Rust。
在“设置 → 启动与连接”中切换模式。开发模式需要本地 Palboo 源码及其 Node.js/Rust 工具链，通过 npm run install:dev 登记；原有配置和数据保留原位。
支持 macOS 14+ Apple Silicon；桌面浮窗需要 macOS 15+。
本 App 使用本地签名，未经过 Apple 公证。首次打开被系统拦截时，在确认下载来源后进入“系统设置 → 隐私与安全性 → 仍要打开”。

Codex 桌面应用及可选 Agent 使用你自己的安装、登录与配置；安装包不携带维护者的密钥、聊天或个人词库。
既有 Codex 无调试连接时，Palboo 沿用启动设置询问是否重开。配置保存在当前用户数据目录，移动 App 不会移动或删除配置。
后续更新可在“设置 → 系统 → 启动与连接 → 应用更新”中完成。没有更新器的旧版需先手动安装本版本一次。手动更新时替换完整 Palboo.app，不支持覆盖 App 内的单个文件。
若从旧名 CodexBuddy / Codex Companion 升级，先正常停止旧后台（~/.local/bin/codex-buddy stop 或 ~/.local/bin/codex-companion stop），再打开新 App；旧服务活动或存在独立数据冲突时保留原数据并停止迁移。

源码、使用说明与对应版本： https://github.com/0xTotoroX/palboo
项目采用 GPL-3.0-only；完整许可与第三方声明在本 Resources 目录中。分发时需提供对应修订的完整源码与必要构建材料。
`,
    );
    const app = join(staging, 'Palboo.app');
    const inspection = buildApplication({
      binary: artifact.binary,
      version,
      resources,
      destination: app,
      sourceFingerprint: artifact.source,
    });
    const candidate = join(staging, 'Palboo.dmg');
    const image = packageDmg({ app, output: candidate, version, temporary: staging });
    auditArtifact(candidate);
    const sha256 = createHash('sha256').update(readFileSync(candidate)).digest('hex');
    const output = join(root, plan.assets[0]);
    renameSync(candidate, output);
    const report = {
      version,
      artifact: plan.assets[0],
      sha256,
      app: inspection,
      image,
      buildSeconds: (built - started) / 1000,
      packageSeconds: (Date.now() - built) / 1000,
      notarized: false,
    };
    writeFileSync(
      join(root, 'target/reports/package.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(`产物：${output}\n${JSON.stringify(report)}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
