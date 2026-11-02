/* [INPUT]: Settings-backed product views, one portfolio example and visitor interaction.
 * [OUTPUT]: Three continuous workspaces: reading, composing and coordinating.
 * [POS]: Website composition only; fixed example data and memory-only drafts/actions.
 * [PROTOCOL]: Keep website/AGENTS.md, settings/prompt-preview.tsx and browser acceptance in sync. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { Icon } from '../shared/icons/react';
import { CodexHostPreview } from '../settings/codex-host-preview';
import type { CodexHostAgentSnapshot } from '../shared/codex-host';
import { PromptPreview } from '../settings/prompt-preview';
import { ComposerDemo, Eyes } from './demos';
import {
  NextDemo,
  OutlineDemo,
  TermDemo,
  QuickPhrasesDemo,
  samplePhrases,
  BoardDemo,
} from './product-demos';
import { ModelDemo } from './model-demo';
import { BotDemo } from './bot-demo';
import { sampleProjection } from './demo-state';
import { flyText, markFilled, reducedMotion, shadowQuery } from './narrative';

const agentExample: CodexHostAgentSnapshot = {
  status: 'ready',
  message: '',
  current: 'codex',
  agents: [
    ['codex', 'Codex'],
    ['claude-code', 'Claude Code'],
    ['opencode', 'OpenCode'],
  ].map(([id, label]) => ({
    id,
    label,
    group: 'main',
    availability: 'ready',
    available: true,
    canAdd: false,
  })),
};

/* 进入视野后只示范一次。所有功能一直在场；任何手动操作都会接管。 */
function useSceneDemo() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState<number>();
  const [paused, setPaused] = useState(false);
  const played = useRef(false);
  const timers = useRef<number[]>([]);
  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const claim = useCallback(() => {
    stop();
    setPaused(true);
  }, [stop]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || played.current || paused || media.matches) return;
        played.current = true;
        setStep(0);
        timers.current = [1, 2].map((value) =>
          window.setTimeout(() => setStep(value), value * 1400),
        );
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    const reduced = () => {
      if (media.matches) {
        stop();
        setPaused(true);
      }
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    media.addEventListener('change', reduced);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      observer.disconnect();
      media.removeEventListener('change', reduced);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [paused, stop]);
  return {
    ref,
    step: paused ? undefined : step,
    claim,
    interaction: {
      onPointerDownCapture: claim,
      onFocusCapture: claim,
      onKeyDownCapture: claim,
      onDragStartCapture: claim,
    },
  };
}

/* 与设置预览共用头部操作槽，正文不再叠加第二层边框和内边距。 */
function FeatureSpace({
  id,
  title,
  icon,
  children,
  action,
}: {
  id: string;
  title: string;
  icon: string;
  children: (header: HTMLElement) => ReactNode;
  action?: ReactNode;
}) {
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  return (
    <section className={`scene-feature scene-feature-${id}`} aria-label={title}>
      <header className="scene-feature-head">
        <h3>
          <Icon name={icon} />
          <span>{title}</span>
        </h3>
        <div className="scene-feature-actions">
          {action}
          <div ref={setHeader} />
        </div>
      </header>
      <div className="scene-feature-body">{header && children(header)}</div>
    </section>
  );
}

function SceneHeading({
  id,
  lead,
  soft,
  children,
}: {
  id: string;
  lead: string;
  soft: string;
  children: ReactNode;
}) {
  return (
    <div className="scene-intro">
      <h2 id={id}>
        {lead} <span>{soft}</span>
      </h2>
      <p>{children}</p>
    </div>
  );
}

