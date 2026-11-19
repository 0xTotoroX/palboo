/* [INPUT]: Portfolio samples and the settings feature preview's optional example contract.
 * [OUTPUT]: Real chat features with synthetic context and persistent in-memory state.
 * [POS]: Website-only adaptation. No host, model or settings writes; drafts and task edits stay mounted.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useMemo, useState } from 'react';
import type { TaskDisplayMode, TaskRequest, TaskState } from '../features/board/api';
import type { FeaturePreviewExample } from '../settings/feature-preview';
import { FeatureChatPreview } from '../settings/feature-chat-preview';
import type { EditableSettings } from '../settings/api';
import { useLocale } from '../shared/use-locale';
import {
  createPortfolioTasks,
  portfolioBotAction,
  portfolioBots,
  portfolioProjection,
  portfolioQuestion,
  portfolioSections,
  portfolioTerms,
  readPortfolioReply,
} from './feature-examples';

export function FeatureContentExample({
  id,
  form,
  active,
  taskDisplayMode = 'board',
}: {
  id: 'outline' | 'next' | 'prompts' | 'terms' | 'board' | 'bots';
  form: EditableSettings;
  active: boolean;
  taskDisplayMode?: TaskDisplayMode;
}) {
  useLocale();
  const [baseTaskRequest] = useState(() => (id === 'board' ? createPortfolioTasks() : undefined));
  const taskRequest = useMemo<TaskRequest | undefined>(() => {
    if (!baseTaskRequest) return undefined;
    return async <T,>(path: string, body?: unknown) => {
      const state = await baseTaskRequest<TaskState>(path, body);
      return { ...state, store: { ...state.store, displayMode: taskDisplayMode } } as T;
    };
  }, [baseTaskRequest, taskDisplayMode]);
  const example: FeaturePreviewExample = {
    projection: portfolioProjection,
    taskRequest,
    ...(id === 'terms' ? { terms: portfolioTerms() } : {}),
    ...(id === 'bots'
      ? { bots: portfolioBots(), readBotReply: readPortfolioReply, botAction: portfolioBotAction }
      : {}),
  };
  return (
    <div className={`feature-example feature-${id}-example`}>
      <FeatureChatPreview
        id={id}
        form={form}
        view={null}
        tasks={null}
        mode="example"
        active={active}
        exampleBoardViewMode="expanded"
        example={example}
        question={portfolioQuestion()}
        sections={id === 'terms' ? undefined : portfolioSections()}
      />
    </div>
  );
}
