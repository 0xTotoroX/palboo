/* [INPUT]: 四功能的归属、版本化布局与旧布局兼容读取。
 * [OUTPUT]: 紧凑分组的主界面形式、功能放置与布局设置，以及预览用的只读已加载快照。
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
    if (writing.current) return;
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
    } catch (e) {
      setError((e as Error).message);
      try {
        setState(await request<FeatureState>('features', { op: 'state' }));
      } catch {}
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const labels = { sidebar: '侧栏', overlay: '页面浮层', desktop: '桌面窗口', edge: '贴边 / 刘海' };
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
      <h2 hidden={simple}>主界面</h2>
      <div className={simple ? undefined : 'settings-surface-grid settings-surface-grid--stacked'}>
        <div className="settings-grid-cell settings-placement-row">
          <span className={simple ? undefined : 'settings-grid-label'}>主界面位置</span>
          <div id="main-placement" className="settings-choice" role="group" aria-label="主界面形式">
            {(['sidebar', 'overlay', 'desktop'] as const).map((p) => (
              <button
                type="button"
                key={p}
                aria-pressed={(state.pendingPlacement || primary) === p}
                disabled={moving || (p === 'desktop' && !desktopSupported)}
                onClick={() => void change({ op: 'main-placement', placement: p })}
              >
                {simple ? { sidebar: '侧栏', overlay: '浮层', desktop: '桌面' }[p] : labels[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-grid-cell" hidden={simple}>
          <Field id="main-layout" label="主界面布局">
            <NativeSelect
              id="main-layout"
              disabled={moving || !ids.length}
              value={mode}
              onChange={(e) => arrange(e.target.value)}
            >
              <option value="tabs">标签组</option>
              <option value="vertical">上下分栏</option>
              <option value="horizontal">左右分栏</option>
              <option value="auto">自动分栏</option>
              {mode === 'custom' && (
                <option value="custom" disabled>
                  自定义分栏
                </option>
              )}
            </NativeSelect>
          </Field>
        </div>
      </div>
      <div hidden={simple}>
        <section id="feature-placements" className="settings-subsection">
          <h3>各功能位置</h3>
          <div className="settings-surface-grid settings-surface-grid--features settings-surface-grid--stacked">
            {Object.entries(titles).map(([id, title]) => (
              <div key={id} className="settings-grid-cell">
                <Field id={`placement-${id}`} label={title}>
                  <NativeSelect
                    id={`placement-${id}`}
                    aria-label={`${title}默认位置`}
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
                      贴边 / 刘海
                    </option>
                  </NativeSelect>
                </Field>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Feedback
        text={error || readError || (busy ? '正在保存…' : '')}
        failed={!!(error || readError)}
        target={error || busy ? feedback.target : null}
      />
    </section>
  );
}
