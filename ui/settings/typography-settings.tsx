import { Notice } from './settings-controls';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 五种窗口的独立字体偏好、旧偏好及原外观修订保存回调。
 * [OUTPUT]: 按窗口选择字体族、跟随对象、比例及固定字号；切换窗口/失败保留草稿。
 * [POS]: 字体设置唯一入口，不另建保存通道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import {
  defaultTypography,
  surfaceTypography,
  typographySurfaces,
  type SurfaceTypography,
  type TypographySurface,
  type TypographyPreferences,
} from '../shared/typography';
import { Field } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import { Input } from './components/ui/input';
export function TypographySettings({
  value,
  save,
  surface,
}: {
  surface?: TypographySurface;
  value?: TypographyPreferences;
  save: (value: TypographyPreferences) => Promise<unknown>;
}) {
  useLocale();
  const p = { ...defaultTypography, ...value };
  const id = (name: string) => `typography-${surface ? `${surface}-` : ''}${name}`;
  const fonts = [
    '',
    'system-ui',
    '"PingFang SC",sans-serif',
    '"Songti SC",serif',
    'ui-monospace,monospace',
  ];
  const [customFont, setCustomFont] = useState(!!p.fontFamily && !fonts.includes(p.fontFamily));
  const [family, setFamily] = useState(p.fontFamily || '');
  useEffect(() => {
    setFamily(p.fontFamily || '');
    setCustomFont(!!p.fontFamily && !fonts.includes(p.fontFamily));
  }, [p.fontFamily]);
  async function commitFamily() {
    if (
      !CSS.supports('font-family', family.trim() || 'inherit') ||
      family.length > 200 ||
      /[;{}<>\\\x00-\x1f\x7f]/.test(family)
    ) {
      setError(tr('请输入有效的本机字体名称'));
      return;
    }
    setError('');
    if (family.trim() !== p.fontFamily) await save({ ...p, fontFamily: family.trim() });
  }
  const [scale, setScale] = useState(String(p.scale)),
    [size, setSize] = useState(String(p.customSize));
  const [error, setError] = useState('');
  useEffect(() => {
    setScale(String(p.scale));
  }, [p.scale]);
  useEffect(() => {
    setSize(String(p.customSize));
  }, [p.customSize]);
  async function commit(key: 'scale' | 'customSize', text: string) {
    const number = Number(text),
      min = key === 'scale' ? 75 : 10,
      max = key === 'scale' ? 150 : 32;
    if (!text.trim() || !Number.isFinite(number) || number < min || number > max) {
      setError(tr('请输入 {{min}}–{{max}} 之间的数值', { min: min, max: max }));
      return;
    }
    setError('');
    if (number !== p[key]) await save({ ...p, [key]: Math.round(number * 10) / 10 });
  }
  const navigation = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('[data-settings-navigation]');
  return (
    <>
      <Field id={id('family')} label={tr('字体')}>
        <NativeSelect
          id={id('family')}
          controlWidth="medium"
          value={customFont ? 'custom' : p.fontFamily || ''}
          onChange={(event) => {
            const fontFamily = event.target.value;
            setCustomFont(fontFamily === 'custom');
            if (fontFamily !== 'custom') void save({ ...p, fontFamily });
          }}
        >
          <option value="">{tr('跟随 ChatGPT')}</option>
          <option value="system-ui">{tr('系统字体')}</option>
          <option value={'"PingFang SC",sans-serif'}>{tr('苹方')}</option>
          <option value={'"Songti SC",serif'}>{tr('宋体')}</option>
          <option value="ui-monospace,monospace">{tr('等宽字体')}</option>
          <option value="custom">{tr('自定义字体')}</option>
        </NativeSelect>
      </Field>
      <div hidden={!customFont} data-settings-search-ignore={!customFont || undefined}>
        <Field id={id('family-name')} label={tr('本机字体名称')}>
          <Input
            id={id('family-name')}
            value={family}
            maxLength={200}
            placeholder="Helvetica Neue"
            onChange={(event) => setFamily(event.target.value)}
            onBlur={(event) => {
              if (!navigation(event.relatedTarget)) void commitFamily();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </Field>
      </div>
      <Field id={id('mode')} label={tr('字体大小')}>
        <NativeSelect
          id={id('mode')}
          controlWidth="short"
          value={p.mode}
          onChange={(e) =>
            void save({ ...p, mode: e.target.value as TypographyPreferences['mode'] })
          }
        >
          <option value="follow">{tr('跟随 ChatGPT')}</option>
          <option value="custom">{tr('自定义字号')}</option>
        </NativeSelect>
      </Field>
      <div
        hidden={p.mode !== 'follow'}
        data-settings-search-ignore={p.mode !== 'follow' || undefined}
      >
        <div
          hidden={surface === 'settings'}
          data-settings-search-ignore={surface === 'settings' || undefined}
        >
          <Field id={id('source')} label={tr('跟随对象')}>
            <NativeSelect
              id={id('source')}
              controlWidth="short"
              value={p.source}
              onChange={(e) =>
                void save({ ...p, source: e.target.value as TypographyPreferences['source'] })
              }
            >
              <option value="body">{tr('聊天正文')}</option>
              <option value="session">{tr('左侧会话标题')}</option>
              <option value="composer">{tr('输入框文字')}</option>
            </NativeSelect>
          </Field>
        </div>
        <Field id={id('scale')} label={tr('相对大小（%）')}>
          <Input
            id={id('scale')}
            type="number"
            min={75}
            max={150}
            step={5}
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            onBlur={(e) => {
              if (!navigation(e.relatedTarget)) void commit('scale', scale);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </Field>
      </div>
      <div
        hidden={p.mode !== 'custom'}
        data-settings-search-ignore={p.mode !== 'custom' || undefined}
      >
        <Field id={id('size')} label={tr('自定义字号（px）')}>
          <Input
            id={id('size')}
            type="number"
            min={10}
            max={32}
            step={1}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onBlur={(e) => {
              if (!navigation(e.relatedTarget)) void commit('customSize', size);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </Field>
      </div>
      {error && <Notice failed>{error}</Notice>}
    </>
  );
}

export function SurfaceTypographySettings({
  value,
  legacy,
  save,
}: {
  value?: SurfaceTypography;
  legacy?: TypographyPreferences;
  save: (surface: TypographySurface, preferences: TypographyPreferences) => Promise<unknown>;
}) {
  useLocale();
  const [selected, setSelected] = useState<TypographySurface>('settings');
  const labels = {
    settings: '设置页',
    sidebar: '聊天侧栏',
    overlay: '页面浮层',
    desktop: '桌面窗口',
    edge: '贴边 / 刘海',
  };
  return (
    <>
      <Field id="typography-surface" label={tr('窗口')}>
        <div data-settings-navigation>
          <NativeSelect
            id="typography-surface"
            controlWidth="medium"
            value={selected}
            onChange={(event) => setSelected(event.target.value as TypographySurface)}
          >
            {typographySurfaces.map((surface) => (
              <option key={surface} value={surface}>
                {tr(labels[surface])}
              </option>
            ))}
          </NativeSelect>
        </div>
      </Field>
      {typographySurfaces.map((surface) => (
        <div
          key={surface}
          hidden={surface !== selected}
          data-settings-search-ignore={surface !== selected || undefined}
        >
          <TypographySettings
            surface={surface}
            value={surfaceTypography(surface, value, legacy)}
            save={(preferences) => save(surface, preferences)}
          />
        </div>
      ))}
    </>
  );
}
