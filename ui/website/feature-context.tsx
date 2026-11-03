/* [INPUT]: Portfolio samples and the settings feature preview's optional example contract.
 * [OUTPUT]: Real features with synthetic context; note and web launch actions stay within the preview.
 * [POS]: Website-only adaptation. No host, model or settings writes; drafts and task edits stay mounted.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
import { SitesView } from '../features/sites/view';
import type { FeaturePreviewExample } from '../settings/feature-preview';
import { FeatureChatPreview } from '../settings/feature-chat-preview';
import type { EditableSettings } from '../settings/api';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
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

export function LocalLibraryPreview() {
  useLocale();
  const [selected, setSelected] = useState('');
  const folder = { id: 'notes', name: tr('作品集笔记') };
  const site = { id: 'reference', name: tr('设计参考'), url: 'https://example.org/' };
  const name = selected === `folder:${folder.id}` ? folder.name : site.name;
  return (
    <div className="feature-library-example">
      <SitesView
        state={{ enabled: true, configured: true, folders: [folder], sites: [site] }}
        open={async (id) => setSelected(id)}
      />
      <p role="status">{selected && tr('演示：在 ChatGPT 新页签打开「{{name}}」。', { name })}</p>
    </div>
  );
}

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