export function ReadingScene() {
  useLocale();
  const demo = useSceneDemo();
  const article = useRef<HTMLElement>(null);
  const agentButton = useRef<HTMLButtonElement>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agent, setAgent] = useState('Codex');
  const closeAgents = () => {
    setAgentOpen(false);
    agentButton.current?.focus();
  };
  const [heading, setHeading] = useState(0);
  const [draft, setDraft] = useState('');
  const jump = useCallback((index: number) => {
    const current = Math.max(0, Math.min(2, index));
    setHeading(current);
    const root = article.current;
    const target = root?.querySelectorAll('section')[current];
    if (root && target)
      root.scrollTo({
        top:
          target.getBoundingClientRect().top -
          root.getBoundingClientRect().top +
          root.scrollTop -
          12,
        behavior: reducedMotion() ? 'instant' : 'smooth',
      });
  }, []);
  const insert = (value: string) =>
    setDraft((current) => (current ? `${current}\n${value}` : value));
  useEffect(() => {
    if (demo.step === 1) jump(1);
    if (demo.step !== 2) return;
    const root = demo.ref.current;
    const target = root?.querySelector('.demo-composer');
    const prompt = sampleProjection().prompts[0];
    return flyText(
      shadowQuery(root, 'next', '.csw-row[data-index="0"]'),
      target,
      prompt.label,
      () => {
        setDraft((current) => current || prompt.prompt);
        markFilled(target);
      },
    );
  }, [demo.step, demo.ref, jump]);
  return (
    <section
      id="read"
      className="combined-scene reading-scene page-width"
      aria-labelledby="read-title"
    >
      <SceneHeading id="read-title" lead={tr('读懂，')} soft={tr('也接得上。')}>
        {tr('大纲找到重点，术语随手查，下一步就在同一段对话旁。')}
      </SceneHeading>
      <section
        ref={demo.ref}
        className="scene-window reader-window"
        aria-label={tr('阅读工作台演示')}
        data-step={demo.step ?? ''}
        {...demo.interaction}
      >
        <div className="reader-chat">
          <div className="scene-chat-head">
            <div
              className="scene-agent-picker"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && agentOpen) {
                  event.stopPropagation();
                  closeAgents();
                }
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setAgentOpen(false);
              }}
            >
              <button
                ref={agentButton}
                type="button"
                className="scene-agent-trigger"
                aria-label={tr('兼容集成')}
                title={tr('兼容集成')}
                aria-expanded={agentOpen}
                aria-haspopup="menu"
                onClick={() => setAgentOpen(!agentOpen)}
              >
                <strong>{agent}</strong>
                <Icon name="chevron-down" />
              </button>
              <div className="scene-agent-menu" hidden={!agentOpen}>
                <CodexHostPreview
                  live={false}
                  example={agentExample}
                  onSelect={(value) => {
                    setAgent(value.label);
                    closeAgents();
                  }}
                />
              </div>
            </div>
            <span>{tr('个人作品集')}</span>
          </div>
          <article
            ref={article}
            className="reader-article"
            tabIndex={0}
            aria-label={tr('作品集方案')}
          >
            <div className="chat-question">
              {tr('我想用周末做一个个人作品集，第一版应该怎么安排？')}
            </div>
            {[
              [tr('确定作品集内容'), tr('每个作品保留背景、个人贡献、最终结果和两张关键截图。')],
              [tr('安排页面与布局'), tr('用响应式布局适配电脑与手机，保留简介、作品和联系方式。')],
              [tr('上线前检查'), tr('检查小屏阅读、图片加载和联系链接，再请朋友试用。')],
            ].map(([title, text], index) => (
              <section key={index} className={heading === index ? 'is-current' : ''}>
                <h3>{title}</h3>
                <p>{text}</p>
              </section>
            ))}
          </article>
          <FeatureSpace id="terms" icon="feature-terms" title={tr('术语释义')}>
            {(header) => <TermDemo headerActions={header} tourBeat={demo.step} />}
          </FeatureSpace>
          <ComposerDemo draft={draft} onChange={setDraft} label={tr('阅读示例草稿')} />
        </div>
        <aside className="reader-tools">
          <div className="scene-product-head">
            <Eyes />
            <span>Palboo</span>
          </div>
          <FeatureSpace id="next" icon="feature-next" title={tr('下一步')}>
            {(header) => (
              <NextDemo onInsert={insert} onManual={demo.claim} headerActions={header} />
            )}
          </FeatureSpace>
          <FeatureSpace id="outline" icon="feature-outline" title={tr('大纲')}>
            {(header) => <OutlineDemo onJump={jump} headerActions={header} />}
          </FeatureSpace>
        </aside>
      </section>
    </section>
  );
}

