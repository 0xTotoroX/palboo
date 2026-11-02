import { demoFocus, isDemoPopover } from './demo-focus';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Original brand poses, native section progress and the shared settings device/material scene.
 * [OUTPUT]: A complete monitor in the first viewport, then a reversible screen/placement/material tour.
 * [POS]: Website narrative composition; all examples describe one portfolio project.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { BrandOpening } from './brand-opening';
import { GithubLink, type GithubLinkVariant } from './github-link';
import { SurfaceStory } from './workspace-demo';
import { clamp, smooth, useScrollScene } from './scroll-motion';
import { openingTiming, openingDistance, materialStart } from './scroll-tour';

export function OpeningStory({ githubVariant }: { githubVariant?: GithubLinkVariant }) {
  useLocale();
  const { ref, progress, staticView, scrollToStart } = useScrollScene();
  const brand = useRef<HTMLDivElement>(null);
  const entry = useRef<SVGGElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [monitorStart, setMonitorStart] = useState(() => innerHeight * 0.44);
  const [replay, setReplay] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const dragging = useRef(false);
  const [heldMaterial, setHeldMaterial] = useState<number | null>(null);
  const [staticMaterial, setStaticMaterial] = useState(0);
  const distance = progress * openingDistance;
  // Keep the same live screen while its stand recedes and the camera approaches.
  const sceneProgress = engaged ? 1 : clamp(distance / openingTiming.intro);
  const materialProgress =
    heldMaterial ??
    (staticView ? staticMaterial : smooth((distance - materialStart) / openingTiming.transition));
  useEffect(() => {
    const resumeScrolling = () => {
      // Button focus protects a click from reflow, but does not latch the story
      // after the visitor returns to the wheel. Active text editing keeps its view.
      const focused = demoFocus(preview.current);
      if (
        dragging.current ||
        focused?.closest('select') ||
        focused?.matches('input, textarea, [contenteditable="true"]')
      )
        return;
      setEngaged(false);
      setHeldMaterial(null);
    };
    addEventListener('wheel', resumeScrolling, { passive: true });
    addEventListener('touchmove', resumeScrolling, { passive: true });
    return () => {
      removeEventListener('wheel', resumeScrolling);
      removeEventListener('touchmove', resumeScrolling);
    };
  }, []);
  const [landing, setLanding] = useState({ x: 0, y: 0, scale: 0.1 });
  const measureLanding = useCallback(() => {
    if (!brand.current || !entry.current) return;
    if (copy.current)
      setMonitorStart(
        Math.max(
          innerHeight * 0.44,
          copy.current.offsetTop + copy.current.offsetHeight + 32 - innerHeight * 0.08,
        ),
      );
    const source = brand.current.getBoundingClientRect();
    const destination = entry.current.getBoundingClientRect();
    const next = {
      x: destination.x + destination.width / 2 - source.x - source.width / 2,
      y: destination.y + destination.height / 2 - source.y - (source.height * 307) / 620,
      scale: destination.width / ((source.width * 222) / 1200),
    };
    setLanding((current) =>
      current.x === next.x && current.y === next.y && current.scale === next.scale ? current : next,
    );
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measureLanding);
    observer.observe(ref.current!);
    observer.observe(entry.current!);
    observer.observe(brand.current!);
    observer.observe(preview.current!);
    observer.observe(copy.current!);
    const camera = new MutationObserver(measureLanding);
    camera.observe(entry.current!.ownerSVGElement!, {
      attributes: true,
      attributeFilter: ['viewBox'],
    });
    measureLanding();
    return () => {
      observer.disconnect();
      camera.disconnect();
    };
  }, [ref, measureLanding]);
  useLayoutEffect(measureLanding, [measureLanding, progress]);
  const travel = staticView ? 0 : clamp(sceneProgress / 0.55);
  const x = landing.x * (1 - (1 - travel) ** 3);
  const y = landing.y * smooth(travel) ** 1.8;
  const scale = Math.pow(landing.scale, smooth(travel));
  const zoom = staticView ? 0 : smooth((sceneProgress - 0.12) / 0.7);
  const reveal = staticView ? 1 : smooth((sceneProgress - 0.64) / 0.18);
  const interactive = staticView || sceneProgress > 0.64;
  return (
    <section
      ref={ref}
      className="opening-story"
      data-static={staticView}
      style={{ '--opening-distance': openingDistance } as CSSProperties}
      aria-labelledby="page-title"
    >
      <div className="opening-pin">
        <div
          ref={brand}
          className="brand-origin"
          style={staticView ? undefined : { opacity: 1 - smooth(materialProgress / 0.4) }}
          inert={!staticView && materialProgress > 0.4}
        >
          <div
            className="brand-flight"
            style={{
              // Turn toward the rail before descending past the headline. Keep
              // the same SVG at the destination, including its blush and spacing.
              transform: `translate(${x}px, ${y}px) scale(${scale})`,
            }}
          >
            <BrandOpening travelling={!staticView && sceneProgress > 0} replay={replay} />
          </div>
          <button
            className="brand-replay"
            aria-label={tr('重播品牌开场')}
            title={tr('重播开场')}
            style={{
              transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`,
              width: `max(44px, ${36 * scale}%)`,
              height: `max(44px, ${46 * scale}%)`,
            }}
            onClick={() => {
              scrollToStart();
              setReplay((value) => value + 1);
            }}
          />
        </div>
        <div
          ref={copy}
          className="opening-copy"
          style={
            staticView
              ? undefined
              : {
                  opacity: 1 - smooth(sceneProgress / 0.16),
                  visibility: sceneProgress >= 0.16 ? 'hidden' : 'visible',
                }
          }
        >
          <h1 id="page-title">
            {tr('让对话，')}
            <br className="mobile-break" />
            <span className="display-soft">{tr('多一维度')}</span>
          </h1>
          <p>
            {tr('Palboo，你的 Codex 桌面搭档。')}
            <br />
            {tr('读懂长回答，接着推进，把常用工具放在对话旁。')}
          </p>
          <GithubLink variant={githubVariant} />
        </div>
        <div
          ref={preview}
          className="intro-preview"
          aria-label={tr('Codex 中的 Palboo 外观示例')}
          onPointerDownCapture={() => {
            setEngaged(true);
          }}
          onDragStartCapture={() => {
            dragging.current = true;
          }}
          onDragEndCapture={() => {
            dragging.current = false;
          }}
          onFocusCapture={(event) => {
            setEngaged(true);
            const target = event.target as HTMLElement;
            const next = target.closest('.material-story')
              ? 1
              : target.closest('.workspace-controls')
                ? 0
                : materialProgress;
            setHeldMaterial(next);
            setStaticMaterial(next);
          }}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null) &&
              !isDemoPopover(event.relatedTarget)
            ) {
              setEngaged(false);
              setHeldMaterial(null);
            }
          }}
          style={
            staticView
              ? undefined
              : ({
                  '--monitor-approach': zoom,
                  '--monitor-start': `${monitorStart}px`,
                  transform: `translate(-50%, ${monitorStart * (1 - zoom)}px)`,
                } as CSSProperties)
          }
        >
          <SurfaceStory
            zoom={zoom}
            reveal={reveal}
            interactive={interactive}
            entryRef={entry}
            materialProgress={materialProgress}
            tourDistance={staticView || engaged ? undefined : distance}
            standProgress={zoom}
          />
        </div>
      </div>
    </section>
  );
}
