import { PreviewFrame } from '../settings/preview-frame';
/* [INPUT]: Actual quick-phrase component, scroll tour step and visitor input.
 * [OUTPUT]: A Codex chat beside the Palboo panel; phrases travel into the example draft.
 * [POS]: Website demo adapter; memory-only draft, no host, settings or model calls.
 * [PROTOCOL]: Keep website/AGENTS.md and browser checks in sync. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { ComposerDemo, Eyes } from './demos';
import { QuickPhrasesDemo, samplePhrases } from './product-demos';
import { flyText, markFilled, shadowQuery } from './narrative';

/* ---------- 滚动示例：0 空草稿 · 1 展开长指令并飞入草稿 · 2 保留草稿，可继续编辑 · 3 仅显示名称 ---------- */
const tourPhrase = 2;
const tourDraft = (step?: number) => ((step ?? 0) >= 1 ? samplePhrases()[tourPhrase].prompt : '');
const phraseSource = (scene: HTMLElement | null, index: number) =>
  shadowQuery(scene, 'prompts', `[data-quick-prompt="${index}"]`);

/* ---------- 从短语飞向输入框，仅作状态衔接 ---------- */
function fly(scene: HTMLElement | null, index: number) {
  const source = phraseSource(scene, index);
  const composer = scene?.querySelector<HTMLElement>('.demo-composer');
  return flyText(
    source,
    composer,
    source?.getAttribute('aria-label') || source?.textContent || '',
    () => markFilled(composer),
  );
}

export function PhrasesShowcase({ tourStep }: { tourStep?: number }) {
  useLocale();
  const scene = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [namesOnly, setNamesOnly] = useState<boolean | null>(null);
  const [filled, setFilled] = useState(0);
  const previous = useRef(tourStep);
  const cancelFlight = useRef<(() => void) | undefined>(undefined);
  const shownDraft = draft ?? tourDraft(tourStep);
  const shownNames = namesOnly ?? tourStep === 3;
  const visitor = draft !== null || namesOnly !== null;

  // 访客草稿优先：一旦编辑或点击，滚动不再改写草稿
  useEffect(() => {
    const from = previous.current;
    previous.current = tourStep;
    if (draft !== null || (tourStep ?? 0) < 1 || from === undefined || from >= 1) return;
    setFilled((n) => n + 1);
    return fly(scene.current, tourPhrase);
  }, [tourStep, draft]);

  // 第一拍展开长指令全文（真实组件的展开按钮），回看时收起；访客操作后不再改动。
  useEffect(() => {
    if (visitor || tourStep === undefined) return;
    const toggle = shadowQuery(scene.current, 'prompts', `[data-quick-expand="${tourPhrase}"]`);
    if (!toggle || toggle.hidden) return;
    const open = toggle.getAttribute('aria-expanded') === 'true';
    if ((tourStep === 1 || tourStep === 2) !== open) toggle.click();
  }, [tourStep, visitor]);

  useLayoutEffect(() => {
    const field = scene.current?.querySelector('textarea');
    if (filled && field) field.scrollTop = field.scrollHeight;
  }, [filled]);

  const insert = (text: string, index: number) => {
    setDraft((current) => {
      const base = current ?? shownDraft;
      return base ? `${base}\n${text}` : text;
    });
    cancelFlight.current?.();
    cancelFlight.current = fly(scene.current, index);
    setFilled((n) => n + 1);
  };
  useEffect(() => () => cancelFlight.current?.(), []);

  return (
    <div className="phrase-showcase">
      <div className="demo-controls" role="group" aria-label={tr('常用语显示方式')}>
        <button type="button" aria-pressed={!shownNames} onClick={() => setNamesOnly(false)}>
          {tr('完整内容')}
        </button>
        <button type="button" aria-pressed={shownNames} onClick={() => setNamesOnly(true)}>
          {tr('仅显示名称')}
        </button>
      </div>
      <PreviewFrame title={tr('常用语')} className="site-preview phrase-scene">
        <div ref={scene} className="phrase-scene-body" data-tour-step={tourStep ?? ''}>
          <div className="phrase-chat">
            <div className="chat-title">
              <span>Codex</span>
              <span>{tr('个人作品集')}</span>
            </div>
            <div className="phrase-thread">
              <div className="chat-question">{tr('帮我把作品集第一版整理成一份方案。')}</div>
              <p>{tr('方案整理好了：三个代表作品、首页结构，以及手机上的阅读顺序。')}</p>
            </div>
            <ComposerDemo draft={shownDraft} onChange={setDraft} label={tr('常用语示例草稿')} />
          </div>
          <aside className="phrase-panel">
            <div className="demo-panel-top">
              <Eyes />
              <span>Palboo</span>
            </div>
            <div className="demo-content-heading">
              <span>{tr('常用语')}</span>
            </div>
            <QuickPhrasesDemo namesOnly={shownNames} onInsert={insert} />
          </aside>
        </div>
      </PreviewFrame>
    </div>
  );
}
