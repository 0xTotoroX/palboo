/* [INPUT]: Localized chapter copy and shared feature icons.
 * [OUTPUT]: Two-tone display headlines and the blush feature mark used across website chapters.
 * [POS]: Website typography primitives; no state, motion or product behavior.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import type { ReactNode } from 'react';
import { Icon } from '../shared/icons/react';

/* ---------- 双色标题：首句正文色，次句弱化色 ---------- */
export function Headline({
  id,
  lead,
  soft,
  className = '',
}: {
  id?: string;
  lead: ReactNode;
  soft?: ReactNode;
  className?: string;
}) {
  return (
    <h2 id={id} className={`display ${className}`.trim()}>
      <span className="display-lead">{lead}</span>
      {soft && <span className="display-soft">{soft}</span>}
    </h2>
  );
}

/* 章节文案以换行分隔两句 */
export function splitTitle(title: string): [string, string | undefined] {
  const [lead, ...rest] = title.split('\n');
  return [lead, rest.join(' ') || undefined];
}

/* ---------- 功能标记：与工作台标签同一图标，腮红底 ---------- */
export function FeatureMark({ icon }: { icon: string }) {
  return (
    <span className="feature-mark" aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}
