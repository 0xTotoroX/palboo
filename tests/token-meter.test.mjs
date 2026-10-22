/* [INPUT]: 测速状态机与隔离 Chromium 中的真实宿主适配器；仅使用合成事件。
 * [OUTPUT]: 身份/轮次隔离、官方用量、分块估算、有界缓存、渲染和回收验收。
 * [POS]: 不连接真实宿主、不发送消息或调用模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import {
  createTokenMeter,
  MAX_TEXT,
  estimateVisibleTokens,
} from '../ui/codex/token-meter-state.js';

const counts = (inputTokens, outputTokens, reasoningOutputTokens = 0) => ({
  inputTokens,
  outputTokens,
  reasoningOutputTokens,
  cachedInputTokens: Math.floor(inputTokens / 2),
});
function fixture() {
  const meter = createTokenMeter();
  meter.follow('a');
  const event = (method, extra = {}, at = 0) =>
    meter.receive(method, { threadId: 'a', turnId: 't1', ...extra }, at);
  const usage = (total, last, at = 0, extra = {}) =>
    event('thread/tokenUsage/updated', { tokenUsage: { total, last }, ...extra }, at);
  return { meter, event, usage };
}

test('official usage uses cumulative differences, ignores duplicates and labels partial turns', () => {
  const f = fixture();
  f.event('turn/started', { turn: { id: 't1' } });
  f.usage(counts(1100, 120, 15), counts(100, 20, 5));
  assert.deepEqual(f.meter.snapshot(10).official, counts(100, 20, 5));
  assert.equal(f.meter.snapshot(10).scope, 'turn');
  f.usage(counts(1300, 160, 25), counts(200, 40, 10));
  assert.equal(f.meter.snapshot(20).official.outputTokens, 60);
  f.usage(counts(1300, 160, 25), counts(200, 40, 10));
  f.event('turn/completed', { turn: { status: 'completed', durationMs: 10000 } });
  assert.equal(f.meter.snapshot(20).average, 6);
  assert.equal(f.event('item/agentMessage/delta', { itemId: 'late', delta: 'stale' }, 30), false);
  f.event('turn/started', { turnId: 't2', turn: { id: 't2' } }, 40);
  f.usage(counts(1500, 190, 30), counts(200, 30, 5), 50, { turnId: 't2' });
  assert.equal(f.meter.snapshot(50).official.outputTokens, 30);
  assert.equal(f.usage(counts(1300, 160, 25), counts(200, 40, 10), 60), false);
  f.meter.follow('b');
  assert.equal(f.usage(counts(1700, 210, 30), counts(200, 20)), false);
  f.meter.receive(
    'thread/tokenUsage/updated',
    {
      threadId: 'b',
      turnId: 'middle',
      tokenUsage: { total: counts(4000, 1000), last: counts(100, 42) },
    },
    70,
  );
  assert.equal(f.meter.snapshot(70).scope, 'call');
  assert.equal(f.meter.snapshot(70).official.outputTokens, 42);
  assert.equal(f.meter.snapshot(70).average, null);
});

test('unknown/malformed usage stays unknown; counter reset and late final usage are explicit', () => {
  const f = fixture();
  f.event('turn/started');
  f.usage({}, {});
  assert.equal(f.meter.snapshot(0).official, null);
  f.usage(counts(1000, 100, 110), counts(100, 10));
  assert.equal(f.meter.snapshot(0).official, null);
  f.usage(counts(1100, 120), counts(100, 20));
  f.event('turn/completed', { turn: { status: 'completed', durationMs: 1000 } });
  f.usage(counts(1200, 140), counts(100, 20));
  assert.equal(f.meter.snapshot(1).official.outputTokens, 40);
  f.usage(counts(100, 10), counts(100, 10));
  assert.equal(f.meter.snapshot(2).scope, 'call');
  assert.equal(f.meter.snapshot(2).average, null);
});

test('visible estimation joins stream chunks, ignores tool/reasoning output and has bounded work', () => {
  const f = fixture();
  const text = '当前接口response_tokens与fooBar123一起验证。Hello world! 🐈';
  f.event('turn/started');
  for (const char of text) f.event('item/agentMessage/delta', { itemId: 'msg', delta: char }, 100);
  const snap = f.meter.snapshot(1100);
  assert.equal(snap.speed, estimateVisibleTokens(text));
  assert.equal(snap.buckets, 1);
  assert.equal(snap.bufferedCharacters, text.length);
  f.event('item/reasoning/summaryTextDelta', { delta: '不可计入回复速度' }, 1200);
  assert.equal(f.meter.snapshot(1200).speed, null);
  f.event('item/started', { item: { type: 'commandExecution', id: 'tool' } }, 1250);
  f.event('item/commandExecution/outputDelta', { itemId: 'tool', delta: 'x'.repeat(100000) }, 1300);
  assert.equal(f.meter.snapshot(1300).bufferedCharacters, 0);
  assert.equal(f.meter.snapshot(1300).phase, 'tool');
  f.event('item/agentMessage/delta', { itemId: 'msg2', delta: 'x'.repeat(MAX_TEXT + 1) }, 1400);
  assert.equal(f.meter.snapshot(1500).speed, null);
  assert.equal(f.meter.snapshot(1500).bufferedCharacters, 0);
  for (let i = 0; i < 10000; i++)
    f.event('item/agentMessage/delta', { itemId: 'msg2', delta: '好' }, 1500 + i);
  const bounded = f.meter.snapshot(11500);
  assert.ok(bounded.bufferedCharacters <= MAX_TEXT);
  assert.ok(bounded.buckets <= 31);
  assert.equal(f.meter.snapshot(15000).speed, null);
  assert.equal(f.meter.snapshot(15000).ticking, false);
  assert.equal(f.meter.snapshot(15000).bufferedCharacters, 0);
});

const bundle = (
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {installTokenMeter} from './ui/codex/token-meter.js';
window.session='a';window.enabled=true;window.reads=0;window.requests=0;
window.electronBridge={sendMessageFromView:()=>window.requests++};
window.setup=()=>installTokenMeter({isEnabled:()=>window.enabled,getTarget:()=>{window.reads++;const scope=document.querySelector('main[data-current]');return scope?{id:window.session,scope,root:scope,composer:scope.querySelector('textarea')}:null}});
window.notify=(method,params={},hostId='local')=>window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'mcp-notification',hostId,method,params:{threadId:window.session,turnId:'t1',...params}}}));
window.setup();`,
    },
    bundle: true,
    write: false,
  })
).outputFiles[0].text;

test('collector projects only matching chat, never mounts UI or polls, and releases on disable', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await page.setContent('<main data-current><textarea>原草稿</textarea></main>');
    await page.addScriptTag({ content: bundle });
    const reads = await page.evaluate(() => window.reads);
    await page.clock.runFor(10000);
    assert.equal(await page.evaluate(() => window.reads), reads);
    assert.equal(await page.locator('[data-palboo-token-meter]').count(), 0);
    await page.evaluate(() => {
      window.notify('turn/started');
      window.notify('item/agentMessage/delta', { itemId: 'm', delta: '当前回复速度 hello world' });
      window.notify('thread/tokenUsage/updated', {
        tokenUsage: {
          total: {
            inputTokens: 1000,
            cachedInputTokens: 500,
            outputTokens: 120,
            reasoningOutputTokens: 20,
          },
          last: {
            inputTokens: 1000,
            cachedInputTokens: 500,
            outputTokens: 120,
            reasoningOutputTokens: 20,
          },
        },
      });
    });
    const state = await page.evaluate(() => window.__palbooTokenMeter.read('a'));
    assert.ok(state.speed > 0);
    assert.equal(state.official.outputTokens, 120);
    assert.equal(state.scope, 'turn');
    assert.equal(await page.evaluate(() => window.__palbooTokenMeter.read('other')), null);
    assert.equal(
      await page.evaluate(() => {
        const first = window.__palbooTokenMeter.read('a');
        return first === window.__palbooTokenMeter.read('a');
      }),
      true,
    );
    assert.equal(await page.locator('textarea').inputValue(), '原草稿');
    await page.evaluate(() =>
      window.notify('item/agentMessage/delta', { threadId: 'other', itemId: 'x', delta: 'ignore' }),
    );
    assert.deepEqual(await page.evaluate(() => window.__palbooTokenMeter.read('a')), state);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.notify('item/agentMessage/delta', { itemId: 'hidden', delta: '不可缓存' });
    });
    assert.equal(await page.evaluate(() => window.__palbooTokenMeter.read('a')), null);
    assert.equal(
      await page.evaluate(() => window.__palbooTokenMeter.snapshot().bufferedCharacters),
      0,
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      window.session = 'b';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => window.__palbooTokenMeter.read('a')), null);
    assert.equal(await page.evaluate(() => window.__palbooTokenMeter.read('b').official), null);
    await page.evaluate(() => {
      document.querySelector('main').removeAttribute('data-current');
      document.dispatchEvent(new Event('pointerup'));
    });
    const missingReads = await page.evaluate(() => window.reads);
    await page.evaluate(() => {
      for (let i = 0; i < 1000; i++)
        window.notify('item/agentMessage/delta', { itemId: 'missing', delta: 'ignore' });
    });
    assert.equal(await page.evaluate(() => window.reads), missingReads);
    await page.evaluate(() => {
      window.enabled = false;
      window.__palbooTokenMeter.refresh();
    });
    const stopped = await page.evaluate(() => window.reads);
    await page.evaluate(() => {
      window.notify('turn/started');
      document.dispatchEvent(new Event('pointerup'));
    });
    await page.clock.runFor(10000);
    assert.equal(await page.evaluate(() => window.reads), stopped);
    assert.equal(await page.evaluate(() => !!window.__palbooTokenMeter), false);
    assert.equal(await page.evaluate(() => window.requests), 0);
  } finally {
    await browser.close();
  }
});
