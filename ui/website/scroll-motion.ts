/* [INPUT]: A story section, native scroll/resize and reduced-motion preferences.
 * [OUTPUT]: Clamped section progress; interpolation for the existing SVG renderers.
 * [POS]: Website-only scroll transport. Never captures wheel/touch or runs an idle loop.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useEffect, useRef, useState } from 'react';

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function useScrollScene() {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [staticView, setStaticView] = useState(
    () =>
      matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px), (max-height: 650px)')
        .matches,
  );
  useEffect(() => {
    const element = ref.current!;
    const media = matchMedia(
      '(prefers-reduced-motion: reduce), (max-width: 760px), (max-height: 650px)',
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const value = clamp(-box.top / Math.max(1, box.height - innerHeight));
      setProgress((old) => (Math.abs(old - value) < 0.0001 ? old : value));
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    const onMedia = () => {
      setStaticView(media.matches);
      schedule();
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!document.hidden) schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onMedia);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onMedia);
    };
  }, []);
  return { ref, progress, staticView };
}
