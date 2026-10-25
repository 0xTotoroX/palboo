import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Independent surface preferences and display inventory. [OUTPUT]: Separate layout and appearance pages retaining their mounted controls and shared preview snapshots.
 * [POS]: Presentation settings, no feature enable/disable or business state.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { useFeedbackTarget } from './settings-feedback';
import { Feedback, Toggle } from './settings-controls';
import { FeatureSettings } from './feature-settings';
import { request } from './api';
import { NativeSelect } from './components/ui/native-select';
import { PanelSettings } from './panel-settings';
import type { AppearanceSettings } from '../shared/contracts';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
import type { FeatureState } from '../shared/features';
const labels = {
  get sidebar() {
    return tr('侧栏');
  },
  get overlay() {
    return tr('页面浮层');
  },
  get desktop() {
    return tr('桌面窗口');
  },
  get edge() {
    return tr('贴边 / 刘海');
  },
};
type Edge = { edge: string; screen: string; position: number; keepOpen: boolean };
export type SurfaceState = {
  revision: number;
  preferences: { themes: Record<string, SurfaceTheme>; edge: Edge };
  error?: string;
};
type Displays = { screens: { id: string; label: string }[]; nativeGlassAvailable: boolean };
export function SurfaceSettings({
  live,
  active = true,
  desktopSupported,
  appearance,
  fontBase,
  simple = false,
  page,
  onFeatures,
  onSnapshot,
}: {
  simple?: boolean;
  page?: 'surfaces' | 'appearance';
  live: boolean;
  active?: boolean;
  desktopSupported: boolean;
  appearance?: AppearanceSettings;
  fontBase?: number;
  onFeatures?: (state: FeatureState | null) => void;
  onSnapshot?: (state: SurfaceState | null) => void;
}) {
  useLocale();
  const [state, setState] = useState<SurfaceState | null>(null),
    [displays, setDisplays] = useState<Displays>({ screens: [], nativeGlassAvailable: false }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [position, setPosition] = useState(50),
    [primary, setPrimary] = useState('sidebar');
  const writing = useRef(false),
    generation = useRef(0);
  useEffect(() => onSnapshot?.(state), [state, onSnapshot]);
  useEffect(() => {
    if (!live || !active) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const current = ++generation.current;
      try {
        const [value, screens] = await Promise.all([
          request<SurfaceState>('surfaces', { op: 'state' }),
          request<Displays>('surfaces/displays'),
        ]);
        if (!disposed && current === generation.current) {
          setState(value);
          setDisplays(screens);
          setPosition(value.preferences.edge.position * 100);
        }
      } catch (error) {
        if (!disposed) setMessage(String(error));
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      window.removeEventListener('focus', load);
    };
  }, [live, active]);
  async function save(patch: object) {
    if (!state || writing.current) return;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const next = await request<SurfaceState>('surfaces', {
        op: 'save',
        revision: state.revision,
        ...patch,
      });
      setState(next);
      setPosition(next.preferences.edge.position * 100);
    } catch (error) {
      setMessage(String(error));
      try {
        const next = await request<SurfaceState>('surfaces', { op: 'state' });
        setState(next);
        setPosition(next.preferences.edge.position * 100);
      } catch {
        /* Keep the last known preferences. */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const disabled = !live || !state || busy || !!state.error,
    edge = state?.preferences.edge;
  const feedback = useFeedbackTarget();
  return (
    <section
      tabIndex={-1}
      aria-label={tr('呈现形式设置')}
      className="settings-section"
      onBlurCapture={feedback.track}
      onChangeCapture={feedback.track}
      onPointerDownCapture={feedback.track}
    >
      <div hidden={page === 'appearance'} data-settings-page="surfaces">
        <FeatureSettings
          live={live}
          active={active}
          desktopSupported={desktopSupported}
          onPlacement={setPrimary}
          onSnapshot={onFeatures}
          simple={simple}
        />
      </div>
      <section
        className="settings-section"
        data-settings-page="appearance"
        hidden={!simple && page === 'surfaces'}
      >
        <h2 hidden={simple}>{tr('各形式外观')}</h2>
        <div className="space-y-3">
          {Object.entries(labels).map(([placement, label]) => {
            const theme = state?.preferences.themes[placement] || {
              theme: 'matte',
              liquidVariant: 'regular',
            };
            return (
              <div
                key={placement}
                id={`theme-${placement}`}
                hidden={simple && placement !== primary}
              >
                <div className="settings-field">
                  <span className="text-sm">{simple ? tr('主界面材质') : label}</span>
                  <div className="settings-control-pair">
                    <NativeSelect
                      controlWidth="short"
                      aria-label={tr('{{label}}主题', { label: label })}
                      disabled={disabled}
                      value={theme.theme}
                      onChange={(event) =>
                        void save({ placement, theme: { ...theme, theme: event.target.value } })
                      }
                    >
                      <option value="black">{tr('纯黑')}</option>
                      <option value="matte">{tr('哑光')}</option>
                      <option value="frosted">{tr('磨砂')}</option>
                      <option value="native-glass">{tr('液态')}</option>
                    </NativeSelect>
                    {theme.theme === 'native-glass' && (
                      <NativeSelect
                        controlWidth="compact"
                        aria-label={tr('{{label}}液态变体', { label: label })}
                        disabled={disabled}
                        value={theme.liquidVariant}
                        onChange={(event) =>
                          void save({
                            placement,
                            theme: { ...theme, liquidVariant: event.target.value },
                          })
                        }
                      >
                        <option value="regular">Regular</option>
                        <option value="clear">Clear</option>
                      </NativeSelect>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div hidden={simple}>
        <PanelSettings value={appearance} fontBase={fontBase} page={page} />
      </div>
      <section
        id="edge-position"
        data-settings-page="surfaces"
        className="settings-section settings-surface-group"
        hidden={simple || page === 'appearance'}
      >
        <h2>{tr('贴边 / 刘海位置')}</h2>
        <div className="settings-surface-rows">
          <div className="settings-surface-item">
            <label className="settings-field text-sm">
              <span className="whitespace-nowrap">{tr('屏幕')}</span>
              <NativeSelect
                aria-label={tr('贴边屏幕')}
                disabled={disabled}
                value={edge?.screen || ''}
                onChange={(event) => void save({ edge: { screen: event.target.value } })}
              >
                <option value="">{tr('自动选择')}</option>
                <option value="codex">{tr('跟随 Codex')}</option>
                {displays.screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.label}
                  </option>
                ))}
                {edge?.screen &&
                  edge.screen !== 'codex' &&
                  !displays.screens.some((screen) => screen.id === edge.screen) && (
                    <option value={edge.screen}>{tr('已断开的屏幕（保留选择）')}</option>
                  )}
              </NativeSelect>
            </label>
          </div>
          <div className="settings-surface-item">
            <label className="settings-field text-sm">
              <span className="whitespace-nowrap">{tr('边缘')}</span>
              <NativeSelect
                controlWidth="short"
                aria-label={tr('贴边边缘')}
                disabled={disabled}
                value={edge?.edge || 'right'}
                onChange={(event) => void save({ edge: { edge: event.target.value } })}
              >
                <option value="right">{tr('右侧')}</option>
                <option value="left">{tr('左侧')}</option>
                <option value="top">{tr('顶部 / 刘海')}</option>
              </NativeSelect>
            </label>
          </div>
          <div className="settings-surface-item">
            <label className="settings-field text-sm">
              <span className="whitespace-nowrap">
                {tr('位置 ')}
                {Math.round(position)}%
              </span>
              <input
                aria-label={tr('贴边位置')}
                type="range"
                min="0"
                max="100"
                disabled={disabled}
                value={position}
                onChange={(event) => setPosition(Number(event.target.value))}
                onPointerUp={() => void save({ edge: { position: position / 100 } })}
                onKeyUp={() => void save({ edge: { position: position / 100 } })}
              />
            </label>
          </div>
          <div className="settings-surface-item">
            <Toggle
              id="edge-keep-open"
              label={tr('保持展开')}
              disabled={disabled}
              checked={edge?.keepOpen || false}
              onChange={(keepOpen) => void save({ edge: { keepOpen } })}
            />
          </div>
        </div>
      </section>
      <Feedback
        text={message || state?.error || (busy ? tr('正在保存…') : '')}
        failed={!!(message || state?.error)}
        target={feedback.target}
      />
    </section>
  );
}
