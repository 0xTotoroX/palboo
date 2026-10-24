/* [INPUT]: 版本化外观偏好与认证 API。
 * [OUTPUT]: 下一步的显示/点击设置，及按布局/外观页面显示的全局字体、侧栏页面开关、整数宽度和置顶设置，草稿持续挂载。
 * [POS]: 保留有效旧字段的设置适配；不再编辑旧两功能布局、主题或窗口归属。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { DOCK_MIN_WIDTH } from '../surfaces/embedded/width.js';
import { useEffect, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { TypographySettings } from './typography-settings';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { Field, Toggle, Feedback } from './settings-controls';
import { useFeedbackTarget } from './settings-feedback';
import { request } from './api';
import type { AppearanceSettings, PanelPreferences } from '../shared/contracts';
export function PanelSettings({
  value,
  fontBase = 13,
  section = 'surfaces',
  page,
}: {
  value?: AppearanceSettings;
  fontBase?: number;
  section?: 'next' | 'surfaces';
  page?: 'surfaces' | 'appearance';
}) {
  const feedback = useFeedbackTarget();
  const [prefs, setPrefs] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  if (!prefs) return null;
  const { ui } = prefs;
  async function update(body: object) {
    if (!prefs || busy) return;
    feedback.capture();
    setBusy(true);
    setError('');
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          ...body,
          expectedRevision: prefs.revision,
        }),
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  const change = (key: keyof PanelPreferences, value: unknown) =>
    void update({ ui: { [key]: value } });
  const number = (
    id: string,
    label: string,
    value: number,
    min: number,
    max: number,
    commit: (n: number) => void,
    decimal = false,
  ) => {
    const bump = (input: HTMLInputElement, delta: number) => {
      const current = input.valueAsNumber;
      const next =
        Math.round(
          Math.max(min, Math.min(max, (Number.isFinite(current) ? current : value) + delta)) * 10,
        ) / 10;
      input.value = String(next);
      return next;
    };
    return (
      <Field id={id} label={label}>
        <div className={decimal ? 'font-stepper' : undefined}>
          <Input
            key={decimal ? `${value}` : value}
            id={id}
            type="number"
            defaultValue={value}
            min={min}
            max={Number.isFinite(max) ? max : undefined}
            step={1}
            onKeyDown={(e) => {
              if (decimal && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                bump(e.currentTarget, e.key === 'ArrowUp' ? 1 : -1);
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              if (
                e.relatedTarget instanceof Element &&
                e.relatedTarget.closest('[data-settings-navigation]')
              )
                return;
              const entered = e.currentTarget.valueAsNumber;
              const n = decimal ? Math.round(entered * 10) / 10 : Math.round(entered);
              if (Number.isFinite(n) && n >= min && n <= max) {
                e.currentTarget.value = String(n);
                if (n !== value) commit(n);
              } else {
                feedback.capture();
                e.currentTarget.value = String(value);
                setError(
                  Number.isFinite(max) ? `${label}范围为 ${min}–${max}` : `${label}不能小于 ${min}`,
                );
              }
            }}
          />
          {decimal &&
            [-1, 1].map((delta) => (
              <button
                type="button"
                key={delta}
                aria-label={`${delta < 0 ? '减小' : '增大'}${label}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  const input = e.currentTarget.parentElement!.querySelector('input')!;
                  const next = bump(input, delta);
                  if (next !== value) commit(next);
                }}
              >
                {delta < 0 ? <Icon name="minus" /> : <Icon name="plus" />}
              </button>
            ))}
        </div>
      </Field>
    );
  };
  return (
    <fieldset
      className="min-w-0 border-0 p-0"
      disabled={busy}
      onBlurCapture={feedback.track}
      onChangeCapture={feedback.track}
      onPointerDownCapture={feedback.track}
    >
      {section === 'next' ? (
        <>
          <Field id="suggestion-labels" label="内容显示">
            <NativeSelect
              id="suggestion-labels"
              controlWidth="short"
              value={String(ui.labelOnly)}
              onChange={(e) => change('labelOnly', e.target.value === 'true')}
            >
              <option value="false">标题 + 摘要</option>
              <option value="true">仅标题</option>
            </NativeSelect>
          </Field>
          <Field id="suggestion-click" label="指令执行模式">
            <NativeSelect
              id="suggestion-click"
              controlWidth="medium"
              value={ui.promptClickMode}
              onChange={(e) => change('promptClickMode', e.target.value)}
            >
              <option value="fill">仅填入</option>
              <option value="direct">直接发送</option>
              <option value="hybrid">单击填入 · 双击发送</option>
            </NativeSelect>
          </Field>
        </>
      ) : (
        <>
          <section
            className="settings-section settings-surface-group"
            id="settings-fonts"
            data-settings-page="appearance"
            hidden={page === 'surfaces'}
          >
            <h2>字体</h2>
            <TypographySettings
              value={prefs.typography}
              save={(typography) => update({ typography })}
            />
          </section>
          <section
            className="settings-section settings-surface-group"
            id="settings-sidebar-pages"
            data-settings-page="surfaces"
            hidden={page === 'appearance'}
          >
            <h2>侧栏显示范围</h2>
            <div className="settings-surface-grid">
              <div id="sidebar-new-chat" className="settings-grid-cell">
                <Toggle
                  label="新聊天中显示侧栏"
                  checked={ui.sidebarNewChat === true}
                  onChange={(v) => change('sidebarNewChat', v)}
                />
              </div>
              <div id="sidebar-dots" className="settings-grid-cell">
                <Toggle
                  label="Dots 中显示侧栏"
                  checked={ui.sidebarDots === true}
                  onChange={(v) => change('sidebarDots', v)}
                />
              </div>
            </div>
          </section>
          <section
            className="settings-section settings-surface-group"
            id="settings-window"
            data-settings-page="surfaces"
            hidden={page === 'appearance'}
          >
            <h2>尺寸与窗口</h2>
            <div className="settings-surface-grid">
              <div className="settings-grid-cell">
                {number(
                  'dock-width',
                  '侧栏宽度（px）',
                  Math.round(ui.dockWidth),
                  DOCK_MIN_WIDTH,
                  Infinity,
                  (n) => change('dockWidth', n),
                )}
              </div>
              <div id="window-pinning" className="settings-grid-cell">
                <Toggle
                  label="桌面窗口置顶"
                  checked={prefs.alwaysOnTop}
                  onChange={(v) => void update({ alwaysOnTop: v })}
                />
              </div>
            </div>
          </section>
        </>
      )}
      <Feedback
        text={error || (busy ? '正在保存…' : '')}
        failed={!!error}
        target={feedback.target}
      />
    </fieldset>
  );
}
