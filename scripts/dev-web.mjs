/* [INPUT]: Current worktree web sources and the existing build:web command runner.
 * [OUTPUT]: Cached web build identity; only a successful, unchanged build is reusable.
 * [POS]: Dev startup and native rebuild prerequisite for embedded reader/web resources.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { filesUnder, fingerprint } from './dev-panel.mjs';

export function isWebInput(path) {
  return (
    ((path.startsWith('ui/reader/') || path.startsWith('ui/shared/')) && !path.endsWith('.md')) ||
    [
      'ui/settings/reader.html',
      'ui/settings/vite.config.ts',
      'ui/settings/use-host-appearance.ts',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'scripts/third-party-notices.mjs',
      'scripts/license-texts.json',
    ].includes(path)
  );
}
export function webFingerprint(root) {
  return fingerprint(root, [
    ...filesUnder(root, 'ui').filter(isWebInput),
    ...[
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'scripts/third-party-notices.mjs',
      'scripts/license-texts.json',
    ].filter((path) => existsSync(join(root, path))),
  ]);
}
export async function prepareWebAssets(root, build) {
  const record = join(root, 'target/dev/web-build.json');
  const before = webFingerprint(root);
  let saved;
  try {
    saved = JSON.parse(readFileSync(record, 'utf8'));
  } catch {}
  const output = () => fingerprint(root, filesUnder(root, 'target/web'));
  if (
    existsSync(join(root, 'target/web/reader.html')) &&
    existsSync(join(root, 'target/web/index.html')) &&
    saved?.source === before &&
    saved?.output === output()
  )
    return;
  await build();
  if (before !== webFingerprint(root)) throw new Error('网页源码在构建中变化，等待下一次更新');
  if (
    !existsSync(join(root, 'target/web/reader.html')) ||
    !existsSync(join(root, 'target/web/index.html'))
  )
    throw new Error('网页构建缺少阅读器或设置入口');
  mkdirSync(join(root, 'target/dev'), { recursive: true });
  writeFileSync(record + '.next', JSON.stringify({ source: before, output: output() }));
  renameSync(record + '.next', record);
}
