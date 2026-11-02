/* [INPUT]: Application feature components and synthetic website projections.
 * [OUTPUT]: Actual next/phrases/outline/terms/board/Bot interactions with memory-only action adapters.
 * [POS]: Website integration; product rendering remains in ui/features.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import type { Reading } from '../shared/features';
import { ProjectedContent } from '../features/projected';
import { TerminologyView, type TermData } from '../features/terminology';
import { Board } from '../features/board/app';
import contentStyles from '../features/content.css?inline';
import boardStyles from '../features/board/styles.css?inline';
import { DemoSurface } from './demo-surface';
import { createDemoTasks, sampleProjection } from './demo-state';
import { sampleTerms } from '../shared/demo-state';
import { useSiteTheme } from './theme';
import { reducedMotion } from './narrative';

export function NextDemo({
  onInsert,
  onManual,
}: {
  onInsert: (text: string) => void;
  /** 访客刷新建议：外层退出滚动自动填入，避免填入与显示不一致。 */
  onManual?: () => void;
}) {
  useLocale();
  const [explore, setExplore] = useState(false);
  const reading = useRef<Reading>({});
  const snapshot = sampleProjection(explore);
  return (
    <DemoSurface kind="next" styles={contentStyles}>
      <ProjectedContent
        id="next"
        snapshot={snapshot}
        reading={reading.current}
        disabled={false}
        command={async (kind, data) => {
          if (kind === 'generate') {
            onManual?.();
            setExplore((value) => !value);
          }
          const item = kind === 'fill' ? snapshot.prompts[data?.index ?? 0] : null;
          if (item?.prompt) onInsert(item.prompt);
        }}
      />
    </DemoSurface>
  );
}
export const samplePhrases = () => [
  { label: tr('继续'), prompt: tr('继续完成剩余步骤。') },
  { label: '', prompt: tr('请用更直白的语言解释，并举一个具体例子。') },
  {
    label: tr('检查方案'),
    prompt: tr(
      '检查这份作品集方案：\n1. 找出影响阅读和操作的问题。\n2. 按影响程度排序。\n3. 给出可以直接执行的修改建议。\n4. 标明需要我补充的信息。\n保留已经确认的视觉风格。',
    ),
  },
];
export function QuickPhrasesDemo({
  onInsert,
  namesOnly = false,
}: {
  onInsert: (text: string, index: number) => void;
  namesOnly?: boolean;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [quick, setQuick] = useState<{ label: string; prompt: string }[] | null>(null);
  const revision = useRef(0);
  const snapshot = sampleProjection();
  snapshot.settings.quickPromptLabelOnly = namesOnly;
  snapshot.settings.configurationRevision = revision.current;
  snapshot.settings.quickPrompts = quick ?? samplePhrases();
  return (
    <DemoSurface kind="prompts" styles={contentStyles}>
      <ProjectedContent
        id="prompts"
        snapshot={snapshot}
        reading={reading.current}
        disabled={false}
        saveQuickPrompts={async (items) => {
          revision.current++;
          setQuick(items);
          return {
            ...snapshot.settings,
            quickPrompts: items,
            configurationRevision: revision.current,
          };
        }}
        command={async (kind, data) => {
          if (kind === 'quick-fill') {
            const index = data?.index ?? 0;
            const item = snapshot.settings.quickPrompts[index];
            if (item?.prompt) onInsert(item.prompt, index);
          }
        }}
      />
    </DemoSurface>
  );
}
export function OutlineDemo({ onJump }: { onJump: (index: number) => void }) {
  useLocale();
  const reading = useRef<Reading>({});
  return (
    <DemoSurface kind="outline" styles={contentStyles}>
      <ProjectedContent
        id="outline"
        snapshot={sampleProjection()}
        reading={reading.current}
        disabled={false}
        command={async (kind, data) => {
          if (kind === 'outline-jump') onJump(Number.parseInt(String(data?.id), 10));
          if (kind === 'outline-anchor') onJump(data?.anchor === 'end' ? 2 : 0);
        }}
      />
    </DemoSurface>
  );
}
/* ---------- 看板：同一张卡片从原位置滑到新列，完成时轻提示 ---------- */
const tourCard = (root: ShadowRoot | null | undefined) =>
  [...(root?.querySelectorAll<HTMLElement>('.task-card') || [])].find(
    (card) => card.querySelector('.card-title')?.textContent === tr('整理三个代表作品'),
  );
export function BoardDemo({ tourStatus }: { tourStatus?: number } = {}) {
  const locale = useLocale();
  const [tasks] = useState(() => createDemoTasks(undefined, 'expanded'));
  const [revision, setRevision] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tourStatus === undefined) return;
    const root = wrap.current?.querySelector('[data-real-feature=board]')?.shadowRoot;
    const before = tourCard(root)?.getBoundingClientRect();
    tasks.tour(tourStatus);
    setRevision((n) => n + 1);
    if (!root || !before || reducedMotion()) return;
    // The board re-renders after its async request; glide the moved card once.
    let frame = 0;
    const flights: Animation[] = [];
    const glide = () => {
      frame = 0;
      const card = tourCard(root);
      const after = card?.getBoundingClientRect();
      if (!card || !after || (after.left === before.left && after.top === before.top)) return;
      observer.disconnect();
      flights.push(
        card.animate(
          [
            { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
            { transform: 'none' },
          ],
          { duration: 520, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        ),
      );
      if (tourStatus === 2)
        flights.push(
          card.animate(
            [
              { boxShadow: '0 0 0 0 transparent' },
              { boxShadow: '0 0 0 4px color-mix(in srgb, #f4a3ad 55%, transparent)', offset: 0.6 },
              { boxShadow: '0 0 0 0 transparent' },
            ],
            { duration: 900, delay: 420, easing: 'ease-out' },
          ),
        );
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(glide);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true });
    const stop = setTimeout(() => observer.disconnect(), 900);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(stop);
      observer.disconnect();
      flights.forEach((flight) => flight.cancel());
    };
  }, [tasks, tourStatus]);
  const request = useCallback<typeof tasks.request>(
    (path, body) => tasks.request(path, body),
    [tasks, revision, locale],
  );
  return (
    <div ref={wrap} className="board-tour-scope" data-tour-status={tourStatus ?? ''}>
      <DemoSurface kind="board" styles={boardStyles}>
        <Board embedded request={request} />
      </DemoSurface>
    </div>
  );
}
/* 术语滚动示例：1 收藏“响应式布局” · 2 掌握“加载”；访客操作后以访客状态为准 */
export function TermDemo({ tourBeat }: { tourBeat?: number } = {}) {
  useLocale();
  useSiteTheme();
  const reading = useRef<Reading>({});
  const [ownFavorites, setOwnFavorites] = useState<string[] | null>(null);
  const [ownMastered, setOwnMastered] = useState<string[] | null>(null);
  // 暂停（undefined）冻结最后一拍；只有明确滚回第 0 拍才恢复初始示例。
  const lastBeat = useRef(-1);
  if (tourBeat !== undefined) lastBeat.current = tourBeat;
  const beat = lastBeat.current;
  const favorites = ownFavorites ?? (beat >= 1 ? ['breakpoint', 'loading'] : ['breakpoint']);
  const mastered = ownMastered ?? (beat >= 2 ? ['accessibility', 'breakpoint'] : ['accessibility']);
  const setFavorites = (update: (items: string[]) => string[]) => {
    setOwnFavorites(update(favorites));
    setOwnMastered(mastered);
  };
  const setMastered = (update: (items: string[]) => string[]) => {
    setOwnMastered(update(mastered));
    setOwnFavorites(favorites);
  };
  const state: TermData = {
    entries: sampleTerms(),
    preferences: { favorites, mastered, cardMaterial: 'matte' },
    involved: ['responsive', 'breakpoint', 'loading', 'accessibility'],
    context: 'website',
    phase: 'ready',
    message: '',
  };
  return (
    <div
      className="term-demo-scope"
      style={{ display: 'contents' }}
      data-favorites={favorites.join(' ')}
      data-mastered={mastered.join(' ')}
    >
      <DemoSurface kind="terms">
        <TerminologyView
          followScroll
          state={state}
          reading={reading.current}
          locked={false}
          action={async (data) => {
            const id = String(data.id);
            if (data.action === 'favorite') setFavorites((items) => [...new Set([...items, id])]);
            if (data.action === 'unfavorite')
              setFavorites((items) => items.filter((item) => item !== id));
            if (data.action === 'master') setMastered((items) => [...new Set([...items, id])]);
            if (data.action === 'restore')
              setMastered((items) => items.filter((item) => item !== id));
            return {};
          }}
        />
      </DemoSurface>
    </div>
  );
}
export { BotDemo, botSampleNames } from './bot-demo';
