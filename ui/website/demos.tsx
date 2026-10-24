/* [INPUT]: Shared icons, original settings device scene and motion, static examples and visitor input.
 * [OUTPUT]: Isolated feature interactions and the original settings window model with local state.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../shared/icons/react';
import { LayoutPreviewScene, demoFrames } from '../settings/layout-preview-scene';
import { useDemoJourney } from '../settings/layout-preview-journey';

export const features = [
  { id: 'next', label: '下一步', icon: 'feature-next' },
  { id: 'outline', label: '大纲', icon: 'feature-outline' },
  { id: 'board', label: '任务看板', icon: 'feature-board' },
  { id: 'model', label: '模型切换', icon: 'feature-model' },
  { id: 'terms', label: '术语释义', icon: 'feature-terms' },
  { id: 'bots', label: 'Grok Bot', icon: 'feature-bots' },
] as const;

export type FeatureId = (typeof features)[number]['id'];
export type SurfaceId = 'sidebar' | 'overlay' | 'desktop' | 'edge';
export const surfaces: { id: SurfaceId; label: string }[] = [
  { id: 'sidebar', label: '侧栏' },
  { id: 'overlay', label: '页面浮层' },
  { id: 'desktop', label: '移到副屏' },
  { id: 'edge', label: '贴边 / 刘海' },
];

/** Arrow keys move focus and selection together; no delayed keyboard animation. */
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

