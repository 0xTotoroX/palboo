/* [INPUT]: Explicit user send events, unique current composer and authenticated terminology queue.
 * [OUTPUT]: One append-only next-chat handoff; stale/edited composers are never submitted.
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
  let disposed = false,
    working = null,
    replaying = false;
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
    !isBusy(intent.target.composer) &&
    !intent.target.composer.matches(':disabled,[readonly],[aria-disabled="true"]');
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
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        setNativeValue(editor, existing + addition);
      } else if (editor.isContentEditable) {
        setEditableText(editor, addition, true);
      } else return;
      editor.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }),
      );
      editor.dispatchEvent(new Event('change', { bubbles: true }));
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
      if (!appended) release(batch);
      if (working === intent) working = null;
    }
  }
  function send(event) {
    if (disposed || replaying || !isEnabled() || event.defaultPrevented) return;
    const target = getTarget();
    const editor = target?.composer;
    if (!target?.id || !editor?.isConnected || !target.scope?.isConnected || isBusy(editor)) return;
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
    if (rawComposerText(editor).includes('[Palboo 术语任务：')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (working) return;
    working = {
      target,
      signature: signature(editor),
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
  window.__palbooTerminologyImports = api;
  return api;
}
