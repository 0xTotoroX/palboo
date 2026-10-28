import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 已保存的功能、承载、任务和模型配置，以及当前连接与外观状态。
 * [OUTPUT]: 按承载和功能组织的只读总览，展示任务分组数量和模型配置，属性链接定位设置项，不直接修改配置。
 * [POS]: 设置展示层；仅在总览可见时读取现有服务，不创建新配置。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useState, type ReactNode } from 'react';
import { request, type Settings, type View } from './api';
import type { SurfaceState } from './surface-settings';
import {
  titles,
  featureFontSize,
  type FeatureId,
  type FeatureState,
  type Placement,
} from '../shared/features';
import { columns, taskGroup, type TaskState } from '../features/board/api';
import type { ModelState } from '../features/model/view';
import { resolveFeatureLayout } from '../surfaces/workspace/layout';
import type { SurfaceTheme } from '../surfaces/theme/appearance';
import { Feedback } from './settings-controls';

const placements: Record<Placement, string> = {
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
const axes: Record<string, string> = {
  get auto() {
    return tr('自动分栏');
  },
  get vertical() {
    return tr('上下分栏');
  },
  get horizontal() {
    return tr('左右分栏');
  },
};
type Snapshot = {
  features: FeatureState;
  surfaces: SurfaceState;
  tasks: TaskState;
  models: ModelState;
  settings: Settings;
};
function themeLabel(value?: SurfaceTheme) {
  if (!value) return tr('未读取');
  if (value.theme === 'native-glass')
    return value.liquidVariant === 'clear' ? tr('液态 · 通透') : tr('液态 · 标准');
  return { black: tr('纯黑'), matte: tr('哑光'), frosted: tr('磨砂') }[value.theme];
}
function Metric({ label, children, href }: { label: string; children: ReactNode; href: string }) {
  useLocale();
  return (
    <div>
      <dt>
        <a href={href} tabIndex={-1}>
          {label}
        </a>
      </dt>
      <dd>
        <a href={href}>{children}</a>
      </dd>
    </div>
  );
}
export function SettingsOverview({
  active,
  live,
  view,
}: {
  active: boolean;
  live: boolean;
  view: View | null;
}) {
  useLocale();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active || !live) return;
    let disposed = false,
      reading = false;
    const read = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const [features, surfaces, tasks, models, settings] = await Promise.all([
          request<FeatureState>('features', { op: 'state' }),
          request<SurfaceState>('surfaces', { op: 'state' }),
          request<TaskState>('tasks/state'),
          request<ModelState>('model-control/state'),
          request<Settings>('settings'),
        ]);
        if (!disposed) {
          setSnapshot({ features, surfaces, tasks, models, settings });
          setError('');
        }
      } catch (e) {
        if (!disposed) setError(tr('总览未能更新：{{value1}}', { value1: (e as Error).message }));
      } finally {
        reading = false;
      }
    };
    void read();
    window.addEventListener('focus', read);
    const timer = setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, [active, live]);
  if (!snapshot)
    return error ? (
      <Feedback text={error} failed />
    ) : live ? (
      <p role="status">{tr('正在读取总览…')}</p>
    ) : null;
  const { features, surfaces, tasks, models, settings } = snapshot;
  const primary = features.mainPlacement || 'sidebar';
  const ui = view?.panelPreferences.ui;
  const enabled: Record<FeatureId, boolean> = {
    bots: settings.grokbotEnabled,
    outline: settings.answerOutlineEnabled,
    next: settings.enabled,
    prompts: settings.quickPromptsEnabled,
    board: tasks.store.boardEnabled,
    model: models.preferences.enabled,
    terms: features.features.some((entry) => entry.id === 'terms' && entry.open),
  };
  const location = (id: FeatureId) =>
    features.features.find((e) => e.id === id)?.placement || (id === 'model' ? 'edge' : primary);
  const ids = (Object.keys(titles) as FeatureId[]).filter((id) => location(id) !== 'edge');
  const layout = resolveFeatureLayout(
    features.layouts?.[primary],
    features.legacyLayouts?.[primary],
    ids,
  );
  const layoutLabel =
    layout.groups.length === 1
      ? tr('标签组')
      : layout.groups.some((group) => 'groups' in group || group.ids.length > 1)
        ? tr('自定义分栏')
        : axes[layout.axis];
  const current = models.snapshot.current;
  const modelName =
    current && (models.snapshot.models.find((m) => m.id === current.model)?.label || current.model);
  const boardColumns = tasks.store.columns ?? columns;
  const modelLabel = (id: string) => models.snapshot.models.find((m) => m.id === id)?.label || id;
  const favorites = [
    ...new Set([...(models.preferences.modelOrder ?? []), ...models.preferences.pinned]),
  ].filter((id) => models.preferences.pinned.includes(id));
  const reasoningLabel = (value: string) =>
    ({
      none: tr('无'),
      minimal: tr('最低'),
      low: tr('低'),
      medium: tr('中'),
      high: tr('高'),
      xhigh: tr('很高'),
      max: tr('最高'),
      ultra: tr('极高'),
    })[value] || value;
  const featureList = (placement: Placement) => (
    <ul className="overview-features">
      {(Object.keys(titles) as FeatureId[])
        .filter((id) => location(id) === placement)
        .map((id) => (
          <li key={id}>
            <a href={`#settings-${id === 'model' ? 'model-control' : id}`}>{titles[id]}</a>
            {!enabled[id] && <span className="overview-muted">{tr('已停用')}</span>}
          </li>
        ))}
    </ul>
  );
  return (
    <div className="settings-overview" aria-label={tr('当前配置总览')}>
      <Feedback text={error || surfaces.error || tasks.error || ''} failed />
      <section className="overview-surface" aria-label={tr('承载与功能')}>
        <div className="overview-hero">
          <div className="overview-identity">
            <h2>{tr('主界面')}</h2>
            <strong>
              <a href="#settings-surfaces/main-placement">{placements[primary]}</a>
            </strong>
            {featureList(primary)}
          </div>
          <dl className="overview-metrics">
            <Metric label={tr('主题')} href={`#settings-surfaces/theme-${primary}`}>
              {themeLabel(surfaces.preferences.themes[primary])}
            </Metric>
            <Metric label={tr('布局')} href="#settings-surfaces/main-layout">
              {layoutLabel}
            </Metric>
            <div>
              <dt>
                <a href="#settings-surfaces/settings-fonts">{tr('字号')}</a>
              </dt>
              <dd className="overview-fonts">
                {(Object.keys(titles) as FeatureId[]).map((id) => (
                  <a key={id} href={`#settings-surfaces/font-${id}`}>
                    {titles[id]}{' '}
                    {ui
                      ? `${featureFontSize(id, ui.fontSizes, ui.fontOffset ? ui.fontOffset + (view?.panelFontBase ?? 13) : undefined).toFixed(1)} px`
                      : tr('未读取')}
                  </a>
                ))}
              </dd>
            </div>
            {primary === 'sidebar' && ui && (
              <Metric label={tr('宽度')} href="#settings-surfaces/dock-width">
                {ui.dockWidth} px
              </Metric>
            )}
            {primary === 'desktop' && view && (
              <Metric label={tr('置顶')} href="#settings-surfaces/window-pinning">
                {view.panelPreferences.alwaysOnTop ? tr('开启') : tr('关闭')}
              </Metric>
            )}
          </dl>
        </div>
        <div className="overview-edge">
          <div>
            <h3>{tr('贴边 / 刘海')}</h3>
            {featureList('edge')}
          </div>
          <dl className="overview-metrics">
            <Metric label={tr('主题')} href="#settings-surfaces/theme-edge">
              {themeLabel(surfaces.preferences.themes.edge)}
            </Metric>
            <Metric label={tr('位置')} href="#settings-surfaces/edge-position">
              {{ right: tr('右侧'), left: tr('左侧'), top: tr('顶部') }[
                surfaces.preferences.edge.edge
              ] || surfaces.preferences.edge.edge}{' '}
              · {Math.round(surfaces.preferences.edge.position * 100)}%
            </Metric>
            <Metric label={tr('展开')} href="#settings-surfaces/edge-keep-open">
              {surfaces.preferences.edge.keepOpen ? tr('保持展开') : tr('鼠标靠近时展开')}
            </Metric>
          </dl>
        </div>
      </section>
      <section className="overview-surface" aria-label={tr('下一步配置')}>
        <div className="overview-hero">
          <div className="overview-identity">
            <h2>{tr('下一步')}</h2>
            <strong>
              <a href="#settings-model">{settings.model || tr('未配置模型')}</a>
            </strong>
            <p className="overview-muted">
              {!settings.enabled
                ? tr('已停用')
                : settings.available
                  ? tr('已启用')
                  : settings.reason || tr('等待配置')}
            </p>
          </div>
          <dl className="overview-metrics">
            <Metric label={tr('生成')} href="#settings-next/generation-mode">
              {settings.generationMode === 'manual' ? tr('手动刷新') : tr('自动生成')}
            </Metric>
            <Metric label={tr('显示')} href="#settings-next/suggestion-labels">
              {ui ? (ui.labelOnly ? tr('仅标题') : tr('标题 + 摘要')) : tr('未读取')}
            </Metric>
            <Metric label={tr('点击')} href="#settings-next/suggestion-click">
              {ui
                ? { fill: tr('仅填入'), direct: tr('直接发送'), hybrid: tr('单击填入 · 双击发送') }[
                    ui.promptClickMode
                  ]
                : tr('未读取')}
            </Metric>
          </dl>
        </div>
        <dl className="overview-footer">
          <Metric label={tr('方向')} href="#settings-next/settings-directions">
            {
              { auto: tr('自动探索'), manual: tr('自选方向'), smart: tr('智能挑选') }[
                settings.directionSource
              ]
            }
          </Metric>
          <Metric label={tr('数量')} href="#settings-next/max-items">
            {tr('最多 {{count}} 条', { count: settings.maxItems })}
          </Metric>
        </dl>
      </section>
      <section className="overview-surface overview-board" aria-label={tr('看板配置')}>
        <header className="overview-section-head">
          <h2>
            <a href="#settings-board">{tr('看板')}</a>
          </h2>
          <span className="overview-muted">{enabled.board ? tr('已启用') : tr('已停用')}</span>
        </header>
        <dl className="overview-board-columns">
          {boardColumns.map((column) => (
            <div key={column.id}>
              <dt>
                <a href="#settings-board/board-groups">{column.title}</a>
              </dt>
              <dd>
                {tasks.store.tasks.filter((task) => taskGroup(task) === column.id).length}
                <span>{tr('项')}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="overview-surface overview-model" aria-label={tr('模型切换配置')}>
        <header className="overview-section-head">
          <h2>
            <a href="#settings-model-control">{tr('模型切换')}</a>
          </h2>
          {!enabled.model && <span className="overview-muted">{tr('已停用')}</span>}
        </header>
        <div className="overview-model-content">
          <div className="overview-model-current">
            <h3>{tr('当前模型')}</h3>
            <strong>
              <a href="#settings-model-control">{modelName || tr('未读取')}</a>
            </strong>
            {current && (
              <p className="overview-muted">
                {[
                  current.reasoning &&
                    tr('推理：{{value1}}', { value1: reasoningLabel(current.reasoning) }),
                  current.speed === 'fast' && tr('快速模式'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {models.snapshot.message && !['ready', 'waiting'].includes(models.snapshot.status) && (
              <p role="status">{tr(models.snapshot.message)}</p>
            )}
          </div>
          <div className="overview-model-favorites">
            <h3>{tr('常用模型')}</h3>
            {favorites.length ? (
              <ul>
                {favorites.map((id) => (
                  <li key={id}>
                    <a href="#settings-model-control">{modelLabel(id)}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="overview-muted">{tr('未设置')}</p>
            )}
          </div>
        </div>
        {models.preferences.presets.length > 0 && (
          <div className="overview-model-presets">
            <h3>{tr('预设')}</h3>
            <ul>
              {models.preferences.presets.map((preset) => (
                <li key={preset.id}>
                  <a href="#settings-model-control">{preset.name}</a>
                  <span className="overview-muted">{modelLabel(preset.selection.model)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
