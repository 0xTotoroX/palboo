/* [INPUT]: Isolated host bridge and clock; no real account or API.
 * [OUTPUT]: Usage window mapping, bounded reads, account isolation and stop/reload cleanup.
 * [POS]: model-usage.js contract regression.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const source = readFileSync(new URL('../ui/codex/model-usage.js', import.meta.url), 'utf8');
function fixture() {
  let now = 1000000;
  const listeners = new Set(),
    timers = new Map(),
    sent = [];
  const window = {
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    electronBridge: {
      sendMessageFromView: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  };
  const context = vm.createContext({
    window,
    crypto: { randomUUID },
    Date: { now: () => now },
    setTimeout: (fn, delay) => {
      const key = {};
      timers.set(key, { fn, at: now + delay });
      return key;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  vm.runInContext(source, context);
  const event = (data, source = window) => {
    for (const fn of [...listeners]) fn({ data, source });
  };
  return {
    window,
    sent,
    timers,
    listeners,
    read: (active = true) => JSON.parse(JSON.stringify(window.__codexBuddyUsage.read(active))),
    event,
    reply: (
      result,
      id = sent.findLast((x) => x.type === 'mcp-request').request.id,
      hostId = 'local',
    ) => event({ type: 'mcp-response', hostId, message: { id, result } }),
    advance: (ms) => {
      now += ms;
      for (const [key, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(key);
          timer.fn();
        }
    },
    reload: () => vm.runInContext(source, context),
  };
}
const windowLimit = (minutes, usedPercent) => ({ windowDurationMins: minutes, usedPercent });
const result = (primary, secondary = null) => ({
  rateLimits: { limitId: 'codex', primary, secondary },
});
test('usage maps actual windows, including weekly-only primary and authoritative codex bucket', () => {
  const f = fixture();
  assert.equal(f.sent.length, 0);
  assert.equal(f.read(), null);
  f.reply(result(windowLimit(10080, 69)));
  assert.deepEqual(f.read(), [{ minutes: 10080, remainingPercent: 31, resetsAt: null }]);
  f.advance(60000);
  f.read();
  f.reply({
    ...result(windowLimit(300, 99)),
    rateLimitsByLimitId: {
      codex: { primary: windowLimit(10080, 25), secondary: windowLimit(300, 40) },
      codex_spark: { primary: windowLimit(300, 0) },
    },
  });
  assert.deepEqual(
    f.read().map((w) => [w.minutes, w.remainingPercent]),
    [
      [300, 60],
      [10080, 75],
    ],
  );
});
test('unknown, missing, unrelated and expired usage never becomes 100%', () => {
  for (const value of [
    result(null),
    result(windowLimit(300, null)),
    result(windowLimit(300, '20')),
    result(windowLimit(300, NaN)),
    result(windowLimit(15, 5)),
    { ...result(windowLimit(300, 20)), rateLimitsByLimitId: { codex_spark: {} } },
    result({ ...windowLimit(300, 20), resetsAt: 999 }),
  ]) {
    const f = fixture();
    f.read();
    f.reply(value);
    assert.equal(f.read(), null);
  }
  const f = fixture();
  f.read();
  f.reply(result(windowLimit(300, -5), windowLimit(10080, 105)));
  assert.deepEqual(
    f.read().map((w) => w.remainingPercent),
    [100, 0],
  );
});
test('reads are shared, throttled, non-blocking, expire and recover after timeout', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.read();
  assert.equal(f.sent.length, 1);
  assert.equal(f.timers.size, 1);
  f.advance(8000);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sent.at(-1).type, 'mcp-request-abandon');
  f.advance(52000);
  f.read();
  assert.equal(f.sent.filter((x) => x.type === 'mcp-request').length, 2);
  f.reply(result(windowLimit(10080, 20)));
  assert.equal(f.read()[0].remainingPercent, 80);
  f.advance(120001);
  assert.equal(f.read(), null);
});
test('disable and reload remove listeners, abandon reads and reject old account responses', () => {
  const f = fixture();
  f.read();
  const first = f.sent[0].request.id;
  f.read(false);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  f.reply(result(windowLimit(10080, 10)), first);
  assert.equal(f.read(false), null);
  f.read();
  f.reply(result(windowLimit(10080, 20)), first);
  assert.equal(f.read(), null);
  f.reply(result(windowLimit(10080, 30)));
  assert.equal(f.read()[0].remainingPercent, 70);
  f.event({ type: 'mcp-notification', hostId: 'local', method: 'account/updated', params: {} });
  assert.equal(f.read(), null);
  f.reply(result(windowLimit(10080, 10)), undefined, 'remote');
  assert.equal(f.read(), null);
  f.reload();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.read(false), null);
});
test('local notifications update without extra reads; other sources/buckets are ignored', () => {
  const f = fixture();
  f.read();
  f.reply(result(windowLimit(10080, 20)));
  const notification = {
    type: 'mcp-notification',
    hostId: 'local',
    method: 'account/rateLimits/updated',
    params: result(windowLimit(10080, 40)),
  };
  f.event(notification, {});
  assert.equal(f.read()[0].remainingPercent, 80);
  f.event({
    ...notification,
    params: { rateLimits: { limitId: 'codex_spark', primary: windowLimit(300, 20) } },
  });
  assert.equal(f.read()[0].remainingPercent, 80);
  f.event(notification);
  assert.equal(f.read()[0].remainingPercent, 60);
  assert.equal(f.sent.length, 1);
});
