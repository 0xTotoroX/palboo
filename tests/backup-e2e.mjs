/* [INPUT]: Verified binary, synthetic local configs and isolated launcher registration.
 * [OUTPUT]: Local export/preview/restore/undo and live Dev/Release copy lifecycle assertions.
 * [POS]: No host application, real config, cloud, credentials or chat content is accessed.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareTestBinary } from '../scripts/verify.mjs';
const binary = prepareTestBinary().binary;
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'palboo-backup-')));
const launcher = join(scratch, 'launcher');
const source = join(scratch, 'source');
const dev = join(source, 'target/dev/real');
const release = join(scratch, 'release');
const children = [];
const checks = [];
const record = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Synthetic backup service did not reach expected state');
}
async function start(path) {
  const child = spawn(binary, ['--data-dir', path, 'serve', '--port', '0', '--allow-fixture'], {
    env: { ...process.env, PALBOO_LAUNCHER_HOME: launcher, PALBOO_START_DISCONNECTED: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const runtime = await until(() => json(join(path, 'runtime.json'))).catch((e) => {
    throw Error(`${e.message}: ${stderr.slice(-1000)}`);
  });
  const api = async (body, expected = 200) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/backup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    assert.equal(response.status, expected, result.message);
    return result;
  };
  await until(() => api({ op: 'status' }));
  return { runtime, api, path };
}
async function applied(service, preview) {
  await service.api({ op: 'apply', previewId: preview.previewId, confirm: true });
  const status = await until(async () => {
    const state = await service.api({ op: 'status' });
    return state.last?.previewId === preview.previewId && state;
  });
  assert.equal(status.last.ok, true, status.last.message);
  assert.equal(
    status.last.previewId,
    preview.previewId,
    'completion belongs to the confirmed preview',
  );
  assert.deepEqual(
    await json(join(service.path, 'runtime.json')),
    service.runtime,
    'reload keeps process, port and token',
  );
}
try {
  for (const path of [launcher, dev, release]) await mkdir(path, { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ version: '1.6.0' }));
  await writeFile(
    join(launcher, 'app-mode.json'),
    JSON.stringify({
      mode: 'development',
      revision: 1,
      source,
      releaseData: release,
      executable: binary,
    }),
  );
  for (const [path, model] of [
    [dev, 'synthetic-dev'],
    [release, 'synthetic-release'],
  ])
    await writeFile(
      join(path, 'config.json'),
      JSON.stringify({
        provider: 'api',
        model,
        baseUrl: 'http://127.0.0.1:9',
        cdpEndpoint: 'http://127.0.0.1:9',
        stepwise: { generationMode: 'manual' },
        performance: { integrationEnabled: false },
      }),
    );
  const a = await start(dev),
    b = await start(release);
  const status = await a.api({ op: 'status' });
  const target = status.targets.find((t) => t.path === release);
  assert.ok(target);
  const exported = await a.api({ op: 'export' });
  const archive = JSON.parse(Buffer.from(exported.data, 'base64'));
  assert.ok(!archive.sections.secrets);
  assert.ok(!archive.sections.data);
  const original = await readFile(join(release, 'config.json'), 'utf8');
  const preview = await a.api({
    op: 'copy',
    source: 'current',
    target: target.id,
    sections: ['settings'],
  });
  assert.equal(
    await readFile(join(release, 'config.json'), 'utf8'),
    original,
    'preview cannot write',
  );
  await a.api({ op: 'apply', previewId: preview.previewId }, 400);
  // An unconfirmed request must leave the preview available.
  await applied(a, preview);
  assert.equal((await json(join(release, 'config.json'))).model, 'synthetic-dev');
  assert.deepEqual(await json(join(release, 'runtime.json')), b.runtime);
  const live = await fetch(`http://127.0.0.1:${b.runtime.port}/api/state`, {
    headers: { Authorization: `Bearer ${b.runtime.token}` },
  }).then((r) => r.json());
  assert.equal(live.connection.status, 'disconnected');
  record(
    'running Dev → Release copy, explicit preview/confirmation and preserved disconnected state',
  );
  const undo = await a.api({ op: 'undo', target: target.id });
  await applied(a, undo);
  assert.equal((await json(join(release, 'config.json'))).model, 'synthetic-release');
  record('remote undo restores previous config without restarting either process');
  archive.sections.settings.files['config.json'].model = 'synthetic-import';
  const data = Buffer.from(JSON.stringify(archive)).toString('base64');
  const imported = await a.api({ op: 'preview', data, sections: ['settings'] });
  await applied(a, imported);
  assert.equal((await json(join(dev, 'config.json'))).model, 'synthetic-import');
  const localUndo = await a.api({ op: 'undo' });
  await applied(a, localUndo);
  assert.equal((await json(join(dev, 'config.json'))).model, 'synthetic-dev');
  const recovery = await stat(join(dev, 'backups/latest.json'));
  assert.equal(recovery.mode & 0o777, 0o600);
  record('local import and undo reload the service; recovery points are private');
  const stale = await a.api({ op: 'preview', data, sections: ['settings'] });
  const config = await json(join(dev, 'config.json'));
  config.model = 'newer-edit';
  await writeFile(join(dev, 'config.json'), JSON.stringify(config));
  const rejected = await a.api({ op: 'apply', previewId: stale.previewId, confirm: true }, 400);
  assert.match(rejected.message, /变化/);
  assert.equal((await json(join(dev, 'config.json'))).model, 'newer-edit');
  record('changed targets reject stale previews without overwriting the edit');
  await mkdir('target/reports/local-backup', { recursive: true });
  await writeFile(
    'target/reports/local-backup/lifecycle.json',
    JSON.stringify({ passed: true, checks }, null, 2) + '\n',
  );
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            child.once('exit', resolve);
            setTimeout(() => {
              child.kill('SIGKILL');
              resolve();
            }, 3000).unref();
          }),
    ),
  );
  await rm(scratch, { recursive: true, force: true });
}
