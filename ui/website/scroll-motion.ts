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
  // How far the active anchor has travelled toward the next one (0..1).
  const [activeFraction, setActiveFraction] = useState(0);
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
      // Preserve exact endpoints even when a long tour makes the last scroll
      // increment smaller than the frame tolerance.
      setProgress((old) =>
        value > 0 && value < 1 && Math.abs(old - value) < 0.0001 ? old : value,
      );
      if (anchors) {
        // Follow the actual copy entering the reading band, not equal fractions
        // of a section whose sticky and padding geometry can change.
        let index = 0;
        const band = innerHeight * 0.55;
        const tops = [...element.querySelectorAll(anchors)].map(
          (anchor) => anchor.getBoundingClientRect().top,
        );
        tops.forEach((top, i) => {
          if (top <= band) index = i;
        });
        setActiveIndex(index);
        const start = tops[index] ?? 0;
        const end = tops[index + 1] ?? box.bottom - innerHeight * 0.45;
        const fraction = clamp((band - start) / Math.max(1, end - start));
        setActiveFraction((old) => (Math.abs(old - fraction) < 0.01 ? old : fraction));
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
  return { ref, progress, staticView, activeIndex, activeFraction, scrollToStart };
}

/* ---------- 进入视口的进度：章节随阅读落定，静态视图直接终态 ---------- */
export function useEntryProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    const element = ref.current!;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (media.matches) return setProgress(1);
      const top = element.getBoundingClientRect().top;
      const value = clamp((innerHeight * 0.95 - top) / (innerHeight * 0.6));
      setProgress((old) => (Math.abs(old - value) < 0.005 && value > 0 && value < 1 ? old : value));
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);
  return { ref, progress };
}
