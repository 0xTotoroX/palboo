/* [INPUT]: Real Grok Bot color metadata; shape metadata is intentionally ignored.
 * [OUTPUT]: Uniform circular avatars with tilted eyes and synchronized Bot colors; neutral gray if unknown.
 * [POS]: Pure Bot content. [PROTOCOL]: Keep ui/features/AGENTS.md in sync. */
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
}: {
  avatar?: { shape: string; color: string; photoAvailable?: boolean };
}) {
  const color = colors[avatar?.color || ''] || colors.gray;
  return (
    <span className="palboo-bot-avatar palboo-bot-avatar-shaped" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill={color} data-shape="circle">
        <circle cx="16" cy="16" r="15" />
        <g fill="white">
          <rect
            x="15"
            y="6.5"
            width="3.5"
            height="8"
            rx="1.75"
            transform="rotate(-35 16.75 10.5)"
          />
          <rect x="22" y="3.5" width="3" height="7.5" rx="1.5" transform="rotate(-35 23.5 7.25)" />
        </g>
      </svg>
    </span>
  );
}
