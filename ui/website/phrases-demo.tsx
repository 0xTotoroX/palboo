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

/* ---------- 滚动示例：0 空草稿 · 1 填入长指令 · 2 仅显示名称 ---------- */
const tourPhrase = 2;
const tourDraft = (step?: number) => (step ? samplePhrases()[tourPhrase].prompt : '');

/* ---------- 从短语飞向输入框，仅作状态衔接 ---------- */
function fly(scene: HTMLElement | null, index: number) {
  if (!scene || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = scene.querySelector('[data-real-feature="prompts"]');
  const source = host?.shadowRoot?.querySelector<HTMLElement>(`[data-quick-prompt="${index}"]`);
  const composer = scene.querySelector<HTMLElement>('.demo-composer');
  if (!source || !composer) return;
  const from = source.getBoundingClientRect();
  const to = composer.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const ghost = document.createElement('div');
  ghost.className = 'phrase-flight';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.textContent = source.getAttribute('aria-label') || source.textContent || '';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.maxWidth = `${Math.min(from.width, 280)}px`;
  document.body.append(ghost);
  const dx = to.left + 12 - from.left;
  const dy = to.top + 12 - from.top;
  const lift = Math.min(48, Math.abs(dx) * 0.15 + 16);
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 0 },
      { transform: 'translate(0, -4px) scale(1.02)', opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(0.98)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.92)`, opacity: 0 },
    ],
    { duration: 560, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  );
  const done = () => {
    ghost.remove();
    composer.classList.remove('is-filled');
    void composer.offsetWidth;
    composer.classList.add('is-filled');
  };
  flight.onfinish = done;
  flight.oncancel = () => ghost.remove();
}

export function PhrasesShowcase({ tourStep }: { tourStep?: number }) {
  useLocale();
  const scene = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [namesOnly, setNamesOnly] = useState<boolean | null>(null);
  const [filled, setFilled] = useState(0);
  const previous = useRef(tourStep);
  const shownDraft = draft ?? tourDraft(tourStep);
  const shownNames = namesOnly ?? tourStep === 2;

  // 访客草稿优先：一旦编辑或点击，滚动不再改写草稿
  useEffect(() => {
    const from = previous.current;
    previous.current = tourStep;
    if (draft !== null || !tourStep || from === undefined || from >= 1) return;
    fly(scene.current, tourPhrase);
    setFilled((n) => n + 1);
  }, [tourStep, draft]);

  useLayoutEffect(() => {
    const field = scene.current?.querySelector('textarea');
    if (filled && field) field.scrollTop = field.scrollHeight;
  }, [filled]);

  const insert = (text: string, index: number) => {
    setDraft((current) => {
      const base = current ?? shownDraft;
      return base ? `${base}\n${text}` : text;
    });
    fly(scene.current, index);
    setFilled((n) => n + 1);
  };

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
        <div ref={scene} className="phrase-scene-body">
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
