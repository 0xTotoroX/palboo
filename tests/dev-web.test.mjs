/* [INPUT]: Isolated web sources, generated assets and a controlled build runner.
 * [OUTPUT]: Fresh/stale/missing/failed/concurrently changed build acceptance.
 * [POS]: Dev embedded-web prerequisite regression; no host, installation or user data.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWebAssets, isWebInput } from '../scripts/dev-web.mjs';

test('Dev rebuilds reader and shared changes, reuses unchanged assets and recovers failed builds', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'palboo-dev-web-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['ui/reader', 'ui/shared', 'target/web'])
    mkdirSync(join(root, path), { recursive: true });
  const reader = join(root, 'ui/reader/main.tsx');
  writeFileSync(reader, 'reader-v1');
  writeFileSync(join(root, 'ui/shared/tokens.css'), 'theme-v1');
  let builds = 0;
  const build = async () => {
    builds++;
    writeFileSync(join(root, 'target/web/index.html'), 'settings');
    writeFileSync(join(root, 'target/web/reader.html'), readFileSync(reader));
  };
  await prepareWebAssets(root, build);
  await prepareWebAssets(root, build);
  assert.equal(builds, 1);
  writeFileSync(reader, 'reader-v2');
  await prepareWebAssets(root, build);
  assert.equal(readFileSync(join(root, 'target/web/reader.html'), 'utf8'), 'reader-v2');
  writeFileSync(join(root, 'ui/shared/tokens.css'), 'theme-v2');
  await prepareWebAssets(root, build);
  assert.equal(builds, 3);
  writeFileSync(join(root, 'target/web/reader.html'), 'overwritten by another build');
  await prepareWebAssets(root, build);
  assert.equal(builds, 4);
  const record = readFileSync(join(root, 'target/dev/web-build.json'), 'utf8');
  writeFileSync(reader, 'reader-v3');
  await assert.rejects(
    prepareWebAssets(root, async () => {
      throw new Error('compile failed');
    }),
    /compile failed/,
  );
  assert.equal(readFileSync(join(root, 'target/dev/web-build.json'), 'utf8'), record);
  await prepareWebAssets(root, build);
  assert.equal(builds, 5);
  writeFileSync(reader, 'reader-v4');
  await assert.rejects(
    prepareWebAssets(root, async () => {
      await build();
      writeFileSync(reader, 'reader-v5');
    }),
    /源码在构建中变化/,
  );
  await prepareWebAssets(root, build);
  assert.equal(readFileSync(join(root, 'target/web/reader.html'), 'utf8'), 'reader-v5');
  rmSync(join(root, 'target/web/reader.html'));
  await prepareWebAssets(root, build);
  assert.equal(builds, 8);
  assert.equal(isWebInput('ui/reader/main.tsx'), true);
  assert.equal(isWebInput('ui/shared/locales/en.js'), true);
  assert.equal(isWebInput('ui/website/main.tsx'), false);
  assert.equal(isWebInput('ui/reader/AGENTS.md'), false);
});
