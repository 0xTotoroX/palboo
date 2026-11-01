/*
 * [INPUT]: React select 属性、选项与设置页语义变量。
 * [OUTPUT]: 按用途声明控件宽度及可选内嵌动作，保留原生选择语义/事件和不支持浏览器的原生回退。
 * [POS]: Web 设置页基础组件，不用于宿主注入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import * as React from 'react';
import { Icon } from '../../../shared/icons/react';
import { cn } from '@/utils';
import { inputStyles } from './input';
export function NativeSelect({
  className,
  controlWidth = 'full',
  action,
  ...props
}: React.ComponentProps<'select'> & {
  controlWidth?: 'compact' | 'short' | 'medium' | 'full';
  action?: React.ReactNode;
}) {
  return (
    <div
      className="settings-native-select relative w-full"
      data-control-width={controlWidth}
      data-has-action={!!action}
    >
      <select
        data-slot="native-select"
        className={cn(inputStyles, 'appearance-none pr-8', className)}
        {...props}
      />
      {action && <span className="settings-select-action">{action}</span>}
      <Icon
        name="chevron-down"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
