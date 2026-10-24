/* [INPUT]: Scroll geometry or a visitor-selected surface, with motion preferences.
 * [OUTPUT]: One interruptible window journey; camera reveal precedes screen transfer.
 * [POS]: Website transport over the unchanged settings device model.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useLayoutEffect, useRef, useState } from 'react';
import { demoFrames, type DemoFrame } from '../settings/layout-preview-scene';
import { smooth } from './scroll-motion';

type Segment = { frame: DemoFrame; ms: number };
export function useSurfaceJourney(
  surface: string,
  scrollFrame?: DemoFrame,
  animate = true,
  paused = false,
) {
  const target = scrollFrame ?? demoFrames[surface];
  const [frame, setFrame] = useState(target);
  const current = useRef(frame);
  const latest = useRef(target);
  const previous = useRef({ manual: !scrollFrame, surface, paused });
  const request = useRef(0);
  const run = useRef<{
    segments: Segment[];
    index: number;
    start: number;
    origin: DemoFrame;
    resume: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = { manual: !scrollFrame, surface, paused };
    latest.current = target;
    const stop = () => {
      cancelAnimationFrame(request.current);
      request.current = 0;
      run.current = null;
    };
    const show = (value: DemoFrame) => {
      current.current = value;
      setFrame(value);
    };
    if (paused) {
      stop();
      return;
    }
    if (!animate || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stop();
      show(target);
      return;
    }
    if (
      Object.keys(target).every(
        (key) => target[key as keyof DemoFrame] === current.current[key as keyof DemoFrame],
      )
    ) {
      stop();
      show(target);
      return;
    }
    if (scrollFrame && !was.manual && !was.paused) {
      // A brief return to scrolling follows the latest pointer/scroll position,
      // without restarting its clock on every incoming scroll frame.
      if (!run.current?.resume) show(target);
      return;
    }
    if (!scrollFrame && was.manual && was.surface === surface && !was.paused) return;
    stop();
    const from = current.current;
    let segments: Segment[] = [{ frame: target, ms: 280 }];
    if (!scrollFrame && surface === 'desktop' && from.secondary < 1) {
      segments = [
        { frame: { ...demoFrames.popped, secondary: from.secondary }, ms: 220 },
        { frame: { ...demoFrames.popped, secondary: 1 }, ms: 300 },
        { frame: target, ms: 560 },
      ];
    } else if (!scrollFrame && from.secondary > 0 && target.secondary === 0) {
      segments = [
        { frame: { ...demoFrames.popped, secondary: from.secondary }, ms: 380 },
        { frame: demoFrames.popped, ms: 260 },
        { frame: target, ms: 240 },
      ];
    }
    run.current = { segments, index: 0, start: 0, origin: from, resume: !!scrollFrame };
    const tick = (now: number) => {
      const active = run.current;
      if (!active) return;
      if (!active.start) active.start = now;
      const segment = active.segments[active.index];
      const destination = active.resume ? latest.current : segment.frame;
      const progress = Math.min(1, (now - active.start) / segment.ms);
      const t = active.resume ? 1 - (1 - progress) ** 3 : smooth(progress);
      const value = Object.fromEntries(
        Object.keys(destination).map((key) => [
          key,
          active.origin[key as keyof DemoFrame] +
            (destination[key as keyof DemoFrame] - active.origin[key as keyof DemoFrame]) * t,
        ]),
      ) as DemoFrame;
      show(progress === 1 ? destination : value);
      if (progress === 1) {
        if (++active.index === active.segments.length) {
          stop();
          return;
        }
        active.origin = destination;
        active.start = now;
      }
      request.current = requestAnimationFrame(tick);
    };
    request.current = requestAnimationFrame(tick);
  }, [target, scrollFrame, surface, animate, paused]);

  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const settle = () => {
      if (!document.hidden && !media.matches) return;
      cancelAnimationFrame(request.current);
      run.current = null;
      current.current = latest.current;
      setFrame(latest.current);
    };
    media.addEventListener('change', settle);
    document.addEventListener('visibilitychange', settle);
    return () => {
      cancelAnimationFrame(request.current);
      media.removeEventListener('change', settle);
      document.removeEventListener('visibilitychange', settle);
    };
  }, []);
  return frame;
}
