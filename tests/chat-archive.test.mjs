/* [INPUT]: Actual archive controller and settings component with synthetic host and API.
 * [OUTPUT]: Paged preview, confirmation validation, partial results and narrow settings flow.
 * [POS]: No connection to the user's local ChatGPT history.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createLocalChatArchive } from '../ui/codex/chat-archive.js';

test('archives only the confirmed local snapshot and reports partial failures', async () => {
  const firstPage = [{ id: 'one' }, { id: 'side', attachedToThreadId: 'one' }];
  const nextPage = [
    { id: 'two', status: { type: 'active' } },
    { id: 'temporary', ephemeral: true },
  ];
  const requests = [];
  const archived = [];
  const scheduled = new Set(['one']);
  const host = {
    identity: ['account', 'user'],
    sameAccount: () => true,
    async list(cursor, externalOnly) {
      if (externalOnly) return { data: [] };
      requests.push(cursor);
      return cursor ? { data: nextPage } : { data: firstPage, nextCursor: 'next' };
    },
    scheduled: async () => scheduled,
    active: (thread) => thread.status?.type === 'active',
    async archive(id) {
      archived.push(id);
      if (id === 'two') throw Error('unavailable');
    },
  };
  const run = createLocalChatArchive({ isCurrent: () => true, resolve: async () => host });
  await assert.rejects(() => run('apply', 'unknown'), /预览已失效/);
  const { id, ...preview } = await run('preview');
  assert.deepEqual(preview, {
    cli: null,
    total: 2,
    groups: [{ cli: 'codex', count: 2 }],
    count: 2,
    running: 1,
    scheduled: 1,
  });
  assert.deepEqual(requests, [null, 'next']);
  assert.deepEqual(archived, []);
  await assert.rejects(() => run('apply', 'wrong'), /预览已失效/);
  scheduled.add('two');
  await assert.rejects(() => run('apply', id), /聊天或连接已变化/);
  assert.deepEqual(archived, []);
  const confirmed = await run('preview');
  assert.deepEqual(await run('apply', confirmed.id), { archived: 1, failed: 1, skipped: 0 });
  assert.deepEqual(archived, ['one', 'two']);
  await assert.rejects(() => run('apply', confirmed.id), /预览已失效/);

  nextPage.push({ id: 'one' });
  await assert.rejects(() => run('preview'), /无法完整读取/);
});

test('includes CodexHost chats and verifies the selected CLI again before archiving', async () => {
  const external = (id, extra) => ({
    id,
    modelProvider: 'codexhost',
    cliVersion: 'codexhost',
    ...extra,
  });
  const agents = new Map([
    ['agy-1', 'antigravity'],
    ['agy-2', 'antigravity'],
    ['grok-1', 'grok'],
  ]);
  const archived = [];
  const native = [{ id: 'codex-1' }, external('agy-1')];
  const host = {
    identity: ['account', 'user'],
    sameAccount: () => true,
    async list(cursor, externalOnly) {
      if (!externalOnly) return { data: native };
      return cursor
        ? { data: [external('agy-2'), external('child', { parentThreadId: 'agy-1' })] }
        : {
            data: [
              external('agy-1'),
              external('grok-1'),
              { id: 'other-account', modelProvider: 'codexhost' },
            ],
            nextCursor: 'next',
          };
    },
    async ownership(ids) {
      return {
        threads: ids.map((threadId) => ({
          threadId,
          owner: 'external',
          harnessId: agents.get(threadId),
        })),
      };
    },
    scheduled: async () => new Set(['grok-1']),
    active: ({ id }) => id === 'grok-1',
    async archive(id) {
      archived.push(id);
    },
  };
  const run = createLocalChatArchive({ isCurrent: () => true, resolve: async () => host });
  assert.deepEqual(await run('list'), {
    total: 4,
    groups: [
      { cli: 'codex', count: 1 },
      { cli: 'antigravity', count: 2 },
      { cli: 'grok', count: 1 },
    ],
  });
  const stale = await run('preview', null, 'antigravity');
  assert.equal(stale.count, 2);
  assert.equal(stale.running, 0);
  assert.equal(stale.scheduled, 0);
  agents.set('agy-2', 'grok');
  await assert.rejects(() => run('apply', stale.id), /聊天或连接已变化/);
  assert.deepEqual(archived, []);
  agents.set('agy-2', 'antigravity');
  const fresh = await run('preview', null, 'antigravity');
  native.push({ id: 'codex-2' });
  assert.equal((await run('list')).total, 5);
  const result = await run('apply', fresh.id, 'grok');
  assert.deepEqual(result, { archived: 2, failed: 0, skipped: 0 });
  assert.deepEqual(archived, ['agy-1', 'agy-2']);

  agents.delete('grok-1');
  await assert.rejects(() => run('list'), /无法确认 CodexHost 聊天的 CLI 归属/);
});

test('a disconnected host only archives its in-flight batch', async () => {
  let connected = true;
  const archived = [];
  const host = {
    identity: [],
    sameAccount: () => true,
    list: async (_cursor, externalOnly) => ({
      data: externalOnly ? [] : Array.from({ length: 9 }, (_, n) => ({ id: String(n) })),
    }),
    scheduled: async () => new Set(),
    active: () => false,
    async archive(id) {
      archived.push(id);
      connected = false;
    },
  };
  const run = createLocalChatArchive({ isCurrent: () => connected, resolve: async () => host });
  const plan = await run('preview');
  assert.deepEqual(await run('apply', plan.id), { archived: 8, failed: 0, skipped: 1 });
  assert.equal(archived.length, 8);
});

test('settings requires confirmation and displays the real result', async (t) => {
  const {
    outputFiles: [script],
  } = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ChatArchiveSettings} from './ui/settings/chat-archive-settings';
import {setLocale} from './ui/shared/i18n.js';
setLocale('en');
createRoot(document.querySelector('main')).render(<ChatArchiveSettings disabled={false}
  targetId="fixture" notify={(text, failed) => { document.getElementById('result').textContent = text;
  document.getElementById('result').dataset.failed = String(failed); }} />);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'import.meta.url': '"https://archive.test/settings.js"' },
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 320, height: 640 },
    reducedMotion: 'reduce',
  });
  const requests = [];
  let inventory = {
    total: 10,
    groups: [
      { cli: 'codex', count: 6 },
      { cli: 'antigravity', count: 4 },
    ],
  };
  await page.route('https://archive.test/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/chat-archive') {
      assert.equal(route.request().headers().authorization, 'Bearer fixture');
      const body = route.request().postDataJSON();
      requests.push(body);
      return route.fulfill({
        json:
          body.op === 'list'
            ? inventory
            : body.op === 'preview'
              ? {
                  ...inventory,
                  id: 'fixture-plan',
                  cli: body.cli,
                  count: 4,
                  running: 1,
                  scheduled: 2,
                }
              : { archived: 3, failed: 1, skipped: 0 },
      });
    }
    await route.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width"><main></main><output id="result"></output>',
    });
  });
  await page.goto('https://archive.test/#token=fixture');
  await page.addScriptTag({ content: script.text });
  await page.getByRole('button', { name: 'Find chats to archive' }).click();
  const scope = page.getByRole('combobox', { name: 'Archive scope' });
  assert.equal(await scope.locator('option[value="all"]').innerText(), 'All local chats (10)');
  const archive = page.getByRole('button', { name: 'Preview archive' });
  assert.equal(await archive.isEnabled(), false);
  await scope.selectOption({ value: 'cli:antigravity' });
  await archive.click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('heading', { name: 'Archive 4 local chats from Antigravity CLI?' })
    .waitFor();
  assert.match(await dialog.innerText(), /scheduled tasks linked to 2 chats/);
  assert.match(await dialog.innerText(), /Settings → Archived chats/);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(requests, [{ op: 'list' }, { op: 'preview', cli: 'antigravity' }]);
  await archive.click();
  await dialog.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await page.getByText('Archived 3 chats. 1 failed and 0 were skipped.').waitFor();
  assert.equal(await page.locator('#result').getAttribute('data-failed'), 'true');
  assert.deepEqual(requests, [
    { op: 'list' },
    { op: 'preview', cli: 'antigravity' },
    { op: 'preview', cli: 'antigravity' },
    { op: 'apply', id: 'fixture-plan' },
  ]);
  inventory = { total: 6, groups: [{ cli: 'codex', count: 6 }] };
  await page.getByRole('button', { name: 'Find chats to archive' }).click();
  await scope.waitFor();
  assert.equal(await scope.inputValue(), '');
  assert.equal(await archive.isEnabled(), false);
});
