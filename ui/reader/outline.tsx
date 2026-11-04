/* [INPUT]: Rendered heading identity, current section and explicit scroll adapter.
 * [OUTPUT]: Responsive collapsible/pinnable reading outline with active section semantics.
 * [POS]: Reader-only navigation chrome; wide layout depends on available article width.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
import { Icon } from '../shared/icons/react';
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
  const [pinned, setPinned] = useState(true);
  if (headings.length < 2) return null;
  return (
    <aside className="reader-outline" data-pinned={pinned}>
      <details className="reader-toc" open={pinned}>
        <summary>
          <Icon name="feature-outline" />
          <span>{tr('文章目录')}</span>
        </summary>
        <nav aria-label={tr('文章目录')}>
          {headings.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={active === item.id ? 'location' : undefined}
              style={{ paddingInlineStart: (item.level - 1) * 12 }}
              onClick={(event) => {
                event.preventDefault();
                jump(item.id);
              }}
            >
              {item.text}
            </a>
          ))}
        </nav>
      </details>
      <button
        className="reader-outline-pin"
        aria-pressed={pinned}
        title={tr('常驻文章目录')}
        aria-label={tr('常驻文章目录')}
        onClick={() => setPinned(!pinned)}
      >
        <Icon name="pin" />
      </button>
    </aside>
  );
}
