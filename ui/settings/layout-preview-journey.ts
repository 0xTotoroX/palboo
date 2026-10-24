/* [INPUT]: Destination and geometry from the shared modeled device scene.
 * [OUTPUT]: Interruptible window handoff; reduced motion and hidden pages settle immediately.
 * [POS]: Pure preview motion shared by settings and the standalone website; no services.
 * [PROTOCOL]: Keep settings/AGENTS.md and website/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { demoFrames, type DemoFrame } from './layout-preview-scene';

export function useDemoJourney(location: string, target: DemoFrame, animate = true) {
  const [frame, setFrame] = useState(target);
  const current = useRef(frame),
    previous = useRef(location);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0,
      disposed = false;
    const from = current.current,
      was = previous.current;
    previous.current = location;
    const segments =
      location === 'desktop' && was !== 'desktop' && from.secondary < 0.5
        ? [
            { frame: demoFrames.popped, ms: 280 },
            { frame: demoFrames.popped, ms: 100 },
            { frame: target, ms: 560 },
          ]
        : was === 'desktop' && location !== 'desktop'
          ? [
              { frame: { ...demoFrames.popped, secondary: 0 }, ms: 520 },
              { frame: target, ms: 240 },
            ]
          : [{ frame: target, ms: 240 }];
    let index = 0,
      start = 0,
      origin = from;
    const finish = () => {
      cancelAnimationFrame(request);
      current.current = target;
      setFrame(target);
    };
    const tick = (time: number) => {
      if (disposed) return;
      if (!start) start = time;
      const segment = segments[index],
        progress = Math.min(1, (time - start) / segment.ms),
        t = progress * progress * (3 - 2 * progress);
      const value = Object.fromEntries(
        Object.keys(target).map((key) => [
          key,
          origin[key as keyof DemoFrame] +
            (segment.frame[key as keyof DemoFrame] - origin[key as keyof DemoFrame]) * t,
        ]),
      ) as DemoFrame;
      current.current = value;
      setFrame(value);
      if (progress === 1) {
        if (++index === segments.length) return;
        origin = value;
        start = time;
      }
      request = requestAnimationFrame(tick);
    };
    const onReduced = () => {
      if (reduced.matches) finish();
    };
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    reduced.addEventListener('change', onReduced);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', finish);
    if (
      Object.keys(target).every(
        (key) => target[key as keyof DemoFrame] === from[key as keyof DemoFrame],
      ) ||
      !animate ||
      reduced.matches ||
      document.hidden ||
      document.documentElement.dataset.settingsInput === 'keyboard'
    )
      finish();
    else request = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(request);
      reduced.removeEventListener('change', onReduced);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', finish);
    };
  }, [location, target, animate]);
  return frame;
}
