/* [INPUT]: Local MCP notifications and the unique current Codex composer.
 * [OUTPUT]: Palboo Bot projection and identity-checked append-only composer actions.
 * [POS]: Host adapter; no remote requests, reply consumption, submission or timers.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md and runtime/AGENTS.md in sync. */
import { BOT_NAMES, createBotTracker } from './bots-state.js';
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';

/** @param {{getTarget?:()=>any, isEnabled?:()=>boolean}} options */
export function installBots({
  getTarget = () => window.__codexBuddyModelControl?.inputTarget(),
  isEnabled = () => true,
} = {}) {
  window.__palbooBots?.destroy();
  const tracker = createBotTracker();
  const life = new AbortController();
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
    };
  }
  function fill(input) {
    const next = current();
    if (!next || input.token !== token || input.threadId !== next.id)
      return { ok: false, message: '聊天或输入框已变化，请重新选择 Bot。' };
    if (
      !BOT_NAMES.includes(input.agent) ||
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
    const reference = state.current
      ? `（聊天 ${state.current.threadId}，轮次 ${state.current.turnId}，调用 ${state.current.itemId}）`
      : '';
    const prompt =
      input.action === 'stop'
        ? `请通过 grokbot MCP 核对此聊天中「${input.agent}」的在途任务${reference}，确认仍属于本次调用后停止它，不要停止其他聊天的任务。`
        : input.action === 'check'
          ? `请通过 grokbot MCP 的 grokbot__check 查询已有的「${input.agent}」Bot 在此聊天中的任务进度${reference}，不要重新发送任务，也不要新建 Bot。`
          : input.action === 'followup'
            ? `请继续通过 grokbot MCP 追问已有的「${input.agent}」Bot，沿用它的会话；不要新建 Bot。我的追问：`
            : `请通过 grokbot MCP 调用我已有的「${input.agent}」Bot，不要新建 Bot。请结合我在本条消息中提供的内容与当前聊天必要的上下文：`;
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