export function WritingScene() {
  useLocale();
  const demo = useSceneDemo();
  const [draft, setDraft] = useState<string | null>(null);
  const [names, setNames] = useState(false);
  const cancelFlight = useRef<(() => void) | undefined>(undefined);
  const shownDraft = draft ?? tr('帮我把这个作品集方案安排一下');
  const insert = (text: string, index: number) => {
    const root = demo.ref.current;
    const target = root?.querySelector('.demo-prompt');
    setDraft((value) => {
      const current = value ?? shownDraft;
      return current ? `${current}\n${text}` : text;
    });
    cancelFlight.current?.();
    cancelFlight.current = flyText(
      shadowQuery(root, 'prompts', `[data-quick-prompt="${index}"]`),
      target,
      samplePhrases()[index]?.label || text,
      () => markFilled(target),
    );
  };
  useEffect(() => () => cancelFlight.current?.(), []);
  useEffect(() => {
    if (demo.step !== 1) return;
    const toggle = shadowQuery<HTMLButtonElement>(
      demo.ref.current,
      'prompts',
      '[data-quick-expand="2"]',
    );
    if (toggle && !toggle.hidden && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    const phrase = samplePhrases()[2];
    const target = demo.ref.current?.querySelector('.demo-prompt');
    // 数据与实际点击相同立即追加；下一拍不依赖浏览器是否及时绘制飞行动画。
    setDraft((current) => `${current ?? tr('帮我把这个作品集方案安排一下')}\n${phrase.prompt}`);
    return flyText(
      shadowQuery(demo.ref.current, 'prompts', '[data-quick-prompt="2"]'),
      target,
      phrase.label,
      () => markFilled(target),
    );
  }, [demo.step, demo.ref]);
  return (
    <section
      id="quick-phrases"
      className="combined-scene writing-scene page-width"
      aria-labelledby="write-title"
    >
      <SceneHeading id="write-title" lead={tr('常用的话，')} soft={tr('顺手就能发。')}>
        {tr('选模型、放入常用语、整理表达。围绕同一个输入框完成。')}
      </SceneHeading>
      <section
        ref={demo.ref}
        className="scene-window writing-window"
        aria-label={tr('写作工作台演示')}
        data-step={demo.step ?? ''}
        {...demo.interaction}
      >
        <aside className="writing-phrases">
          <FeatureSpace
            id="prompts"
            icon="feature-prompts"
            title={tr('常用语')}
            action={
              <button
                className="scene-text-toggle"
                aria-pressed={names}
                onClick={() => setNames(!names)}
              >
                {tr('仅显示名称')}
              </button>
            }
          >
            {(header) => (
              <QuickPhrasesDemo onInsert={insert} namesOnly={names} headerActions={header} />
            )}
          </FeatureSpace>
        </aside>
        <div className="writing-desk">
          <FeatureSpace id="model" icon="feature-model" title={tr('模型切换')}>
            {(header) => (
              <ModelDemo
                headerActions={header}
                tourStep={demo.step === 2 ? 3 : demo.step === undefined ? undefined : 0}
              />
            )}
          </FeatureSpace>
          <FeatureSpace id="prompt" icon="prompt-improve" title={tr('提示词优化')}>
            {() => (
              <PromptPreview
                draft={shownDraft}
                onDraftChange={setDraft}
                tourStep={demo.step === undefined ? undefined : demo.step === 2 ? 1 : 0}
              />
            )}
          </FeatureSpace>
        </div>
      </section>
    </section>
  );
}

export function CoordinationScene() {
  useLocale();
  const demo = useSceneDemo();
  const [draft, setDraft] = useState<string | null>(null);
  const insert = (text: string) => setDraft((current) => (current ? `${current}\n${text}` : text));
  return (
    <section
      id="coordinate"
      className="combined-scene coordination-scene page-width"
      aria-labelledby="coordinate-title"
    >
      <SceneHeading id="coordinate-title" lead={tr('从讨论，')} soft={tr('到一件件完成。')}>
        {tr('任务进看板，需要帮手时，让 Bot 接着处理。')}
      </SceneHeading>
      <section
        ref={demo.ref}
        className="scene-window coordination-window"
        aria-label={tr('任务与协作演示')}
        data-step={demo.step ?? ''}
        {...demo.interaction}
      >
        <FeatureSpace id="board" icon="feature-board" title={tr('个人作品集')}>
          {(header) => <BoardDemo headerActions={header} tourStatus={demo.step} />}
        </FeatureSpace>
        <aside className="coordination-bots">
          <FeatureSpace id="bots" icon="feature-bots" title="Grok Bot">
            {(header) => (
              <BotDemo compact headerActions={header} tourStep={demo.step} onInsert={insert} />
            )}
          </FeatureSpace>
          {demo.step === 2 && draft === null && (
            <p className="scene-bot-reply" role="status">
              {tr('作品集结构清楚；建议把代表作品放在第一屏，并补一句每件作品的目标。')}
            </p>
          )}
          <ComposerDemo
            draft={
              draft ?? (demo.step === undefined ? '' : tr('请问「工程主管」：帮我检查作品集方案。'))
            }
            onChange={setDraft}
            label={tr('Bot 咨询草稿')}
          />
        </aside>
      </section>
    </section>
  );
}
