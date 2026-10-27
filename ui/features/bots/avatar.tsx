/* [INPUT]: Real Grok Bot color metadata; shape metadata is intentionally ignored.
 * [OUTPUT]: Circular avatars with tilted eyes, one optional corner badge, activity motion and visibility cleanup.
 * [POS]: Pure Bot content. [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../shared/icons/react';
export type BotBadge = 'error' | 'occupied' | 'unread' | 'stopped';
const colors: Record<string, string> = {
  black: '#000',
  brown: '#936439',
  red: '#FF263C',
  orange: '#FF6700',
  yellow: '#FF9800',
  green: '#00C972',
  cyan: '#00BCA6',
  blue: '#1084FE',
  violet: '#9159FE',
  magenta: '#FF309B',
  gray: '#777777',
};
export function BotAvatar({
  avatar,
  activity,
  badge,
}: {
  badge?: BotBadge;
  activity?: 'working' | 'finished';
  avatar?: { shape: string; color: string; photoAvailable?: boolean };
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!activity || !ref.current) return;
    let visible = false;
    const sync = () => setMoving(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [activity]);
  const color = colors[avatar?.color || ''] || colors.gray;
  return (
    <span
      ref={ref}
      className="palboo-bot-avatar palboo-bot-avatar-shaped"
      data-activity={activity}
      data-moving={moving}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill={color} data-shape="circle">
        <circle cx="16" cy="16" r="15" />
        <g fill="white">
          <g className="palboo-bot-eye">
            <rect
              x="15"
              y="6.5"
              width="3.5"
              height="8"
              rx="1.75"
              transform="rotate(-35 16.75 10.5)"
            />
          </g>
          <g className="palboo-bot-eye">
            <rect
              x="22"
              y="3.5"
              width="3"
              height="7.5"
              rx="1.5"
              transform="rotate(-35 23.5 7.25)"
            />
          </g>
        </g>
      </svg>
      {badge && (
        <span className="palboo-bot-badge" data-badge={badge}>
          {badge === 'stopped' ? (
            <span className="palboo-bot-stop-mark" />
          ) : (
            badge !== 'unread' && <Icon name={badge === 'error' ? 'warning' : 'connection'} />
          )}
        </span>
      )}
    </span>
  );
}
