import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Original brand poses, native section progress and the shared settings device/material scene.
 * [OUTPUT]: One brand/layout/material scroll journey and a focus-safe reading story.
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
import { FeatureDemo, type FeatureId } from './demos';
import { SurfaceStory } from './workspace-demo';
import { clamp, smooth, useScrollScene } from './scroll-motion';
import {
  layoutStops,
  materialStops,
  openingTiming,
  openingDistance,
  materialStart,
  stopAt,
} from './scroll-tour';

export function OpeningStory({ githubVariant }: { githubVariant?: GithubLinkVariant }) {
  useLocale();
  const { ref, progress, staticView, scrollToStart } = useScrollScene();
  const brand = useRef<HTMLDivElement>(null);
  const entry = useRef<SVGGElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [tourPaused, setTourPaused] = useState(false);
  const dragging = useRef(false);
  const [heldMaterial, setHeldMaterial] = useState<number | null>(null);
  const [staticMaterial, setStaticMaterial] = useState(0);
  const distance = progress * openingDistance;
  // Keep the original brand flight; give each layout/material its own reading distance.
  const sceneProgress = engaged ? 1 : clamp(distance / openingTiming.intro);
  const materialProgress =
    heldMaterial ??
    (staticView ? staticMaterial : smooth((distance - materialStart) / openingTiming.transition));
  const playing = !staticView && !tourPaused;
  const layoutStop =
    layoutStops[
      stopAt(
        (distance - openingTiming.intro) / (layoutStops.length * openingTiming.layoutStep),
        layoutStops.length,
      )
    ];
  const materialStop =
    materialStops[
      stopAt(
        (distance - materialStart - openingTiming.transition) /
          (materialStops.length * openingTiming.materialStep),
        materialStops.length,
      )
    ];
  const [shownLayout, setShownLayout] = useState<typeof layoutStop | undefined>(() =>
    staticView ? undefined : layoutStop,
  );
  const [shownMaterial, setShownMaterial] = useState<typeof materialStop | undefined>(() =>
    staticView ? undefined : materialStop,
  );
  useEffect(() => {
    if (!playing) return;
    setShownLayout(layoutStop);
    setShownMaterial(materialStop);
  }, [playing, layoutStop, materialStop]);
  useEffect(() => {
    const resumeScrolling = () => {
      // Button focus protects a click from reflow, but does not latch the story
      // after the visitor returns to the wheel. Active text editing keeps its view.
      if (
        dragging.current ||
        (preview.current?.contains(document.activeElement) &&
          document.activeElement?.matches('input, textarea, select, [contenteditable="true"]'))
      )
        return;
      setEngaged(false);
      setTourPaused(false);
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
  const zoom = staticView ? 1 : smooth((sceneProgress - 0.2) / 0.55);
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
            {tr('多一维度')}
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
            setTourPaused(true);
          }}
          onDragStartCapture={() => {
            dragging.current = true;
            setTourPaused(true);
          }}
          onDragEndCapture={() => {
            dragging.current = false;
          }}
          onFocusCapture={(event) => {
            setEngaged(true);
            setTourPaused(true);
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
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setEngaged(false);
              setHeldMaterial(null);
            }
          }}
          style={
            staticView
              ? undefined
              : {
                  transform: `translate(-50%, ${44 * (1 - smooth(sceneProgress / 0.6))}svh)`,
                }
          }
        >
          <SurfaceStory
            zoom={zoom}
            reveal={reveal}
            interactive={interactive}
            entryRef={entry}
            materialProgress={materialProgress}
            layoutStop={shownLayout}
            materialStop={shownMaterial}
          />
        </div>
      </div>
    </section>
  );
}

