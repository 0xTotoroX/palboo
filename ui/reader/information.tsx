/* [INPUT]: Available reader width, rendered headings, backlinks and explicit navigation adapters.
 * [OUTPUT]: One reading-information surface: independent desktop rail or focus-contained narrow dialog.
 * [POS]: Shared reader/site chrome; responsive state never remounts the reading article.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ReadingOutline, type Heading } from './outline';
import type { Summary } from './api';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
export function useReadingInfo(
  app: RefObject<HTMLDivElement | null>,
  docked: boolean,
  enabled: boolean,
) {
  const [wide, setWide] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const root = app.current;
    if (!root) return;
    const sidebar = root.querySelector<HTMLElement>('.reader-sidebar');
    const sync = () =>
      setWide(
        root.clientWidth - (docked ? sidebar?.getBoundingClientRect().width || 0 : 0) >= 1040,
      );
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    if (sidebar) observer.observe(sidebar);
    return () => observer.disconnect();
  }, [docked]);
  useEffect(() => {
    setOverlay(false);
  }, [wide, enabled]);
  return {
    wide,
    trigger,
    visible: enabled && (wide ? pinned : overlay),
    rail: enabled && wide && pinned,
    close: () => {
      if (wide) setPinned(false);
      else setOverlay(false);
    },
    dismiss: () => setOverlay(false),
    toggle: () => {
      if (wide) setPinned((value) => !value);
      else setOverlay((value) => !value);
    },
  };
}
export function ReadingInfo({
  state,
  headings,
  active,
  backlinks,
  jump,
  open,
  inert = false,
  bounds,
}: {
  state: ReturnType<typeof useReadingInfo>;
  headings: Heading[];
  active: string;
  backlinks: Summary[];
  jump: (id: string) => void;
  open: (id: string) => void;
  inert?: boolean;
  bounds?: RefObject<HTMLDivElement | null>;
}) {
  const [tab, setTab] = useState('outline');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (state.visible && !state.wide) node.showModal();
    else if (node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [state.visible, state.wide]);
  useLayoutEffect(() => {
    const node = dialog.current;
    const root = bounds?.current;
    if (!node || !root || !state.visible) return;
    const position = () => {
      const box = root.getBoundingClientRect();
      const width = Math.min(336, box.width - 16);
      Object.assign(node.style, {
        left: `${box.right - width}px`,
        top: `${box.top}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${width}px`,
        height: `${box.height}px`,
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(root);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', position, true);
    };
  }, [state.visible, state.wide, bounds]);
  const contents = (
    <>
      <div className="reader-info-header">
        <div role="tablist" aria-label={tr('阅读信息')}>
          {[
            ['outline', tr('文章目录')],
            ['backlinks', tr('反向链接')],
          ].map(([id, label], index) => (
            <button
              ref={(node) => {
                buttons.current[index] = node;
              }}
              key={id}
              id={`reader-info-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`reader-info-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
                setTab(next ? 'backlinks' : 'outline');
                buttons.current[next]?.focus();
              }}
            >
              {label}
              {id === 'backlinks' && backlinks.length > 0 && (
                <span className="reader-meta-count">{backlinks.length}</span>
              )}
            </button>
          ))}
        </div>
        <button
          className="reader-tool-btn"
          title={tr('关闭阅读信息')}
          aria-label={tr('关闭阅读信息')}
          onClick={state.close}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="reader-info-body">
        <section
          role="tabpanel"
          id="reader-info-outline"
          aria-labelledby="reader-info-tab-outline"
          hidden={tab !== 'outline'}
        >
          <ReadingOutline
            headings={headings}
            active={active}
            jump={(id) => {
              state.dismiss();
              jump(id);
            }}
          />
        </section>
        <section
          className="reader-backlinks"
          role="tabpanel"
          id="reader-info-backlinks"
          aria-labelledby="reader-info-tab-backlinks"
          hidden={tab !== 'backlinks'}
        >
          {backlinks.length ? (
            <ul>
              {backlinks.map((item) => (
                <li key={item.id}>
                  <button
                    title={item.id}
                    onClick={() => {
                      state.dismiss();
                      open(item.id);
                    }}
                  >
                    <Icon name="reader-note" />
                    <span>
                      <span className="reader-backlink-title">{item.title}</span>
                      <small>{item.id}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="reader-info-empty">{tr('暂无反向链接')}</p>
          )}
        </section>
      </div>
    </>
  );
  return state.wide ? (
    <aside
      id="reader-information"
      className="reader-information"
      aria-label={tr('阅读信息')}
      hidden={!state.visible}
      inert={inert}
    >
      {contents}
    </aside>
  ) : (
    <dialog
      id="reader-information"
      ref={dialog}
      className="reader-information reader-info-dialog"
      aria-label={tr('阅读信息')}
      onCancel={state.close}
      onClose={() => {
        if (state.visible) state.close();
        state.trigger.current?.focus({ preventScroll: true });
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            state.close();
        }
      }}
    >
      {contents}
    </dialog>
  );
}
