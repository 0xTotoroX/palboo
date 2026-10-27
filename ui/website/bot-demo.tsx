/* [INPUT]: Actual BotsView, synthetic lifecycle states, groups and visitor layout choices.
 * [OUTPUT]: All four badges, working/completed eyes and responsive one/two/three-column examples.
 * [POS]: Website demo adapter; actions only populate the local example draft.
 * [PROTOCOL]: Keep website/AGENTS.md and browser checks in sync. */
import { useEffect, useRef, useState } from 'react';
import { BotsView, type BotState } from '../features/bots/view';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import styles from '../features/bots/style.css?inline';
import { DemoSurface } from './demo-surface';

export const botSampleNames = () => [tr('工程主管'), tr('资料助手'), tr('随口一问')];
const catalog = [
  ['engineering', '工程主管', 'black', 'running'],
  ['research', '资料助手', 'violet', 'finished'],
  ['casual', '随口一问', 'green', ''],
  ['design', '设计搭档', 'blue', 'running'],
  ['writing', '写作助手', 'yellow', 'interrupted'],
  ['review', '代码审查', 'red', 'error'],
  ['manager', '项目管家', 'cyan', 'finished'],
  ['inspiration', '灵感收集', 'magenta', 'calling'],
];
type Layout = 'wide' | 'medium' | 'sidebar';
export function BotDemo({
  onInsert,
  tourStep,
  detailed = false,
}: {
  onInsert: (text: string) => void;
  tourStep?: number;
  detailed?: boolean;
}) {
  useLocale();
  const [phase, setPhase] = useState(1);
  const [layout, setLayout] = useState<Layout>('wide');
  const [grouped, setGrouped] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [replaying, setReplaying] = useState(false);
  const clear = () => {
    clearTimeout(timer.current);
    setReplaying(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (tourStep === undefined) return;
    clear();
    setPhase(tourStep);
    if (detailed) setLayout((['sidebar', 'medium', 'wide'] as const)[tourStep]);
  }, [tourStep, detailed]);
  const replay = () => {
    clear();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase(2);
      return;
    }
    setReplaying(true);
    setPhase(0);
    timer.current = setTimeout(() => {
      setPhase(1);
      timer.current = setTimeout(() => {
        setPhase(2);
        setReplaying(false);
      }, 1800);
    }, 650);
  };
  const state: BotState = {
    autoSync: true,
    snapshot: {
      target: { threadId: 'website', token: 'sample' },
      catalog: {
        revision: 'website',
        stale: false,
        ...(grouped
          ? {
              sidebar: {
                version: 1 as const,
                groups: [
                  {
                    id: 'pinned',
                    kind: 'pinned' as const,
                    name: '',
                    botIds: ['engineering', 'research'],
                  },
                  {
                    id: 'create',
                    kind: 'section' as const,
                    name: tr('创作与灵感'),
                    botIds: ['design', 'writing', 'inspiration'],
                  },
                  {
                    id: 'work',
                    kind: 'section' as const,
                    name: tr('项目协作'),
                    botIds: ['review', 'manager', 'casual'],
                  },
                ],
              },
            }
          : {}),
      },
      bots: catalog.map(([id, name, color, status], i) => ({
        id,
        name: tr(name),
        occupied: id === 'design',
        avatar: { shape: 'circle', color },
        current: status
          ? {
              key: `sample-${id}`,
              status: i === 0 ? ['calling', 'running', 'finished'][phase] : status,
            }
          : null,
        unread: id === 'research',
        ...(id === 'research'
          ? { preview: tr('先整理三个代表作品，再检查手机上的阅读与加载。') }
          : {}),
        ...(id === 'manager'
          ? { preview: tr('第一版范围已整理好，任务已按素材、布局和检查分组。') }
          : {}),
      })),
    },
  };
  return (
    <div className="bot-showcase" data-layout={detailed ? layout : 'wide'}>
      {detailed && (
        <div className="demo-controls bot-demo-controls">
          <div role="group" aria-label={tr('Bot 排布演示')}>
            {(
              [
                ['wide', '自适应'],
                ['medium', '双列'],
                ['sidebar', '侧栏'],
              ] as const
            ).map(([id, name]) => (
              <button key={id} aria-pressed={layout === id} onClick={() => setLayout(id)}>
                {tr(name)}
              </button>
            ))}
          </div>
          <div>
            <button aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
              {tr('分组')}
            </button>
            <button
              className="demo-replay"
              aria-label={tr('重播 Bot 状态')}
              title={tr('重播 Bot 状态')}
              aria-busy={replaying}
              onClick={replay}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </div>
      )}
      <div className="bot-demo-frame">
        <DemoSurface kind="bots" styles={styles}>
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
      </div>
    </div>
  );
}
