/* [INPUT]: Current local task/Bot snapshots, saved presentation preferences and shared feature components.
 * [OUTPUT]: Interactive product content in its real header/body layout; all actions stay in memory.
 * [POS]: Settings preview adapter; incoming snapshots are copied, preview actions never call hosts or persist edits.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ProjectedContent } from '../features/projected';
import { Board } from '../features/board/app';
import { type TaskRequest, type TaskState } from '../features/board/api';
import type { BotCatalog } from './bot-settings';
import { BotsView, type BotState } from '../features/bots/view';
import { TerminologyView } from '../features/terminology';
import { sampleProjection, sampleTerms, createDemoTasks } from '../shared/demo-state';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { featureIcons, titles, type Reading } from '../shared/features';
import { Icon } from '../shared/icons/react';
import type { EditableSettings, View } from './api';
import surfaceStyles from '../surfaces/workspace/content.css?inline';
import workspaceStyles from '../surfaces/workspace/styles.css?inline';
import contentStyles from '../features/content.css?inline';
import boardStyles from '../features/board/styles.css?inline';
import botStyles from '../features/bots/style.css?inline';

type Kind = 'outline' | 'next' | 'prompts' | 'board' | 'bots' | 'terms';
const theme = `
:host{display:block;min-width:0;font:inherit;color-scheme:inherit;--paper:var(--buddy-surface);--surface:var(--paper);--ink:var(--buddy-text);--muted:var(--buddy-muted);--line:var(--buddy-border);--border:var(--line);--hover:var(--buddy-input);--accent:var(--buddy-focus);--danger:var(--error-foreground);--board-bg:transparent;--csw-text:var(--ink);--csw-muted:var(--muted);--csw-divider:var(--line);--csw-hover:var(--hover);--csw-accent:var(--accent);--csw-item-font:1em;--csw-chrome-font:1em;--csw-next-font:1em;--csw-outline-font:1em;--csw-label-weight:500;--feature-refresh-opacity:1;--board-font-size:1em}
:host>div{height:var(--preview-feature-height,100%);min-height:0}
.feature-view{height:var(--preview-feature-height,100%);max-height:var(--preview-feature-max-height,none);border-radius:12px}
:host([data-contained=true]) .feature-view{background:transparent;border-radius:0}
.feature-view:is([data-feature=bots],[data-feature=prompts]){height:var(--preview-feature-height,auto);max-height:var(--preview-feature-max-height,270px)}
.feature-view:is([data-feature=bots],[data-feature=prompts])>.feature-body{flex:var(--preview-feature-body-flex,0 1 auto);min-height:0;overflow:auto}
.csw-feature-pane-head{flex:none}
.preview-feature-icon{display:grid;place-items:center;width:28px;height:28px}
.preview-feature-icon svg{width:18px;height:18px}
.feature-projection button{border:0}
.feature-view:hover .csw-outline-toolbar,.csw-outline-toolbar:focus-within{opacity:1;pointer-events:auto;transform:none}
@media(hover:hover) and (pointer:fine){:host{--feature-refresh-opacity:0}:host(:hover),:host(:focus-within){--feature-refresh-opacity:1}}
`;
const styles = `${boardStyles.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.board-app {')}\n${workspaceStyles}\n${surfaceStyles}\n${contentStyles}\n${botStyles}\n${theme}`;

function Surface({
  id,
  children,
  headerActions,
}: {
  id: Kind;
  children: (header: HTMLElement) => ReactNode;
  headerActions?: HTMLElement;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [mount] = useState(() => document.createElement('div'));
  const [actions] = useState(() => document.createElement('span'));
  useLayoutEffect(() => {
    const root = host.current!.shadowRoot || host.current!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    root.replaceChildren(style, mount);
    return () => root.replaceChildren();
  }, [mount, styles]);
  return (
    <div
      className="preview-feature-surface"
      ref={host}
      data-settings-feature={id}
      data-contained={!!headerActions}
    >
      {createPortal(
        <section className="feature-view" data-feature={id} aria-label={titles[id]}>
          {!headerActions && (
            <header className="csw-feature-pane-head">
              <nav className="csw-workbench-tabs" aria-label={titles[id]}>
                <span className="preview-feature-icon" aria-hidden="true">
                  <Icon name={featureIcons[id]} />
                </span>
              </nav>
              <div
                className="csw-feature-header-actions"
                ref={(node) => {
                  if (node) node.append(actions);
                }}
              />
            </header>
          )}
          <div className="feature-body">{children(headerActions ?? actions)}</div>
        </section>,
        mount,
      )}
    </div>
  );
}

function BoardPreview({
  tasks,
  header,
  mode,
}: {
  tasks: TaskState | null;
  header: HTMLElement;
  mode: 'current' | 'example';
}) {
  const locale = useLocale();
  const signature = JSON.stringify(mode === 'current' ? (tasks ?? null) : null);
  const demo = useMemo(() => createDemoTasks(JSON.parse(signature) ?? undefined), [signature]);
  const request: TaskRequest = useCallback(
    async <T,>(path: string, body?: unknown) => {
      return demo.request<T>(path, body);
    },
    [demo, locale],
  );
  if (mode === 'current' && !tasks) return <p role="status">{tr('正在读取本地任务…')}</p>;
  return <Board embedded poll={false} headerActions={header} request={request} />;
}

function BotPreview({
  header,
  onInsert,
  catalog,
  autoSync,
  mode,
}: {
  header: HTMLElement;
  onInsert: (text: string) => void;
  catalog: BotCatalog | null;
  autoSync: boolean;
  mode: 'current' | 'example';
}) {
  useLocale();
  const [stopped, setStopped] = useState(false);
  const state: BotState = {
    autoSync,
    snapshot:
      mode === 'current'
        ? catalog
          ? {
              target: { threadId: 'settings-preview', token: 'example' },
              catalog: {
                revision: 'preview',
                stale: catalog.stale,
                error: catalog.error,
                sidebar: catalog.sidebar,
                sidebarError: catalog.sidebarError,
              },
              bots: catalog.bots.map(({ id, name, description, hidden, available, avatar }) => ({
                id,
                name,
                description,
                hidden,
                available,
                avatar,
                occupied: false,
                current: null,
              })),
            }
          : null
        : {
            target: { threadId: 'settings-preview', token: 'example' },
            catalog: { revision: 'example', stale: false },
            bots: [
              {
                id: 'review',
                name: tr('代码审查'),
                avatar: { shape: 'circle', color: 'black' },
                occupied: false,
                current: { key: 'example', status: stopped ? 'interrupted' : 'running' },
                preview: tr('检查输入、异常和兼容情况。'),
              },
              {
                id: 'research',
                name: tr('资料整理'),
                avatar: { shape: 'circle', color: 'violet' },
                occupied: false,
                unread: true,
                current: { key: 'example-2', status: 'finished' },
                preview: tr('把已选方案分解成可执行的步骤。'),
              },
              {
                id: 'general',
                name: tr('通用'),
                avatar: { shape: 'circle', color: 'green' },
                occupied: false,
                current: null,
              },
            ],
          },
  };
  return (
    <BotsView
      headerActions={header}
      state={state}
      disabled={false}
      action={(data) => {
        if (data.action === 'stop') {
          setStopped(true);
          return;
        }
        if (data.action === 'check') {
          onInsert(tr(stopped ? '已停止' : '处理中'));
          return;
        }
        onInsert(
          tr('请问「{{selectedBot}}」：帮我检查这个方案。', { selectedBot: String(data.agent) }),
        );
      }}
    />
  );
}

function TermPreview({ header }: { header: HTMLElement }) {
  useLocale();
  const reading = useRef<Reading>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mastered, setMastered] = useState<string[]>([]);
  const entries = sampleTerms();
  return (
    <TerminologyView
      headerActions={header}
      state={{
        entries,
        preferences: { favorites, mastered, cardMaterial: 'matte' },
        involved: entries.map((term) => term.id),
        context: 'preview',
        phase: 'ready',
        message: '',
      }}
      reading={reading.current}
      locked={false}
      followScroll
      action={async (data) => {
        const id = String(data.id);
        if (data.action === 'favorite') setFavorites((items) => [...new Set([...items, id])]);
        if (data.action === 'unfavorite')
          setFavorites((items) => items.filter((item) => item !== id));
        if (data.action === 'master') setMastered((items) => [...new Set([...items, id])]);
        if (data.action === 'restore') setMastered((items) => items.filter((item) => item !== id));
        return {};
      }}
    />
  );
}

export function FeaturePreviewContent({
  id,
  form,
  view,
  tasks,
  bots = null,
  mode = 'example',
  headerActions,
}: {
  id: Kind;
  form: EditableSettings | null;
  view: View | null;
  tasks: TaskState | null;
  bots?: BotCatalog | null;
  mode?: 'current' | 'example';
  headerActions?: HTMLElement;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [draft, setDraft] = useState('');
  const [explore, setExplore] = useState(false);
  const [quick, setQuick] = useState<{ label: string; prompt: string }[] | null>(null);
  const revision = useRef(0);
  const snapshot = sampleProjection(explore);
  const limit =
    form?.directionSource === 'manual' ? form.selectedDirections.length : (form?.maxItems ?? 3);
  snapshot.prompts = snapshot.prompts.slice(0, Math.max(0, limit));
  snapshot.settings.quickPrompts = quick || form?.quickPrompts || snapshot.settings.quickPrompts;
  snapshot.settings.quickPromptLabelOnly = form?.quickPromptLabelOnly ?? false;
  snapshot.settings.quickPromptsEnabled =
    form?.quickPromptsEnabled ?? snapshot.settings.quickPromptsEnabled;
  snapshot.settings.quickPromptClickMode =
    form?.quickPromptClickMode ?? snapshot.settings.quickPromptClickMode;
  snapshot.settings.configurationRevision = revision.current;
  snapshot.display = {
    ...snapshot.display,
    labelOnly: view?.panelPreferences.ui.labelOnly ?? true,
    promptClickMode: view?.panelPreferences.ui.promptClickMode ?? 'fill',
  };
  return (
    <div className="preview-feature-content" data-feature={id} data-preview-source={mode}>
      <Surface id={id} headerActions={headerActions}>
        {(header) =>
          id === 'board' ? (
            <BoardPreview tasks={tasks} header={header} mode={mode} />
          ) : id === 'terms' ? (
            <TermPreview header={header} />
          ) : id === 'bots' ? (
            <BotPreview
              header={header}
              onInsert={setDraft}
              catalog={bots}
              mode={mode}
              autoSync={form?.grokbotAutoSync ?? true}
            />
          ) : (
            <ProjectedContent
              id={id}
              snapshot={snapshot}
              reading={reading.current}
              disabled={false}
              headerActions={header}
              saveQuickPrompts={async (items) => {
                revision.current++;
                setQuick(items);
                return {
                  ...snapshot.settings,
                  configurationRevision: revision.current,
                  quickPrompts: items,
                };
              }}
              command={async (kind, data) => {
                if (kind === 'generate') setExplore((value) => !value);
                if (kind === 'fill' || kind === 'quick-fill') {
                  const items = kind === 'fill' ? snapshot.prompts : snapshot.settings.quickPrompts;
                  const text = items[data?.index ?? 0]?.prompt;
                  if (text) setDraft((previous) => (previous ? `${previous}\n${text}` : text));
                }
                if (kind === 'outline-jump')
                  setDraft(snapshot.outlineItems.find((item) => item.id === data?.id)?.text || '');
                if (kind === 'outline-anchor')
                  setDraft(
                    (data?.anchor === 'end'
                      ? snapshot.outlineItems.at(-1)
                      : snapshot.outlineItems[0]
                    )?.text || '',
                  );
              }}
            />
          )
        }
      </Surface>
      {draft && (
        <div className="preview-draft" role="status" aria-label={tr('示例输入框')}>
          {draft}
        </div>
      )}
    </div>
  );
}
