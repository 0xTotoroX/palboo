/* [INPUT]: Real ModelView/TokenMeterView, synthetic catalog and visitor actions.
 * [OUTPUT]: Domestic/international examples, editable presets, a full catalog and retained speed.
 * [POS]: Website-only memory adapter; examples do not advertise host or provider compatibility.
 * [PROTOCOL]: Keep website/AGENTS.md and browser coverage in sync. */
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { ModelView } from '../features/model/view';
import { TokenMeterView } from '../features/token-meter/view';
import type { ModelState, Selection } from '../features/model/catalog';
import type { Reading } from '../shared/features';

// Names checked against provider documentation; capabilities below are conservative examples.
// https://docs.anthropic.com/en/docs/about-claude/model-deprecations
// https://ai.google.dev/gemini-api/docs/models
// https://api-docs.deepseek.com/updates/
// https://help.aliyun.com/en/model-studio/model-pricing
const models = [
  {
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1-Sol',
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    fast: true,
  },
  {
    id: 'gpt-6-astra',
    label: 'GPT-6-Astra',
    reasoning: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    fast: true,
  },
  ...[
    ['claude-sonnet-5', 'Claude Sonnet 5'],
    ['claude-opus-5', 'Claude Opus 5'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
    ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
    ['qwen3-coder-plus', 'Qwen3 Coder Plus'],
    ['qwen3-coder-flash', 'Qwen3 Coder Flash'],
  ].map(([id, label]) => ({ id, label, reasoning: [], fast: false })),
];
const collections = {
  common: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'claude-sonnet-5',
    'gemini-3.8-flash',
    'deepseek-v4-pro',
    'qwen3-coder-plus',
  ],
  domestic: ['deepseek-v4-pro', 'deepseek-v4-flash', 'qwen3-coder-plus', 'qwen3-coder-flash'],
  international: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'claude-sonnet-5',
    'claude-opus-5',
    'gemini-3.8-flash',
  ],
};
type Collection = keyof typeof collections;
const selection = (model: string, reasoning = '', speed = 'standard'): Selection => ({
  model,
  reasoning,
  speed,
});
const presets = [
  { id: 'example-standard', name: 'GPT-6-Astra', selection: selection('gpt-6-astra', 'high') },
  { id: 'example-fast', name: 'GPT-6-Astra', selection: selection('gpt-6-astra', 'high', 'fast') },
  { id: 'example-code', name: '编码', selection: selection('qwen3-coder-plus') },
  { id: 'example-research', name: '深入分析', selection: selection('deepseek-v4-pro') },
  { id: 'example-writing', name: '写作', selection: selection('claude-sonnet-5') },
];
const initial = (): ModelState => ({
  revision: 0,
  snapshot: {
    target: { preview: true },
    revision: 'website-example',
    status: 'ready',
    message: '',
    current: selection('gpt-6.1-sol', 'low'),
    models,
    usage: [
      { minutes: 10080, remainingPercent: 72, resetsAt: null },
      { minutes: 300, remainingPercent: 86, resetsAt: null },
    ],
  },
  preferences: {
    enabled: true,
    showUsage: true,
    modelColumnWidth: 210,
    pinned: [...collections.common],
    presets: structuredClone(presets),
  },
});
const stops: { collection: Collection; selection: Selection; phase: string }[] = [
  { collection: 'common', selection: selection('gpt-6.1-sol', 'low'), phase: 'thinking' },
  { collection: 'international', selection: selection('claude-sonnet-5'), phase: 'streaming' },
  { collection: 'domestic', selection: selection('deepseek-v4-pro'), phase: 'tool' },
  { collection: 'common', selection: selection('gpt-6-astra', 'high', 'fast'), phase: 'completed' },
];
export function ModelDemo({
  tourStep,
  detailed = false,
}: { tourStep?: number; detailed?: boolean } = {}) {
  useLocale();
  const [state, setState] = useState(initial);
  const current = useRef(state);
  const reading = useRef<Reading>({});
  const [collection, setCollection] = useState<Collection>('common');
  const [phase, setPhase] = useState('thinking');
  const commit = (next: ModelState) => {
    current.current = next;
    setState(next);
    return next;
  };
  const choose = (name: Collection) => {
    setCollection(name);
    commit({
      ...current.current,
      preferences: { ...current.current.preferences, pinned: [...collections[name]] },
    });
  };
  useEffect(() => {
    if (tourStep === undefined) return;
    const stop = stops[tourStep];
    setCollection(stop.collection);
    setPhase(stop.phase);
    commit({
      ...current.current,
      snapshot: { ...current.current.snapshot, current: stop.selection },
      preferences: { ...current.current.preferences, pinned: [...collections[stop.collection]] },
    });
  }, [tourStep]);
  const active = models.find((model) => model.id === state.snapshot.current?.model);
  return (
    <div className={`model-showcase ${detailed ? 'is-detailed' : ''}`}>
      {detailed && (
        <div className="demo-controls" role="group" aria-label={tr('模型示例范围')}>
          {(
            [
              ['common', '常用组合'],
              ['domestic', '国内模型'],
              ['international', '国外模型'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} aria-pressed={collection === id} onClick={() => choose(id)}>
              {tr(name)}
            </button>
          ))}
        </div>
      )}
      <div className="demo-models" aria-label={tr('Codex 模型快切演示')}>
        <ModelView
          state={{
            ...state,
            preferences: {
              ...state.preferences,
              presets: state.preferences.presets.map((preset) => ({
                ...preset,
                name: presets.some(
                  (sample) => sample.id === preset.id && sample.name === preset.name,
                )
                  ? tr(preset.name)
                  : preset.name,
              })),
            },
          }}
          reading={reading.current}
          busy={false}
          footer={
            <TokenMeterView
              snapshot={{
                threadId: 'website-example',
                phase,
                speed: phase === 'streaming' ? 38.4 : null,
                lastSpeed: 38.4,
                model: active?.label,
                fast: state.snapshot.current?.speed === 'fast',
                scope: 'turn',
                average: null,
                official: null,
              }}
            />
          }
          action={async (value, kind) => {
            const data = value as {
              selection?: Selection;
              preserveSpeed?: boolean;
              patch?: Partial<ModelState['preferences']>;
            };
            const next = structuredClone(current.current);
            if (kind === 'apply' && data.selection) {
              const keepSpeed =
                data.preserveSpeed && models.find((m) => m.id === data.selection!.model)?.fast;
              next.snapshot.current = {
                ...data.selection,
                speed: keepSpeed
                  ? next.snapshot.current?.speed || 'standard'
                  : data.selection.speed,
              };
              if (!next.preferences.pinned.includes(data.selection.model))
                next.preferences.pinned.push(data.selection.model);
            } else if (kind === 'preferences' && data.patch)
              Object.assign(next.preferences, data.patch);
            else if (kind !== 'refresh') return null;
            next.revision++;
            return commit(next);
          }}
        />
      </div>
    </div>
  );
}
