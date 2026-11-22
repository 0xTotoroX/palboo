/* [INPUT]: Native page position, explicit tab selection and responsive viewport geometry.
 * [OUTPUT]: Stable active feature and transition direction inside one sticky section.
 * [POS]: Website-only navigation; never cancels wheel/touch or polls while idle.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { demoFocus } from './demo-focus';

const compactQuery = '(max-width: 760px), (max-height: 560px)';
export function useFeatureScroll(count: number) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState(1);
  const [compact, setCompact] = useState(() => matchMedia(compactQuery).matches);
  const [inView, setInView] = useState(false);
  const current = useRef(0);
  const clearInteraction = useRef(() => {});
  const change = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(count - 1, index));
      if (next === current.current) return;
      setDirection(next > current.current ? 1 : -1);
      current.current = next;
      setActive(next);
    },
    [count],
  );
  const select = useCallback(
    (index: number) => {
      clearInteraction.current();
      change(index);
      const root = ref.current;
      if (!root) return;
      if (!matchMedia(compactQuery).matches) {
        const top = scrollY + root.getBoundingClientRect().top;
        const distance = root.offsetHeight - innerHeight;
        scrollTo({ top: top + (index / (count - 1)) * distance, behavior: 'instant' });
      }
    },
    [change, count],
  );
  useEffect(() => {
    const root = ref.current!;
    const media = matchMedia(compactQuery);
    let frame = 0;
    let resizeFrame = 0;
    let resizing = false;
    let interacting = false;
    let previousY = scrollY;
    const update = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      setInView(box.top < innerHeight * 0.55 && box.bottom > innerHeight * 0.5);
      if (media.matches || resizing) return;
      const distance = box.height - innerHeight;
      if (distance <= 0) return;
      if (Math.abs(scrollY - previousY) < 1) return;
      previousY = scrollY;
      // Focus, disclosure expansion and scroll-into-view inside a preview must not navigate away.
      const panel = root.querySelector<HTMLElement>('.feature-panel[data-active="true"]');
      const shadow = panel?.querySelector('[data-settings-feature]')?.shadowRoot;
      if (interacting && (panel || demoFocus(panel) || shadow?.querySelector('form'))) return;
      const progress = Math.max(0, Math.min(1, -box.top / distance));
      change(Math.round(progress * (count - 1)));
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    const resize = () => {
      resizing = true;
      setCompact(media.matches);
      // 只忽略尺寸变化产生的滚动；布局稳定后，滚动条拖动也恢复跟随。
      previousY = scrollY;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = requestAnimationFrame(() => {
          previousY = scrollY;
          resizing = false;
          update();
        });
      });
    };
    const interact = (event: Event) => {
      if (
        event
          .composedPath()
          .some((node) => node instanceof Element && node.matches('.feature-panel'))
      )
        interacting = true;
      else if (event.type === 'pointerdown') interacting = false;
    };
    const intent = () => {
      resizing = false;
      interacting = false;
    };
    clearInteraction.current = intent;
    const keyboardIntent = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches('input, textarea, select, [contenteditable="true"]'),
          )
      )
        return;
      if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key))
        intent();
    };
    addEventListener('pointerdown', interact, true);
    root.addEventListener('focusin', interact, true);
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', resize);
    addEventListener('wheel', intent, { passive: true });
    addEventListener('touchmove', intent, { passive: true });
    addEventListener('keydown', keyboardIntent);
    media.addEventListener('change', resize);
    previousY = -1;
    if (location.hash === '#features') root.scrollIntoView({ block: 'start', behavior: 'instant' });
    update();
    return () => {
      clearInteraction.current = () => {};
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      removeEventListener('pointerdown', interact, true);
      root.removeEventListener('focusin', interact, true);
      removeEventListener('scroll', schedule);
      removeEventListener('resize', resize);
      removeEventListener('wheel', intent);
      removeEventListener('touchmove', intent);
      removeEventListener('keydown', keyboardIntent);
      media.removeEventListener('change', resize);
    };
  }, [change, count]);
  return { ref, active, direction, select, compact, inView };
}
