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
      join(resources, '安装说明.txt'),
      `Palboo ${version}

将 Palboo.app 拖入“应用程序”，再双击打开。主程序无需 Node.js 或 Rust。
支持 macOS 14+ Apple Silicon；桌面浮窗需要 macOS 15+。
本 App 使用本地签名，未经过 Apple 公证。首次打开被系统拦截时，在确认下载来源后进入“系统设置 → 隐私与安全性 → 仍要打开”。

Codex 桌面应用及可选 Agent 使用你自己的安装、登录与配置；安装包不携带维护者的密钥、聊天或个人词库。
既有 Codex 无调试连接时，Palboo 沿用启动设置询问是否重开。配置保存在当前用户数据目录，移动 App 不会移动或删除配置。
更新时替换完整 Palboo.app。App 内的主程序不支持单文件覆盖升级。
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
