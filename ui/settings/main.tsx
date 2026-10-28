import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 现有设置表单、认证 API、共用设置控件及 PALBOO 矢量字标。
 * [OUTPUT]: Tom Modern 统一设置、常用开关、分组页面及抽屉入口、主题/字体与联动预览；布局页锚点包含预览，保留保存与错误反馈。
 * [POS]: 设置展示层，不执行后台业务或读取聊天正文。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useTypography } from './use-typography';
import { LanguageSettings } from './language-settings';
import { setLocale, getLocale } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { StrictMode, useEffect, useState } from 'react';
import { BotSettings, BotSetupInstructions } from './bot-settings';
import { TerminologySettings } from './terminology-settings';
import { createRoot } from 'react-dom/client';
import '../shared/tokens.css';
import './styles.css';
import './settings-layout.css';
import '../features/model/styles.css';
import './settings-preview.css';
import './terminology-settings.css';
import './settings-controls.css';
import './settings-motion.css';
import '../surfaces/workspace/styles.css';
import './layout-preview.css';
import { PalbooWordmark } from '../shared/brand';
import { useCompanion, type Settings, type EditableSettings } from './api';
import { useSettingsForm } from './use-settings-form';
import { SettingsOutline, useSettingsPage, pageTitles } from './settings-outline';
import { SettingsForm, FeatureSwitch, Feedback } from './settings-controls';
import { TaskSettings } from './task-settings';
import { ModelControlSettings } from './model-control-settings';
import { SurfaceSettings } from './surface-settings';
import { NextSettings } from './next-settings';
import { LauncherSettings } from './launcher-settings';
import { ModelSettings } from './model-settings';
import { useTasks } from '../features/board/api';
import { ConnectionSettings } from './connection-settings';
import { CodexHostSettings } from './codex-host-settings';
import { PerformanceSettings } from './performance-settings';
import { SettingsSearch } from './settings-search';
import { SettingsPreview } from './settings-preview';
import { useSettingsMotion } from './settings-motion';
import { SettingsTheme } from './settings-theme';
import type { FeatureState } from '../shared/features';
import type { SurfaceState } from './surface-settings';
import type { ModelState } from '../features/model/catalog';
function editable(value: Settings): EditableSettings {
  const {
    enabled,
    answerOutlineEnabled,
    promptEnhancementEnabled,
    tokenMeterEnabled,
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
    if (view?.panelPreferences) setLocale(view.panelPreferences.language || 'zh-CN');
  }, [view?.panelPreferences.language]);
  useEffect(() => {
    document.documentElement.lang = getLocale();
    document.title = locale === 'en' ? 'Palboo Settings' : tr('Palboo 设置');
  }, [locale]);
  useTypography(view?.panelTypography, view?.panelPreferences.typography);
  const [notice, setNotice] = useState({ text: '', failed: false });
  const notify = (text: string, failed = false) => setNotice({ text, failed });
  const editor = useSettingsForm(live, view?.configurationRevision, editable, notify);
  const { page, dev, navigate } = useSettingsPage(!!editor.form);
  const [features, setFeatures] = useState<FeatureState | null>(null);
  const [surfaces, setSurfaces] = useState<SurfaceState | null>(null);
  const [model, setModel] = useState<ModelState | null>(null);
  const contentRef = useSettingsMotion(page);
  const tasks = useTasks(live);
  const common = page === 'features';
  const featuresVisible = common || ['next', 'board', 'model-control', 'bots'].includes(page);
  const surfacesVisible = page === 'surfaces' || page === 'appearance';
  useEffect(() => {
    setNotice((current) => (current.failed ? current : { text: '', failed: false }));
  }, [page]);
  const connected = live && view?.connection.status === 'connected';
  return (
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
          <SettingsSearch navigate={navigate} />
          <div className="settings-header-actions">
            <SettingsTheme
              codexTheme={view?.panelTheme}
              appearance={view?.panelPreferences}
              notify={notify}
            />
            <span
              className="settings-connection-status"
              data-connected={connected}
              role="status"
              aria-label={connected ? tr('已连接') : undefined}
            >
              {!connected &&
                (view?.connection.status === 'unresponsive'
                  ? tr('页面暂未响应')
                  : live
                    ? tr('等待连接')
                    : tr('未连接'))}
            </span>
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
          <Feedback text={error} failed />
          {!editor.form && !error && <p role="status">{tr('正在读取设置…')}</p>}
          <Feedback
            text={notice.text === editor.saveError ? '' : notice.text}
            failed={notice.failed}
          />
          <div className="settings-body">
            {page !== 'features' && (
              <SettingsPreview
                page={page}
                form={editor.form}
                dirty={editor.dirty}
                features={features}
                surfaces={surfaces}
                model={model}
                tasks={tasks.state}
                view={view}
                live={live}
              />
            )}
            <div className="settings-form-column">
              <section
                hidden={!featuresVisible}
                data-settings-page="features"
                className="settings-section settings-feature-list"
                aria-label={tr('常用功能')}
              >
                <div id="settings-outline" hidden={!common}>
                  <FeatureSwitch
                    name={tr('大纲')}
                    checked={editor.form?.answerOutlineEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('answerOutlineEnabled', v)}
                  />
                </div>
                <div data-settings-page="next" hidden={!common && page !== 'next'}>
                  <FeatureSwitch
                    name={tr('下一步')}
                    checked={editor.form?.enabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(v) => editor.change('enabled', v)}
                  />
                </div>
                <div data-settings-page="board" hidden={!common && page !== 'board'}>
                  <FeatureSwitch
                    name={tr('看板')}
                    checked={tasks.state?.store.boardEnabled ?? false}
                    disabled={tasks.busy || !tasks.state || !!tasks.state.error}
                    onChange={(boardEnabled) => void tasks.command({ op: 'modules', boardEnabled })}
                  />
                </div>
                <div
                  data-settings-page="model-control"
                  hidden={!common && page !== 'model-control'}
                >
                  <ModelControlSettings
                    live={live}
                    active={common || page === 'model-control'}
                    detailed={page === 'model-control'}
                    onSnapshot={setModel}
                  />
                </div>
                <div id="settings-grokbot" hidden={!common && page !== 'bots'}>
                  <FeatureSwitch
                    name="Grok Bot"
                    actions={<BotSetupInstructions hidden={page !== 'bots'} />}
                    checked={editor.form?.grokbotEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('grokbotEnabled', value)}
                  />
                </div>
                <div id="settings-token-meter" hidden={!common}>
                  <FeatureSwitch
                    name={tr('聊天测速')}
                    checked={editor.form?.tokenMeterEnabled ?? false}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('tokenMeterEnabled', value)}
                  />
                </div>
                <div id="settings-prompt-enhancement" hidden={!common}>
                  <FeatureSwitch
                    name={tr('提示词优化')}
                    checked={editor.form?.promptEnhancementEnabled ?? true}
                    disabled={!live || !editor.form}
                    onChange={(value) => editor.change('promptEnhancementEnabled', value)}
                  />
                </div>
              </section>
              <BotSettings active={page === 'bots'} live={live} editor={editor} />
              <section
                data-settings-page="surfaces"
                hidden={!surfacesVisible}
                className="settings-section settings-common-surface"
              >
                <div hidden={page !== 'appearance'}>
                  <LanguageSettings value={view?.panelPreferences} />
                </div>
                <SurfaceSettings
                  live={live}
                  active={surfacesVisible}
                  desktopSupported={editor.saved?.popoutSupported === true}
                  appearance={view?.panelPreferences}
                  fontBase={view?.panelFontBase}
                  page={page === 'appearance' ? 'appearance' : 'surfaces'}
                  onFeatures={setFeatures}
                  onSnapshot={setSurfaces}
                />
                <div data-settings-page="appearance" hidden={page !== 'appearance'}>
                  <LauncherSettings
                    value={view?.panelPreferences}
                    outsideAvailable={editor.saved?.popoutSupported === true}
                  />
                </div>
              </section>
              <div data-settings-page="terminology" hidden={page !== 'terminology'}>
                <TerminologySettings active={page === 'terminology'} />
              </div>
              <SettingsForm
                editor={editor}
                notify={notify}
                active={['model', 'next', 'features', 'connection'].includes(page)}
              >
                <div hidden={page !== 'next'}>
                  <NextSettings editor={editor} appearance={view?.panelPreferences} />
                </div>
                <div data-settings-page="model" hidden={page !== 'model'}>
                  <ModelSettings editor={editor} />
                </div>
                <div data-settings-page="connection" hidden={page !== 'connection'}>
                  <ConnectionSettings editor={editor} view={view} live={live} notify={notify} />
                </div>
              </SettingsForm>
              <div data-settings-page="board" hidden={page !== 'board'}>
                <TaskSettings tasks={tasks} />
              </div>
              <div data-settings-page="codex-host" hidden={page !== 'codex-host'}>
                <CodexHostSettings live={live} active={page === 'codex-host'} />
              </div>
              <div data-settings-page="performance" hidden={page !== 'performance'}>
                <PerformanceSettings live={live} active={page === 'performance'} />
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
      <footer className="settings-footer">
        <span>Palboo {view?.version || '—'}</span>
        <nav className="settings-external-links" aria-label={tr('Palboo 链接')}>
          <a
            href="https://palboo.0xtotorox.com/"
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
      </footer>
    </div>
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
