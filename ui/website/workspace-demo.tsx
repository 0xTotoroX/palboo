import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Settings layout/material previews and synthetic feature registration.
 * [OUTPUT]: Opening device journey, local font/layout controls and material comparison.
 * [POS]: Website composition only; previews save to memory, never to product settings.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useEffect, useMemo, useState, type CSSProperties, type Ref } from 'react';
import {
  defaultTypography,
  fallbackTypography,
  type TypographyPreferences,
} from '../shared/typography';
import { LayoutPreview } from '../settings/layout-preview';
import type { FeatureState } from '../shared/features';
import type { SurfaceState } from '../settings/surface-settings';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
import { features } from './demos';

const examples = {
  get next() {
    return [tr('整理三个代表作品'), tr('完成首页布局'), tr('检查移动端')];
  },
  get outline() {
    return [tr('确定作品集内容'), tr('安排页面与布局'), tr('上线前检查')];
  },
  get board() {
    return [tr('待办 · 整理作品'), tr('进行中 · 首页布局'), tr('完成 · 确定范围')];
  },
  get model() {
    return ['GPT-6.1-Sol · Low', 'GPT-6-Astra · High'];
  },
  get terms() {
    return [tr('响应式布局'), tr('可访问性'), tr('首屏加载')];
  },
  get bots() {
    return [tr('工程主管'), tr('资料助手'), tr('随口一问')];
  },
};
const sampleFeatures: FeatureState = {
  mainPlacement: 'sidebar',
  features: features.map(({ id }) => ({
    id,
    open: true,
    placement: ['model', 'board'].includes(id) ? 'edge' : 'sidebar',
    owner: 'website-example',
    size: [480, 400],
    reveal: 1,
    view: {},
    pending: null,
  })),
  layouts: {
    sidebar: {
      axis: 'vertical',
      groups: [
        { ids: ['next', 'terms', 'bots'], active: 'next', weight: 1 },
        { ids: ['outline'], active: 'outline', weight: 1 },
      ],
    },
    edge: { axis: 'auto', groups: [{ ids: ['model', 'board'], active: 'model', weight: 1 }] },
  },
};
function sampleSurfaces(
  theme: SurfaceTheme['theme'],
  liquidVariant: 'regular' | 'clear' = 'regular',
  edge = 'right',
): SurfaceState {
  return {
    revision: 0,
    preferences: {
      themes: Object.fromEntries(
        ['sidebar', 'overlay', 'desktop', 'edge'].map((id) => [id, { theme, liquidVariant }]),
      ),
      edge: { edge, screen: 'example', position: 0.5, keepOpen: true },
    },
  };
}
const places: Record<string, { text: string }> = {
  sidebar: {
    get text() {
      return tr(
        '为大纲、下一步和术语留出位置，正文与输入框一起让位。侧栏宽度可以调整，新聊天与 Dots 是否显示也可单独设置。',
      );
    },
  },
  overlay: {
    get text() {
      return tr(
        '保留聊天原来的宽度，需要时展开工作台。收起后回到左栏双眼入口，草稿与阅读位置继续保留。',
      );
    },
  },
  desktop: {
    get text() {
      return tr(
        '工作台先弹出，再移到副屏；也可以放回聊天。独立窗口可调整尺寸、置顶，切换位置不清空内容。',
      );
    },
  },
  edge: {
    get text() {
      return tr(
        '例如把模型快切与看板放到屏幕边缘。悬停展开、离开收回，也可保持展开；屏幕、边缘和位置都能调整。',
      );
    },
  },
};
const demoTypography = { ...fallbackTypography, fontSize: 20, titleSize: 20, lineHeight: 32 };
export function SurfaceStory({
  zoom = 1,
  reveal = 1,
  interactive = true,
  entryRef,
}: {
  zoom?: number;
  reveal?: number;
  interactive?: boolean;
  entryRef?: Ref<SVGGElement>;
}) {
  useLocale();
  const [placement, setPlacement] = useState('sidebar');
  const [edge, setEdge] = useState('right');
  const [typography, setTypography] = useState<TypographyPreferences>(defaultTypography);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 600px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 600px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const surfaces = useMemo(() => sampleSurfaces('matte', 'regular', edge), [edge]);
  const reset = () => {
    setEdge('right');
    setTypography(defaultTypography);
  };
  return (
    <section
      className="surface-story"
      aria-label={tr('位置与布局')}
      data-controls={interactive}
      inert={!interactive}
      style={{ '--workspace-controls': reveal } as CSSProperties}
    >
      <div className="site-settings-demo">
        <LayoutPreview
          features={sampleFeatures}
          surfaces={surfaces}
          live
          hostName="Codex"
          examples={examples}
          onPlacementChange={setPlacement}
          sceneZoom={zoom}
          entryRef={entryRef}
          typography={demoTypography}
          typographyPreferences={typography}
          focusWorkspace={compact}
          onReset={reset}
        />
        <div className="workspace-type-controls">
          <label>
            <span>{tr('字号')}</span>
            <select
              aria-label={tr('演示字号模式')}
              value={typography.mode}
              onChange={(event) =>
                setTypography({ ...typography, mode: event.target.value as 'follow' | 'custom' })
              }
            >
              <option value="follow">{tr('跟随正文')}</option>
              <option value="custom">{tr('自定字号')}</option>
            </select>
          </label>
          <select
            aria-label={typography.mode === 'follow' ? tr('演示字号比例') : tr('演示自定字号')}
            value={typography.mode === 'follow' ? typography.scale : typography.customSize}
            onChange={(event) =>
              setTypography({
                ...typography,
                [typography.mode === 'follow' ? 'scale' : 'customSize']: Number(event.target.value),
              })
            }
          >
            {(typography.mode === 'follow' ? [90, 100, 110, 125] : [14, 16, 18, 20, 24]).map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                  {typography.mode === 'follow' ? '%' : ' px'}
                </option>
              ),
            )}
          </select>
        </div>
      </div>
      <div className="workspace-explanation">
        <p>{places[placement].text}</p>
        {placement === 'edge' && (
          <div className="choice-row" role="group" aria-label={tr('贴边位置演示')}>
            {[
              ['right', tr('右侧')],
              ['left', tr('左侧')],
              ['top', tr('顶部 / 刘海')],
              ['bottom', tr('底部')],
            ].map(([id, title]) => (
              <button key={id} aria-pressed={edge === id} onClick={() => setEdge(id)}>
                {title}
              </button>
            ))}
          </div>
        )}
        <p>{tr('单击图标切换功能，拖动标题或分隔线调整布局。')}</p>
      </div>
    </section>
  );
}
const materials: { id: SurfaceTheme['theme']; title: string; text: string }[] = [
  {
    id: 'matte',
    get title() {
      return tr('哑光');
    },
    get text() {
      return tr('稳定的实色底面，正文和控件清楚地留在前景。');
    },
  },
  {
    id: 'frosted',
    get title() {
      return tr('磨砂');
    },
    get text() {
      return tr('均匀模糊背后的内容，让工作台与当前背景保持联系。');
    },
  },
  {
    id: 'native-glass',
    get title() {
      return tr('液态');
    },
    get text() {
      return tr('反光与透光形成边缘层次；Regular 更凝实，Clear 更通透。');
    },
  },
];
export function MaterialStory() {
  useLocale();
  const [material, setMaterial] = useState<SurfaceTheme['theme']>('native-glass');
  const [variant, setVariant] = useState<'regular' | 'clear'>('regular');
  const surfaces = useMemo(() => sampleSurfaces(material, variant), [material, variant]);
  return (
    <section className="material-story page-width" aria-labelledby="material-title">
      <div className="section-intro">
        <h2 id="material-title">
          {tr('材质与外观。')}
          <br />
          {tr('让界面融入你的桌面。')}
        </h2>
        <p>{tr('同一套工作台，三种质感。侧栏、浮层、桌面与贴边可以分别选择，明暗跟随 Codex。')}</p>
      </div>
      <div className="material-comparison">
        <div className="site-settings-demo material-demo">
          <LayoutPreview
            features={sampleFeatures}
            surfaces={surfaces}
            live
            appearance
            examples={examples}
          />
        </div>
        <div className="material-controls">
          <div className="choice-row" role="group" aria-label={tr('材质演示')}>
            {materials.map((item) => (
              <button
                key={item.id}
                aria-pressed={material === item.id}
                onClick={() => setMaterial(item.id)}
              >
                {item.title}
              </button>
            ))}
          </div>
          <p>{materials.find((item) => item.id === material)!.text}</p>
          <div
            className="choice-row"
            role="group"
            aria-label={tr('液态变体')}
            hidden={material !== 'native-glass'}
          >
            {(['regular', 'clear'] as const).map((id) => (
              <button key={id} aria-pressed={variant === id} onClick={() => setVariant(id)}>
                {id === 'regular' ? 'Regular' : 'Clear'}
              </button>
            ))}
          </div>
          <p>
            {tr(
              '字号可以跟随聊天正文、按比例调整，也可自定。贴边还提供纯黑外观，术语卡片可单独选材质与背景。',
            )}
          </p>
          <p className="material-boundary">
            {tr('网页展示为近似效果。桌面液态由 macOS 绘制，需 macOS 26。')}
          </p>
        </div>
      </div>
    </section>
  );
}