const chapters: { feature: FeatureId; title: string; text: string; detail: string }[] = [
  {
    feature: 'next',
    get title() {
      return tr('下一步。\n让对话继续推进。');
    },
    get text() {
      return tr('根据最近一问一答，给出可以继续的下一步。选中建议，填入输入框，接着推进你的想法。');
    },
    get detail() {
      return tr(
        '自动生成或手动刷新。方向可以自选、自动探索或智能挑选；内置方向和常用提示词都能编辑，也能添加自己的内容。填入或直接发送，由你选择。生成建议需配置模型服务。',
      );
    },
  },
  {
    feature: 'outline',
    get title() {
      return tr('大纲。\n长回答也能快速定位。');
    },
    get text() {
      return tr('把回答里的标题变成目录。方案、步骤、检查清单，想回看哪一段，就直接跳到哪一段。');
    },
    get detail() {
      return tr(
        '标题在本机提取，不额外调用模型。工作台可以跟随当前聊天，也可以锁定正在阅读的聊天；切换功能时保留阅读位置。',
      );
    },
  },
  {
    feature: 'terms',
    get title() {
      return tr('术语释义。\n读到哪里，理解到哪里。');
    },
    get text() {
      return tr(
        '遇到不熟悉的词，就在阅读的位置查看释义。想继续了解的收藏起来，已经理解的标为掌握。',
      );
    },
    get detail() {
      return tr(
        '使用本机词库，也可用模型按语境识别。只填名称或导入文件，下次主聊天运行时交给当前 Agent 整理。个人添加、收藏和已掌握的词条可以导出，卡片外观可单独设置。',
      );
    },
  },
];
export function ReadingStory() {
  useLocale();
  const { ref, activeIndex: index, staticView } = useScrollScene('.story-copy h2');
  const [active, setActive] = useState<FeatureId[]>(chapters.map((chapter) => chapter.feature));
  const [primary, setPrimary] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<FeatureId | null>(null);
  const keyboard = useRef(false);
  const layoutFocus = useRef(false);
  const previousStatic = useRef(staticView);
  useLayoutEffect(() => {
    if (previousStatic.current === staticView) return;
    previousStatic.current = staticView;
    const hasFocus = ref.current?.contains(document.activeElement);
    layoutFocus.current = !!hasFocus;
    if (staticView) {
      setActive((current) =>
        current.map((feature, i) => (hasFocus && i === primary ? feature : chapters[i].feature)),
      );
    }
  }, [staticView, engaged, primary, ref]);
  useEffect(() => {
    const resumeReading = () => {
      if (engaged || dragging) return;
      layoutFocus.current = false;
      // Reflow or focus scrolling may already have measured the next chapter.
      // Apply it only once the visitor resumes reading, not during the action.
      if (!staticView && pending.current) {
        const feature = pending.current;
        pending.current = null;
        setActive((current) => current.map((value, i) => (i === primary ? feature : value)));
      }
    };
    const resumeOutside = (event: PointerEvent) => {
      const stage = (event.target as Element | null)?.closest?.('.reading-stage');
      if (!stage || !ref.current?.contains(stage)) resumeReading();
    };
    addEventListener('wheel', resumeReading, { passive: true });
    addEventListener('touchmove', resumeReading, { passive: true });
    addEventListener('pointerdown', resumeOutside, { passive: true });
    return () => {
      removeEventListener('wheel', resumeReading);
      removeEventListener('touchmove', resumeReading);
      removeEventListener('pointerdown', resumeOutside);
    };
  }, [engaged, dragging, staticView, primary, ref]);
  useLayoutEffect(() => {
    let request = 0;
    const revealEditor = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
        if (!engaged && !layoutFocus.current) return;
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || !ref.current?.contains(focused)) return;
        const box = focused.getBoundingClientRect();
        if (box.top < 16 || box.bottom > innerHeight - 16) {
          focused.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
      });
    };
    // Only correct layout changes while editing. Ordinary document scrolling
    // and completed pointer actions are never captured.
    const preserveOnResize = () => {
      // Resize/scroll can arrive before the media-query change. Protect focus
      // before either can replace its feature with the newly measured chapter.
      layoutFocus.current = !!ref.current?.contains(document.activeElement);
      revealEditor();
    };
    revealEditor();
    addEventListener('resize', preserveOnResize);
    return () => {
      cancelAnimationFrame(request);
      removeEventListener('resize', preserveOnResize);
    };
  }, [staticView, engaged, ref]);
  useEffect(() => {
    pending.current = staticView ? null : chapters[index].feature;
  }, [index, staticView, primary]);
  useEffect(() => {
    if (staticView || engaged || dragging || layoutFocus.current || !pending.current) return;
    const feature = pending.current;
    pending.current = null;
    setActive((current) => current.map((value, i) => (i === primary ? feature : value)));
  }, [index, staticView, primary, engaged, dragging]);
  return (
    <section
      ref={ref}
      className="reading-story page-width"
      data-static={staticView}
      aria-label={tr('下一步、大纲与术语')}
    >
      {chapters.map((chapter, i) => (
        <div key={chapter.feature} className="static-chapter">
          <article className="story-copy" data-chapter={chapter.feature} style={{ gridRow: i + 1 }}>
            <h2>{chapter.title}</h2>
            <p>{chapter.text}</p>
            <p>{chapter.detail}</p>
          </article>
          <div
            className="reading-stage"
            hidden={!staticView && primary !== i}
            onPointerDownCapture={(event) => {
              keyboard.current = false;
              // Keep the chosen feature through focus scrolling and reflow;
              // wheel/touch or interaction outside the demo resumes the story.
              layoutFocus.current = true;
              setEngaged(
                !!(event.target as HTMLElement).closest(
                  'input, textarea, select, [contenteditable="true"]',
                ),
              );
            }}
            onKeyDownCapture={() => {
              keyboard.current = true;
              setEngaged(true);
            }}
            onFocusCapture={(event) => {
              setPrimary(i);
              setEngaged(
                keyboard.current ||
                  (event.target as HTMLElement).matches(
                    'input, textarea, select, [contenteditable="true"]',
                  ),
              );
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                layoutFocus.current = false;
                setEngaged(false);
              }
            }}
            onDragStartCapture={() => setDragging(true)}
            onDragEndCapture={() => setDragging(false)}
          >
            <FeatureDemo
              active={active[i]}
              onChange={(feature) => {
                pending.current = null;
                setActive((current) => current.map((value, j) => (i === j ? feature : value)));
              }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
