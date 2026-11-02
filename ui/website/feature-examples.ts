/* [INPUT]: Shared feature contracts, memory-only task adapter, Agent registry and website language.
 * [OUTPUT]: Nine settings-ordered pages and bounded portfolio examples for the real preview components.
 * [POS]: Website-only examples; contains no host identity, provider promise or credential.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { tr } from '../shared/i18n.js';
import type { ModelState } from '../features/model/catalog';
import type { CodexHostAgentSnapshot } from '../shared/codex-host';
import { codexHostAgents } from '../settings/codex-host-agents';
import { createDemoTasks, sampleProjection, sampleTerms } from '../shared/demo-state';
import { emptyFields, type TaskRequest, type TaskState } from '../features/board/api';
import type { BotState } from '../features/bots/view';
import type { ReplyLoader } from '../features/bots/messages';

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
      models: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({
        id: `example-${id}`,
        label: tr('示例模型 {{id}}', { id: id.toUpperCase() }),
        reasoning: index === 4 ? [] : index === 3 ? ['low', 'medium'] : ['low', 'medium', 'high'],
        fast: index === 0 || index === 2,
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
      pinned: ['example-a', 'example-b', 'example-c', 'example-d', 'example-e'],
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
        {
          id: 'example-code',
          name: tr('编码'),
          selection: { model: 'example-c', reasoning: 'high', speed: 'fast' },
        },
      ],
    },
  };
}

export const agentExample: CodexHostAgentSnapshot = {
  status: 'ready',
  message: '',
  current: 'codex',
  // 身份沿用已收录的菜单；安装与可用状态只是本页样本，不代表访客环境。
  agents: codexHostAgents.map(({ id, label }) => {
    const ready = ['codex', 'claude-code', 'opencode', 'cursor-cli'].includes(id);
    return {
      id,
      label,
      group: ready ? 'main' : 'more',
      availability: ready ? 'ready' : 'notInstalled',
      available: ready,
      canAdd: !ready,
    };
  }),
};

export const portfolioQuestion = () =>
  tr(
    '我有阅读工具、活动报名页和记账应用三个项目。只有两天，怎样把它们整理成一个能在手机上清楚阅读的作品集？',
  );
export const portfolioAnswer = () =>
  tr(
    '先保留简介、三个项目和联系方式。每个项目讲清问题、个人贡献和结果；第一天整理内容，第二天完成布局与上线检查。',
  );

export const portfolioSections = () =>
  [
    [
      '0',
      0,
      '确定作品集内容',
      '第一版只做简介、三个代表作品和联系方式。访客应能快速判断你做过什么，以及你在其中承担了什么。',
    ],
    [
      '0:projects',
      1,
      '三个代表作品',
      '阅读工具展示检索与摘录，活动报名页展示报名流程，记账应用展示分类与统计。每个项目保留两张关键截图，避免堆满整页。',
    ],
    [
      '0:contribution',
      1,
      '背景、贡献与结果',
      '先写项目要解决的问题，再说明自己做的设计或实现。结果只使用可以核实的材料；没有数据时，展示前后界面和具体改进。',
    ],
    [
      '1',
      0,
      '安排页面与布局',
      '首页按简介、作品、联系方式排列。项目卡片直接说明名称、用途和个人职责，完整过程放在项目详情里。',
    ],
    [
      '1:mobile',
      1,
      '桌面与手机',
      '宽屏并排展示作品，小屏改为一列。断点按内容是否拥挤决定；保留可读字号，按钮能用键盘到达，焦点清楚可见。',
    ],
    [
      '1:assets',
      1,
      '素材与加载',
      '为截图准备合适尺寸并预留宽高，减少布局偏移。首屏先加载简介和第一张作品图，其余图片按阅读位置延迟加载。',
    ],
    [
      '2',
      0,
      '上线前检查',
      '第一天完成三个项目的文字、截图和页面结构，第二天完成响应式布局与检查。暂缓博客、复杂动效和新项目，先让核心内容可访问。',
    ],
    [
      '2:review',
      1,
      '阅读与操作',
      '逐项检查手机阅读、图片替代文本、键盘顺序、减少动态效果和链接。让朋友用手机找到一个项目，并尝试通过联系方式联系你。',
    ],
    [
      '2:release',
      1,
      '发布与复核',
      '确认项目链接和联系方式有效，再发布页面。用公开地址重新检查首页与项目详情，把待补素材记入后续清单。',
    ],
  ].map(([id, level, title, text]) => ({
    id: String(id),
    level: Number(level),
    title: tr(title),
    text: tr(text),
  }));

export function portfolioProjection(explore = false) {
  const snapshot = sampleProjection(explore);
  snapshot.outlineItems = portfolioSections().map(({ id, level, title }) => ({
    id,
    text: title,
    labelText: title,
    displayLevel: level,
    numberPrefix: '',
  }));
  snapshot.display = { ...snapshot.display!, labelOnly: false };
  snapshot.prompts = (
    explore
      ? [
          [
            '比较展示方式',
            '首页放到什么程度，项目详情保留什么。',
            '请比较单页作品集和独立项目页：结合阅读工具、活动报名页和记账应用，列出各自适合放在首页的内容，并给出两天内能完成的选择。',
          ],
          [
            '找出取舍',
            '时间不够时，先保住关键内容。',
            '如果第二天只剩半天，请按影响排序决定哪些内容必须完成、哪些可以延后。保留三个项目的个人贡献和联系方式，不扩展第一版范围。',
          ],
          [
            '核对项目证据',
            '区分已经完成的成果与计划。',
            '逐个检查三个项目的描述：哪些结论已有截图、链接或数据支持，哪些还需要补充证据？请列成待核对清单，不补写不存在的结果。',
          ],
        ]
      : [
          [
            '拆解第一版',
            '按两天安排内容、布局与检查。',
            '请把这份作品集方案拆成两天的任务清单：第一天整理三个项目的背景、个人贡献和截图，第二天完成响应式布局、联系方式与上线检查。每项写明交付物和完成标准。',
          ],
          [
            '检查移动端',
            '从阅读顺序、图片和操作找遗漏。',
            '请按手机访客的阅读顺序检查方案：简介是否清楚，项目截图是否易读，按钮和联系方式是否容易找到。列出问题、影响和具体检查方法，保留已确认的视觉风格。',
          ],
          [
            '准备验收',
            '把发布前检查变成可执行清单。',
            '请为作品集整理上线验收清单，覆盖三个项目的内容证据、图片加载、键盘操作、减少动态效果和链接。按必须通过与可后补分组，并标明尚未提供的材料。',
          ],
        ]
  ).map(([label, summary, prompt]) => ({
    label: tr(label),
    summary: tr(summary),
    prompt: tr(prompt),
  }));
  return snapshot;
}

export const portfolioPhrases = () => [
  { label: tr('继续'), prompt: tr('继续完成剩余步骤。') },
  { label: '', prompt: tr('请用更直白的语言解释，并举一个具体例子。') },
  {
    label: tr('检查方案'),
    prompt: tr(
      '检查这份作品集方案：\n1. 找出影响阅读和操作的问题。\n2. 按影响程度排序。\n3. 给出可以直接执行的修改建议。\n4. 标明需要我补充的信息。\n保留已经确认的视觉风格。',
    ),
  },
  { label: tr('只做第一版'), prompt: tr('只处理两天内能完成的第一版，把新想法放进后续清单。') },
  {
    label: tr('核对项目证据'),
    prompt: tr('把已确认的事实、你的推断和待核实的信息分开列出，不编造项目数据。'),
  },
  {
    label: tr('整理项目案例'),
    prompt: tr(
      '把这个项目整理成作品集案例：\n1. 背景与要解决的问题。\n2. 我的职责和具体贡献。\n3. 关键设计或实现取舍。\n4. 可以核实的结果与截图。\n缺少材料的位置明确留空，先不要代写。',
    ),
  },
  { label: tr('验收清单'), prompt: tr('用可勾选的清单列出完成标准，每一项都要能实际检查。') },
];

export const portfolioTerms = () => [
  ...sampleTerms(),
  ...[
    [
      'hierarchy',
      '信息层级',
      'Information hierarchy',
      '页面与布局',
      '用标题、顺序和留白区分内容的重要程度。作品集先让访客看到项目用途与个人贡献，再展开实现过程。',
    ],
    [
      'whitespace',
      '留白',
      'Whitespace',
      '页面与布局',
      '内容之间有意保留的空间。相关信息靠近，不同项目适度分开，帮助阅读而不是把页面撑空。',
    ],
    [
      'aspect',
      '宽高比',
      'Aspect ratio',
      '素材与加载',
      '图像宽度与高度的比例。为作品截图预留正确比例，加载前后卡片就不会突然挤动正文。',
    ],
    [
      'lazy',
      '懒加载',
      'Lazy loading',
      '素材与加载',
      '在内容接近可见区域时再加载资源。作品集下方的大图可以延后，首屏关键图仍应及时显示。',
    ],
    [
      'shift',
      '布局偏移',
      'Layout shift',
      '素材与加载',
      '页面加载时内容位置突然变化。给截图预留尺寸，避免访客准备点击项目时按钮被推开。',
    ],
    [
      'alt',
      '替代文本',
      'Alt text',
      '交互',
      '描述有意义图片内容的文字。作品截图应说明所展示的界面或流程，供无法看到图片的人理解。',
    ],
    [
      'focus',
      '键盘焦点',
      'Keyboard focus',
      '交互',
      '当前接收键盘输入的控件。用 Tab 遍历作品链接与按钮时，应始终能看出下一步会操作哪里。',
    ],
    [
      'motion',
      '减少动态效果',
      'Reduced motion',
      '交互',
      '尊重访客减少动画的偏好。作品内容和操作仍然完整，页面切换不依赖位移或缩放才能看懂。',
    ],
  ].map(([id, name, english, category, definition]) => ({
    id,
    name: tr(name),
    english,
    category: [tr(category)],
    definition: tr(definition),
  })),
];

const taskExamples = [
  ['整理三个代表作品', '每个作品保留背景、个人贡献、最终结果和两张关键截图。', 'doing', 1],
  ['完成首页布局', '简介、三个项目与联系方式；项目卡片直接写明用途和个人职责。', 'doing', 1],
  ['准备封面与截图', '统一封面比例，检查裁切是否遮挡关键界面，并补充替代文本。', 'doing', 5],
  ['检查移动端阅读', '检查单列排列、文字换行、图片加载和联系方式，不缩小正文字号。', 'todo', 1],
  ['核对项目证据', '逐个核对结果描述与截图、链接；未验证的数据先移出正文。', 'todo', 5],
  ['检查键盘操作', '用 Tab 到达所有项目链接，检查焦点和返回路径。', 'todo', 5],
  ['确定第一版范围', '保留三个项目；博客和复杂动效放到后续版本。', 'done', 0],
  ['补全联系方式', '确认邮箱和项目链接有效，并在手机上完成一次点击检查。', 'done', 0],
  ['整理项目素材', '按三个项目分别保存截图、项目说明和公开链接。', 'done', 0],
] as const;

export function createPortfolioTasks(): TaskRequest {
  const seed: TaskState = {
    status: 'ready',
    store: {
      revision: 0,
      boardEnabled: true,
      viewMode: 'expanded',
      syncEnabled: false,
      bindings: { calendarId: '' },
      inflight: null,
      tasks: taskExamples.map(([title, notes, column, priority], i) => ({
        id: `portfolio-${i}`,
        fields: {
          ...emptyFields(),
          title,
          notes,
          column: column === 'done' ? 'todo' : column,
          completed: column === 'done',
          priority,
        },
        archived: false,
        deleteRequested: false,
        remote: null,
        remoteMissing: false,
        conflict: null,
      })),
    },
  };
  const demo = createDemoTasks(seed);
  // 未改过的样本随语言显示；编辑先归一化未改字段，访客内容永不翻译或重置。
  return async <T>(path: string, body?: unknown) => {
    const command = body as
      { id?: string; fields?: TaskState['store']['tasks'][number]['fields'] } | undefined;
    const original = seed.store.tasks.find((task) => task.id === command?.id);
    if (original && command?.fields) {
      const fields = { ...command.fields };
      for (const key of ['title', 'notes'] as const)
        if (fields[key] === tr(original.fields[key])) fields[key] = original.fields[key];
      body = { ...command, fields };
    }
    const state = await demo.request<TaskState>(path, body);
    for (const task of state.store.tasks) {
      const original = seed.store.tasks.find((item) => item.id === task.id);
      for (const key of ['title', 'notes'] as const)
        if (original && task.fields[key] === original.fields[key])
          task.fields[key] = tr(task.fields[key]);
    }
    return state as T;
  };
}

const botExamples = () => [
  {
    id: 'engineering',
    name: tr('工程主管'),
    color: 'black',
    status: 'running',
    preview: tr('正在核对手机布局与图片尺寸，接下来检查键盘路径。'),
    text: tr(
      '已先检查页面结构：简介、作品与联系方式的顺序清楚。\n\n接下来检查：\n- 手机宽度下的文字换行。\n- 截图加载前是否预留宽高。\n- 项目详情返回首页的键盘路径。\n\n这些检查尚未全部完成。',
    ),
  },
  {
    id: 'research',
    name: tr('资料助手'),
    color: 'violet',
    status: 'finished',
    preview: tr('三个项目各保留两张关键截图；记账应用还缺一段个人贡献说明。'),
    text: tr(
      '### 素材清单\n\n- 阅读工具：检索页与摘录页。\n- 活动报名页：报名表与提交结果。\n- 记账应用：分类页与统计页。\n\n记账应用的个人贡献尚未提供，请补充你负责的设计或实现。没有证据的效果数据先不写入。',
    ),
  },
  {
    id: 'design',
    name: tr('设计搭档'),
    color: 'blue',
    status: 'running',
    preview: tr('首页按简介、作品、联系方式排列，手机端把作品改为单列。'),
    text: tr(
      '### 阅读顺序\n\n先让访客知道你做什么，再展示三个项目，最后给出联系方式。\n\n桌面可并排展示项目；小屏改为单列，保留正文大小。每张卡片只保留名称、用途和个人职责，详细过程进入项目页阅读。',
    ),
  },
  {
    id: 'writing',
    name: tr('写作助手'),
    color: 'yellow',
    status: 'interrupted',
    preview: tr('已整理案例结构，结果部分等待可核实的材料后再补写。'),
    text: tr(
      '### 案例结构\n\n1. 背景：项目解决什么问题。\n2. 职责：哪些设计或实现由你完成。\n3. 取舍：为什么选择这个方案。\n4. 结果：用截图、公开链接或已核实数据说明。\n\n目前停在结果部分，尚未补写缺少证据的内容。',
    ),
  },
  {
    id: 'review',
    name: tr('代码审查'),
    color: 'green',
    status: 'finished',
    preview: tr('发布前重点检查图片替代文本、键盘焦点与无效链接。'),
    text: tr(
      '### 发布检查\n\n- [ ] 为有意义的截图补充替代文本。\n- [ ] 用键盘走完首页与项目详情。\n- [ ] 检查减少动态效果时内容是否完整。\n- [ ] 打开每个项目链接和联系方式。\n\n这是一份待执行清单，还不能作为已经通过验收的记录。',
    ),
  },
  {
    id: 'manager',
    name: tr('项目管家'),
    color: 'cyan',
    status: 'finished',
    preview: tr('第一天整理文字与素材，第二天完成布局和检查；博客留到下一版。'),
    text: tr(
      '### 两天安排\n\n**第一天**：确认三个项目范围，整理背景、贡献、截图与链接。\n\n**第二天**：完成首页和项目详情，检查手机阅读、图片加载、键盘与联系方式。\n\n博客、新项目和复杂动效放到后续清单。缺少素材时先标记，不补写成果。',
    ),
  },
];

export function portfolioBots(): NonNullable<BotState['snapshot']> {
  return {
    target: { threadId: 'portfolio-example', token: 'example' },
    catalog: {
      revision: 'portfolio-example',
      stale: false,
      sidebar: {
        version: 1,
        groups: [
          {
            id: 'content',
            kind: 'section',
            name: tr('内容与素材'),
            botIds: ['research', 'writing'],
          },
          {
            id: 'layout',
            kind: 'section',
            name: tr('页面与布局'),
            botIds: ['engineering', 'design'],
          },
          { id: 'review', kind: 'section', name: tr('上线前检查'), botIds: ['review', 'manager'] },
        ],
      },
    },
    bots: botExamples().map(({ id, name, color, status, preview }) => ({
      id,
      name,
      avatar: { shape: 'circle', color },
      occupied: id === 'design',
      unread: id === 'research',
      current: { key: `portfolio-${id}`, status },
      preview,
    })),
  };
}

export const readPortfolioReply: ReplyLoader = async ({ botId, agent, revision }) => {
  const bot = botExamples().find((item) => item.id === botId && item.name === agent);
  if (!bot || revision !== 'portfolio-example')
    throw Error(tr('Bot 资料已变化，请返回最近消息后重试。'));
  return {
    botId,
    agent,
    revision,
    messageId: `portfolio-${botId}`,
    text: bot.text,
    hasAttachments: false,
  };
};

export function portfolioBotAction(data: Record<string, unknown>) {
  const name = String(data.agent);
  return data.action === 'check'
    ? tr('查看「{{name}}」的进度。', { name })
    : data.action === 'followup'
      ? tr('追问「{{name}}」：', { name })
      : data.action === 'stop'
        ? tr('停止「{{name}}」在本聊天中的任务。', { name })
        : tr('请问「{{name}}」：帮我检查作品集方案。', { name });
}

export const portfolioPrompt = () => ({
  original: tr(
    '帮我安排两天完成作品集。三个项目的资料都有一些了，手机上也要好读，别把范围越做越大。',
  ),
  optimized: tr(
    '请制定一个两天内完成个人作品集第一版的计划。\n\n已有项目：阅读工具、活动报名页、记账应用；素材包括项目说明和部分截图。\n\n第一版包含简介、三个项目的背景与个人贡献、联系方式。手机端需清楚可读，保留现有视觉风格，不增加博客或复杂动效。\n\n请按天列出任务、交付物和完成标准，覆盖图片、链接与键盘检查。缺少的素材单列为待补充项，不编造结果或数据。',
  ),
});
