/*
 * SPDX-License-Identifier: GPL-3.0-only
 * [INPUT]: Palboo 自绘功能图形与 currentColor 主题色。
 * [OUTPUT]: 六个 feature-* SVG；24px 画布、1.8px 圆角描边，按18px显示。
 * [POS]: 自有功能图标资源；与 index.js 中的第三方控件图标分开维护。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
export const featureGlyphs = {
  'feature-outline': `<svg aria-hidden="true" data-icon="feature-outline" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M5 10v7a1 1 0 0 0 1 1h3M10 11h10M12 18h8"/></g></svg>`,
  'feature-next': `<svg aria-hidden="true" data-icon="feature-next" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h15M14.5 7l5 5-5 5"/></g></svg>`,
  'feature-board': `<svg aria-hidden="true" data-icon="feature-board" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.2 4.5V15M14.8 4.5v7"/></g></svg>`,
  'feature-model': `<svg aria-hidden="true" data-icon="feature-model" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/><path d="M13 7h7m-3-3 3 3-3 3M11 17H4m3-3-3 3 3 3"/></g></svg>`,
  'feature-terms': `<svg aria-hidden="true" data-icon="feature-terms" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5h13a1 1 0 0 1 1 1v16h-14a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2ZM3.5 17.5a2 2 0 0 1 2-2h14M8 11l2-5 2 5M8.6 9.5h2.8M15 7h1.5M15 10h1.5"/></g></svg>`,
  'feature-bots': `<svg aria-hidden="true" data-icon="feature-bots" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h10a3.5 3.5 0 0 1 3.5 3.5v7a3.5 3.5 0 0 1-3.5 3.5h-6l-5 3v-3.15A3.5 3.5 0 0 1 3.5 15V8A3.5 3.5 0 0 1 7 4.5Z"/><path d="M9 9.5v4M15 9.5v4" stroke-width="2.5"/></g></svg>`,
};
