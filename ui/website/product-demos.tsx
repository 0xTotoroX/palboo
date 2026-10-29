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
import { useSiteTheme } from './theme';

export function NextDemo({ onInsert }: { onInsert: (text: string) => void }) {
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
          if (kind === 'generate') setExplore((value) => !value);
          const item = kind === 'fill' ? snapshot.prompts[data?.index ?? 0] : null;
          if (item?.prompt) onInsert(item.prompt);
        }}
      />
    </DemoSurface>
  );
}
export function QuickPhrasesDemo({
  onInsert,
  namesOnly = false,
}: {
  onInsert: (text: string) => void;
  namesOnly?: boolean;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [quick, setQuick] = useState<{ label: string; prompt: string }[] | null>(null);
  const revision = useRef(0);
  const snapshot = sampleProjection();
  snapshot.settings.quickPromptLabelOnly = namesOnly;
  snapshot.settings.configurationRevision = revision.current;
  snapshot.settings.quickPrompts = quick ?? [
    { label: tr('继续'), prompt: tr('继续完成剩余步骤。') },
    { label: '', prompt: tr('请用更直白的语言解释，并举一个具体例子。') },
    {
      label: tr('检查方案'),
      prompt: tr(
        '检查这份作品集方案：\n1. 找出影响阅读和操作的问题。\n2. 按影响程度排序。\n3. 给出可以直接执行的修改建议。\n4. 标明需要我补充的信息。\n保留已经确认的视觉风格。',
      ),
    },
  ];
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
            const item = snapshot.settings.quickPrompts[data?.index ?? 0];
            if (item?.prompt) onInsert(item.prompt);
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
  const [favorites, setFavorites] = useState<string[]>(['breakpoint']);
  const [mastered, setMastered] = useState<string[]>(['accessibility']);
  const state: TermData = {
    entries: [
      {
        id: 'responsive',
        name: tr('响应式布局'),
        english: 'Responsive layout',
        definition: tr('让页面随屏幕宽度调整排列。例如电脑上并排展示作品，手机上改为纵向阅读。'),
        category: [tr('页面与布局')],
      },
      {
        id: 'breakpoint',
        name: tr('断点'),
        english: 'Breakpoint',
        category: [tr('页面与布局')],
        definition: tr(
          '布局切换的宽度条件。比如空间不足时，两列作品变成一列，文字保持原本的可读大小。',
        ),
      },
      {
        id: 'loading',
        name: tr('首屏加载'),
        english: 'Initial load',
        category: [tr('性能')],
        definition: tr(
          '访客第一次看到页面内容所需的加载过程。先呈现标题和核心作品，其余图片按需要加载。',
        ),
      },
      {
        id: 'accessibility',
        name: tr('可访问性'),
        english: 'Accessibility',
        category: [tr('交互')],
        definition: tr(
          '让不同操作方式都能完成任务。键盘可到达按钮，焦点清楚，减少动态效果时仍能阅读和操作。',
        ),
      },
    ],
    preferences: { favorites, mastered, cardMaterial: 'matte' },
    involved: ['responsive', 'breakpoint', 'loading', 'accessibility'],
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
export { BotDemo, botSampleNames } from './bot-demo';
