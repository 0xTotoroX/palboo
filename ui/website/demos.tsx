import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared icons, settings device geometry, synthetic portfolio content and visitor input.
 * [OUTPUT]: Local six-feature demo, draggable board, composer helpers and shared window model.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../shared/icons/react';
import { ModelPreview } from '../settings/model-preview';
import { TokenMeterView } from '../features/token-meter/view';
import type { ModelState } from '../features/model/catalog';

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
export const headings = () => [tr('确定作品集内容'), tr('安排页面与布局'), tr('上线前检查')];
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

const statusKeys = ['待办', '进行中', '完成'];
export function BoardDemo() {
  useLocale();
  const statuses = statusKeys.map((key) => tr(key));
  const [tasks, setTasks] = useState<
    { id: number; text: string; status: number; sample?: boolean }[]
  >([
    { id: 0, text: '整理三个代表作品', sample: true, status: 0 },
    { id: 1, text: '完成首页布局', sample: true, status: 1 },
    { id: 2, text: '确定第一版范围', sample: true, status: 2 },
  ]);
  const [adding, setAdding] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [over, setOver] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const nextId = useRef(3);
  const taskButtons = useRef(new Map<number, HTMLButtonElement>());
  const movedFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (movedFocus.current !== null) {
      taskButtons.current.get(movedFocus.current)?.focus({ preventScroll: true });
      movedFocus.current = null;
    }
  }, [tasks]);
  const addButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocus = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (adding === null && restoreFocus.current !== null) {
      addButtons.current[restoreFocus.current]?.focus({ preventScroll: true });
      restoreFocus.current = null;
    }
  }, [adding]);
  const closeForm = (index: number) => {
    restoreFocus.current = index;
    setAdding(null);
    setDraft('');
  };
  const move = (id: number, status: number) =>
    setTasks((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
  return (
    <div className="demo-board" aria-label={tr('作品集任务看板')}>
      {statuses.map((status, index) => (
        <div
          key={status}
          className={over === index ? 'board-lane is-over' : 'board-lane'}
          onDragOver={(event) => {
            if (dragging.current !== null) {
              event.preventDefault();
              setOver(index);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging.current !== null) move(dragging.current, index);
            dragging.current = null;
            setOver(null);
          }}
        >
          <h4>
            {status}
            <span>{tasks.filter((task) => task.status === index).length}</span>
          </h4>
          <div className="board-cards">
            {tasks
              .filter((task) => task.status === index)
              .map((task) => (
                <div
                  key={task.id}
                  className="demo-task"
                  draggable
                  onDragStart={(event) => {
                    dragging.current = task.id;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(
                      'text/plain',
                      task.sample ? tr(task.text) : task.text,
                    );
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                    setOver(null);
                  }}
                >
                  <span>{task.sample ? tr(task.text) : task.text}</span>
                  <button
                    className="icon-button"
                    aria-label={tr('{{value1}}，移到{{value2}}', {
                      value1: task.sample ? tr(task.text) : task.text,
                      value2: statuses[(index + 1) % 3],
                    })}
                    ref={(node) => {
                      if (node) taskButtons.current.set(task.id, node);
                      else taskButtons.current.delete(task.id);
                    }}
                    onClick={() => {
                      movedFocus.current = task.id;
                      move(task.id, (index + 1) % 3);
                    }}
                  >
                    <Icon name={index === 1 ? 'check' : 'feature-next'} />
                  </button>
                </div>
              ))}
          </div>
          {adding === index ? (
            <form
              className="board-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                setTasks((items) => [
                  ...items,
                  { id: nextId.current++, text: draft.trim(), status: index },
                ]);
                closeForm(index);
              }}
            >
              <input
                autoFocus
                aria-label={tr('{{status}}任务名称', { status: status })}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeForm(index);
                  }
                }}
              />
              <button type="submit" className="icon-button" aria-label={tr('添加任务')}>
                <Icon name="check" />
              </button>
            </form>
          ) : (
            <button
              className="board-new"
              ref={(node) => {
                addButtons.current[index] = node;
              }}
              aria-label={tr('在{{status}}中新建任务', { status: status })}
              onClick={() => {
                setAdding(index);
                setDraft('');
              }}
            >
              <Icon name="plus" />
              {tr('新建任务')}
            </button>
          )}
        </div>
      ))}
    </div>
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
export function ModelDemo() {
  useLocale();
  return (
    <div className="demo-models" aria-label={tr('Codex 模型快切演示')}>
      <ModelPreview model={exampleModels} />
    </div>
  );
}
export function SpeedDemo() {
  useLocale();
  const [phase, setPhase] = useState('streaming');
  return (
    <div className="speed-demo">
      <div className="choice-row" role="group" aria-label={tr('测速状态演示')}>
        {[
          ['waiting', tr('等待输出')],
          ['thinking', tr('思考中')],
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
export function BotDemo({ onInsert }: { onInsert: (value: string) => void }) {
  useLocale();
  const [bot, setBot] = useState('engineering');
  return (
    <div className="demo-bots">
      {[
        ['engineering', tr('工程主管')],
        ['research', tr('资料助手')],
        ['casual', tr('随口一问')],
      ].map(([id, name]) => (
        <button
          key={name}
          aria-pressed={bot === id}
          onClick={() => {
            setBot(id);
            onInsert(tr('请问「{{name}}」：帮我检查作品集方案。', { name: name }));
          }}
        >
          <Icon name="feature-bots" />
          {name}
          <Icon name="chevron-right" />
        </button>
      ))}
    </div>
  );
}
export function TermDemo() {
  useLocale();
  const [saved, setSaved] = useState(false);
  const [known, setKnown] = useState(false);
  return (
    <div className="demo-term">
      <span className="term-en">Responsive layout</span>
      <h4>{tr('响应式布局')}</h4>
      <p>{tr('让页面随屏幕宽度调整排列。例如电脑上并排展示作品，手机上改为纵向阅读。')}</p>
      <div className="term-actions">
        <button aria-pressed={saved} onClick={() => setSaved(!saved)}>
          <Icon name={saved ? 'bookmark-filled' : 'bookmark'} />
          {saved ? tr('已收藏') : tr('收藏')}
        </button>
        <button aria-pressed={known} onClick={() => setKnown(!known)}>
          <Icon name="check" />
          {known ? tr('已掌握') : tr('掌握了')}
        </button>
      </div>
    </div>
  );
}
export function ComposerDemo({
  draft,
  onChange,
  label = tr('接着聊'),
  optimize = false,
}: {
  draft: string;
  onChange: (value: string) => void;
  label?: string;
  optimize?: boolean;
}) {
  useLocale();
  const id = useId();
  const [previous, setPrevious] = useState<string | null>(null);
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
      {optimize && (
        <div className="composer-actions">
          {previous !== null && (
            <button
              onClick={() => {
                onChange(previous);
                setPrevious(null);
              }}
            >
              {tr('撤销')}
            </button>
          )}
          <button
            onClick={() => {
              setPrevious(draft);
              onChange(
                tr(
                  '请把这个个人作品集方案整理成两天内可完成的步骤，列出每一步的交付内容与检查方法。',
                ),
              );
            }}
          >
            {tr('优化提示词')}
            <Icon name="feature-next" />
          </button>
        </div>
      )}
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
  const [direction, setDirection] = useState('advance');
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
                setDirection('advance');
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
            {active === 'next' && (
              <>
                <div className="demo-suggestions">
                  {(direction === 'advance'
                    ? [
                        [
                          tr('拆解第一版'),
                          tr('把作品集方案分成两天可完成的步骤。'),
                          tr('请把作品集第一版拆解成两天内可完成的具体步骤。'),
                        ],
                        [
                          tr('检查移动端'),
                          tr('看看小屏阅读和图片加载还有哪些遗漏。'),
                          tr('帮我检查作品集在手机上阅读和加载图片时可能遗漏的问题。'),
                        ],
                      ]
                    : [
                        [
                          tr('比较展示方式'),
                          tr('比较长页面与独立项目页。'),
                          tr('比较长页面和独立项目页，哪个更适合这三个作品？'),
                        ],
                        [
                          tr('探索呈现角度'),
                          tr('让每个作品更突出你的贡献。'),
                          tr('这些作品还可以从哪些角度展示我的个人贡献？'),
                        ],
                      ]
                  ).map(([title, description, value], index) => (
                    <button className="suggestion" key={title} onClick={() => insert(value)}>
                      <span className="suggestion-number">0{index + 1}</span>
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <Icon name="chevron-right" />
                    </button>
                  ))}
                </div>
                <div className="next-demo-actions">
                  <select
                    aria-label={tr('演示建议方向')}
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                  >
                    <option value="advance">{tr('整体推进')}</option>
                    <option value="explore">{tr('探索拓展')}</option>
                  </select>
                  <div className="quick-prompts">
                    {[tr('继续'), tr('执行')].map((word) => (
                      <button key={word} onClick={() => insert(word)}>
                        {word}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {active === 'outline' && (
              <div className="demo-outline">
                {headings().map((title, index) => (
                  <button
                    key={title}
                    className={heading === index ? 'is-current' : ''}
                    aria-pressed={heading === index}
                    onClick={() => {
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
                  >
                    <span>0{index + 1}</span>
                    {title}
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            )}
            <div key={reset}>
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
