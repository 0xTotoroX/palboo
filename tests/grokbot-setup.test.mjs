/* [INPUT]: Temporary user directories and simulated CLI/login/launchd/HTTP boundaries.
 * [OUTPUT]: Fresh install, interrupted connect, conflict preservation and owned uninstall checks.
 * [POS]: PALBOO onboarding acceptance; never touches real accounts or services.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  locations,
  launchAgent,
  bdkEnvironment,
  checkSkillConflict,
  main,
} from '../scripts/grokbot-setup/main.mjs';

test('per-user paths, explicit login isolation and space-safe launch arguments', () => {
  const paths = locations('/tmp/用户 with spaces', '/tmp/独立 Codex');
  assert.equal(paths.legacySkill, '/tmp/独立 Codex/skills/grokbot-bdk');
  const plist = launchAgent(
    paths.project,
    join(paths.root, 'state'),
    join(paths.root, 'logs'),
    '/tmp/Node & tools/node',
  );
  assert.match(plist, /Node &amp; tools\/node<\/string>/);
  assert.match(plist, /AGENT_SERVE_CONFIG_DIR/);
  assert.match(plist, /--no-playground/);
  assert.match(plist, /127\.0\.0\.1/);
  assert.equal(bdkEnvironment(paths).CURSOR_API_KEY, '');
  assert.equal(bdkEnvironment(paths).CURSOR_API_KEY_FILE, '/dev/null');
  assert.equal(bdkEnvironment(paths).AGENT_SERVE_CONFIG_DIR, join(paths.root, 'auth'));
});
test('existing and dangling Skills are never replaced', () => {
  const home = mkdtempSync(join(tmpdir(), 'palboo-skill-'));
  const paths = locations(home, join(home, 'codex'));
  try {
    mkdirSync(dirname(paths.skill), { recursive: true });
    symlinkSync(join(home, 'missing'), paths.skill);
    assert.throws(() => checkSkillConflict(paths, null), /已有/);
    assert.throws(() => checkSkillConflict(paths, { skillOwned: true }), /ENOENT/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test(
  'fresh setup resumes after confirmation, registers one bridge, and only uninstalls owned resources',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'palboo setup 中文 '));
    const paths = locations(home, join(home, 'codex'));
    let loaded = false,
      loggedIn = false,
      registrations = [],
      failRegistration = true;
    const calls = [];
    const stdout = [];
    const oldHost = process.env.PALBOO_HOST_CLI;
    process.env.PALBOO_HOST_CLI = 'palboo-test-host';
    t.mock.method(console, 'log', (...args) => stdout.push(args));
    t.mock.method(net, 'createServer', () => ({
      once() {},
      listen(_port, _host, cb) {
        cb();
      },
      close(cb) {
        cb();
      },
    }));
    t.mock.method(cp, 'spawnSync', (file, args, options) => {
      calls.push([file, args, options]);
      const ok = (value = '') => ({ status: 0, stdout: value, stderr: '' });
      if (file === 'codex') {
        if (args[0] === '--version') return ok('codex test');
        assert.deepEqual(args, ['mcp', 'list', '--json']);
        return ok(JSON.stringify(registrations));
      }
      if (file === 'npm') {
        assert.equal(args[0], 'ci');
        const pkg = join(paths.project, 'node_modules/@cursor/bdk/package.json');
        mkdirSync(dirname(pkg), { recursive: true });
        writeFileSync(pkg, '{"version":"0.2.27"}');
        return ok();
      }
      if (file === 'launchctl') {
        if (args[0] === 'print') return { status: loaded ? 0 : 113, stdout: '' };
        if (args[0] === 'bootstrap') loaded = true;
        if (args[0] === 'bootout') loaded = false;
        return ok();
      }
      if (file === 'palboo-test-host') {
        if (args[1] === 'register') {
          if (failRegistration) return { status: 1 };
          registrations = [{ name: 'grokbot', transport: { url: 'http://127.0.0.1:3417/v1/mcp' } }];
        }
        if (args[1] === 'unregister') registrations = [];
        return ok();
      }
      assert.equal(file, process.execPath);
      assert.equal(options.env.AGENT_SERVE_CONFIG_DIR, join(paths.root, 'auth'));
      assert.equal(options.env.CURSOR_API_KEY_FILE, '/dev/null');
      if (args[0].endsWith('install-grokbot-adapter.mjs')) {
        const skill = join(paths.project, 'skills/grokbot-bdk/SKILL.md');
        mkdirSync(dirname(skill), { recursive: true });
        writeFileSync(skill, 'synthetic skill');
        return ok();
      }
      if (args[1] === 'whoami') return { status: loggedIn ? 0 : 1, stdout: 'synthetic account' };
      if (args[1] === 'login') loggedIn = true;
      return ok();
    });
    syncBuiltinESMExports();
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({
        result: {
          catalog: {
            version: 1,
            installationId: JSON.parse(readFileSync(paths.manifest)).id,
            stale: false,
            bots: [{ name: 'Synthetic Bot' }],
          },
        },
      }),
    }));
    try {
      // Noninteractive setup must stop for explicit account confirmation, after reusable preparation.
      await assert.rejects(main('setup', false, paths), /核对.*账号/);
      assert.equal(loggedIn, true);
      assert.equal(loaded, false);
      assert.equal(registrations.length, 0);
      assert.ok(existsSync(join(paths.project, 'package-lock.json')));
      await assert.rejects(main('connect', true, paths), /grokbot 未完成/);
      assert.equal(loaded, true);
      assert.equal(registrations.length, 0);
      failRegistration = false;
      // Recover registration failure without restarting a healthy owned bridge.
      const boots = calls.filter(([, args]) => args[0] === 'bootstrap').length;
      await main('connect', true, paths);
      assert.equal(calls.filter(([, args]) => args[0] === 'bootstrap').length, boots);
      assert.equal(registrations.length, 1);
      assert.ok(existsSync(join(paths.skill, 'SKILL.md')));
      const installs = calls.filter(([, args]) =>
        args[0]?.endsWith('install-grokbot-adapter.mjs'),
      ).length;
      await main('connect', true, paths);
      assert.equal(
        calls.filter(([, args]) => args[0]?.endsWith('install-grokbot-adapter.mjs')).length,
        installs,
      );
      await assert.rejects(main('login', false, paths), /先 grokbot stop/);
      // Missing registration and link can be repaired without losing the running service.
      registrations = [];
      rmSync(paths.skill);
      await main('connect', true, paths);
      assert.equal(registrations.length, 1);
      assert.ok(existsSync(join(paths.skill, 'SKILL.md')));
      assert.equal(calls.filter(([, args]) => args[0] === 'bootstrap').length, boots);
      const original = readFileSync(paths.plist, 'utf8');
      writeFileSync(paths.plist, `${original}\n<!-- user change -->`);
      await assert.rejects(main('uninstall', false, paths), /已被修改/);
      assert.equal(registrations.length, 1);
      assert.equal(loaded, true);
      writeFileSync(paths.plist, original);
      await main('uninstall', false, paths);
      assert.equal(loaded, false);
      assert.equal(registrations.length, 0);
      assert.equal(existsSync(paths.skill), false);
      assert.equal(existsSync(paths.plist), false);
      assert.ok(existsSync(paths.project));
      assert.equal(existsSync(`${paths.root}.lock`), false);
      // Unowned MCP is preserved before dependency installation or login.
      registrations = [{ name: 'grokbot', transport: { url: 'http://127.0.0.1:9999/mcp' } }];
      const count = calls.filter(([file]) => file === 'npm').length;
      await assert.rejects(main('setup', false, paths), /已有 grokbot MCP/);
      assert.equal(calls.filter(([file]) => file === 'npm').length, count);
    } finally {
      if (oldHost === undefined) delete process.env.PALBOO_HOST_CLI;
      else process.env.PALBOO_HOST_CLI = oldHost;
      t.mock.restoreAll();
      syncBuiltinESMExports();
      rmSync(home, { recursive: true, force: true });
    }
  },
);

test('adapter installs into a genuinely fresh bot directory and keeps only a credential fingerprint', async () => {
  const { cpSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const directory = mkdtempSync(join(tmpdir(), 'palboo-adapter-fresh-'));
  const source = fileURLToPath(new URL('../scripts/', import.meta.url));
  try {
    const bundle = join(directory, 'bundle'),
      project = join(directory, 'project');
    mkdirSync(bundle);
    mkdirSync(join(project, 'bot'), { recursive: true });
    cpSync(
      join(source, 'install-grokbot-adapter.mjs'),
      join(bundle, 'install-grokbot-adapter.mjs'),
    );
    cpSync(join(source, 'grokbot-adapter'), join(bundle, 'grokbot-adapter'), { recursive: true });
    // Only the external account source is synthetic; the installer/copy/rename code is real.
    writeFileSync(
      join(bundle, 'grokbot-adapter/catalog.mjs'),
      'export const readCatalog = () => ({account:"synthetic",stale:false,bots:[{name:"Synthetic Bot"}]});',
    );
    writeFileSync(join(project, 'package.json'), '{"dependencies":{"@cursor/bdk":"0.2.27"}}');
    const sdk = join(project, 'node_modules/@cursor/bdk');
    mkdirSync(join(sdk, 'internal/cursor'), { recursive: true });
    writeFileSync(
      join(sdk, 'package.json'),
      '{"name":"@cursor/bdk","type":"module","exports":"./index.js"}',
    );
    writeFileSync(join(sdk, 'index.js'), '');
    writeFileSync(
      join(sdk, 'internal/cursor/credentials.js'),
      'export const resolveApiKeySync = () => ({apiKey:"synthetic-fixture-credential"});',
    );
    const result = cp.spawnSync(
      process.execPath,
      [join(bundle, 'install-grokbot-adapter.mjs'), project],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: directory,
          PALBOO_GROKBOT_INSTALLATION_ID: 'fixture-installation',
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const account = readFileSync(join(project, 'bot/extensions/grokbot/account.json'), 'utf8');
    assert.equal(JSON.parse(account).installationId, 'fixture-installation');
    assert.match(JSON.parse(account).credentialFingerprint, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(account, /synthetic-fixture-credential/);
    assert.ok(existsSync(join(project, 'skills/grokbot-bdk/SKILL.md')));
    const again = cp.spawnSync(
      process.execPath,
      [join(bundle, 'install-grokbot-adapter.mjs'), project],
      { encoding: 'utf8', env: { ...process.env, HOME: directory } },
    );
    assert.equal(again.status, 0, again.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
