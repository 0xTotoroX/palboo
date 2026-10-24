/* [INPUT]: Shared icons, static examples and visitor interactions.
 * [OUTPUT]: Isolated feature / surface demonstrations with local memory state.
 * [POS]: Website illustration layer; no backend, host or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../shared/icons/react';

export const features = [
  {
    id: 'next',
    label: '下一步',
    icon: 'feature-next',
    title: '好问题之后，再向前一步。',
    description: '从当前对话生成下一步建议。选择方向，把想法接成行动。',
  },
  {
    id: 'outline',
    label: '大纲',
    icon: 'feature-outline',
    title: '长对话，也有清楚的脉络。',
    description: '沿着大纲回到关键位置，接着读，接着想。',
  },
  {
    id: 'board',
    label: '任务看板',
    icon: 'feature-board',
    title: '聊过的事，有地方接着做。',
    description: '用待办、进行中和完成整理任务，让推进过程看得见。',
  },
  {
    id: 'model',
    label: '模型切换',
    icon: 'feature-model',
    title: '让合适的模型，接手当前问题。',
    description: '把常用模型和预设放在手边，按当前宿主支持的能力切换。',
  },
  {
    id: 'terms',
    label: '术语释义',
    icon: 'feature-terms',
    title: '遇到新概念，就在这里弄懂。',
    description: '在对话里识别术语，随时查看解释、收藏或标记已掌握。',
  },
  {
    id: 'bots',
    label: 'Grok Bot',
    icon: 'feature-bots',
    title: '找到熟悉的助手，继续聊。',
    description: '接入已有的 Grok Bot，把常用助手带到当前输入流程。',
  },
] as const;

export type FeatureId = (typeof features)[number]['id'];
export type SurfaceId = 'sidebar' | 'overlay' | 'desktop' | 'edge';
export const surfaces: { id: SurfaceId; label: string; description: string }[] = [
  { id: 'sidebar', label: '侧栏', description: '和对话并排，读到哪里，接着做到哪里。' },
  { id: 'overlay', label: '页面浮层', description: '需要时展开，收起后把空间还给对话。' },
  { id: 'desktop', label: '桌面窗口', description: '移到顺手的位置，也可以放到另一块屏幕。' },
  { id: 'edge', label: '贴边 / 刘海', description: '待在屏幕边缘，用到的时候再展开。' },
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
      <div className="demo-window-bar" aria-hidden="true">
        <span className="window-dots">
          <i />
          <i />
          <i />
        </span>
        <span>一个想法的开始</span>
        <span className="window-bar-end">⌘</span>
      </div>
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
              <span className="demo-count">
                {String(features.indexOf(selected) + 1).padStart(2, '0')}
              </span>
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
            <label htmlFor="demo-draft">接着聊</label>
            <textarea
              id="demo-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="从一个下一步开始…"
              rows={2}
            />
            <span aria-hidden="true">
              <Icon name="feature-next" />
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function SurfaceDemo({ surface }: { surface: SurfaceId }) {
  return (
    <div
      className="surface-stage"
      data-surface={surface}
      role="img"
      aria-label={`${surfaces.find((item) => item.id === surface)!.label}形态示意`}
    >
      <div className="surface-wallpaper">
        <span>PALB</span>
        <Eyes />
      </div>
      <div className="surface-host">
        <div className="surface-host-bar">
          <span className="window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>Codex</span>
        </div>
        <div className="surface-host-content">
          <span className="surface-bubble" />
          <span />
          <span />
          <strong />
          <span />
          <span />
          <div className="surface-input" />
        </div>
      </div>
      <div className="surface-workbench">
        <div className="surface-workbench-head">
          <Eyes />
          <Icon name="feature-next" />
          <Icon name="feature-board" />
        </div>
        <strong>把想法接成行动</strong>
        <div className="surface-row">
          <span>01</span>明确第一版范围
          <Icon name="chevron-right" />
        </div>
        <div className="surface-row">
          <span>02</span>拆解实现步骤
          <Icon name="chevron-right" />
        </div>
        <div className="surface-draft">继续</div>
      </div>
      <div className="surface-edge-tab">
        <Eyes />
      </div>
    </div>
  );
}
