/* [INPUT]: 私有事件文件、Swift 入口与合成 CLI。
 * [OUTPUT]: 阶段隔离、数据边界、原生反馈/错误/重试/重复打开的回归。
 * [POS]: 不启动真实 Codex、不截图、不写日常配置；原生窗口验收显式开启。
 * [PROTOCOL]: 变更时更新 tests/AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  symlinkSync,
  existsSync,
  statSync,
} from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startupPhase } from '../scripts/startup-progress.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'palboo-startup-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('progress accepts only private existing regular files and fixed phases', (t) => {
  const root = fixture(t),
    file = join(root, 'events');
  writeFileSync(file, '', { mode: 0o600 });
  startupPhase('build', file);
  startupPhase('private text should never be recorded', file);
  const event = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(event), ['phase', 'atMs', 'pid']);
  assert.equal(event.phase, 'build');
  assert.ok(Math.abs(Date.now() - event.atMs) < 5000);
  const link = join(root, 'link');
  symlinkSync(file, link);
  startupPhase('opening', link);
  chmodSync(file, 0o644);
  startupPhase('opening', file);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), event);
  chmodSync(file, 0o600);
  writeFileSync(file, 'x'.repeat(262144));
  startupPhase('opening', file);
  assert.equal(statSync(file).size, 262144);
  rmSync(file);
  startupPhase('opening', file);
  assert.equal(existsSync(file), false);
});

test(
  'native startup shows both languages, preserves one window and retries with a fresh request',
  {
    skip: process.platform !== 'darwin' || process.env.PALBOO_NATIVE_LAUNCHER_TEST !== '1',
  },
  (t) => {
    const root = fixture(t),
      app = join(root, 'Startup.app'),
      bin = join(app, 'Contents/MacOS');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Launcher</string><key>CFBundleIdentifier</key><string>local.palboo.startup-test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
    );
    execFileSync('xcrun', [
      'swiftc',
      '-D',
      'LAUNCHER_UI_TEST',
      '-target',
      'arm64-apple-macosx14.0',
      resolve('scripts/lifecycle-notice.swift'),
      resolve('scripts/app-launcher.swift'),
      '-o',
      join(bin, 'Launcher'),
    ]);
    writeFileSync(
      join(bin, 'palboo'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = "app-mode" ] && [ ! -f "$ATTEMPT" ]; then
  touch "$ATTEMPT"
  sleep 0.5
  echo 'Synthetic startup failed. The existing session is preserved. Retry when the connection is available.' >&2
  exit 2
fi
if [ "$1" = "app-mode" ]; then echo '{"mode":"release"}'; fi
`,
      { mode: 0o700 },
    );
    for (const language of ['zh', 'en']) {
      const data = join(root, language);
      mkdirSync(data);
      writeFileSync(join(data, 'app-mode.json'), '{"mode":"development"}');
      writeFileSync(
        join(data, 'appearance-cache.json'),
        JSON.stringify({
          schemaVersion: 1,
          dataDirectory: data,
          revision: 1,
          language: language === 'zh' ? 'zh-CN' : 'en',
          lifecyclePreview: {
            display: 'popup',
            material: 'matte',
            placement: 'host-center',
            progress: 'energy',
            position: { x: 0.5, y: 0.5 },
          },
          settingsAppearance: {
            theme: 'dark',
            colors: { accent: '#23bc98', page: '#181818', text: '#ffffff' },
          },
        }),
        { mode: 0o600 },
      );
      const calls = join(data, 'calls');
      const result = spawnSync(join(bin, 'Launcher'), [], {
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          PALBOO_NATIVE_TEST_LANGUAGE: language,
          PALBOO_LAUNCHER_HOME: data,
          CALLS: calls,
          ATTEMPT: join(data, 'attempt'),
        },
      });
      assert.equal(result.status, 0, result.stderr + String(result.error || result.signal || ''));
      assert.match(result.stdout, /geometry and reopen verified/);
      assert.match(result.stdout, /request cleanup and retry verified/);
      assert.match(result.stdout, /native exit waited for the owned process to stop/);
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
        'app-mode launch',
        'app-mode launch',
        'popout',
      ]);
      const report = JSON.parse(readFileSync(join(data, 'startup-last.json')));
      assert.equal(report.outcome, 'ready');
      assert.equal(statSync(join(data, 'startup-last.json')).mode & 0o777, 0o600);
      assert.ok(report.stages.some((s) => s.phase === 'presenting'));
      assert.equal(JSON.stringify(report).includes('Synthetic'), false);
    }
  },
);
