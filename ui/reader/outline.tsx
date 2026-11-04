/* [INPUT]: Rendered heading identity, current section and explicit scroll adapter.
 * [OUTPUT]: Responsive collapsible/sticky scrollspy outline with active section rail.
 * [POS]: Reader-only navigation chrome; wide layout uses a sticky right rail, narrow uses inline disclosure.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1188px)').matches);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const container = ref.current?.closest('.reader-main');
    if (!container || typeof ResizeObserver === 'undefined') return;
    const sync = () => setWide(container.clientWidth >= 920);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    return () => observer.disconnect();
  }, [headings.length]);
  if (headings.length < 2) return null;
  const minLevel = Math.min(...headings.map((item) => item.level));
  return (
    <aside ref={ref} className="reader-outline">
      <details
        className="reader-toc"
        open={wide || open}
        onToggle={(event) => {
          if (!wide) setOpen(event.currentTarget.open);
        }}
      >
        <summary
          onClick={(event) => {
            if (wide) event.preventDefault();
          }}
        >
          <Icon name="feature-outline" />
          <span>{tr('文章目录')}</span>
          {!wide && <Icon name="chevron-right" />}
        </summary>
        <nav aria-label={tr('文章目录')}>
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
      </details>
    </aside>
  );
}
