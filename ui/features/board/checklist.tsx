/* [INPUT]: 同一任务存储的有序投影、保存命令、详情入口、新建草稿及空输入失焦回调。
 * [OUTPUT]: 扁平清单、完成划线/收走、图标恢复及主动展开的无底板添加行；失败保留原任务。
 * [POS]: 看板的另一种呈现，不迁移任务、分组或同步身份。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tr } from '../../shared/i18n.js';
import { Icon } from '../../shared/icons/react';
import { emptyFields, taskGroup, type Task } from './api';
import { Recovery } from './recovery';

type Command = (data: Record<string, unknown>) => Promise<unknown>;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function Checklist({
  tasks,
  history,
  busy,
  inflight,
  command,
  edit,
  title,
  adding,
  searching,
  setTitle,
  dismissEmpty,
  finishAdding,
  focusFallback,
  setSettling,
}: {
  tasks: Task[];
  history: boolean;
  busy: boolean;
  inflight?: string;
  command: Command;
  edit: (task: Task) => void;
  title: string;
  adding: boolean;
  searching: boolean;
  setTitle: (title: string) => void;
  dismissEmpty: () => void;
  finishAdding: () => void;
  focusFallback: () => void;
  setSettling: (busy: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const addForm = useRef<HTMLFormElement>(null);
  const wasAdding = useRef(adding);
  const [finishing, setFinishing] = useState<Task | null>(null);
  const [composing, setComposing] = useState(false);
  const alive = useRef(true),
    locked = useRef(false),
    animations = useRef(new Set<Animation>());
  const positions = useRef<Map<string, number> | null>(null);
  const focusNext = useRef<{ index: number; origin: Element | null } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setSettling(false);
      animations.current.forEach((animation) => animation.cancel());
      animations.current.clear();
    };
  }, []);
  useLayoutEffect(() => {
    const form = addForm.current;
    const opened = !wasAdding.current && adding;
    wasAdding.current = adding;
    if (
      !opened ||
      !form ||
      reducedMotion() ||
      document.documentElement.dataset.settingsReducedMotion === 'true' ||
      document.documentElement.dataset.settingsInput === 'keyboard'
    )
      return;
    const animation = form.animate(
      [
        { opacity: 0, transform: 'translateY(-3px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 170, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    animations.current.add(animation);
    const cleanup = () => {
      animation.cancel();
      animations.current.delete(animation);
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    media.addEventListener('change', cleanup);
    window.addEventListener('settings-motion-change', cleanup);
    window.addEventListener('keydown', cleanup, true);
    animation.addEventListener('finish', () => animations.current.delete(animation), {
      once: true,
    });
    return () => {
      cleanup();
      media.removeEventListener('change', cleanup);
      window.removeEventListener('settings-motion-change', cleanup);
      window.removeEventListener('keydown', cleanup, true);
    };
  }, [adding]);
  const rows = tasks.filter(
    (task) => task.id === finishing?.id || (taskGroup(task) === 'done') === history,
  );
  if (finishing && !rows.some((task) => task.id === finishing.id)) rows.push(finishing);
  function capture() {
    positions.current = new Map(
      [...(root.current?.querySelectorAll<HTMLElement>('[data-list-task]') || [])].map((node) => [
        node.dataset.listTask!,
        node.getBoundingClientRect().top,
      ]),
    );
  }
  function animate(node: HTMLElement, frames: Keyframe[], duration: number) {
    const animation = node.animate(frames, {
      duration,
      easing: 'cubic-bezier(.16,1,.3,1)',
      fill: 'both',
    });
    animations.current.add(animation);
    return animation.finished
      .catch(() => {})
      .finally(() => {
        animation.cancel();
        animations.current.delete(animation);
      });
  }
  useLayoutEffect(() => {
    const previous = positions.current;
    positions.current = null;
    if (previous && !reducedMotion())
      root.current?.querySelectorAll<HTMLElement>('[data-list-task]').forEach((node) => {
        const before = previous.get(node.dataset.listTask!);
        const delta = before === undefined ? 0 : before - node.getBoundingClientRect().top;
        if (delta)
          void animate(node, [{ transform: `translateY(${delta}px)` }, { transform: 'none' }], 220);
      });
    if (focusNext.current !== null) {
      const { index, origin } = focusNext.current;
      focusNext.current = null;
      const document = root.current?.ownerDocument;
      let active = document?.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const host = (root.current?.getRootNode() as ShadowRoot)?.host;
      // A delayed save must not pull focus back after the user starts another action.
      if (active && active !== origin && active !== document?.body && active !== host) return;
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('.task-list-toggle');
      const target =
        buttons?.[Math.min(index, buttons.length - 1)] ||
        root.current?.querySelector<HTMLInputElement>('.task-list-add input');
      if (target) target.focus({ preventScroll: true });
      else focusFallback();
    }
  });
  async function toggle(task: Task, node: HTMLElement) {
    if (busy || locked.current) return;
    locked.current = true;
    const completing = !history,
      started = performance.now();
    const active = (node.getRootNode() as Document | ShadowRoot).activeElement;
    const index = rows.findIndex((row) => row.id === task.id);
    const moveFocus = !!active && node.contains(active);
    setFinishing(task);
    setSettling(true);
    // 与动效并行保存；仅确认成功才收走，重复/冲突提醒保持原有后端保护。
    const result = await command({
      op: 'update',
      id: task.id,
      expectedTask: task,
      fields: { ...task.fields, completed: completing },
      archived: false,
    });
    if (!alive.current) return;
    if (result && completing && !reducedMotion()) {
      const wait = Math.max(0, 280 - (performance.now() - started));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (alive.current && node.isConnected)
        await animate(
          node,
          [
            { opacity: 1, clipPath: 'inset(0)' },
            { opacity: 0, clipPath: 'inset(0 0 0 100%)' },
          ],
          180,
        );
    }
    if (!alive.current) return;
    if (result) {
      capture();
      if (moveFocus) focusNext.current = { index, origin: active };
    }
    locked.current = false;
    setFinishing(null);
    setSettling(false);
  }
  async function remove(task: Task, node: HTMLElement) {
    if (busy || locked.current) return;
    locked.current = true;
    setSettling(true);
    const active = (node.getRootNode() as Document | ShadowRoot).activeElement;
    const moveFocus = !!active && node.contains(active);
    const index = rows.findIndex((row) => row.id === task.id);
    const result = await command({ op: 'remove', id: task.id, expectedTask: task });
    if (!alive.current) return;
    locked.current = false;
    if (result && moveFocus) focusNext.current = { index, origin: active };
    setSettling(false);
  }
  return (
    <div className="task-list" ref={root} data-busy={busy || !!finishing || undefined}>
      {!rows.length && (history || !adding) && (
        <div className="task-list-empty" role="status">
          {tr(searching ? '没有匹配的任务' : history ? '暂无已完成任务' : '暂无待办')}
        </div>
      )}
      <ul className="task-list-rows" aria-label={tr(history ? '已完成' : '待办事项')}>
        {rows.map((task) => {
          const completing = !history && finishing?.id === task.id;
          const completed = history || completing;
          const readonly =
            busy ||
            !!finishing ||
            inflight === task.id ||
            task.remoteMissing ||
            !!task.conflict ||
            !!task.remote?.recurring;
          return (
            <li
              key={task.id}
              data-list-task={task.id}
              data-completing={completing || undefined}
              data-completed={completed || undefined}
            >
              <div className="task-list-row">
                <button
                  type="button"
                  className="task-list-toggle"
                  role="checkbox"
                  aria-checked={completed}
                  aria-label={tr(history ? '恢复任务：{{value1}}' : '完成任务：{{value1}}', {
                    value1: task.fields.title,
                  })}
                  title={
                    task.remote?.recurring
                      ? tr('重复提醒请在 Apple 提醒事项中编辑，本地只读')
                      : history
                        ? tr('恢复任务')
                        : undefined
                  }
                  disabled={readonly}
                  onClick={(event) => void toggle(task, event.currentTarget.closest('li')!)}
                >
                  <span className="task-list-circle">{completed && <Icon name="check" />}</span>
                </button>
                <button
                  type="button"
                  className="task-list-title"
                  disabled={busy || !!finishing}
                  aria-label={tr('任务详情：{{value1}}', { value1: task.fields.title })}
                  onClick={() => edit(task)}
                >
                  <span>{task.fields.title}</span>
                </button>
                {!history && (
                  <button
                    type="button"
                    className="task-list-action task-list-delete"
                    aria-label={tr('删除任务：{{value1}}', { value1: task.fields.title })}
                    title={tr('删除任务')}
                    disabled={busy || !!finishing || inflight === task.id}
                    onClick={(event) => void remove(task, event.currentTarget.closest('li')!)}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              {(task.conflict || task.remoteMissing) && (
                <Recovery task={task} busy={busy} command={command} />
              )}
            </li>
          );
        })}
      </ul>
      {!history && adding && (
        <form
          ref={addForm}
          className="task-list-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || finishing || composing || !title.trim()) return;
            void command({ op: 'create', fields: { ...emptyFields(), title: title.trim() } }).then(
              (result) => {
                if (result) finishAdding();
              },
            );
          }}
        >
          <button
            type="submit"
            className="task-list-add-icon"
            aria-label={tr('保存待办')}
            title={tr('保存待办')}
            disabled={busy || !!finishing || !title.trim() || composing}
          >
            <Icon name={title.trim() ? 'check' : 'plus'} />
          </button>
          <input
            autoFocus
            aria-label={tr('添加待办')}
            placeholder={tr('添加待办')}
            maxLength={1000}
            value={title}
            data-editing={!!title.trim() || composing}
            disabled={busy || !!finishing}
            onChange={(event) => setTitle(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onBlur={() => {
              setComposing(false);
              if (!title.trim() && !composing) dismissEmpty();
            }}
            onKeyDown={(event) => {
              if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                if (event.key === 'Enter') event.preventDefault();
                return;
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                finishAdding();
              }
            }}
          />
        </form>
      )}
    </div>
  );
}
