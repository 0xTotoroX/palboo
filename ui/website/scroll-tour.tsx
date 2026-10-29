import { demoFocus } from './demo-focus';
/* [INPUT]: Native section progress and explicit visitor interaction.
 * [OUTPUT]: Ordered website-only demo stops and focus-safe scroll playback.
 * [POS]: Presentation state only; no timers, scroll interception or product writes.
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
    const measure = () => {
      const height = pin.current?.offsetHeight || 0;
      ref.current?.style.setProperty('--tour-height', `${height}px`);
      setTooTall(height > innerHeight - 48);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pin.current!);
    addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      removeEventListener('resize', measure);
    };
  }, [ref]);
  return (
    <section
      ref={ref}
      className={`scroll-demo ${className}`}
      data-static={staticView}
      aria-labelledby={labelledBy}
      style={{ '--tour-steps': steps } as CSSProperties}
    >
      <div ref={pin} className="scroll-demo-pin" {...interaction}>
        {children(step)}
      </div>
    </section>
  );
}
