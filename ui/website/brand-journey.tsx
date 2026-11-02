/* [INPUT]: Existing opening, material wordmark, selected feature and closing wordmark anchors.
 * [OUTPUT]: One reversible mascot journey; native scrolling remains the only page transport.
 * [POS]: Website-only decoration. No product state, input capture or idle animation loop.
 * [PROTOCOL]: Keep website/AGENTS.md and motion acceptance in sync. */
import { useLayoutEffect, useRef } from 'react';
import { clamp, smooth } from './scroll-motion';

type Pose = { x: number; y: number; scale: number; angle: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const interpolate = (a: Pose, b: Pose, t: number, lift = 0): Pose => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t) - Math.sin(Math.PI * t) * lift,
  scale: Math.exp(mix(Math.log(a.scale), Math.log(b.scale), t)),
  angle: mix(a.angle, b.angle, t),
});

// SVG's screen matrix includes the tilted backdrop and its foreignObject camera.
function svgPose(element: SVGGraphicsElement, x: number, y: number, scale = 1): Pose | null {
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(x, y).matrixTransform(matrix);
  return {
    x: point.x,
    y: point.y,
    scale: Math.hypot(matrix.a, matrix.b) * scale,
    angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
  };
}

export function BrandJourney() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const mascot = ref.current!;
    const main = document.getElementById('main')!;
    const opening = main.querySelector<HTMLElement>('.opening-story')!;
    const surface = main.querySelector<HTMLElement>('.surface-story')!;
    const screen = main.querySelector<SVGSVGElement>('.layout-demo-scene')!;
    const origin = main.querySelector<SVGGraphicsElement>('.brand-flight #eyes')!;
    const backdrop = main.querySelector<SVGGraphicsElement>(
      '.layout-demo-material-backdrop [data-brand-eyes]',
    )!;
    const feature = document.getElementById('features')!;
    const rail = feature.querySelector<HTMLElement>('.feature-navigation')!;
    const footer = document.getElementById('install')!;
    const closing = footer.querySelector<SVGGraphicsElement>('[data-closing-face]')!;
    const media = matchMedia(
      '(prefers-reduced-motion: reduce), (max-width: 760px), (max-height: 650px)',
    );
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resting = false;
    let current: Pose | null = null;
    let phase = 'opening';
    let selected = '';
    let jump: { from: Pose; start: number; kind: 'tab' | 'handoff' } | undefined;

    const stopRest = () => {
      clearTimeout(timer);
      timer = undefined;
      resting = false;
      footer.dataset.brandRest = 'false';
    };
    const rest = (ready: boolean) => {
      if (!ready) return stopRest();
      if (resting || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        resting = true;
        footer.dataset.brandRest = 'true';
      }, 2200);
    };
    const draw = (pose: Pose, opacity: number) => {
      current = pose;
      mascot.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.angle}deg) scale(${pose.scale})`;
      mascot.style.opacity = String(opacity);
    };
    const update = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const footerBox = footer.getBoundingClientRect();
      main.dataset.brandJourney = media.matches ? 'static' : 'moving';
      if (media.matches) {
        mascot.style.opacity = '0';
        main.dataset.brandPhase = 'opening';
        rest(footerBox.top < innerHeight * 0.8 && footerBox.bottom > innerHeight * 0.2);
        current = null;
        jump = undefined;
        return;
      }
      const from = svgPose(origin, 600, 307, 222 / 24);
      const background = svgPose(backdrop, 147, 15);
      const ending = svgPose(closing, 147, 15);
      const tab = rail.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!from || !background || !ending || !tab) return;
      const tabBox = tab.getBoundingClientRect();
      const destination = {
        x: Math.max(20, tabBox.left - 24),
        y: tabBox.top + tabBox.height / 2,
        scale: 0.8,
        angle: 0,
      };
      const material = Number(surface.style.getPropertyValue('--material-progress'));
      const featureTop = feature.getBoundingClientRect().top;
      const toFeatures = clamp((innerHeight - featureTop) / (innerHeight * 0.8));
      const available = Math.max(
        1,
        Math.min(footerBox.height, innerHeight * 0.65) - innerHeight * 0.08,
      );
      const toFooter = clamp((innerHeight * 0.92 - footerBox.top) / available);
      let next = 'opening';
      let pose = from;
      let opacity = 0;
      mascot.style.color = 'var(--site-text)';
      if (toFooter > 0) {
        next = toFooter >= 0.995 ? 'footer' : 'to-footer';
        pose = interpolate(destination, ending, smooth(toFooter), 64);
        opacity = next === 'footer' ? 0 : 1;
      } else if (toFeatures > 0) {
        next = toFeatures >= 1 ? 'feature' : 'to-feature';
        pose = interpolate(background, destination, smooth(toFeatures), 96);
        // Leave the preview horizontally before descending beside the next
        // heading, keeping the face clear of the material controls and copy.
        const turn = 1 - (1 - toFeatures) ** 3;
        pose.x = mix(background.x, destination.x, turn);
        pose.scale = Math.exp(mix(Math.log(background.scale), Math.log(destination.scale), turn));
        opacity = smooth(toFeatures / 0.12);
      } else if (material > 0) {
        next = material >= 1 ? 'material' : 'to-material';
        pose = interpolate(from, background, smooth(material), 84);
        opacity = 1 - smooth((material - 0.8) / 0.2);
        const style = getComputedStyle(backdrop);
        mascot.style.color = `color-mix(in srgb, var(--site-text) ${100 * (1 - material)}%, ${style.color})`;
      }
      let embed =
        next === 'material'
          ? 1
          : next === 'to-material'
            ? smooth((material - 0.8) / 0.2)
            : next === 'to-feature'
              ? 1 - smooth(toFeatures / 0.12)
              : 0;
      // A discrete tab change hops from the currently rendered position. Fast
      // wheel/keyboard changes retarget this same flight instead of queuing hops.
      // Leaving the feature stage midway hands that presentation position to
      // the scroll route too, including a fast jump straight to either endpoint.
      if (jump && phase !== next && current) jump = { from: current, start: now, kind: 'handoff' };
      else if (next === 'feature' && phase === 'feature' && selected !== tab.id && current)
        jump = { from: current, start: now, kind: 'tab' };
      let visiblePhase = next;
      if (jump) {
        const t = clamp((now - jump.start) / (jump.kind === 'tab' ? 360 : 240));
        pose = interpolate(jump.from, pose, smooth(t), jump.kind === 'tab' ? 18 : 0);
        if (jump.kind === 'tab') pose.x += Math.sin(Math.PI * t) * 12;
        if (t < 1) {
          if (jump.kind === 'handoff') {
            // The receiving static face stays hidden until this actual landing;
            // its rest timer must not start from a scroll position alone.
            visiblePhase =
              next === 'footer'
                ? 'to-footer'
                : next === 'material'
                  ? 'to-material'
                  : next === 'opening'
                    ? 'to-opening'
                    : next;
            embed = next === 'material' ? smooth((t - 0.85) / 0.15) : 0;
            opacity = 1 - embed;
          }
          frame = requestAnimationFrame(update);
        } else jump = undefined;
      }
      main.style.setProperty('--journey-embed', String(embed));
      selected = tab.id;
      phase = next;
      main.dataset.brandPhase = visiblePhase;
      mascot.dataset.phase = visiblePhase;
      mascot.dataset.target = next === 'feature' ? tab.id : next;
      rest(visiblePhase === 'footer');
      draw(pose, opacity);
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      jump = undefined;
      if (document.hidden) stopRest();
      else schedule();
    };
    const resize = new ResizeObserver(schedule);
    [opening, feature, footer, screen, rail].forEach((element) => resize.observe(element));
    const state = new MutationObserver(schedule);
    state.observe(surface, { attributes: true, attributeFilter: ['style'] });
    state.observe(screen, { attributes: true, attributeFilter: ['viewBox'] });
    state.observe(rail, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      stopRest();
      resize.disconnect();
      state.disconnect();
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', visibility);
      delete main.dataset.brandJourney;
      delete main.dataset.brandPhase;
      main.style.removeProperty('--journey-embed');
    };
  }, []);
  return (
    <div ref={ref} className="brand-journey" aria-hidden="true" inert>
      <svg viewBox="-22 -15 44 32" fill="currentColor">
        <rect x="-15" y="-12" width="9" height="24" rx="4.5" />
        <rect x="6" y="-12" width="9" height="24" rx="4.5" />
        <g fill="#f4a3ad">
          <circle cx="-18.6" cy="11.3" r="2.5" />
          <circle cx="18.6" cy="11.3" r="2.5" />
        </g>
      </svg>
    </div>
  );
}
