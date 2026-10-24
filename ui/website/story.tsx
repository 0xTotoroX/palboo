/* [INPUT]: Original brand poses, native section progress, shared device model and local demos.
 * [OUTPUT]: Brand-to-entry opening, continuous reading story and reversible surface journey.
 * [POS]: Website narrative composition; all examples describe one portfolio project.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { demoFrames, type DemoFrame } from '../settings/layout-preview-scene';
import { BrandOpening } from './brand-opening';
import {
  Eyes,
  FeatureDemo,
  SurfaceDemo,
  surfaces,
  tabKeys,
  type FeatureId,
  type SurfaceId,
} from './demos';
import { clamp, smooth, useScrollScene } from './scroll-motion';

export function OpeningStory() {
  const { ref, progress, staticView } = useScrollScene();
  const brand = useRef<HTMLDivElement>(null);
  const entry = useRef<HTMLDivElement>(null);
  const [landing, setLanding] = useState({ x: 0, y: 0, scale: 0.1 });
  useLayoutEffect(() => {
    const measure = () => {
      const source = brand.current!.getBoundingClientRect();
      const destination = entry.current!.getBoundingClientRect();
      setLanding({
        x: destination.x + destination.width / 2 - source.x - source.width / 2,
        y: destination.y + destination.height / 2 - source.y - (source.height * 307) / 620,
        scale: 18 / ((source.width * 222) / 1200),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current!);
    observer.observe(entry.current!);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  const travel = staticView ? 0 : smooth((progress - 0.68) / 0.32);
  return (
    <section
      ref={ref}
      className="opening-story"
      data-static={staticView}
      aria-labelledby="page-title"
    >
      <div className="opening-pin">
        <div ref={brand} className="brand-origin">
          <div
            className="brand-flight"
            style={{
              transform: `translate(${landing.x * travel}px, ${landing.y * travel}px) scale(${1 + (landing.scale - 1) * travel})`,
              opacity: travel > 0.999 ? 0 : 1,
            }}
          >
            <BrandOpening progress={progress} staticView={staticView} />
          </div>
        </div>
        <div className="opening-copy">
          <h1 id="page-title">
            让对话，
            <br className="mobile-break" />
            有下一步。
          </h1>
          <p>
            Palboo，你的 Codex 桌面搭档。
            <br />
            读懂长回答，接着推进，把常用工具放在对话旁。
          </p>
          <a className="text-link" href="#install">
            了解安装
            <Icon name="feature-next" />
          </a>
        </div>
        <div className="intro-preview" aria-label="Codex 中的 Palboo 外观示例">
          <div className="intro-rail">
            <span>Codex</span>
            <div className="intro-rail-lines">
              <span>新聊天</span>
              <span>搜索聊天</span>
              <span>个人作品集</span>
            </div>
            <div ref={entry} className="intro-entry">
              <span style={{ opacity: staticView || travel > 0.999 ? 1 : 0 }}>
                <Eyes />
              </span>
            </div>
          </div>
          <div className="intro-chat">
            <p>我想用周末做一个个人作品集。</p>
            <h3>从一个完整的小版本开始。</h3>
            <p>
              选好代表作品，写清你的贡献。
              <br />
              先把内容讲清楚，再完善展示。
            </p>
            <div className="intro-input">接着聊…</div>
          </div>
          <div className="intro-panel">
            <div className="intro-icons">
              <Icon name="feature-next" />
              <Icon name="feature-outline" />
              <Icon name="feature-board" />
            </div>
            <h3>拆解第一版</h3>
            <p>把想法分成两天能完成的步骤。</p>
            <h3>检查移动端</h3>
            <p>看看小屏阅读还有哪些遗漏。</p>
            <div className="intro-quick">继续　　执行</div>
          </div>
        </div>
      </div>
    </section>
  );
}

const chapters: { feature: FeatureId; title: string; text: string; detail: string }[] = [
  {
    feature: 'next',
    title: '想好了方向，\n就接着往下走。',
    text: '根据最近一问一答，给出可以继续的下一步。选一个方向，把建议填进输入框，再按你的想法接着聊。',
    detail:
      '可以自行选择方向，也可以让 Palboo 探索。常用的“继续”“执行”，始终在手边。生成建议需要配置模型服务。',
  },
  {
    feature: 'outline',
    title: '长回答，\n也能一眼找到重点。',
    text: '回答里的标题成为可跳转的大纲。方案、步骤、检查清单，想回看哪一段，就直接到哪一段。',
    detail: '大纲在本机提取，不需要额外调用模型。',
  },
  {
    feature: 'terms',
    title: '遇到陌生概念，\n就在这里弄明白。',
    text: '结合词库查看术语释义，把想继续了解的内容收藏起来，已经理解的标为掌握。',
    detail: '可选用模型按语境识别。新词和导入文件，可以交给当前聊天的 Agent 补全与整理。',
  },
];
export function ReadingStory() {
  const { ref, progress, staticView } = useScrollScene();
  const [active, setActive] = useState<FeatureId[]>(chapters.map((chapter) => chapter.feature));
  const [primary, setPrimary] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<FeatureId | null>(null);
  const index = Math.min(2, Math.floor(progress * 3));
  useEffect(() => {
    pending.current = staticView ? null : chapters[index].feature;
  }, [index, staticView, primary]);
  useEffect(() => {
    if (staticView || engaged || dragging || !pending.current) return;
    const feature = pending.current;
    pending.current = null;
    setActive((current) => current.map((value, i) => (i === primary ? feature : value)));
  }, [index, staticView, primary, engaged, dragging]);
  return (
    <section
      ref={ref}
      className="reading-story page-width"
      data-static={staticView}
      aria-label="下一步、大纲与术语"
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
            onFocusCapture={() => {
              setPrimary(i);
              setEngaged(true);
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
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

const frameStops = [
  { at: 0, frame: demoFrames.sidebar },
  { at: 0.16, frame: demoFrames.sidebar },
  { at: 0.31, frame: demoFrames.overlay },
  { at: 0.39, frame: demoFrames.overlay },
  { at: 0.48, frame: demoFrames.popped },
  { at: 0.55, frame: demoFrames.popped },
  { at: 0.72, frame: demoFrames.desktop },
  { at: 0.79, frame: demoFrames.desktop },
  { at: 0.91, frame: demoFrames.popped },
  { at: 1, frame: demoFrames.edge },
];
function frameAt(progress: number): DemoFrame {
  const next = frameStops.findIndex((stop) => stop.at > progress);
  if (next < 0) return demoFrames.edge;
  if (next === 0) return demoFrames.sidebar;
  const a = frameStops[next - 1],
    b = frameStops[next];
  const t = smooth((progress - a.at) / (b.at - a.at));
  return Object.fromEntries(
    Object.keys(a.frame).map((key) => [
      key,
      a.frame[key as keyof DemoFrame] +
        (b.frame[key as keyof DemoFrame] - a.frame[key as keyof DemoFrame]) * t,
    ]),
  ) as DemoFrame;
}
const places = [
  {
    id: 'sidebar',
    title: '就在对话旁。',
    text: '一边读回答，一边看大纲与下一步。侧栏里的功能可以分栏、合并，也可以折叠收起。',
  },
  {
    id: 'overlay',
    title: '需要时，浮到眼前。',
    text: '把工作台展开在页面上，临时专注于一件事。收起后，聊天重新获得完整空间。',
  },
  {
    id: 'desktop',
    title: '离开聊天，留在桌面。',
    text: '弹成独立窗口，再移到副屏。让待办留在眼前，草稿和阅读位置继续保留。',
  },
  {
    id: 'edge',
    title: '靠在边缘，随手展开。',
    text: '把常用功能放到屏幕边缘或刘海处。单击图标直达，需要时展开，用完收回。',
  },
];
export function SurfaceStory() {
  const { ref, progress, staticView } = useScrollScene();
  const [override, setOverride] = useState<SurfaceId | null>(null);
  const [animate, setAnimate] = useState(true);
  const index = progress < 0.24 ? 0 : progress < 0.46 ? 1 : progress < 0.85 ? 2 : 3;
  useEffect(() => {
    if (!staticView) setOverride(null);
  }, [index, staticView]);
  const surface = override ?? (staticView ? 'sidebar' : (places[index].id as SurfaceId));
  return (
    <section
      className="surface-story page-width"
      ref={ref}
      data-static={staticView}
      aria-labelledby="surfaces-title"
    >
      <div className="section-intro">
        <h2 id="surfaces-title">
          同一个工作台，
          <br />
          放到你顺手的位置。
        </h2>
        <p>
          侧栏、页面浮层、桌面窗口之间自由切换。
          <br />
          贴边与刘海可以独立使用。
        </p>
      </div>
      <div className="surface-sticky">
        <SurfaceDemo
          surface={surface}
          animate={animate}
          scrollFrame={!staticView && !override ? frameAt(clamp(progress)) : undefined}
        />
        <div
          className="surface-tabs"
          role="tablist"
          aria-label="窗口形态"
          onPointerDown={() => setAnimate(true)}
          onKeyDown={(event) => {
            setAnimate(false);
            tabKeys(event);
          }}
        >
          {surfaces.map((item) => (
            <button
              key={item.id}
              id={`surface-${item.id}`}
              role="tab"
              aria-selected={surface === item.id}
              aria-controls="surface-caption"
              tabIndex={surface === item.id ? 0 : -1}
              onClick={() => setOverride(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          id="surface-caption"
          className="surface-caption"
          role="tabpanel"
          aria-labelledby={`surface-${surface}`}
        >
          <h3>{places.find((place) => place.id === surface)!.title}</h3>
          <p>{places.find((place) => place.id === surface)!.text}</p>
        </div>
      </div>
    </section>
  );
}
