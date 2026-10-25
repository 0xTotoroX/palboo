import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Task sync conflict or missing-remote snapshot and command handler.
 * [OUTPUT]: Conditional inline recovery choices; no task detail editor.
 * [POS]: Board-only exception handling. [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { Icon } from '../../shared/icons/react';
import type { Fields, Task } from './api';
export function Recovery({
  task,
  busy,
  command,
}: {
  task: Task;
  busy: boolean;
  command: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  useLocale();
  const action = (data: Record<string, unknown>) =>
    command({ id: task.id, expectedTask: task, ...data });
  return (
    <details className="task-recovery">
      <summary className="attention">
        <Icon name="warning" />
        {tr('需要处理')}
      </summary>
      {task.conflict && (
        <section className="recovery">
          <h3>{tr('两端修改需要选择')}</h3>
          <p>{tr('不同字段已自动合并。下列字段在两端同时改变：')}</p>
          {task.conflict.fields.map((key) => (
            <div key={key} className="conflict-values">
              <strong>
                {(
                  {
                    title: tr('标题'),
                    notes: tr('备注'),
                    due: tr('截止日期'),
                    priority: tr('优先级'),
                    column: tr('阶段'),
                    completed: tr('完成状态'),
                    delete: tr('删除'),
                  } as Record<string, string>
                )[key] ?? key}
              </strong>
              <p>
                {tr('本地：')}
                {key === 'delete'
                  ? tr('请求永久删除')
                  : JSON.stringify(task.fields[key as keyof Fields])}
              </p>
              <p>
                Apple：
                {key === 'delete'
                  ? tr('任务已修改')
                  : JSON.stringify(task.conflict!.remote.fields[key as keyof Fields])}
              </p>
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              disabled={busy || task.deleteRequested}
              onClick={() => void action({ op: 'resolve', choice: 'local' })}
            >
              {tr('保留本地修改')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action({ op: 'resolve', choice: 'remote' })}
            >
              {tr('使用 Apple 版本')}
            </button>
          </div>
        </section>
      )}
      {task.remoteMissing && (
        <section className="recovery">
          <h3>{tr('Apple 任务已删除、移动或身份待核对')}</h3>
          <p>{tr('内容已保留。请先在提醒事项中检查原任务，恢复同步会创建一条新提醒。')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(tr('已检查 Apple 提醒事项，确认要创建一条新的提醒？')))
                void action({ op: 'restore', confirmNew: true });
            }}
          >
            {tr('创建新提醒并恢复同步')}
          </button>
        </section>
      )}
    </details>
  );
}
