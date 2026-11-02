import { demoFocus } from './demo-focus';
/* [INPUT]: Native section progress and explicit visitor interaction.
 * [OUTPUT]: Ordered website-only demo stops and focus-safe scroll playback.
 * [POS]: Presentation state only; no scroll interception or product writes. Timers only for the one-shot static fallback.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { clamp, useScrollScene } from './scroll-motion';

export const layoutStops = [
  { placement: 'sidebar', arrangement: 'vertical', active: 'next' },
  { placement: 'sidebar', arrangement: 'horizontal', active: 'terms' },
  { placement: 'sidebar', arrangement: 'tabs', active: 'outline' },
  { placement: 'overlay', arrangement: 'tabs', active: 'bots' },
  { placement: 'desktop', arrangement: 'tabs', active: 'next' },
  { placement: 'desktop', arrangement: 'tabs', active: 'prompts' },
  { placement: 'edge', arrangement: 'tabs', active: 'model', edge: 'right' },
  { placement: 'edge', arrangement: 'tabs', active: 'board', edge: 'left' },
  { placement: 'edge', arrangement: 'tabs', active: 'model', edge: 'top' },
  { placement: 'edge', arrangement: 'tabs', active: 'board', edge: 'bottom' },
  { placement: 'sidebar', arrangement: 'vertical', active: 'next' },
] as const;
export const materialStops = [
  { theme: 'matte', variant: 'regular' },
  { theme: 'frosted', variant: 'regular' },
  { theme: 'native-glass', variant: 'regular' },
  { theme: 'native-glass', variant: 'clear' },
  { theme: 'black', variant: 'regular' },
] as const;
export const openingTiming = {
  intro: 1.8,
  layoutStep: 0.65,
  transition: 0.9,
  materialStep: 0.7,
};
export const materialStart = openingTiming.intro + layoutStops.length * openingTiming.layoutStep;
export const openingDistance =
  materialStart + openingTiming.transition + materialStops.length * openingTiming.materialStep;
export const stopAt = (progress: number, count: number) =>
  Math.min(count - 1, Math.floor(clamp(progress) * count));

export function useScrollTour(count: number, tooTall = false) {
  const { ref, progress, staticView: simplified } = useScrollScene();
  const staticView = simplified || tooTall;
  const [paused, setPaused] = useState(false);
  const desired = stopAt(progress, count);
  const [step, setStep] = useState<number | undefined>(() => (staticView ? undefined : desired));
  const dragging = useRef(false);
  useEffect(() => {
    if (!staticView && !paused) setStep(desired);
  }, [desired, paused, staticView]);
  // 静态/窄屏回退：进入阅读区后把因果顺序轻量播放一次，停在终态；访客一操作就停。
  // 减少动态效果时不播放，保留可读的默认状态。
  const played = useRef(false);
  const playback = useRef<number[]>([]);
  // 一批计时器只属于当前静态模式：访客操作、切回滚动模式、减少动态效果或卸载时整批取消。
  const cancelPlayback = () => {
    playback.current.forEach(clearTimeout);
    playback.current.length = 0;
  };
  useEffect(() => {
    if (paused || !staticView) cancelPlayback();
  }, [paused, staticView]);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => query.matches && cancelPlayback();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => () => playback.current.forEach(clearTimeout), []);
  useEffect(() => {
    const node = ref.current;
    if (!staticView || paused || played.current || !node) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers = playback.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || played.current) return;
        played.current = true;
        observer.disconnect();
        node.dataset.staticPlayed = 'true';
        for (let index = 0; index < count; index += 1)
          timers.push(window.setTimeout(() => setStep(index), 200 + index * 900));
      },
      { rootMargin: '0px 0px -30% 0px', threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [staticView, paused, count, ref]);
  useEffect(() => {
    const resume = () => {
      if (
        dragging.current ||
        demoFocus(ref.current)?.matches('input, textarea, select, [contenteditable="true"]')
      )
        return;
      setPaused(false);
    };
    addEventListener('wheel', resume, { passive: true });
    addEventListener('touchmove', resume, { passive: true });
    return () => {
      removeEventListener('wheel', resume);
      removeEventListener('touchmove', resume);
    };
  }, [ref]);
  return {
    ref,
    staticView,
    step,
    interaction: {
      onPointerDownCapture: () => setPaused(true),
      onFocusCapture: () => setPaused(true),
      onKeyDownCapture: () => setPaused(true),
      onDragStartCapture: () => {
        dragging.current = true;
        setPaused(true);
      },
      onDragEndCapture: () => {
        dragging.current = false;
      },
    },
  };
}

export function ScrollDemo({
  steps,
  children,
  className = '',
  labelledBy,
}: {
  steps: number;
  children: (step: number | undefined) => ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const [tooTall, setTooTall] = useState(false);
  const { ref, staticView, step, interaction } = useScrollTour(steps, tooTall);
  const pin = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // 内容变高只会把示例转为静态；回到固定模式只在视口尺寸变化时重新判断，
    // 避免演示步骤改变高度时在两种模式之间来回切换。
    const measure = (fromViewport = false) => {
      const height = pin.current?.offsetHeight || 0;
      ref.current?.style.setProperty('--tour-height', `${height}px`);
      const tall = height > innerHeight - 48;
      setTooTall((current) => (fromViewport ? tall : current || tall));
    };
    const onContent = () => measure();
    const onViewport = () => measure(true);
    const observer = new ResizeObserver(onContent);
    observer.observe(pin.current!);
    addEventListener('resize', onViewport);
    measure(true);
    return () => {
      observer.disconnect();
      removeEventListener('resize', onViewport);
    };
  }, [ref]);
  return (
    <section
      ref={ref}
      className={`scroll-demo ${className}`}
      data-static={staticView}
      data-step={step ?? ''}
      aria-labelledby={labelledBy}
      style={{ '--tour-steps': steps } as CSSProperties}
    >
      <div ref={pin} className="scroll-demo-pin" {...interaction}>
        {children(step)}
      </div>
    </section>
  );
}
