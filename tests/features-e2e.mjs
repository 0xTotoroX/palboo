/* [INPUT]: Matching test binary, isolated Chrome fixture and optional AppKit window probe.
 * [OUTPUT]: Real HTTP/CDP ownership, capability-gated recovery, draft handoff and task independence.
 * [POS]: Isolated end-to-end acceptance; no real chat, model requests or EventKit writes.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import assert from 'node:assert/strict';
// Synthetic roster filename encoding; no product adapter is bundled.
function cacheFile(key) {
  let bits = '';
  for (const byte of Buffer.from(key)) bits += byte.toString(2).padStart(8, '0');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return (
    bits
      .match(/.{1,5}/g)
      .map((v) => alphabet[parseInt(v.padEnd(5, '0'), 2)])
      .join('') + '.blob'
  );
}
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { prepareTestBinary } from '../scripts/verify.mjs';
const root = resolve(import.meta.dirname, '..'),
  artifact = prepareTestBinary(),
  native = process.argv.includes('--native');
const directory = mkdtempSync(join(tmpdir(), 'buddy-features-')),
  output = join(root, 'target/reports', native ? 'independent-native' : 'features-e2e');
mkdirSync(output, { recursive: true });
const report = { artifact, native, passed: false, checks: [] },
  record = (name) => {
    report.checks.push(name);
    console.log(`PASS ${name}`);
  };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label) {
  for (let i = 0; i < 150; i++) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw Error(label);
}
let botListCalls = 0;
let botCatalog = {
  version: 1,
  account: 'fixture',
  revision: 'r1',
  stale: false,
  bots: ['X 资讯', '随口一问', '通用', '环境运维'].map((name, i) => ({
    id: `bot-${i}`,
    name,
    available: true,
    avatar: { shape: 'cloud', color: 'violet' },
    preview: '合成资料摘要',
    description: `合成简介：${name}`,
  })),
};
const fixture = createServer((req, res) => {
  if (req.url === '/v1/tools/grokbot__list') {
    botListCalls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ isError: false, result: { catalog: botCatalog } }));
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(readFileSync(join(root, 'tests/host-fixture.html')));
});
let chrome, browser, service, runtime;
try {
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  const reserve = createServer();
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const debugPort = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  chrome = await chromium.launchServer({
    executablePath: process.env.PALBOO_CHROME_BIN || undefined,
    headless: true,
    args: [`--remote-debugging-port=${debugPort}`],
  });
  browser = await chromium.connect(chrome.wsEndpoint());
  report.browser = browser.version();
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${fixture.address().port}/fixture`);
  await page.evaluate(() => {
    const workspace = document.querySelector('.workspace');
    workspace.classList.add('app-shell-main-content-frame');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:row;height:100%;min-width:0';
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;height:100%';
    content.append(...workspace.childNodes);
    content.append(content.querySelector('.composer'));
    row.append(content);
    workspace.append(row);
  });
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  await cdp.detach();
  writeFileSync(
    join(directory, 'config.json'),
    JSON.stringify({
      cdpEndpoint: `http://127.0.0.1:${debugPort}`,
      targetId: targetInfo.targetId,
      stepwise: { enabled: false, answerOutlineEnabled: true, generationMode: 'manual' },
    }),
  );
  const env = { ...process.env };
  writeFileSync(join(directory, 'model-control.json'), JSON.stringify({ enabled: true }));
  writeFileSync(
    join(directory, 'panel.json'),
    JSON.stringify({ ui: { layoutMode: 'workbench', dockOpen: true } }),
  );
  for (const key of Object.keys(env))
    if (/^(PALBOO_|CODEX_BUDDY_|COMPANION_)/.test(key)) delete env[key];
  env.PALBOO_PANEL_TEST = '1';
  env.PALBOO_TEST_GROKBOT_CACHE = directory;
  env.PALBOO_TEST_GROKBOT_URL = `http://127.0.0.1:${fixture.address().port}`;
  service = spawn(
    artifact.binary,
    ['--data-dir', directory, 'serve', '--port', '0', '--allow-fixture'],
    { env, stdio: 'ignore' },
  );
  runtime = await wait(() => {
    try {
      return JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8'));
    } catch {
      return null;
    }
  }, 'service startup');
  const base = `http://127.0.0.1:${runtime.port}`;
  async function api(path, data) {
    const response = await fetch(`${base}/api/${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.message || JSON.stringify(value));
    return value;
  }
  const state = () => api('features', { op: 'state' }),
    entry = async (id) => (await state()).features.find((e) => e.id === id);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.runtimeActive);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.outlineItems.length > 0);
  await page.waitForFunction(() => window.__companionFloatingPanel?.state.dockStatus === 'open');
  assert.equal((await state()).mainManaged, false);
  assert.equal((await entry('model')).placement, 'edge');
  assert.equal(await page.locator('[data-palboo-dock]').count(), 1);
  assert.ok(await page.locator('.csw-panel').isVisible());
  record('restored model edge window preserves the legacy sidebar before main content migration');
  let tasks = await api('tasks/state');
  await api('tasks/command', {
    op: 'modules',
    revision: tasks.store.revision,
    boardEnabled: true,
    syncEnabled: false,
  });
  tasks = await api('tasks/state');
  await api('tasks/command', {
    op: 'create',
    revision: tasks.store.revision,
    fields: {
      title: '隔离验收任务',
      notes: '保留原内容',
      due: null,
      priority: 0,
      column: 'todo',
      completed: false,
    },
  });
  await api('features', { op: 'move', id: 'outline', placement: 'sidebar' });
  await wait(async () => {
    const e = await entry('outline');
    return e?.open && !e.pending;
  }, 'outline ready');
  await api('features', { op: 'move', id: 'board', placement: 'overlay' });
  await wait(async () => {
    const e = await entry('board');
    return e?.open && !e.pending;
  }, 'board ready');
  const board = page.locator('[data-feature="board"]');
  await page.locator('.csw-feature-panes [data-pane-tab="board"]').click();
  await board.getByRole('button', { name: '新建任务', exact: true }).first().click();
  await board.getByLabel('新任务标题', { exact: true }).fill('仍未保存的草稿');

  const before = await api('tasks/state');
  const original = await entry('board');
  const destination = native ? 'desktop' : 'sidebar';
  await api('features', { op: 'move', id: 'board', placement: destination });
  const moved = await wait(async () => {
    const e = await entry('board');
    return e.placement === destination && !e.pending && e;
  }, 'destination automatically ready');
  assert.notEqual(moved.owner, original.owner);
  assert.ok(
    (await state()).features
      .filter((e) => e.placement !== 'edge')
      .every((e) => e.placement === destination),
  );
  assert.equal(moved.view.board.quickAdd.title, '仍未保存的草稿');
  assert.deepEqual((await api('tasks/state')).store, before.store);
  record('external placement waits for source draft and commits a new owner without task writes');
  await assert.rejects(() =>
    api('features', {
      op: 'action',
      id: 'board',
      owner: original.owner,
      data: { op: 'archive', id: before.store.tasks[0].id, archived: true },
    }),
  );
  record('late source writes are rejected');
  if (native) {
    const lease = await api('features', { op: 'window', id: 'board', owner: moved.owner });
    assert.ok(lease.pid);
    const outlineLease = await api('features', {
      op: 'window',
      id: 'outline',
      owner: (await entry('outline')).owner,
    });
    assert.equal(outlineLease.pid, lease.pid, 'all main features share one native process');
    const helper = join(directory, 'native-probe');
    execFileSync('swiftc', ['tests/native-probe.swift', '-o', helper], { cwd: root });
    const windows = await wait(() => {
      const rows = JSON.parse(
        execFileSync(helper, ['windows', String(lease.pid)], { encoding: 'utf8' }),
      );
      return rows.some((w) => w.kCGWindowBounds.Width >= 320) && rows;
    }, 'native feature window visible');
    assert.equal(
      windows.filter((w) => w.kCGWindowBounds.Width >= 320).length,
      1,
      'only one visible main window',
    );
    report.windows = windows;
    assert.ok(windows.some((w) => w.kCGWindowBounds.Width >= 320));
    record('actual Wry window loaded the feature page and completed readiness');
    const revealed = await api('features', { op: 'reveal', id: 'board' });
    assert.equal(revealed.features.find((e) => e.id === 'board').owner, moved.owner);
    assert.equal(
      (await api('features', { op: 'window', id: 'board', owner: moved.owner })).pid,
      lease.pid,
    );
    record('reveal reuses the native process');
  }
  await api('features', { op: 'move', id: 'board', placement: 'overlay' });
  await wait(async () => {
    const e = await entry('board');
    return e.placement === 'overlay' && !e.pending;
  }, 'return to host');
  if (native)
    assert.equal(
      (await state()).mainWindow.pid,
      null,
      'return retires the desktop lease before another move',
    );

  assert.equal(
    await board.getByLabel('新任务标题', { exact: true }).inputValue(),
    '仍未保存的草稿',
  );

  record('round trip restores the original unsaved task snapshot and draft');
  if (native) {
    const helper = join(directory, 'native-probe');
    for (const id of ['outline', 'next', 'model']) {
      if (id === 'model') {
        const model = await api('model-control/state');
        await api('model-control/preferences', {
          revision: model.revision,
          patch: { enabled: true },
        });
      }
      await api('features', { op: 'move', id, placement: 'desktop' });
      const feature = await wait(async () => {
        const e = await entry(id);
        return e?.placement === 'desktop' && !e.pending && e;
      }, `${id} native ready`);
      const lease = await api('features', { op: 'window', id, owner: feature.owner });
      await wait(
        () =>
          JSON.parse(
            execFileSync(helper, ['windows', String(lease.pid)], { encoding: 'utf8' }),
          ).some((w) => w.kCGWindowBounds.Width >= 320),
        `${id} native visible`,
      );
      await api('features', { op: 'move', id, placement: 'sidebar' });
      await wait(async () => {
        const e = await entry(id);
        return e.placement === 'sidebar' && !e.pending;
      }, `${id} returned`);
      assert.equal(
        (await state()).mainWindow.pid,
        null,
        'no departing desktop process can be reused',
      );
      record(`${id} native view automatically readies and returns to sidebar`);
    }
  }
  if (native) {
    for (const id of ['board', 'outline', 'next', 'model']) {
      await api('features', { op: 'move', id, placement: 'edge' });
      await wait(async () => {
        const e = await entry(id);
        return e?.placement === 'edge' && !e.pending;
      }, `${id} edge ready`);
    }
    assert.equal((await entry('board')).view.board.quickAdd.title, '仍未保存的草稿');
    await api('model-control/close', {});
    assert.equal((await entry('model')).open, false);
    const boardOwner = (await entry('board')).owner;
    assert.equal((await entry('board')).open, true);
    assert.equal(
      (await api('features', { op: 'read', id: 'board', owner: boardOwner })).store.tasks.length,
      1,
    );
    await api('features', { op: 'move', id: 'board', placement: 'overlay' });
    await wait(async () => {
      const e = await entry('board');
      return e.placement === 'overlay' && !e.pending;
    }, 'board returns from edge');

    assert.equal(
      await board.getByLabel('新任务标题', { exact: true }).inputValue(),
      '仍未保存的草稿',
    );

    await assert.rejects(() =>
      api('features', { op: 'save', id: 'board', owner: boardOwner, view: {} }),
    );
    assert.deepEqual((await api('tasks/state')).store, before.store);
    record(
      'all four features share edge, disabling model preserves board, edge round trip retains draft and rejects stale owner',
    );
  }
  // Both legacy bridge and shared feature editor save only quick prompts.
  let quickSettings = await api('settings');
  const legacySaved = await page.evaluate(
    (settings) =>
      window.__companionDesktopRequest('/settings/set', {
        quickPrompts: [
          { label: '继续', prompt: '继续' },
          { label: '执行', prompt: '执行' },
        ],
        expectedRevision: settings.configurationRevision,
      }),
    quickSettings,
  );
  assert.equal(legacySaved.settings.quickPrompts.length, 2);
  assert.equal(legacySaved.settings.generationRevision, quickSettings.generationRevision);
  const staleQuick = await page.evaluate(
    (settings) =>
      window.__companionDesktopRequest('/settings/set', {
        quickPrompts: [],
        expectedRevision: settings.configurationRevision,
      }),
    quickSettings,
  );
  assert.ok(staleQuick.error);
  quickSettings = await api('settings', { enabled: true, generationMode: 'manual' });
  await wait(async () => {
    const e = await entry('next');
    return e.open && !e.pending;
  }, 'next enabled before moving');
  await api('features', { op: 'move', id: 'next', placement: 'sidebar' });
  await wait(async () => {
    const e = await entry('next');
    return e.open && !e.pending && e.placement === 'sidebar';
  }, 'next editor ready');
  await page.locator('.csw-feature-panes [data-pane-tab="next"]').click();
  const nextView = page.locator('[data-feature="next"]');
  await nextView.getByRole('button', { name: '添加快捷指令', exact: true }).click();
  await nextView.getByLabel('快捷指令名称', { exact: true }).fill('检查');
  await nextView.getByLabel('快捷指令内容', { exact: true }).fill('检查当前方案');
  await nextView.getByRole('button', { name: '保存', exact: true }).click();
  await nextView.getByRole('button', { name: '检查', exact: true }).waitFor();
  const quickSaved = await api('settings');
  assert.equal(quickSaved.quickPrompts[2].prompt, '检查当前方案');
  assert.equal(quickSaved.generationRevision, quickSettings.generationRevision);
  assert.equal(
    JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).stepwise.quickPrompts[2].label,
    '检查',
  );
  record(
    'quick prompt editor and legacy bridge persist guarded changes without invalidating suggestions',
  );
  const botSettings = await api('settings');
  assert.equal(botSettings.grokbotEnabled, false);
  const botEnabled = await api('settings', {
    grokbotEnabled: true,
    expectedRevision: botSettings.configurationRevision,
  });
  assert.equal(botEnabled.generationRevision, botSettings.generationRevision);
  await wait(async () => {
    const e = await entry('bots');
    return e?.open && !e.pending;
  }, 'Bot feature ready');
  const botEntry = await entry('bots');
  const botRead = () => api('features', { op: 'read', id: 'bots', owner: botEntry.owner });
  const botView = await botRead();
  assert.equal(botView.snapshot.target.threadId, 'fixture-thread-a');
  assert.deepEqual(
    botView.snapshot.bots.map((b) => b.name),
    ['X 资讯', '随口一问', '通用', '环境运维'],
  );
  const composer = page.getByRole('textbox', { name: '测试草稿' });
  await composer.fill('保留我的原草稿');
  const sends = await page.evaluate(() => window.submitCount);
  await api('features', {
    op: 'action',
    id: 'bots',
    owner: botEntry.owner,
    data: {
      ...botView.snapshot.target,
      botId: 'bot-2',
      revision: 'r1',
      agent: '通用',
      action: 'ask',
    },
  });
  assert.match(await composer.innerText(), /^保留我的原草稿\n请问「通用」：$/);
  assert.equal(await page.evaluate(() => window.submitCount), sends);
  await assert.rejects(
    api('features', {
      op: 'action',
      id: 'bots',
      owner: 'stale-owner',
      data: {
        ...botView.snapshot.target,
        botId: 'bot-2',
        revision: 'r1',
        agent: '通用',
        action: 'ask',
      },
    }),
  );
  await assert.rejects(
    api('features', {
      op: 'action',
      id: 'bots',
      owner: botEntry.owner,
      data: { ...botView.snapshot.target, token: 'stale-composer', agent: '通用', action: 'ask' },
    }),
  );
  const reportBotFinished = (id = 'synthetic-bot-call') =>
    page.evaluate((id) => {
      const item = {
        type: 'mcpToolCall',
        id,
        server: 'grokbot',
        tool: 'call_tool',
        arguments: { toolName: 'grokbot__ask', input: { agent: '通用' } },
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                toolName: 'grokbot__ask',
                result: {
                  agent: '通用',
                  status: 'finished',
                  reply: 'DO_NOT_PROJECT',
                  earlierReplies: ['DO_NOT_PROJECT'],
                },
              }),
            },
          ],
        },
      };
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'mcp-notification',
            hostId: 'local',
            method: 'item/started',
            params: {
              threadId: 'fixture-thread-a',
              turnId: 'synthetic-bot-turn',
              item: { ...item, result: undefined },
            },
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            type: 'mcp-notification',
            hostId: 'local',
            method: 'item/completed',
            params: { threadId: 'fixture-thread-a', turnId: 'synthetic-bot-turn', item },
          },
        }),
      );
    }, id);
  await reportBotFinished();
  const returned = await botRead();
  assert.equal(returned.snapshot.bots[2].current.status, 'finished');
  assert.doesNotMatch(JSON.stringify(returned), /DO_NOT_PROJECT/);
  await page.locator('.csw-feature-panes [data-pane-tab="bots"]').click();
  await page.getByRole('button', { name: '通用', exact: true }).waitFor();
  await page.getByText('已回复', { exact: true }).waitFor();
  assert.equal(
    await page.locator('[data-feature="bots"] textarea,[data-feature="bots"] input').count(),
    0,
  );
  const botGeometry = await page.locator('[data-feature="bots"] .palboo-bot').evaluateAll((rows) =>
    rows.map((row) => {
      const label = row.querySelector('.palboo-bot-select > span:last-child');
      const status = row.querySelector('.palboo-bot-status');
      const action = row.querySelector('.palboo-bot-actions button');
      return {
        label: label.getBoundingClientRect().left,
        status: status
          ? status.getBoundingClientRect().left + parseFloat(getComputedStyle(status).paddingLeft)
          : null,
        action: action?.getBoundingClientRect().left,
      };
    }),
  );
  assert.ok(botGeometry.every((row) => Math.abs(row.label - botGeometry[0].label) < 1));
  assert.equal(botGeometry.filter((row) => row.status !== null).length, 1);
  assert.ok(Math.abs(botGeometry[2].label - botGeometry[2].status) < 1);
  assert.ok(Math.abs(botGeometry[2].label - botGeometry[2].action) < 1);
  await page.locator('[data-feature="bots"]').screenshot({ path: join(output, 'palboo-bots.png') });
  assert.equal(await page.locator('[data-feature="bots"] details').count(), 0);
  assert.equal(await page.locator('[data-refresh="bots"]').count(), 0);
  assert.equal(
    await page
      .locator('.palboo-bot-preview')
      .first()
      .evaluate((el) => getComputedStyle(el).webkitLineClamp),
    '1',
  );
  const quietCalls = botListCalls;
  await delay(6500);
  assert.equal(botListCalls, quietCalls, 'unchanged roster does not poll BDK every five seconds');
  botCatalog = {
    ...botCatalog,
    revision: 'r2',
    bots: [
      ...botCatalog.bots,
      {
        id: 'bot-4',
        name: '新测试 Bot',
        available: true,
        avatar: { shape: 'sparkle', color: 'green' },
        preview: '更新后的合成摘要',
      },
    ],
  };
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.roster.last-roster')),
    'changed',
  );
  await page.getByRole('button', { name: '新测试 Bot', exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '新测试 Bot', exact: true }).click();
  await wait(
    async () => (await composer.innerText()).includes('请问「新测试 Bot」：'),
    'dynamic Bot selection',
  );
  assert.equal(await page.evaluate(() => window.submitCount), sends);
  assert.equal((await botRead()).snapshot.bots[2].current.status, 'finished');
  await assert.rejects(
    api('features', {
      op: 'action',
      id: 'bots',
      owner: botEntry.owner,
      data: {
        ...botView.snapshot.target,
        botId: 'bot-2',
        revision: 'r1',
        agent: '通用',
        action: 'ask',
      },
    }),
  );
  record(
    'dynamic Bot addition appears without restart, preserves call status and rejects stale catalog actions',
  );
  const beforeManual = await api('settings');
  const manual = await api('settings', {
    grokbotAutoSync: false,
    expectedRevision: beforeManual.configurationRevision,
  });
  assert.equal(manual.generationRevision, beforeManual.generationRevision);
  assert.equal(
    JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).stepwise.grokbotAutoSync,
    false,
  );
  await page.getByRole('button', { name: '刷新 Bot 资料', exact: true }).waitFor();
  const manualCalls = botListCalls;
  botCatalog = {
    ...botCatalog,
    revision: 'r3',
    bots: [
      ...botCatalog.bots,
      {
        id: 'manual-bot',
        name: '手动新增 Bot',
        available: true,
        description: '仅在设置展示的简介',
      },
    ],
  };
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.roster.last-roster')),
    'manual change',
  );
  await delay(6500);
  assert.equal(botListCalls, manualCalls, 'manual mode ignores file changes and background reads');
  assert.equal(await page.getByRole('button', { name: '手动新增 Bot', exact: true }).count(), 0);
  await page.getByRole('button', { name: '刷新 Bot 资料', exact: true }).click();
  await page.getByRole('button', { name: '手动新增 Bot', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.submitCount), sends);
  const settingsPage = await context.newPage();
  await settingsPage.goto(`${base}/#token=${runtime.token}`);
  await settingsPage.evaluate(() => {
    location.hash = 'settings-bots';
  });
  await settingsPage.getByRole('switch', { name: '自动同步 Bot 资料', exact: true }).waitFor();
  assert.equal(
    await settingsPage.getByText('仅在设置展示的简介', { exact: true }).isVisible(),
    false,
  );
  assert.equal(
    await settingsPage.getByRole('complementary', { name: '联动预览' }).isVisible(),
    true,
  );
  await settingsPage.getByRole('button', { name: '手动新增 Bot', exact: true }).click();
  await settingsPage.getByText('仅在设置展示的简介', { exact: true }).waitFor();
  await settingsPage.keyboard.press('Escape');
  assert.equal(
    await settingsPage
      .getByRole('button', { name: '手动新增 Bot', exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  assert.equal(await page.getByText('仅在设置展示的简介', { exact: true }).count(), 0);
  const setupRow = await settingsPage.evaluate(() => {
    const setup = document.querySelector('.bot-settings-setup button').getBoundingClientRect();
    const toggle = document
      .querySelector('#settings-grokbot [role="switch"]')
      .getBoundingClientRect();
    return {
      delta: Math.abs(setup.top + setup.height / 2 - toggle.top - toggle.height / 2),
      ahead: setup.right < toggle.left,
    };
  });
  assert.ok(setupRow.delta < 1 && setupRow.ahead, 'setup entry sits beside the enable switch');
  const callsBeforeSettingsRefresh = botListCalls;
  await settingsPage.getByRole('button', { name: '刷新 Bot 资料', exact: true }).click();
  await settingsPage.locator('.bot-settings-heading [data-action-state="success"]').waitFor();
  assert.equal(botListCalls, callsBeforeSettingsRefresh + 1);
  const geometry = await settingsPage.evaluate(() => {
    const heading = document.querySelector('.bot-settings-heading h2').getBoundingClientRect();
    const refresh = document.querySelector('.bot-settings-heading button').getBoundingClientRect();
    const entries = [
      ...document.querySelectorAll('.bot-settings-profiles .settings-drawer-trigger'),
    ].map((el) => el.getBoundingClientRect());
    return {
      aligned: entries.every((rect) => Math.abs(rect.left - heading.left) < 1 && rect.height >= 48),
      centers: Math.abs(heading.top + heading.height / 2 - refresh.top - refresh.height / 2),
    };
  });
  assert.equal(geometry.aligned, true);
  assert.ok(geometry.centers < 1, 'refresh is centered on its heading');
  await settingsPage.screenshot({ path: join(output, 'palboo-bot-settings-manual.png') });
  await settingsPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await settingsPage.getByRole('button', { name: '手动新增 Bot', exact: true }).click();
  await settingsPage.getByText('仅在设置展示的简介', { exact: true }).waitFor();
  await settingsPage.keyboard.press('Escape');
  await settingsPage.screenshot({ path: join(output, 'palboo-bot-settings-narrow.png') });
  await settingsPage.setViewportSize({ width: 1440, height: 960 });
  await settingsPage.getByRole('button', { name: '接入 Grok Bot', exact: true }).click();
  const prompt = await settingsPage
    .getByRole('textbox', { name: 'Grok Bot 接入 Prompt' })
    .inputValue();
  assert.match(prompt, /当前官方文档|当前官方/);
  assert.match(prompt, /不新建 Bot/);
  assert.doesNotMatch(prompt, /Users\/Totoro|grokbot setup|0\.2\.27/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await settingsPage.getByRole('button', { name: '复制接入 Prompt', exact: true }).click();
  await settingsPage.getByText('已复制', { exact: true }).waitFor();
  assert.equal(await settingsPage.evaluate(() => navigator.clipboard.readText()), prompt);
  await settingsPage.getByRole('button', { name: '关闭接入 Grok Bot', exact: true }).click();
  await settingsPage.getByRole('switch', { name: '自动同步 Bot 资料', exact: true }).click();
  await wait(
    async () => (await api('settings')).grokbotAutoSync === true,
    'auto sync saved from settings',
  );
  await wait(
    async () => !(await page.locator('[data-refresh="bots"]').count()),
    'automatic mode hides manual refresh',
  );
  await settingsPage.screenshot({ path: join(output, 'palboo-bot-settings.png') });
  const goodCatalog = botCatalog;
  botCatalog = { ...goodCatalog, stale: true };
  const cachedCatalog = await api('features', { op: 'bots-catalog', refresh: true });
  assert.equal(cachedCatalog.stale, true);
  assert.equal(cachedCatalog.bots.length, goodCatalog.bots.length);
  assert.equal(cachedCatalog.error, undefined);
  await settingsPage.getByText('请打开 Grok Bot 更新资料。', { exact: true }).waitFor();
  botCatalog = { version: 1, bots: [{ name: '无身份 Bot', available: true }] };
  await api('features', { op: 'bots-catalog', refresh: true });
  await settingsPage.getByText('Grok Bot 同步失败，请重试。', { exact: true }).waitFor();
  assert.equal((await botRead()).snapshot.catalog.stale, true);
  botCatalog = {
    ...goodCatalog,
    revision: 'r4',
    bots: [
      ...goodCatalog.bots,
      { id: 'settings-live', name: '自动同步新增', available: true, description: '实时更新的资料' },
    ],
  };
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.roster.last-roster')),
    'settings change',
  );
  await settingsPage
    .getByRole('button', { name: '自动同步新增', exact: true })
    .waitFor({ timeout: 15000 });
  await settingsPage.getByRole('button', { name: '自动同步新增', exact: true }).click();
  await settingsPage.getByText('实时更新的资料', { exact: true }).waitFor();
  await settingsPage.keyboard.press('Escape');
  record(
    'visible automatic settings recover from invalid identities and update file-driven catalog changes',
  );
  // The invalid-identity recovery retired the old item; seed a genuinely new call.
  await reportBotFinished('saved-sidebar-call');
  assert.equal(
    (await botRead()).snapshot.bots.find((b) => b.id === 'bot-2').current.status,
    'finished',
  );
  // The independent adapter supplies order; Rust validates it and both views use it.
  botCatalog.bots.find((b) => b.id === 'bot-3').hidden = true;
  const unassigned = botCatalog.bots
    .filter((b) => !b.hidden && !['bot-2', 'bot-0'].includes(b.id))
    .map((b) => b.id);
  botCatalog.sidebar = {
    version: 1,
    groups: [
      { id: 'pins', kind: 'pinned', name: '置顶', botIds: ['bot-2'] },
      { id: 'work', kind: 'section', name: '工作分组', botIds: ['bot-0'] },
      { id: 'rest', kind: 'unassigned', name: '未分组', botIds: unassigned },
    ],
  };
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.sidebar.last-sections')),
    'sections changed',
  );
  await settingsPage.getByRole('heading', { name: '工作分组', exact: true }).waitFor();
  await page.getByRole('heading', { name: '工作分组', exact: true }).waitFor();
  await page
    .locator('[data-feature="bots"]')
    .screenshot({ path: join(output, 'bot-saved-groups.png') });
  await settingsPage.screenshot({ path: join(output, 'bot-saved-groups-settings.png') });
  const sidebarViewport = settingsPage.viewportSize();
  await settingsPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await settingsPage.screenshot({
    path: join(output, 'bot-saved-groups-settings-narrow.png'),
    fullPage: true,
  });
  await settingsPage.setViewportSize(sidebarViewport);
  assert.equal(await page.getByRole('button', { name: '环境运维', exact: true }).count(), 0);
  assert.equal(
    await settingsPage.getByRole('button', { name: '环境运维', exact: true }).count(),
    0,
  );
  assert.equal(
    (await botRead()).snapshot.bots.find((b) => b.id === 'bot-2').current.status,
    'finished',
  );
  assert.deepEqual(await page.locator('.palboo-bot-select').allTextContents(), [
    '通用合成资料摘要',
    'X 资讯合成资料摘要',
    '随口一问合成资料摘要',
    '新测试 Bot更新后的合成摘要',
    '手动新增 Bot',
    '自动同步新增',
  ]);
  botCatalog.sidebar.groups[0].botIds = ['bot-0', 'bot-2'];
  botCatalog.sidebar.groups[1].botIds = [];
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.ui-agent-refs')),
    'pins changed',
  );
  await wait(
    async () =>
      (await page.locator('.palboo-bot-select').first().getAttribute('aria-label')) === 'X 资讯',
    'saved pin order event',
  );
  await settingsPage.getByRole('switch', { name: '自动同步 Bot 资料', exact: true }).click();
  await wait(async () => (await api('settings')).grokbotAutoSync === false, 'manual sidebar sync');
  const beforeSidebarRefresh = botListCalls;
  botCatalog.sidebar.groups[0].botIds.reverse();
  writeFileSync(
    join(directory, cacheFile('sand.client.slice.account.fixture.ui-agent-refs')),
    'manual pins changed',
  );
  await delay(6500);
  assert.equal(botListCalls, beforeSidebarRefresh, 'manual sidebar changes do not read BDK');
  assert.equal(
    await page.locator('.palboo-bot-select').first().getAttribute('aria-label'),
    'X 资讯',
  );
  await settingsPage.getByRole('button', { name: '刷新 Bot 资料', exact: true }).click();
  await wait(
    async () =>
      (await page.locator('.palboo-bot-select').first().getAttribute('aria-label')) === '通用',
    'explicit sidebar refresh',
  );
  await settingsPage.getByRole('switch', { name: '自动同步 Bot 资料', exact: true }).click();
  await wait(async () => (await api('settings')).grokbotAutoSync === true, 'restore auto sync');
  record(
    'saved sections, pins and hidden items update in both views; manual mode waits for explicit refresh and call status survives',
  );
  await settingsPage.close();
  record(
    'manual sync ignores file events until refresh; descriptions and Agent setup prompt live in settings; automatic sync can resume',
  );
  await api('settings', { grokbotEnabled: false });
  await page.waitForFunction(() => !window.__palbooBots);
  await assert.rejects(botRead());
  await wait(async () => {
    const bot = await entry('bots');
    return !bot.open && !bot.closing && !bot.pending;
  }, 'disabled Bot finishes its view close handshake');
  record(
    'Palboo Bot owner/composer guards, main-chat-only input, scoped MCP result and disable cleanup',
  );
  const recoverySettings = await api('settings');
  const enabledViews = {
    outline: recoverySettings.answerOutlineEnabled,
    next: recoverySettings.enabled,
    board: recoverySettings.taskBoardEnabled,
    model: recoverySettings.modelControlEnabled,
    terms: recoverySettings.terminologyEnabled,
    bots: recoverySettings.grokbotEnabled,
  };
  const recoveryTasks = (await api('tasks/state')).store;
  const recoveryFeatures = (await state()).features;
  const edgeBeforeReopen = recoveryFeatures.filter((e) => e.placement === 'edge');
  const expectedReopened = recoveryFeatures
    .filter((e) => e.placement !== 'edge' && enabledViews[e.id])
    .map((e) => e.id)
    .sort();
  assert.ok(expectedReopened.length > 1);
  // Closed desktop views retain their placement after a window exits. Exercise
  // that saved state only where desktop is supported, without opening a window.
  const recoveryPlacements = ['overlay', 'sidebar'];
  if (recoverySettings.popoutSupported) recoveryPlacements.push('desktop');
  for (const placement of recoveryPlacements) {
    for (const e of (await state()).features.filter((e) => e.open && e.placement !== 'edge'))
      await api('features', { op: 'close', id: e.id, owner: e.owner, view: e.view });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-palboo-features-root]').length === 0,
    );
    await api('features', { op: 'main-placement', placement });
    await page.waitForFunction(
      (placement) =>
        window.__companionFloatingPanel.state.layoutMode ===
        (placement === 'sidebar' ? 'workbench' : 'capsule'),
      placement,
    );
    await page.locator('[data-palboo-launcher] .csw-launcher-face').click();
    await wait(async () => {
      const f = await state();
      return expectedReopened.every((id) =>
        f.features.some((e) => e.id === id && e.open && !e.pending),
      );
    }, `launcher reopens closed ${placement} views`);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-palboo-features-root]')].some(
        (e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0,
      ),
    );
    const recovered = await state();
    assert.equal(recovered.mainPlacement, placement === 'desktop' ? 'sidebar' : placement);
    assert.deepEqual(
      recovered.features
        .filter((e) => e.placement !== 'edge' && e.open)
        .map((e) => e.id)
        .sort(),
      expectedReopened,
    );
    assert.deepEqual(
      recovered.features.filter((e) => e.placement === 'edge'),
      edgeBeforeReopen,
    );
    assert.equal(recovered.features.find((e) => e.id === 'bots').open, false);
  }
  assert.deepEqual((await api('tasks/state')).store, recoveryTasks);
  record(
    `launcher reopens closed ${recoveryPlacements.join(', ')} views; disabled tools, edge owners and tasks are retained`,
  );
  if (!recoverySettings.popoutSupported) {
    const before = await state();
    await assert.rejects(
      () => api('features', { op: 'main-placement', placement: 'desktop' }),
      /当前系统不支持桌面窗口/,
    );
    const after = await state();
    assert.equal(after.mainPlacement, before.mainPlacement);
    assert.deepEqual(after.mainWindow, before.mainWindow);
    const owners = (snapshot) =>
      snapshot.features.map(({ id, owner, placement, open }) => ({ id, owner, placement, open }));
    assert.deepEqual(owners(after), owners(before));
    record('unsupported desktop placement is rejected without changing restored sidebar views');
  }
  await page.screenshot({ path: join(output, 'independent-surfaces.png') });
  await api('disconnect', {});
  const current = await entry('board');
  const read = await api('features', { op: 'read', id: 'board', owner: current.owner });
  assert.equal(read.store.tasks.length, 1);
  const task = read.store.tasks[0];
  await api('features', {
    op: 'action',
    id: 'board',
    owner: current.owner,
    data: {
      op: 'update',
      revision: read.store.revision,
      id: task.id,
      expectedTask: task,
      fields: { ...task.fields, column: 'doing' },
    },
  });
  assert.equal((await api('tasks/state')).store.tasks[0].fields.column, 'doing');
  assert.equal((await api('tasks/state')).store.syncEnabled, false);
  record('board editing remains available without chat and keeps Apple sync paused');
  assert.deepEqual(errors, []);
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (service) {
    service.kill('SIGTERM');
    await delay(1000);
    if (service.exitCode === null) service.kill('SIGKILL');
  }
  await browser?.close();
  await chrome?.close();
  fixture.closeAllConnections();
  await new Promise((r) => fixture.close(r));
  rmSync(directory, { recursive: true, force: true });
}
