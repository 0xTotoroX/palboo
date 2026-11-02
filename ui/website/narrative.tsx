/* [INPUT]: Live source/target elements (light or Shadow DOM) and demo insertion callbacks.
 * [OUTPUT]: Cancellable text transfer and a brief input acknowledgement; no route overlays.
 * [POS]: Website presentation only; never clicks, focuses or writes product state. Finite Web Animations.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md §10 in sync. */

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 在真实组件的 Shadow DOM 中查找元素 ---------- */
export function shadowQuery<T extends Element = HTMLElement>(
  scope: ParentNode | null | undefined,
  kind: string,
  selector: string,
) {
  const host = scope?.querySelector(`[data-real-feature="${kind}"]`);
  return (host?.shadowRoot?.querySelector(selector) as T | null) ?? null;
}

/* ---------- 文本从来源飞向目标：状态衔接，结束即移除 ---------- */
export function flyText(
  from: Element | null | undefined,
  to: Element | null | undefined,
  text: string,
  onLand?: () => void,
): (() => void) | undefined {
  if (!from || !to || reducedMotion()) return void onLand?.();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return void onLand?.();
  const ghost = document.createElement('div');
  ghost.className = 'phrase-flight';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.textContent = text;
  ghost.style.left = `${a.left}px`;
  ghost.style.top = `${a.top}px`;
  ghost.style.maxWidth = `${Math.min(Math.max(a.width, 120), 280)}px`;
  document.body.append(ghost);
  const dx = b.left + 12 - a.left;
  const dy = b.top + 12 - a.top;
  const lift = Math.min(48, Math.abs(dx) * 0.15 + 16);
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 0 },
      { transform: 'translate(0, -4px) scale(1.02)', opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(0.98)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.92)`, opacity: 0 },
    ],
    { duration: 560, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  );
  let live = true;
  flight.onfinish = () => {
    ghost.remove();
    if (live) onLand?.();
    live = false;
  };
  flight.oncancel = () => ghost.remove();
  // 每次飞行可取消：移除幽灵文本并阻止过期的落地回调。
  return () => {
    live = false;
    flight.cancel();
    ghost.remove();
  };
}

/* ---------- 输入框落定提示 ---------- */
export function markFilled(composer: Element | null | undefined) {
  if (!composer) return;
  composer.classList.remove('is-filled');
  void (composer as HTMLElement).offsetWidth;
  composer.classList.add('is-filled');
}
