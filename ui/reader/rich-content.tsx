/* [INPUT]: Literal math/diagram source and reader tone, only when near the viewport.
 * [OUTPUT]: Lazy local formula/diagram views with source fallback, copy and image zoom.
 * [POS]: Shared Markdown leaves; cancels stale work and releases styles/blob URLs on unmount.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CodeFrame } from './code-block';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
export const MarkdownTone = createContext('light');
function useNearViewport() {
  const ref = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, near };
}
export function MathFormula({ source, display = false }: { source: string; display?: boolean }) {
  const { ref, near } = useNearViewport();
  const [result, setResult] = useState<{ source: string; html?: string; failed?: boolean }>();
  useEffect(() => {
    if (!near) return;
    let active = true;
    let release: (() => void) | undefined;
    void import('./math-engine')
      .then((engine) => {
        if (!active || !ref.current) return;
        release = engine.mathStyles(ref.current);
        setResult({ source, html: engine.renderMath(source, display) });
      })
      .catch(() => {
        if (active) setResult({ source, failed: true });
      });
    return () => {
      active = false;
      release?.();
    };
  }, [near, source, display]);
  const current = result?.source === source ? result : undefined;
  const Tag = display ? 'div' : 'span';
  return (
    <Tag
      ref={ref}
      className={display ? 'reader-math reader-math-display' : 'reader-math'}
      data-state={current?.failed ? 'error' : current?.html ? 'ready' : 'pending'}
      title={current?.failed ? tr('公式无法显示，已保留源码') : undefined}
    >
      {current?.html ? (
        <span dangerouslySetInnerHTML={{ __html: current.html }} />
      ) : (
        <code>{source}</code>
      )}
    </Tag>
  );
}
export function MermaidDiagram({ source }: { source: string }) {
  const tone = useContext(MarkdownTone);
  const { ref, near } = useNearViewport();
  const [showSource, setShowSource] = useState(false);
  const [result, setResult] = useState<{
    source: string;
    tone: string;
    url?: string;
    failed?: boolean;
  }>();
  const dialog = useRef<HTMLDialogElement>(null);
  const urls = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );
  useEffect(() => {
    for (const url of urls.current) {
      if (url !== result?.url) {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }
    }
  }, [result?.url]);
  useEffect(() => {
    if (!near) return;
    const controller = new AbortController();
    void import('./diagram-engine')
      .then(async (engine) => {
        if (controller.signal.aborted || !ref.current) return;
        const svg = await engine.renderDiagram(
          source,
          engine.diagramPalette(ref.current, tone === 'dark'),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        urls.current.add(url);
        setResult({ source, tone, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ source, tone, failed: true });
      });
    return () => {
      controller.abort();
    };
  }, [near, source, tone]);
  // Keep the previous image's geometry until its new-theme replacement is ready.
  const current = result?.source === source ? result : undefined;
  return (
    <div
      ref={ref}
      className="reader-diagram"
      data-state={current?.failed ? 'error' : current?.url ? 'ready' : 'pending'}
    >
      <CodeFrame
        language="Mermaid"
        source={source}
        actions={
          current?.url && (
            <button
              type="button"
              className="reader-diagram-source"
              aria-pressed={showSource}
              onClick={() => setShowSource((value) => !value)}
            >
              {tr(showSource ? '图表' : '源码')}
            </button>
          )
        }
      >
        {current?.failed && (
          <p className="reader-rich-error" role="status">
            {tr('图表无法显示，已保留源码')}
          </p>
        )}
        {current?.url && !showSource ? (
          <button
            type="button"
            className="reader-diagram-zoom"
            aria-label={tr('放大图表')}
            title={tr('放大图表')}
            onClick={() => dialog.current?.showModal()}
          >
            <img src={current.url} alt={tr('Mermaid 图表')} />
          </button>
        ) : (
          <pre>
            <code>{source}</code>
          </pre>
        )}
      </CodeFrame>
      <dialog ref={dialog} className="reader-diagram-dialog" aria-label={tr('Mermaid 图表')}>
        <button
          type="button"
          className="reader-tool-btn"
          aria-label={tr('关闭图表')}
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
        {current?.url && <img src={current.url} alt={tr('Mermaid 图表')} />}
      </dialog>
    </div>
  );
}
