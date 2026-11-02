/* [INPUT]: Shared product model and compatibility types, website language.
 * [OUTPUT]: Nine settings-ordered pages and explicit synthetic preview snapshots.
 * [POS]: Website-only examples; contains no host identity, provider promise or credential.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { tr } from '../shared/i18n.js';
import type { ModelState } from '../features/model/catalog';
import type { CodexHostAgentSnapshot } from '../shared/codex-host';

export const featurePages = [
  {
    id: 'outline',
    title: '大纲',
    icon: 'feature-outline',
    description: '长回答里的重点，一眼找到。',
  },
  {
    id: 'next',
    title: '下一步',
    icon: 'feature-next',
    description: '从当前对话出发，找到接下来可以做的事。',
  },
  {
    id: 'prompts',
    title: '常用语',
    icon: 'feature-prompts',
    description: '常用的指令，点一下就能填入。',
  },
  {
    id: 'terms',
    title: '术语释义',
    icon: 'feature-terms',
    description: '遇到陌生的词，就地看懂。',
  },
  {
    id: 'board',
    title: '任务看板',
    icon: 'feature-board',
    description: '把聊到的事情，变成看得见的进展。',
  },
  {
    id: 'model',
    title: '模型切换',
    icon: 'feature-model',
    description: '模型、推理强度和常用预设，放在手边。',
  },
  {
    id: 'bots',
    title: 'Grok Bot',
    icon: 'feature-bots',
    description: '找到合适的帮手，查看进度和回复。',
  },
  {
    id: 'prompt',
    title: '提示词优化',
    icon: 'sparkles',
    description: '发送之前，把想法表达得更清楚。',
  },
  {
    id: 'compatibility',
    title: '兼容集成',
    icon: 'connection',
    description: '在当前聊天里，选择你要协作的 Agent。',
  },
] as const;

export function modelExample(): ModelState {
  return {
    revision: 0,
    snapshot: {
      target: { preview: true },
      revision: 'website-example',
      status: 'ready',
      message: '',
      current: { model: 'example-a', reasoning: 'medium', speed: 'standard' },
      models: ['a', 'b'].map((id) => ({
        id: `example-${id}`,
        label: tr('示例模型 {{id}}', { id: id.toUpperCase() }),
        reasoning: ['low', 'medium', 'high'],
        fast: true,
      })),
      usage: [
        { minutes: 10080, remainingPercent: 72, resetsAt: null },
        { minutes: 300, remainingPercent: 86, resetsAt: null },
      ],
      tokenMeter: {
        threadId: 'website-example',
        phase: 'completed',
        speed: null,
        lastSpeed: 38.4,
        model: 'example-a',
        fast: false,
        scope: 'turn',
        average: null,
        official: null,
      },
    },
    preferences: {
      enabled: true,
      showUsage: true,
      pinned: ['example-a', 'example-b'],
      presets: [
        {
          id: 'example-writing',
          name: tr('写作'),
          selection: { model: 'example-a', reasoning: 'medium', speed: 'standard' },
        },
        {
          id: 'example-analysis',
          name: tr('深入分析'),
          selection: { model: 'example-b', reasoning: 'high', speed: 'standard' },
        },
      ],
    },
  };
}

export const agentExample: CodexHostAgentSnapshot = {
  status: 'ready',
  message: '',
  current: 'codex',
  agents: [
    ['codex', 'Codex'],
    ['claude-code', 'Claude Code'],
    ['opencode', 'OpenCode'],
  ].map(([id, label]) => ({
    id,
    label,
    group: 'main',
    availability: 'ready',
    available: true,
    canAdd: false,
  })),
};
