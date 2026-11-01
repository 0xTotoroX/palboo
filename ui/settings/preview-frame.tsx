/* [INPUT]: 预览类型、示例内容及设置语义颜色。
 * [OUTPUT]: 整体界面16:9、单功能内容自适应的哑光外框，长内容内部滚动。
 * [POS]: 纯展示组件，不读取配置或保存，不维护额外材质渲染层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { ReactNode } from 'react';

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
  return (
    <>
      {before}
      <section
        className={`preview-frame ${className}`.trim()}
        data-preview-format={format}
        aria-label={title}
      >
        <div className="preview-frame-content">{children}</div>
      </section>
      {status && <p className="preview-status">{status}</p>}
      {after}
    </>
  );
}
