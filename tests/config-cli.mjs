/* [INPUT]: Current CLI binary, isolated service and synthetic settings/tasks/glossary files.
 * [OUTPUT]: Latest settings discovery, partial writes, opaque imports, personal exports and revision/persistence checks.
 * [POS]: Never reads installed configuration or connects to a real host or reminders account.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { prepareTestBinary } from '../scripts/verify.mjs';
const exec = promisify(execFile);
const { binary } = prepareTestBinary();
const data = await mkdtemp(join(tmpdir(), 'buddy-config-cli-'));
let child;
const cli = async (...args) =>
  JSON.parse(
    (await exec(binary, ['--data-dir', data, 'config', ...args], { maxBuffer: 4 * 1024 * 1024 }))
      .stdout,
  );
const set = (scope, patch, ...args) => cli('set', scope, '--json', JSON.stringify(patch), ...args);
async function api(path, body) {
  const { port, token } = JSON.parse(await readFile(join(data, 'runtime.json'), 'utf8'));
  return fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function start() {
  child = spawn(
    binary,
    ['--data-dir', data, 'serve', '--port', '0', '--cdp', 'http://127.0.0.1:9', '--allow-fixture'],
    { stdio: 'ignore' },
  );
  for (let n = 0; n < 100; n++) {
    try {
      await cli('get', 'settings');
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('fixture service unavailable');
}
async function stop() {
  if (child?.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await done;
  }
}
try {
  const schema = await cli('schema');
  assert.equal(schema.length, 9);
  const schemaFor = (scope) => schema.find((item) => item.scope === scope);
  assert.ok(schemaFor('appearance').nestedFields.ui.includes('promptClickMode'));
  assert.ok(schemaFor('model-control').nestedFields.patch.includes('showUsage'));
  assert.ok(schemaFor('layout').operations.includes('edge-tabs'));
  assert.ok(schemaFor('terminology').operations.includes('reset-library'));
  const help = (await exec(binary, ['config', '--help'])).stdout;
  for (const command of ['catalog', 'import', 'export']) assert.ok(help.includes(command));
  assert.ok(!help.includes('reminders'), 'retired integration stays out of normal discovery');
  await assert.rejects(() => cli('get', 'settings'), /后台未运行/);
  const baseTerm = (id) => ({
    id,
    name: `Fixture ${id}`,
    definition: 'Synthetic foundation entry',
    category: ['Fixture'],
  });
  await writeFile(
    join(data, 'terminology-library.json'),
    JSON.stringify([baseTerm('BASE-1'), baseTerm('BASE-2')]),
  );
  await start();
  const original = await cli('get', 'settings');
  const dry = await set('settings', { generationMode: 'manual' }, '--dry-run');
  assert.equal(dry.dryRun, true);
  assert.equal(
    (await cli('get', 'settings')).configurationRevision,
    original.configurationRevision,
  );
  await assert.rejects(
    () =>
      set('settings', { model: 'ignored', expectedRevision: original.configurationRevision + 1 }),
    /修订已变化/,
  );
  await assert.rejects(() => set('appearance', { setingsTheme: 'dark' }), /未知/);
  await assert.rejects(() => set('settings', { clearApiKey: true }), /明确确认/);
  const secretPath = join(data, 'input.json');
  await writeFile(
    secretPath,
    JSON.stringify({ apiKey: 'fixture-key-never-in-output', generationMode: 'manual' }),
    { mode: 0o600 },
  );
  const preview = await cli('set', 'settings', '--file', secretPath, '--dry-run');
  assert.equal(preview.patch.apiKey, '[redacted]');
  const secretResult = await cli('set', 'settings', '--file', secretPath);
  assert.ok(!JSON.stringify(secretResult).includes('fixture-key-never-in-output'));
  const changed = await set('settings', { maxItems: 4 });
  assert.equal(changed.current.maxItems, 4);
  assert.equal(changed.current.storedApiKey, true);
  const customDirection = {
    id: 'cli-custom',
    name: 'Review coverage',
    instruction: 'Check omitted cases.',
    enabled: true,
  };
  const generated = await set('settings', {
    directionLibrary: [...changed.current.directionLibrary, customDirection],
    selectedDirections: [...changed.current.selectedDirections].reverse(),
    quickPrompts: [
      ...changed.current.quickPrompts,
      { label: 'Review', prompt: 'Review the plan.' },
    ],
    grokbotAutoSync: false,
    tokenMeterEnabled: false,
  });
  assert.equal(generated.current.directionLibrary.at(-1).id, 'cli-custom');
  assert.equal(generated.current.builtInDirections.length, 12);
  assert.equal(generated.current.quickPrompts.at(-1).label, 'Review');
  await set('settings', { jev: { endpoint: 'http://127.0.0.1:9/fixture', model: 'fixture-jev' } });
  await set('settings', { jev: { model: 'fixture-jev-updated' } });
  assert.equal((await cli('get', 'settings')).jev.endpoint, 'http://127.0.0.1:9/fixture');
  await assert.rejects(() => set('settings', { jev: { consent: true } }), /明确确认/);
  const appearance = await cli('get', 'appearance');
  assert.equal(appearance.settingsTheme, null);
  const dark = await set('appearance', { settingsTheme: 'dark' });
  assert.equal(dark.current.settingsTheme, 'dark');
  assert.deepEqual(dark.current.ui, appearance.ui);
  await assert.rejects(() => set('appearance', { settingsTheme: 'other' }), /主题无效/);
  assert.equal((await cli('get', 'appearance')).settingsTheme, 'dark');
  await set('appearance', {
    language: 'en',
    ui: { labelOnly: true, promptClickMode: 'hybrid', dockWidth: 360, sidebarNewChat: true },
  });
  await set('appearance', {
    typography: { mode: 'custom', source: 'composer', customSize: 21, scale: 120 },
  });
  const font = await set('appearance', { typography: { scale: 110 } });
  assert.deepEqual(font.current.typography, {
    mode: 'custom',
    source: 'composer',
    customSize: 21,
    scale: 110,
  });
  assert.equal(font.current.ui.promptClickMode, 'hybrid');
  await assert.rejects(() => set('appearance', { typography: { scle: 110 } }), /未知/);
  await set('tasks', { op: 'modules', boardEnabled: true });
  const created = await set('tasks', {
    op: 'create',
    fields: {
      title: 'CLI 合成任务',
      notes: '保留说明',
      priority: 3,
      due: { year: 2026, month: 10, day: 20, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
    },
  });
  const task = created.current.store.tasks[0];
  const edited = await set('tasks', { op: 'update', id: task.id, fields: { priority: 5 } });
  assert.equal(edited.current.store.tasks[0].fields.priority, 5);
  assert.equal(edited.current.store.tasks[0].fields.notes, '保留说明');
  assert.equal(edited.current.store.tasks[0].fields.due.timeZone, 'Asia/Shanghai');
  await assert.rejects(
    () =>
      set('tasks', { op: 'update', id: task.id, expectedTask: task, fields: { title: 'stale' } }),
    /修订已变化/,
  );
  await assert.rejects(() => set('tasks', { op: 'remove', id: task.id }), /明确确认/);
  assert.equal((await cli('get', 'tasks')).store.tasks.length, 1);
  await set('terminology', { jumpOnClick: false });
  const surface = await cli('get', 'surfaces');
  await set('surfaces', {
    placement: 'sidebar',
    theme: { theme: 'matte', liquidVariant: 'regular' },
  });
  const latest = await cli('get', 'surfaces');
  assert.equal(latest.preferences.themes.sidebar.theme, 'matte');
  assert.deepEqual(latest.preferences.themes.desktop, surface.preferences.themes.desktop);
  await set('surfaces', { placement: 'sidebar', theme: { liquidVariant: 'clear' } });
  const material = await set('surfaces', {
    placement: 'sidebar',
    theme: { theme: 'native-glass' },
  });
  assert.equal(material.current.preferences.themes.sidebar.liquidVariant, 'clear');
  await set('surfaces', { edge: { edge: 'top', screen: 'codex', keepOpen: true } });
  const edgePosition = await set('surfaces', { edge: { position: 0.4 } });
  assert.equal(edgePosition.current.preferences.edge.screen, 'codex');
  assert.equal(edgePosition.current.preferences.edge.keepOpen, true);
  await set('model-control', { patch: { modelColumnWidth: 240 } });
  assert.equal((await cli('get', 'model-control')).preferences.modelColumnWidth, 240);
  const organization = {
    showUsage: false,
    pinned: ['fixture-model'],
    groups: [{ id: 'cli-group', name: 'Fixture' }],
    modelOverrides: { 'fixture-model': { groupId: 'cli-group' } },
    presets: [
      {
        id: 'fixture-preset',
        name: 'Fixture',
        selection: { model: 'fixture-model', reasoning: 'low', speed: 'standard' },
      },
    ],
  };
  await set('model-control', { patch: organization });
  const modelWidth = await set('model-control', { patch: { modelColumnWidth: 220 } });
  assert.equal(modelWidth.current.preferences.showUsage, false);
  assert.deepEqual(modelWidth.current.preferences.presets, organization.presets);
  await assert.rejects(() => set('model-control', { patch: { presets: [] } }), /明确确认/);
  const layout = {
    axis: 'vertical',
    groups: [
      { ids: ['outline'], active: 'outline', weight: 1 },
      { ids: ['next'], active: 'next', weight: 1 },
    ],
  };
  const arranged = await set('layout', { op: 'main-layout', placement: 'sidebar', layout });
  assert.deepEqual(arranged.current.layouts.sidebar, layout);
  await assert.rejects(
    () => set('layout', { op: 'main-layout', placement: 'sidebar', layout, expectedLayout: null }),
    /布局已变化/,
  );
  const stacked = {
    axis: 'vertical',
    groups: [
      {
        axis: 'horizontal',
        weight: 1,
        groups: [
          { ids: ['outline', 'next'], active: 'next', weight: 1, collapsed: true },
          { ids: ['terms'], active: 'terms', weight: 1 },
        ],
      },
      { ids: ['board'], active: 'board', weight: 1, collapsed: true },
    ],
  };
  assert.deepEqual(
    (await set('layout', { op: 'main-layout', placement: 'sidebar', layout: stacked })).current
      .layouts.sidebar,
    stacked,
  );
  await set('layout', {
    op: 'edge-tabs',
    tabs: { order: ['model', 'board', 'terms'], selected: 'model' },
  });
  const edgeTabs = await set('layout', { op: 'edge-tabs', tabs: { selected: 'board' } });
  assert.deepEqual(edgeTabs.current.edgeTabs.order, ['model', 'board', 'terms']);
  await assert.rejects(
    () =>
      set('layout', {
        op: 'edge-tabs',
        tabs: { selected: 'terms' },
        expected: { order: [], selected: '' },
      }),
    /修订已变化/,
  );

  // Names and opaque files queue work; this CLI never triggers a chat or replaces the foundation.
  await set('terminology', {
    action: 'manual',
    entries: [
      {
        id: 'ignored',
        name: 'Personal fixture',
        definition: 'Synthetic personal entry',
        category: ['Fixture'],
      },
    ],
  });
  await set('terminology', { action: 'favorite', id: 'BASE-1' });
  await set('terminology', { action: 'master', id: 'BASE-1' });
  const names = await set('terminology', { action: 'add-names', names: ['Fixture deferred name'] });
  const job = names.current.imports.jobs[0];
  assert.equal(job.status, 'queued');
  assert.equal(job.kind, 'name');
  await assert.rejects(() => set('terminology', { names: ['silently ignored'] }), /不接受/);
  const stale = await api('terminology', {
    action: 'add-names',
    names: ['stale name'],
    revision: names.current.imports.revision - 1,
  });
  assert.equal(stale.ok, false, 'backend rejects concurrent library writes, not only the CLI');
  const stalePreferences = await api('terminology', {
    action: 'unfavorite',
    id: 'BASE-1',
    revision: 0,
  });
  assert.equal(stalePreferences.ok, false);
  await set('terminology', { action: 'retry-import', id: job.id });
  const file = join(data, 'terms # & 术语.any');
  const opaque = Buffer.alloc(70_000, 0xe3); // Beyond the JSON-patch limit, intentionally not text/JSON.
  await writeFile(file, opaque);
  const importsBefore = (await cli('get', 'terminology')).imports;
  assert.equal((await cli('import', 'terminology', '--file', file, '--dry-run')).uploaded, false);
  assert.deepEqual((await cli('get', 'terminology')).imports, importsBefore);
  const uploaded = await cli('import', 'terminology', '--file', file);
  const fileJob = uploaded.current.imports.jobs.find((entry) => entry.kind === 'file');
  assert.equal(uploaded.execution, 'next-user-message');
  assert.equal(fileJob.name, 'terms # & 术语.any');
  assert.equal(fileJob.status, 'queued');
  assert.deepEqual(
    await readFile(join(data, 'terminology-imports', fileJob.id, 'source.any')),
    opaque,
  );
  await writeFile(join(data, 'too-big.bin'), Buffer.alloc(8_000_001));
  await assert.rejects(
    () => cli('import', 'terminology', '--file', join(data, 'too-big.bin')),
    /8 MB/,
  );
  assert.equal((await cli('get', 'terminology')).imports.jobs.length, 2);
  const exported = await cli('export', 'terminology');
  assert.equal(exported.entries.length, 2);
  assert.ok(exported.entries.some((entry) => entry.id === 'BASE-1'));
  assert.ok(!exported.entries.some((entry) => entry.id === 'BASE-2'));
  const exportedPath = join(data, 'personal.md');
  await cli('export', 'terminology', '--format', 'markdown', '--output', exportedPath);
  assert.ok((await readFile(exportedPath, 'utf8')).includes('Personal fixture'));
  await assert.rejects(() => cli('export', 'terminology', '--output', exportedPath), /不会被覆盖/);
  assert.ok((await readFile(exportedPath, 'utf8')).includes('Personal fixture'));
  await assert.rejects(
    () => set('terminology', { action: 'remove-import', id: fileJob.id }),
    /明确确认/,
  );
  await set('terminology', { action: 'remove-import', id: fileJob.id }, '--confirm');
  await assert.rejects(
    () => readFile(join(data, 'terminology-imports', fileJob.id, 'source.any')),
    /ENOENT/,
  );
  const resetPreview = await set('terminology', { action: 'reset-library' }, '--dry-run');
  assert.equal(resetPreview.confirmationRequired, true);
  assert.equal(resetPreview.patch.revision, resetPreview.before.imports.revision);
  await assert.rejects(() => set('terminology', { action: 'reset-library' }), /明确确认/);
  const reset = await set('terminology', { action: 'reset-library' }, '--confirm');
  assert.deepEqual(
    reset.current.entries.map((entry) => entry.id),
    ['BASE-1', 'BASE-2'],
  );
  assert.deepEqual(reset.current.preferences.favorites, ['BASE-1']);
  assert.deepEqual(reset.current.preferences.mastered, ['BASE-1']);
  assert.equal(reset.current.imports.jobs.length, 0);
  const keys = Object.keys(await cli('get'));
  assert.equal(keys.length, 9);
  await stop();
  await start();
  assert.equal((await cli('get', 'appearance')).settingsTheme, 'dark');
  assert.equal((await cli('get', 'settings')).storedApiKey, true);
  assert.equal((await cli('get', 'tasks')).store.tasks[0].fields.priority, 5);
  assert.equal((await cli('get', 'appearance')).language, 'en');
  assert.equal((await cli('get', 'appearance')).typography.customSize, 21);
  assert.equal((await cli('get', 'model-control')).preferences.showUsage, false);
  assert.equal((await cli('get', 'layout')).edgeTabs.selected, 'board');
  assert.equal((await cli('get', 'terminology')).entries.length, 2);
  await stop();
  // Catalog transport is checked with synthetic responses, never real BDK profiles or a model API.
  const requests = [];
  const catalogServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      path: req.url,
      method: req.method,
      authorized: req.headers.authorization === 'Bearer fixture-catalog-token',
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fixture: true }));
  });
  await new Promise((resolve) => catalogServer.listen(0, '127.0.0.1', resolve));
  try {
    await writeFile(
      join(data, 'runtime.json'),
      JSON.stringify({
        pid: process.pid,
        port: catalogServer.address().port,
        token: 'fixture-catalog-token',
        version: '1.0.0',
        executable: binary,
      }),
    );
    for (const args of [['models'], ['displays'], ['bots'], ['bots', '--refresh']])
      assert.equal((await cli('catalog', ...args)).fixture, true);
    assert.deepEqual(requests, [
      { path: '/api/settings/models', method: 'GET', authorized: true, body: null },
      { path: '/api/surfaces/displays', method: 'GET', authorized: true, body: null },
      {
        path: '/api/features',
        method: 'POST',
        authorized: true,
        body: { op: 'bots-catalog', refresh: false },
      },
      {
        path: '/api/features',
        method: 'POST',
        authorized: true,
        body: { op: 'bots-catalog', refresh: true },
      },
    ]);
  } finally {
    await new Promise((resolve) => catalogServer.close(resolve));
  }
  await mkdir('target/reports', { recursive: true });
  await writeFile(
    'target/reports/config-cli.json',
    JSON.stringify({ passed: true, scopes: keys, realUserDataAccessed: false }, null, 2),
  );
  console.log(
    'PASS CLI settings/catalog discovery, partial writes, glossary transfer/reset, secrets, revisions and persistence',
  );
} finally {
  await stop();
  await rm(data, { recursive: true, force: true });
}
