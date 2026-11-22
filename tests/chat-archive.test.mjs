/* [INPUT]: Actual archive controller and settings component with synthetic host and API.
 * [OUTPUT]: Paged preview, confirmation validation, partial results and narrow settings flow.
 * [POS]: No connection to the user's local ChatGPT history.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createLocalChatArchive } from '../ui/codex/chat-archive.js';
import {
  normalizeArchiveFilters,
  resolveArchiveProject,
  selectArchiveChats,
} from '../ui/codex/chat-archive-filters.js';

test('archives only the confirmed local snapshot and reports partial failures', async () => {
  const firstPage = [
    { id: 'one', name: 'A title' },
    { id: 'side', attachedToThreadId: 'one' },
  ];
  const nextPage = [
    { id: 'two', status: { type: 'active' }, preview: 'A message snippet' },
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
  const confirmed = await run('preview', null, null, {}, true);
  assert.deepEqual(
    confirmed.sessions.map(({ id, title, active, scheduled }) => ({
      id,
      title,
      active,
      scheduled,
    })),
    [
      { id: 'one', title: 'A title', active: false, scheduled: true },
      { id: 'two', title: null, active: true, scheduled: true },
    ],
  );
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

test('project aliases and inclusive local dates select the correct chats', () => {
  const metadata = {
    projects: new Map([
      ['p', { roots: ['/projects/p'] }],
      ['q', { roots: ['/projects/q'] }],
    ]),
    aliases: new Map([['native-p', 'p']]),
    assignments: { attached: { projectKind: 'local', projectId: 'p' } },
    projectless: new Set(['free']),
  };
  assert.equal(
    resolveArchiveProject(
      { id: 'attached', projectId: 'native-p', cwd: '/worktrees/one' },
      metadata,
    ),
    'p',
  );
  assert.equal(resolveArchiveProject({ id: 'attached', projectId: 'q' }, metadata), null);
  assert.equal(resolveArchiveProject({ id: 'free', cwd: '/projects/p' }, metadata), 'projectless');
  assert.equal(resolveArchiveProject({ id: 'rooted', cwd: '/projects/p/sub' }, metadata), 'p');
  assert.equal(resolveArchiveProject({ id: 'unknown', cwd: '/projects/pp' }, metadata), null);
  const filters = normalizeArchiveFilters({
    project: 'p',
    dateField: 'created',
    from: '2026-11-01',
    through: '2026-11-01',
  });
  const chat = (id, date, project = 'p') => ({
    cli: 'codex',
    project,
    thread: { id, createdAt: new Date(date).getTime() / 1000 },
  });
  const result = selectArchiveChats(
    [
      chat('begin', '2026-11-01T00:00:00'),
      chat('end', '2026-11-01T23:59:59'),
      chat('next', '2026-11-02T00:00:00'),
      chat('other', '2026-11-01T12:00:00', 'q'),
    ],
    'codex',
    filters,
  );
  assert.deepEqual(
    result.selected.map(({ thread }) => thread.id),
    ['begin', 'end'],
  );
  assert.throws(() => normalizeArchiveFilters({ from: '2026-02-30' }), /归档规则无效/);
  assert.throws(
    () => normalizeArchiveFilters({ from: '2026-11-01', inactiveDays: 7 }),
    /归档规则无效/,
  );
});

test('the weekly rule preserves recent, pinned and scheduled chats and verifies archiving', async () => {
  const day = 86_400_000;
  const thread = (id, days, projectId = 'p') => ({
    id,
    projectId,
    updatedAt: Date.now() - days * day,
    status: { type: 'idle' },
  });
  const threads = [
    thread('one', 8),
    thread('two', 9),
    thread('three', 10),
    thread('archive', 11),
    thread('pinned', 12),
    thread('scheduled', 13),
    thread('busy', 14),
    thread('q-only', 16, 'q'),
    thread('unknown-project', 16, 'not-known'),
    thread('free', 16, null),
  ];
  const done = new Set();
  const workspace = {
    projects: new Map([
      ['p', { label: 'P', roots: [] }],
      ['q', { label: 'Q', roots: [] }],
    ]),
    assignments: {},
    aliases: new Map(),
    projectless: new Set(['free']),
  };
  const host = {
    identity: ['fixture'],
    sameAccount: () => true,
    projectMetadata: async () => workspace,
    list: async (_, external, archived) => ({
      data: external ? [] : threads.filter(({ id }) => Boolean(archived) === done.has(id)),
    }),
    read: async (id) => threads.find((thread) => thread.id === id),
    active: ({ id }) => id === 'busy',
    idle: ({ id }) => id !== 'busy',
    pinned: async () => new Set(['pinned']),
    scheduled: async () => new Set(['scheduled']),
    archive: async (id) => {
      done.add(id);
    },
  };
  const run = createLocalChatArchive({ isCurrent: () => true, resolve: async () => host });
  const filters = { inactiveDays: 7, keepRecent: 3, protect: true };
  const plan = await run('preview', null, 'codex', filters);
  assert.equal(plan.count, 2);
  assert.equal(plan.unresolvedProjects, 1);
  assert.equal(done.size, 0);
  const result = await run('apply', plan.id);
  assert.deepEqual([...done], ['archive', 'free']);
  assert.equal(result.verified, true);
  assert.deepEqual(
    result.projects.find(({ id }) => id === 'p'),
    { id: 'p', label: 'P', remaining: 6 },
  );
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
  let echoRules = true;
  let includeSessions = true;
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
                  ...(echoRules && body.filters ? { filters: body.filters } : {}),
                  count: 4,
                  running: 1,
                  scheduled: 2,
                  sessions: includeSessions
                    ? Array.from({ length: 4 }, (_, index) => ({
                        id: `fixture-session-${index + 1}`,
                        cli: body.cli ?? 'codex',
                        title: `Example chat ${index + 1}`,
                        project: 'palboo',
                        projectLabel: 'Palboo',
                        created: Date.UTC(2026, 10, 8),
                        updated: Date.UTC(2026, 10, 12),
                        active: index === 0,
                        scheduled: index < 2,
                      }))
                    : [],
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
  assert.match(await dialog.innerText(), /stop 1 running chats/);
  assert.match(await dialog.innerText(), /scheduled tasks linked to 2 chats/);
  assert.match(await dialog.innerText(), /Settings → Archived chats/);
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .evaluate((n) => n === document.activeElement),
    true,
    'initial focus lands safely on Cancel',
  );
  const sessions = dialog.getByRole('list', { name: 'Sessions to archive' });
  assert.equal(await sessions.getByRole('listitem').count(), 4);
  const firstItem = sessions.getByRole('listitem').first();
  const collapsedText = await firstItem.innerText();
  assert.match(collapsedText, /Example chat 1.*In progress.*Scheduled/s);
  assert.doesNotMatch(collapsedText, /fixture-session-1/);
  await firstItem.getByRole('button').click();
  assert.match(
    await firstItem.innerText(),
    /Example chat 1.*Antigravity CLI.*Palboo.*Linked scheduled task.*fixture-session-1/s,
  );
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const previewRequest = { op: 'preview', cli: 'antigravity', includeSessions: true };
  assert.deepEqual(requests, [{ op: 'list' }, previewRequest]);
  await archive.click();
  await dialog.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await page.getByText('Archived 3 chats. 1 failed and 0 were skipped.').waitFor();
  assert.equal(await page.locator('#result').getAttribute('data-failed'), 'true');
  assert.deepEqual(requests, [
    { op: 'list' },
    previewRequest,
    previewRequest,
    { op: 'apply', id: 'fixture-plan' },
  ]);
  inventory = {
    total: 6,
    groups: [{ cli: 'codex', count: 6 }],
    projects: [{ id: 'palboo', label: 'Palboo', count: 5 }],
  };
  await page.getByRole('button', { name: 'Find chats to archive' }).click();
  await scope.waitFor();
  assert.equal(await scope.inputValue(), '');
  assert.equal(await archive.isEnabled(), false);
  await scope.selectOption('all');
  await page.getByRole('combobox', { name: 'Projects', exact: true }).selectOption('palboo');
  await page.getByRole('combobox', { name: 'Time filter' }).selectOption('range');
  assert.equal(await archive.isEnabled(), false);
  await page.getByRole('combobox', { name: 'Date field' }).selectOption('created');
  await page.getByLabel('Start date').fill('2026-11-01');
  echoRules = false;
  await archive.click();
  await page
    .getByText('The current Palboo connection did not confirm the selected rules. Preview again.')
    .waitFor();
  assert.equal(await dialog.isVisible(), false);
  echoRules = true;
  includeSessions = false;
  await archive.click();
  await page
    .getByText(
      'The current Palboo connection did not return the complete session list. Preview again.',
    )
    .waitFor();
  assert.equal(await dialog.isVisible(), false);
  includeSessions = true;
  await archive.click();
  await dialog.getByRole('button', { name: 'Confirm archive', exact: true }).waitFor();
  assert.match(await dialog.innerText(), /Project: Palboo.*Created from 2026-11-01/s);
  await sessions.getByRole('listitem').first().getByRole('button').click();
  assert.match(await sessions.getByRole('listitem').first().innerText(), /Date created/);
  assert.deepEqual(requests.at(-1), {
    op: 'preview',
    cli: null,
    includeSessions: true,
    filters: { project: 'palboo', dateField: 'created', from: '2026-11-01' },
  });
});

test('38-candidate archive dialog keeps first row unclipped, safe focus and keyboard details', async (t) => {
  const {
    outputFiles: [script],
  } = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatArchiveSettings } from './ui/settings/chat-archive-settings';
import { setLocale } from './ui/shared/i18n.js';
setLocale('zh-CN');
createRoot(document.querySelector('main')).render(
  <div className="settings-app">
    <ChatArchiveSettings disabled={false} targetId="fixture" notify={() => {}} />
  </div>
);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    define: { 'import.meta.url': '"https://archive.test/settings.js"' },
  });
  const styles =
    '*,*::before,*::after{box-sizing:border-box}body{margin:0}\n' +
    (
      await Promise.all([
        readFile('ui/shared/tokens.css', 'utf8'),
        readFile('ui/settings/settings-layout.css', 'utf8'),
        readFile('ui/settings/settings-controls.css', 'utf8'),
        readFile('ui/settings/chat-archive-sessions.css', 'utf8'),
      ])
    ).join('\n');
  const sessions38 = Array.from({ length: 38 }, (_, i) => ({
    id: `019a2f3c-8d1e-7b2a-9c4f-${String(100000000000 + i).slice(-12)}`,
    cli: 'antigravity',
    title:
      i === 0
        ? '这是一条非常长的会话标题用于验证折行与展开效果，确保长标题在窄窗口和桌面端都能清楚辨认'
        : `归档候选会话 ${i + 1}`,
    project: i % 2 === 0 ? 'palboo' : 'projectless',
    projectLabel: i % 2 === 0 ? 'Palboo' : null,
    created: Date.UTC(2026, 9, 1 + (i % 20)),
    updated: Date.UTC(2026, 10, 22 - (i % 20)),
    active: i === 0,
    scheduled: i < 2,
  }));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 960, height: 760 },
    reducedMotion: 'reduce',
  });
  await page.route('https://archive.test/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/chat-archive') {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json:
          body.op === 'list'
            ? {
                total: 38,
                groups: [{ cli: 'antigravity', count: 38 }],
                projects: [
                  { id: 'palboo', label: 'Palboo', count: 19 },
                  { id: 'projectless', label: null, count: 19 },
                ],
              }
            : {
                total: 38,
                groups: [{ cli: 'antigravity', count: 38 }],
                projects: [
                  { id: 'palboo', label: 'Palboo', count: 19 },
                  { id: 'projectless', label: null, count: 19 },
                ],
                id: 'plan-38',
                cli: body.cli,
                count: 38,
                running: 1,
                scheduled: 2,
                sessions: sessions38,
              },
      });
    }
    await route.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width"><main></main>',
    });
  });
  await page.goto('https://archive.test/#token=fixture');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script.text });
  await page.getByRole('button', { name: '查看可归档聊天' }).click();
  await page.getByRole('combobox', { name: '归档范围' }).selectOption('cli:antigravity');
  await page.getByRole('button', { name: '预览归档' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: '归档 Antigravity CLI 的 38 个本地聊天？' }).waitFor();

  for (const theme of ['light', 'dark']) {
    await page.evaluate((mode) => {
      document.documentElement.dataset.settingsTheme = mode;
    }, theme);
    const geometry = await page.evaluate(() => {
      const dlg = document.querySelector('dialog[open]');
      const list = dlg.querySelector('.archive-session-list');
      const first = list.querySelector('.archive-session-row');
      const impact = dlg.querySelector('.archive-confirm-impact');
      const footer = dlg.querySelector('.settings-confirm-footer');
      const dlgRect = dlg.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const impactRect = impact.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        dialogScrollTop: dlg.scrollTop,
        listScrollTop: list.scrollTop,
        firstClippedTop: firstRect.top < listRect.top - 0.5,
        listScrolls: list.scrollHeight > list.clientHeight + 20,
        visibleRows: listRect.height / firstRect.height,
        impactVisible: impactRect.top >= dlgRect.top && impactRect.bottom <= listRect.top + 1,
        footerVisible: footerRect.bottom <= window.innerHeight + 0.5,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        cancelFocused: document.activeElement?.textContent?.trim() === '取消',
        headerCountBadge: Boolean(dlg.querySelector('.archive-sessions-count')),
      };
    });
    assert.equal(geometry.dialogScrollTop, 0);
    assert.equal(geometry.listScrollTop, 0);
    assert.equal(geometry.firstClippedTop, false);
    assert.equal(geometry.listScrolls, true);
    assert.ok(geometry.visibleRows >= 6, `expected >=6 rows visible, got ${geometry.visibleRows}`);
    assert.equal(geometry.impactVisible, true);
    assert.equal(geometry.footerVisible, true);
    assert.equal(geometry.overflowX, false);
    assert.equal(geometry.cancelFocused, true);
    assert.equal(geometry.headerCountBadge, false);
  }

  // Keyboard navigation: Shift+Tab into list, roving arrows, Enter expands details, single Tab back to Cancel.
  await page.keyboard.press('Shift+Tab');
  assert.match(
    await page.evaluate(() => document.activeElement?.textContent ?? ''),
    /非常长的会话标题/,
  );
  await page.keyboard.press('Enter');
  const firstItem = dialog.getByRole('list', { name: '待归档会话' }).getByRole('listitem').first();
  assert.match(
    await firstItem.innerText(),
    /Antigravity CLI.*Palboo.*019a2f3c-8d1e-7b2a-9c4f-100000000000/s,
  );
  await page.keyboard.press('End');
  assert.match(
    await page.evaluate(() => document.activeElement?.textContent ?? ''),
    /归档候选会话 38/,
  );
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消');

  // Re-opening always resets to row 1 and safe initial focus on Cancel.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '预览归档' }).click();
  await dialog.waitFor({ state: 'visible' });
  const reopened = await page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const list = dlg.querySelector('.archive-session-list');
    return {
      dialogScrollTop: dlg.scrollTop,
      listScrollTop: list.scrollTop,
      cancelFocused: document.activeElement?.textContent?.trim() === '取消',
      expandedCount: dlg.querySelectorAll('[aria-expanded="true"]').length,
    };
  });
  assert.deepEqual(reopened, {
    dialogScrollTop: 0,
    listScrollTop: 0,
    cancelFocused: true,
    expandedCount: 0,
  });

  // Narrow viewport keeps no horizontal overflow and pinned footer.
  await page.setViewportSize({ width: 320, height: 640 });
  const narrow = await page.evaluate(() => {
    const dlg = document.querySelector('dialog[open]');
    const footer = dlg.querySelector('.settings-confirm-footer');
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      footerVisible: footer.getBoundingClientRect().bottom <= window.innerHeight + 0.5,
    };
  });
  assert.deepEqual(narrow, { overflowX: false, footerVisible: true });
});
