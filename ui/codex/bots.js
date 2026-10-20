/* [INPUT]: Local MCP notifications and the unique current Codex composer.
 * [OUTPUT]: PALBOO Bot projection and identity-checked append-only composer actions.
 * [POS]: Host adapter; no remote requests, reply consumption, submission or timers.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md and runtime/AGENTS.md in sync. */
import { createBotTracker } from './bots-state.js';
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';

/** @param {{getTarget?:()=>any, isEnabled?:()=>boolean}} options */
export function installBots({
  getTarget = () => window.__codexBuddyModelControl?.inputTarget(),
  isEnabled = () => true,
} = {}) {
  window.__palbooBots?.destroy();
  const tracker = createBotTracker();
  const life = new AbortController();
  let catalog = { bots: [], revision: '', stale: true, error: '正在同步 Grok Bot…' };
  let target = null,
    token = '',
    disposed = false;
  function current() {
    const next = !disposed && isEnabled() ? getTarget() : null;
    if (!next?.id || !next.composer?.isConnected || !next.scope?.isConnected) {
      target = null;
      token = '';
      return null;
    }
    if (
      target?.id !== next.id ||
      target?.composer !== next.composer ||
      target?.scope !== next.scope
    )
      token = crypto.randomUUID();
    target = next;
    return next;
  }
  function read() {
    const next = current();
    return {
      target: next ? { threadId: next.id, token } : null,
      bots: tracker.snapshot(next?.id),
      catalog: {
        revision: catalog.revision,
        stale: catalog.stale,
        error: catalog.error,
        updatedAt: catalog.updatedAt,
      },
    };
  }
  function fill(input) {
    const next = current();
    if (!next || input.token !== token || input.threadId !== next.id)
      return { ok: false, message: '聊天或输入框已变化，请重新选择 Bot。' };
    if (
      !catalog.bots.some((b) => b.name === input.agent && b.id === input.botId && b.available) ||
      catalog.stale ||
      input.revision !== catalog.revision ||
      !['ask', 'followup', 'check', 'stop'].includes(input.action)
    )
      return { ok: false, message: 'Bot 操作无效。' };
    const state = tracker.snapshot(next.id).find((b) => b.name === input.agent);
    if (state.occupied)
      return { ok: false, message: '另一条聊天正在调用此 Bot，请先在原聊天确认进度。' };
    if (input.action !== 'ask' && (!state.current || input.key !== state.current.key))
      return { ok: false, message: '调用记录已变化，请刷新后重试。' };
    if (input.action === 'stop' && !['calling', 'running'].includes(state.current.status))
      return { ok: false, message: '此调用当前没有可停止的任务。' };
    const prompt =
      input.action === 'stop'
        ? `停止「${input.agent}」在本聊天中的任务。`
        : input.action === 'check'
          ? `查看「${input.agent}」的进度。`
          : input.action === 'followup'
            ? `追问「${input.agent}」：`
            : `请问「${input.agent}」：`;
    const editor = next.composer;
    if (editor.matches(':disabled,[readonly],[aria-disabled="true"]'))
      return { ok: false, message: 'Codex 输入框暂时不可编辑。' };
    const existing = rawComposerText(editor);
    // Repeated clicks do not duplicate the routing sentence or change a draft.
    if (!existing.includes(prompt)) {
      const addition = `${existing && !/[\r\n]$/.test(existing) ? '\n' : ''}${prompt}`;
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        setNativeValue(editor, existing + addition);
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
        );
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (editor.isContentEditable) {
        setEditableText(editor, addition, !!existing);
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
        );
      } else return { ok: false, message: '无法确认可编辑的 Codex 输入框。' };
    }
    editor.focus();
    return { ok: true };
  }
  const api = {
    read,
    fill,
    setCatalog(next) {
      if (disposed || !isEnabled()) return;
      if (!next || next.version !== 1 || !Array.isArray(next.bots)) return;
      if (catalog.account !== next.account) tracker.clear();
      catalog = next;
      tracker.setCatalog(next.bots);
    },
    destroy() {
      disposed = true;
      life.abort();
      tracker.clear();
      target = null;
      token = '';
      if (window.__palbooBots === api) delete window.__palbooBots;
    },
  };
  window.addEventListener(
    'message',
    (event) => {
      if (disposed || !isEnabled() || (event.source && event.source !== window)) return;
      const d = event.data;
      if (d?.type === 'codex-app-server-connection-changed' && d.hostId === 'local')
        tracker.disconnect();
      if (d?.type !== 'mcp-notification') return;
      const notification = d.method ? d : d.notification;
      tracker.receive(d.hostId, notification?.method, notification?.params);
    },
    { signal: life.signal },
  );
  window.__palbooBots = api;
  return api;
}
