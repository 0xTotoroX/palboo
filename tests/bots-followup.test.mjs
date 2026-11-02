/* [INPUT]: Real Bot feature shell/host adapter, synthetic MCP events and isolated composers.
 * [OUTPUT]: Continuation routing, focus/caret, append-only drafts and stale/busy rejection.
 * [POS]: Offline browser regression; transport is synthetic, no Rust server or Grok Bot calls.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const prompt = '追问「通用」，沿用本聊天中对该 Bot 的上一次调用和上下文，不要新建会话：';
const blocked = '此调用暂时无法追问，请先在主聊天确认状态。';
let browser, bundle;
before(async () => {
  bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import {installBots} from './ui/codex/bots.js';
import {rawComposerText} from './ui/codex/composer.js';
import {mountFeature} from './ui/surfaces/workspace/mount';
window.session='a';window.enabled=true;window.submits=0;window.calls=[];
window.catalog={version:1,account:'fixture',revision:'r1',stale:false,
  bots:[{id:'bot-a',name:'通用',available:true},{id:'bot-b',name:'写作助手',available:true}]};
window.editor=()=>document.querySelector('[data-composer]');
window.draft=()=>rawComposerText(window.editor());
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submits++});
window.reset=()=>{
  window.session='a';window.enabled=true;
  window.api=installBots({isEnabled:()=>window.enabled,getTarget:()=>({id:window.session,composer:window.editor(),scope:document.querySelector('main')})});
  window.api.setCatalog(window.catalog);
};
window.observe=({status='finished',threadId='a',itemId='call-a',agent='通用'}={})=>{
  const params={threadId,turnId:'turn-a',item:{id:itemId,type:'mcpToolCall',server:'grokbot',tool:'call_tool',
    arguments:{toolName:'grokbot__ask',input:{agent,message:'PRIVATE_PROMPT'}}}};
  const emit=(method)=>window.dispatchEvent(new MessageEvent('message',{source:window,
    data:{type:'mcp-notification',hostId:'local',method,params}}));
  emit('item/started');
  if(status==='calling')return;
  params.item.result={isError:status==='error',content:[{type:'text',text:JSON.stringify({
    toolName:'grokbot__ask',result:{agent,status:status==='disconnected'?'running':status,
      created:status==='unexpected',reply:'PRIVATE_REPLY'}})}]};
  emit('item/completed');
  if(status==='disconnected')window.dispatchEvent(new MessageEvent('message',{source:window,
    data:{type:'codex-app-server-connection-changed',hostId:'local'}}));
};
window.input=()=>{const snapshot=window.api.read();return {...snapshot.target,action:'followup',
  agent:'通用',botId:'bot-a',revision:'r1',key:snapshot.bots[0].current?.key}};
window.refresh=()=>document.dispatchEvent(new Event('visibilitychange'));
window.reset();
const entry={id:'bots',owner:'fixture-owner',open:true,placement:'sidebar',view:{},size:[300,360],reveal:1,pending:null};
window.mounted=mountFeature(document.querySelector('#mount'),entry,entry.owner,'sidebar',async request=>{
  if(request.op==='action'){
    window.calls.push(request);
    window.beforeFill?.();
    const result=window.api.fill(request.data);
    if(!result.ok)throw Error(result.message);
  }
  return {snapshot:window.api.read(),appearance:{language:'zh-CN'}};
},()=>{});
document.querySelector('header').append(window.mounted.headerActions);
`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'inline-css',
        setup(builder) {
          builder.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
            path: resolve(dirname(args.importer), args.path.split('?')[0]),
            namespace: 'css-text',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'css-text' }, (args) => ({
            contents: readFileSync(args.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function setup(t, editable = false) {
  const page = await browser.newPage({
    viewport: { width: 420, height: 740 },
    reducedMotion: 'reduce',
  });
  page.setDefaultTimeout(10000);
  t.after(() => page.close());
  const external = [];
  await page.route('**/*', (route) => {
    if (route.request().url() === 'http://127.0.0.1:47990/')
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<style>body{font:16px system-ui}#mount{height:360px}main{margin-bottom:24px}[data-composer]{width:360px;min-height:80px}header{height:30px;display:flex}</style>
          <main><form>${
            editable
              ? '<div data-composer contenteditable="true"><p>原草稿</p><p><span data-attachment contenteditable="false">附件</span>保留内容</p></div>'
              : '<textarea data-composer>原草稿\n\n保留空行\n</textarea>'
          }<button type="submit">发送</button></form></main><header></header><div id="mount"></div>`,
      });
    external.push(route.request().url());
    return route.abort();
  });
  t.after(() => assert.deepEqual(external, [], 'no service/model/network requests'));
  await page.goto('http://127.0.0.1:47990/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole('button', { name: '通用', exact: true }).waitFor();
  return page;
}

async function observe(page, value = {}) {
  await page.evaluate((value) => {
    window.observe(value);
    window.refresh();
  }, value);
}

for (const mode of ['textarea', 'contenteditable', 'insertText fallback']) {
  test(`real feature follow-up appends to ${mode}, restores the caret and never sends`, async (t) => {
    const page = await setup(t, mode !== 'textarea');
    const before = await page.evaluate(() => {
      window.attachment = document.querySelector('[data-attachment]');
      return window.draft();
    });
    if (mode === 'insertText fallback')
      await page.evaluate(() => (document.execCommand = () => false));
    await observe(page);
    const followup = page.getByRole('button', { name: '追问', exact: true, includeHidden: true });
    await followup.waitFor({ state: 'attached' });
    await page.getByRole('button', { name: '通用', exact: true }).focus();
    await page.getByRole('button', { name: '通用', exact: true }).hover();
    if (mode === 'textarea') {
      await followup.focus();
      await page.keyboard.press('Enter');
    } else await followup.click();
    await page.waitForFunction(() => window.calls.length === 1);
    const expected = await page.evaluate(() => window.draft());
    assert.ok(expected.startsWith(before), 'the original draft is preserved verbatim');
    assert.equal(expected.slice(before.length).trimStart(), prompt);
    if (mode !== 'insertText fallback')
      assert.equal(expected, `${before}${before.endsWith('\n') ? '' : '\n'}${prompt}`);
    assert.equal(await page.evaluate(() => document.activeElement === window.editor()), true);
    const request = await page.evaluate(() => window.calls[0]);
    assert.equal(request.id, 'bots');
    assert.equal(request.owner, 'fixture-owner');
    assert.equal(request.data.action, 'followup');
    assert.equal(request.data.key, JSON.stringify(['local', 'a', 'turn-a', 'call-a']));
    assert.equal(request.data.threadId, 'a');
    await page.keyboard.type('请补充一个例子');
    assert.equal(await page.evaluate(() => window.draft()), expected + '请补充一个例子');
    // A second click must neither duplicate the prefix nor leave selection over old text.
    await page.evaluate(() => {
      const editor = window.editor();
      if (editor instanceof HTMLTextAreaElement) editor.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
    await page.getByRole('button', { name: '通用', exact: true }).focus();
    await page.getByRole('button', { name: '通用', exact: true }).hover();
    await followup.click();
    await page.waitForFunction(() => window.calls.length === 2);
    await page.keyboard.type('，说明原因');
    assert.equal(await page.evaluate(() => window.draft()), expected + '请补充一个例子，说明原因');
    assert.equal(
      await page.evaluate(() => document.querySelector('[data-attachment]') === window.attachment),
      true,
    );
    assert.equal(await page.locator('#mount textarea,#mount input').count(), 0);
    await page.locator('[data-composer]').fill('');
    await page.getByRole('button', { name: '通用', exact: true }).hover();
    await followup.click();
    await page.waitForFunction(() => window.calls.length === 3);
    assert.equal(await page.evaluate(() => window.draft()), prompt);
    assert.equal(await page.evaluate(() => document.activeElement === window.editor()), true);
    assert.equal(await page.evaluate(() => window.submits), 0);
  });
}

test('follow-up rejects unsupported call states in both the host and visible feature', async (t) => {
  const page = await setup(t);
  const before = await page.evaluate(() => window.draft());
  for (const status of [
    'calling',
    'running',
    'busy',
    'error',
    'unknown',
    'unexpected',
    'disconnected',
  ]) {
    await page.evaluate(() => window.reset());
    await observe(page, { status });
    const result = await page.evaluate(() => window.api.fill(window.input()));
    assert.equal(result.ok, false, status);
    assert.equal(result.message, blocked);
    if (['calling', 'running'].includes(status)) {
      await page
        .getByRole('button', { name: '查看进度', exact: true, includeHidden: true })
        .waitFor({ state: 'attached' });
      assert.equal(
        await page.getByRole('button', { name: '追问', exact: true, includeHidden: true }).count(),
        0,
      );
    } else {
      const followup = page.getByRole('button', { name: '追问', exact: true, includeHidden: true });
      await page.waitForFunction(
        () =>
          document.querySelector('#mount').shadowRoot.querySelector('[aria-label="追问"]')
            ?.disabled,
      );
      assert.equal(await followup.getAttribute('aria-description'), blocked);
    }
    assert.equal(await page.evaluate(() => window.draft()), before);
  }
  for (const status of ['finished', 'interrupted']) {
    await page.evaluate(() => window.reset());
    await observe(page, { status });
    await page.waitForFunction(() => {
      const action = document
        .querySelector('#mount')
        .shadowRoot.querySelector('[aria-label="追问"]');
      return action && !action.disabled;
    });
    assert.equal(await page.evaluate(() => window.api.fill(window.input()).ok), true, status);
  }
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test('follow-up rejects missing, stale and foreign call identities without changing the draft', async (t) => {
  const page = await setup(t);
  const before = await page.evaluate(() => window.draft());
  const result = await page.evaluate(() => {
    const results = {};
    results.noCall = window.api.fill(window.input());
    window.observe();
    const original = window.input();
    for (const [name, patch] of Object.entries({
      staleCall: { key: 'old-call' },
      foreignChat: { threadId: 'b' },
      staleComposer: { token: 'old-editor' },
      staleCatalog: { revision: 'old-catalog' },
      otherBot: { botId: 'bot-b', agent: '写作助手' },
    }))
      results[name] = window.api.fill({ ...original, ...patch });
    window.observe({ itemId: 'new-call' });
    results.replacedCall = window.api.fill(original);
    window.observe({ threadId: 'b', itemId: 'foreign-call', status: 'running' });
    results.occupied = window.api.fill(window.input());
    window.reset();
    window.observe();
    const input = window.input();
    window.session = 'b';
    results.switchedChat = window.api.fill(input);
    window.session = 'a';
    results.returnedChat = window.api.fill(input);
    const fresh = window.input();
    const editor = window.editor();
    editor.replaceWith(editor.cloneNode(true));
    results.replacedEditor = window.api.fill(fresh);
    window.api.setCatalog({ ...window.catalog, stale: true });
    results.expiredCatalog = window.api.fill(window.input());
    window.api.setCatalog({ ...window.catalog, account: 'another-account' });
    results.accountChanged = window.api.fill(window.input());
    return results;
  });
  for (const [name, value] of Object.entries(result)) assert.equal(value.ok, false, name);
  assert.equal(await page.evaluate(() => window.draft()), before);
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test('an outdated rendered action reports failure through the real feature error surface', async (t) => {
  const page = await setup(t);
  const before = await page.evaluate(() => window.draft());
  await observe(page);
  const followup = page.getByRole('button', { name: '追问', exact: true, includeHidden: true });
  await followup.waitFor({ state: 'attached' });
  await page.evaluate(() => (window.beforeFill = () => window.observe({ itemId: 'new-call' })));
  await page.getByRole('button', { name: '通用', exact: true }).focus();
  await followup.click();
  await page.getByText('调用记录已变化，请刷新后重试。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.draft()), before);
  assert.equal(await page.evaluate(() => window.submits), 0);
});

test('focus-time editor replacement is rejected before any draft write', async (t) => {
  const page = await setup(t);
  await observe(page);
  const before = await page.evaluate(() => window.draft());
  const result = await page.evaluate(() => {
    const editor = window.editor();
    editor.addEventListener('focus', () => editor.replaceWith(editor.cloneNode(true)), {
      once: true,
    });
    return window.api.fill(window.input());
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /聊天或输入框已变化/);
  assert.equal(await page.evaluate(() => window.draft()), before);
  assert.equal(await page.evaluate(() => window.submits), 0);
});
