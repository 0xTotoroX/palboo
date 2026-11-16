import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Task API, native window events, drag/drop components, optional surface header slot and polling policy.
 * [OUTPUT]: Shared board/list presentation with explicit search/add disclosure, retained drafts and existing task identities.
 * [POS]: Task-only application entry; no Codex/model dependencies.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../shared/icons/react';
import { createPortal } from 'react-dom';
import {
  columns as defaults,
  columnTitle,
  emptyFields,
  taskGroup,
  useTasks,
  type Task,
  type TaskRequest,
} from './api';
import { TaskDetails, type TaskDraft } from './details';
import { Column, TaskCard, taskDragOver, taskDrop } from './card';
import { Checklist } from './checklist';
import { TaskSearch } from './search';
export type BoardView = {
  editor?: TaskDraft | null;
  search: string;
  searchOpen?: boolean;
  listAdding?: boolean;
  stage: string;
  tab: string;
  gridLeft?: number;
  quickAdd?: { column: string; title: string } | null;
  completed?: boolean;
};
export function Board({
  request,
  embedded = false,
  locked = false,
  view,
  headerActions,
  poll = true,
}: {
  poll?: boolean;
  headerActions?: HTMLElement;
  request: TaskRequest;
  embedded?: boolean;
  locked?: boolean;
  view?: BoardView;
}) {
  useLocale();
  const { state, error, busy: taskBusy, command } = useTasks(poll, request);
  const busy = taskBusy || locked;
  const element = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const merged = state?.store.viewMode !== 'expanded';
  const list = state?.store.displayMode === 'list';
  const [history, setHistory] = useState(view?.completed ?? false);
  const [settling, setSettling] = useState(false);
  const historyButton = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const returnSearchFocus = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState(view?.tab === 'archive' ? 'done' : view?.stage || 'todo');
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 680));
    observer.observe(node);
    return () => observer.disconnect();
  }, [!!state, state?.store.boardEnabled]);
  const tab = 'board';
  const [search, setSearch] = useState(view?.search ?? '');
  const [searchOpen, setSearchOpen] = useState(view?.searchOpen === true);
  useLayoutEffect(() => {
    if (!searchOpen && returnSearchFocus.current) {
      searchButtonRef.current?.focus({ preventScroll: true });
      returnSearchFocus.current = false;
    }
  }, [searchOpen]);
  const [quickAdd, setQuickAdd] = useState(view?.quickAdd ?? null);
  const [listAdding, setListAdding] = useState(
    !view?.searchOpen && (view?.listAdding ?? !!view?.quickAdd?.title),
  );
  const [draft, setDraft] = useState<TaskDraft | null>(
    view?.editor?.task?.id && view.editor.fields ? view.editor : null,
  );
  function updateDraft(next: TaskDraft | null) {
    if (view) view.editor = next;
    setDraft(next);
  }
  const [dropTab, setDropTab] = useState('');
  const columns = (state?.store.columns ?? defaults).map((column) => ({
    ...column,
    title: columnTitle(column),
  }));
  useEffect(() => {
    if (!columns.some((c) => c.id === stage)) setStage(columns[0]?.id || 'todo');
  }, [columns, stage]);
  useEffect(() => {
    if (view)
      Object.assign(view, {
        search,
        searchOpen,
        listAdding,
        stage,
        tab,
        quickAdd,
        editor: draft,
        completed: history,
      });
  }, [view, search, searchOpen, listAdding, stage, tab, quickAdd, draft, history]);
  useEffect(() => {
    const resize = (e: Event) => {
      void request('tasks/command', { op: 'windowSize', size: (e as CustomEvent).detail }).catch(
        () => {},
      );
    };
    window.addEventListener('board-size', resize);
    return () => window.removeEventListener('board-size', resize);
  }, [request]);
  useEffect(() => {
    const grid = element.current?.querySelector<HTMLElement>('.board-grid');
    if (grid && !narrow && !merged) grid.scrollLeft = view?.gridLeft || 0;
  }, [narrow, merged, tab, state?.store.tasks.length, view]);
  const move = useCallback(
    (id: string, column: string, before?: string) => {
      const task = state?.store.tasks.find((t) => t.id === id);
      if (!task || busy || id === before) return;
      const fields = {
        ...task.fields,
        completed: column === 'done',
        column: column === 'done' ? task.fields.column : column,
      };
      void command({ op: 'update', id, fields, before, archived: false, expectedTask: task });
    },
    [state, busy, command],
  );
  if (!state)
    return (
      <main className="loading">
        <h1>{tr('任务看板')}</h1>
        <p role="status">{error || tr('正在读取本地任务…')}</p>
      </main>
    );
  if (!state.store.boardEnabled)
    return <div className="loading">{tr('任务看板已停用，请在设置页开启。')}</div>;
  const tasks = state.store.tasks;
  const visible = tasks.filter(
    (t) =>
      !searchOpen ||
      `${t.fields.title}\n${t.fields.notes}`.toLowerCase().includes(search.toLowerCase()),
  );
  const editTask = (task: Task) => {
    if (draft?.task.id === task.id) return updateDraft({ ...draft, open: true });
    if (
      draft &&
      JSON.stringify(draft.fields) !== JSON.stringify(draft.task.fields) &&
      !confirm(tr('放弃之前未保存的任务修改？'))
    )
      return;
    updateDraft({
      task: structuredClone(task),
      fields: structuredClone(task.fields),
      open: true,
    });
  };
  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      edit={() => editTask(task)}
      disabled={busy || !state.store.boardEnabled || state.store.inflight?.taskId === task.id}
      command={command}
      before={(id) => move(id, taskGroup(task), task.id)}
    />
  );
  const searchButton = (
    <button
      ref={searchButtonRef}
      type="button"
      aria-label={tr('搜索任务')}
      title={tr('搜索任务')}
      aria-expanded={searchOpen}
      onClick={() => {
        setListAdding(false);
        setSearchOpen(true);
      }}
    >
      <Icon name="search" />
    </button>
  );
  const tools = searchOpen ? (
    <TaskSearch
      value={search}
      change={setSearch}
      slot={headerActions}
      dismissEmpty={() => setSearchOpen(false)}
      close={() => {
        returnSearchFocus.current = true;
        setSearch('');
        setSearchOpen(false);
      }}
    />
  ) : (
    <>
      {list && !history && (
        <button
          ref={addButton}
          type="button"
          aria-label={tr('添加待办')}
          title={tr('添加待办')}
          aria-expanded={listAdding}
          disabled={busy || settling}
          onMouseDown={(event) => {
            // Keep an empty input's blur dismissal from reopening it on this same click.
            if (listAdding) event.preventDefault();
          }}
          onClick={() => {
            setListAdding(!listAdding);
            if (listAdding) addButton.current?.focus({ preventScroll: true });
            else setQuickAdd((current) => current ?? { column: 'todo', title: '' });
          }}
        >
          <Icon name="plus" />
        </button>
      )}
      {searchButton}
      {list && (
        <button
          ref={historyButton}
          type="button"
          aria-label={tr(history ? '返回待办' : '查看已完成')}
          title={tr(history ? '返回待办' : '查看已完成')}
          disabled={busy || settling}
          onClick={() => setHistory(!history)}
        >
          <Icon name={history ? 'back' : 'task-completed'} />
        </button>
      )}
    </>
  );
  const addTask = (column: string) =>
    quickAdd?.column === column ? (
      <form
        className="quick-add"
        onSubmit={(event) => {
          event.preventDefault();
          void command({
            op: 'create',
            fields: {
              ...emptyFields(),
              title: quickAdd.title.trim(),
              column: column === 'done' ? 'todo' : column,
              completed: column === 'done',
            },
          }).then((ok) => {
            if (ok) setQuickAdd(null);
          });
        }}
      >
        <input
          autoFocus
          aria-label={tr('新任务标题')}
          placeholder={tr('任务标题')}
          maxLength={1000}
          value={quickAdd.title}
          disabled={busy}
          onChange={(e) => setQuickAdd({ column, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuickAdd(null);
          }}
        />
        <div>
          <button disabled={busy || !quickAdd.title.trim()} type="submit">
            {tr('添加')}
          </button>
          <button disabled={busy} type="button" onClick={() => setQuickAdd(null)}>
            {tr('取消')}
          </button>
        </div>
      </form>
    ) : (
      <button
        className="add-task"
        disabled={busy}
        onClick={() => setQuickAdd({ column, title: '' })}
      >
        <Icon name="plus" />
        {tr('新建任务')}
      </button>
    );
  return (
    <div
      ref={element}
      onScrollCapture={(e) => {
        const node = e.target as HTMLElement;
        if (view && node.classList.contains('board-grid') && node.scrollWidth > node.clientWidth)
          view.gridLeft = node.scrollLeft;
      }}
      className={`board-app ${embedded ? 'embedded' : ''}`}
      data-view-mode={list ? 'list' : merged ? 'merged' : 'expanded'}
      data-completed-view={(list && history) || undefined}
      data-intrinsic-width={list ? 'content' : undefined}
    >
      {!list && <span className="board-intrinsic-size" data-intrinsic-width hidden />}
      {!embedded && (
        <header className="board-header">
          <h1>{tr(list ? (history ? '已完成' : '待办事项') : '我的任务看板')}</h1>
        </header>
      )}
      {draft && (
        <TaskDetails
          draft={draft}
          current={state.store.tasks.find((t) => t.id === draft.task.id)}
          busy={busy || state.store.inflight?.taskId === draft.task.id}
          error={error}
          syncEnabled={state.store.syncEnabled}
          change={(fields) => updateDraft({ ...draft, fields })}
          close={() => updateDraft({ ...draft, open: false })}
          reload={() => {
            const task = state.store.tasks.find((t) => t.id === draft.task.id);
            if (task && confirm(tr('丢弃未保存修改并载入最新任务？')))
              updateDraft({
                task: structuredClone(task),
                fields: structuredClone(task.fields),
                open: true,
              });
          }}
          save={() => {
            void command({
              op: 'update',
              id: draft.task.id,
              expectedTask: draft.task,
              fields: { ...draft.fields, title: draft.fields.title.trim() },
            }).then((result) => {
              if (result) updateDraft(null);
            });
          }}
        />
      )}
      <main className="board-main">
        {list && !headerActions && (
          <div className="task-list-toolbar">
            <div className="board-tools">{tools}</div>
          </div>
        )}
        {!list && merged && (
          <div className="board-toolbar">
            <nav className="stage-tabs" aria-label={tr('任务阶段')}>
              {columns.map((column) => (
                <button
                  key={column.id}
                  aria-pressed={stage === column.id}
                  className={dropTab === column.id ? 'drop-tab' : ''}
                  onClick={() => setStage(column.id)}
                  onDragOver={(e) => {
                    if (!busy && taskDragOver(e)) setDropTab(column.id);
                  }}
                  onDragLeave={() => setDropTab('')}
                  onDrop={(e) => {
                    setDropTab('');
                    if (!busy)
                      taskDrop(e, (id) => {
                        move(id, column.id);
                        setStage(column.id);
                      });
                  }}
                >
                  {column.title}
                </button>
              ))}
            </nav>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {state.store.inflight?.action === 'create' && (
          <div className="recovery">
            <strong>{tr('创建结果待确认')}</strong>
            <p>{tr('请先在 Apple 提醒事项中检查。同步会尝试找到此前创建的任务，不会盲目重建。')}</p>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(tr('确认已核对 Apple 提醒事项？此次操作将保留并归档本地记录，停止重试。'))
                )
                  void command({ op: 'uncertain', confirmChecked: true });
              }}
            >
              {tr('已核对，归档并停止重试')}
            </button>
          </div>
        )}
        {list ? (
          <Checklist
            tasks={visible}
            history={history}
            busy={busy}
            inflight={state.store.inflight?.taskId}
            command={command}
            edit={editTask}
            title={quickAdd?.title ?? ''}
            adding={listAdding}
            setTitle={(title) => setQuickAdd({ column: 'todo', title })}
            dismissEmpty={() => setListAdding(false)}
            finishAdding={() => {
              setListAdding(false);
              setQuickAdd(null);
              addButton.current?.focus({ preventScroll: true });
            }}
            focusFallback={() =>
              (addButton.current ?? historyButton.current)?.focus({ preventScroll: true })
            }
            setSettling={setSettling}
          />
        ) : (
          <div
            className={`board-grid ${merged ? 'narrow' : narrow ? 'stacked' : ''}`}
            style={
              narrow || merged
                ? undefined
                : { gridTemplateColumns: `repeat(${columns.length}, minmax(210px, 1fr))` }
            }
          >
            {(merged ? columns.filter((column) => column.id === stage) : columns).map((column) => {
              const group = visible.filter((t) => taskGroup(t) === column.id);
              return (
                <Column
                  key={column.id}
                  {...column}
                  disabled={busy}
                  move={move}
                  heading={
                    <>
                      <span className="group-title">{column.title}</span>
                      <small>{group.length}</small>
                    </>
                  }
                >
                  {group.map(card)}
                  {addTask(column.id)}
                </Column>
              );
            })}
          </div>
        )}
        {headerActions && createPortal(tools, headerActions)}
        {!headerActions && !list && (
          <footer className="board-footer">
            <div className="board-tools">{tools}</div>
          </footer>
        )}
      </main>
    </div>
  );
}
