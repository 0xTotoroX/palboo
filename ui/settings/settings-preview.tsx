import { SegmentedGroup } from './components/ui/segmented-group';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared preview frame, existing form snapshots, saved surfaces and feature layout.
 * [OUTPUT]: Linked diagrams and actual interactive feature components; connection settings use their own inline state rather than a duplicate overview.
 * [POS]: Settings presentation only; receives current local snapshots, never requests credentials or sends host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { LayoutPreview } from './layout-preview';
import { ModelPreview } from './model-preview';
import { FeaturePreviewContent } from './feature-preview';
import { useCallback, useState, type ReactNode } from 'react';
import type { BotCatalog } from './bot-settings';
import type { SettingsPage } from './settings-outline';
import type { EditableSettings, View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureState } from '../shared/features';
import type { ModelState } from '../features/model/catalog';
import type { TaskState } from '../features/board/api';
import { PreviewFrame as Frame } from './preview-frame';
import { usePreviewTransition } from './settings-motion';

type PreviewProps = {
  page: SettingsPage;
  form: EditableSettings | null;
  dirty: boolean;
  features: FeatureState | null;
  surfaces: SurfaceState | null;
  model: ModelState | null;
  tasks: TaskState | null;
  bots: BotCatalog | null;
  view: View | null;
  live: boolean;
};

function Facts({ items }: { items: [string, ReactNode][] }) {
  useLocale();
  return (
    <dl className="preview-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FeaturePreview({ form, tasks, model, bots, view, dirty, page }: PreviewProps) {
  useLocale();
  const [tab, setTab] = useState<'outline' | 'next' | 'prompts' | 'board' | 'model' | 'bots'>(
    'next',
  );
  const activeScene =
    page === 'prompts'
      ? 'prompts'
      : page === 'bots'
        ? 'bots'
        : page === 'board'
          ? 'board'
          : page === 'model-control'
            ? 'model'
            : page === 'next'
              ? 'next'
              : tab;
  const transition = usePreviewTransition(activeScene);
  const enabled = {
    outline: form?.answerOutlineEnabled,
    next: form?.enabled,
    prompts: form?.quickPromptsEnabled,
    board: tasks?.store.boardEnabled,
    model: model?.preferences.enabled,
    bots: form?.grokbotEnabled,
  };
  return (
    <Frame
      title={tr('功能如何呈现')}
      className={activeScene === 'board' ? 'preview-board' : undefined}
      status={dirty ? tr('包含未保存的编辑') : undefined}
    >
      <SegmentedGroup
        value={activeScene}
        className="preview-selector"
        role="group"
        aria-label={tr('功能预览')}
        hidden={page !== 'features'}
        data-settings-navigation
      >
        {(['outline', 'next', 'prompts', 'board', 'model', 'bots'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeScene === id}
            onClick={() => setTab(id)}
          >
            {titles[id]}
          </button>
        ))}
      </SegmentedGroup>
      <div className="preview-scenes" data-single-scene={page !== 'features'} ref={transition}>
        {(['outline', 'next', 'prompts', 'board', 'model', 'bots'] as const).map((scene) => {
          const active = enabled[scene];
          return (
            <div
              key={scene}
              className="preview-scene"
              data-preview-scene={scene}
              data-active={activeScene === scene}
              aria-hidden={activeScene !== scene}
              inert={activeScene !== scene}
            >
              <div className="preview-demo preview-product" data-enabled={active !== false}>
                {scene === 'model' ? (
                  <ModelPreview model={model} mode="current" />
                ) : (
                  <FeaturePreviewContent
                    id={scene}
                    form={form}
                    view={view}
                    tasks={tasks}
                    bots={bots}
                    mode="current"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function GenerationPreview({ form, dirty }: PreviewProps) {
  useLocale();
  return (
    <Frame
      className="preview-generation"
      title={tr('共享模型连接')}
      status={dirty ? tr('包含未保存的编辑') : undefined}
    >
      <div className="preview-demo">
        <div className="preview-model-name">
          <strong>{form?.model || tr('尚未配置模型')}</strong>
          <span>{form?.provider === 'codex' ? tr('Codex 登录') : form?.protocol || '—'}</span>
        </div>
        <Facts
          items={[
            [tr('输出上限'), `${form?.maxOutputTokens ?? '—'} tokens`],
            [tr('请求超时'), tr('{{value1}} 秒', { value1: form ? form.timeoutMs / 1000 : '—' })],
          ]}
        />
      </div>
    </Frame>
  );
}
export function SettingsPreview(props: PreviewProps) {
  useLocale();
  const { form, view, tasks, bots, model } = props;
  const renderFeature = useCallback(
    (id: string, headerActions: HTMLElement) =>
      id === 'model' ? (
        <ModelPreview model={model} mode="current" headerActions={headerActions} />
      ) : ['outline', 'next', 'prompts', 'board', 'bots', 'terms'].includes(id) ? (
        <FeaturePreviewContent
          id={id as 'outline' | 'next' | 'prompts' | 'board' | 'bots' | 'terms'}
          form={form}
          view={view}
          tasks={tasks}
          bots={bots}
          mode="current"
          headerActions={headerActions}
        />
      ) : null,
    [form, view, tasks, bots, model],
  );
  if (['connection', 'codex-host'].includes(props.page)) return null;
  const workspace = props.page === 'surfaces' || props.page === 'appearance';
  return (
    <aside
      className="settings-preview"
      aria-label={tr('联动预览')}
      hidden={['performance', 'terminology', 'dev'].includes(props.page)}
      data-preview-kind={workspace ? 'workspace' : props.page}
    >
      {workspace ? (
        <LayoutPreview
          features={props.features}
          surfaces={props.surfaces}
          live={props.live}
          appearance={props.page === 'appearance'}
          typography={props.view?.panelTypography}
          typographyPreferences={props.view?.panelPreferences.typography}
          surfaceTypography={props.view?.panelPreferences.surfaceTypography}
          renderFeature={renderFeature}
        />
      ) : ['features', 'next', 'prompts', 'board', 'model-control', 'bots'].includes(props.page) ? (
        <FeaturePreview {...props} />
      ) : props.page === 'model' ? (
        <GenerationPreview {...props} />
      ) : null}
    </aside>
  );
}
