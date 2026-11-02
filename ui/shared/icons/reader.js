/* [INPUT]: Semantic reader navigation names.
 * [OUTPUT]: Palboo-authored lightweight folder and document SVGs.
 * [POS]: Shared icon resources, GPL-3.0-only; no third-party artwork.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
const svg = (name, paths) =>
  `<svg aria-hidden="true" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
export const readerGlyphs = {
  'reader-sidebar': svg(
    'reader-sidebar',
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M6 8v8"/>',
  ),
  'reader-sheet': svg(
    'reader-sheet',
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M8 9v11M14 9v11"/>',
  ),
  'reader-folder': svg(
    'reader-folder',
    '<path d="M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/>',
  ),
  'reader-folder-open': svg(
    'reader-folder-open',
    '<path d="M3 18V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5V10M3 19l3-8h16l-3 9H4a1 1 0 0 1-1-1Z"/>',
  ),
  'reader-note': svg(
    'reader-note',
    '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Zm0 0v5h5M9 12h6M9 16h6"/>',
  ),
};
