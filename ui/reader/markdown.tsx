/* [INPUT]: Untrusted Obsidian Markdown, current note identity and authenticated image transport.
 * [OUTPUT]: Safe GFM, wikilinks, block/heading anchors, callouts and opt-in remote images.
 * [POS]: No raw HTML/plugin execution; notes and assets stay in this reader, never in model context.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { raw } from './api';
import { tr } from '../shared/i18n.js';
type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  depth?: number;
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
};
const plain = (node: Node): string => node.value || node.children?.map(plain).join('') || '';
export const anchorKey = (text: string) =>
  text.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLocaleLowerCase();
export function decodeLink(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
export function obsidianMarkdown() {
  return (root: Node) => {
    let serial = 0;
    function walk(node: Node) {
      if (['code', 'inlineCode', 'html', 'link', 'image'].includes(node.type)) return;
      if (!node.children) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        const result: Node[] = [];
        let end = 0;
        for (const match of child.value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          if (match.index > end)
            result.push({ type: 'text', value: child.value.slice(end, match.index) });
          const [target, label] = match[2].split('|');
          const image =
            !!match[1] && /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:#.*)?$/i.test(target);
          const dimensions = image ? label?.match(/^(\d+)(?:x(\d+))?$/) : null;
          result.push(
            image
              ? {
                  type: 'image',
                  url: `palboo-image:${encodeURIComponent(target)}`,
                  alt: dimensions ? target : label || target,
                  data: {
                    hProperties: {
                      width: dimensions ? Math.min(2000, +dimensions[1]) : undefined,
                      height: dimensions?.[2] ? Math.min(2000, +dimensions[2]) : undefined,
                    },
                  },
                }
              : {
                  type: 'link',
                  url: `palboo-note:${encodeURIComponent(target)}`,
                  children: [{ type: 'text', value: label || target }],
                },
          );
          end = match.index + match[0].length;
        }
        if (!end) return [child];
        if (end < child.value.length) result.push({ type: 'text', value: child.value.slice(end) });
        return result;
      });
      if (node.type === 'heading')
        node.data = {
          hProperties: { id: `heading-${serial++}`, 'data-note-anchor': anchorKey(plain(node)) },
        };
      if (node.type === 'paragraph') {
        const last = node.children.at(-1);
        const match = last?.type === 'text' && last.value?.match(/(?:^|\s)\^([\w-]+)\s*$/);
        if (match && last) {
          node.data = {
            hProperties: { id: `block-${match[1]}`, 'data-note-anchor': `^${match[1]}` },
          };
          last.value = last.value!.slice(0, match.index);
        }
      }
      if (node.type === 'blockquote') {
        const first = node.children[0]?.children?.[0];
        const match = first?.type === 'text' && first.value?.match(/^\[!([\w-]+)\][+-]?\s*/);
        if (match && first) {
          node.data = { hProperties: { 'data-callout': match[1].toLowerCase() } };
          first.value = first.value!.slice(match[0].length) || match[1];
        }
      }
    }
    walk(root);
  };
}
export function webUrl(value: string) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
function safeUrl(value: string) {
  if (value.startsWith('palboo-note:') || value.startsWith('palboo-image:')) return value;
  if (value.startsWith('//') || /^[\s\S]*?:/.test(value)) return webUrl(value);
  return value;
}
function Picture({
  from,
  source,
  alt,
  width,
  height,
}: {
  from: string;
  source: string;
  alt: string;
  width?: string | number;
  height?: string | number;
}) {
  const external = webUrl(source);
  const [allowed, setAllowed] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setUrl('');
    setError('');
    setAllowed(false);
    if (!source || external) return;
    const controller = new AbortController();
    let blob = '';
    void raw('image', { id: from, target: source }, controller.signal)
      .then((r) => r.blob())
      .then((value) => {
        if (controller.signal.aborted) return;
        blob = URL.createObjectURL(value);
        setUrl(blob);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [from, source, external]);
  const displayed = external ? (allowed ? external : '') : url;
  if (external && !allowed)
    return (
      <button className="reader-remote-image" onClick={() => setAllowed(true)} title={external}>
        {tr('加载外部图片')} · {alt || new URL(external).hostname}
      </button>
    );
  if (error)
    return (
      <span className="reader-image-error" role="status">
        {alt} — {error}
      </span>
    );
  if (!displayed) return <span role="status">{tr('正在读取图片…')}</span>;
  return (
    <span className="reader-picture">
      <button type="button" aria-label={tr('放大图片')} onClick={() => dialog.current?.showModal()}>
        <img
          src={displayed}
          alt={alt}
          width={width}
          height={height}
          referrerPolicy="no-referrer"
          onError={() => setError(tr('图片无法显示'))}
        />
      </button>
      <dialog ref={dialog} className="reader-lightbox" onClick={() => dialog.current?.close()}>
        <button type="button" aria-label={tr('关闭')} onClick={() => dialog.current?.close()}>
          ×
        </button>
        <img src={displayed} alt={alt} referrerPolicy="no-referrer" />
      </dialog>
    </span>
  );
}
export function NoteMarkdown({
  id,
  text,
  follow,
}: {
  id: string;
  text: string;
  follow: (target: string) => void;
}) {
  const metadata = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
  return (
    <>
      {metadata && (
        <details className="reader-properties">
          <summary>{tr('属性')}</summary>
          <pre>{metadata[1]}</pre>
        </details>
      )}
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, obsidianMarkdown]}
        urlTransform={safeUrl}
        components={{
          a: ({ href = '', children }) => {
            const external = webUrl(href);
            if (external)
              return (
                <a href={external} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            if (!href) return <span>{children}</span>;
            const target = href.startsWith('palboo-note:') ? decodeLink(href.slice(12)) : href;
            return (
              <a
                href={`?note=${encodeURIComponent(id)}#${encodeURIComponent(target)}`}
                onClick={(event) => {
                  event.preventDefault();
                  follow(target);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt = '', width, height }) => (
            <Picture
              from={id}
              source={
                typeof src === 'string'
                  ? src.startsWith('palboo-image:')
                    ? decodeLink(src.slice(13))
                    : src
                  : ''
              }
              alt={alt}
              width={width}
              height={height}
            />
          ),
        }}
      >
        {metadata ? text.slice(metadata[0].length) : text}
      </Markdown>
    </>
  );
}
