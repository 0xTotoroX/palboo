import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Saved feature/surface/typography snapshots, optional website stops/framing/material progress and shared workspace controller.
 * [OUTPUT]: Isolated previews with readable arrangements and reversible device-to-material motion.
 * [POS]: Shared layout/appearance sample content; save callbacks stay in memory and never call an API.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { PreviewFrame } from './preview-frame';
import { PalbooWordmark } from '../shared/brand';
import { typographyStyle, type Typography, type TypographyPreferences } from '../shared/typography';
import { titles, type FeatureLayout, type FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import { installFeatureLayout, resolveFeatureLayout } from '../surfaces/workspace/layout';
import { LayoutPreviewScene, demoFrames } from './layout-preview-scene';
import { useDemoJourney } from './layout-preview-journey';

type Sample = { id: string; title: string };
export type LayoutDemoStop = {
  placement: string;
  arrangement: 'vertical' | 'horizontal' | 'tabs';
  active: string;
};
type PreviewControls = {
  placement: ReactNode;
  arrangement: ReactNode;
  location: string;
  setPlacement: (placement: string) => void;
  reset: () => void;
};
function sampleArrangement(entries: Sample[], axis: string, active?: string): FeatureLayout {
  const groups =
    axis === 'tabs'
      ? [entries]
      : [
          entries.slice(0, Math.ceil(entries.length / 2)),
          entries.slice(Math.ceil(entries.length / 2)),
        ];
  return {
    axis: axis === 'tabs' ? 'auto' : axis,
    groups: groups
      .filter((items) => items.length)
      .map((items) => ({
        ids: items.map((item) => item.id),
        active: items.some((item) => item.id === active) ? active! : items[0].id,
        weight: 1,
      })),
  };
}
function WorkspaceSample({
  entries,
  layout,
  placement,
  material,
  variant,
  onLayout,
  textStyle,
  examples,
}: {
  entries: Sample[];
  layout: FeatureLayout;
  placement: string;
  material: string;
  variant?: string;
  onLayout: (next: FeatureLayout) => void;
  textStyle?: CSSProperties;
  examples?: Record<string, string[]>;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null),
    controller = useRef<ReturnType<typeof installFeatureLayout> | null>(null);
  const mounts = useRef(
    new Map<string, { id: string; title: string; node: HTMLDivElement; active: boolean }>(),
  );
  const change = useRef(onLayout);
  change.current = onLayout;
  useEffect(() => {
    controller.current = installFeatureLayout(ref.current!, {
      save: async (_surface: string, next: FeatureLayout) => change.current(next),
      error: () => {},
    });
    return () => {
      controller.current?.destroy();
      controller.current = null;
      mounts.current.clear();
    };
  }, []);
  useEffect(() => {
    for (const entry of entries) {
      if (!mounts.current.has(entry.id)) {
        const node = document.createElement('div');
        node.className = 'layout-demo-content';
        node.dataset.readingKey = `demo-${entry.id}`;
        const list = document.createElement('ol');
        const input = document.createElement('input');
        node.append(list, input);
        mounts.current.set(entry.id, { ...entry, node, active: true });
      }
      const item = mounts.current.get(entry.id)!;
      item.title = entry.title;
      const labels =
        examples?.[entry.id] ||
        (entry.id === 'outline'
          ? [
              tr('布局与位置'),
              tr('显示器与副屏'),
              tr('独立窗口交接'),
              tr('内容与状态'),
              tr('验证与回退'),
            ]
          : entry.id === 'next'
            ? [tr('完善窗口交接'), tr('检查多屏边界'), tr('补充验证场景')]
            : entry.id === 'board'
              ? [tr('待办 · 窗口交接'), tr('进行中 · 样式核对'), tr('完成 · 边界验证')]
              : [tr('示例内容'), tr('跟随空间自动排列'), tr('保留内容与阅读位置')]);
      const list = item.node.querySelector('ol')!;
      labels.forEach((text, index) => {
        const li = list.children[index] || document.createElement('li');
        if (li.textContent !== text) li.textContent = text;
        if (!li.parentNode) list.append(li);
      });
      while (list.children.length > labels.length) list.lastElementChild!.remove();
      const input = item.node.querySelector('input')!;
      input.placeholder = tr('试写一条草稿');
      input.setAttribute('aria-label', tr('{{value1}}示例草稿', { value1: entry.title }));
    }
    const ids = new Set(entries.map((entry) => entry.id));
    for (const [id, item] of mounts.current) item.active = ids.has(id);
    controller.current?.update([...mounts.current.values()], placement, layout, null, null);
  }, [entries, layout, placement, examples]);
  return (
    <div
      ref={ref}
      className="csw-workbench layout-demo-workspace"
      data-preview-workspace
      style={textStyle}
      data-material={material}
      data-variant={variant}
    />
  );
}
export function LayoutPreview({
  features,
  surfaces,
  live,
  appearance = false,
  typography,
  typographyPreferences,
  hostName,
  examples,
  onPlacementChange,
  sceneZoom,
  entryRef,
  onReset,
  focusWorkspace,
  renderControls,
  materialProgress,
  demoStop,
}: {
  features: FeatureState | null;
  surfaces: SurfaceState | null;
  live: boolean;
  appearance?: boolean;
  typography?: Typography | null;
  typographyPreferences?: TypographyPreferences;
  hostName?: string;
  examples?: Record<string, string[]>;
  onPlacementChange?: (placement: string) => void;
  sceneZoom?: number;
  entryRef?: Ref<SVGGElement>;
  onReset?: () => void;
  focusWorkspace?: boolean;
  renderControls?: (controls: PreviewControls) => ReactNode;
  materialProgress?: number;
  demoStop?: LayoutDemoStop;
}) {
  const locale = useLocale();
  const [mode, setMode] = useState<string | null>(null),
    [extra, setExtra] = useState<Sample[]>([]),
    [demoLayout, setDemoLayout] = useState<FeatureLayout | null>(null);
  const [editing, setEditing] = useState(false);
  const source = features?.mainPlacement || 'sidebar',
    location = mode || source;
  useEffect(() => onPlacementChange?.(location), [location, onPlacementChange]);
  const samples = useMemo(() => {
    const entries = [
      ...(features?.features || [])
        .filter(
          (entry) =>
            entry.open &&
            (location === 'edge' ? entry.placement === 'edge' : entry.placement === source),
        )
        .map(({ id }) => ({ id, title: titles[id] })),
      ...extra,
    ];
    return appearance && !entries.length ? [{ id: 'outline', title: titles.outline }] : entries;
  }, [features, location, source, extra, appearance, locale]);
  const signature = JSON.stringify([
    source,
    features?.features.map(({ id, open, placement }) => [id, open, placement]),
    features?.layouts,
    features?.legacyLayouts,
  ]);
  useEffect(() => {
    setMode(null);
    setExtra([]);
    setDemoLayout(null);
  }, [signature]);
  useEffect(() => {
    if (!demoStop || !features) return;
    const entries = features.features
      .filter(
        (entry) =>
          entry.open &&
          (demoStop.placement === 'edge' ? entry.placement === 'edge' : entry.placement === source),
      )
      .map(({ id }) => ({ id, title: titles[id] }));
    setMode(demoStop.placement);
    setDemoLayout(sampleArrangement(entries, demoStop.arrangement, demoStop.active));
  }, [demoStop, features, source]);
  const saved = useMemo(
    () =>
      resolveFeatureLayout(
        features?.layouts?.[location] || features?.layouts?.[source],
        features?.legacyLayouts?.[location],
        samples.map((item) => item.id),
      ),
    [features, location, source, samples],
  );
  const layout = demoLayout || saved,
    theme = surfaces?.preferences.themes[location];
  const previousThemes = useRef(surfaces?.preferences.themes);
  useEffect(() => {
    const themes = surfaces?.preferences.themes;
    if (appearance && themes && previousThemes.current) {
      const changed = Object.keys(themes).find(
        (id) => JSON.stringify(themes[id]) !== JSON.stringify(previousThemes.current?.[id]),
      );
      if (changed) setMode(changed);
    }
    previousThemes.current = themes;
  }, [appearance, surfaces?.preferences.themes]);
  const edge = surfaces?.preferences.edge;
  const placementFrame = useMemo(() => {
    if (location !== 'edge') return demoFrames[location];
    const position = Math.max(0, Math.min(1, edge?.position ?? 0.5));
    const horizontal = ['top', 'bottom'].includes(edge?.edge || 'right');
    const w = horizontal ? 340 : 230,
      h = horizontal ? 240 : 362;
    return {
      x: horizontal ? 28 + (682 - w) * position : edge?.edge === 'left' ? 28 : 710 - w,
      y: horizontal ? (edge?.edge === 'bottom' ? 476 - h : 48) : 48 + (428 - h) * position,
      w,
      h,
      secondary: 0,
    };
  }, [location, edge?.edge, edge?.position]);
  const target = useMemo(() => {
    if (demoLayout?.axis !== 'horizontal' || location === 'desktop') return placementFrame;
    const w = Math.max(400, placementFrame.w);
    return { ...placementFrame, w, x: Math.min(placementFrame.x, 710 - w) };
  }, [placementFrame, demoLayout?.axis, location]);
  const frame = useDemoJourney(location, target, !appearance && !editing && !focusWorkspace),
    ready = !!features && !!surfaces;
  function arrange(axis: string) {
    // Show two readable panes even if the saved placement has only one feature.
    const additions = Array.from({ length: Math.max(0, 2 - samples.length) }, (_, index) => ({
      id: `demo-${extra.length + index + 1}`,
      title:
        extra.length + index
          ? tr('示例功能 {{value1}}', { value1: extra.length + index + 1 })
          : tr('笔记'),
    }));
    const entries = [...samples, ...additions];
    if (additions.length) setExtra([...extra, ...additions]);
    setDemoLayout(sampleArrangement(entries, axis));
  }
  const arrangement = layout.groups.length === 1 ? 'tabs' : layout.axis;
  const sample = ready ? (
    <WorkspaceSample
      entries={samples}
      layout={layout}
      placement={location}
      material={theme?.theme || 'matte'}
      variant={theme?.liquidVariant}
      onLayout={setDemoLayout}
      textStyle={typographyStyle(typography, typographyPreferences)}
      examples={examples}
    />
  ) : (
    <p>{tr('正在读取布局…')}</p>
  );
  const reset = () => {
    setMode(null);
    setExtra([]);
    setDemoLayout(null);
    onReset?.();
  };
  const placementControls = (
    <div className="preview-selector" role="group" aria-label={tr('演示位置')}>
      <button
        type="button"
        aria-label={tr('演示侧栏')}
        aria-pressed={location === 'sidebar'}
        onClick={() => setMode('sidebar')}
      >
        {tr('侧栏')}
      </button>
      <button
        type="button"
        aria-label={tr('演示页面浮层')}
        aria-pressed={location === 'overlay'}
        onClick={() => setMode('overlay')}
      >
        {tr('页面浮层')}
      </button>
      <button
        type="button"
        aria-label={appearance ? tr('演示桌面窗口') : tr('演示移到副屏')}
        aria-pressed={location === 'desktop'}
        onClick={() => setMode('desktop')}
      >
        {appearance ? tr('桌面窗口') : tr('移到副屏')}
      </button>
      <button type="button" aria-pressed={location === 'edge'} onClick={() => setMode('edge')}>
        {tr('贴边 / 刘海')}
      </button>
    </div>
  );
  const arrangementControls = (
    <div className="preview-selector" role="group" aria-label={tr('演示排列')}>
      <button
        type="button"
        aria-pressed={arrangement === 'vertical'}
        onClick={() => arrange('vertical')}
      >
        {tr('上下')}
      </button>
      <button
        type="button"
        aria-pressed={arrangement === 'horizontal'}
        onClick={() => arrange('horizontal')}
      >
        {tr('左右')}
      </button>
      <button type="button" aria-pressed={arrangement === 'tabs'} onClick={() => arrange('tabs')}>
        {tr('标签')}
      </button>
    </div>
  );
  return (
    <PreviewFrame
      className={`layout-demo${appearance ? ' layout-demo-appearance' : ''}`}
      title={appearance ? tr('外观效果') : tr('你的工作空间')}
      status={!live ? tr('连接中断 · 末次状态') : undefined}
    >
      {!renderControls && (
        <div className="layout-demo-toolbar" data-settings-navigation>
          {placementControls}
          <button type="button" className="layout-demo-reset" onClick={reset}>
            {tr('重置预览')}
          </button>
        </div>
      )}
      <div
        className="layout-demo-canvas"
        data-demo-placement={location}
        data-ready={ready}
        onFocusCapture={(event) =>
          setEditing((event.target as HTMLElement).matches('input, textarea'))
        }
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false);
        }}
      >
        {appearance ? (
          <div className="layout-demo-material-stage">
            <div className="layout-demo-material-backdrop" aria-hidden="true">
              <PalbooWordmark />
            </div>
            <div className="layout-demo-material-sample">{sample}</div>
          </div>
        ) : (
          <LayoutPreviewScene
            frame={frame}
            title={tr('布局与位置')}
            hostName={hostName}
            placement={location}
            zoom={sceneZoom}
            entryRef={entryRef}
            focusWorkspace={focusWorkspace}
            materialProgress={materialProgress}
          >
            {sample}
          </LayoutPreviewScene>
        )}
      </div>
      {renderControls ? (
        renderControls({
          placement: placementControls,
          arrangement: arrangementControls,
          location,
          setPlacement: setMode,
          reset,
        })
      ) : (
        <div className="layout-demo-toolbar" data-settings-navigation hidden={appearance}>
          {arrangementControls}
          <button
            type="button"
            className="layout-demo-reset"
            onClick={() => {
              const item = {
                id: `demo-${extra.length + 1}`,
                title: extra.length ? tr('示例功能 ') + (extra.length + 1) : tr('笔记'),
              };
              setExtra([...extra, item]);
              setDemoLayout({
                axis: 'vertical',
                groups: [...samples, item].map((entry) => ({
                  ids: [entry.id],
                  active: entry.id,
                  weight: 1,
                })),
              });
            }}
          >
            {tr('＋ 添加示例功能')}
          </button>
        </div>
      )}
    </PreviewFrame>
  );
}
