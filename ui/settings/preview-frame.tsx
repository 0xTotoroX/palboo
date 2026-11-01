/* [INPUT]: 预览类型、示例内容及共用 SVG 液态渲染器。
 * [OUTPUT]: 整体界面16:9、单功能内容自适应的 Clear 外框，长内容内部滚动。
 * [POS]: 纯展示组件；只在可见且允许透明效果时维护折射，不读取配置或保存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createSvgGlass } from '../surfaces/theme/glass/svg.js';

export function PreviewFrame({
  title,
  status,
  format = 'feature',
  className = '',
  before,
  after,
  children,
}: {
  title: string;
  status?: string;
  format?: 'interface' | 'feature';
  className?: string;
  before?: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
    let glass: ReturnType<typeof createSvgGlass> | undefined;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!node.clientWidth || !node.clientHeight || reduced.matches) {
          glass?.destroy();
          glass = undefined;
          return;
        }
        try {
          glass ??= createSvgGlass(node);
          glass.refresh('clear');
        } catch {
          // 不支持 SVG 背景折射的浏览器使用同一透明染色与柔光边缘。
          glass?.destroy();
          glass = undefined;
        }
      });
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(node);
    reduced.addEventListener('change', refresh);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', refresh);
      glass?.destroy();
    };
  }, [format]);
  return (
    <>
      {before}
      <section
        className={`preview-frame ${className}`.trim()}
        data-preview-format={format}
        aria-label={title}
      >
        {format === 'feature' && (
          <div ref={surface} className="preview-clear-surface" aria-hidden="true" />
        )}
        <div className="preview-frame-content">{children}</div>
      </section>
      {status && <p className="preview-status">{status}</p>}
      {after}
    </>
  );
}
