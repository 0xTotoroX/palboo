/* [INPUT]: Portfolio samples and the settings feature preview's optional example contract.
 * [OUTPUT]: Real chat features with synthetic context and persistent in-memory state.
 * [POS]: Website-only adaptation. No host, model or settings writes; drafts and task edits stay mounted.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
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
}: {
  id: 'outline' | 'next' | 'prompts' | 'terms' | 'board' | 'bots';
  form: EditableSettings;
  active: boolean;
}) {
  useLocale();
  const [taskRequest] = useState(() => (id === 'board' ? createPortfolioTasks() : undefined));
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
