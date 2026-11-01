/* [INPUT]: 当前液态变体、可访问名称、忙碌状态及原保存回调。
 * [OUTPUT]: 中性色空心/实心星星，按下表示 Clear，否则为 Regular。
 * [POS]: 设置材质选择器内的附属动作，不持有业务数据或调用服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { Icon } from '../shared/icons/react';
import { IconButton } from './components/ui/button';

export function LiquidVariantToggle({
  id,
  label,
  value = 'regular',
  disabled,
  onChange,
}: {
  id?: string;
  label: string;
  value?: string;
  disabled?: boolean;
  onChange: (value: 'regular' | 'clear') => void;
}) {
  const clear = value === 'clear';
  return (
    <IconButton
      id={id}
      className="settings-liquid-toggle"
      aria-label={label}
      aria-description="Clear"
      aria-pressed={clear}
      title="Clear"
      disabled={disabled}
      onClick={() => onChange(clear ? 'regular' : 'clear')}
    >
      <Icon name={clear ? 'star-filled' : 'star'} />
    </IconButton>
  );
}
