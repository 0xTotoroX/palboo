/* [INPUT]: 预览类型、示例内容及消费方的语义颜色。
 * [OUTPUT]: 整体界面16:9、单功能内容自适应的哑光外框，长内容内部滚动。
 * [POS]: 设置与介绍页共用的纯展示组件，不读取配置或保存，不维护额外材质渲染层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { HTMLAttributes, ReactNode } from 'react';

export function PreviewFrame({
  title,
  status,
  format = 'feature',
  className = '',
  before,
  after,
  children,
  ...attributes
}: {
  title: string;
  status?: string;
  format?: 'interface' | 'feature';
  className?: string;
  before?: ReactNode;
  after?: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <>
      {before}
      <section
        {...attributes}
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
