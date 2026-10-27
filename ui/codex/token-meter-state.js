/* [INPUT]: 当前聊天的 App Server 事件、单调时钟与 tokenx 轻量文本估算。
 * [OUTPUT]: 有界滑动速度、当前聊天最近有效测速、官方用量和轮次状态；不保存全文或发送请求。
 * [POS]: 测速纯状态机；页面适配负责来源校验、时间调度和呈现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { estimateTokenCount } from 'tokenx';

export const WINDOW_MS = 3000;
export const MAX_TEXT = 8192;
const FIELDS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'];
const TOOL_TYPES = new Set([
  'commandExecution',
  'mcpToolCall',
  'dynamicToolCall',
  'fileChange',
  'webSearch',
]);

function usage(value) {
  if (!value || !FIELDS.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0))
    return null;
  if (
    value.cachedInputTokens > value.inputTokens ||
    value.reasoningOutputTokens > value.outputTokens
  )
    return null;
  return Object.fromEntries(FIELDS.map((key) => [key, value[key]]));
}
function difference(total, base) {
  if (!total || !base || FIELDS.some((key) => total[key] < base[key])) return null;
  return Object.fromEntries(FIELDS.map((key) => [key, total[key] - base[key]]));
}

// 分开相邻的 CJK 与拉丁字母，避免 tokenx 将混排标识符整段按汉字估算。
// 仍只是词表无关的估算，不据此推算隐藏思考或计费。
export function estimateVisibleTokens(text) {
  return estimateTokenCount(
    text
      .replace(
        /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])([A-Za-z0-9_])/gu,
        '$1 $2',
      )
      .replace(
        /([A-Za-z0-9_])([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu,
        '$1 $2',
      ),
  );
}

export function createTokenMeter() {
  let thread = '',
    turn = '',
    phase = 'idle',
    observedStart = false,
    baseline = null;
  let total = null,
    official = null,
    scope = 'call',
    durationMs = null;
  let buckets = [],
    characters = 0,
    lastDelta = null,
    lastSpeed = null,
    measuredRevision = 0,
    streamRevision = 0,
    overflowUntil = 0,
    item = '';
  const retiredTurns = new Set(),
    closedItems = new Set(),
    tools = new Set();
  function remember(set, id) {
    set.add(id);
    if (set.size > 32) set.delete(set.values().next().value);
  }
  function clearStream() {
    captureSpeed();
    buckets = [];
    characters = 0;
    lastDelta = null;
    overflowUntil = 0;
    item = '';
  }
  function begin(id, started) {
    if (turn && turn !== id) remember(retiredTurns, turn);
    turn = id;
    observedStart = started;
    baseline = started ? total : null;
    official = null;
    scope = 'call';
    phase = 'waiting';
    durationMs = null;
    tools.clear();
    closedItems.clear();
    clearStream();
  }
  function follow(id) {
    if (id === thread) return false;
    thread = id || '';
    turn = '';
    total = null;
    retiredTurns.clear();
    begin('', false);
    lastSpeed = null;
    measuredRevision = streamRevision = 0;
    phase = 'idle';
    return true;
  }
  function expire(now) {
    while (buckets.length && buckets[0].at <= now - WINDOW_MS)
      characters -= buckets.shift().text.length;
  }
  function captureSpeed() {
    if (lastDelta === null || lastDelta < overflowUntil) return;
    expire(lastDelta);
    if (!buckets.length) return;
    // 用最后一段文字到达的时间结算，后续思考/工具/隐藏时间不稀释读数。
    lastSpeed =
      estimateVisibleTokens(buckets.map((b) => b.text).join('')) /
      (Math.max(1000, Math.min(WINDOW_MS, lastDelta - buckets[0].first)) / 1000);
    measuredRevision = streamRevision;
  }
  function receive(method, params, now) {
    if (!thread || params?.threadId !== thread) return false;
    const id = params.turnId || params.turn?.id;
    if (typeof id !== 'string' || !id || retiredTurns.has(id)) return false;
    if (id !== turn) {
      if (
        turn &&
        !['idle', 'completed', 'failed', 'interrupted'].includes(phase) &&
        method !== 'turn/started'
      )
        return false;
      begin(id, method === 'turn/started');
    } else if (method === 'turn/started') return false;
    if (method === 'thread/tokenUsage/updated') {
      const next = usage(params.tokenUsage?.total),
        last = usage(params.tokenUsage?.last);
      if (!next || !last) return false;
      if (total && FIELDS.every((key) => next[key] === total[key])) return false;
      if (observedStart && !baseline) baseline = difference(next, last);
      const turnUsage = observedStart ? difference(next, baseline) : null;
      official = turnUsage || last;
      scope = turnUsage ? 'turn' : 'call';
      // 累计计数回退（例如上游重置）不继续宣称完整本轮用量。
      if (total && !difference(next, total)) observedStart = false;
      if (!observedStart) {
        official = last;
        scope = 'call';
      }
      total = next;
      return true;
    }
    if (method === 'turn/completed') {
      phase = ['completed', 'failed', 'interrupted'].includes(params.turn?.status)
        ? params.turn.status
        : 'completed';
      durationMs =
        Number.isFinite(params.turn?.durationMs) && params.turn.durationMs > 0
          ? params.turn.durationMs
          : null;
      clearStream();
      tools.clear();
      return true;
    }
    if (['completed', 'failed', 'interrupted'].includes(phase)) return false;
    if (method === 'turn/started') return true;
    if (method === 'item/started' || method === 'item/completed') {
      const entry = params.item;
      if (!entry?.id) return false;
      if (method === 'item/completed') {
        remember(closedItems, entry.id);
        tools.delete(entry.id);
        if (entry.id === item) clearStream();
        if (phase !== 'streaming' || !item) phase = tools.size ? 'tool' : 'waiting';
      } else if (TOOL_TYPES.has(entry.type)) {
        remember(tools, entry.id);
        clearStream();
        phase = 'tool';
      } else if (entry.type === 'reasoning') {
        clearStream();
        phase = tools.size ? 'tool' : 'thinking';
      }
      return true;
    }
    if (method.startsWith('item/reasoning/')) {
      if (!tools.size) phase = 'thinking';
      return true;
    }
    if (
      method !== 'item/agentMessage/delta' ||
      typeof params.delta !== 'string' ||
      !params.delta ||
      typeof params.itemId !== 'string' ||
      closedItems.has(params.itemId)
    )
      return false;
    if (item !== params.itemId) {
      clearStream();
      item = params.itemId;
    }
    phase = 'streaming';
    lastDelta = now;
    streamRevision++;
    expire(now);
    // 超大批量输出不截断后给出虚假的低速；短窗口内直接缺测。
    if (params.delta.length > MAX_TEXT || characters + params.delta.length > MAX_TEXT) {
      buckets = [];
      characters = 0;
      overflowUntil = now + WINDOW_MS;
      return true;
    }
    const at = Math.floor(now / 100) * 100;
    if (buckets.at(-1)?.at === at) buckets.at(-1).text += params.delta;
    else buckets.push({ at, first: now, text: params.delta });
    characters += params.delta.length;
    return true;
  }
  function snapshot(now) {
    captureSpeed();
    expire(now);
    const streaming = phase === 'streaming' && lastDelta !== null && now - lastDelta < WINDOW_MS;
    const speed = streaming && lastDelta >= overflowUntil && buckets.length ? lastSpeed : null;
    return {
      phase: phase === 'streaming' && !streaming ? 'waiting' : phase,
      speed,
      lastSpeed,
      official,
      scope,
      average:
        scope === 'turn' && durationMs && official
          ? official.outputTokens / (durationMs / 1000)
          : null,
      ticking: streaming,
      bufferedCharacters: characters,
      buckets: buckets.length,
    };
  }
  return {
    follow,
    receive,
    snapshot,
    clearStream,
    measurement: () => ({ speed: lastSpeed, revision: measuredRevision }),
  };
}
