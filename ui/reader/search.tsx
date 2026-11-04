/* [INPUT]: Plain text and a local search phrase.
 * [OUTPUT]: Escaped text fragments with semantic search marks, including code and properties.
 * [POS]: Presentation helper shared by reader navigation and Markdown; no DOM mutation or I/O.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export function SearchText({ text, query = '' }: { text: string; query?: string }) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return <>{text}</>;
  const parts = [];
  let start = 0,
    index = text.toLocaleLowerCase().indexOf(term);
  while (index >= 0) {
    parts.push(
      text.slice(start, index),
      <mark data-search-hit key={index}>
        {text.slice(index, index + term.length)}
      </mark>,
    );
    start = index + term.length;
    index = text.toLocaleLowerCase().indexOf(term, start);
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}
