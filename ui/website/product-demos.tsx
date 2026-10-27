/* [INPUT]: Application feature components and synthetic website projections.
 * [OUTPUT]: Actual next/outline/terms/board/Bot interactions with memory-only action adapters.
 * [POS]: Website integration; product rendering remains in ui/features.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import type { Reading } from '../shared/features';
import { ProjectedContent } from '../features/projected';
import { TerminologyView, type TermData } from '../features/terminology';
import { Board } from '../features/board/app';
import { BotsView, type BotState } from '../features/bots/view';
import contentStyles from '../features/content.css?inline';
import boardStyles from '../features/board/styles.css?inline';
import botStyles from '../features/bots/style.css?inline';
import { DemoSurface } from './demo-surface';
import { createDemoTasks, sampleProjection } from './demo-state';
import { useSiteTheme } from './theme';

export function NextDemo({ onInsert }: { onInsert: (text: string) => void }) {
  useLocale();
  const [explore, setExplore] = useState(false);
  const reading = useRef<Reading>({});
  const [quick, setQuick] = useState<{ label: string; prompt: string }[] | null>(null);
  const revision = useRef(0);
  const snapshot = sampleProjection(explore);
  snapshot.settings.configurationRevision = revision.current;
  if (quick) snapshot.settings.quickPrompts = quick;
  return (
    <DemoSurface kind="next" styles={contentStyles}>
      <ProjectedContent
        id="next"
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
          if (kind === 'generate') setExplore((value) => !value);
          const item =
            kind === 'fill'
              ? snapshot.prompts[data?.index ?? 0]
              : kind === 'quick-fill'
                ? snapshot.settings.quickPrompts[data?.index ?? 0]
                : null;
          if (item?.prompt) onInsert(item.prompt);
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
          if (kind === 'outline-jump') onJump(Number(data?.id));
          if (kind === 'outline-anchor') onJump(data?.anchor === 'end' ? 2 : 0);
        }}
      />
    </DemoSurface>
  );
}
export function BoardDemo({ tourStatus }: { tourStatus?: number } = {}) {
  const locale = useLocale();
  const [tasks] = useState(createDemoTasks);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (tourStatus === undefined) return;
    tasks.tour(tourStatus);
    setRevision((n) => n + 1);
  }, [tasks, tourStatus]);
  const request = useCallback<typeof tasks.request>(
    (path, body) => tasks.request(path, body),
    [tasks, revision, locale],
  );
  return (
    <DemoSurface kind="board" styles={boardStyles}>
      <Board embedded request={request} />
    </DemoSurface>
  );
}
export function TermDemo() {
  useLocale();
  useSiteTheme();
  const reading = useRef<Reading>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mastered, setMastered] = useState<string[]>([]);
  const state: TermData = {
    entries: [
      {
        id: 'responsive',
        name: tr('响应式布局'),
        english: 'Responsive layout',
        definition: tr('让页面随屏幕宽度调整排列。例如电脑上并排展示作品，手机上改为纵向阅读。'),
        category: [tr('页面与布局')],
      },
    ],
    preferences: { favorites, mastered, cardMaterial: 'matte' },
    involved: ['responsive'],
    context: 'website',
    phase: 'ready',
    message: '',
  };
  return (
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
  );
}
export const botSampleNames = () => [tr('工程主管'), tr('资料助手'), tr('随口一问')];
export function BotDemo({
  onInsert,
  tourStep,
}: {
  onInsert: (text: string) => void;
  tourStep?: number;
}) {
  useLocale();
  const [phase, setPhase] = useState(1);
  useEffect(() => {
    if (tourStep !== undefined) setPhase(tourStep);
  }, [tourStep]);
  const names = botSampleNames();
  const state: BotState = {
    autoSync: true,
    snapshot: {
      target: { threadId: 'website', token: 'sample' },
      catalog: { revision: 'website', stale: false },
      bots: names.map((name, i) => ({
        id: String(i),
        name,
        occupied: false,
        avatar: { shape: 'circle', color: ['black', 'violet', 'green'][i] },
        current:
          i === 0
            ? { key: 'sample', status: ['calling', 'running', 'finished'][phase] }
            : i === 1
              ? { key: 'research', status: 'finished' }
              : null,
        unread: i === 1,
        ...(i === 1 ? { preview: tr('先整理三个代表作品，再检查手机上的阅读与加载。') } : {}),
      })),
    },
  };
  return (
    <DemoSurface kind="bots" styles={botStyles}>
      <BotsView
        state={state}
        disabled={false}
        action={(data) => {
          const name = String(data.agent);
          const text =
            data.action === 'check'
              ? tr('查看「{{name}}」的进度。', { name })
              : data.action === 'followup'
                ? tr('追问「{{name}}」：', { name })
                : data.action === 'stop'
                  ? tr('停止「{{name}}」在本聊天中的任务。', { name })
                  : tr('请问「{{name}}」：帮我检查作品集方案。', { name });
          onInsert(text);
        }}
      />
    </DemoSurface>
  );
}
