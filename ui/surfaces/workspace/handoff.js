/* [INPUT]: A live workbench, confirmed/pending main placement and native motion ownership.
 * [OUTPUT]: A reversible spatial handoff cue and accessible status, without replacing content or delaying readiness.
 * [POS]: Presentation only; leases, drafts and native window movement remain with their existing owners.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../../shared/i18n.js';

export function installHandoffMotion(root, { native = false } = {}) {
  let phase = '',
    placement = '',
    animation = null,
    destroyed = false,
    keyboard = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;pointer-events:none;';
  root.append(status);
  function cancel() {
    animation?.cancel();
    animation = null;
  }
  function animate(frames, hold = false) {
    cancel();
    if (native || keyboard || reduced.matches || document.hidden) return;
    animation = root.animate(frames, {
      duration: hold ? 180 : 220,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: hold ? 'forwards' : 'none',
    });
  }
  window.addEventListener('resize', cancel, { signal: events.signal });
  document.addEventListener(
    'keydown',
    () => {
      keyboard = true;
    },
    { capture: true, signal: events.signal },
  );
  document.addEventListener(
    'pointerdown',
    () => {
      keyboard = false;
    },
    { capture: true, signal: events.signal },
  );
  document.addEventListener('visibilitychange', cancel, { signal: events.signal });
  reduced.addEventListener('change', cancel, { signal: events.signal });
  return {
    update(current, target) {
      if (destroyed) return;
      const next = target ? (target === current ? 'in' : 'out') : '';
      if (root.parentElement && status.parentElement !== root.parentElement) root.before(status);
      const message = next ? tr('正在切换位置…') : '';
      if (status.textContent !== message) status.textContent = message;
      if (next === phase && placement === current) return;
      const arrived =
        !next && (phase === 'in' || (placement === 'desktop' && current !== 'desktop'));
      const recovering = !next && phase === 'out' && current === placement;
      const previous = {
        transform: getComputedStyle(root).transform,
        opacity: getComputedStyle(root).opacity,
      };
      cancel();
      phase = next;
      placement = current;
      root.inert = !!next;
      root.setAttribute('aria-busy', String(!!next));
      if (next) root.dataset.handoff = next;
      else delete root.dataset.handoff;
      if (next === 'out')
        animate([previous, { transform: 'translateX(12px) scale(.975)', opacity: 0.55 }], true);
      else if (arrived || recovering)
        animate([
          recovering ? previous : { transform: 'translateX(12px) scale(.975)', opacity: 0.55 },
          { transform: 'none', opacity: 1 },
        ]);
    },
    destroy() {
      destroyed = true;
      cancel();
      events.abort();
      root.inert = false;
      root.removeAttribute('aria-busy');
      delete root.dataset.handoff;
      status.remove();
    },
  };
}
