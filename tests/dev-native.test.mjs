/* [INPUT]: Isolated source trees, tool fixtures and a controlled compiler callback.
 * [OUTPUT]: Persistent reuse, invalidation and failed/changing build recovery checks.
 * [POS]: Native cache regression; no user application, data or real compiler is started.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNativeBinary } from '../scripts/dev-native.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'palboo-native-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['src', 'ui/shared', '.cargo', 'tools', 'target/debug', 'target/web'])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'src/main.rs'), 'source-v1');
  writeFileSync(join(root, 'package.json'), '{"name":"palboo"}');
  for (const name of ['cargo', 'rustc'])
    writeFileSync(join(root, 'tools', name), '#!/bin/sh\necho tool-v1\n', { mode: 0o700 });
  const env = {
    PATH: `${join(root, 'tools')}:${dirname(process.execPath)}:/usr/bin:/bin`,
    CARGO_HOME: join(root, 'cargo-home'),
    CARGO_TARGET_DIR: join(root, 'target'),
  };
  const binary = join(root, 'target/debug/palboo');
  let builds = 0;
  const build = async () => writeFileSync(binary, `program-${++builds}`, { mode: 0o700 });
  return { root, env, binary, build, builds: () => builds };
}

test('native cache survives a fresh call and ignores timestamps and documentation', async (t) => {
  const f = fixture(t);
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, false);
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, true);
  utimesSync(join(f.root, 'src/main.rs'), new Date(), new Date());
  writeFileSync(join(f.root, 'ui/shared/AGENTS.md'), 'updated documentation');
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, true);
  assert.equal(f.builds(), 1);
});

test('changed code, assets, toolchain, flags and damaged output invalidate native reuse', async (t) => {
  const f = fixture(t);
  await prepareNativeBinary(f.root, f.build, f.env);
  const mutate = [
    () => writeFileSync(join(f.root, 'src/main.rs'), 'source-v2'),
    () => writeFileSync(join(f.root, 'ui/shared/new.js'), 'embedded asset'),
    () => rmSync(join(f.root, 'ui/shared/new.js')),
    () => writeFileSync(join(f.root, 'target/web/reader.html'), 'new reader'),
    () => writeFileSync(join(f.root, 'tools/rustc'), '#!/bin/sh\necho tool-v2\n'),
    () => {
      f.env.RUSTFLAGS = '-C opt-level=1';
    },
    () => {
      f.env.CFLAGS_aarch64_apple_darwin = '-O1';
    },
    () => {
      f.env.HOST_CC = 'clang';
    },
    () => {
      f.env.ARFLAGS = 'crs';
    },
    () => writeFileSync(join(f.root, '.cargo/config.toml'), '[build]\n'),
    () => writeFileSync(f.binary, 'overwritten output'),
    () => rmSync(f.binary),
  ];
  for (const change of mutate) {
    change();
    assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, false);
    assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, true);
  }
  assert.equal(f.builds(), 1 + mutate.length);
});

test('failed and concurrently changed builds never certify old or partial programs', async (t) => {
  const f = fixture(t);
  await prepareNativeBinary(f.root, f.build, f.env);
  writeFileSync(join(f.root, 'src/main.rs'), 'source-v2');
  await assert.rejects(
    prepareNativeBinary(
      f.root,
      async () => {
        writeFileSync(f.binary, 'partial output');
        throw new Error('compiler failed');
      },
      f.env,
    ),
    /compiler failed/,
  );
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, false);
  writeFileSync(join(f.root, 'src/main.rs'), 'source-v3');
  await assert.rejects(
    prepareNativeBinary(
      f.root,
      async () => {
        await f.build();
        writeFileSync(join(f.root, 'src/main.rs'), 'changed while compiling');
      },
      f.env,
    ),
    /编译期间/,
  );
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, false);
  assert.equal((await prepareNativeBinary(f.root, f.build, f.env)).reused, true);
  const saved = JSON.parse(readFileSync(join(f.root, 'target/dev/native-build.json')));
  assert.deepEqual(Object.keys(saved).sort(), ['identity', 'output', 'schema', 'source']);
});
