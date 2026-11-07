/* [INPUT]: Finder-like environments and isolated executable fixtures.
 * [OUTPUT]: Homebrew/custom Cargo lookup, inherited toolchain precedence, cold-start/prepare build caching and early failure checks.
 * [POS]: No real compiler, host or mode changes. [PROTOCOL]: See tests/AGENTS.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  developmentEnvironment,
  checkDevelopmentTools,
  developmentAction,
} from '../scripts/app-mode.mjs';

test('Finder can resolve keg-only Homebrew Rust and preserve a selected custom toolchain', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'palboo-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const brew = join(root, 'brew'),
    cargoHome = join(root, 'custom-cargo');
  for (const [bin, label] of [
    [join(brew, 'opt/rustup/bin'), 'brew'],
    [join(cargoHome, 'bin'), 'custom'],
  ]) {
    mkdirSync(bin, { recursive: true });
    for (const file of ['cargo', 'rustc'])
      writeFileSync(join(bin, file), `#!/bin/sh\necho ${label}-${file}\n`, { mode: 0o700 });
  }
  const inherited = {
    ...process.env,
    PATH: '/usr/bin:/bin',
    HOMEBREW_PREFIX: brew,
    PALBOO_START_DISCONNECTED: '1',
  };
  delete inherited.CARGO_HOME;
  const env = developmentEnvironment(inherited);
  assert.equal(
    execFileSync('cargo', ['--version'], { env, encoding: 'utf8' }).trim(),
    'brew-cargo',
  );
  assert.equal(env.PALBOO_START_DISCONNECTED, undefined);
  assert.equal(inherited.PALBOO_START_DISCONNECTED, '1');
  checkDevelopmentTools(env);
  const custom = developmentEnvironment({ ...inherited, CARGO_HOME: cargoHome });
  assert.equal(
    execFileSync('cargo', ['--version'], { env: custom, encoding: 'utf8' }).trim(),
    'custom-cargo',
  );
  const selected = developmentEnvironment({ ...inherited, PATH: join(cargoHome, 'bin') });
  assert.equal(
    execFileSync('cargo', ['--version'], { env: selected, encoding: 'utf8' }).trim(),
    'custom-cargo',
  );
  assert.throws(() => checkDevelopmentTools({ PATH: root }), /开发环境找不到可用的 npm/);
});

test('cold Dev open prebuilds source and reuses cached web assets before starting the supervisor', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'palboo-cold-open-'));
  const bin = join(root, 'bin');
  const log = join(root, 'builds.log');
  for (const path of [bin, join(root, 'node_modules/vite'), join(root, 'ui/reader')])
    mkdirSync(path, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'palboo', scripts: { 'build:web': './bin/build-web' } }),
  );
  writeFileSync(join(root, 'node_modules/vite/package.json'), '{}');
  writeFileSync(join(root, 'ui/reader/main.tsx'), 'reader-v1');
  writeFileSync(
    join(bin, 'build-web'),
    `#!/bin/sh
echo "npm run build:web:\${CARGO_TARGET_DIR:-}" >> ${JSON.stringify(log)}
mkdir -p target/web
printf 'index' > target/web/index.html
cat ui/reader/main.tsx > target/web/reader.html
`,
    { mode: 0o700 },
  );
  for (const tool of ['cargo', 'rustc']) {
    writeFileSync(
      join(bin, tool),
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${tool}-fixture"; exit 0; fi
echo "${tool} $*:\${CARGO_TARGET_DIR:-}" >> ${JSON.stringify(log)}
`,
      { mode: 0o700 },
    );
  }
  const runtimeServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/state'
          ? { connection: { status: 'connected' } }
          : { ok: true, pid: process.pid },
      ),
    );
  });
  runtimeServer.listen(0, '127.0.0.1');
  await once(runtimeServer, 'listening');
  const previousCargoHome = process.env.CARGO_HOME;
  const previousPath = process.env.PATH;
  const previousLogLevel = process.env.npm_config_loglevel;
  process.env.CARGO_HOME = root;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.npm_config_loglevel = 'silent';
  t.after(async () => {
    if (previousCargoHome === undefined) delete process.env.CARGO_HOME;
    else process.env.CARGO_HOME = previousCargoHome;
    if (previousLogLevel === undefined) delete process.env.npm_config_loglevel;
    else process.env.npm_config_loglevel = previousLogLevel;
    process.env.PATH = previousPath;
    runtimeServer.closeAllConnections();
    await new Promise((resolve) => runtimeServer.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts/dev.mjs'),
    `import fs from 'node:fs';
fs.mkdirSync('target/dev/real', { recursive: true });
fs.writeFileSync('target/dev/owner.json', JSON.stringify({ pid: ${process.pid} }));
fs.writeFileSync('target/dev/real/runtime.json', JSON.stringify({ pid: ${process.pid}, port: ${runtimeServer.address().port}, token: 'fixture' }));
fs.writeFileSync('target/dev/session.json', JSON.stringify({ supervisorPid: process.pid, runtime: process.cwd() + '/target/dev/real', url: 'http://127.0.0.1:${runtimeServer.address().port}', token: 'fixture' }));
`,
  );
  await developmentAction(root, 'prepare');
  const targetDir = join(root, 'target');
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    `npm run build:web:${targetDir}`,
    `cargo build --locked:${targetDir}`,
  ]);
  const opened = await developmentAction(root, 'open');
  assert.equal(opened.pid, process.pid);
  assert.deepEqual(
    readFileSync(log, 'utf8').trim().split('\n'),
    [
      `npm run build:web:${targetDir}`,
      `cargo build --locked:${targetDir}`,
      `cargo build --locked:${targetDir}`,
    ],
    'unchanged web assets are reused on cold open',
  );
  await developmentAction(root, 'open');
  assert.equal(
    readFileSync(log, 'utf8').trim().split('\n').length,
    3,
    'live owner reuses running session without rebuilding',
  );
});
