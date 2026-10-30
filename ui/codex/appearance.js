/*
 * [INPUT]: 宿主页面标记、字体与主题。
 * [OUTPUT]: 宿主字体、主题、可用内容区域及设置页独立外观、尺寸与减少动效快照。
 * [POS]: 宿主外观适配边界，不依赖胶囊视图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  CHIP_HEIGHT,
  CHIP_WIDTH,
  CHROME_FONT_RATIO,
  HOST_FONT_FAMILY_FALLBACK,
  HOST_FONT_SIZE_FALLBACK,
  HOST_FONT_SIZE_MAX,
  HOST_FONT_SIZE_MIN,
  ICON_FONT_RATIO,
  IS_POPOUT,
  ITEM_FONT_RATIO,
  PANEL_SAFE_MARGIN,
} from '../shared/constants.js';
import { clamp, roundPixel } from './runtime/state.js';

function contentSafeBounds() {
  if (IS_POPOUT)
    return {
      left: 12,
      top: 12,
      right: window.innerWidth - 12,
      bottom: window.innerHeight - 12,
      width: window.innerWidth - 24,
      height: window.innerHeight - 24,
    };
  const viewportWidth = Math.max(80, window.innerWidth || 0);
  const viewportHeight = Math.max(80, window.innerHeight || 0);
  let left = PANEL_SAFE_MARGIN;
  let top = PANEL_SAFE_MARGIN;
  let right = viewportWidth - PANEL_SAFE_MARGIN;
  let bottom = viewportHeight - PANEL_SAFE_MARGIN;

  const leftPanel = document.querySelector('aside.app-shell-left-panel');
  if (leftPanel instanceof Element) {
    const rect = leftPanel.getBoundingClientRect();
    if (rect.width >= 48 && rect.right > 40 && rect.right < viewportWidth * 0.62) {
      left = Math.max(left, rect.right + PANEL_SAFE_MARGIN);
    }
  }

  const mainStage = document.querySelector(
    'main.main-surface, .app-shell-main-content-viewport, .app-shell-main-content-frame',
  );
  if (mainStage instanceof Element) {
    const rect = mainStage.getBoundingClientRect();
    if (rect.width >= 160) {
      if (rect.left > 40 && rect.left < viewportWidth * 0.62) {
        left = Math.max(left, rect.left + PANEL_SAFE_MARGIN);
      }
      if (rect.right > left + 80 && rect.right <= viewportWidth + 2) {
        right = Math.min(right, rect.right - PANEL_SAFE_MARGIN);
      }
      if (rect.top >= 0 && rect.top < viewportHeight * 0.4) {
        top = Math.max(top, rect.top + PANEL_SAFE_MARGIN);
      }
      if (rect.bottom > top + 80 && rect.bottom <= viewportHeight + 2) {
        bottom = Math.min(bottom, rect.bottom - PANEL_SAFE_MARGIN);
      }
    }
  }

  const rightRail = document.querySelector(
    "aside.app-shell-right-panel, [data-testid='right-sidebar'], aside.app-shell-secondary-panel",
  );
  if (rightRail instanceof Element) {
    const rect = rightRail.getBoundingClientRect();
    if (rect.width >= 48 && rect.left > viewportWidth * 0.45 && rect.left < viewportWidth - 40) {
      right = Math.min(right, rect.left - PANEL_SAFE_MARGIN);
    }
  }

  document
    .querySelectorAll(
      ".app-header-tint, .draggable.flex.h-toolbar, [class*='h-toolbar'].draggable, header",
    )
    .forEach((bar) => {
      if (!(bar instanceof Element)) return;
      const rect = bar.getBoundingClientRect();
      if (rect.height < 28 || rect.height > 96) return;
      if (rect.top > 24 || rect.width < viewportWidth * 0.45) return;
      top = Math.max(top, rect.bottom + PANEL_SAFE_MARGIN);
    });

  if (bottom - top < CHIP_HEIGHT) {
    top = PANEL_SAFE_MARGIN;
  }

  if (right - left < CHIP_WIDTH) {
    left = PANEL_SAFE_MARGIN;
    right = viewportWidth - PANEL_SAFE_MARGIN;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function fallbackHostTypography() {
  const hostFontSize = HOST_FONT_SIZE_FALLBACK;
  return {
    source: 'fallback',
    fontFamily: HOST_FONT_FAMILY_FALLBACK,
    fontWeight: 400,
    labelWeight: 500,
    hostFontSize,
    baseItemFontSize: roundPixel(hostFontSize * ITEM_FONT_RATIO),
    chromeFontSize: roundPixel(hostFontSize * CHROME_FONT_RATIO),
    iconFontSize: roundPixel(hostFontSize * ICON_FONT_RATIO),
  };
}

function hostTypographySource() {
  const trigger = visibleTypographyNode('[data-codex-intelligence-trigger]');
  if (trigger) return { element: trigger, source: 'model-trigger' };
  const composer = visibleTypographyNode(
    '[data-codex-composer] .ProseMirror, [data-codex-composer] [contenteditable="true"], .ProseMirror, [contenteditable="true"]',
  );
  if (composer) return { element: composer, source: 'composer' };
  const textarea = visibleTypographyNode('textarea');
  if (textarea) return { element: textarea, source: 'textarea' };
  if (document.body) return { element: document.body, source: 'body' };
  return { element: document.documentElement, source: 'document' };
}

function readHostTypography() {
  const { element, source } = hostTypographySource();
  if (!(element instanceof Element)) return fallbackHostTypography();
  const computed = getComputedStyle(element);
  const parsedSize = Number.parseFloat(computed.fontSize);
  const parsedWeight = Number.parseInt(computed.fontWeight, 10);
  const hostFontSize = clamp(
    Number.isFinite(parsedSize) ? parsedSize : HOST_FONT_SIZE_FALLBACK,
    HOST_FONT_SIZE_MIN,
    HOST_FONT_SIZE_MAX,
  );
  const fontWeight = Number.isFinite(parsedWeight) ? parsedWeight : 400;
  return {
    source,
    fontFamily: computed.fontFamily || HOST_FONT_FAMILY_FALLBACK,
    fontWeight,
    labelWeight: clamp(fontWeight + 100, 500, 700),
    hostFontSize: roundPixel(hostFontSize),
    baseItemFontSize: roundPixel(hostFontSize * ITEM_FONT_RATIO),
    chromeFontSize: roundPixel(hostFontSize * CHROME_FONT_RATIO),
    iconFontSize: roundPixel(hostFontSize * ICON_FONT_RATIO),
  };
}

function typographyFingerprint(value) {
  return [
    value.source,
    value.fontFamily,
    value.fontWeight,
    value.hostFontSize,
    value.baseItemFontSize,
  ].join('|');
}

function parseRgb(color) {
  const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function luminance(rgb) {
  if (!rgb) return 0;
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function detectCodexTheme() {
  const rootClass = document.documentElement.classList;
  if (rootClass.contains('electron-dark') || rootClass.contains('theme-dark')) return 'dark';
  if (rootClass.contains('electron-light') || rootClass.contains('theme-light')) return 'light';

  const bodyClass = document.body?.classList;
  if (bodyClass?.contains('electron-dark') || bodyClass?.contains('theme-dark')) return 'dark';
  if (bodyClass?.contains('electron-light') || bodyClass?.contains('theme-light')) return 'light';

  const explicitTokens = [
    document.documentElement.getAttribute('data-theme'),
    document.documentElement.getAttribute('color-scheme'),
    document.body?.getAttribute('data-theme'),
    getComputedStyle(document.documentElement).colorScheme,
  ].join(' ');
  if (/\bdark\b/i.test(explicitTokens)) return 'dark';
  if (/\blight\b/i.test(explicitTokens)) return 'light';

  const candidates = [
    document.querySelector('.thread-scroll-container'),
    document.querySelector('main'),
    document.body,
    document.documentElement,
  ].filter(Boolean);
  for (const node of candidates) {
    const color = getComputedStyle(node).backgroundColor;
    const rgb = parseRgb(color);
    if (rgb && rgb.a > 0.05) return luminance(rgb) < 128 ? 'dark' : 'light';
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function visibleTypographyNode(selector) {
  return (
    Array.from(document.querySelectorAll(selector)).find(
      (node) => node.getClientRects().length > 0,
    ) || null
  );
}

// 只采集设置页需要的语义样式，不读取聊天、修改宿主主题或复制宿主样式表。
function readSettingsAppearance() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name) => style.getPropertyValue(name).trim();
  const sources = {
    page: ['--app-color-background-surface', '--chat-background-color'],
    surface: ['--color-background-elevated-primary-opaque'],
    text: ['--app-color-text-foreground', '--color-token-text-primary'],
    muted: ['--app-color-text-foreground-secondary'],
    accent: ['--codex-theme-accent-color', '--color-token-charts-blue'],
    accentText: ['--app-color-text-accent', '--color-token-text-link-foreground'],
    onAccent: ['--app-color-text-on-accent'],
    border: ['--color-token-input-border', '--color-border'],
    hover: ['--color-token-list-hover-background', '--color-background-secondary-soft-hover'],
    input: ['--color-background-primary-soft-alpha'],
    selected: ['--app-color-background-accent-hover'],
    focus: ['--color-token-focus-border'],
    switchTrack: ['--switch-track-color'],
    switchOn: ['--switch-track-color-checked'],
    switchThumb: ['--switch-thumb-color'],
    danger: ['--color-text-danger', '--color-token-error-foreground'],
    inputHoverBorder: ['--input-outline-border-color-hover'],
    inputFocusBorder: ['--input-outline-border-color-focus'],
    placeholder: ['--input-placeholder-text-color', '--color-token-input-placeholder-foreground'],
    disabledBackground: ['--color-background-disabled'],
    disabledBorder: ['--color-border-disabled'],
    disabledText: ['--color-text-disabled', '--color-token-disabled-foreground'],
    primary: ['--color-background-primary-solid'],
    primaryHover: ['--color-background-primary-solid-hover'],
    primaryActive: ['--color-background-primary-solid-active'],
    primaryText: ['--color-text-primary-solid'],
    menu: ['--menu-background-color'],
    menuHover: ['--menu-item-background-color'],
    backdrop: ['--dialog-backdrop-dim-background', '--modal-backdrop-background'],
    selection: ['--color-background-text-selection'],
    scrollbar: ['--color-token-scrollbar-slider-background', '--scrollbar-color'],
    switchDisabled: ['--switch-track-color-disabled'],
    switchOnDisabled: ['--switch-track-color-checked-disabled'],
    switchThumbDisabled: ['--switch-thumb-color-disabled'],
  };
  const colors = {};
  for (const [name, keys] of Object.entries(sources)) {
    const color = keys.map(token).find((value) => value && CSS.supports('color', value));
    if (color) colors[name] = color;
  }
  if (!colors.page || !colors.text) return null;
  const size = Number.parseFloat(style.fontSize) || 16;
  const uiFamily = token('--font-ui-family');
  const family =
    !uiFamily || /^(inherit|initial|unset)$/.test(uiFamily) ? style.fontFamily : uiFamily;
  const metrics = {
    space: ['--spacing', 'gap'],
    controlRadius: ['--control-radius-md', 'border-radius'],
    buttonRadius: ['--radius-button-action', 'border-radius'],
    menuRadius: ['--menu-radius', 'border-radius'],
    menuItemRadius: ['--menu-item-radius', 'border-radius'],
    dialogRadius: ['--dialog-radius', 'border-radius'],
    controlHeight: ['--control-size-lg', 'height'],
    controlPadding: ['--control-gutter-md', 'padding'],
    buttonGap: ['--button-gap-md', 'gap'],
    menuPadding: ['--menu-gutter', 'padding'],
    menuItemPadding: ['--menu-item-padding', 'padding'],
    switchWidth: ['--switch-track-width', 'width'],
    switchHeight: ['--switch-track-height', 'height'],
    switchThumbSize: ['--switch-thumb-size', 'width'],
    switchOffset: ['--switch-thumb-offset', 'padding'],
    switchShadow: ['--switch-thumb-shadow', 'box-shadow'],
    cornerShape: ['--codex-corner-shape', 'corner-shape'],
    menuShadow: ['--menu-box-shadow', 'box-shadow'],
    menuBlur: ['--menu-backdrop-filter', 'backdrop-filter'],
    dialogShadow: ['--modal-backdrop-dim-shadow', 'box-shadow'],
    menuFontSize: ['--menu-font-size', 'font-size'],
    menuLineHeight: ['--menu-line-height', 'line-height'],
    menuGap: ['--menu-item-gap', 'gap'],
    buttonWeight: ['--button-font-weight', 'font-weight'],
    headingWeight: ['--text-form-title--font-weight', 'font-weight'],
    headingTracking: ['--text-form-title--letter-spacing', 'letter-spacing'],
    transitionDuration: ['--transition-duration-basic', 'transition-duration'],
    transitionEase: ['--transition-ease-basic', 'transition-timing-function'],
    enterDuration: ['--transition-duration-moderate', 'transition-duration'],
    enterEase: ['--ease-enter', 'transition-timing-function'],
  };
  const geometry = {};
  for (const [name, [variable, property]] of Object.entries(metrics)) {
    const value = token(variable);
    if (value && CSS.supports(property, value)) geometry[name] = value;
  }
  return {
    theme: detectCodexTheme(),
    colors,
    geometry,
    reducedMotion:
      root.dataset.reducedMotion === 'true' ||
      (root.dataset.reducedMotion !== 'false' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches),
    typography: {
      fontFamily: family,
      fontSize: size,
      fontWeight: token('--font-ui-weight') || style.fontWeight,
      lineHeight: Number.parseFloat(style.lineHeight) || size * 1.5,
      letterSpacing: style.letterSpacing,
      titleFamily: family,
      titleSize: size,
      titleWeight: token('--font-weight-semibold') || '600',
      zoom: 1,
      source: 'interface',
    },
  };
}

export {
  contentSafeBounds,
  detectCodexTheme,
  fallbackHostTypography,
  readHostTypography,
  readSettingsAppearance,
  typographyFingerprint,
};
