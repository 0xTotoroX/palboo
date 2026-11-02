/* [INPUT]: Portfolio samples and the settings feature preview's optional example contract.
 * [OUTPUT]: One real feature with its source context; outline commands scroll only the local answer.
 * [POS]: Website-only adaptation. No host, model or settings writes; drafts and task edits stay mounted.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useCallback, useRef, useState } from 'react';
import { FeaturePreviewContent, type FeaturePreviewExample } from '../settings/feature-preview';
import type { EditableSettings } from '../settings/api';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import {
  createPortfolioTasks,
  portfolioAnswer,
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
  const [selected, setSelected] = useState('0');
  const answer = useRef<HTMLElement>(null);
  const jump = useCallback((sectionId: string) => {
    setSelected(sectionId);
    const root = answer.current;
    const section = Array.from(root?.querySelectorAll<HTMLElement>('[data-section]') ?? []).find(
      (node) => node.dataset.section === sectionId,
    );
    // 不调用 scrollIntoView，避免驱动外层滚动展台切到其他功能。
    if (root && section) root.scrollTo({ top: section.offsetTop - 12, behavior: 'instant' });
  }, []);
  const example: FeaturePreviewExample = {
    projection: portfolioProjection,
    taskRequest,
    ...(id === 'outline' ? { onOutlineJump: jump } : {}),
    ...(id === 'terms' ? { terms: portfolioTerms() } : {}),
    ...(id === 'bots'
      ? { bots: portfolioBots(), readBotReply: readPortfolioReply, botAction: portfolioBotAction }
      : {}),
  };
  return (
    <div className={`feature-example feature-${id}-example`}>
      {id === 'next' && (
        <section className="feature-context" aria-label={tr('当前问题')}>
          <h3>{tr('当前问题')}</h3>
          <p>{portfolioQuestion()}</p>
          <p className="feature-context-answer">{portfolioAnswer()}</p>
        </section>
      )}
      {id === 'bots' && (
        <section className="feature-context" aria-label={tr('作品集方案')}>
          <h3>{tr('作品集方案')}</h3>
          <p>
            {tr('请检查三个项目的素材、页面布局和上线清单。缺少证据的内容标出来，先不要代写成果。')}
          </p>
        </section>
      )}
      <FeaturePreviewContent
        id={id}
        form={form}
        view={null}
        tasks={null}
        mode="example"
        active={active}
        exampleBoardViewMode="expanded"
        example={example}
      />
      {id === 'outline' && (
        <article className="feature-answer" ref={answer} tabIndex={0} aria-label={tr('作品集方案')}>
          {portfolioSections().map((section) => (
            <section
              key={section.id}
              data-section={section.id}
              data-selected={selected === section.id}
            >
              {section.level === 0 ? <h3>{section.title}</h3> : <h4>{section.title}</h4>}
              <p>{section.text}</p>
            </section>
          ))}
        </article>
      )}
      {id === 'terms' && (
        <article className="feature-context feature-term-source" aria-label={tr('作品集方案')}>
          <h3>{tr('桌面与手机')}</h3>
          <p>
            {tr(
              '用响应式布局组织三个作品，按内容决定断点。信息层级依靠标题与留白，手机端改为单列，保持正文可读。',
            )}
          </p>
          <h3>{tr('素材与加载')}</h3>
          <p>
            {tr(
              '截图保留宽高比并预留尺寸，避免布局偏移。首屏加载核心内容，下方图片使用懒加载；替代文本说明截图展示的功能。',
            )}
          </p>
          <h3>{tr('阅读与操作')}</h3>
          <p>
            {tr(
              '检查键盘焦点与链接顺序；减少动态效果时仍能完成所有操作。这些都是作品集可访问性的一部分。',
            )}
          </p>
        </article>
      )}
    </div>
  );
}
