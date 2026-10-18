/* [INPUT]: 宿主流式通知、现有唯一输入目标及独立测速开关。
 * [OUTPUT]: 当前聊天的有界数值快照；不挂载界面，不创建独立定时器。
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
  getTarget = () => window.__codexBuddyModelControl?.inputTarget(),
  isEnabled = () => true,
} = {}) {
  window.__codexBuddyTokenMeter?.destroy();
  const life = new AbortController(),
    meter = createTokenMeter();
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
    const valid =
      next?.id &&
      !next.id.startsWith('draft:') &&
      next.composer?.isConnected &&
      next.scope?.isConnected;
    if (meter.follow(valid ? next.id : '')) {
      sourceHost = null;
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
      projection = {
        threadId: target.id,
        phase: view.phase,
        speed: view.speed,
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
    measureWork('token-meter', () => meter.receive(n.method, n.params, performance.now()));
  }
  function retarget() {
    lastTarget = -Infinity;
    refresh();
  }
  function visibility() {
    meter.clearStream();
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
      target = projection = null;
      if (window.__codexBuddyTokenMeter === api) delete window.__codexBuddyTokenMeter;
    },
  };
  window.__codexBuddyTokenMeter = api;
  window.addEventListener('message', receive, { signal: life.signal });
  window.addEventListener('popstate', retarget, { signal: life.signal });
  document.addEventListener('pointerup', retarget, { signal: life.signal });
  document.addEventListener('focusin', retarget, { signal: life.signal });
  document.addEventListener('visibilitychange', visibility, { signal: life.signal });
  refresh();
  return api;
}
