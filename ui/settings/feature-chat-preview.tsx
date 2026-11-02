/* [INPUT]: Real feature preview props and optional synthetic conversation sections.
 * [OUTPUT]: Chat-left/Palboo-right scene, local draft insertion and outline/term navigation.
 * [POS]: Shared settings/website adapter; current tasks, models and Bots retain their existing data boundary.
 * [PROTOCOL]: Keep settings/AGENTS.md and website/AGENTS.md in sync. */
import { useCallback, useRef, useState, type ComponentProps } from 'react';
import { FeaturePreviewContent } from './feature-preview';
import { PreviewConversation, type PreviewSection } from './preview-conversation';
import {
  previewQuestion,
  previewSections,
  previewTermSections,
} from '../shared/preview-conversation';

export function FeatureChatPreview({
  question = previewQuestion(),
  sections,
  ...props
}: ComponentProps<typeof FeaturePreviewContent> & {
  question?: string;
  sections?: PreviewSection[];
}) {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState('');
  const answer = useRef<HTMLElement>(null);
  const jump = useCallback((id: string) => {
    setSelected(id);
    const root = answer.current;
    const section = [...(root?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].find(
      (node) => node.dataset.section === id,
    );
    if (root && section) root.scrollTo({ top: section.offsetTop - 12, behavior: 'instant' });
  }, []);
  return (
    <PreviewConversation
      question={question}
      sections={sections ?? (props.id === 'terms' ? previewTermSections() : previewSections())}
      selected={selected}
      answerRef={answer}
      draft={draft}
      onDraftChange={setDraft}
    >
      <FeaturePreviewContent
        {...props}
        draft={draft}
        onDraftChange={setDraft}
        composer={false}
        onOutlineJump={jump}
        termSource={props.id === 'terms' ? answer : undefined}
      />
    </PreviewConversation>
  );
}
