/* [INPUT]: Model target scope, speed control and serialized operation outcome.
 * [OUTPUT]: Cancellable charge and confirmed single or paired pulses on the model divider.
 * [POS]: Model presentation only. The host snapshot owns the selected speed.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const divider = 'M24 0 L23 43 L27 86 L20 122 L26 166 L23 209 L28 256 L21 295 L25 328 L24 360';
const ultraDuration = 300;
const catchTime = 165;
const catchHeight = (2 / 3) * 100;
const launchGap = 60;
const bottomTime = 280;
const offset = (ms: number) => ms / ultraDuration;

function pulse(ms: number, head: number, opacity: number, length = 15): Keyframe {
  const tail = Math.max(0, head - length);
  return { offset: offset(ms), clipPath: `inset(${tail}% 0 ${100 - head}% 0)`, opacity };
}

type Discharge = 'fast' | 'ultrafast';

export function useSpeedMotion(scope: string) {
  const button = useRef<HTMLButtonElement>(null);
  const glyph = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  const single = useRef<SVGGElement>(null);
  const lead = useRef<SVGGElement>(null);
  const chase = useRef<SVGGElement>(null);
  const branches = useRef<SVGGElement>(null);
  const animations = useRef<Animation[]>([]);
  const revision = useRef(0);
  const [phase, setPhase] = useState<'idle' | 'charging' | 'charged' | 'striking'>('idle');

  function clear() {
    revision.current++;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    fill.current?.style.removeProperty('clip-path');
    const node = beam.current;
    if (node) {
      node.style.removeProperty('opacity');
      delete node.dataset.discharge;
    }
  }

  function stop() {
    clear();
    setPhase('idle');
  }

  useLayoutEffect(() => {
    setPhase('idle');
    return clear;
  }, [scope]);

  useEffect(() => {
    const document = button.current?.ownerDocument;
    const reduced = document?.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
    const interrupt = () => {
      if (document?.hidden || reduced?.matches) stop();
    };
    reduced?.addEventListener('change', interrupt);
    document?.addEventListener('visibilitychange', interrupt);
    return () => {
      reduced?.removeEventListener('change', interrupt);
      document?.removeEventListener('visibilitychange', interrupt);
    };
  }, []);

  async function start(kind: Discharge, operation: Promise<boolean>) {
    stop();
    const id = revision.current;
    // Observe failure immediately, including when the animation is skipped.
    const outcome = operation.then(
      (success) => {
        if (!success && revision.current === id) stop();
        return success;
      },
      () => {
        if (revision.current === id) stop();
        return false;
      },
    );
    const control = button.current;
    const node = beam.current;
    const icon = glyph.current;
    const layer = fill.current;
    const path = single.current;
    const first = lead.current;
    const second = chase.current;
    const burst = branches.current;
    const media = control?.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );
    const visible = () => !!control?.getClientRects().length && !control.ownerDocument.hidden;
    if (
      !node ||
      !icon ||
      !layer ||
      !path ||
      !first ||
      !second ||
      !burst ||
      !visible() ||
      media?.matches
    )
      return;

    setPhase('charging');
    try {
      const fast = kind === 'fast';
      const charge = fast
        ? layer.animate([{ clipPath: 'inset(100% 0 0)' }, { clipPath: 'inset(0% 0 0)' }], {
            duration: 360,
            easing: 'cubic-bezier(.4,0,.2,1)',
            fill: 'forwards',
          })
        : icon.animate(
            [
              { opacity: 0.7, filter: 'drop-shadow(0 0 0 transparent)' },
              { opacity: 1, filter: 'drop-shadow(0 0 3px currentColor)' },
            ],
            { duration: 110, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
          );
      animations.current = [charge];
      await charge.finished;
      if (revision.current !== id) return;
      if (fast) {
        // Keep the fill continuous between the charge and the confirmed state.
        layer.style.clipPath = 'inset(0)';
        charge.cancel();
        animations.current = [];
      }
      setPhase('charged');
      const success = await outcome;
      if (revision.current !== id || !success) return;
      if (!visible() || media?.matches) {
        stop();
        return;
      }
      setPhase('striking');
      node.dataset.discharge = kind;
      if (fast) {
        animations.current = [
          path.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }], {
            duration: 145,
            easing: 'cubic-bezier(.18,.7,.28,1)',
            fill: 'forwards',
          }),
          node.animate(
            [
              { opacity: 0, offset: 0 },
              { opacity: 1, offset: 0.1 },
              { opacity: 0.95, offset: 0.44 },
              { opacity: 0, offset: 1 },
            ],
            { duration: 340, easing: 'linear' },
          ),
        ];
      } else {
        charge.cancel();
        node.style.opacity = '1';
        const timing = { duration: ultraDuration, fill: 'both' } as const;
        const mergeEnd = 198;
        const mergedHead =
          catchHeight + ((mergeEnd - catchTime) / (bottomTime - catchTime)) * (100 - catchHeight);
        animations.current = [
          first.animate(
            [
              pulse(0, 0, 0.9),
              pulse(catchTime, catchHeight, 1),
              pulse(bottomTime, 100, 0.85),
              pulse(ultraDuration, 100, 0, 0),
            ],
            timing,
          ),
          second.animate(
            [
              pulse(0, 0, 0),
              pulse(launchGap, 0, 0, 10),
              pulse(launchGap + 12, (12 / (catchTime - launchGap)) * catchHeight, 0.95, 10),
              pulse(catchTime, catchHeight, 1, 10),
              pulse(mergeEnd, mergedHead, 0, 10),
              pulse(ultraDuration, 100, 0, 0),
            ],
            timing,
          ),
          burst.animate(
            [
              { offset: 0, opacity: 0, strokeDashoffset: 1 },
              { offset: offset(catchTime), opacity: 0, strokeDashoffset: 1 },
              { offset: offset(catchTime + 12), opacity: 1, strokeDashoffset: 0.32 },
              { offset: offset(catchTime + 30), opacity: 0.65, strokeDashoffset: 0 },
              { offset: offset(229), opacity: 0, strokeDashoffset: 0 },
              { offset: 1, opacity: 0, strokeDashoffset: 0 },
            ],
            timing,
          ),
        ];
      }
      await Promise.all(animations.current.map((animation) => animation.finished));
      if (revision.current === id) stop();
    } catch {
      if (revision.current === id) stop();
    }
  }

  return { button, glyph, fill, beam, single, lead, chase, branches, phase, start, stop };
}

export function SpeedDischarge({ motion }: { motion: ReturnType<typeof useSpeedMotion> }) {
  return (
    <div className="model-discharge" ref={motion.beam} aria-hidden="true">
      <svg viewBox="0 0 48 360" preserveAspectRatio="none">
        <g className="model-discharge-single" ref={motion.single}>
          <path className="model-discharge-glow" d={divider} vectorEffect="non-scaling-stroke" />
          <path className="model-discharge-core" d={divider} vectorEffect="non-scaling-stroke" />
          <path
            className="model-discharge-branches"
            d="M20 122 L12 144 L15 158 M28 256 L35 270 L32 284"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g className="model-discharge-pulse" data-pulse="lead" ref={motion.lead}>
          <path className="model-discharge-glow" d={divider} vectorEffect="non-scaling-stroke" />
          <path className="model-discharge-core" d={divider} vectorEffect="non-scaling-stroke" />
        </g>
        <g className="model-discharge-pulse" data-pulse="chase" ref={motion.chase}>
          <path className="model-discharge-glow" d={divider} vectorEffect="non-scaling-stroke" />
          <path className="model-discharge-core" d={divider} vectorEffect="non-scaling-stroke" />
        </g>
        <g className="model-discharge-burst" ref={motion.branches}>
          <path
            className="model-discharge-glow"
            d="M25 227 L27.5 251"
            vectorEffect="non-scaling-stroke"
          />
          <path d="M26.3 240 L18 231 L13 234" pathLength="1" vectorEffect="non-scaling-stroke" />
          <path d="M26.3 240 L35 231 L40 234" pathLength="1" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
    </div>
  );
}
