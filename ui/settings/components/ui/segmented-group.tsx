/* [INPUT]: Existing pressed buttons, selected identity and host reduced-motion preference.
 * [OUTPUT]: One shared selection surface, with the verified ChatGPT settings spring and interruptible geometry.
 * [POS]: Presentation only; original buttons retain their semantics, callbacks and focus.
 * [PROTOCOL]: Keep components/ui/AGENTS.md in sync. */
import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { reducedMotion } from '../../settings-motion';
import { segmentedSpring } from '../../settings-spring';

export function SegmentedGroup({
  value,
  as: Tag = 'div',
  children,
  ...props
}: ComponentProps<'div'> & { value: string; as?: 'div' | 'nav' }) {
  const root = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const update = useRef<(animate: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const node = root.current!,
      surface = marker.current!;
    // The website reuses layout demo controls with its own styling and motion.
    if (!node.closest('.settings-app')) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let ready = false;
    let animation: Animation | undefined;
    const cancel = () => {
      animation?.cancel();
      animation = undefined;
    };
    const measure = (animate: boolean) => {
      const selected = node.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!selected || !node.getClientRects().length) {
        cancel();
        ready = false;
        surface.hidden = true;
        return;
      }
      const before = surface.getBoundingClientRect();
      const box = selected.getBoundingClientRect(),
        parent = node.getBoundingClientRect();
      cancel();
      surface.hidden = false;
      Object.assign(surface.style, {
        left: `${box.left - parent.left - node.clientLeft + node.scrollLeft}px`,
        top: `${box.top - parent.top - node.clientTop + node.scrollTop}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        borderRadius: getComputedStyle(selected).borderRadius,
      });
      if (
        animate &&
        ready &&
        before.width &&
        box.width &&
        !reducedMotion(media) &&
        document.documentElement.dataset.settingsInput !== 'keyboard'
      ) {
        animation = surface.animate(
          [
            {
              transform: `translate(${before.left - box.left}px, ${before.top - box.top}px) scale(${before.width / box.width}, ${before.height / box.height})`,
            },
            { transform: 'none' },
          ],
          segmentedSpring,
        );
      }
      ready = true;
    };
    update.current = measure;
    const resize = new ResizeObserver(() => measure(false));
    resize.observe(node);
    for (const button of node.querySelectorAll('button')) resize.observe(button);
    const immediate = () => measure(false);
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('settings-motion-change', immediate);
    media.addEventListener('change', immediate);
    measure(false);
    return () => {
      cancel();
      resize.disconnect();
      update.current = () => {};
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('settings-motion-change', immediate);
      media.removeEventListener('change', immediate);
    };
  }, []);
  useLayoutEffect(() => {
    if (previous.current !== value) update.current(true);
    previous.current = value;
  }, [value]);
  return (
    <Tag {...props} ref={root} data-settings-segmented>
      <span ref={marker} className="settings-segment-indicator" aria-hidden="true" hidden />
      {children}
    </Tag>
  );
}
