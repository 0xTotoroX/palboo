import { PreviewFrame } from '../settings/preview-frame';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Product feature adapters, synthetic portfolio content and visitor input.
 * [OUTPUT]: One example chat with actual feature components, model/meter demonstrations and local draft helpers.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../shared/icons/react';
import { ModelDemo } from './model-demo';
export { ModelDemo } from './model-demo';
import {
  NextDemo,
  QuickPhrasesDemo,
  OutlineDemo,
  BoardDemo,
  TermDemo,
  BotDemo,
} from './product-demos';
import { headings, sampleProjection } from './demo-state';
import { sampleTerms } from '../shared/demo-state';
import { flyText, reducedMotion, markFilled, shadowQuery } from './narrative';
export { BoardDemo, BotDemo, TermDemo, botSampleNames } from './product-demos';
export { headings } from './demo-state';

export const features = [
  {
    id: 'next',
    get label() {
      return tr('下一步');
    },
    icon: 'feature-next',
  },
  {
    id: 'prompts',
    get label() {
      return tr('常用语');
    },
    icon: 'feature-prompts',
  },
  {
    id: 'outline',
    get label() {
      return tr('大纲');
    },
    icon: 'feature-outline',
  },
  {
    id: 'board',
    get label() {
      return tr('任务看板');
    },
    icon: 'feature-board',
  },
  {
    id: 'model',
    get label() {
      return tr('模型切换');
    },
    icon: 'feature-model',
  },
  {
    id: 'terms',
    get label() {
      return tr('术语释义');
    },
    icon: 'feature-terms',
  },
  { id: 'bots', label: 'Grok Bot', icon: 'feature-bots' },
] as const;
export type FeatureId = (typeof features)[number]['id'];
export function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  let next = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}
export function Eyes() {
  useLocale();
  return (
    <span className="demo-eyes" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function ComposerDemo({
  draft,
  onChange,
  label = tr('接着聊'),
}: {
  draft: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  useLocale();
  const id = useId();
  return (
    <div className="demo-composer">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        placeholder={tr('接着聊…')}
        rows={2}
      />
    </div>
  );
}

/* ---------- 阅读章节的功能叙事：每章三拍，由正文滚动推进 ----------
 * 下一步：上下文 → 选中建议 → 填入草稿；大纲：目录项 → 对应段落；
 * 术语：正文关键词 → 词条 → 收藏 → 掌握。访客草稿与手动定位始终优先。 */
const suggestion = () => sampleProjection(false).prompts[0];

export function FeatureDemo({
  active,
  onChange,
  tourBeat,
  oneShot = false,
}: {
  active: FeatureId;
  onChange: (id: FeatureId) => void;
  tourBeat?: number;
  /** 静态/窄屏回退：进入阅读区后把三拍因果播放一次并停在终态。 */
  oneShot?: boolean;
}) {
  useLocale();
  const uid = useId();
  const [ownDraft, setOwnDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [heading, setHeading] = useState(0);
  const manualHeading = useRef(false);
  const [reset, setReset] = useState(0);
  const article = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const draft = touched ? ownDraft : autoFilled ? suggestion().prompt : '';
  const setDraft = (value: string | ((current: string) => string)) => {
    setOwnDraft(typeof value === 'function' ? value(draft) : value);
    setTouched(true);
  };
  const jump = (index: number) => {
    setHeading(index);
    const container = article.current;
    const target = container?.querySelectorAll('section')[index];
    if (!container || !target) return;
    container.scrollTo({
      top:
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        6,
    });
  };
  const [shot, setShot] = useState<number | undefined>(undefined);
  const shotHalted = useRef(false);
  useEffect(() => {
    setShot(undefined);
    shotHalted.current = false;
    const node = scene.current;
    if (!oneShot || !node || reducedMotion()) return;
    const timers: number[] = [];
    const halt = () => {
      shotHalted.current = true;
      timers.forEach(clearTimeout);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        node.dataset.oneShot = 'played';
        for (let index = 0; index < 3; index += 1)
          timers.push(
            window.setTimeout(() => !shotHalted.current && setShot(index), 200 + index * 900),
          );
      },
      { rootMargin: '0px 0px -30% 0px', threshold: 0.2 },
    );
    observer.observe(node);
    node.addEventListener('pointerdown', halt, true);
    node.addEventListener('focusin', halt, true);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      node.removeEventListener('pointerdown', halt, true);
      node.removeEventListener('focusin', halt, true);
    };
  }, [oneShot, active, reset]);
  const rawBeat = tourBeat ?? (oneShot ? shot : undefined);
  const beat = rawBeat === undefined ? undefined : Math.max(0, Math.min(2, rawBeat));
  // 下一步：第三拍把选中的建议带入草稿；回看时撤回自动示例，访客草稿不动。
  useEffect(() => {
    if (active !== 'next' || beat === undefined || touched) return;
    const want = beat >= 2;
    if (want === autoFilled) return;
    if (!want) return setAutoFilled(false);
    const root = scene.current;
    // 落地才填入；回看、卸载或访客接管时取消飞行，过期的落地回调不会执行。
    return flyText(
      shadowQuery(root, 'next', '.csw-row[data-index="0"]'),
      root?.querySelector('.demo-composer'),
      suggestion().label,
      () => {
        setAutoFilled(true);
        markFilled(root?.querySelector('.demo-composer'));
      },
    );
  }, [active, beat, touched, autoFilled]);
  // 大纲：逐拍定位到对应段落；术语：回到含关键词的段落。手动定位后不再改写。
  useEffect(() => {
    if (beat === undefined || manualHeading.current) return;
    if (active === 'outline') jump(beat);
    else if (active === 'terms') jump(1);
  }, [active, beat]);
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = content.current?.animate(
      [
        { opacity: 0.6, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    );
    return () => animation?.cancel();
  }, [active]);
  const insert = (value: string) =>
    setDraft((current) => (current ? `${current}\n${value}` : value));
  const selected = features.find((feature) => feature.id === active)!;
  return (
    <PreviewFrame
      className="site-preview product-demo"
      data-feature={active}
      title={tr('Palboo 交互演示')}
    >
      <div ref={scene} className="demo-window-body" data-tour-beat={beat ?? ''}>
        <aside className={`demo-panel demo-panel-${active}`}>
          <div className="demo-panel-top">
            <Eyes />
            <span>Palboo</span>
            <button
              className="icon-button"
              aria-label={tr('重置功能演示')}
              onClick={() => {
                setOwnDraft('');
                // 重置属于手动接管，取消未落地的示例并保持空草稿。
                setTouched(true);
                setAutoFilled(false);
                manualHeading.current = false;
                setHeading(0);
                setReset((value) => value + 1);
              }}
            >
              <Icon name="refresh" />
            </button>
          </div>
          <div
            className="demo-feature-tabs"
            role="tablist"
            aria-label={tr('演示功能')}
            onKeyDown={tabKeys}
          >
            {features.map((feature) => (
              <button
                key={feature.id}
                id={`${uid}-${feature.id}`}
                role="tab"
                aria-selected={active === feature.id}
                aria-controls={`${uid}-panel`}
                aria-label={feature.label}
                title={feature.label}
                tabIndex={active === feature.id ? 0 : -1}
                onClick={() => onChange(feature.id)}
              >
                <Icon name={feature.icon} />
              </button>
            ))}
          </div>
          <div
            id={`${uid}-panel`}
            ref={content}
            className="demo-feature-content"
            role="tabpanel"
            aria-labelledby={`${uid}-${active}`}
          >
            <div className="demo-content-heading">
              <span>{selected.label}</span>
            </div>
            <div key={reset}>
              <div hidden={active !== 'next'}>
                <NextDemo onInsert={insert} onManual={() => setDraft(draft)} />
              </div>
              <div hidden={active !== 'prompts'}>
                <QuickPhrasesDemo onInsert={insert} />
              </div>
              <div hidden={active !== 'outline'}>
                <OutlineDemo
                  onJump={(index) => {
                    manualHeading.current = true;
                    jump(index);
                  }}
                />
              </div>
              <div hidden={active !== 'board'}>
                <BoardDemo />
              </div>
              <div hidden={active !== 'model'}>
                <ModelDemo />
              </div>
              <div hidden={active !== 'terms'}>
                <TermDemo tourBeat={active === 'terms' ? beat : undefined} />
              </div>
              <div hidden={active !== 'bots'}>
                <BotDemo onInsert={insert} />
              </div>
            </div>
          </div>
        </aside>
        <div className="demo-chat">
          <div className="chat-title">
            <span>Codex</span>
            <span>{tr('个人作品集')}</span>
          </div>
          <div className="chat-question">
            {tr('我想用周末做一个个人作品集，')}
            <br />
            {tr('第一版应该怎么安排？')}
          </div>
          <article ref={article}>
            <p>{tr('先让别人看懂你做过什么。')}</p>
            {headings().map((title, index) => (
              <section
                key={title}
                className={
                  active === 'outline' && heading === index
                    ? 'chat-paragraph is-focused'
                    : 'chat-paragraph'
                }
              >
                <h3>{title}</h3>
                <p>
                  {index === 0 ? (
                    tr('选三个代表作品，写清问题、你的贡献和最终结果。')
                  ) : index === 1 ? (
                    <>
                      {tr('用')}
                      <button
                        className={
                          active === 'terms' && beat !== undefined
                            ? 'inline-term is-linked'
                            : 'inline-term'
                        }
                        onClick={() => onChange('terms')}
                      >
                        {tr('响应式布局')}
                      </button>
                      {tr('适配电脑与手机，保留简介、作品和联系方式。')}
                    </>
                  ) : (
                    tr('检查小屏阅读、图片加载和联系链接，再请朋友试用。')
                  )}
                </p>
                {index === 1 && active === 'terms' && beat !== undefined && (
                  <p className="term-gloss">
                    <span>{tr('本机词库释义')}</span>
                    {sampleTerms()[0].definition}
                  </p>
                )}
                {index > 0 && <h4>{tr(index === 1 ? '桌面与手机' : '素材与加载')}</h4>}
                <p>
                  {
                    [
                      tr(
                        '每个作品保留背景、过程和结果，配两三张能说明问题的图片。先整理素材，再决定页面的视觉表现。',
                      ),
                      tr(
                        '电脑上可以并排展示，手机上改成纵向排列。让标题、图片和正文在不同宽度下都有清楚的阅读顺序。',
                      ),
                      tr(
                        '在真实手机上读一遍，检查图片尺寸、文字换行和按钮位置。确认所有联系入口可用，再把链接发给朋友。',
                      ),
                    ][index]
                  }
                </p>
              </section>
            ))}
          </article>
          <ComposerDemo draft={draft} onChange={setDraft} />
        </div>
      </div>
    </PreviewFrame>
  );
}
