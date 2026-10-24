/* [INPUT]: Saved feature/surface/typography snapshots, shared preview frame and workspace layout controller.
 * [OUTPUT]: Isolated layout and material demonstrations with readable arrangements and reversible screen motion.
 * [POS]: Shared layout/appearance sample content; save callbacks stay in memory and never call an API.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PreviewFrame } from './preview-frame';
import { PalbooWordmark } from '../shared/brand';
import { typographyStyle, type Typography, type TypographyPreferences } from '../shared/typography';
import { titles, type FeatureLayout, type FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import { installFeatureLayout, resolveFeatureLayout } from '../surfaces/workspace/layout';
import { LayoutPreviewScene, demoFrames } from './layout-preview-scene';
import { useDemoJourney } from './layout-preview-journey';

type Sample = { id: string; title: string };
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
        const labels =
          examples?.[entry.id] ||
          (entry.id === 'outline'
            ? ['布局与位置', '显示器与副屏', '独立窗口交接', '内容与状态', '验证与回退']
            : entry.id === 'next'
              ? ['完善窗口交接', '检查多屏边界', '补充验证场景']
              : entry.id === 'board'
                ? ['待办 · 窗口交接', '进行中 · 样式核对', '完成 · 边界验证']
                : ['示例内容', '跟随空间自动排列', '保留内容与阅读位置']);
        for (const text of labels) {
          const li = document.createElement('li');
          li.textContent = text;
          list.append(li);
        }
        const input = document.createElement('input');
        input.placeholder = '试写一条草稿';
        input.setAttribute('aria-label', `${entry.title}示例草稿`);
        node.append(list, input);
        mounts.current.set(entry.id, { ...entry, node, active: true });
      }
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
}) {
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
  }, [features, location, source, extra, appearance]);
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
  const frame = useDemoJourney(location, target, !appearance && !editing),
    ready = !!features && !!surfaces;
  function arrange(axis: string) {
    // Show two readable panes even if the saved placement has only one feature.
    const additions = Array.from({ length: Math.max(0, 2 - samples.length) }, (_, index) => ({
      id: `demo-${extra.length + index + 1}`,
      title: extra.length + index ? `示例功能 ${extra.length + index + 1}` : '笔记',
    }));
    const entries = [...samples, ...additions];
    if (additions.length) setExtra([...extra, ...additions]);
    const groups =
      axis === 'tabs'
        ? [entries]
        : [
            entries.slice(0, Math.ceil(entries.length / 2)),
            entries.slice(Math.ceil(entries.length / 2)),
          ];
    setDemoLayout({
      axis: axis === 'tabs' ? 'auto' : axis,
      groups: groups.map((items) => ({
        ids: items.map((item) => item.id),
        active: items[0].id,
        weight: 1,
      })),
    });
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
    <p>正在读取布局…</p>
  );
  return (
    <PreviewFrame
      className={`layout-demo${appearance ? ' layout-demo-appearance' : ''}`}
      title={appearance ? '外观效果' : '你的工作空间'}
      status={!live ? '连接中断 · 末次状态' : undefined}
    >
      <div className="layout-demo-toolbar" data-settings-navigation>
        <div className="preview-selector" role="group" aria-label="演示位置">
          <button
            type="button"
            aria-label="演示侧栏"
            aria-pressed={location === 'sidebar'}
            onClick={() => setMode('sidebar')}
          >
            侧栏
          </button>
          <button
            type="button"
            aria-label="演示页面浮层"
            aria-pressed={location === 'overlay'}
            onClick={() => setMode('overlay')}
          >
            页面浮层
          </button>
          <button
            type="button"
            aria-label={appearance ? '演示桌面窗口' : '演示移到副屏'}
            aria-pressed={location === 'desktop'}
            onClick={() => setMode('desktop')}
          >
            {appearance ? '桌面窗口' : '移到副屏'}
          </button>
          <button type="button" aria-pressed={location === 'edge'} onClick={() => setMode('edge')}>
            贴边 / 刘海
          </button>
        </div>
        <button
          type="button"
          className="layout-demo-reset"
          onClick={() => {
            setMode(null);
            setExtra([]);
            setDemoLayout(null);
          }}
        >
          重置预览
        </button>
      </div>
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
            title="布局与位置"
            hostName={hostName}
            placement={location}
          >
            {sample}
          </LayoutPreviewScene>
        )}
      </div>
      <div className="layout-demo-toolbar" data-settings-navigation hidden={appearance}>
        <div className="preview-selector" role="group" aria-label="演示排列">
          <button
            type="button"
            aria-pressed={arrangement === 'vertical'}
            onClick={() => arrange('vertical')}
          >
            上下
          </button>
          <button
            type="button"
            aria-pressed={arrangement === 'horizontal'}
            onClick={() => arrange('horizontal')}
          >
            左右
          </button>
          <button
            type="button"
            aria-pressed={arrangement === 'tabs'}
            onClick={() => arrange('tabs')}
          >
            标签
          </button>
        </div>
        <button
          type="button"
          className="layout-demo-reset"
          onClick={() => {
            const item = {
              id: `demo-${extra.length + 1}`,
              title: extra.length ? '示例功能 ' + (extra.length + 1) : '笔记',
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
          ＋ 添加示例功能
        </button>
      </div>
    </PreviewFrame>
  );
}
