/* [INPUT]: Settings layout/material previews and synthetic feature registration.
 * [OUTPUT]: The original device journey, live layout controls and material comparison.
 * [POS]: Website composition only; previews save to memory, never to product settings.
 * [PROTOCOL]: Keep website/AGENTS.md and DESIGN_SYSTEM.md in sync. */
import { useMemo, useState } from 'react';
import { LayoutPreview } from '../settings/layout-preview';
import type { FeatureState } from '../shared/features';
import type { SurfaceState } from '../settings/surface-settings';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
import { features } from './demos';

const examples = {
  next: ['整理三个代表作品', '完成首页布局', '检查移动端'],
  outline: ['确定作品集内容', '安排页面与布局', '上线前检查'],
  board: ['待办 · 整理作品', '进行中 · 首页布局', '完成 · 确定范围'],
  model: ['GPT-6.1-Sol · Low', 'GPT-6-Astra · High'],
  terms: ['响应式布局', '可访问性', '首屏加载'],
  bots: ['工程主管', '资料助手', '随口一问'],
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
const places: Record<string, { title: string; text: string }> = {
  sidebar: {
    title: '侧栏，与对话并排。',
    text: '为大纲、下一步和术语留出位置，正文与输入框一起让位。侧栏宽度可以调整，新聊天与 Dots 是否显示也可单独设置。',
  },
  overlay: {
    title: '页面浮层，叠在当前页面上。',
    text: '保留聊天原来的宽度，需要时展开工作台。收起后回到左栏双眼入口，草稿与阅读位置继续保留。',
  },
  desktop: {
    title: '桌面窗口，带到另一块屏幕。',
    text: '工作台先弹出，再移到副屏；也可以放回聊天。独立窗口可调整尺寸、置顶，切换位置不清空内容。',
  },
  edge: {
    title: '贴边或刘海，放常用功能。',
    text: '例如把模型快切与看板放到屏幕边缘。悬停展开、离开收回，也可保持展开；屏幕、边缘和位置都能调整。',
  },
};
export function SurfaceStory() {
  const [placement, setPlacement] = useState('sidebar');
  const [edge, setEdge] = useState('right');
  const surfaces = useMemo(() => sampleSurfaces('matte', 'regular', edge), [edge]);
  return (
    <section
      className="surface-story page-width"
      data-static="true"
      aria-labelledby="surfaces-title"
    >
      <div className="section-intro">
        <h2 id="surfaces-title">
          位置与布局。
          <br />
          按你的工作方式摆放。
        </h2>
        <p>
          并排阅读，用侧栏；需要完整聊天宽度，用浮层。也可以把工作台移到副屏，让模型与看板留在屏幕边缘。
        </p>
      </div>
      <div className="site-settings-demo">
        <LayoutPreview
          features={sampleFeatures}
          surfaces={surfaces}
          live
          hostName="Codex"
          examples={examples}
          onPlacementChange={setPlacement}
        />
      </div>
      <div className="workspace-explanation">
        <div>
          <h3>{places[placement].title}</h3>
          <p>{places[placement].text}</p>
          {placement === 'edge' && (
            <div className="choice-row" role="group" aria-label="贴边位置演示">
              {[
                ['right', '右侧'],
                ['left', '左侧'],
                ['top', '顶部 / 刘海'],
                ['bottom', '底部'],
              ].map(([id, title]) => (
                <button key={id} aria-pressed={edge === id} onClick={() => setEdge(id)}>
                  {title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3>单击切功能，拖动排布局。</h3>
          <p>
            单击图标切换功能；上下、左右或合成标签，按需要排列。拖动标题合并、拆分面板，拖动分隔线调整比例。双击标题临时放大，Esc
            恢复。
          </p>
        </div>
      </div>
    </section>
  );
}
const materials: { id: SurfaceTheme['theme']; title: string; text: string }[] = [
  { id: 'matte', title: '哑光', text: '稳定的实色底面，正文和控件清楚地留在前景。' },
  { id: 'frosted', title: '磨砂', text: '均匀模糊背后的内容，让工作台与当前背景保持联系。' },
  {
    id: 'native-glass',
    title: '液态',
    text: '反光与透光形成边缘层次；Regular 更凝实，Clear 更通透。',
  },
];
export function MaterialStory() {
  const [material, setMaterial] = useState<SurfaceTheme['theme']>('native-glass');
  const [variant, setVariant] = useState<'regular' | 'clear'>('regular');
  const surfaces = useMemo(() => sampleSurfaces(material, variant), [material, variant]);
  return (
    <section className="material-story page-width" aria-labelledby="material-title">
      <div className="section-intro">
        <h2 id="material-title">
          材质与外观。
          <br />
          让界面融入你的桌面。
        </h2>
        <p>同一套工作台，三种质感。侧栏、浮层、桌面与贴边可以分别选择，明暗跟随 Codex。</p>
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
          <div className="choice-row" role="group" aria-label="材质演示">
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
            aria-label="液态变体"
            hidden={material !== 'native-glass'}
          >
            {(['regular', 'clear'] as const).map((id) => (
              <button key={id} aria-pressed={variant === id} onClick={() => setVariant(id)}>
                {id === 'regular' ? 'Regular' : 'Clear'}
              </button>
            ))}
          </div>
          <p>
            字号可以跟随聊天正文、按比例调整，也可自定。贴边还提供纯黑外观，术语卡片可单独选材质与背景。
          </p>
          <p className="material-boundary">
            网页展示为近似效果。桌面液态由 macOS 绘制，需 macOS 26。
          </p>
        </div>
      </div>
    </section>
  );
}
