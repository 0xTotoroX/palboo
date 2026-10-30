/* [INPUT]: 已识别聊天的正文元素、宿主字体变量和祖先 CSS zoom。
 * [OUTPUT]: 按来源稳定缓存的只读快照、分窗口字体解析与有效布局缩放；不包含聊天文本。
 * [POS]: 宿主排版适配；由统一字体跟随、术语与工作台消费，不修改宿主样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  layoutZoom,
  defaultTypography,
  fallbackTypography,
  resolveTypography,
  surfaceTypography,
} from '../shared/typography';
export { layoutZoom } from '../shared/typography';
export function readTypography(element = document.body, paragraph = true) {
  const source =
    (paragraph && element?.closest('p,li')) ||
    (paragraph && element?.querySelector('p,li')) ||
    element ||
    document.documentElement;
  const style = getComputedStyle(source),
    tokens = getComputedStyle(document.documentElement);
  const size = Number.parseFloat(style.fontSize) || 16;
  const titleToken = tokens.getPropertyValue('--text-base').trim();
  const titleSize = /^\d+(\.\d+)?px$/.test(titleToken) ? Number.parseFloat(titleToken) : size;
  return {
    fontFamily: style.fontFamily,
    fontSize: size,
    fontWeight: style.fontWeight,
    lineHeight: Number.parseFloat(style.lineHeight) || size * 1.6,
    letterSpacing: style.letterSpacing,
    titleFamily: tokens.getPropertyValue('--font-ui-family').trim() || style.fontFamily,
    titleSize,
    titleWeight: tokens.getPropertyValue('--font-weight-semibold').trim() || '600',
    zoom: layoutZoom(source),
  };
}
export function sessionTypography(fallback) {
  return (
    window.__palbooTypography?.resolved() ||
    window.__palbooTerminology?.typography?.() ||
    readTypography(fallback)
  );
}

// 缺少有效宿主节点时保留上次值；新读数连续两次一致才发布，避免切换动画和空页面闪回默认值。
export function createTypographyTracker(getRoot, getComposer) {
  let preferences = { ...defaultTypography };
  let last = { ...fallbackTypography };
  let surfaces = {};
  const samples = new Map(),
    pending = new Map();
  function visible(node) {
    return (
      node instanceof HTMLElement &&
      node.isConnected &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== 'hidden' &&
      !node.closest('[inert],[aria-hidden="true"]')
    );
  }
  function sample(name = preferences.source) {
    const root = getRoot();
    let source;
    if (name === 'composer') source = getComposer();
    else if (name === 'session')
      source = Array.from(
        document.querySelectorAll(
          'aside.app-shell-left-panel [data-marquee-text] [data-marquee-content], aside.app-shell-left-panel [data-thread-id] [class*="truncate"], aside.app-shell-left-panel a[href*="/threads/"] [class*="truncate"], aside.app-shell-left-panel a[href*="/threads/"]',
        ),
      ).find(visible);
    else if (visible(root))
      source = Array.from(
        root.querySelectorAll(
          '[data-message-author-role="assistant"] p, [data-message-author-role="user"] p, [data-content-search-turn-key] p, .markdown p',
        ),
      ).find(visible);
    if (!visible(source)) {
      pending.delete(name);
      return samples.get(name) || last;
    }
    const next = {
      ...readTypography(source, name === 'body'),
      source: name,
    };
    const key = JSON.stringify(next);
    const previous = pending.get(name);
    if (previous?.key === key && performance.now() - previous.at >= 200) {
      samples.set(name, next);
    }
    if (previous?.key !== key) pending.set(name, { key, at: performance.now() });
    return samples.get(name) || last;
  }
  function snapshot() {
    for (const source of /** @type {const} */ (['body', 'session', 'composer'])) sample(source);
    last = samples.get(preferences.source) || last;
    return { ...last, sources: Object.fromEntries(samples) };
  }

  return {
    configure(value) {
      const { surfaces: nextSurfaces, ...legacy } = value || {};
      preferences = { ...defaultTypography, ...legacy };
      surfaces = nextSurfaces || {};
    },
    snapshot,
    resolved: (surface) => {
      const value = surface ? surfaceTypography(surface, surfaces, preferences) : preferences;
      return resolveTypography(sample(value.source), value);
    },
    preferences: () => ({ ...preferences }),
  };
}
