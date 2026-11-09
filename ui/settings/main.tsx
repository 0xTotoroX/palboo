import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 现有设置表单、认证 API、共用设置控件及 PALBOO 矢量字标。
 * [OUTPUT]: 跟随宿主的设置页标题、分组表单与预览；页头集中搜索/主题/外部链接，页脚显示 v 版本号，保留保存与错误反馈。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { BackupSettings } from './backup-settings';
import { setLocale, getLocale } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BotSettings, BotSetupInstructions, type BotCatalog } from './bot-settings';
import { WebLibrarySettings } from './web-library-settings';
import { TerminologySettings } from './terminology-settings';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import './styles.css';
import './settings-layout.css';
import '../features/model/styles.css';
import './settings-preview.css';
import './terminology-settings.css';
import './settings-controls.css';
import './settings-host.css';
import './settings-motion.css';
import '../surfaces/workspace/styles.css';
import './layout-preview.css';
import { PalbooWordmark } from '../shared/brand';
import { useCompanion, type Settings, type EditableSettings } from './api';
import { useSettingsForm } from './use-settings-form';
import { SettingsOutline, useSettingsPage, pageTitles } from './settings-outline';
import { SettingsForm, FeatureSwitch, FeatureDetailsContext, Feedback } from './settings-controls';
import { TaskSettings } from './task-settings';
import { ModelControlSettings } from './model-control-settings';
import { SurfaceSettings } from './surface-settings';
import { NextSettings } from './next-settings';
import { QuickPromptSettings } from './quick-prompt-settings';
import { ModelSettings } from './model-settings';
import { useTasks } from '../features/board/api';
import { ConnectionSettings } from './connection-settings';
import { GeneralSettings } from './general-settings';
import { CodexHostSettings } from './codex-host-settings';
import { SettingsSearch } from './settings-search';
import { SettingsPreview } from './settings-preview';
import { PreviewFrame } from './preview-frame';
import { PromptPreview } from './prompt-preview';
import { useSettingsMotion } from './settings-motion';
import { SettingsTheme } from './settings-theme';
import type { FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import type { ModelState } from '../features/model/catalog';
import type { WebLibrary } from '../shared/web-library';
function editable(value: Settings): EditableSettings {
  const {
    enabled,
    answerOutlineEnabled,
    promptEnhancementEnabled,
    tokenMeterEnabled,
    quickPromptsEnabled,
    quickPromptClickMode,
    quickPromptLabelOnly,
    grokbotEnabled,
    grokbotAutoSync,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  } = value;
  return {
    enabled,
    answerOutlineEnabled,
    promptEnhancementEnabled,
    tokenMeterEnabled,
    quickPromptsEnabled,
    quickPromptClickMode,
    quickPromptLabelOnly,
    grokbotEnabled,
    grokbotAutoSync,
    generationMode,
    hostRestartPolicy,
    provider,
    protocol,
    model,
    baseUrl,
    apiKeyEnv,
    maxItems,
    directionSource,
    directionLibrary,
    selectedDirections,
    jev,
    quickPrompts,
    maxInputChars,
    maxOutputTokens,
    timeoutMs,
  };
}

function App() {
  const locale = useLocale();
  const { view, live, error } = useCompanion();
  useEffect(() => {
    if (view?.panelPreferences)
      setLocale(view.panelPreferences.language || 'zh-CN', view.systemLanguage);
  }, [view?.panelPreferences.language, view?.systemLanguage]);
  useEffect(() => {
    document.documentElement.lang = getLocale();
    document.title = locale === 'en' ? 'Palboo Settings' : tr('Palboo 设置');
  }, [locale]);
  const [notice, setNotice] = useState({ text: '', failed: false });
  const notify = (text: string, failed = false) => setNotice({ text, failed });
  const editor = useSettingsForm(live, view?.configurationRevision, editable, notify);
  const { page, dev, navigate } = useSettingsPage(!!editor.form);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const requestedFeature = useRef<typeof page | null>(null);
  useLayoutEffect(() => {
    if (requestedFeature.current !== page) return;
    requestedFeature.current = null;
    pageHeading.current?.focus({ preventScroll: true });
  }, [page]);
  const [features, setFeatures] = useState<FeatureState | null>(null);
  const [surfaces, setSurfaces] = useState<SurfaceState | null>(null);
  const [selectedAppearance, selectAppearance] = useState<string | null>(null);
  const appearancePlacement = selectedAppearance || features?.mainPlacement || 'sidebar';
  useEffect(() => {
    const reveal = (event: Event) => {
      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-appearance-placement]')
          : null;
      if (row?.dataset.appearancePlacement) selectAppearance(row.dataset.appearancePlacement);
    };
    document.addEventListener('buddy-settings-detail-reveal', reveal);
    return () => document.removeEventListener('buddy-settings-detail-reveal', reveal);
  }, []);
  const [model, setModel] = useState<ModelState | null>(null);
  const [bots, setBots] = useState<BotCatalog | null>(null);
  const [sites, setSites] = useState<WebLibrary | null>(null);
  const [modelEnablement, setModelEnablement] = useState<HTMLDivElement | null>(null);
  const [termEnablement, setTermEnablement] = useState<HTMLDivElement | null>(null);
  const [hostEnablement, setHostEnablement] = useState<HTMLDivElement | null>(null);
  const [siteEnablement, setSiteEnablement] = useState<HTMLDivElement | null>(null);
  const contentRef = useSettingsMotion(page);
  const tasks = useTasks(live);
  const common = page === 'features';
  const surfacesVisible = page === 'surfaces' || page === 'appearance';
  useEffect(() => {
    setNotice((current) => (current.failed ? current : { text: '', failed: false }));
  }, [page]);
  const connected = live && view?.connection.status === 'connected';
  const content = (
    <div className="settings-app" data-settings-category={page}>
      <header className="settings-header">
        <div className="settings-topline">
          <a
            href="#settings-features"
            className="settings-brand"
            aria-label={tr('Palboo {{value1}}', {
              value1: import.meta.env.DEV ? tr('开发版') : tr('设置'),
            })}
            data-settings-navigation
          >
            <PalbooWordmark className="settings-wordmark" />
            <span className="settings-edition">
              {import.meta.env.DEV ? tr('开发版') : tr('设置')}
            </span>
          </a>
          <div className="settings-header-actions">
            <div className="settings-header-tools">
              <SettingsSearch navigate={navigate} />
              <SettingsTheme
                codexTheme={view?.panelTheme}
                hostAppearance={view?.settingsAppearance}
                typography={view?.panelTypography}
                appearance={view?.panelPreferences}
                notify={notify}
              />
              <nav className="settings-external-links" aria-label={tr('Palboo 链接')}>
                <a
                  href="https://palboo.0xtotoro.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={tr('Palboo 宣传页')}
                  aria-label={tr('Palboo 宣传页')}
                >
                  <Icon name="website" />
                </a>
                <a
                  href="https://github.com/0xTotoroX/palboo"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={tr('GitHub 仓库')}
                  aria-label={tr('GitHub 仓库')}
                >
                  <Icon name="github" />
                </a>
              </nav>
            </div>
            {page !== 'connection' && (
              <span
                className="settings-connection-status"
                data-connected={connected}
                role="status"
                aria-label={connected ? tr('已连接') : undefined}
              >
                {!connected &&
                  (!live
                    ? tr('未连接')
                    : view?.connection.status === 'unresponsive'
                      ? tr('页面暂未响应')
                      : tr('等待连接'))}
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="settings-layout">
        <SettingsOutline page={page} dev={dev} navigate={navigate} />
        <main
          id={surfacesVisible ? 'settings-surfaces' : undefined}
          className="settings-content min-w-0"
          aria-label={pageTitles[page]}
          ref={contentRef}
        >
          <h1 className="settings-page-title" ref={pageHeading} tabIndex={-1}>
            {pageTitles[page]}
          </h1>
          <Feedback text={error} failed />
          {!editor.form && !error && <p role="status">{tr('正在读取设置…')}</p>}
          <Feedback
            text={notice.text === editor.saveError ? '' : notice.text}
            failed={notice.failed}
          />
          <div className="settings-body">
            {page !== 'features' && page !== 'backup' && (
              <SettingsPreview
                page={page}
                form={editor.form}
                dirty={editor.dirty}
                features={features}
                surfaces={surfaces}
                model={model}
                bots={bots}
                sites={sites}
                tasks={tasks.state}
                view={view}
                live={live}
                appearancePlacement={appearancePlacement}
                onAppearancePlacement={selectAppearance}
              />
            )}
            <section
              data-settings-page="prompt-enhancement"
              hidden={page !== 'prompt-enhancement'}
              className="settings-local-preview"
            >
              <PreviewFrame title={pageTitles['prompt-enhancement']} className="preview-prompt">
                <PromptPreview active={page === 'prompt-enhancement'} />
              </PreviewFrame>
            </section>
            <div className="settings-form-column">
              <BackupSettings
                active={page === 'backup'}
                live={live}
                dirty={editor.dirty || editor.saving || editor.remoteChanged}
              />

              <section
                hidden={!common}
                data-settings-page="features"
                className="settings-section settings-feature-list"
                aria-label={tr('功能开关')}
              >
                <div id="settings-outline-enabled">
                  <FeatureSwitch
                    name={pageTitles.outline}
                    featurePage="outline"
                    checked={editor.form?.answerOutlineEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('answerOutlineEnabled', v)}
                  />
                </div>
                <div>
                  <FeatureSwitch
                    name={pageTitles.next}
                    featurePage="next"
                    checked={editor.form?.enabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('enabled', v)}
                  />
                </div>
                <div>
                  <FeatureSwitch
                    name={pageTitles.prompts}
                    featurePage="prompts"
                    checked={editor.form?.quickPromptsEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('quickPromptsEnabled', v)}
                  />
                </div>
                <div ref={setTermEnablement} />
                <div>
                  <FeatureSwitch
                    name={pageTitles.board}
                    featurePage="board"
                    checked={tasks.state?.store.boardEnabled ?? false}
                    disabled={tasks.busy || !tasks.state || !!tasks.state.error}
                    onChange={(boardEnabled) => void tasks.command({ op: 'modules', boardEnabled })}
                  />
                </div>
                <div ref={setModelEnablement} />
                <div id="settings-grokbot">
                  <FeatureSwitch
                    name={pageTitles.bots}
                    featurePage="bots"
                    checked={editor.form?.grokbotEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('grokbotEnabled', value)}
                  />
                </div>
                <div id="settings-prompt-enhancement-enabled">
                  <div ref={setSiteEnablement} />
                  <FeatureSwitch
                    name={pageTitles['prompt-enhancement']}
                    featurePage="prompt-enhancement"
                    checked={editor.form?.promptEnhancementEnabled ?? true}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('promptEnhancementEnabled', value)}
                  />
                </div>
                <div ref={setHostEnablement} />
              </section>
              <div data-settings-page="model-control" hidden={page !== 'model-control'}>
                <ModelControlSettings
                  live={live}
                  active={common || page === 'model-control' || surfacesVisible}
                  detailed={page === 'model-control'}
                  enablementTarget={modelEnablement}
                  onSnapshot={setModel}
                >
                  <div id="settings-token-meter">
                    <FeatureSwitch
                      name={tr('聊天测速')}
                      checked={editor.form?.tokenMeterEnabled ?? false}
                      disabled={!live || !editor.form}
                      onChange={(value) => editor.change('tokenMeterEnabled', value)}
                    />
                  </div>
                </ModelControlSettings>
              </div>
              <div hidden={page !== 'bots'} className="settings-actions">
                <BotSetupInstructions hidden={page !== 'bots'} />
              </div>
              <BotSettings
                active={page === 'bots'}
                previewActive={surfacesVisible}
                onSnapshot={setBots}
                live={live}
                editor={editor}
              />
              <WebLibrarySettings
                live={live}
                active={page === 'sites'}
                previewActive={surfacesVisible}
                onSnapshot={setSites}
                enablementTarget={siteEnablement}
              />
              <section
                data-settings-page="surfaces"
                hidden={!surfacesVisible}
                className="settings-section settings-common-surface"
              >
                <SurfaceSettings
                  live={live}
                  active={surfacesVisible}
                  desktopSupported={editor.saved?.popoutSupported === true}
                  appearance={view?.panelPreferences}
                  fontBase={view?.panelFontBase}
                  page={page === 'appearance' ? 'appearance' : 'surfaces'}
                  appearancePlacement={appearancePlacement}
                  onFeatures={setFeatures}
                  onSnapshot={setSurfaces}
                />
              </section>
              <div data-settings-page="terminology" hidden={page !== 'terminology'}>
                <TerminologySettings
                  live={live}
                  active={common || page === 'terminology'}
                  detailsVisible={page === 'terminology'}
                  enablementTarget={termEnablement}
                />
              </div>
              <SettingsForm
                editor={editor}
                notify={notify}
                active={['model', 'next', 'prompts', 'features', 'connection'].includes(page)}
              >
                <div hidden={page !== 'next'}>
                  <NextSettings editor={editor} appearance={view?.panelPreferences} />
                </div>
                <div hidden={page !== 'prompts'}>
                  <QuickPromptSettings editor={editor} appearance={view?.panelPreferences} />
                </div>
                <div data-settings-page="model" hidden={page !== 'model'}>
                  <ModelSettings editor={editor} />
                </div>
                <div data-settings-page="connection" hidden={page !== 'connection'}>
                  <ConnectionSettings
                    editor={editor}
                    view={view}
                    live={live}
                    active={page === 'connection'}
                    notify={notify}
                  />
                </div>
              </SettingsForm>
              <div data-settings-page="board" hidden={page !== 'board'}>
                <TaskSettings tasks={tasks} />
              </div>
              <div data-settings-page="codex-host" hidden={page !== 'codex-host'}>
                <CodexHostSettings
                  live={live}
                  active={common || page === 'codex-host'}
                  detailsVisible={page === 'codex-host'}
                  enablementTarget={hostEnablement}
                />
              </div>
              <div data-settings-page="general" hidden={page !== 'general'}>
                <GeneralSettings live={live} view={view} editor={editor} />
              </div>
              <section
                data-settings-page="dev"
                hidden={page !== 'dev' || !dev}
                className="settings-section"
              >
                <div id="settings-dev-content" />
              </section>
            </div>
          </div>
        </main>
      </div>
      {page !== 'general' && (
        <footer className="settings-footer">
          <span>{live && view?.version ? `v${view.version}` : '—'}</span>
        </footer>
      )}
    </div>
  );
  return (
    <FeatureDetailsContext.Provider
      value={(feature) => {
        requestedFeature.current = feature;
        navigate(feature, `#settings-${feature}`);
      }}
    >
      {content}
    </FeatureDetailsContext.Provider>
  );
}
// A Vite dependency update can re-evaluate this entry without replacing its container.
const root: ReturnType<typeof createRoot> =
  import.meta.hot?.data.root || createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
