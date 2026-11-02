/* [INPUT]: Current local snapshots, saved preferences, shared components and optional isolated example adapters.
 * [OUTPUT]: Interactive product content in its real header/body layout; all actions stay in memory.
 * [POS]: Settings preview adapter; incoming snapshots are copied, preview actions never call hosts or persist edits.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { ProjectedContent } from '../features/projected';
import { Board } from '../features/board/app';
import { type TaskRequest, type TaskState, type BoardViewMode } from '../features/board/api';
import type { BotCatalog } from './bot-settings';
import { BotsView, type BotState } from '../features/bots/view';
import type { ReplyLoader } from '../features/bots/messages';
import { TerminologyView, type Term, type TermData } from '../features/terminology';
import { installTerminology } from '../terminology/host.js';
import { PreviewComposer } from './preview-composer';
import type { PanelSnapshot } from '../shared/contracts';
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
export type FeaturePreviewExample = {
  projection?: (explore: boolean) => PanelSnapshot;
  taskRequest?: TaskRequest;
  terms?: Term[];
  bots?: BotState['snapshot'];
  readBotReply?: ReplyLoader;
  botAction?: (data: Record<string, unknown>) => string;
  onOutlineJump?: (id: string) => void;
};
const theme = `
:host{display:block;min-width:0;font:inherit;color-scheme:inherit;--paper:var(--buddy-surface);--surface:var(--paper);--ink:var(--buddy-text);--muted:var(--buddy-muted);--line:var(--buddy-border);--border:var(--line);--hover:var(--buddy-input);--accent:var(--buddy-focus);--danger:var(--error-foreground);--board-bg:transparent;--csw-text:var(--ink);--csw-muted:var(--muted);--csw-divider:var(--line);--csw-hover:var(--hover);--csw-accent:var(--accent);--csw-item-font:1em;--csw-chrome-font:1em;--csw-next-font:1em;--csw-outline-font:1em;--csw-label-weight:500;--feature-refresh-opacity:1;--board-font-size:1em}
:host>div{height:var(--preview-feature-height,100%);min-height:0}
.feature-view{height:var(--preview-feature-height,100%);max-height:var(--preview-feature-max-height,none);border-radius:12px;background:var(--preview-content-background,var(--paper))}
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
  exampleViewMode,
  exampleRequest,
}: {
  tasks: TaskState | null;
  header: HTMLElement;
  mode: 'current' | 'example';
  exampleViewMode: BoardViewMode;
  exampleRequest?: TaskRequest;
}) {
  const locale = useLocale();
  const signature = JSON.stringify(mode === 'current' ? (tasks ?? null) : null);
  const demo = useMemo(
    () => createDemoTasks(JSON.parse(signature) ?? undefined, exampleViewMode),
    [signature, exampleViewMode],
  );
  const request: TaskRequest = useCallback(
    async <T,>(path: string, body?: unknown) => {
      return (mode === 'example' && exampleRequest ? exampleRequest : demo.request)<T>(path, body);
    },
    [demo, locale, mode, exampleRequest],
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
  example,
}: {
  header: HTMLElement;
  onInsert: (text: string) => void;
  catalog: BotCatalog | null;
  autoSync: boolean;
  mode: 'current' | 'example';
  example?: FeaturePreviewExample;
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
        : (example?.bots ?? {
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
          }),
  };
  return (
    <BotsView
      headerActions={header}
      state={state}
      disabled={false}
      readReply={example?.readBotReply}
      action={(data) => {
        if (example?.botAction) {
          onInsert(example.botAction(data));
          return;
        }
        if (data.action === 'stop') {
          setStopped(true);
          return;
        }
        if (data.action === 'check') {
          onInsert(tr(stopped ? '已停止' : '处理中'));
          return;
        }
        if (data.action === 'followup') {
          onInsert(
            tr('追问「{{agent}}」，沿用本聊天中对该 Bot 的上一次调用和上下文，不要新建会话：', {
              agent: String(data.agent),
            }),
          );
          return;
        }
        onInsert(
          tr('请问「{{selectedBot}}」：帮我检查这个方案。', { selectedBot: String(data.agent) }),
        );
      }}
    />
  );
}

function TermPreview({
  header,
  active,
  exampleEntries,
  source,
  preferences,
}: {
  header: HTMLElement;
  active: boolean;
  exampleEntries?: Term[];
  source?: RefObject<HTMLElement | null>;
  preferences?: Partial<TermData['preferences']>;
}) {
  const locale = useLocale();
  const reading = useRef<Reading>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mastered, setMastered] = useState<string[]>([]);
  const entries = exampleEntries ?? sampleTerms();
  const host = useRef<ReturnType<typeof installTerminology> | null>(null);
  const state = {
    entries,
    preferences: {
      ...preferences,
      favorites,
      mastered,
      enabled: true,
      semantic: false,
      cardMaterial: preferences?.cardMaterial ?? 'matte',
    },
  };
  const latest = useRef(state);
  latest.current = state;
  const action = async (data: Record<string, unknown>) => {
    const id = String(data.id);
    if (data.action === 'favorite') setFavorites((items) => [...new Set([...items, id])]);
    if (data.action === 'unfavorite') setFavorites((items) => items.filter((item) => item !== id));
    if (data.action === 'master') setMastered((items) => [...new Set([...items, id])]);
    if (data.action === 'restore') setMastered((items) => items.filter((item) => item !== id));
    if (data.action === 'locate') host.current?.locate(id, 'preview');
    const next = structuredClone(latest.current);
    if (data.action === 'favorite') next.preferences.favorites = [...new Set([...favorites, id])];
    if (data.action === 'unfavorite')
      next.preferences.favorites = favorites.filter((item) => item !== id);
    if (data.action === 'master') next.preferences.mastered = [...new Set([...mastered, id])];
    if (data.action === 'restore')
      next.preferences.mastered = mastered.filter((item) => item !== id);
    return next;
  };
  const perform = useRef(action);
  perform.current = action;
  useEffect(() => {
    if (!active || !source?.current) return;
    host.current = installTerminology({
      isolated: true,
      request: async (_path: string, data: Record<string, unknown>) => perform.current(data),
      getRoot: () => source.current,
      getExchange: () => ({
        sessionId: 'preview',
        question: '',
        answer: source.current?.textContent || '',
        complete: true,
      }),
      isBusy: () => false,
    });
    return () => {
      host.current?.destroy();
      host.current = null;
    };
  }, [active, source, locale]);
  const signature = JSON.stringify(state);
  useEffect(() => {
    void host.current?.refresh();
  }, [signature]);
  return (
    <TerminologyView
      active={active}
      headerActions={header}
      state={{
        entries,
        preferences: { ...state.preferences, jumpOnClick: !!source },
        involved: entries.map((term) => term.id),
        context: 'preview',
        phase: 'ready',
        message: '',
      }}
      reading={reading.current}
      locked={false}
      followScroll
      action={action}
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
  active = true,
  exampleBoardViewMode = 'merged',
  example,
  draft: controlledDraft,
  onDraftChange,
  composer = true,
  onOutlineJump,
  termSource,
  termPreferences,
}: {
  id: Kind;
  form: EditableSettings | null;
  view: View | null;
  tasks: TaskState | null;
  bots?: BotCatalog | null;
  mode?: 'current' | 'example';
  headerActions?: HTMLElement;
  active?: boolean;
  exampleBoardViewMode?: BoardViewMode;
  example?: FeaturePreviewExample;
  draft?: string;
  onDraftChange?: Dispatch<SetStateAction<string>>;
  composer?: boolean;
  onOutlineJump?: (id: string) => void;
  termSource?: RefObject<HTMLElement | null>;
  termPreferences?: Partial<TermData['preferences']>;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [localDraft, setLocalDraft] = useState('');
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [explore, setExplore] = useState(false);
  const [quick, setQuick] = useState<{ label: string; prompt: string }[] | null>(null);
  const revision = useRef(0);
  // 可选样本仅在 example 模式生效；设置的 current 数据与默认示例保持原有路径。
  const sample = mode === 'example' ? example : undefined;
  const snapshot = structuredClone(sample?.projection?.(explore) ?? sampleProjection(explore));
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
    labelOnly: view?.panelPreferences.ui.labelOnly ?? snapshot.display?.labelOnly ?? true,
    promptClickMode: view?.panelPreferences.ui.promptClickMode ?? 'fill',
  };
  return (
    <div className="preview-feature-content" data-feature={id} data-preview-source={mode}>
      <Surface id={id} headerActions={headerActions}>
        {(header) =>
          id === 'board' ? (
            <BoardPreview
              tasks={tasks}
              header={header}
              mode={mode}
              exampleViewMode={exampleBoardViewMode}
              exampleRequest={sample?.taskRequest}
            />
          ) : id === 'terms' ? (
            <TermPreview
              header={header}
              active={active}
              exampleEntries={sample?.terms}
              source={termSource}
              preferences={termPreferences}
            />
          ) : id === 'bots' ? (
            <BotPreview
              header={header}
              onInsert={(text) => {
                if (text)
                  setDraft((previous) =>
                    previous.includes(text) ? previous : previous ? `${previous}\n${text}` : text,
                  );
              }}
              catalog={bots}
              mode={mode}
              autoSync={form?.grokbotAutoSync ?? true}
              example={sample}
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
                  if (text)
                    setDraft((previous) =>
                      previous.includes(text) ? previous : previous ? `${previous}\n${text}` : text,
                    );
                }
                if (kind === 'outline-jump' || kind === 'outline-anchor') {
                  const item =
                    kind === 'outline-jump'
                      ? snapshot.outlineItems.find((item) => item.id === data?.id)
                      : data?.anchor === 'end'
                        ? snapshot.outlineItems.at(-1)
                        : snapshot.outlineItems[0];
                  const jump = onOutlineJump ?? sample?.onOutlineJump;
                  if (jump && item) jump(item.id);
                  else setDraft(item?.text || '');
                }
              }}
            />
          )
        }
      </Surface>
      {composer && (!headerActions || draft) && ['next', 'prompts', 'bots'].includes(id) && (
        <PreviewComposer value={draft} onValueChange={setDraft} />
      )}
    </div>
  );
}
