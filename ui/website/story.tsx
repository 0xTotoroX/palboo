/* [INPUT]: Original brand poses, native section progress and local feature demos.
 * [OUTPUT]: Complete brand opening, eye-to-entry flight and continuous reading story.
 * [POS]: Website narrative composition; all examples describe one portfolio project.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { BrandOpening } from './brand-opening';
import { GithubLink, type GithubLinkVariant } from './github-link';
import { Eyes, FeatureDemo, type FeatureId } from './demos';
import { clamp, smooth, useScrollScene } from './scroll-motion';

export function OpeningStory({ githubVariant }: { githubVariant?: GithubLinkVariant }) {
  const { ref, progress, staticView, scrollToStart } = useScrollScene();
  const brand = useRef<HTMLDivElement>(null);
  const entry = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  const [landing, setLanding] = useState({ x: 0, y: 0, scale: 0.1 });
  const measureLanding = useCallback(() => {
    const source = brand.current!.getBoundingClientRect();
    const destination = entry.current!.getBoundingClientRect();
    const next = {
      x: destination.x + destination.width / 2 - source.x - source.width / 2,
      y: destination.y + destination.height / 2 - source.y - (source.height * 307) / 620,
      scale: 18 / ((source.width * 222) / 1200),
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
    measureLanding();
    return () => observer.disconnect();
  }, [ref, measureLanding]);
  useLayoutEffect(measureLanding, [measureLanding, progress]);
  const travel = staticView ? 0 : clamp(progress / 0.9);
  const x = landing.x * (1 - (1 - travel) ** 3);
  const y = landing.y * smooth(travel) ** 1.3;
  const scale = Math.pow(landing.scale, smooth(travel));
  const reveal = staticView ? 1 : smooth((progress - 0.78) / 0.16);
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
              // Turn toward the rail before descending past the headline. Keep
              // the same SVG at the destination, including its blush and spacing.
              transform: `translate(${x}px, ${y}px) scale(${scale})`,
            }}
          >
            <BrandOpening travelling={!staticView && progress > 0} replay={replay} />
          </div>
          <button
            className="brand-replay"
            aria-label="重播品牌开场"
            title="重播开场"
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
                  opacity: 1 - smooth(progress / 0.16),
                  visibility: progress >= 0.16 ? 'hidden' : 'visible',
                }
          }
        >
          <h1 id="page-title">
            让对话，
            <br className="mobile-break" />
            多一维度
          </h1>
          <p>
            Palboo，你的 Codex 桌面搭档。
            <br />
            读懂长回答，接着推进，把常用工具放在对话旁。
          </p>
          <GithubLink variant={githubVariant} />
        </div>
        <div
          ref={preview}
          className="intro-preview"
          aria-label="Codex 中的 Palboo 外观示例"
          style={
            staticView ? undefined : { top: `calc(68svh - ${smooth(progress / 0.6) * 58}svh)` }
          }
        >
          <div className="intro-titlebar">
            <span className="window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>个人作品集</span>
            <span>Codex</span>
          </div>
          <div className="intro-rail">
            <span>Codex</span>
            <div className="intro-rail-lines">
              <span>新聊天</span>
              <span>搜索聊天</span>
              <span>自动化</span>
              <span>项目</span>
              <span>个人作品集</span>
            </div>
            <div ref={entry} className="intro-entry">
              <span style={{ opacity: staticView ? 1 : 0 }}>
                <Eyes />
              </span>
            </div>
          </div>
          <div className="intro-chat">
            <div className="intro-chat-heading">
              周末做一个个人作品集 <span>GPT-6.1-Sol</span>
            </div>
            <p>我想用周末做一个个人作品集，第一版应该怎么安排？</p>
            <h3>从一个完整的小版本开始。</h3>
            <p>
              选好代表作品，写清你的贡献。
              <br />
              先把内容讲清楚，再完善展示。
            </p>
            <ol className="intro-answer">
              <li>周六整理三个代表作品，写清背景与结果。</li>
              <li>周日完成首页，让手机和电脑都能顺畅阅读。</li>
              <li>最后检查图片与联系链接，再邀请朋友试用。</li>
            </ol>
            <div className="intro-input">
              <span>询问后续问题</span>
              <div>
                <Icon name="plus" />
                <span>GPT-6.1-Sol · Low</span>
                <Icon name="feature-next" />
              </div>
            </div>
          </div>
          <div
            className="intro-panel"
            style={{
              opacity: 0.12 + reveal * 0.88,
              transform: `translateX(${18 * (1 - reveal)}px)`,
            }}
          >
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
    title: '下一步。\n让对话继续推进。',
    text: '根据最近一问一答，给出可以继续的下一步。选中建议，填入输入框，接着推进你的想法。',
    detail:
      '自动生成或手动刷新。方向可以自选、自动探索或智能挑选；内置方向和常用提示词都能编辑，也能添加自己的内容。填入或直接发送，由你选择。生成建议需配置模型服务。',
  },
  {
    feature: 'outline',
    title: '大纲。\n长回答也能快速定位。',
    text: '把回答里的标题变成目录。方案、步骤、检查清单，想回看哪一段，就直接跳到哪一段。',
    detail:
      '标题在本机提取，不额外调用模型。工作台可以跟随当前聊天，也可以锁定正在阅读的聊天；切换功能时保留阅读位置。',
  },
  {
    feature: 'terms',
    title: '术语释义。\n读到哪里，理解到哪里。',
    text: '遇到不熟悉的词，就在阅读的位置查看释义。想继续了解的收藏起来，已经理解的标为掌握。',
    detail:
      '使用本机词库，也可用模型按语境识别。只填名称或导入文件，下次主聊天运行时交给当前 Agent 整理。个人添加、收藏和已掌握的词条可以导出，卡片外观可单独设置。',
  },
];
export function ReadingStory() {
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
      if (!engaged) layoutFocus.current = false;
    };
    addEventListener('wheel', resumeReading, { passive: true });
    addEventListener('touchmove', resumeReading, { passive: true });
    return () => {
      removeEventListener('wheel', resumeReading);
      removeEventListener('touchmove', resumeReading);
    };
  }, [engaged]);
  useLayoutEffect(() => {
    let request = 0;
    const revealEditor = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
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
    revealEditor();
    addEventListener('resize', revealEditor);
    return () => {
      cancelAnimationFrame(request);
      removeEventListener('resize', revealEditor);
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
            onPointerDownCapture={(event) => {
              keyboard.current = false;
              layoutFocus.current = false;
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
