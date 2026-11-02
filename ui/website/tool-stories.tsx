/* [INPUT]: Tour step and native entry progress.
 * [OUTPUT]: Real prompt transformation, Bot reply, connection map and closing settle.
 * [POS]: Website presentation only; examples are labelled, no network or product writes, no loops.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md §10 in sync. */
import type { ReactNode } from 'react';
import { tr } from '../shared/i18n.js';
import { PromptPreview } from '../settings/prompt-preview';
import { PreviewFrame } from '../settings/preview-frame';
import { useEntryProgress } from './scroll-motion';

/* ---------- 提示词优化：直接展示真实草稿改写与还原 ---------- */
export function PromptStory({ step }: { step?: number }) {
  return (
    <div className="prompt-story" data-tour-step={step ?? ''}>
      <PreviewFrame title={tr('提示词优化')} className="site-preview preview-prompt">
        <PromptPreview tourStep={step} />
      </PreviewFrame>
    </div>
  );
}

/* ---------- Bot 咨询：0 草稿 · 1 思考中 · 2 完成并回复（示例） ---------- */
export function BotReply({ step }: { step?: number }) {
  if (step === undefined) return null;
  return (
    <div className="bot-reply" data-step={step} aria-live="polite">
      <span className="bot-reply-state">
        {tr(['咨询草稿已写好', 'Bot 正在思考', '已完成 · 示例回复'][Math.min(2, step)])}
      </span>
      {step >= 2 && (
        <p className="bot-reply-bubble">
          {tr('作品集结构清楚；建议把代表作品放在第一屏，并补一句每件作品的目标。')}
        </p>
      )}
    </div>
  );
}

/* ---------- 连接边界：本机框内为 App、Agent 与可选的 CodexHost，框外为可选远端服务 ---------- */
export function ConnectionMap() {
  const { ref, progress } = useEntryProgress<HTMLDivElement>();
  const draw = Math.min(1, Math.max(0, (progress - 0.15) / 0.75));
  const local = [
    { label: 'Palboo App' },
    { label: 'Codex · Agent' },
    { label: 'CodexHost', note: tr('可选') },
  ];
  const remote = [tr('模型服务'), 'Grok Bot'];
  return (
    <div
      ref={ref}
      className="connection-map"
      role="img"
      aria-label={tr('本机与可选服务的连接边界')}
      style={{ ['--draw' as string]: draw }}
    >
      <div className="cm-local">
        <span className="cm-caption">{tr('本机')}</span>
        {local.map((node, index) => (
          <span key={node.label} className="cm-node is-local" style={{ ['--i' as string]: index }}>
            {node.label}
            {node.note && <small>{node.note}</small>}
          </span>
        ))}
      </div>
      <span className="cm-link" aria-hidden="true" />
      <div className="cm-remote">
        <span className="cm-caption">{tr('可选服务')}</span>
        {remote.map((label, index) => (
          <span key={label} className="cm-node" style={{ ['--i' as string]: index + 3 }}>
            {label}
            <small>{tr('可选')}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- 随阅读落定的结尾，只进不循环 ---------- */
export function SettleIn({ className, children }: { className?: string; children: ReactNode }) {
  const { ref, progress } = useEntryProgress<HTMLDivElement>();
  return (
    <div ref={ref} className={className} style={{ ['--settle' as string]: progress }}>
      {children}
    </div>
  );
}
