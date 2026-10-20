/* [INPUT]: Saved feature/surface snapshots, feature registry and shared workspace layout controller.
 * [OUTPUT]: Isolated interactive layout demonstration with real compaction and reversible screen motion.
 * [POS]: Settings-only sample content; save callbacks stay in memory and never call an API.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { titles, type FeatureLayout, type FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import { installFeatureLayout, resolveFeatureLayout } from '../surfaces/workspace/layout';
import { LayoutPreviewScene, demoFrames, type DemoFrame } from './layout-preview-scene';

type Sample = { id: string; title: string };
function WorkspaceSample({
  entries,
  layout,
  placement,
  material,
  variant,
  onLayout,
}: {
  entries: Sample[];
  layout: FeatureLayout;
  placement: string;
  material: string;
  variant?: string;
  onLayout: (next: FeatureLayout) => void;
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
          entry.id === 'outline'
            ? ['布局与位置', '显示器与副屏', '独立窗口交接', '内容与状态', '验证与回退']
            : entry.id === 'next'
              ? ['完善窗口交接', '检查多屏边界', '补充验证场景']
              : entry.id === 'board'
                ? ['待办 · 窗口交接', '进行中 · 样式核对', '完成 · 边界验证']
                : ['示例内容', '跟随空间自动排列', '保留内容与阅读位置'];
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
  }, [entries, layout, placement]);
  return (
    <div
      ref={ref}
      className="csw-workbench layout-demo-workspace"
      data-preview-workspace
      data-material={material}
      data-variant={variant}
    />
  );
}
function useDemoJourney(location: string, target: DemoFrame) {
  const [frame, setFrame] = useState(target);
  const current = useRef(frame),
    previous = useRef(location);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0,
      disposed = false;
    const from = current.current,
      was = previous.current;
    previous.current = location;
    const segments =
      location === 'desktop' && was !== 'desktop' && from.secondary < 0.5
        ? [
            { frame: demoFrames.popped, ms: 280 },
            { frame: demoFrames.popped, ms: 100 },
            { frame: target, ms: 560 },
          ]
        : was === 'desktop' && location !== 'desktop'
          ? [
              { frame: { ...demoFrames.popped, secondary: 0 }, ms: 520 },
              { frame: target, ms: 240 },
            ]
          : [{ frame: target, ms: 240 }];
    let index = 0,
      start = 0,
      origin = from;
    const finish = () => {
      cancelAnimationFrame(request);
      current.current = target;
      setFrame(target);
    };
    const tick = (time: number) => {
      if (disposed) return;
      if (!start) start = time;
      const segment = segments[index],
        progress = Math.min(1, (time - start) / segment.ms),
        t = progress * progress * (3 - 2 * progress);
      const value = Object.fromEntries(
        Object.keys(target).map((key) => [
          key,
          origin[key as keyof DemoFrame] +
            (segment.frame[key as keyof DemoFrame] - origin[key as keyof DemoFrame]) * t,
        ]),
      ) as DemoFrame;
      current.current = value;
      setFrame(value);
      if (progress === 1) {
        if (++index === segments.length) return;
        origin = value;
        start = time;
      }
      request = requestAnimationFrame(tick);
    };
    const onReduced = () => {
      if (reduced.matches) finish();
    };
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    reduced.addEventListener('change', onReduced);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', finish);
    if (
      Object.keys(target).every(
        (key) => target[key as keyof DemoFrame] === from[key as keyof DemoFrame],
      ) ||
      reduced.matches ||
      document.hidden ||
      document.documentElement.dataset.settingsInput === 'keyboard'
    )
      finish();
    else request = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(request);
      reduced.removeEventListener('change', onReduced);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', finish);
    };
  }, [location, target]);
  return frame;
}
export function LayoutPreview({
  features,
  surfaces,
  live,
}: {
  features: FeatureState | null;
  surfaces: SurfaceState | null;
  live: boolean;
}) {
  const [mode, setMode] = useState<string | null>(null),
    [extra, setExtra] = useState<Sample[]>([]),
    [demoLayout, setDemoLayout] = useState<FeatureLayout | null>(null);
  const source = features?.mainPlacement || 'sidebar',
    location = mode || source;
  const samples = useMemo(
    () => [
      ...(features?.features || [])
        .filter(
          (entry) =>
            entry.open &&
            (location === 'edge' ? entry.placement === 'edge' : entry.placement === source),
        )
        .map(({ id }) => ({ id, title: titles[id] })),
      ...extra,
    ],
    [features, location, source, extra],
  );
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
  const edge = surfaces?.preferences.edge;
  const target = useMemo(() => {
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
  const frame = useDemoJourney(location, target),
    ready = !!features && !!surfaces;
  function arrange(axis: string) {
    setDemoLayout(
      axis === 'tabs'
        ? {
            axis: 'auto',
            groups: [
              { ids: samples.map((item) => item.id), active: samples[0]?.id || '', weight: 1 },
            ],
          }
        : { axis, groups: samples.map((item) => ({ ids: [item.id], active: item.id, weight: 1 })) },
    );
  }
  return (
    <section className="preview-frame layout-demo" aria-label="你的工作空间">
      <header className="preview-heading">
        <h2>你的工作空间</h2>
        <span>
          {!live
            ? '连接中断 · 末次状态'
            : mode || demoLayout || extra.length
              ? '仅演示 · 不保存'
              : '已保存配置 · 可试拖动'}
        </span>
      </header>
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
            aria-label="演示移到副屏"
            aria-pressed={location === 'desktop'}
            onClick={() => setMode('desktop')}
          >
            移到副屏
          </button>
          <button
            type="button"
            aria-pressed={location === 'edge'}
            onClick={() => setMode(location === 'edge' ? null : 'edge')}
          >
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
          恢复已保存配置
        </button>
      </div>
      <div className="layout-demo-canvas" data-demo-placement={location} data-ready={ready}>
        <LayoutPreviewScene frame={frame}>
          {ready ? (
            <WorkspaceSample
              entries={samples}
              layout={layout}
              placement={location}
              material={theme?.theme || 'matte'}
              variant={theme?.liquidVariant}
              onLayout={setDemoLayout}
            />
          ) : (
            <p>正在读取布局…</p>
          )}
        </LayoutPreviewScene>
      </div>
      <div className="layout-demo-toolbar" data-settings-navigation>
        <div className="preview-selector" role="group" aria-label="演示排列">
          <button type="button" onClick={() => arrange('vertical')}>
            上下
          </button>
          <button type="button" onClick={() => arrange('horizontal')}>
            左右
          </button>
          <button type="button" onClick={() => arrange('tabs')}>
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
      <p className="preview-note">
        拖动分隔线收紧，点击标题展开。这里只操作示例，材质以实际窗口为准。
      </p>
    </section>
  );
}
