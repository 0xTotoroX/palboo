/* [INPUT]: Shared preview language and the existing portfolio outline identities.
 * [OUTPUT]: Short paragraphs and numbered steps for the settings chat scene.
 * [POS]: Synthetic presentation data; never reads real chats or configuration.
 * [PROTOCOL]: Keep shared/AGENTS.md and settings preview contracts in sync. */
import { tr } from './i18n.js';
export const previewQuestion = () => tr('两天内完成个人作品集，先做哪些事？');
export const previewSections = () => [
  {
    id: '0',
    title: tr('确定作品集内容'),
    text: tr('第一版围绕三个项目，讲清你的贡献。'),
    items: [
      tr('阅读工具：检索、摘录与整理。'),
      tr('活动报名页：信息浏览与报名流程。'),
      tr('记账应用：分类、统计与月度回顾。'),
    ],
  },
  {
    id: '1',
    title: tr('安排页面与布局'),
    text: tr('首页保留简介、项目和联系方式。'),
    items: [tr('每个项目先交代问题，再展示过程与结果。'), tr('用两张关键截图说明设计取舍。')],
  },
  {
    id: '1:detail',
    level: 1,
    title: tr('桌面与手机'),
    text: tr('用响应式布局适配宽窄屏，按内容决定断点。保持信息层级与留白，检查可访问性。'),
  },
  {
    id: '2',
    title: tr('上线前检查'),
    text: tr('第二天完成布局与验收。'),
    items: [
      tr('检查手机阅读与键盘焦点。'),
      tr('核对项目链接和联系方式。'),
      tr('请朋友从首页找到一个代表作品。'),
      tr('记录待补素材，再发布第一版。'),
    ],
  },
  {
    id: '2:detail',
    level: 1,
    title: tr('素材与加载'),
    text: tr(
      '为图片预留宽高比，避免布局偏移。首屏加载核心内容，其余素材使用懒加载；补充替代文本，并兼顾减少动态效果。',
    ),
  },
];

export const previewTermSections = () => [
  {
    id: 'terms-layout',
    title: tr('桌面与手机'),
    text: tr('用响应式布局组织作品，按内容决定断点。'),
    items: [tr('信息层级依靠标题与留白，手机端改为单列。'), tr('检查键盘焦点，确保可访问性。')],
  },
  {
    id: 'terms-assets',
    title: tr('素材与加载'),
    text: tr('保留宽高比并预留尺寸，避免布局偏移。'),
    items: [
      tr('首屏加载简介和第一张作品图。'),
      tr('下方素材使用懒加载，并补充替代文本。'),
      tr('开启减少动态效果后，仍能完整阅读与操作。'),
    ],
  },
  {
    id: 'terms-updates',
    title: tr('检查加载顺序'),
    text: tr('切换项目时忽略旧请求的迟到结果，避免竞态条件覆盖当前内容。'),
  },
];
