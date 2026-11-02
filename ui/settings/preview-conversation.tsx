/* [INPUT]: Synthetic chat sections, selected outline location and real feature content.
 * [OUTPUT]: Consistent chat-left/Palboo-right preview shared by settings and the website.
 * [POS]: Pure presentation; reading and drafts remain local to each mounted preview.
 * [PROTOCOL]: Keep settings/AGENTS.md and shared/preview-frame.css in sync. */
import type { ReactNode, Ref } from 'react';
import { tr } from '../shared/i18n.js';
import { PreviewComposer } from './preview-composer';

export type PreviewSection = {
  id: string;
  level?: number;
  title: string;
  text: string;
  items?: string[];
};
export function PreviewConversation({
  question,
  sections,
  selected,
  answerRef,
  draft,
  onDraftChange,
  children,
}: {
  question: string;
  sections: PreviewSection[];
  selected?: string;
  answerRef?: Ref<HTMLElement>;
  draft: string;
  onDraftChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="preview-conversation">
      <div className="preview-chat">
        <article
          ref={answerRef}
          className="preview-chat-answer feature-answer"
          tabIndex={0}
          aria-label={tr('作品集方案')}
        >
          <p className="preview-chat-question">{question}</p>
          {sections.map((section) => (
            <section
              key={section.id}
              data-section={section.id}
              data-selected={selected === section.id}
            >
              {section.level ? <h4>{section.title}</h4> : <h3>{section.title}</h3>}
              <p>{section.text}</p>
              {section.items?.length ? (
                <ol>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
        </article>
        <PreviewComposer value={draft} onValueChange={onDraftChange} />
      </div>
      <aside className="preview-palboo" aria-label="Palboo">
        {children}
      </aside>
    </div>
  );
}
