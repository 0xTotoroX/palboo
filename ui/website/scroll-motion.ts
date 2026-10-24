/* [INPUT]: A story section, native scroll/resize and reduced-motion preferences.
 * [OUTPUT]: Clamped section progress, explicit replay rewind and SVG interpolation.
 * [POS]: Website-only scroll transport. Never captures wheel/touch or runs an idle loop.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function useScrollScene(anchors?: string) {
  const ref = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [staticView, setStaticView] = useState(
    () =>
      matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px), (max-height: 650px)')
        .matches,
  );
  const scrollToStart = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: 'instant' });
    // Rewind progress in the same render as replay, before the scroll event arrives.
    setProgress(0);
  }, []);
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
      if (anchors) {
        // Follow the actual copy entering the reading band, not equal fractions
        // of a section whose sticky and padding geometry can change.
        let index = 0;
        element.querySelectorAll(anchors).forEach((anchor, i) => {
          if (anchor.getBoundingClientRect().top <= innerHeight * 0.55) index = i;
        });
        setActiveIndex(index);
      }
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
  }, [anchors]);
  return { ref, progress, staticView, activeIndex, scrollToStart };
}
