import { tr } from '../shared/i18n.js';
/* [INPUT]: Local MCP notifications and the unique current Codex composer.
 * [OUTPUT]: Identity-checked follow-up drafts from current calls or a fresh catalog reply, with composer focus.
 * [POS]: Host adapter; no remote requests, reply consumption, submission or timers.
 * [PROTOCOL]: Keep ui/codex/AGENTS.md and runtime/AGENTS.md in sync. */
import { createBotTracker } from './bots-state.js';
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';

/** @param {{getTarget?:()=>any, isEnabled?:()=>boolean}} options */
export function installBots({
  getTarget = () => window.__palbooModelControl?.inputTarget(),
  isEnabled = () => true,
} = {}) {
  window.__palbooBots?.destroy();
  const tracker = createBotTracker();
  const life = new AbortController();
  let catalog = { bots: [], revision: '', stale: true, error: tr('正在同步 Grok Bot…') };
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
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
        sidebar: catalog.sidebar,
        sidebarError: catalog.sidebarError,
      },
    };
  }
  function fill(input) {
    const next = current();
    if (!next || input.token !== token || input.threadId !== next.id)
      return { ok: false, message: tr('聊天或输入框已变化，请重新选择 Bot。') };
    if (
      !nonempty(catalog.account) ||
      !nonempty(catalog.revision) ||
      !nonempty(input.botId) ||
      !nonempty(input.agent) ||
      !catalog.bots.some(
        (b) =>
          b?.name === input.agent &&
          b.id === input.botId &&
          b.available === true &&
          b.hidden !== true,
      ) ||
      catalog.stale !== false ||
      input.revision !== catalog.revision ||
      !['ask', 'followup', 'check', 'stop'].includes(input.action)
    )
      return { ok: false, message: tr('Bot 操作无效。') };
    const state = tracker.snapshot(next.id).find((b) => b.name === input.agent);
    if (state.occupied)
      return { ok: false, message: tr('另一条聊天正在调用此 Bot，请先在原聊天确认进度。') };
    // A recent Grok reply survives host reloads; it does not prove a call belongs to this chat.
    const replyFollowup =
      input.action === 'followup' && !state.current && !input.key && nonempty(state.preview);
    if (
      input.action !== 'ask' &&
      !replyFollowup &&
      (!state.current || input.key !== state.current.key)
    )
      return { ok: false, message: tr('调用记录已变化，请刷新后重试。') };
    if (
      input.action === 'followup' &&
      !replyFollowup &&
      !['finished', 'interrupted'].includes(state.current.status)
    )
      return {
        ok: false,
        message: tr('此调用暂时无法追问，请先在主聊天确认状态。'),
      };
    if (input.action === 'stop' && !['calling', 'running'].includes(state.current.status))
      return { ok: false, message: tr('此调用当前没有可停止的任务。') };
    const prompt =
      input.action === 'stop'
        ? tr('停止「{{agent}}」在本聊天中的任务。', { agent: input.agent })
        : input.action === 'check'
          ? tr('查看「{{agent}}」的进度。', { agent: input.agent })
          : input.action === 'followup'
            ? replyFollowup
              ? tr('追问「{{agent}}」：', { agent: input.agent })
              : tr('追问「{{agent}}」，沿用本聊天中对该 Bot 的上一次调用和上下文，不要新建会话：', {
                  agent: input.agent,
                })
            : tr('请问「{{agent}}」：', { agent: input.agent });
    const editor = next.composer;
    if (editor.matches(':disabled,[readonly],[aria-disabled="true"]'))
      return { ok: false, message: tr('Codex 输入框暂时不可编辑。') };
    const textInput = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement;
    if (!textInput && !editor.isContentEditable)
      return { ok: false, message: tr('无法确认可编辑的 Codex 输入框。') };
    editor.focus();
    // Focusing the host can change its active chat or replace the editor.
    if (current()?.composer !== editor || input.token !== token || input.threadId !== target?.id)
      return { ok: false, message: tr('聊天或输入框已变化，请重新选择 Bot。') };
    const existing = rawComposerText(editor);
    // Repeated clicks do not duplicate the routing sentence or change a draft.
    if (!existing.includes(prompt)) {
      const addition = `${existing && !/[\r\n]$/.test(existing) ? '\n' : ''}${prompt}`;
      if (textInput) {
        setNativeValue(editor, existing + addition);
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
        );
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        setEditableText(editor, addition, !!existing);
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
        );
      }
    }
    // Also restore the insertion point on repeated clicks and insertText fallbacks.
    if (textInput) editor.setSelectionRange(editor.value.length, editor.value.length);
    else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return { ok: true };
  }
  const api = {
    read,
    fill,
    setCatalog(next) {
      if (disposed || !isEnabled()) return;
      if (!next || next.version !== 1 || !Array.isArray(next.bots)) return;
      if (
        next.bots.some(
          (b) => !b || !nonempty(b.id) || !nonempty(b.name) || typeof b.available !== 'boolean',
        )
      ) {
        next = { version: 1, bots: [], stale: true, error: tr('Bot 资料不完整，请检查接入。') };
      }
      if (catalog.account !== next.account) {
        tracker.clear();
        target = null;
        token = '';
      }
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
