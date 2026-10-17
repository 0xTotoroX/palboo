/* [INPUT]: Feature identity, business envelope, guarded transport, reading state and optional header slot.
 * [OUTPUT]: The five feature views and guarded business adapters, including revision-checked quick-prompt saves.
 * [POS]: Fixed feature composition; persistence and validation remain in existing services.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useCallback, useRef } from 'react';
import { Board } from './board/app';
import { TerminologyView, type TermData } from './terminology';
import type { TaskRequest } from './board/api';
import { ModelView, type ModelState } from './model/view';
import { ProjectedContent } from './projected';
import type { PanelSnapshot, PanelCommand, CommandResult } from '../shared/contracts';
import type { FeatureId, Reading } from '../shared/features';
export type FeatureData = { snapshot?: unknown; [key: string]: unknown };
export type FeatureCall = <T>(op: string, data?: Record<string, unknown>) => Promise<T>;
export type FeatureOperation = <T>(fn: () => Promise<T>, propagate?: boolean) => Promise<T | null>;
export function contentToken(id: FeatureId, value: FeatureData) {
  if (!['outline', 'next'].includes(id) || !value.snapshot) return null;
  const snapshot = value.snapshot as PanelSnapshot;
  return `${snapshot.viewToken}:${id === 'outline' ? snapshot.outlineToken : snapshot.promptToken}`;
}
export function FeatureContent({
  id,
  reading,
  value,
  locked,
  connected,
  call,
  operation,
  update,
  headerActions,
}: {
  headerActions?: HTMLElement;
  id: FeatureId;
  reading: Reading;
  value: FeatureData | null;
  locked: boolean;
  connected: boolean;
  call: FeatureCall;
  operation: FeatureOperation;
  update: (value: FeatureData) => void;
}) {
  const latestValue = useRef(value);
  latestValue.current = value;
  const execute = useRef(operation);
  execute.current = operation;
  const taskRequest: TaskRequest = useCallback(
    async <T,>(path: string, data?: unknown): Promise<T> => {
      if (path === 'tasks/state') return call<T>('read');
      const result = await execute.current(() => call<T>('action', { data }), true);
      if (result === null) throw Error('功能正在交接，请稍后重试');
      return result;
    },
    [call],
  );
  if (id === 'terms')
    return value ? (
      <TerminologyView
        state={value as unknown as TermData}
        reading={reading}
        locked={locked}
        action={(data) =>
          operation(async () => {
            const result = await call<FeatureData>('action', { data });
            update(result);
            return result;
          }, true)
        }
      />
    ) : (
      <p className="feature-placeholder">正在读取术语…</p>
    );
  if (id === 'board')
    return (
      <Board
        headerActions={headerActions}
        locked={locked}
        request={taskRequest}
        embedded
        view={reading.board ?? (reading.board = { search: '', stage: 'todo', tab: 'board' })}
      />
    );
  if (id === 'model')
    return value ? (
      <ModelView
        headerActions={headerActions}
        state={value as unknown as ModelState}
        reading={reading}
        busy={locked || !connected}
        action={(data, action) =>
          operation(async () => {
            const result = await call<
              ModelState & { result?: { status: string; message: string } }
            >('action', { data, action });
            update(result);
            if (result.result && result.result.status !== 'success')
              throw Error(result.result.message);
            return result;
          })
        }
      />
    ) : (
      <p className="feature-placeholder" role="status">
        正在读取模型…
      </p>
    );
  const snapshot = value?.snapshot as PanelSnapshot | undefined;
  if (!snapshot)
    return (
      <p className="feature-placeholder" role="status">
        等待 Codex 连接…
      </p>
    );
  const enabled =
    id === 'outline' ? snapshot.settings.answerOutlineEnabled : snapshot.settings.enabled;
  async function command(kind: PanelCommand['kind'], extra: Partial<PanelCommand> = {}) {
    if (!connected || !snapshot) return;
    const data = {
      kind,
      instanceId: snapshot.instanceId,
      viewToken: snapshot.viewToken,
      context: snapshot.context,
      promptToken: snapshot.promptToken,
      outlineToken: snapshot.outlineToken,
      ...extra,
    };
    await operation(async () => {
      const result = await call<CommandResult>('action', { data });
      if (!result.ok) throw Error(result.message || '操作未完成');
    });
  }
  return (
    <>
      {!enabled && <p role="status">功能已停用，可在设置中重新开启。</p>}
      <ProjectedContent
        headerActions={headerActions}
        id={id}
        snapshot={snapshot}
        reading={reading}
        disabled={
          locked ||
          !connected ||
          !enabled ||
          snapshot.scanBusy ||
          snapshot.association?.available === false
        }
        command={command}
        saveQuickPrompts={
          id === 'next'
            ? async (quickPrompts, expectedRevision) => {
                const result = await operation(
                  () =>
                    call<PanelSnapshot['settings']>('action', {
                      action: 'quick-prompts',
                      data: { quickPrompts, expectedRevision },
                    }),
                  true,
                );
                if (!result) throw Error('功能正在交接，请稍后重试');
                const current = latestValue.current;
                const projected = current?.snapshot as PanelSnapshot | undefined;
                if (
                  projected &&
                  projected.settings.configurationRevision <= result.configurationRevision
                )
                  update({ ...current, snapshot: { ...projected, settings: result } });
                return result;
              }
            : undefined
        }
      />
    </>
  );
}
