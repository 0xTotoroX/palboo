/* [INPUT]: Internal Markdown link events and a scoped, abortable excerpt loader.
 * [OUTPUT]: Delayed pointer/keyboard preview with bounded transient cache and explicit open actions.
 * [POS]: Shared reader/site UI; never fetches images, executes Markdown or navigates on hover.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { LinkPreview } from './api';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
type PreviewState = {
  link: HTMLAnchorElement;
  target: string;
  value?: LinkPreview;
  error?: string;
};
function useLinkPreview(
  source: string,
  revision: number | string,
  load: (target: string, signal: AbortSignal) => Promise<LinkPreview>,
  open: (id: string, anchor: string) => void,
  follow: (target: string) => void,
) {
  const [state, setState] = useState<PreviewState | null>(null);
  const current = useRef<PreviewState | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, LinkPreview>());
  const suppressed = useRef<HTMLAnchorElement | null>(null);
  const callbacks = useRef({ load, open, follow });
  callbacks.current = { load, open, follow };
  function cancelTimer() {
    clearTimeout(timer.current);
  }
  function close(restore = false) {
    cancelTimer();
    request.current?.abort();
    const link = current.current?.link;
    if (link) link.removeAttribute('aria-describedby');
    current.current = null;
    setState(null);
    if (restore && link?.isConnected) {
      suppressed.current = link;
      link.focus({ preventScroll: true });
    }
  }
  useEffect(() => {
    close();
    cache.current.clear();
    return () => {
      cancelTimer();
      request.current?.abort();
    };
  }, [source, revision]);
  async function show(link: HTMLAnchorElement, force = false) {
    cancelTimer();
    if (!force && current.current?.link === link) return;
    close();
    const target = link.dataset.noteTarget!;
    const next: PreviewState = { link, target, value: cache.current.get(target) };
    current.current = next;
    setState(next);
    if (next.value) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const value = await callbacks.current.load(target, controller.signal);
      if (controller.signal.aborted || current.current?.link !== link) return;
      cache.current.set(target, value);
      if (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!);
      current.current = { ...next, value };
      setState(current.current);
    } catch (error) {
      if (!controller.signal.aborted && current.current?.link === link) {
        current.current = { ...next, error: (error as Error).message };
        setState(current.current);
      }
    }
  }
  const inside = (node: EventTarget | null) =>
    node instanceof Node && (current.current?.link.contains(node) || card.current?.contains(node));
  const leave = (next: EventTarget | null) => {
    if (inside(next)) return;
    cancelTimer();
    timer.current = setTimeout(() => close(), 180);
  };
  const linkFrom = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-note-target]') : null;
  const events: HTMLAttributes<HTMLDivElement> = {
    onPointerOver(event) {
      if (event.pointerType === 'touch') return;
      const link = linkFrom(event.target);
      if (!link || link.contains(event.relatedTarget as Node | null)) return;
      suppressed.current = null;
      cancelTimer();
      timer.current = setTimeout(() => void show(link), 300);
    },
    onPointerOut(event) {
      if (linkFrom(event.target)) leave(event.relatedTarget);
    },
    onFocus(event) {
      const link = linkFrom(event.target);
      if (link && suppressed.current !== link) void show(link);
    },
    onBlur(event) {
      if (linkFrom(event.target)) {
        suppressed.current = null;
        leave(event.relatedTarget);
      }
    },
    onClick() {
      close();
    },
    onKeyDown(event) {
      if (event.key === 'Escape' && current.current) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
      if (
        ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'ArrowDown' && event.altKey)) &&
        current.current
      ) {
        const first = card.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
        if (first) {
          event.preventDefault();
          first.focus();
          cancelTimer();
        }
      }
    },
  };
  useLayoutEffect(() => {
    const node = card.current;
    if (!state || !node) return;
    if (!state.link.isConnected) {
      close();
      return;
    }
    node.showPopover();
    state.link.setAttribute('aria-describedby', 'reader-link-preview-body');
    const position = () => {
      const anchor = state.link.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      node.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12))}px`;
      node.style.top = `${Math.max(12, Math.min(anchor.bottom + 8 + box.height <= innerHeight - 12 ? anchor.bottom + 8 : anchor.top - box.height - 8, innerHeight - box.height - 12))}px`;
    };
    position();
    const scroll = (event: Event) => {
      if (!node.contains(event.target as Node)) close();
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [state]);
  const value = state?.value;
  const single = value?.total === 1 ? value.candidates[0] : undefined;
  const choose = (id: string, anchor: string) => {
    close();
    callbacks.current.open(id, anchor);
  };
  return {
    events,
    close,
    card: state && (
      <div
        ref={card}
        popover="manual"
        className="reader-link-preview"
        role="dialog"
        aria-label={tr('链接预览')}
        onPointerEnter={cancelTimer}
        onPointerLeave={(event) => leave(event.relatedTarget)}
        onFocus={cancelTimer}
        onBlur={(event) => leave(event.relatedTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <div className="reader-preview-heading">
          <strong>{single?.title || tr('链接预览')}</strong>
          <button
            className="reader-tool-btn"
            aria-label={tr('关闭预览')}
            title={tr('关闭预览')}
            onClick={() => close(true)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div id="reader-link-preview-body" className="reader-preview-body" aria-live="polite">
          {!value && !state.error && <p role="status">{tr('正在读取预览…')}</p>}
          {state.error && (
            <>
              <p role="alert">{state.error}</p>
              <button onClick={() => void show(state.link, true)}>{tr('重试')}</button>
            </>
          )}
          {value?.total === 0 && <p>{tr('链接指向的笔记不存在')}</p>}
          {single && (
            <>
              <small>
                {single.id}
                {value?.anchor ? ` · ${value.anchor}` : ''}
              </small>
              <p className="reader-preview-excerpt">
                {value?.excerpt ||
                  tr(single.kind === 'spreadsheet' ? '打开查看表格' : '这篇笔记暂无正文')}
              </p>
            </>
          )}
          {value && value.total > 1 && (
            <>
              <p>{tr('选择链接目标')}</p>
              <ul>
                {value.candidates.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => choose(item.id, value.anchor)}>
                      {item.title}
                      <small>{item.id}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {single && (
          <button className="reader-preview-open" onClick={() => choose(single.id, value!.anchor)}>
            {tr('打开笔记')}
            <Icon name="chevron-right" />
          </button>
        )}
        {value && value.total > value.candidates.length && (
          <button
            onClick={() => {
              const target = state.target;
              close();
              callbacks.current.follow(target);
            }}
          >
            {tr('查看全部链接目标')}
          </button>
        )}
      </div>
    ),
  };
}

export function PreviewableMarkdown({
  source,
  revision,
  load,
  open,
  follow,
  contentRef,
  children,
}: {
  source: string;
  revision: number | string;
  load: (target: string, signal: AbortSignal) => Promise<LinkPreview>;
  open: (id: string, anchor: string) => void;
  follow: (target: string) => void;
  contentRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const preview = useLinkPreview(source, revision, load, open, follow);
  return (
    <div className="reader-markdown" ref={contentRef} {...preview.events}>
      {children}
      {preview.card}
    </div>
  );
}
