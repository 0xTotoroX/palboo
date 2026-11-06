import { tr } from '../shared/i18n.js';
import { measureWork } from '../shared/performance.js';
/* [INPUT]: Verified input target, shared right-side composer mount, explicit clicks and restricted model bridge.
 * [OUTPUT]: Optimize/cancel/restore controls; serialized with side-chat handoff, compare-before-write replacement, never send.
 * [POS]: Composer adapter; keeps only a temporary draft backup and no conversation history.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';
import { iconSvg } from '../shared/icons/index.js';
import {
  mountComposerAction,
  acquireComposerAction,
  composerActionBusy,
  observeComposerAction,
} from './composer-actions.js';

/** @param {{request:(path:string,payload:object)=>Promise<any>, getTarget?:()=>any, isEnabled?:()=>boolean}} options */
export function installPromptEnhancer({
  request,
  isEnabled = () => true,
  getTarget = () => window.__palbooModelControl?.inputTarget(),
}) {
  window.__palbooPromptEnhancer?.destroy();
  const life = new AbortController();
  let mounted = null,
    pending = null,
    undo = null,
    disposed = false,
    applying = false;
  let composing = false;
  const host = document.createElement('span');
  host.dataset.palbooPrompt = 'true';
  host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-inline-end:4px;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{color:inherit}button{font:inherit;display:inline-flex;align-items:center;justify-content:center;width:var(--buddy-composer-button-size,28px);height:var(--buddy-composer-button-size,28px);padding:0;border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer;opacity:.75}
    button:hover,button:focus-visible{opacity:1}button:focus-visible{outline:1px solid currentColor;outline-offset:-1px}button:disabled{opacity:.35;cursor:default}svg{width:18px;height:18px;display:block}
  </style><button type="button" aria-label="${tr('优化提示词')}">${iconSvg('prompt-improve')}</button>`;
  const button = shadow.querySelector('button');
  const message = document.createElement('div');
  message.dataset.palbooPrompt = 'true';
  message.setAttribute('role', 'status');
  message.style.cssText = 'font-size:12px;line-height:1.5;padding:4px 8px;color:inherit;';
  message.hidden = true;
  const status = (text) => {
    message.textContent = text;
    message.hidden = !text;
  };
  const signature = (editor) =>
    editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
      ? editor.value
      : editor.innerHTML;
  const editable = (editor) =>
    editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
      ? !editor.disabled && !editor.readOnly
      : editor?.isContentEditable;
  const complex = (editor) =>
    !!editor.querySelector?.(
      '[contenteditable="false"],img,svg,button,[data-mention],[data-type="mention"]',
    );
  function sameTarget(snapshot) {
    const target = getTarget();
    return (
      !disposed &&
      isEnabled() &&
      target?.id === snapshot.id &&
      target?.composer === snapshot.editor &&
      target?.root === snapshot.root &&
      snapshot.editor.isConnected &&
      location.pathname === snapshot.route &&
      editable(snapshot.editor)
    );
  }
  function matches(snapshot) {
    return sameTarget(snapshot) && !composing && signature(snapshot.editor) === snapshot.signature;
  }
  function cancel(text = '') {
    const previous = pending;
    pending = null;
    previous?.release();
    status(text);
    refresh();
  }
  function refresh() {
    if (!mounted) return;
    button.disabled =
      !pending &&
      (composerActionBusy() ||
        composing ||
        !editable(mounted.composer) ||
        !rawComposerText(mounted.composer)
          .replace(/\u200b/g, '')
          .trim());
    if (undo && !matches(undo)) undo = null;
    button.setAttribute(
      'aria-label',
      pending ? tr('取消优化') : undo ? tr('恢复原提示词') : tr('优化提示词'),
    );
    button.title = button.getAttribute('aria-label');
    const icon = pending ? 'close' : undo ? 'return' : 'prompt-improve';
    if (button.querySelector('svg')?.dataset.icon !== icon) button.innerHTML = iconSvg(icon);
    button.setAttribute('aria-busy', String(!!pending));
  }
  function write(snapshot, text) {
    if (!matches(snapshot)) throw Error(tr('草稿或聊天已变化，未覆盖你的输入。'));
    if (complex(snapshot.editor)) throw Error(tr('输入含引用或特殊内容，已保留原文。'));
    applying = true;
    try {
      const editor = snapshot.editor;
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)
        setNativeValue(editor, text);
      else setEditableText(editor, text);
      editor.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
      );
      if (rawComposerText(editor) !== text)
        throw Error(tr('输入框未完整接收结果，请检查当前草稿。'));
    } finally {
      applying = false;
    }
  }
  button.addEventListener('click', async () => {
    if (pending) {
      cancel();
      return;
    }
    if (undo) {
      const release = acquireComposerAction();
      if (!release) return;
      try {
        write(undo, undo.original);
        undo = null;
        status('');
      } catch (error) {
        status(String(error.message || error));
      } finally {
        release();
      }
      refresh();
      return;
    }
    if (!isEnabled()) return;
    const target = getTarget();
    if (!target || target.composer !== mounted?.composer || composing) return;
    if (complex(target.composer)) {
      status(tr('输入含引用或特殊内容，已保留原文。'));
      return;
    }
    const snapshot = {
      id: target.id,
      editor: target.composer,
      root: target.root,
      route: location.pathname,
      text: rawComposerText(target.composer),
      signature: signature(target.composer),
      requestId: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'),
    };
    if (!snapshot.text.replace(/\u200b/g, '').trim()) return;
    const release = acquireComposerAction();
    if (!release) return;
    snapshot.release = release;
    undo = null;
    pending = snapshot;
    status('');
    refresh();
    try {
      const result = await request('/prompt/enhance', {
        requestId: snapshot.requestId,
        text: snapshot.text,
      });
      if (pending !== snapshot) return;
      if (!matches(snapshot)) {
        cancel(tr('草稿或聊天已变化，未覆盖你的输入。'));
        return;
      }
      if (result.error) throw Error(result.error);
      if (typeof result.prompt !== 'string' || !result.prompt.trim())
        throw Error(tr('未收到有效的优化结果，原文未修改。'));
      if (result.prompt === snapshot.text) {
        status(tr('原文已清晰，未作修改。'));
        return;
      }
      write(snapshot, result.prompt);
      undo = { ...snapshot, signature: signature(snapshot.editor), original: snapshot.text };
      status('');
    } catch (error) {
      if (pending === snapshot) {
        // Keep a recovery copy even if the host only accepted part of the replacement.
        if (sameTarget(snapshot) && signature(snapshot.editor) !== snapshot.signature)
          undo = { ...snapshot, signature: signature(snapshot.editor), original: snapshot.text };
        status(String(error.message || error));
      }
    } finally {
      if (pending === snapshot) pending = null;
      release();
      refresh();
    }
  });
  function changed(event) {
    if (applying || !mounted || !event.composedPath().includes(mounted.composer)) return;
    if (event.type === 'compositionstart') composing = true;
    if (event.type === 'compositionend') composing = false;
    if (pending) cancel(tr('输入已变化，优化已取消。'));
    undo = null;
    refresh();
  }
  for (const type of ['input', 'compositionstart', 'compositionend'])
    document.addEventListener(type, changed, { signal: life.signal, capture: true });
  function tick() {
    return measureWork('composer', checkComposer);
  }
  function checkComposer() {
    if (document.hidden) return;
    if (!isEnabled()) {
      const previous = pending;
      pending = null;
      previous?.release();
      undo = null;
      mounted = null;
      composing = false;
      host.remove();
      message.remove();
      status('');
      return;
    }
    const target = getTarget();
    if (pending && !matches(pending)) cancel(tr('草稿或聊天已变化，优化已取消。'));
    if (undo && !matches(undo)) undo = null;
    if (!target || target.id !== mounted?.id || target.composer !== mounted?.composer) {
      host.remove();
      message.remove();
      status('');
      undo = null;
      composing = false;
      mounted = target;
    }
    if (!target) return;
    const composerRoot = target.composer.closest('[data-codex-composer-root]') || target.scope;
    if (!mountComposerAction(host, composerRoot) && host.parentElement !== composerRoot)
      composerRoot.append(host);
    if (composerRoot && message.parentElement !== composerRoot) composerRoot.append(message);
    refresh();
  }
  const timer = window.setInterval(tick, 300);
  const unobserve = observeComposerAction(refresh);
  const api = {
    verify: (requestId) => !!pending && pending.requestId === requestId && matches(pending),
    destroy() {
      disposed = true;
      const previous = pending;
      pending = null;
      unobserve();
      previous?.release();
      undo = null;
      clearInterval(timer);
      life.abort();
      host.remove();
      message.remove();
      if (window.__palbooPromptEnhancer === api) delete window.__palbooPromptEnhancer;
    },
  };
  window.__palbooPromptEnhancer = api;
  tick();
  return api;
}
