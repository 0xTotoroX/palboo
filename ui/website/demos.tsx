import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Product feature adapters, synthetic portfolio content and visitor input.
 * [OUTPUT]: One example chat with actual feature components, model/meter demonstrations and local draft helpers.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
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
import { headings } from './demo-state';
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

export function FeatureDemo({
  active,
  onChange,
}: {
  active: FeatureId;
  onChange: (id: FeatureId) => void;
}) {
  useLocale();
  const uid = useId();
  const [draft, setDraft] = useState('');
  const [heading, setHeading] = useState(0);
  const [reset, setReset] = useState(0);
  const article = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
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
    <div className="product-demo" data-feature={active} aria-label={tr('Palboo 交互演示')}>
      <div className="demo-window-body">
        <aside className={`demo-panel demo-panel-${active}`}>
          <div className="demo-panel-top">
            <Eyes />
            <span>Palboo</span>
            <button
              className="icon-button"
              aria-label={tr('重置功能演示')}
              onClick={() => {
                setDraft('');
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
                <NextDemo onInsert={insert} />
              </div>
              <div hidden={active !== 'prompts'}>
                <QuickPhrasesDemo onInsert={insert} />
              </div>
              <div hidden={active !== 'outline'}>
                <OutlineDemo
                  onJump={(index) => {
                    setHeading(index);
                    const container = article.current!;
                    const target = container.querySelectorAll('section')[index];
                    container.scrollTo({
                      top:
                        target.getBoundingClientRect().top -
                        container.getBoundingClientRect().top +
                        container.scrollTop -
                        6,
                    });
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
                <TermDemo />
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
                      <button className="inline-term" onClick={() => onChange('terms')}>
                        {tr('响应式布局')}
                      </button>
                      {tr('适配电脑与手机，保留简介、作品和联系方式。')}
                    </>
                  ) : (
                    tr('检查小屏阅读、图片加载和联系链接，再请朋友试用。')
                  )}
                </p>
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
    </div>
  );
}
