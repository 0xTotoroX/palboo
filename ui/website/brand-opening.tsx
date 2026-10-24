/* [INPUT]: Original v3 SVG/pose timeline, scroll progress and motion preference.
 * [OUTPUT]: Complete original playback from typing through blush, then scroll handoff.
 * [POS]: Website transport only; original artwork and authored poses stay unchanged.
 * [PROTOCOL]: Keep website/AGENTS.md and media/README.md in sync. */
import { useLayoutEffect, useRef } from 'react';
import { createBrandPose } from './brand-poses';
import artwork from './media/palboo-opening.svg?raw';

export function BrandOpening({
  progress,
  replay,
  skip,
  onFinished,
}: {
  progress: number;
  replay: number;
  skip: boolean;
  onFinished: (value: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const finish = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = ref.current!;
    const timeline = createBrandPose(element);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0,
      elapsed = 0,
      last = 0,
      visible = true;
    const stop = () => {
      cancelAnimationFrame(request);
      request = 0;
      last = 0;
    };
    finish.current = () => {
      stop();
      elapsed = 6.8;
      timeline.render(6.8);
      onFinished(true);
    };
    const tick = (now: number) => {
      request = 0;
      if (last) elapsed = Math.min(6.8, elapsed + (now - last) / 1000);
      last = now;
      timeline.render(elapsed);
      if (elapsed < 6.8) request = requestAnimationFrame(tick);
      else onFinished(true);
    };
    const resume = () => {
      if (media.matches) return finish.current();
      if (document.hidden || !visible) return stop();
      if (!request && elapsed < 6.8) request = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    observer.observe(element);
    timeline.render(media.matches ? 6.8 : 0);
    media.addEventListener('change', resume);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      stop();
      observer.disconnect();
      media.removeEventListener('change', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [replay, onFinished]);
  useLayoutEffect(() => {
    // Scrolling ahead hands off the final original pose; it never flies as letters.
    if (progress >= 0.62 || skip) finish.current();
  }, [progress, replay, skip]);
  return (
    <div className="brand-opening" role="img" aria-label="PALBOO 字标变成双眼">
      <div
        className="original-opening"
        ref={ref}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: artwork }}
      />
    </div>
  );
}
