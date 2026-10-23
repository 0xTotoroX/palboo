/* [INPUT]: Synthetic MCP notifications and an isolated Chromium composer.
 * [OUTPUT]: Chat/call isolation, bounded metadata, no reply consumption, guarded draft append and cleanup.
 * [POS]: Offline acceptance; no real Bot calls or user messages.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createBotTracker } from '../ui/codex/bots-state.js';

const BOT_NAMES = ['X 资讯', '随口一问', '通用', '环境运维'];
const catalog = {
  version: 1,
  account: 'fixture',
  revision: 'r1',
  stale: false,
  bots: BOT_NAMES.map((name, i) => ({ id: `bot-${i}`, name, available: true })),
};
function tracker() {
  const t = createBotTracker();
  t.setCatalog(catalog.bots);
  return t;
}
function event(threadId = 'a', itemId = 'call-a', status) {
  return {
    threadId,
    turnId: 'turn-a',
    item: {
      id: itemId,
      type: 'mcpToolCall',
      server: 'grokbot',
      tool: 'call_tool',
      arguments: { toolName: 'grokbot__ask', input: { agent: '通用', message: 'PRIVATE_PROMPT' } },
      result: status
        ? {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  toolName: 'grokbot__ask',
                  result: {
                    agent: '通用',
                    status,
                    sessionId: 'remote',
                    reply: 'PRIVATE_REPLY',
                    earlierReplies: ['UNRELATED_REPLY'],
                  },
                }),
              },
            ],
          }
        : undefined,
    },
  };
}
test('Bot status is isolated by host/thread/turn/item and never stores message bodies', () => {
  const t = tracker();
  t.receive('remote', 'item/started', event());
  assert.equal(t.snapshot('a')[2].current, null);
  t.receive('local', 'item/started', event());
  assert.equal(t.snapshot('b')[2].current, null);
  assert.equal(t.snapshot('b')[2].occupied, true);
  t.receive('local', 'item/started', event('b', 'call-b'));
  t.receive('local', 'item/completed', event('b', 'call-b', 'busy'));
  assert.equal(t.snapshot('a')[2].current.status, 'calling');
  t.receive('local', 'item/completed', event('a', 'call-a', 'finished'));
  t.receive('local', 'item/started', event());
  assert.equal(t.snapshot('a')[2].current.status, 'finished');
  assert.equal(t.snapshot('b')[2].occupied, false);
  assert.doesNotMatch(JSON.stringify(t.snapshot('a')), /PRIVATE|UNRELATED/);
  assert.deepEqual(
    t.snapshot('a').map((b) => b.name),
    BOT_NAMES,
  );
});
test('unknown errors, disconnect and duplicate completions cannot invent success', () => {
  const t = tracker();
  t.receive('local', 'item/started', event('a', 'lost'));
  t.receive('local', 'turn/completed', { threadId: 'a', turnId: 'turn-a' });
  assert.equal(t.snapshot('a')[2].current.status, 'unknown');
  t.receive('local', 'item/started', event('a', 'bad'));
  t.receive('local', 'item/completed', event('a', 'bad'));
  assert.equal(t.snapshot('a')[2].current.status, 'unknown');
  t.receive('local', 'item/completed', event('a', 'bad', 'finished'));
  assert.equal(t.snapshot('a')[2].current.status, 'unknown');
  t.receive('local', 'item/started', event('a', 'running'));
  t.receive('local', 'item/completed', event('a', 'running', 'running'));
  t.disconnect();
  assert.equal(t.snapshot('a')[2].current.status, 'disconnected');
  const unexpected = event('a', 'created', 'finished');
  unexpected.item.result.content[0].text = JSON.stringify({
    toolName: 'grokbot__ask',
    result: { created: true },
  });
  t.receive('local', 'item/started', event('a', 'created'));
  t.receive('local', 'item/completed', unexpected);
  assert.equal(t.snapshot('a')[2].current.status, 'unexpected');
  for (let i = 0; i < 200; i++) t.receive('local', 'item/started', event(`thread${i}`, `call${i}`));
  assert.equal(t.snapshot('a')[2].current, null);
  t.clear();
  assert.ok(t.snapshot('thread199').every((b) => !b.current && !b.occupied));
});

test('Bot view uses the sole main composer, preserves drafts, rejects stale targets and cleans listeners', async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import {installBots} from './ui/codex/bots.js';
      import {BotsView} from './ui/features/bots/view';
      import {createRoot} from 'react-dom/client';
      window.session='a';window.enabled=true;window.submits=0;
      document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++});
      window.__palbooModelControl={inputTarget:()=>({id:window.session,scope:document.querySelector('main'),composer:document.querySelector('textarea')})};
      window.setup=()=>installBots({isEnabled:()=>window.enabled});
      window.api=window.setup();window.api.setCatalog(${JSON.stringify(catalog)});
      window.react=createRoot(document.querySelector('#view'));
      window.render=()=>window.react.render(<BotsView state={{snapshot:window.api.read()}} disabled={false} action={data=>{window.last=window.api.fill(data)}}/>);
      window.render();
    `,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:47990/', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<main><form><textarea>原草稿\n\n保留空行</textarea><button>发送</button></form></main><div id="view"></div>',
      }),
    );
    await page.goto('http://127.0.0.1:47990/');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.getByRole('button', { name: '通用', exact: true }).click();
    const draft = await page.locator('textarea').inputValue();
    assert.ok(
      draft.startsWith('原草稿\n\n保留空行\n'),
      JSON.stringify({ draft, last: await page.evaluate(() => window.last) }),
    );
    assert.equal(draft, '原草稿\n\n保留空行\n请问「通用」：');
    assert.equal(await page.locator('#view textarea,#view input').count(), 0);
    assert.equal(await page.evaluate(() => window.submits), 0);
    await page.getByRole('button', { name: '通用', exact: true }).click();
    assert.equal(await page.locator('textarea').inputValue(), draft);
    const stale = await page.evaluate(() => ({
      ...window.api.read().target,
      agent: '通用',
      botId: 'bot-2',
      revision: 'r1',
      action: 'ask',
    }));
    await page.evaluate(() => {
      window.session = 'b';
    });
    assert.equal(await page.evaluate((input) => window.api.fill(input).ok, stale), false);
    const b = await page.evaluate(() => ({
      ...window.api.read().target,
      agent: '通用',
      botId: 'bot-2',
      revision: 'r1',
      action: 'ask',
    }));
    await page.evaluate(() => {
      const old = document.querySelector('textarea');
      old.replaceWith(old.cloneNode(true));
    });
    assert.equal(await page.evaluate((input) => window.api.fill(input).ok, b), false);
    await page.evaluate(
      (params) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: { type: 'mcp-notification', hostId: 'local', method: 'item/started', params },
          }),
        ),
      event(),
    );
    await page.evaluate(() => window.render());
    await page.getByText('其他聊天正在调用').waitFor();
    assert.equal(await page.getByRole('button', { name: '通用', exact: true }).isDisabled(), true);
    await page.evaluate(() => {
      window.api.destroy();
      window.api = window.setup();
      window.api.setCatalog({
        version: 1,
        account: 'fixture',
        revision: 'r1',
        stale: false,
        bots: [
          { id: 'bot-0', name: 'X 资讯', available: true },
          { id: 'bot-1', name: '随口一问', available: true },
          { id: 'bot-2', name: '通用', available: true },
          { id: 'bot-3', name: '环境运维', available: true },
        ],
      });
    });
    assert.equal(await page.evaluate(() => window.api.read().bots[2].current), null);
    for (const missing of ['account', 'revision', 'stale', 'id']) {
      const invalid = structuredClone(catalog);
      if (missing === 'id') delete invalid.bots[2].id;
      else delete invalid[missing];
      const before = await page.locator('textarea').inputValue();
      const result = await page.evaluate((value) => {
        window.api.setCatalog(value);
        return window.api.fill({
          ...window.api.read().target,
          agent: '通用',
          botId: value.bots[2].id,
          revision: value.revision,
          action: 'ask',
        });
      }, invalid);
      assert.equal(result.ok, false, `missing ${missing} must block composer actions`);
      assert.equal(await page.locator('textarea').inputValue(), before);
    }
    const fresh = await page.evaluate(() => ({
      ...window.api.read().target,
      agent: 'X 资讯',
      action: 'ask',
    }));
    await page.evaluate(() => {
      window.enabled = false;
    });
    assert.equal(await page.evaluate((input) => window.api.fill(input).ok, fresh), false);
    assert.equal(await page.evaluate(() => window.submits), 0);
  } finally {
    await browser.close();
  }
});

test('catalog rename and deletion reject old identities while unrelated calls remain', () => {
  const t = tracker();
  t.receive('local', 'item/started', event('a', 'finished'));
  t.receive('local', 'item/completed', event('a', 'finished', 'finished'));
  t.setCatalog([...catalog.bots, { id: 'new-id', name: '新增 Bot', available: true }]);
  assert.equal(t.snapshot('a').find((b) => b.name === '通用').current.status, 'finished');
  t.setCatalog(catalog.bots.map((b) => (b.name === '通用' ? { ...b, name: '改名 Bot' } : b)));
  assert.equal(t.snapshot('a').find((b) => b.name === '改名 Bot').current, null);
  t.receive('local', 'item/completed', event('a', 'late-old-name', 'finished'));
  assert.ok(t.snapshot('a').every((b) => !b.current));
  t.setCatalog([]);
  assert.deepEqual(t.snapshot('a'), []);
});

test('late completions cannot claim a new account or replacement Bot with the same name', () => {
  for (const accountChanged of [false, true]) {
    const t = tracker();
    t.receive('local', 'item/started', event());
    if (accountChanged) t.clear();
    t.setCatalog(catalog.bots.map((b) => ({ ...b, id: `replacement-${b.id}` })));
    t.receive('local', 'item/started', event());
    t.receive('local', 'item/completed', event('a', 'call-a', 'running'));
    assert.equal(t.snapshot('a')[2].current, null);
    assert.equal(t.snapshot('b')[2].occupied, false);
  }
});

test('failed checks, stop requests and busy responses preserve the confirmed active task', () => {
  const t = tracker();
  t.receive('local', 'item/started', event());
  t.receive('local', 'item/completed', event('a', 'call-a', 'running'));
  const reply = (id, action, status, error = false, sessionId = 'remote') => {
    const params = event('a', id);
    params.item.arguments.toolName = action;
    t.receive('local', 'item/started', params);
    params.item.result = {
      isError: error,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            toolName: action,
            result: { agent: '通用', status, sessionId },
          }),
        },
      ],
    };
    t.receive('local', 'item/completed', params);
  };
  for (const [id, action, status, error] of [
    ['failed-check', 'grokbot__check', undefined, true],
    ['unknown-check', 'grokbot__check', undefined, false],
    ['failed-stop', 'grokbot__interrupt', undefined, true],
    ['busy-ask', 'grokbot__ask', 'busy', false],
  ]) {
    reply(id, action, status, error);
    assert.equal(t.snapshot('a')[2].current.status, 'running');
    assert.equal(t.snapshot('b')[2].occupied, true);
  }
  reply('wrong-session', 'grokbot__check', 'finished', false, 'other-session');
  assert.equal(t.snapshot('b')[2].occupied, true);
  reply('finished-check', 'grokbot__check', 'finished');
  assert.equal(t.snapshot('a')[2].current.status, 'finished');
  assert.equal(t.snapshot('b')[2].occupied, false);
});

test('nested turn completion clears an unconfirmed call without releasing a confirmed task', () => {
  const t = tracker();
  t.receive('local', 'item/started', event());
  t.receive('local', 'turn/completed', { threadId: 'a', turn: { id: 'turn-a' } });
  assert.equal(t.snapshot('a')[2].current.status, 'unknown');
  assert.equal(t.snapshot('b')[2].occupied, false);
  t.receive('local', 'item/completed', event('a', 'call-a', 'running'));
  t.receive('local', 'item/started', event('a', 'check'));
  t.receive('local', 'turn/completed', { threadId: 'a', turn: { id: 'turn-a' } });
  assert.equal(t.snapshot('a')[2].current.status, 'running');
  assert.equal(t.snapshot('b')[2].occupied, true);
});

test('saved sidebar groups reorder without losing calls, hide stale actions and keep the sole composer', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import {installBots} from './ui/codex/bots.js';
      import {BotsView} from './ui/features/bots/view';
      import {BotSettings} from './ui/settings/bot-settings';
      import {createRoot} from 'react-dom/client';
      window.__palbooModelControl={inputTarget:()=>({id:'a',scope:document.querySelector('main'),composer:document.querySelector('textarea')})};
      window.api=installBots();window.root=createRoot(document.querySelector('#view'));
      window.render=c=>{window.api.setCatalog(c);window.root.render(<BotsView state={{snapshot:window.api.read()}} disabled={false} action={d=>window.last=window.api.fill(d)}/>)};
      window.settings=createRoot(document.querySelector('#settings'));
      window.showSettings=()=>window.settings.render(<BotSettings active live editor={{form:{grokbotAutoSync:false},saved:{grokbotAutoSync:false,grokbotEnabled:true}}}/>);
    `,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
  });
  const { readFileSync, mkdirSync } = await import('node:fs');
  const browser = await chromium.launch({ headless: true });
  const value = structuredClone(catalog);
  value.bots[3].hidden = true;
  value.sidebar = {
    version: 1,
    groups: [
      { id: 'pins', kind: 'pinned', name: '置顶', botIds: ['bot-2'] },
      { id: 'work', kind: 'section', name: '工作', botIds: ['bot-1'] },
      { id: 'rest', kind: 'unassigned', name: '未分组', botIds: ['bot-0'] },
    ],
  };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
    await page.route('http://127.0.0.1:47990/**', (route) =>
      route.fulfill(
        route.request().url().includes('/api/')
          ? { json: value }
          : {
              contentType: 'text/html; charset=utf-8',
              body: '<main><textarea>保留草稿</textarea></main><div id="view"></div><div id="settings"></div>',
            },
      ),
    );
    await page.goto('http://127.0.0.1:47990/');
    await page.addStyleTag({ content: readFileSync('ui/features/bots/style.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate((v) => window.render(v), value);
    await page.getByRole('heading', { name: '工作', exact: true }).waitFor();
    assert.equal(
      await page
        .locator('.palboo-bots')
        .getByRole('heading', { name: '置顶', exact: true })
        .count(),
      0,
    );
    assert.deepEqual(await page.locator('.palboo-bot-select').allTextContents(), [
      '通用',
      '随口一问',
      'X 资讯',
    ]);
    assert.equal(await page.getByRole('button', { name: '环境运维', exact: true }).count(), 0);
    await page.evaluate(
      (params) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: { type: 'mcp-notification', hostId: 'local', method: 'item/started', params },
          }),
        ),
      event(),
    );
    const reordered = structuredClone(value);
    reordered.sidebar.groups = [
      value.sidebar.groups[0],
      value.sidebar.groups[2],
      value.sidebar.groups[1],
    ];
    // Pure presentation changes must not drop the observed call or alter the main draft.
    await page.evaluate((v) => window.render(v), reordered);
    await page.getByRole('button', { name: '查看进度', exact: true }).waitFor();
    assert.deepEqual(await page.locator('.palboo-bot-select').allTextContents(), [
      '通用',
      'X 资讯',
      '随口一问',
    ]);
    assert.equal(await page.locator('textarea').inputValue(), '保留草稿');
    const rejected = await page.evaluate(() =>
      window.api.fill({
        ...window.api.read().target,
        agent: '环境运维',
        botId: 'bot-3',
        revision: 'r1',
        action: 'ask',
      }),
    );
    assert.equal(rejected.ok, false);
    await page.getByRole('button', { name: '查看进度', exact: true }).click();
    assert.equal(await page.locator('textarea').inputValue(), '保留草稿\n查看「通用」的进度。');
    assert.equal(await page.locator('#view input,#view textarea').count(), 0);
    // Settings consume the same saved order and never reintroduce hidden profiles.
    await page.evaluate(() => window.showSettings());
    await page.locator('#settings').getByRole('button', { name: '通用', exact: true }).waitFor();
    assert.equal(await page.locator('.bot-settings-group[data-pinned="true"]').count(), 1);
    assert.deepEqual(
      (await page.locator('#settings .settings-drawer-trigger').allTextContents()).map((text) =>
        text.trim(),
      ),
      ['通用', '随口一问', 'X 资讯'],
    );
    assert.equal(
      await page
        .locator('#settings')
        .getByRole('button', { name: '环境运维', exact: true })
        .count(),
      0,
    );
    const botSearch = page.getByRole('searchbox', { name: '搜索 Bot', exact: true });
    await botSearch.fill('资讯');
    assert.deepEqual(
      (await page.locator('#settings .settings-drawer-trigger').allTextContents()).map((text) =>
        text.trim(),
      ),
      ['X 资讯'],
    );
    await botSearch.fill('没有这个 Bot');
    await page.getByText('没有匹配的 Bot', { exact: true }).waitFor();
    await botSearch.fill('');
    assert.equal(await page.locator('#settings .settings-drawer-trigger').count(), 3);
    mkdirSync('target/reports/bot-sidebar', { recursive: true });
    await page.screenshot({ path: 'target/reports/bot-sidebar/narrow.png', fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  } finally {
    await browser.close();
  }
});
