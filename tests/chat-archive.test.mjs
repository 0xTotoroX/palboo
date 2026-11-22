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
    async list(cursor) {
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
  assert.deepEqual(preview, { count: 2, running: 1, scheduled: 1 });
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

test('a disconnected host only archives its in-flight batch', async () => {
  let connected = true;
  const archived = [];
  const host = {
    identity: [],
    sameAccount: () => true,
    list: async () => ({ data: Array.from({ length: 9 }, (_, n) => ({ id: String(n) })) }),
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
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 320, height: 640 },
    reducedMotion: 'reduce',
  });
  const requests = [];
  await page.route('https://archive.test/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/chat-archive') {
      assert.equal(route.request().headers().authorization, 'Bearer fixture');
      const body = route.request().postDataJSON();
      requests.push(body);
      return route.fulfill({
        json:
          body.op === 'preview'
            ? { id: 'fixture-plan', count: 4, running: 1, scheduled: 2 }
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
  const archive = page.getByRole('button', { name: 'Archive all local chats' });
  await archive.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Archive 4 local chats?' }).waitFor();
  assert.match(await dialog.innerText(), /scheduled tasks linked to 2 chats/);
  assert.match(await dialog.innerText(), /Settings → Archived chats/);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(requests, [{ op: 'preview' }]);
  await archive.click();
  await dialog.getByRole('button', { name: 'Archive all', exact: true }).click();
  await page.getByText('Archived 3 chats. 1 failed and 0 were skipped.').waitFor();
  assert.equal(await page.locator('#result').getAttribute('data-failed'), 'true');
  assert.deepEqual(requests, [
    { op: 'preview' },
    { op: 'preview' },
    { op: 'apply', id: 'fixture-plan' },
  ]);
});
