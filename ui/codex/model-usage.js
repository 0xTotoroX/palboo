/* [INPUT]: 宿主 electronBridge 的本机 account/rateLimits/read 与额度/账号通知。
 * [OUTPUT]: __palbooUsage.read(enabled) 只读、限频的 5 小时/周剩余额度；未知值不猜测。
 * [POS]: 独立宿主适配器，无凭据、聊天读取、模型调用或持久化；模型快切停用时回收。
 * [PROTOCOL]: 与 model.js 一起安装/销毁；额度不进入模型选择 revision。 */
(() => {
  'use strict';
  const KEY = '__palbooUsage';
  const host =
    /** @type {Window & {electronBridge?: {sendMessageFromView?: (message: object) => Promise<unknown>}}} */ (
      window
    );
  window[KEY]?.dispose();
  let enabled = false,
    disposed = false,
    pending = null,
    cache = null,
    updatedAt = 0,
    nextRead = 0;
  const POLL_MS = 60000;
  const MAX_AGE_MS = 120000;
  const TIMEOUT_MS = 8000;
  function project(result) {
    const limits = result?.rateLimitsByLimitId
      ? result.rateLimitsByLimitId.codex
      : result?.rateLimits;
    if (!limits || (limits.limitId && limits.limitId !== 'codex')) return null;
    const windows = [limits.primary, limits.secondary];
    const output = [];
    for (const minutes of [300, 10080]) {
      const matches = windows.filter((item) => item?.windowDurationMins === minutes);
      if (matches.length !== 1) continue;
      const value = matches[0];
      if (typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)) continue;
      output.push({
        minutes,
        remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - value.usedPercent))),
        resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null,
      });
    }
    return output.length ? output : null;
  }
  function accept(result) {
    cache = project(result);
    updatedAt = Date.now();
  }
  function finish(request) {
    if (pending !== request) return false;
    clearTimeout(request.timer);
    pending = null;
    return true;
  }
  function send(message) {
    return host.electronBridge?.sendMessageFromView?.(message);
  }
  function cancel() {
    const request = pending;
    if (!request || !finish(request)) return;
    // Abandon only our own read, never a turn or another host request.
    try {
      Promise.resolve(
        send({ type: 'mcp-request-abandon', hostId: 'local', requestId: request.id }),
      ).catch(() => {});
    } catch {}
  }
  function invalidate() {
    cancel();
    cache = null;
    updatedAt = 0;
    nextRead = 0;
  }
  function receive(event) {
    if (!enabled || disposed || (event.source && event.source !== window)) return;
    const data = event.data;
    if (data?.hostId !== 'local') return;
    if (data.type === 'mcp-response') {
      const rpc = data.message ?? data.response;
      const request = pending;
      if (!request || rpc?.id !== request.id || !finish(request)) return;
      if (!rpc.error) accept(rpc.result);
    } else if (data.type === 'mcp-notification') {
      const notification = data.method ? data : data.notification;
      if (notification?.method === 'account/updated') invalidate();
      if (notification?.method === 'account/rateLimits/updated') {
        const limits = notification.params?.rateLimits;
        if (limits?.limitId && limits.limitId !== 'codex') return;
        cancel();
        accept(notification.params);
        nextRead = Date.now() + POLL_MS;
      }
    } else if (data.type === 'codex-app-server-connection-changed') {
      invalidate();
    }
  }
  function read(active = true) {
    if (disposed) return null;
    if (active !== enabled) {
      enabled = active;
      if (enabled) window.addEventListener('message', receive);
      else {
        window.removeEventListener('message', receive);
        invalidate();
      }
    }
    if (!enabled) return null;
    const now = Date.now();
    if (!pending && now >= nextRead) {
      nextRead = now + POLL_MS;
      if (typeof host.electronBridge?.sendMessageFromView === 'function') {
        const request = { id: `buddy-usage:${crypto.randomUUID()}`, timer: null };
        pending = request;
        request.timer = setTimeout(() => cancel(), TIMEOUT_MS);
        try {
          Promise.resolve(
            send({
              type: 'mcp-request',
              hostId: 'local',
              request: { id: request.id, method: 'account/rateLimits/read', params: {} },
            }),
          ).catch(() => finish(request));
        } catch {
          finish(request);
        }
      }
    }
    if (!cache || now - updatedAt > MAX_AGE_MS) return null;
    const current = cache.filter((item) => item.resetsAt === null || item.resetsAt * 1000 > now);
    return current.length ? current.map((item) => ({ ...item })) : null;
  }
  function dispose() {
    read(false);
    disposed = true;
    if (window[KEY] === api) delete window[KEY];
  }
  const api = { read, dispose };
  window[KEY] = api;
})();