function Eyes() {
  return (
    <span className="demo-eyes" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function Chat({ heading }: { heading: number }) {
  return (
    <div className="demo-chat">
      <div className="chat-title">
        <span>Codex</span>
        <span>周末计划</span>
      </div>
      <div className="chat-question">
        我想做一个周末能完成的小项目，
        <br />
        从哪里开始？
      </div>
      <article>
        <div className="chat-avatar">
          <Eyes />
        </div>
        <p>先做出一个小而完整的版本。</p>
        {['找到要解决的问题', '画出第一条使用路径', '做完，再验证'].map((title, index) => (
          <section
            key={title}
            className={heading === index ? 'chat-paragraph is-focused' : 'chat-paragraph'}
          >
            <h3>{title}</h3>
            <p>
              {
                [
                  '选一个你自己经常遇到的小麻烦。',
                  '从打开页面，到完成第一件事。',
                  '请一个朋友试试，看看哪里会卡住。',
                ][index]
              }
            </p>
          </section>
        ))}
      </article>
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
  const [draft, setDraft] = useState('');
  const [heading, setHeading] = useState(0);
  const [task, setTask] = useState(0);
  const [model, setModel] = useState('通用模型');
  const [saved, setSaved] = useState(false);
  const [known, setKnown] = useState(false);
  const [bot, setBot] = useState('工程主管');
  const selected = features.find((feature) => feature.id === active)!;

  return (
    <div className="product-demo" aria-label="Palboo 交互演示">
      <div className="demo-window-body">
        <Chat heading={active === 'outline' ? heading : -1} />
        <aside className={`demo-panel demo-panel-${active}`}>
          <div className="demo-panel-top">
            <Eyes />
            <span>Palboo</span>
            <button
              className="icon-button"
              aria-label="重置功能演示"
              onClick={() => {
                setDraft('');
                setHeading(0);
                setTask(0);
                setModel('通用模型');
                setSaved(false);
                setKnown(false);
                setBot('工程主管');
              }}
            >
              <Icon name="refresh" />
            </button>
          </div>
          <div
            className="demo-feature-tabs"
            role="tablist"
            aria-label="演示功能"
            onKeyDown={tabKeys}
          >
            {features.map((feature) => (
              <button
                key={feature.id}
                id={`feature-${feature.id}`}
                role="tab"
                aria-selected={active === feature.id}
                aria-controls="feature-panel"
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
            id="feature-panel"
            className="demo-feature-content"
            role="tabpanel"
            aria-labelledby={`feature-${active}`}
          >
            <div className="demo-content-heading">
              <span>{selected.label}</span>
            </div>
            {active === 'next' && (
              <div className="demo-suggestions">
                {[
                  [
                    '完善实现方案',
                    '把想法分解成可执行的步骤。',
                    '把这个项目分解成周末能完成的具体步骤。',
                  ],
                  [
                    '检查边界条件',
                    '看看还有哪些遗漏的情况。',
                    '帮我检查这个方案可能遗漏的边界条件。',
                  ],
                ].map(([title, description, value], index) => (
                  <button className="suggestion" key={title} onClick={() => setDraft(value)}>
                    <span className="suggestion-number">0{index + 1}</span>
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            )}
            {active === 'outline' && (
              <div className="demo-outline">
                {['找到要解决的问题', '画出第一条使用路径', '做完，再验证'].map((title, index) => (
                  <button
                    key={title}
                    className={heading === index ? 'is-current' : ''}
                    aria-pressed={heading === index}
                    onClick={() => setHeading(index)}
                  >
                    <span>0{index + 1}</span>
                    {title}
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            )}
            {active === 'board' && (
              <div className="demo-board">
                {['待办', '进行中', '完成'].map((status, index) => (
                  <div key={status}>
                    <h4>
                      {status}
                      <span>{task === index ? '1' : '0'}</span>
                    </h4>
                    {task === index ? (
                      <button
                        className="demo-task"
                        onClick={() => setTask((task + 1) % 3)}
                        aria-label={`明确第一版范围，移到${['待办', '进行中', '完成'][(task + 1) % 3]}`}
                      >
                        <span>明确第一版范围</span>
                        <Icon name={task === 2 ? 'check' : 'feature-next'} />
                      </button>
                    ) : (
                      <span className="empty-lane" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            )}
            {active === 'model' && (
              <div className="demo-models">
                {['通用模型', '推理模型', '快速模型'].map((name) => (
                  <button key={name} aria-pressed={model === name} onClick={() => setModel(name)}>
                    <Icon name="feature-model" />
                    <span>{name}</span>
                    {model === name && <Icon name="check" />}
                  </button>
                ))}
                <p className="model-readback" aria-live="polite">
                  当前选择 <strong>{model}</strong>
                </p>
              </div>
            )}
            {active === 'terms' && (
              <div className="demo-term">
                <span className="term-en">CONTEXT WINDOW</span>
                <h4>上下文窗口</h4>
                <p>模型一次能处理的信息范围，包括你的提问、聊天历史和它的回答。</p>
                <div className="term-actions">
                  <button aria-pressed={saved} onClick={() => setSaved(!saved)}>
                    <Icon name={saved ? 'bookmark-filled' : 'bookmark'} />
                    {saved ? '已收藏' : '收藏'}
                  </button>
                  <button aria-pressed={known} onClick={() => setKnown(!known)}>
                    <Icon name="check" />
                    {known ? '已掌握' : '掌握了'}
                  </button>
                </div>
              </div>
            )}
            {active === 'bots' && (
              <div className="demo-bots">
                {['工程主管', '资料助手', '随口一问'].map((name) => (
                  <button
                    key={name}
                    aria-pressed={bot === name}
                    onClick={() => {
                      setBot(name);
                      setDraft(`请问「${name}」：帮我检查这个方案。`);
                    }}
                  >
                    <Icon name="feature-bots" />
                    {name}
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="demo-composer">
            <label className="sr-only" htmlFor="demo-draft">
              接着聊
            </label>
            <textarea
              id="demo-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="从一个下一步开始…"
              rows={2}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Uses the exact settings device model and its original two-stage screen handoff. */
export function SurfaceDemo({
  surface,
  animate = true,
}: {
  surface: SurfaceId;
  animate?: boolean;
}) {
  const frame = useDemoJourney(surface, demoFrames[surface], animate);
  const [draft, setDraft] = useState('');
  return (
    <div className="surface-model" data-surface={surface}>
      <LayoutPreviewScene frame={frame} title="周末计划" hostName="Codex">
        <div className="modeled-workspace">
          <div className="modeled-heading">
            <Icon name="feature-next" />
            <span>下一步</span>
          </div>
          <ol>
            <li>明确第一版范围</li>
            <li>拆解实现步骤</li>
            <li>检查边界条件</li>
          </ol>
          <input
            aria-label="窗口演示草稿"
            placeholder="接着聊…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </LayoutPreviewScene>
    </div>
  );
}
