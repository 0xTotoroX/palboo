import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Product feature adapters, model preview, synthetic portfolio content and visitor input.
 * [OUTPUT]: One example chat with actual feature components, model/meter demonstrations and local draft helpers.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../shared/icons/react';
import { ModelPreview } from '../settings/model-preview';
import { TokenMeterView } from '../features/token-meter/view';
import type { ModelState } from '../features/model/catalog';
import { NextDemo, OutlineDemo, BoardDemo, TermDemo, BotDemo } from './product-demos';
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

const exampleModels: ModelState = {
  revision: 0,
  snapshot: {
    target: { preview: true },
    revision: 'website-example',
    status: 'ready',
    message: '',
    current: null,
    models: [
      {
        id: 'gpt-6.1-sol',
        label: 'GPT-6.1-Sol',
        reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        fast: true,
      },
      {
        id: 'gpt-6-astra',
        label: 'GPT-6-Astra',
        reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        fast: true,
      },
    ],
    usage: [
      { minutes: 10080, remainingPercent: 72, resetsAt: null },
      { minutes: 300, remainingPercent: 86, resetsAt: null },
    ],
  },
  preferences: {
    enabled: true,
    showUsage: true,
    pinned: ['gpt-6.1-sol', 'gpt-6-astra'],
    presets: [],
  },
};
const modelStops = [
  { model: 'gpt-6.1-sol', reasoning: 'low', speed: 'standard' },
  { model: 'gpt-6-astra', reasoning: 'high', speed: 'standard' },
  { model: 'gpt-6-astra', reasoning: 'high', speed: 'fast' },
] as const;
export function ModelDemo({ tourStep }: { tourStep?: number } = {}) {
  useLocale();
  return (
    <div className="demo-models" aria-label={tr('Codex 模型快切演示')}>
      <ModelPreview
        model={exampleModels}
        demoSelection={tourStep === undefined ? undefined : modelStops[tourStep]}
      />
    </div>
  );
}
export function SpeedDemo({ tourStep }: { tourStep?: number } = {}) {
  useLocale();
  const [phase, setPhase] = useState('streaming');
  useEffect(() => {
    if (tourStep !== undefined)
      setPhase(['waiting', 'thinking', 'tool', 'streaming', 'completed'][tourStep]);
  }, [tourStep]);
  return (
    <div className="speed-demo">
      <div className="choice-row" role="group" aria-label={tr('测速状态演示')}>
        {[
          ['waiting', tr('等待输出')],
          ['thinking', tr('思考中')],
          ['tool', tr('工具执行中')],
          ['streaming', tr('生成中')],
          ['completed', tr('已完成')],
        ].map(([id, title]) => (
          <button key={id} aria-pressed={phase === id} onClick={() => setPhase(id)}>
            {title}
          </button>
        ))}
      </div>
      <p>
        {phase === 'waiting'
          ? tr('已发送：帮我安排作品集的第一版。')
          : phase === 'thinking'
            ? tr('正在梳理作品、页面与时间安排…')
            : tr('先整理作品素材，再完成页面布局，最后检查移动端和联系链接。')}
      </p>
      <div className="speed-readout">
        <span>{tr('示例回复')}</span>
        <TokenMeterView
          snapshot={{
            threadId: 'website-example',
            phase,
            speed: phase === 'streaming' ? 38.4 : null,
            lastSpeed: 38.4,
            model: 'GPT-6-Astra',
            fast: false,
            official:
              phase === 'completed'
                ? {
                    inputTokens: 1120,
                    cachedInputTokens: 800,
                    outputTokens: 248,
                    reasoningOutputTokens: 96,
                  }
                : null,
            scope: 'turn',
            average: phase === 'completed' ? 21.6 : null,
          }}
        />
      </div>
    </div>
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
