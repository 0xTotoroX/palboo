/* [INPUT]: 预览类型、可访问名称、必要状态、框外演示操作及示例内容。
 * [OUTPUT]: 整体界面16:9、单功能按内容自然增高的统一外框，长内容内部滚动。
 * [POS]: 纯展示组件，不读取配置或发出保存请求。
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
