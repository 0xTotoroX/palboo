/* [INPUT]: Real Grok Bot shape/color metadata; no remote images or proprietary SVG assets.
 * [OUTPUT]: PALBOO's own geometric rendition of the saved avatar identity.
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
const shapes: Record<string, string> = {
  blob: 'M6 17C3 8 10 3 16 5C24 2 29 10 27 18C28 26 20 29 13 27C5 29 2 23 6 17Z',
  cloud: 'M7 25C0 24 1 14 7 13C5 5 16 1 20 8C27 4 33 15 27 19C29 25 23 28 18 25Z',
  sparkle: 'M16 2Q18 13 30 16Q18 19 16 30Q13 19 2 16Q13 13 16 2Z',
  heart: 'M16 28L4 16C-4 5 9-2 16 8C23-2 36 5 28 16Z',
  teardrop: 'M16 2C12 9 4 14 4 21A12 10 0 0 0 28 21C28 14 20 9 16 2Z',
  leaf: 'M28 3C3 2 0 17 6 25C14 33 30 26 28 3Z',
  hex: 'M9 3H23L30 16L23 29H9L2 16Z',
  gem: 'M8 3H24L30 12L16 30L2 12Z',
  crystal: 'M16 1L28 11L23 27L8 30L3 13Z',
  wedge: 'M7 3L29 25Q30 29 25 29H5Q2 29 3 24Z',
  shield: 'M3 5L16 2L29 5V17Q27 25 16 30Q5 25 3 17Z',
  dome: 'M3 28V16A13 13 0 0 1 29 16V28Z',
  arch: 'M3 29V15A13 13 0 0 1 29 15V29H21V16A5 5 0 0 0 11 16V29Z',
  star: 'M16 1L21 11L31 12L24 20L26 31L16 26L6 31L8 20L1 12L11 11Z',
  house: 'M2 14L16 2L30 14V29H2Z',
  clover: 'M16 6C4-7-7 9 6 16C-7 28 9 39 16 26C28 39 39 23 26 16C39 4 23-7 16 6Z',
  flower:
    'M16 6C20-3 29 1 25 10C35 9 36 21 26 22C29 32 18 35 16 26C12 36 2 31 6 22C-5 20-2 9 7 10C3 1 13-3 16 6Z',
};
export function BotAvatar({
  name,
  avatar,
}: {
  name: string;
  avatar?: { shape: string; color: string; photoAvailable?: boolean };
}) {
  const shape = avatar?.shape || '';
  const color = colors[avatar?.color || ''];
  const rounded = [
    'pebble',
    'bean',
    'egg',
    'squircle',
    'tablet',
    'capsule',
    'cylinder',
    'square',
  ].includes(shape);
  if ((!shapes[shape] && !rounded) || !color)
    return (
      <span className="palboo-bot-avatar" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
    );
  return (
    <span className="palboo-bot-avatar palboo-bot-avatar-shaped" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill={color} data-shape={shape}>
        {shapes[shape] ? (
          <path d={shapes[shape]} />
        ) : (
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx={shape === 'square' ? 2 : shape === 'squircle' ? 8 : 13}
          />
        )}
        <ellipse cx="12" cy="16" rx="1.5" ry="2.2" fill="white" />
        <ellipse cx="20" cy="16" rx="1.5" ry="2.2" fill="white" />
      </svg>
    </span>
  );
}
