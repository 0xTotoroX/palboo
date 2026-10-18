/* [INPUT]: 宿主流式通知、现有唯一输入目标及独立测速开关。
 * [OUTPUT]: 当前聊天输入区的估算速度和官方用量；按事件限频更新，停用完全回收。
 * [POS]: 宿主测速适配；不发 RPC、不调用模型、不扫描正文、不写入聊天。
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
const LABELS = {
  waiting: '等待输出',
  thinking: '思考中',
  tool: '工具执行中',
  completed: '已完成',
  failed: '未完成',
  interrupted: '已停止',
  streaming: '接收中',
};
const compact = (value) =>
  value >= 10000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString('en-US');

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
    timer = null,
    lastPaint = -Infinity,
    lastTarget = -Infinity;
  const host = document.createElement('div');
  host.dataset.codexBuddyTokenMeter = 'true';
  host.hidden = true;
  host.style.cssText =
    'box-sizing:border-box;grid-column:1/-1;flex-basis:100%;width:100%;min-width:0;color:inherit;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host([hidden]){display:none!important}
    output{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:4px 12px;box-sizing:border-box;max-width:100%;padding:2px 8px;font:inherit;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;color:var(--text-secondary,inherit)}
    span{white-space:nowrap}output:focus-visible{outline:1px solid currentColor;outline-offset:-1px;border-radius:4px}
  </style><output tabindex="0" aria-live="off"><span></span><span></span></output>`;
  const output = shadow.querySelector('output'),
    [speed, official] = output.querySelectorAll('span');
  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    if (disposed || document.hidden || timer !== null) return;
    timer = setTimeout(paint, Math.max(0, 500 - (performance.now() - lastPaint)));
  }
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
    const changed = meter.follow(valid ? next.id : '');
    if (changed) sourceHost = null;
    target = valid ? next : null;
    if (!target) {
      host.remove();
      host.hidden = true;
      stopTimer();
      return;
    }
    const parent = target.composer.closest('[data-codex-composer-root]') || target.scope;
    const moved = host.parentElement !== parent;
    if (moved) parent.append(host);
    if (changed || moved) schedule();
  }
  function paint() {
    timer = null;
    if (disposed || document.hidden) return;
    lastPaint = performance.now();
    refresh();
    if (disposed || !target) return;
    return measureWork('token-meter', render);
  }
  function render() {
    const view = meter.snapshot(lastPaint);
    const rate =
      view.speed === null ? LABELS[view.phase] || '' : `≈ ${view.speed.toFixed(1)} tok/s`;
    const count = view.official
      ? `${view.scope === 'turn' ? '本轮' : '最近调用'} ${compact(view.official.outputTokens)} tok`
      : '';
    if (speed.textContent !== rate) speed.textContent = rate;
    if (official.textContent !== count) official.textContent = count;
    official.hidden = !count;
    host.hidden = !rate && !count;
    const lines = [
      '速度为最近 3 秒可见回复的文本估算，受模型分词与传输批次影响；不含隐藏思考和工具输出。',
    ];
    if (view.official) {
      const u = view.official;
      lines.push(
        `官方${view.scope === 'turn' ? '本轮累计' : '最近一次模型调用'}：输入 ${u.inputTokens.toLocaleString('en-US')} · 缓存命中 ${u.cachedInputTokens.toLocaleString('en-US')} · 输出 ${u.outputTokens.toLocaleString('en-US')} · 其中思考 ${u.reasoningOutputTokens.toLocaleString('en-US')} token`,
      );
      if (view.scope === 'call') lines.push('从本轮中途开始观察，未推算整轮用量。');
      if (view.average !== null)
        lines.push(`整轮平均 ${view.average.toFixed(1)} tok/s（含思考、工具和等待）`);
    }
    const title = lines.join('\n');
    if (output.title !== title) output.title = title;
    const label = `${rate} ${count}。${title}`;
    if (output.getAttribute('aria-label') !== label) output.setAttribute('aria-label', label);
    // refresh 可能安排了更新；仅流式期间继续，空闲无轮询。
    stopTimer();
    if (view.ticking) schedule();
  }
  function receive(event) {
    if (disposed || !isEnabled() || (event.source && event.source !== window)) return;
    const data = event.data;
    if (data?.type === 'codex-app-server-connection-changed') {
      if (sourceHost && data.hostId && data.hostId !== sourceHost) return;
      meter.follow('');
      sourceHost = null;
      target = null;
      lastTarget = -Infinity;
      host.hidden = true;
      stopTimer();
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
    // 隐藏时不收集文字，仅接收已选聊天的官方计数和轮次边界。
    if (
      document.hidden &&
      !['thread/tokenUsage/updated', 'turn/started', 'turn/completed'].includes(n.method)
    )
      return;
    sourceHost = data.hostId;
    if (measureWork('token-meter', () => meter.receive(n.method, n.params, performance.now())))
      schedule();
  }
  function retarget() {
    lastTarget = -Infinity;
    schedule();
  }
  function visibility() {
    stopTimer();
    meter.clearStream();
    if (document.hidden) host.hidden = true;
    else retarget();
  }
  const api = {
    refresh,
    snapshot: () => meter.snapshot(performance.now()),
    destroy() {
      disposed = true;
      stopTimer();
      life.abort();
      meter.follow('');
      target = null;
      host.remove();
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
