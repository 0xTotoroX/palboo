/*
 * [INPUT]: SemVer 版本、版本标签、已审核发行说明与可选 GitHub 输出文件。
 * [OUTPUT]: releasePlan；patch=0 的 DMG 计划与预发布状态。
 * [POS]: 本地打包和 Release 共用的资产策略，不上传或修改版本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releasePlan(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (!match) throw new Error('版本必须是有效的 X.Y.Z，可附带 SemVer 预发布或构建标识');
  const installer = match[3] === '0';
  return {
    version,
    tag: `v${version}`,
    installer,
    prerelease: Boolean(match[4]),
    assets: installer ? [`dist/palboo-${version}-darwin-arm64.dmg`] : [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const plan = releasePlan(version);
  if (process.argv[2] !== plan.tag) throw new Error('发布标签与 package.json 版本不一致');
  const cargo = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  const cargoPackage = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0] || '';
  const cargoLock =
    readFileSync(join(root, 'Cargo.lock'), 'utf8')
      .split('[[package]]')
      .find((block) => /^name = "palboo"$/m.test(block)) || '';
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  if (
    !cargoPackage.includes(`version = "${version}"`) ||
    !cargoLock.includes(`version = "${version}"`) ||
    lock.version !== version ||
    lock.packages[''].version !== version
  )
    throw new Error('Cargo/npm 版本不一致');
  if (!existsSync(join(root, '.github/release-notes', `${plan.tag}.md`)))
    throw new Error('缺少已审核的版本说明');
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `installer=${plan.installer}\nprerelease=${plan.prerelease}\n`,
    );
  console.log(JSON.stringify(plan));
}
