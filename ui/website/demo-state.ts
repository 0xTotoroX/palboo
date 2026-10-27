/* [INPUT]: Website language and visitor edits to synthetic portfolio content.
 * [OUTPUT]: Typed product projections and an in-memory, revision-checked task adapter.
 * [POS]: Demo data only; never reads files, host state, model endpoints or credentials.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { tr } from '../shared/i18n.js';
import type { PanelSnapshot, PromptItem } from '../shared/contracts';
import {
  emptyFields,
  type Fields,
  type Task,
  type TaskRequest,
  type TaskState,
} from '../features/board/api';

export const headings = () => [tr('确定作品集内容'), tr('安排页面与布局'), tr('上线前检查')];
export function sampleProjection(explore = false): PanelSnapshot {
  const prompts: PromptItem[] = (
    explore
      ? [
          [
            '比较展示方式',
            '比较长页面与独立项目页。',
            '比较长页面和独立项目页，哪个更适合这三个作品？',
          ],
          [
            '探索呈现角度',
            '让每个作品更突出你的贡献。',
            '这些作品还可以从哪些角度展示我的个人贡献？',
          ],
          ['找出取舍', '先把第一版范围定下来。', '如果只能保留三个重点，我该怎样取舍作品集内容？'],
        ]
      : [
          [
            '拆解第一版',
            '把作品集方案分成两天可完成的步骤。',
            '请把作品集第一版拆解成两天内可完成的具体步骤。',
          ],
          [
            '检查移动端',
            '看看小屏阅读和图片加载还有哪些遗漏。',
            '帮我检查作品集在手机上阅读和加载图片时可能遗漏的问题。',
          ],
          [
            '准备验收',
            '给每一步一个清楚的完成标准。',
            '请把上线前的检查项整理成一份可逐项勾选的清单。',
          ],
        ]
  ).map(([label, summary, prompt]) => ({
    label: tr(label),
    summary: tr(summary),
    prompt: tr(prompt),
  }));
  return {
    instanceId: 'website',
    context: {
      runtimeGeneration: 1,
      paneKey: 'sample',
      sessionId: 'portfolio',
      assistantMessageId: 'answer',
      generation: 1,
    },
    answerHash: 'sample',
    viewToken: 'sample',
    promptToken: explore ? 'explore' : 'advance',
    outlineToken: 'sample',
    readingState: {
      viewToken: 'sample',
      contentToken: 'sample',
      activeTab: 'next',
      scrollTop: 0,
      promptPreviewIndex: 0,
      promptScrollTop: 0,
    },
    prompts,
    outlineItems: headings().flatMap((text, i) => [
      {
        id: String(i),
        text,
        labelText: text,
        displayLevel: 0,
        numberPrefix: '',
      },
      ...(i > 0
        ? [
            {
              id: `${i}:detail`,
              text: tr(i === 1 ? '桌面与手机' : '素材与加载'),
              labelText: tr(i === 1 ? '桌面与手机' : '素材与加载'),
              displayLevel: 1,
              numberPrefix: '',
            },
          ]
        : []),
    ]),
    outlineStatus: 'ready',
    outlineError: '',
    bridgeStatus: 'ok',
    bridgeError: '',
    scanBusy: false,
    scanStatus: 'ready',
    theme: 'light',
    hostTypography: {
      hostFontSize: 16,
      baseItemFontSize: 16,
      chromeFontSize: 14,
      iconFontSize: 18,
      fontFamily: 'inherit',
      source: 'sample',
      fontWeight: 400,
      labelWeight: 500,
    },
    display: { labelOnly: true, promptClickMode: 'fill' },
    sourceLabel: tr('个人作品集'),
    settings: {
      hostRestartPolicy: 'ask',
      enabled: true,
      answerOutlineEnabled: true,
      promptEnhancementEnabled: true,
      tokenMeterEnabled: true,
      grokbotEnabled: true,
      grokbotAutoSync: true,
      generationMode: 'manual',
      provider: 'api',
      protocol: 'auto',
      model: '',
      baseUrl: '',
      apiKeyEnv: '',
      maxItems: 3,
      directionSource: 'manual',
      directionLibrary: [],
      selectedDirections: [],
      jev: { consent: false, endpoint: '', model: '' },
      quickPrompts: ['继续', '执行'].map((text) => ({ label: tr(text), prompt: tr(text) })),
      maxInputChars: 0,
      maxOutputTokens: 1000,
      timeoutMs: 30000,
      builtInDirections: [],
      directionLibraryLimit: 100,
      popoutSupported: false,
      apiKeyConfigured: false,
      storedApiKey: false,
      jevKeyConfigured: false,
      storedJevApiKey: false,
      baseUrlConfigured: false,
      available: true,
      reason: '',
      configurationRevision: 0,
      generationRevision: 0,
      environmentOverrides: [],
    },
  };
}

const taskNotes = '每个作品保留背景、个人贡献、最终结果和两张关键截图。';
const taskNames = [
  '整理三个代表作品',
  '完成首页布局',
  '确定第一版范围',
  '准备封面与截图',
  '检查移动端阅读',
  '补全联系方式',
];
function task(id: string, fields: Fields): Task {
  return {
    id,
    fields,
    archived: false,
    deleteRequested: false,
    remote: null,
    remoteMissing: false,
    conflict: null,
  };
}
export function createDemoTasks() {
  let serial = 6;
  const state: TaskState = {
    status: 'ready',
    store: {
      revision: 0,
      boardEnabled: true,
      syncEnabled: false,
      bindings: { calendarId: '' },
      inflight: null,
      tasks: taskNames.map((title, i) =>
        task(`sample-${i}`, {
          ...emptyFields(),
          title,
          column: i === 1 || i === 4 ? 'doing' : 'todo',
          completed: i === 2 || i === 5,
          priority: i === 0 ? 1 : i === 4 ? 5 : 0,
          notes: i === 0 ? taskNotes : '',
        }),
      ),
    },
  };
  const snapshot = () => {
    const result = structuredClone(state);
    result.store.tasks.forEach((item) => {
      const index = Number(item.id.replace('sample-', ''));
      if (item.fields.title === taskNames[index]) item.fields.title = tr(item.fields.title);
      if (item.id === 'sample-0' && item.fields.notes === taskNotes)
        item.fields.notes = tr(taskNotes);
    });
    return result;
  };
  const request: TaskRequest = async <T>(path: string, body?: unknown) => {
    if (path === 'tasks/state') return snapshot() as T;
    if (path !== 'tasks/command' || !body || typeof body !== 'object')
      throw Error('Unknown demo command');
    const data = body as {
      op: string;
      revision: number;
      id?: string;
      fields?: Fields;
      before?: string;
    };
    if (data.revision !== state.store.revision) throw Error(tr('内容已更新，请重试'));
    if (data.op === 'create' && data.fields?.title.trim())
      state.store.tasks.push(task(`visitor-${serial++}`, structuredClone(data.fields)));
    else if (data.op === 'update' && data.fields) {
      const item = state.store.tasks.find((item) => item.id === data.id);
      if (!item) throw Error('Unknown demo task');
      item.fields = structuredClone(data.fields);
      if (data.before) {
        state.store.tasks = state.store.tasks.filter((t) => t !== item);
        const index = state.store.tasks.findIndex((t) => t.id === data.before);
        state.store.tasks.splice(index < 0 ? state.store.tasks.length : index, 0, item);
      }
    } else if (data.op === 'remove')
      state.store.tasks = state.store.tasks.filter((item) => item.id !== data.id);
    else throw Error('Unsupported demo command');
    state.store.revision++;
    return snapshot() as T;
  };
  return {
    request,
    tour(status: number) {
      const item = state.store.tasks.find((item) => item.id === 'sample-0');
      if (!item) return;
      item.fields.column = status === 1 ? 'doing' : 'todo';
      item.fields.completed = status === 2;
      state.store.revision++;
    },
  };
}
