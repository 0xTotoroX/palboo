/* [INPUT]: Untrusted Obsidian Markdown, note identity and optional image/link adapters.
 * [OUTPUT]: Stable safe GFM nodes, YAML below H1, foldable callouts, copyable code and internal preview/navigation marks.
 * [POS]: No raw HTML/plugin execution; notes and assets stay in this reader, never in model context.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { SearchText } from './search';
import { NoteProperties } from './properties';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  depth?: number;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
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
export function obsidianMarkdown({
  highlight = '',
  startSerial = 0,
}: { highlight?: string; startSerial?: number } = {}) {
  return (root: Node) => {
    let serial = startSerial;
    function walk(node: Node) {
      if (['code', 'inlineCode', 'html', 'link', 'image'].includes(node.type)) return;
      if (!node.children) return;
      if (node.type === 'blockquote') {
        const paragraph = node.children[0];
        const first = paragraph?.children?.[0];
        const match = first?.type === 'text' && first.value?.match(/^\[!([\w-]+)\]([+-])?[ \t]*/);
        if (match && first && paragraph.children) {
          const kind = match[1].toLowerCase();
          first.value = first.value!.slice(match[0].length);
          const title: Node[] = [],
            body: Node[] = [];
          let inBody = false;
          for (const child of paragraph.children) {
            const newline = child.type === 'text' ? (child.value?.indexOf('\n') ?? -1) : -1;
            if (!inBody && newline >= 0) {
              title.push({ ...child, value: child.value!.slice(0, newline) });
              body.push({ ...child, value: child.value!.slice(newline + 1) });
              inBody = true;
            } else if (!inBody && child.type === 'break') inBody = true;
            else (inBody ? body : title).push(child);
          }
          if (!title.some((child) => plain(child).trim()))
            title.push({ type: 'text', value: kind });
          node.data = {
            hName: match[2] ? 'details' : 'aside',
            hProperties: {
              'data-callout': kind,
              className: 'reader-callout',
              ...(match[2] === '+' ? { open: true } : {}),
            },
          };
          node.children = [
            {
              type: 'paragraph',
              data: {
                hName: match[2] ? 'summary' : 'div',
                hProperties: { className: 'reader-callout-title' },
              },
              children: title,
            },
            ...(body.length ? [{ type: 'paragraph', children: body }] : []),
            ...node.children.slice(1),
          ];
        }
      }
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        const result: Node[] = [];
        let end = 0;
        for (const match of child.value.matchAll(
          /(!?)\[\[([^\]\n]+)\]\]|==([^=\n]+)==|(?<![\p{L}\p{N}_/#])#([\p{L}\p{N}_/-]*[\p{L}_-][\p{L}\p{N}_/-]*)/gu,
        )) {
          if (match.index > end)
            result.push({ type: 'text', value: child.value.slice(end, match.index) });
          if (match[3] || match[4]) {
            result.push(
              match[3]
                ? {
                    type: 'emphasis',
                    data: { hName: 'mark' },
                    children: [{ type: 'text', value: match[3] }],
                  }
                : {
                    type: 'link',
                    url: `palboo-tag:${encodeURIComponent(match[4])}`,
                    children: [{ type: 'text', value: `#${match[4]}` }],
                  },
            );
            end = match.index + match[0].length;
            continue;
          }
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
    }
    walk(root);
    const term = highlight.trim().toLocaleLowerCase();
    if (!term) return;
    function mark(node: Node) {
      if (['code', 'inlineCode', 'html'].includes(node.type) || !node.children) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type !== 'text' || !child.value) {
          mark(child);
          return [child];
        }
        const parts: Node[] = [];
        let start = 0,
          index = child.value.toLocaleLowerCase().indexOf(term);
        while (index >= 0) {
          parts.push(
            { type: 'text', value: child.value.slice(start, index) },
            {
              type: 'emphasis',
              data: { hName: 'mark', hProperties: { 'data-search-hit': true } },
              children: [{ type: 'text', value: child.value.slice(index, index + term.length) }],
            },
          );
          start = index + term.length;
          index = child.value.toLocaleLowerCase().indexOf(term, start);
        }
        parts.push({ type: 'text', value: child.value.slice(start) });
        return parts;
      });
    }
    mark(root);
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
  if (
    value.startsWith('palboo-note:') ||
    value.startsWith('palboo-image:') ||
    value.startsWith('palboo-tag:')
  )
    return value;
  if (value.startsWith('//') || /^[\s\S]*?:/.test(value)) return webUrl(value);
  return value;
}
type MarkdownProps = {
  id: string;
  text: string;
  follow: (target: string) => void;
  image?: ComponentType<{
    from: string;
    source: string;
    alt: string;
    width?: string | number;
    height?: string | number;
  }>;
  openExternal?: (url: string) => void;
  onTag?: (tag: string) => void;
  highlight?: string;
  backlink?: string;
};
export function NoteMarkdown(props: MarkdownProps) {
  const locale = useLocale();
  const adapters = useRef(props);
  adapters.current = props;
  const follow = useCallback((target: string) => adapters.current.follow(target), []);
  const onTag = useCallback((tag: string) => adapters.current.onTag?.(tag), []);
  const openExternal = useCallback((url: string) => adapters.current.openExternal?.(url), []);
  return (
    <StableMarkdown
      {...props}
      locale={locale}
      follow={follow}
      onTag={props.onTag ? onTag : undefined}
      openExternal={props.openExternal ? openExternal : undefined}
    />
  );
}
const StableMarkdown = memo(MarkdownView);
function MarkdownView({
  id,
  text,
  follow,
  image: Picture,
  openExternal,
  onTag,
  highlight = '',
  backlink = '',
}: MarkdownProps & { locale: string }) {
  const metadata = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
  const body = metadata ? text.slice(metadata[0].length) : text;
  const leadingH1 = metadata
    ? body.match(/^(?:[ \t]*\r?\n)*(#[ \t]+[^\r\n]+(?:\r?\n|$)|[^\r\n]+\r?\n=+[ \t]*(?:\r?\n|$))/)
    : null;
  const splitH1 = Boolean(leadingH1 && !leadingH1[0].includes(']['));
  const components: Components = {
    pre: CodeBlock,
    summary: ({ children, className, ...props }) =>
      className === 'reader-callout-title' ? (
        <summary className={className} {...props}>
          <span className="reader-callout-heading">{children}</span>
          <Icon name="chevron-right" />
        </summary>
      ) : (
        <summary className={className} {...props}>
          {children}
        </summary>
      ),
    code: ({ children, className }) => (
      <code className={className}>
        <SearchText text={String(children ?? '')} query={highlight} />
      </code>
    ),
    a: ({ href = '', children }) => {
      if (href.startsWith('palboo-tag:')) {
        const tag = decodeLink(href.slice(11));
        return onTag ? (
          <button type="button" className="reader-tag" onClick={() => onTag(tag)}>
            {children}
          </button>
        ) : (
          <span className="reader-tag">{children}</span>
        );
      }
      const external = webUrl(href);
      if (external)
        return (
          <a
            href={openExternal ? '#reference' : external}
            target={openExternal ? undefined : '_blank'}
            rel="noopener noreferrer"
            onClick={
              openExternal
                ? (event) => {
                    event.preventDefault();
                    openExternal(external);
                  }
                : undefined
            }
          >
            {children}
          </a>
        );
      if (!href) return <span>{children}</span>;
      const target = href.startsWith('palboo-note:') ? decodeLink(href.slice(12)) : href;
      return (
        <a
          title={target}
          data-note-target={target}
          data-backlink-hit={backlink && matchesBacklink(target, backlink, id) ? true : undefined}
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
    img: ({ src, alt = '', width, height }) =>
      Picture ? (
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
      ) : (
        <span>{alt}</span>
      ),
  };
  return (
    <>
      {splitH1 && leadingH1 && (
        <Markdown
          skipHtml
          remarkPlugins={[remarkGfm, [obsidianMarkdown, { highlight, startSerial: 0 }]]}
          urlTransform={safeUrl}
          components={components}
        >
          {leadingH1[0]}
        </Markdown>
      )}
      {metadata && <NoteProperties source={metadata[1]} onTag={onTag} query={highlight} />}
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, [obsidianMarkdown, { highlight, startSerial: splitH1 ? 1 : 0 }]]}
        urlTransform={safeUrl}
        components={components}
      >
        {splitH1 && leadingH1 ? body.slice(leadingH1[0].length) : body}
      </Markdown>
    </>
  );
}

function matchesBacklink(target: string, id: string, from: string) {
  const normalize = (value: string) =>
    decodeLink(value).split('#')[0].replace(/\.md$/i, '').replace(/^\.\//, '').toLocaleLowerCase();
  const link = normalize(target),
    note = normalize(id);
  const parts = from.split('/').slice(0, -1);
  for (const part of link.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return (
    !!link &&
    (link === note ||
      parts.join('/').toLocaleLowerCase() === note ||
      (!link.includes('/') && link === note.split('/').at(-1)))
  );
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const className =
    isValidElement<{ className?: string }>(children) && typeof children.props.className === 'string'
      ? children.props.className
      : '';
  const lang = className.match(/language-([\w-]+)/)?.[1] || '';
  return (
    <div className="reader-code-block">
      <div className="reader-code-bar">
        <span className="reader-code-lang">{lang}</span>
        <button
          type="button"
          className="reader-copy-code"
          data-copied={copied || undefined}
          aria-label={tr('复制代码')}
          title={tr('复制代码')}
          onClick={async () => {
            if (timer.current) clearTimeout(timer.current);
            try {
              await navigator.clipboard.writeText(code.current?.textContent || '');
              setCopied(true);
              setStatus(tr('已复制'));
              timer.current = setTimeout(() => {
                setCopied(false);
                setStatus('');
              }, 2000);
            } catch {
              setCopied(false);
              setStatus(tr('复制失败，请手动选择代码'));
            }
          }}
        >
          <Icon name={copied ? 'check' : 'reader-copy'} />
          <span role="status">{status || tr('复制代码')}</span>
        </button>
      </div>
      <pre ref={code}>{children}</pre>
    </div>
  );
}
