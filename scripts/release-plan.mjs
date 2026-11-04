/*
 * [INPUT]: SemVer 版本、Cargo/npm 版本文件与发行说明。
 * [OUTPUT]: 每个版本的 DMG 名称、标签、预发布状态和一致性校验。
 * [POS]: 本地打包和 Release 共用的资产策略，不上传或修改版本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releasePlan(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (!match) throw new Error('版本必须是有效的 X.Y.Z，可附带 SemVer 预发布或构建标识');
  return {
    version,
    tag: `v${version}`,
    prerelease: Boolean(match[4]),
    assets: [`dist/palboo-${version}-darwin-arm64.dmg`],
  };
}

export function validateRelease(root) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const plan = releasePlan(version);
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
  const notes = `.github/release-notes/${plan.tag}.md`;
  if (!readFileSync(join(root, notes), 'utf8').trim()) throw new Error('缺少版本说明');
  return { ...plan, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(validateRelease(resolve(import.meta.dirname, '..'))));
}
