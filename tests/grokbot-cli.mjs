/* [INPUT]: Built PALBOO binary and isolated synthetic home/config directories.
 * [OUTPUT]: Embedded setup execution, scoped MCP registration/recovery and safe uninstall.
 * [POS]: Real CLI acceptance; no login, real service or Bot requests.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareTestBinary } from '../scripts/verify.mjs';
const artifact = prepareTestBinary();
const home = mkdtempSync(join(tmpdir(), 'palboo-cli 中文 '));
const codex = join(home, 'codex'),
  data = join(home, 'data');
mkdirSync(codex);
const config = join(codex, 'config.toml');
const original =
  '# personal comment\nmodel = "synthetic"\n[mcp_servers.other]\nurl = "https://example.com/mcp"\n';
writeFileSync(config, original);
const id = '10000000-0000-4000-8000-000000000000';
const binary = join(home, 'palboo');
copyFileSync(artifact.binary, binary);
chmodSync(binary, 0o755);
const env = { ...process.env, HOME: home, CODEX_HOME: codex, PALBOO_NODE: process.execPath };
function run(args) {
  return spawnSync(binary, ['--data-dir', data, 'grokbot', ...args], {
    cwd: home,
    env,
    encoding: 'utf8',
  });
}
try {
  for (let i = 0; i < 2; i++) {
    const result = run(['register', '--installation-id', id]);
    assert.equal(result.status, 0, result.stderr);
  }
  const registered = readFileSync(config, 'utf8');
  assert.equal((registered.match(/\[mcp_servers.grokbot\]/g) || []).length, 1);
  assert.ok(registered.startsWith(original));
  assert.match(registered, /enabled_tools = \["call_tool"\]/);
  assert.notEqual(
    run(['unregister', '--installation-id', '20000000-0000-4000-8000-000000000000']).status,
    0,
  );
  assert.equal(readFileSync(config, 'utf8'), registered);
  writeFileSync(config, registered.replace('3417', '9999'));
  assert.notEqual(run(['unregister', '--installation-id', id]).status, 0);
  assert.match(readFileSync(config, 'utf8'), /9999/);
  writeFileSync(config, registered);
  assert.equal(run(['unregister', '--installation-id', id]).status, 0);
  assert.ok(readFileSync(config, 'utf8').includes(original.trim()));
  assert.doesNotMatch(readFileSync(config, 'utf8'), /mcp_servers.grokbot/);
  // Execute the embedded Node installer from outside the checkout. A foreign MCP
  // causes an early safe stop, before npm/login/launchd/HTTP can run.
  const fakeCodex = join(home, 'fake-codex');
  writeFileSync(
    fakeCodex,
    `#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? 'codex fixture' : JSON.stringify([{name:'grokbot',transport:{url:'http://127.0.0.1:9999/mcp'}}]));\n`,
    { mode: 0o755 },
  );
  env.PALBOO_CODEX = fakeCodex;
  const setup = run(['setup']);
  assert.notEqual(
    setup.status,
    0,
    JSON.stringify({ stdout: setup.stdout, stderr: setup.stderr, error: setup.error?.message }),
  );
  assert.match(setup.stderr, /已有 grokbot MCP/);
  assert.equal(existsSync(join(home, 'Library/Application Support/palboo/grokbot/project')), false);
  assert.equal(existsSync(join(home, 'Library/LaunchAgents/com.palboo.grokbot-bdk.plist')), false);
  console.log(
    'PASS embedded setup outside checkout; MCP registration idempotence, ownership and config preservation',
  );
} finally {
  rmSync(home, { recursive: true, force: true });
}
