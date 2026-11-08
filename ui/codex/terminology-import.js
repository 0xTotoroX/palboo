/* [INPUT]: Explicit user send events, unique current composer and authenticated terminology queue.
 * [OUTPUT]: One append-only handoff per unchanged send intent; IME/edits cancel replay and release unappended tasks.
 * [POS]: Host adapter, no background model calls or Agent configuration changes.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { rawComposerText, setEditableText, setNativeValue } from './composer.js';
import { nearbySubmitButton, composerBusy } from './context.js';

export function installTerminologyImports({
  request,
  getTarget = () => window.__palbooModelControl?.inputTarget(),
  isEnabled = () => true,
  getSubmit = nearbySubmitButton,
  isBusy = composerBusy,
}) {
  window.__palbooTerminologyImports?.destroy();
  const life = new AbortController();
  const editing = new WeakMap();
  let disposed = false,
    working = null,
    replaying = false,
    appending = null;
  const editorState = (editor) => {
    if (!editing.has(editor)) editing.set(editor, { revision: 0, composing: false });
    return editing.get(editor);
  };
  const signature = (el) => ('value' in el ? el.value : el.innerHTML);
  const same = (intent) => {
    const next = getTarget();
    return (
      !disposed &&
      isEnabled() &&
      intent.target.composer.isConnected &&
      next?.id === intent.target.id &&
      next.composer === intent.target.composer &&
      next.scope === intent.target.scope &&
      location.href === intent.route
    );
  };
  const ready = (intent) =>
    same(intent) &&
    !editorState(intent.target.composer).composing &&
    editorState(intent.target.composer).revision === intent.revision &&
    !isBusy(intent.target.composer) &&
    !intent.target.composer.matches(':disabled,[readonly],[aria-disabled="true"]');
  function trackEditing(event) {
    const editor =
      event.composedPath().find((node) => editing.has(node)) ||
      [working?.target.composer, getTarget()?.composer].find((candidate) =>
        candidate?.contains(event.target),
      );
    if (!editor) return;
    const state = editorState(editor);
    if (event.type === 'compositionstart') state.composing = true;
    else if (event.type === 'compositionend') state.composing = false;
    else if (appending === editor) return;
    // 开始组合输入或改后还原也会撤销旧发送；自己的追加输入不算新的用户编辑。
    state.revision++;
    if (working?.target.composer === editor) {
      const intent = working;
      working = null;
      intent.interrupt?.();
    }
  }
  function resume(intent) {
    const button = getSubmit(intent.target.composer);
    if (
      !ready(intent) ||
      signature(intent.target.composer) !== intent.signature ||
      !button?.isConnected ||
      button.matches(':disabled,[aria-disabled="true"]')
    )
      return false;
    replaying = true;
    try {
      button.click();
    } finally {
      replaying = false;
    }
    return true;
  }
  async function handoff(intent) {
    let batch = null,
      appended = false,
      expired = false,
      timer = 0,
      interrupt;
    const release = (value) =>
      value?.tasks?.length &&
      request('/terminology', { action: 'release-import', tasks: value.tasks }).catch(() => {});
    try {
      const prepared = request('/terminology', {
        action: 'prepare-import',
        token: intent.token,
        target: intent.target.id,
      });
      void prepared
        .then((value) => {
          if (expired) release(value);
        })
        .catch(() => {});
      const interrupted = new Promise((_, reject) => {
        interrupt = () => {
          expired = true;
          reject(Error('交接已取消'));
        };
        intent.interrupt = interrupt;
        life.signal.addEventListener('abort', interrupt, { once: true });
        timer = window.setTimeout(interrupt, 2000);
      });
      batch = await Promise.race([prepared, interrupted]);
      if (!ready(intent) || signature(intent.target.composer) !== intent.signature) return;
      if (!batch?.tasks?.length) {
        resume(intent);
        return;
      }
      const editor = intent.target.composer;
      const existing = rawComposerText(editor);
      const addition = `\n\n${batch.prompt}`;
      editor.focus();
      if (!ready(intent) || signature(editor) !== intent.signature) return;
      appending = editor;
      try {
        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
          setNativeValue(editor, existing + addition);
        } else if (editor.isContentEditable) {
          setEditableText(editor, addition, true);
        } else return;
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
        );
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } finally {
        appending = null;
      }
      appended = rawComposerText(editor).includes(batch.prompt);
      if (!appended) return;
      intent.signature = signature(editor);
      // Let the official composer update its send button; never force a disabled control.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      resume(intent);
    } catch {
      // Queue/connectivity failure must not swallow an unchanged user send.
      if (!appended) resume(intent);
    } finally {
      clearTimeout(timer);
      life.signal.removeEventListener('abort', interrupt);
      delete intent.interrupt;
      if (!appended) release(batch);
      if (working === intent) working = null;
    }
  }
  function send(event) {
    if (disposed || replaying || !isEnabled() || event.defaultPrevented) return;
    const target = getTarget();
    const editor = target?.composer;
    if (
      !target?.id ||
      !editor?.isConnected ||
      !target.scope?.isConnected ||
      editorState(editor).composing ||
      isBusy(editor)
    )
      return;
    if (event.type === 'keydown') {
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.keyCode === 229 ||
        !editor.contains(event.target)
      )
        return;
    } else {
      const button = getSubmit(editor);
      if (!button || !button.contains(event.target)) return;
    }
    const button = getSubmit(editor);
    if (
      !button ||
      button.matches(':disabled,[aria-disabled="true"]') ||
      !rawComposerText(editor).trim()
    )
      return;
    // A failed official submit leaves the visible task in the draft for the user's retry.
    if (rawComposerText(editor).includes('[Palboo 术语任务：')) {
      // 手动重试接管这次发送，撤销仍在等待下一帧的旧自动重放。
      if (working?.target.composer === editor) {
        editorState(editor).revision++;
        const intent = working;
        working = null;
        intent.interrupt?.();
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (working) return;
    working = {
      target,
      signature: signature(editor),
      revision: editorState(editor).revision,
      route: location.href,
      token: crypto.randomUUID(),
    };
    void handoff(working);
  }
  const api = {
    verify(token, target) {
      return (
        !!working &&
        working.token === token &&
        working.target.id === target &&
        ready(working) &&
        signature(working.target.composer) === working.signature
      );
    },
    destroy() {
      disposed = true;
      life.abort();
      if (window.__palbooTerminologyImports === api) delete window.__palbooTerminologyImports;
    },
  };
  window.addEventListener('keydown', send, { capture: true, signal: life.signal });
  window.addEventListener('click', send, { capture: true, signal: life.signal });
  for (const type of ['compositionstart', 'compositionend', 'beforeinput', 'input', 'change']) {
    window.addEventListener(type, trackEditing, { capture: true, signal: life.signal });
  }
  window.__palbooTerminologyImports = api;
  return api;
}
