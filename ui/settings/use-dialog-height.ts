/* [INPUT]: Mounted native dialog and its intrinsic content, host motion preference.
 * [OUTPUT]: Measured content-height changes using ChatGPT's confirmed 300ms snappy curve; first opening stays immediate.
 * [POS]: Preserves dialog focus, content DOM and native scrolling; excludes fixed-height drawers.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useLayoutEffect, type RefObject } from 'react';
import { reducedMotion } from './settings-motion';

export function useDialogHeight(
  dialog: RefObject<HTMLDialogElement | null>,
  content: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const node = dialog.current!,
      body = content.current!;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let height = 0;
    let animation: Animation | undefined;
    const cancel = () => {
      animation?.cancel();
      animation = undefined;
    };
    const measure = () => {
      if (!node.open) {
        cancel();
        height = 0;
        node.style.removeProperty('height');
        return;
      }
      const style = getComputedStyle(node);
      const natural =
        body.offsetHeight +
        ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
          (sum, key) => sum + (parseFloat(style[key as keyof CSSStyleDeclaration] as string) || 0),
          0,
        );
      const next = Math.min(natural, parseFloat(style.maxHeight) || Infinity);
      if (Math.abs(next - height) < 0.5) return;
      const previous = parseFloat(style.height);
      cancel();
      node.style.height = `${next}px`;
      if (
        height &&
        !reducedMotion(media) &&
        document.documentElement.dataset.settingsInput !== 'keyboard'
      )
        animation = node.animate([{ height: `${previous}px` }, { height: `${next}px` }], {
          duration: 300,
          easing: 'cubic-bezier(.23,1,.32,1)',
        });
      height = next;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(body);
    const opening = new MutationObserver(measure);
    opening.observe(node, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('settings-motion-change', cancel);
    media.addEventListener('change', cancel);
    measure();
    return () => {
      cancel();
      resize.disconnect();
      opening.disconnect();
      node.style.removeProperty('height');
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('settings-motion-change', cancel);
      media.removeEventListener('change', cancel);
    };
  }, [dialog, content]);
}
