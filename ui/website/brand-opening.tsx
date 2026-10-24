/* [INPUT]: Original v3 SVG/pose timeline, scroll progress and motion preference.
 * [OUTPUT]: Original letter/eye geometry driven by scroll; natural-speed blink on arrival.
 * [POS]: Website transport only; original artwork and trajectories stay unchanged.
 * [PROTOCOL]: Keep website/AGENTS.md and media/README.md in sync. */
import { useEffect, useRef } from 'react';
import { createBrandPose } from './brand-poses';
import { clamp } from './scroll-motion';
import artwork from './media/palboo-opening.svg?raw';

export function BrandOpening({ progress, staticView }: { progress: number; staticView: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pose = useRef<ReturnType<typeof createBrandPose> | null>(null);
  const arrived = useRef(false);
  const frame = useRef(0);
  useEffect(() => {
    pose.current = createBrandPose(ref.current!);
    return () => {
      cancelAnimationFrame(frame.current);
      pose.current = null;
    };
  }, []);
  useEffect(() => {
    const stage = ref.current!;
    const render = (time: number) => pose.current?.render(time);
    const stop = () => {
      cancelAnimationFrame(frame.current);
      stage.dataset.playing = 'false';
    };
    if (staticView) {
      stop();
      render(6.8);
      arrived.current = false;
      return;
    }
    // Preserve the original authored geometry. Only the transport follows scrolling.
    if (progress < 0.58) {
      stop();
      arrived.current = false;
      render(1.15 + clamp(progress / 0.58) * 3.25);
    } else if (!arrived.current) {
      arrived.current = true;
      const started = performance.now();
      stage.dataset.playing = 'true';
      const tick = (now: number) => {
        const time = Math.min(6.8, 4.4 + (now - started) / 1000);
        render(time);
        if (time < 6.8 && !document.hidden) frame.current = requestAnimationFrame(tick);
        else stage.dataset.playing = 'false';
      };
      frame.current = requestAnimationFrame(tick);
    }
  }, [progress, staticView]);
  useEffect(() => {
    const finish = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(frame.current);
      if (arrived.current) pose.current?.render(6.8);
      ref.current!.dataset.playing = 'false';
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && arrived.current) {
        cancelAnimationFrame(frame.current);
        pose.current?.render(6.8);
        ref.current!.dataset.playing = 'false';
      }
    });
    observer.observe(ref.current!);
    document.addEventListener('visibilitychange', finish);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', finish);
    };
  }, []);
  return (
    <div className="brand-opening">
      <div className="original-opening" ref={ref} dangerouslySetInnerHTML={{ __html: artwork }} />
    </div>
  );
}
