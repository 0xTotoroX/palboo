/* [INPUT]: Rendered heading identity, current section and explicit scroll adapter.
 * [OUTPUT]: Heading navigation with a current-section indicator.
 * [POS]: Transport-free content for the shared reading information panel.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
export type Heading = { id: string; text: string; level: number };
export function ReadingOutline({
  headings,
  active,
  jump,
}: {
  headings: Heading[];
  active: string;
  jump: (id: string) => void;
}) {
  const minLevel = Math.min(...headings.map((item) => item.level));
  return headings.length ? (
    <nav className="reader-toc" aria-label={tr('文章目录')}>
      {headings.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={active === item.id ? 'location' : undefined}
          style={{ paddingInlineStart: 12 + (item.level - minLevel) * 12 }}
          onClick={(event) => {
            event.preventDefault();
            jump(item.id);
          }}
        >
          {item.text}
        </a>
      ))}
    </nav>
  ) : (
    <p className="reader-info-empty">{tr('这篇笔记没有标题')}</p>
  );
}
