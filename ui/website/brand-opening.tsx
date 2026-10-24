/* [INPUT]: Original v3 SVG/pose timeline, scroll progress and motion preference.
 * [OUTPUT]: One reversible clock for the complete O morph, blinks and blush.
 * [POS]: Website transport only; original artwork and authored poses stay unchanged.
 * [PROTOCOL]: Keep website/AGENTS.md and media/README.md in sync. */
import { useLayoutEffect, useRef } from 'react';
import { createBrandPose } from './brand-poses';
import { clamp } from './scroll-motion';
import artwork from './media/palboo-opening.svg?raw';

export function BrandOpening({ progress, staticView }: { progress: number; staticView: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pose = useRef<ReturnType<typeof createBrandPose> | null>(null);
  useLayoutEffect(() => {
    pose.current = createBrandPose(ref.current!);
    return () => {
      pose.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    // Finish the original sequence before the separate spatial journey begins.
    // A single scroll clock also makes a rapid reversal deterministic.
    pose.current?.render(staticView ? 6.8 : 1.15 + clamp(progress / 0.6) * 5.65);
  }, [progress, staticView]);
  return (
    <div className="brand-opening">
      <div className="original-opening" ref={ref} dangerouslySetInnerHTML={{ __html: artwork }} />
    </div>
  );
}
