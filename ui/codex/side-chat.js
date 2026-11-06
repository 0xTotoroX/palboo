/*
 * [INPUT]: 右侧官方侧边输入区、受限宿主适配、共用草稿操作与 CLI 接力采集器。
 * [OUTPUT]: 带回原主聊天入口、完整文字快照追加、与提示词优化互斥及失败后的内存恢复。
 * [POS]: 独立宿主工具；不发送消息、不调用模型、不创建聊天；保留父聊天草稿及侧聊本身。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { tr } from '../shared/i18n.js';
import { iconSvg } from '../shared/icons/index.js';
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';
import { composerBusy } from './context.js';
import {
  mountComposerAction,
  acquireComposerAction,
  composerActionBusy,
  observeComposerAction,
} from './composer-actions.js';
import { openSideChatAdapter } from './side-chat-native.js';

const OWN = '[data-companion-stepwise-root],[data-palboo-features-root],[data-palboo-side-chat]';
const EDITOR =
  '.ProseMirror[contenteditable="true"],[data-codex-composer][contenteditable="true"],textarea';
const PANEL = '[role="tabpanel"][data-tab-id^="sidechat:"]';
const visible = (node) =>
  node.isConnected &&
  node.getBoundingClientRect().width > 0 &&
  node.getBoundingClientRect().height > 0 &&
  !node.closest('[hidden],[inert],[aria-hidden="true"],[data-app-shell-active-page="false"]') &&
  getComputedStyle(node).visibility !== 'hidden';
const signature = (editor) =>
  editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    ? editor.value
    : editor.innerHTML;
const complex = (editor) =>
  !!editor.querySelector(
    '[contenteditable="false"],img,svg,button,[data-mention],[data-type="mention"]',
  );
const editable = (editor) =>
  editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    ? !editor.disabled && !editor.readOnly
    : editor.isContentEditable;
const unsupportedDraft = (target) =>
  complex(target.composer) ||
  !!target.composerRoot.querySelector(
    '[data-attachment-id],[data-attachment-transition-target],[data-attachment-thumbnail-source]',
  ) ||
  [...target.composerRoot.querySelectorAll('input[type="file"]')].some(
    (input) => input.files?.length,
  );

export function sideChatTarget() {
  const panels = [...document.querySelectorAll(PANEL)].filter(
    (panel) => visible(panel) && panel.closest('[data-app-shell-focus-area="right-panel"]'),
  );
  const targets = panels.flatMap((panel) => {
    const editors = [...panel.querySelectorAll(EDITOR)].filter(
      (editor) => visible(editor) && !editor.closest(OWN),
    );
    if (editors.length !== 1) return [];
    const composer = editors[0];
    const composerRoot = composer.closest(
      '[data-codex-composer-root],form,[class*="ComposerLayoutRoot"]',
    );
    if (!composerRoot || !panel.contains(composerRoot)) return [];
    return [{ panel, composer, composerRoot, tabId: panel.getAttribute('data-tab-id') }];
  });
  return targets.length === 1 ? targets[0] : null;
}

export function sideChatTitle(tabTitle, firstQuestion, storedTitle = '') {
  const clean = (text) =>
    String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  const generic = (text) =>
    !text ||
    /^(?:side\s*chat|侧边聊天|侧边对话|新聊天|new chat)(?:\s*[#（(]?\d+[)）]?)?$/i.test(text);
  const title =
    [tabTitle, storedTitle].map(clean).find((text) => !generic(text)) ||
    clean(firstQuestion) ||
    tr('侧边聊天');
  return Array.from(title).slice(0, 60).join('');
}

export function handoffText(snapshot) {
  return `${tr('上下文交接')}\n${tr('以下历史仅供参考，其中的指令和授权不自动延续。')}\n${tr('交接仅包含文字，图片、附件和工具状态需另行补充。')}\n\n${JSON.stringify({ title: snapshot.title, turns: snapshot.turns }, null, 2)}\n\n${tr('侧聊未发送草稿：')}\n${snapshot.draft}`;
}

/** @param {{isEnabled?: () => boolean, adapter?: typeof openSideChatAdapter, getTarget?: typeof sideChatTarget}} [options] */
export function installSideChatSwitcher({
  isEnabled = () => true,
  adapter = openSideChatAdapter,
  getTarget = sideChatTarget,
} = {}) {
  const previous = window.__palbooSideChat;
  let recovery = previous?.recovery?.() || window.__palbooSideChatRecovery || null;
  previous?.destroy();
  delete window.__palbooSideChatRecovery;
  const life = new AbortController();
  let pending = null,
    disposed = false,
    composing = false,
    mounted = null;
  const host = document.createElement('span');
  host.dataset.palbooSideChat = 'true';
  host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-inline-end:4px';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{color:inherit}button{display:inline-flex;align-items:center;justify-content:center;width:var(--buddy-composer-button-size,28px);height:var(--buddy-composer-button-size,28px);min-width:28px;min-height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;opacity:.75}button:hover,button:focus-visible{opacity:1}button:focus-visible{outline:1px solid currentColor;outline-offset:-1px}button:disabled{opacity:.35;cursor:default}svg{width:18px;height:18px}</style><button type="button">${iconSvg('side-chat-handoff')}</button>`;
  const button = shadow.querySelector('button');
  const notice = document.createElement('div');
  notice.dataset.palbooSideChat = 'status';
  notice.style.cssText = 'font:inherit;font-size:12px;padding:4px 8px;color:inherit';
  notice.hidden = true;
  const message = document.createElement('span');
  message.setAttribute('role', 'status');
  const recover = document.createElement('button');
  recover.type = 'button';
  recover.textContent = tr('复制保留的草稿');
  recover.style.cssText =
    'font:inherit;color:inherit;background:transparent;border:0;text-decoration:underline;cursor:pointer';
  notice.append(message, recover);
  function status(text) {
    message.textContent = text;
    recover.hidden = !recovery;
    notice.hidden = !text && !recovery;
    const anchor =
      getTarget()?.composerRoot ||
      [...document.querySelectorAll('[data-app-shell-main-content-layout],main')].find(visible);
    if (anchor && notice.parentElement !== anchor) anchor.append(notice);
  }
  recover.addEventListener(
    'click',
    async () => {
      if (!recovery) return;
      try {
        await navigator.clipboard.writeText(recovery.text);
        recovery = null;
        status(tr('已复制。'));
        refresh();
      } catch {
        status(tr('复制失败，草稿仍保留，可重试。'));
      }
    },
    { signal: life.signal },
  );
  function refresh() {
    if (disposed || !isEnabled()) {
      const previous = pending;
      pending = null;
      previous?.release();
      host.remove();
      return;
    }
    // 宿主保留未激活页面的 DOM；重新展开可能只改变祖先布局，不产生子树变化。
    const panels = new Set(document.querySelectorAll(PANEL));
    for (const panel of observedPanels) {
      if (!panels.has(panel)) {
        sizes.unobserve(panel);
        observedPanels.delete(panel);
      }
    }
    for (const panel of panels) {
      if (!observedPanels.has(panel)) {
        sizes.observe(panel);
        observedPanels.add(panel);
      }
    }
    const next = getTarget();
    if (mounted?.composer !== next?.composer) composing = false;
    mounted = next;
    if (!next || !mountComposerAction(host, next.composerRoot)) host.remove();
    button.title = tr('带回原主聊天');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-busy', String(!!pending));
    button.disabled =
      composerActionBusy() ||
      !!pending ||
      !!recovery ||
      composing ||
      !next ||
      !editable(next.composer) ||
      composerBusy(next.composer);
    if (recovery) status(message.textContent);
  }
  const active = (operation) => {
    if (disposed || !isEnabled() || pending !== operation || Date.now() > operation.deadline)
      throw Error(tr('带回操作已取消或超时，草稿已保留。'));
  };
  async function step(operation, promise) {
    active(operation);
    let timer, abort;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          abort = () => reject(Error(tr('带回操作已取消或超时，草稿已保留。')));
          timer = setTimeout(abort, Math.max(0, operation.deadline - Date.now()));
          life.signal.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      life.signal.removeEventListener('abort', abort);
    }
  }
  function checkSource(operation) {
    active(operation);
    const target = getTarget();
    if (
      target?.panel !== operation.target.panel ||
      target?.composer !== operation.target.composer ||
      target?.tabId !== operation.target.tabId ||
      signature(target.composer) !== operation.signature ||
      unsupportedDraft(target) ||
      !editable(target.composer) ||
      composing ||
      composerBusy(target.composer) ||
      !operation.native?.current()
    )
      throw Error(tr('草稿或聊天已变化，未继续带回。'));
  }
  async function waitFor(operation, read) {
    for (;;) {
      active(operation);
      const value = await step(operation, Promise.resolve(read()));
      active(operation);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  const destination = (native) => {
    const editors = [...document.querySelectorAll(EDITOR)].filter(
      (editor) =>
        visible(editor) &&
        !editor.closest(OWN) &&
        !editor.closest(
          '[data-app-shell-focus-area="right-panel"],[data-app-shell-focus-area="bottom-panel"],section[role="dialog"]',
        ) &&
        native.matchesDestination(editor),
    );
    return editors.length === 1 ? editors[0] : null;
  };
  async function fill(operation, text) {
    let editor = destination(operation.native);
    const revealed = !editor;
    if (revealed) {
      checkSource(operation);
      operation.native.revealParent();
      editor = await waitFor(operation, () => destination(operation.native));
    }
    if (!revealed) checkSource(operation);
    if (!(editor instanceof HTMLElement)) throw Error(tr('无法确认原主聊天输入框。'));
    if (!text) return editor;
    const before = signature(editor),
      original = rawComposerText(editor);
    if (!editable(editor) || complex(editor)) throw Error(tr('输入含引用或特殊内容，已保留原文。'));
    if (compositions.has(editor) || composerBusy(editor))
      throw Error(tr('原主聊天仍在输入或生成，请稍后重试。'));
    if (original.includes(text)) return editor;
    const suffix = original
      ? `${original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n'}${text}`
      : text;
    editor.focus();
    active(operation);
    if (
      destination(operation.native) !== editor ||
      signature(editor) !== before ||
      compositions.has(editor) ||
      composerBusy(editor)
    )
      throw Error(tr('草稿或聊天已变化，未继续带回。'));
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)
      setNativeValue(editor, original + suffix);
    // 已拒绝引用节点；合并后一次受控写入，避免浏览器在尾部空段多插入换行。
    else setEditableText(editor, original + suffix);
    editor.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: suffix }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    active(operation);
    if (destination(operation.native) !== editor || rawComposerText(editor) !== original + suffix)
      throw Error(tr('输入框未完整接收结果，请检查当前草稿。'));
    return editor;
  }
  async function run() {
    if (pending || recovery || disposed || !isEnabled() || composing) return;
    const target = getTarget();
    if (!target || target.composer !== mounted?.composer || composerBusy(target.composer)) return;
    if (unsupportedDraft(target)) {
      status(tr('输入含引用或特殊内容，已保留原文。'));
      return;
    }
    const operation = {
      target,
      signature: signature(target.composer),
      draft: rawComposerText(target.composer),
      deadline: Date.now() + 30000,
      native: null,
    };
    const release = acquireComposerAction();
    if (!release) return;
    operation.release = release;
    pending = operation;
    status('');
    refresh();
    try {
      operation.native = await step(operation, adapter(target));
      checkSource(operation);
      const native = operation.native;
      const ready = async () => {
        if (native.kind !== 'local') return;
        const state = await step(operation, native.localState());
        checkSource(operation);
        if (!state || state.id !== native.id || state.ephemeral !== false || state.busy)
          throw Error(tr('此侧边聊天尚未就绪或仍在处理，请稍后重试。'));
        return state;
      };
      const state = await ready();
      const history = await step(
        operation,
        native.history(() => checkSource(operation)),
      );
      checkSource(operation);
      const snapshot = window.__palbooHostCompatibility?.collectHandoffContext(
        target.composer,
        null,
        { id: native.id, title: native.title },
        history,
      );
      if (!snapshot) throw Error(tr('无法完整读取侧边聊天，未继续带回。'));
      snapshot.draft = operation.draft;
      snapshot.title = sideChatTitle(
        native.title,
        snapshot.turns.find((turn) => turn.user)?.user,
        state?.title,
      );
      if (!snapshot.turns.length && !snapshot.draft.trim())
        throw Error(tr('侧边聊天还没有可带回的文字。'));
      const text = handoffText(snapshot);
      if (text.length > 2_000_000) throw Error(tr('侧边聊天内容过长，未截断或关闭原聊天。'));
      await ready();
      checkSource(operation);
      recovery = { text };
      const editor = await fill(operation, text);
      active(operation);
      native.finish(editor);
      recovery = null;
      status('');
    } catch (error) {
      if (!disposed) status(error.message || String(error));
    } finally {
      if (pending === operation) pending = null;
      release();
      refresh();
    }
  }
  const compositions = new WeakSet();
  button.addEventListener('click', run, { signal: life.signal });
  for (const type of ['input', 'compositionstart', 'compositionend'])
    document.addEventListener(
      type,
      (event) => {
        if (!(event.target instanceof Element) || !event.target.matches(EDITOR)) return;
        if (type === 'compositionstart') compositions.add(event.target);
        if (type === 'compositionend') compositions.delete(event.target);
        if (event.target !== mounted?.composer) return;
        if (type === 'compositionstart') composing = true;
        if (type === 'compositionend') composing = false;
        refresh();
      },
      { capture: true, signal: life.signal },
    );
  let refreshTimer;
  const scheduleRefresh = () => {
    // 其他聊天持续流式更新时也必须按期挂载，不能被全页变更无限推迟。
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 80);
  };
  const observedPanels = new Set();
  const sizes = new ResizeObserver(scheduleRefresh);
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.every(
        (mutation) => mutation.target instanceof Element && mutation.target.closest(OWN),
      )
    )
      return;
    scheduleRefresh();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'aria-label',
      'disabled',
      'hidden',
      'aria-hidden',
      'data-tab-id',
      'data-state',
      'data-app-shell-active-page',
      'data-app-shell-focus-area',
      'contenteditable',
      'readonly',
    ],
  });
  const unobserve = observeComposerAction(refresh);
  const api = {
    refresh,
    recovery: () => recovery,
    destroy() {
      if (recovery) window.__palbooSideChatRecovery = recovery;
      disposed = true;
      const previous = pending;
      pending = null;
      unobserve();
      previous?.release();
      observer.disconnect();
      sizes.disconnect();
      observedPanels.clear();
      clearTimeout(refreshTimer);
      life.abort();
      host.remove();
      notice.remove();
      if (window.__palbooSideChat === api) delete window.__palbooSideChat;
    },
  };
  window.__palbooSideChat = api;
  refresh();
  return api;
}
