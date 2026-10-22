/* [INPUT]: 预览可访问名称、必要状态及示例内容。
 * [OUTPUT]: 无重复可见标题的预览外框；仅在有变化或异常时显示状态。
 * [POS]: 纯展示组件，不读取配置或发出保存请求。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import type { ReactNode } from 'react';

export function PreviewFrame({
  title,
  status,
  className = '',
  children,
}: {
  title: string;
  status?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`preview-frame ${className}`.trim()} aria-label={title}>
      {children}
      {status && <p className="preview-status">{status}</p>}
    </section>
  );
}
