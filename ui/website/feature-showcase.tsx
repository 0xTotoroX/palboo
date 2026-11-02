/* [INPUT]: Settings preview adapters, isolated examples and native page scrolling.
 * [OUTPUT]: One persistent preview with a scroll-linked, keyboard-accessible feature rail.
 * [POS]: Website presentation only; previews retain memory state and never contact a host.
 * [PROTOCOL]: Keep website/AGENTS.md and browser acceptance in sync. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { FeaturePreviewContent } from '../settings/feature-preview';
import { ModelPreview } from '../settings/model-preview';
import { PromptPreview } from '../settings/prompt-preview';
import { CodexHostPreview } from '../settings/codex-host-preview';
import { Icon } from '../shared/icons/react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { useSiteTheme } from './theme';
import { sampleProjection } from '../shared/demo-state';
import { samplePhrases } from './product-demos';
import { featurePages, modelExample, agentExample } from './feature-examples';
import { useFeatureScroll } from './feature-scroll';

type Page = (typeof featurePages)[number];

function sampleButton(root: HTMLElement, selector: string) {
  return (
    root.querySelector<HTMLElement>(selector) ??
    root.querySelector('[data-settings-feature]')?.shadowRoot?.querySelector<HTMLElement>(selector)
  );
}

function FeaturePage({
  page,
  active,
  direction,
  inView,
}: {
  page: Page;
  active: boolean;
  direction: number;
  inView: boolean;
}) {
  useLocale();
  useSiteTheme();
  const root = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const played = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [namesOnly, setNamesOnly] = useState(false);
  const [modelSelection, setModelSelection] =
    useState<ReturnType<typeof modelExample>['snapshot']['current']>();
  const [promptStep, setPromptStep] = useState<number>();
  const stop = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const takeOver = useCallback(() => {
    touched.current = true;
    stop();
  }, [stop]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!active || !inView || played.current || touched.current || media.matches || document.hidden)
      return;
    // 示范只通过现有预览的操作入口；切走、开始编辑或进入后台立即取消。
    timer.current = setTimeout(() => {
      if (!root.current || touched.current) return;
      played.current = true;
      if (page.id === 'model') {
        setModelSelection({ model: 'example-b', reasoning: 'high', speed: 'standard' });
      } else if (page.id === 'prompt') {
        setPromptStep(1);
      } else if (page.id === 'compatibility') {
        sampleButton(
          root.current,
          '.compatibility-agent-row:nth-child(2) .compatibility-agent-choice',
        )?.click();
      } else {
        const selector = {
          outline: '.csw-outline-row[data-outline-id="1"]',
          next: '.csw-row[data-index="0"]',
          prompts: '[data-quick-expand="2"]:not([hidden])',
          terms: '.term-brick',
          board: '',
          bots: '.palboo-bot-history',
        }[page.id];
        if (selector) sampleButton(root.current, selector)?.click();
      }
    }, 1300);
    const visibility = () => {
      if (document.hidden) stop();
    };
    media.addEventListener('change', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      media.removeEventListener('change', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, inView, page.id, stop]);
  const form = {
    ...sampleProjection().settings,
    directionSource: 'auto' as const,
    quickPrompts: samplePhrases(),
    quickPromptLabelOnly: namesOnly,
  };
  return (
    <div
      ref={root}
      id={`feature-panel-${page.id}`}
      className="feature-panel"
      role="tabpanel"
      aria-labelledby={`feature-tab-${page.id}`}
      aria-hidden={!active}
      inert={!active}
      tabIndex={0}
      data-feature-page={page.id}
      data-active={active}
      data-direction={direction}
      onPointerDownCapture={takeOver}
      onKeyDownCapture={takeOver}
      onFocusCapture={takeOver}
      onDragStartCapture={takeOver}
    >
      <header className="feature-heading">
        <h2>{tr(page.title)}</h2>
        <p>{tr(page.description)}</p>
      </header>
      <div className="feature-preview" data-preview-kind={page.id}>
        {page.id === 'prompts' && (
          <div className="feature-preview-options" role="group" aria-label={tr('常用语显示方式')}>
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={namesOnly === value}
                onClick={() => setNamesOnly(value)}
              >
                {tr(value ? '仅显示名称' : '完整内容')}
              </button>
            ))}
          </div>
        )}
        {page.id === 'model' ? (
          <ModelPreview
            model={modelExample()}
            demoSelection={modelSelection ?? undefined}
            mode="current"
            preserveEdits
          />
        ) : page.id === 'prompt' ? (
          <div className="preview-prompt">
            <PromptPreview active={active && inView} tourStep={promptStep} />
          </div>
        ) : page.id === 'compatibility' ? (
          <CodexHostPreview live={false} example={agentExample} />
        ) : (
          <FeaturePreviewContent
            id={page.id}
            form={form}
            view={null}
            tasks={null}
            mode="example"
            active={active && inView}
            exampleBoardViewMode="expanded"
          />
        )}
      </div>
    </div>
  );
}

export function FeatureShowcase() {
  useLocale();
  const { ref, active, direction, select, compact, inView } = useFeatureScroll(featurePages.length);
  const tabs = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tab = tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[active];
    if (!tab) return;
    const oldPanel = document.activeElement?.closest('.feature-panel');
    if (oldPanel?.getAttribute('aria-hidden') === 'true') tab.focus({ preventScroll: true });
    if (compact && tabs.current) {
      const rail = tabs.current;
      const left = tab.offsetLeft - rail.offsetLeft;
      if (left < rail.scrollLeft) rail.scrollLeft = left;
      else if (left + tab.offsetWidth > rail.scrollLeft + rail.clientWidth)
        rail.scrollLeft = left + tab.offsetWidth - rail.clientWidth;
    }
  }, [active, compact]);
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? featurePages.length - 1
          : (active +
              (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) +
              featurePages.length) %
            featurePages.length;
    select(index);
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [index]?.focus({ preventScroll: true });
  }
  return (
    <section
      id="features"
      className="feature-showcase"
      ref={ref}
      data-compact={compact}
      aria-label={tr('功能预览')}
    >
      <div className="feature-pin">
        <div className="feature-layout page-width">
          <aside className="feature-navigation">
            <p className="feature-nav-title">{tr('功能')}</p>
            <div
              ref={tabs}
              role="tablist"
              aria-label={tr('功能预览')}
              aria-orientation={compact ? 'horizontal' : 'vertical'}
              onKeyDown={navigate}
            >
              {featurePages.map((page, index) => (
                <button
                  type="button"
                  role="tab"
                  id={`feature-tab-${page.id}`}
                  aria-controls={`feature-panel-${page.id}`}
                  aria-selected={active === index}
                  tabIndex={active === index ? 0 : -1}
                  key={page.id}
                  onClick={() => select(index)}
                >
                  <Icon name={page.icon} />
                  <span>{tr(page.title)}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className="feature-pages">
            {featurePages.map((page, index) => (
              <FeaturePage
                key={page.id}
                page={page}
                active={index === active}
                direction={direction}
                inView={inView}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
