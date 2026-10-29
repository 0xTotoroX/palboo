import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 功能归属、版本化布局、命名预设与旧布局兼容读取。
 * [OUTPUT]: 主界面形式、功能放置、布局与预设设置，以及预览用的只读已加载快照。
 * [POS]: 设置页编排；写入 features，不再写旧两功能 dockLayout/popoutLayout。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { useFeedbackTarget } from './settings-feedback';
import { NativeSelect } from './components/ui/native-select';
import { titles, type FeatureState } from '../shared/features';
import { resolveFeatureLayout } from '../surfaces/workspace/layout';
import { layoutGroups } from '../surfaces/workspace/layout-tree';
import { LayoutPresetSettings } from './layout-preset-settings';
export function FeatureSettings({
  live,
  active = true,
  desktopSupported,
  onPlacement,
  onSnapshot,
  simple = false,
}: {
  simple?: boolean;
  live: boolean;
  active?: boolean;
  desktopSupported: boolean;
  onPlacement: (placement: string) => void;
  onSnapshot?: (state: FeatureState | null) => void;
}) {
  useLocale();
  const [state, setState] = useState<FeatureState>({ features: [] }),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState('');
  const writing = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!live) {
      setReady(false);
      return;
    }
    if (!active) return;
    let disposed = false;
    const read = async () => {
      if (writing.current || document.hidden) return;
      const version = ++generation.current;
      try {
        const next = await request<FeatureState>('features', { op: 'state' });
        if (!disposed && version === generation.current) {
          setState(next);
          setReady(true);
          setReadError('');
        }
      } catch (e) {
        if (!disposed) setReadError((e as Error).message);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [live, active]);
  const primary = state.mainPlacement || 'sidebar';
  useEffect(() => onPlacement(primary), [primary, onPlacement]);
  useEffect(() => onSnapshot?.(ready ? state : null), [state, ready, onSnapshot]);
  async function change(input: object) {
    if (writing.current) return false;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const next = await request<FeatureState>('features', input);
      setState((previous) => ({
        ...next,
        legacyLayouts: next.legacyLayouts ?? previous.legacyLayouts,
      }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      try {
        setState(await request<FeatureState>('features', { op: 'state' }));
      } catch {}
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const labels = {
    sidebar: tr('侧栏'),
    overlay: tr('页面浮层'),
    desktop: tr('桌面窗口'),
    edge: tr('贴边 / 刘海'),
  };
  const moving =
    !live || !ready || busy || !!state.pendingPlacement || state.features.some((e) => !!e.pending);
  const ids = Object.keys(titles).filter(
    (id) =>
      state.features.find((e) => e.id === id)?.placement !== 'edge' &&
      (id !== 'model' || state.features.some((e) => e.id === id)),
  );
  const layout: NonNullable<FeatureState['layouts']>[string] = resolveFeatureLayout(
    state.layouts?.[primary],
    state.legacyLayouts?.[primary],
    ids,
  );
  const mode =
    layout.groups.length === 1
      ? 'tabs'
      : layout.groups.some((g) => 'groups' in g || g.ids.length > 1)
        ? 'custom'
        : layout.axis;
  function arrange(mode: string) {
    const ordered = [...new Set([...layoutGroups(layout).flatMap((g) => g.ids), ...ids])];
    if (!ordered.length) return;
    void change({
      op: 'main-layout',
      placement: primary,
      expectedLayout: state.layouts?.[primary] ?? null,
      layout: {
        axis: mode === 'tabs' ? 'auto' : mode,
        ...(layout.visible ? { visible: layout.visible } : {}),
        groups:
          mode === 'tabs'
            ? [
                {
                  ids: ordered,
                  active: ordered.includes(state.activeFeature || '')
                    ? state.activeFeature
                    : ordered[0],
                  weight: 1,
                },
              ]
            : ordered.map((id) => ({ ids: [id], active: id, weight: 1 })),
      },
    });
  }
  const feedback = useFeedbackTarget();
  return (
    <section
      className="settings-section"
      onBlurCapture={feedback.track}
      onChangeCapture={feedback.track}
      onPointerDownCapture={feedback.track}
    >
      <h2 hidden={simple}>{tr('主界面')}</h2>
      <div className={simple ? undefined : 'settings-surface-rows'}>
        <div className="settings-surface-item">
          <div
            className={simple ? 'settings-placement-row' : 'settings-field settings-placement-row'}
          >
            <span>{tr('主界面位置')}</span>
            <div
              id="main-placement"
              className="settings-choice"
              role="group"
              aria-label={tr('主界面形式')}
            >
              {(['sidebar', 'overlay', 'desktop'] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  aria-pressed={(state.pendingPlacement || primary) === p}
                  disabled={moving || (p === 'desktop' && !desktopSupported)}
                  onClick={() => void change({ op: 'main-placement', placement: p })}
                >
                  {simple
                    ? { sidebar: tr('侧栏'), overlay: tr('浮层'), desktop: tr('桌面') }[p]
                    : labels[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="settings-surface-item" hidden={simple}>
          <Field id="main-layout" label={tr('主界面布局')}>
            <NativeSelect
              id="main-layout"
              controlWidth="short"
              disabled={moving || !ids.length}
              value={mode}
              onChange={(e) => arrange(e.target.value)}
            >
              <option value="tabs">{tr('标签组')}</option>
              <option value="vertical">{tr('上下分栏')}</option>
              <option value="horizontal">{tr('左右分栏')}</option>
              <option value="auto">{tr('自动分栏')}</option>
              {mode === 'custom' && (
                <option value="custom" disabled>
                  {tr('自定义分栏')}
                </option>
              )}
            </NativeSelect>
          </Field>
        </div>
      </div>
      <div hidden={simple}>
        <LayoutPresetSettings state={state} layout={layout} busy={moving} change={change} />
        <section id="feature-placements" className="settings-subsection">
          <h3>{tr('各功能位置')}</h3>
          <div className="settings-feature-grid">
            {Object.entries(titles).map(([id, title]) => (
              <div key={id} className="settings-feature-cell">
                <Field id={`placement-${id}`} label={title}>
                  <NativeSelect
                    id={`placement-${id}`}
                    aria-label={tr('{{title}}默认位置', { title: title })}
                    disabled={moving}
                    value={
                      state.features.find((e) => e.id === id)?.placement === 'edge' ||
                      (!state.features.some((e) => e.id === id) && id === 'model')
                        ? 'edge'
                        : primary
                    }
                    onChange={(e) => void change({ op: 'move', id, placement: e.target.value })}
                  >
                    <option value={primary}>{labels[primary]}</option>
                    <option value="edge" disabled={!desktopSupported}>
                      {tr('贴边 / 刘海')}
                    </option>
                  </NativeSelect>
                </Field>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Feedback
        text={error || readError || (busy ? tr('正在保存…') : '')}
        failed={!!(error || readError)}
        target={error || busy ? feedback.target : null}
      />
    </section>
  );
}
