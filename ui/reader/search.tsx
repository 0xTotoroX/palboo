/* [INPUT]: Plain text and a local search phrase.
 * [OUTPUT]: Escaped text fragments with semantic search marks, including code and properties.
 * [POS]: Presentation helper shared by reader navigation and Markdown; no DOM mutation or I/O.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
// Search uses literal words, as does the catalog. Keep original offsets for rendering.
export function searchPattern(query: string): RegExp | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length || query.length > 500) return null;
  const literals = [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(literals.join('|'), 'giu');
}
export function SearchText({ text, query = '' }: { text: string; query?: string }) {
  const pattern = searchPattern(query);
  if (!pattern) return <>{text}</>;
  const parts = [];
  let start = 0;
  for (const { 0: hit, index } of text.matchAll(pattern)) {
    parts.push(
      text.slice(start, index),
      <mark data-search-hit key={index}>
        {hit}
      </mark>,
    );
    start = index + hit.length;
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}
