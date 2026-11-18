import { SegmentedGroup } from './components/ui/segmented-group';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared preview frame, existing form/website snapshots, saved surfaces and feature layout.
 * [OUTPUT]: Linked diagrams and actual interactive feature components; connection/sites settings own their inline state and preview without a duplicate overview.
 * [POS]: Settings presentation only; receives current local snapshots, never requests credentials or sends host commands.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { LayoutPreview } from './layout-preview';
import { ModelPreview } from './model-preview';
import { FeaturePreviewContent } from './feature-preview';
import { FeatureChatPreview } from './feature-chat-preview';
import { useCallback, useState } from 'react';
import type { BotCatalog } from './bot-settings';
import type { SettingsPage } from './settings-outline';
import type { EditableSettings, View } from './api';
import type { SurfaceState } from './surface-settings';
import { titles, type FeatureState } from '../shared/features';
import type { ModelState } from '../features/model/catalog';
import type { TaskState } from '../features/board/api';
import type { WebLibrary } from '../shared/web-library';
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
  sites?: WebLibrary | null;
  view: View | null;
  live: boolean;
  appearancePlacement?: string;
  onAppearancePlacement?: (placement: string) => void;
};

const scenes = ['outline', 'next', 'prompts', 'board', 'model', 'bots'] as const;
type Scene = (typeof scenes)[number];
const pageScene: Partial<Record<SettingsPage, Scene>> = {
  outline: 'outline',
  next: 'next',
  prompts: 'prompts',
  board: 'board',
  'model-control': 'model',
  bots: 'bots',
};

function FeaturePreview({ form, tasks, model, bots, view, dirty, page }: PreviewProps) {
  useLocale();
  const [tab, setTab] = useState<Scene>('next');
  const activeScene = pageScene[page] ?? tab;
  // A dedicated page pays only for previews the user has opened. Keep visited
  // scenes mounted so returning to one preserves its draft and reading position.
  const [visited, setVisited] = useState<Scene[]>([activeScene]);
  if (!visited.includes(activeScene)) setVisited([...visited, activeScene]);
  const mountedScenes = page === 'features' ? scenes : visited;
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
      className="preview-chat-frame"
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
        {scenes.map((id) => (
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
        {mountedScenes.map((scene) => {
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
                  <ModelPreview
                    model={model}
                    mode="current"
                    showTokenMeter={form?.tokenMeterEnabled !== false}
                  />
                ) : (
                  <FeatureChatPreview
                    id={scene}
                    form={form}
                    view={view}
                    tasks={tasks}
                    bots={bots}
                    mode="current"
                    active={activeScene === scene}
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

export function SettingsPreview(props: PreviewProps) {
  useLocale();
  const { form, view, tasks, bots, model, sites } = props;
  const renderFeature = useCallback(
    (id: string, headerActions: HTMLElement) =>
      id === 'model' ? (
        <ModelPreview
          model={model}
          mode="current"
          headerActions={headerActions}
          showTokenMeter={form?.tokenMeterEnabled !== false}
        />
      ) : ['outline', 'next', 'prompts', 'board', 'bots', 'terms', 'sites'].includes(id) ? (
        <FeaturePreviewContent
          id={id as 'outline' | 'next' | 'prompts' | 'board' | 'bots' | 'terms' | 'sites'}
          form={form}
          view={view}
          tasks={tasks}
          bots={bots}
          sites={sites}
          mode="current"
          headerActions={headerActions}
        />
      ) : null,
    [form, view, tasks, bots, model, sites],
  );
  if (
    [
      'general',
      'connection',
      'backup',
      'model',
      'codex-host',
      'prompt-enhancement',
      'sites',
    ].includes(props.page)
  )
    return null;
  const workspace = props.page === 'surfaces' || props.page === 'appearance';
  return (
    <aside
      className="settings-preview"
      aria-label={tr('联动预览')}
      hidden={['terminology', 'dev'].includes(props.page)}
      data-preview-kind={workspace ? 'workspace' : props.page}
    >
      {workspace ? (
        <LayoutPreview
          features={props.features}
          surfaces={props.surfaces}
          live={props.live}
          sceneZoom={1}
          appearance={props.page === 'appearance'}
          appearancePlacement={props.appearancePlacement}
          onAppearancePlacement={props.onAppearancePlacement}
          typography={props.view?.panelTypography}
          typographyPreferences={props.view?.panelPreferences.typography}
          surfaceTypography={props.view?.panelPreferences.surfaceTypography}
          renderFeature={renderFeature}
        />
      ) : props.page === 'features' || pageScene[props.page] ? (
        <FeaturePreview {...props} />
      ) : null}
    </aside>
  );
}
