/* [INPUT]: 预览标题、状态及示例内容。
 * [OUTPUT]: 各设置页共用的预览外框与标题层级。
 * [POS]: 纯展示组件，不读取配置或发出保存请求。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { ReactNode } from 'react';

export function PreviewFrame({
  title,
  label = '示意预览',
  className = '',
  children,
}: {
  title: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`preview-frame ${className}`.trim()} aria-label={title}>
      <header className="preview-heading">
        <h2>{title}</h2>
        <span>{label}</span>
      </header>
      {children}
    </section>
  );
}
