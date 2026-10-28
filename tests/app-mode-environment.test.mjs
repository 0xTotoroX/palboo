/* [INPUT]: Finder-like environments and isolated executable fixtures.
 * [OUTPUT]: Homebrew/custom Cargo lookup, inherited toolchain precedence and early failure checks.
 * [POS]: No real compiler, host or mode changes. [PROTOCOL]: See tests/AGENTS.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { developmentEnvironment, checkDevelopmentTools } from '../scripts/app-mode.mjs';

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
