/* [INPUT]: Website locale and the shared portfolio scenario.
 * [OUTPUT]: Synthetic notes with math/diagrams, related links and workbook pages for the reader demonstration.
 * [POS]: Website-only content; no filesystem paths, remote requests or user configuration.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
import type { Note } from '../reader/api';
import type { Workbook } from '../reader/spreadsheet-view';

export function libraryNotes(): Note[] {
  const notes = [
    {
      id: 'plan.md',
      title: tr('作品集计划'),
      markdown: [
        '---\ntags: [Palboo, portfolio]\nstatus: draft\n---',
        `# ${tr('作品集计划')}`,
        `> [!tip]+ ${tr('设计取舍')}\n> ==${tr('用三个作品，说明我怎样发现问题、做出取舍，再把方案落到细节。第一版先把内容讲清楚。')}==`,
        `## ${tr('三个作品，一条主线')}`,
        `- **${tr('阅读工具')}**${tr('：从收藏到找回，让重要内容不再沉底。')}`,
        `- **${tr('活动报名页')}**${tr('：缩短填写路径，把提交结果说清楚。')}`,
        `- **${tr('记账应用')}**${tr('：整理分类与统计，让收支更容易理解。')}`,
        `## ${tr('每个案例讲什么')}`,
        tr(
          '先交代背景和我的职责，再用两张关键截图说明设计取舍。结果只写能核实的内容，不用形容词代替证据。',
        ),
        tr(
          '先读 [[reading-tool.md|阅读工具]] 的案例草稿，再对照 [[assets.xlsx|素材清单]] 补齐截图。',
        ),
        `## ${tr('上线之前')}`,
        tr(
          '首页保留简介、作品和联系方式。手机上改为单列，保持文字可读；发布前逐项完成 [[launch.md|上线检查]]。',
        ),
      ].join('\n\n'),
    },
    {
      id: 'reading-tool.md',
      title: tr('阅读工具'),
      markdown: [
        `# ${tr('阅读工具')}`,
        tr('收藏之后，仍然找得到。'),
        `## ${tr('从一个具体问题开始')}`,
        tr(
          '阅读资料越来越多，真正需要时却只记得一个关键词。这个案例围绕检索、摘录和返回原文，整理一条连续的阅读路径。',
        ),
        `## ${tr('设计取舍')}`,
        tr(
          '搜索结果同时显示标题与命中段落，先判断是否相关，再进入正文。摘录保留来源，回到原文时继续上一次的阅读位置。',
        ),
        '```mermaid\nflowchart LR\n  A["' +
          tr('搜索') +
          '"] --> B["' +
          tr('阅读') +
          '"] --> C["' +
          tr('摘录') +
          '"]\n  C --> B\n```',
        `## ${tr('检索指标')}`,
        tr('查准率表示找到的内容中，有多少与当前问题相关。'),
        '$$\nP = \\frac{TP}{TP + FP}\n$$',
        `## ${tr('需要补齐的材料')}`,
        `- ${tr('检索页：展示关键词与命中段落。')}\n- ${tr('摘录页：展示内容与原文的关系。')}\n- ${tr('个人贡献：写清自己负责的设计和实现。')}`,
        tr('回到 [[plan.md|作品集计划]]，继续整理其他案例。'),
      ].join('\n\n'),
    },
    {
      id: 'event-page.md',
      title: tr('活动报名页'),
      markdown: [
        `# ${tr('活动报名页')}`,
        tr('让填写、确认和提交连成一条清楚的路径。'),
        `## ${tr('填写之前')}`,
        tr('先展示活动时间、地点和报名条件，表单只保留本次活动确实需要的信息。'),
        `## ${tr('提交之后')}`,
        tr('成功页明确说明报名结果和下一步；失败时保留已填写的内容，把问题放在对应字段旁边。'),
        `## ${tr('案例素材')}`,
        tr('用表单和提交结果两张截图说明整个流程，具体素材记录在 [[assets.xlsx|素材清单]]。'),
      ].join('\n\n'),
    },
    {
      id: 'launch.md',
      title: tr('上线检查'),
      markdown: [
        `# ${tr('上线检查')}`,
        tr('发布前，按真实的阅读顺序走一遍。'),
        `## ${tr('内容与链接')}`,
        tr(
          '- [ ] 每个作品都有背景、职责和设计取舍。\n- [ ] 截图与说明对应，替代文本清楚。\n- [ ] 项目链接与联系方式可以打开。',
        ),
        `## ${tr('阅读与操作')}`,
        tr(
          '- [ ] 手机宽度下没有横向溢出。\n- [ ] 键盘可以完成所有操作，焦点可见。\n- [ ] 减少动态效果时，内容仍然完整。',
        ),
        tr('范围有变化时，回到 [[plan.md|作品集计划]] 调整。'),
      ].join('\n\n'),
    },
  ];
  return notes.map((note) => ({ ...note, version: 'example', backlinks: [] }));
}

export function libraryWorkbook(sheet: string): Workbook {
  const sheets = [tr('截图'), tr('文字')];
  const copy = sheet === 'copy';
  const rows = copy
    ? [
        [tr('项目'), tr('需要补充'), tr('状态')],
        [tr('阅读工具'), tr('背景与检索流程'), tr('待核对')],
        [tr('活动报名页'), tr('表单与提交反馈'), tr('待核对')],
        [tr('记账应用'), tr('个人贡献'), tr('待补充')],
      ]
    : [
        [tr('项目'), tr('页面'), tr('状态')],
        [tr('阅读工具'), tr('检索页'), tr('待核对')],
        [tr('阅读工具'), tr('摘录页'), tr('待核对')],
        [tr('活动报名页'), tr('报名表'), tr('待核对')],
        [tr('活动报名页'), tr('提交结果'), tr('待补充')],
        [tr('记账应用'), tr('分类页'), tr('待补充')],
        [tr('记账应用'), tr('统计页'), tr('待补充')],
      ];
  return {
    sheets,
    sheet: sheets[copy ? 1 : 0],
    rows,
    offset: 0,
    startRow: 0,
    startColumn: 0,
    totalRows: rows.length,
    totalColumns: 3,
  };
}

export function referenceArticle() {
  return [
    `# ${tr('让作品自己说话')}`,
    tr('一份作品集的阅读笔记：把注意力留给项目，把解释留给关键取舍。'),
    `## ${tr('先看见作品，再了解过程')}`,
    tr(
      '首页用名称和一句用途帮助访客选择。进入案例后，按问题、职责、方案和结果展开，不让所有细节挤在同一层。',
    ),
    `## ${tr('留白也是信息层级')}`,
    tr(
      '相关内容靠近，不同话题留出间隔。标题与正文形成清楚的节奏，手机上保持阅读字号，而不是把桌面页面缩小。',
    ),
    `## ${tr('用证据收尾')}`,
    tr('截图说明实际界面，文字解释为什么这样做。没有验证的结果先留空，个人贡献写到具体动作。'),
  ].join('\n\n');
}
