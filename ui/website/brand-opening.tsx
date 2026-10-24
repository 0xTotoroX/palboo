/* [INPUT]: Original v3 SVG and pose timeline, browser motion and visibility preferences.
 * [OUTPUT]: Inline original brand animation, with pause/replay and a reduced-motion final pose.
 * [POS]: Website-only transport; original artwork and motion remain in media / brand-poses.
 * [PROTOCOL]: Keep website/AGENTS.md and media/README.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { createBrandPose } from './brand-poses';
import artwork from './media/palboo-opening.svg?raw';

type Transport = { replay: () => void; toggle: () => void };
export function BrandOpening() {
  const ref = useRef<HTMLDivElement>(null);
  const transport = useRef<Transport | null>(null);
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    const stage = ref.current!;
    const { duration, render } = createBrandPose(stage);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let time = reduced.matches ? duration : 0;
    let playing = !reduced.matches;
    let frame = 0,
      last = 0,
      visible = false,
      disposed = false;
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };
    const report = () => {
      stage.dataset.playing = String(playing);
      setPaused(!playing);
    };
    const tick = (now: number) => {
      frame = 0;
      if (disposed) return;
      time = Math.min(duration, time + (last ? Math.min((now - last) / 1000, 1 / 30) : 0));
      last = now;
      render(time);
      if (time >= duration) {
        playing = false;
        last = 0;
        report();
      } else run();
    };
    const run = () => {
      if (!frame && playing && visible && !document.hidden && !reduced.matches)
        frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      if (!visible || document.hidden) stop();
      else run();
    };
    const onReduced = () => {
      if (!reduced.matches) return;
      stop();
      playing = false;
      time = duration;
      render(time);
      report();
    };
    transport.current = {
      replay() {
        stop();
        time = reduced.matches ? duration : 0;
        playing = !reduced.matches;
        render(time);
        report();
        run();
      },
      toggle() {
        if (reduced.matches) return;
        if (playing) {
          playing = false;
          stop();
        } else {
          if (time >= duration) time = 0;
          playing = true;
          render(time);
          run();
        }
        report();
      },
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(stage);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', onReduced);
    render(time);
    report();
    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      transport.current = null;
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', onReduced);
    };
  }, []);
  return (
    <div className="brand-opening">
      <div className="original-opening" ref={ref} dangerouslySetInnerHTML={{ __html: artwork }} />
      <div className="opening-controls">
        <button
          aria-label={paused ? '播放品牌动画' : '暂停品牌动画'}
          onClick={() => transport.current?.toggle()}
        >
          {paused ? '播放' : '暂停'}
        </button>
        <button
          className="icon-button"
          aria-label="重播品牌动画"
          onClick={() => transport.current?.replay()}
        >
          <Icon name="refresh" />
        </button>
      </div>
    </div>
  );
}
