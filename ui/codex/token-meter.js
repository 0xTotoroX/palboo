/* [INPUT]: 宿主流式通知、现有唯一输入目标及独立测速开关。
 * [OUTPUT]: 当前聊天状态、不可变轮次归属与按模型/Fast 隔离的最近测速；仅保留有界元数据和数值，无界面或独立计时器。
 * [POS]: 可独立启停的测速采集器；呈现由 features/token-meter 消费，模型切换不依赖它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createTokenMeter } from './token-meter-state.js';
import { measureWork } from '../shared/performance.js';

const METHODS = new Set([
  'turn/started',
  'turn/completed',
  'thread/tokenUsage/updated',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
]);

/** @param {{getTarget?:()=>any, isEnabled?:()=>boolean}} options */
export function installTokenMeter({
  getTarget = () => window.__palbooModelControl?.inputTarget(),
  isEnabled = () => true,
} = {}) {
  window.__palbooTokenMeter?.destroy();
  const life = new AbortController(),
    meter = createTokenMeter();
  const rates = new Map(),
    origins = new Map(),
    latestOrigins = new Map();
  let selectionKey = '',
    sampleKey = '',
    sampleTurn = '',
    sampleFloor = -Infinity;
  const keyFor = (selection) =>
    typeof selection?.model === 'string' &&
    selection.model &&
    ['standard', 'fast', 'ultrafast'].includes(selection.speed)
      ? JSON.stringify([selection.model, selection.speed])
      : '';
  function retain() {
    const { speed, revision } = meter.measurement();
    if (!sampleKey || speed === null || revision <= sampleFloor) return;
    rates.delete(sampleKey);
    rates.set(sampleKey, speed);
    if (rates.size > 32) rates.delete(rates.keys().next().value);
  }
  function rememberOrigin(id, threadKey, started) {
    let origin = origins.get(id);
    if (!origin) {
      // 只在亲眼观察到开始时认领模型；中途接入或未知选择不补猜。
      origin = { key: started ? selectionKey : '', closed: false };
      origins.set(id, origin);
      if (origins.size > 128) origins.delete(origins.keys().next().value);
    }
    const previous = origins.get(latestOrigins.get(threadKey));
    if (previous && previous !== origin) previous.closed = true;
    latestOrigins.delete(threadKey);
    latestOrigins.set(threadKey, id);
    if (latestOrigins.size > 32) latestOrigins.delete(latestOrigins.keys().next().value);
    return origin;
  }
  let target = null,
    sourceHost = null,
    disposed = false,
    lastTarget = -Infinity;
  let projection = null,
    lastRead = -Infinity;
  function refresh() {
    return measureWork('token-meter', syncTarget);
  }
  function syncTarget() {
    if (disposed) return;
    if (!isEnabled()) {
      api.destroy();
      return;
    }
    if (document.hidden) return;
    const now = performance.now();
    if (
      now - lastTarget < 500 &&
      (!target || (target.composer.isConnected && target.scope.isConnected))
    )
      return;
    lastTarget = now;
    const next = getTarget();
    const valid = next?.id && next.composer?.isConnected && next.scope?.isConnected;
    const nextKey = valid ? keyFor(next.selection) : '';
    // 交接前结算旧聊天；只跨聊天保存模型速度，官方计数与阶段仍重新开始。
    if ((valid ? next.id : '') !== target?.id) {
      meter.clearStream();
      retain();
    }
    if (meter.follow(valid ? next.id : '')) {
      sampleKey = sampleTurn = '';
      sampleFloor = -Infinity;
      sourceHost = null;
      projection = null;
      lastRead = -Infinity;
    }
    if (selectionKey !== nextKey) {
      selectionKey = nextKey;
      projection = null;
      lastRead = -Infinity;
    }
    target = valid ? next : null;
  }
  /** @returns {import('../shared/token-meter').TokenMeterSnapshot | null} */
  function read(expectedThreadId) {
    refresh();
    if (
      disposed ||
      document.hidden ||
      !target ||
      !expectedThreadId ||
      target.id !== expectedThreadId
    )
      return null;
    const now = performance.now();
    // 复用承载方读取，最多2Hz估算；空闲和未挂载时没有自己的轮询。
    if (!projection || now - lastRead >= 500) {
      const view = measureWork('token-meter', () => meter.snapshot(now));
      retain();
      const currentSample =
        Boolean(selectionKey) &&
        sampleKey === selectionKey &&
        meter.measurement().revision > sampleFloor;
      projection = {
        threadId: target.id,
        phase: view.phase,
        speed: currentSample ? view.speed : null,
        lastSpeed: rates.get(selectionKey) ?? null,
        model: target.selection?.model,
        fast: target.selection?.speed === 'fast',
        ...(target.selection?.speed === 'ultrafast' ? { ultrafast: true } : {}),
        official: view.official,
        scope: view.scope,
        average: view.average,
      };
      lastRead = now;
    }
    return /** @type {import('../shared/token-meter').TokenMeterSnapshot} */ (projection);
  }
  function receive(event) {
    if (disposed || !isEnabled() || (event.source && event.source !== window)) return;
    const data = event.data;
    if (data?.type === 'codex-app-server-connection-changed') {
      if (sourceHost && data.hostId && data.hostId !== sourceHost) return;
      meter.follow('');
      rates.clear();
      origins.clear();
      latestOrigins.clear();
      selectionKey = sampleKey = sampleTurn = '';
      sourceHost = null;
      target = null;
      projection = null;
      lastTarget = lastRead = -Infinity;
      return;
    }
    if (data?.type !== 'mcp-notification') return;
    const n = data.method ? data : data.notification;
    if (!METHODS.has(n?.method) || typeof data.hostId !== 'string') return;
    // 同聊天换模型/Fast 后也必须绕过500ms采样缓存，不能用上一轮选择认领新轮次。
    if (n.method === 'turn/started' && !document.hidden) lastTarget = -Infinity;
    if (target && n.params?.threadId !== target.id && n.method !== 'turn/started') return;
    if (!document.hidden) refresh();
    if (
      !target ||
      n.params?.threadId !== target.id ||
      (sourceHost !== null && sourceHost !== data.hostId)
    )
      return;
    if (
      document.hidden &&
      !['thread/tokenUsage/updated', 'turn/started', 'turn/completed'].includes(n.method)
    )
      return;
    sourceHost = data.hostId;
    const turnId = n.params?.turnId || n.params?.turn?.id;
    if (typeof turnId !== 'string' || !turnId) return;
    const originId = JSON.stringify([sourceHost, target.id, turnId]);
    const known = origins.get(originId);
    if (
      known?.closed &&
      (turnId !== sampleTurn || !['thread/tokenUsage/updated', 'turn/completed'].includes(n.method))
    )
      return;
    if (turnId !== sampleTurn) retain();
    const accepted = measureWork('token-meter', () =>
      meter.receive(n.method, n.params, performance.now()),
    );
    if (accepted && turnId !== sampleTurn) {
      // begin 已结算旧轮次未读取的片段，先归还给旧模型。
      retain();
      sampleTurn = turnId;
      sampleKey = rememberOrigin(
        originId,
        JSON.stringify([sourceHost, target.id]),
        n.method === 'turn/started' && !document.hidden,
      ).key;
      sampleFloor = meter.measurement().revision;
    }
    if (accepted && n.method === 'turn/completed') origins.get(originId).closed = true;
    retain();
  }
  function retarget() {
    lastTarget = -Infinity;
    refresh();
  }
  function visibility() {
    meter.clearStream();
    retain();
    projection = null;
    lastRead = -Infinity;
    if (!document.hidden) retarget();
  }
  const api = {
    refresh,
    read,
    snapshot: () => meter.snapshot(performance.now()),
    destroy() {
      disposed = true;
      life.abort();
      meter.follow('');
      rates.clear();
      origins.clear();
      latestOrigins.clear();
      target = projection = null;
      if (window.__palbooTokenMeter === api) delete window.__palbooTokenMeter;
    },
  };
  window.__palbooTokenMeter = api;
  window.addEventListener('message', receive, { signal: life.signal });
  window.addEventListener('popstate', retarget, { signal: life.signal });
  document.addEventListener('pointerup', retarget, { signal: life.signal });
  document.addEventListener('focusin', retarget, { signal: life.signal });
  document.addEventListener('visibilitychange', visibility, { signal: life.signal });
  refresh();
  return api;
}
