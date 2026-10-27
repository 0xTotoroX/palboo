/* [INPUT]: 宿主流式通知、现有唯一输入目标及独立测速开关。
 * [OUTPUT]: 当前聊天状态与按模型/Fast 隔离的最近测速缓存；只存数值，不挂载界面或创建定时器。
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
  const rates = new Map();
  let selectionKey = '',
    sampleKey = '',
    sampleTurn = '',
    sampleFloor = -Infinity;
  const keyFor = (selection) =>
    typeof selection?.model === 'string' &&
    selection.model &&
    ['standard', 'fast'].includes(selection.speed)
      ? JSON.stringify([selection.model, selection.speed])
      : '';
  function retain() {
    const { speed, revision } = meter.measurement();
    if (!sampleKey || speed === null || revision <= sampleFloor) return;
    rates.delete(sampleKey);
    rates.set(sampleKey, speed);
    if (rates.size > 32) rates.delete(rates.keys().next().value);
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
    if (target && n.params?.threadId !== target.id) return;
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
    if (turnId !== sampleTurn) retain();
    const accepted = measureWork('token-meter', () =>
      meter.receive(n.method, n.params, performance.now()),
    );
    if (accepted && turnId !== sampleTurn) {
      // begin 已结算旧轮次未读取的片段，先归还给旧模型。
      retain();
      sampleTurn = turnId;
      sampleKey = selectionKey;
      sampleFloor = meter.measurement().revision;
    } else if (accepted && !sampleKey && selectionKey) {
      sampleKey = selectionKey;
      sampleFloor = meter.measurement().revision;
    }
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
