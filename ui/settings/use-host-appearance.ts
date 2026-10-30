/* [INPUT]: 无正文宿主界面外观快照、设置页主题来源与明暗模式。
 * [OUTPUT]: 按导航/标题/输入/按钮/菜单角色映射设置颜色/尺寸及字体动效；接收双色 palettes、保留末次读数。
 * [POS]: 只影响设置文档，不更改功能布局、业务字体偏好或宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef } from 'react';
import type { HostSettingsAppearance } from '../shared/contracts';

export function useHostAppearance(
  snapshot: HostSettingsAppearance | null | undefined,
  theme: 'light' | 'dark',
  source: 'chatgpt' | 'palboo',
  independentTypography = false,
) {
  const palettes = useRef<Partial<Record<'light' | 'dark', HostSettingsAppearance>>>({});
  const last = useRef<HostSettingsAppearance | null>(null);
  if (snapshot && ['light', 'dark'].includes(snapshot.theme) && snapshot.typography) {
    for (const mode of ['light', 'dark'] as const) {
      const saved = snapshot.palettes?.[mode];
      if (saved?.theme === mode && saved.typography) palettes.current[mode] = saved;
    }
    last.current = snapshot;
    palettes.current[snapshot.theme] = snapshot;
  }
  const palette = palettes.current[theme];
  const reducedMotion = source === 'chatgpt' && last.current?.reducedMotion === true;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) root.dataset.settingsReducedMotion = 'true';
    else delete root.dataset.settingsReducedMotion;
    window.dispatchEvent(new Event('settings-motion-change'));
    return () => {
      delete root.dataset.settingsReducedMotion;
    };
  }, [reducedMotion]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.settingsStyle = source;
    if (source !== 'chatgpt') return;
    const colors = Object.fromEntries(
      Object.entries(palette?.colors || {}).filter(
        ([, color]) => typeof color === 'string' && CSS.supports('color', color),
      ),
    );
    // 未观察到另一种模式时使用中性黑白；不会将浅色读数套进深色模式。
    const paper = colors.page || (theme === 'dark' ? '#000000' : '#ffffff');
    const ink = colors.text || (theme === 'dark' ? '#ececec' : '#1f2328');
    const mix = (amount: number) => `color-mix(in srgb, ${ink} ${amount}%, ${paper})`;
    const accent = colors.accent || ink;
    const geometry = palette?.geometry || last.current?.geometry || {};
    const metric = (
      key: keyof NonNullable<HostSettingsAppearance['geometry']>,
      property: string,
      fallback: string,
      modeSpecific = false,
    ) => {
      const value = modeSpecific ? palette?.geometry?.[key] : geometry[key];
      return value && CSS.supports(property, value) ? value : fallback;
    };
    const fontMetric = (
      key: keyof NonNullable<HostSettingsAppearance['geometry']>,
      property: string,
      fallback: string,
    ) => {
      const value = metric(key, property, fallback);
      const base = palette?.typography?.fontSize || last.current?.typography?.fontSize || 16;
      return /^\d+(\.\d+)?px$/.test(value) ? `${parseFloat(value) / base}rem` : value;
    };
    const values: Record<string, string> = {
      '--settings-space': metric('space', 'gap', '0.25rem'),
      '--settings-control-radius': metric('controlRadius', 'border-radius', '0.625rem'),
      '--settings-button-radius': metric('buttonRadius', 'border-radius', '0.75rem'),
      '--settings-toolbar-radius': metric('toolbarRadius', 'border-radius', '9999px'),
      '--settings-popup-radius': metric('menuRadius', 'border-radius', '1rem'),
      '--settings-item-radius': metric('menuItemRadius', 'border-radius', '0.75rem'),
      '--settings-dialog-radius': metric('dialogRadius', 'border-radius', '0.75rem'),
      '--settings-control-height': `max(${metric('controlHeight', 'height', '2.25rem')}, calc(var(--settings-text-size) * 1.5 + 12px))`,
      '--settings-control-padding': metric('controlPadding', 'padding', '0.75rem'),
      '--settings-button-gap': metric('buttonGap', 'gap', '4px'),
      '--settings-menu-padding': metric('menuPadding', 'padding', '0.25rem'),
      '--settings-item-padding': metric('menuItemPadding', 'padding', '0.3125rem 0.5rem'),
      '--settings-item-height': metric('menuItemHeight', 'min-height', '2.25rem'),
      '--settings-switch-width': metric('switchWidth', 'width', '32px'),
      '--settings-switch-height': metric('switchHeight', 'height', '19px'),
      '--settings-switch-size': metric('switchThumbSize', 'width', '13px'),
      '--settings-switch-offset': metric('switchOffset', 'padding', '3px'),
      '--settings-switch-shadow': metric('switchShadow', 'box-shadow', '0 1px 2px #0003'),
      '--settings-corner-shape': metric('cornerShape', 'corner-shape', 'round'),
      '--settings-menu-shadow': metric(
        'menuShadow',
        'box-shadow',
        theme === 'dark' ? '0 8px 24px #0006' : '0 8px 24px #0002',
        true,
      ),
      '--settings-menu-blur': metric('menuBlur', 'backdrop-filter', 'none', true),
      '--settings-dialog-shadow': metric('dialogShadow', 'box-shadow', '0 16px 48px #0003', true),
      '--settings-menu-font-size': fontMetric('menuFontSize', 'font-size', '0.875rem'),
      '--settings-menu-line-height': fontMetric('menuLineHeight', 'line-height', '1.5'),
      '--settings-menu-gap': metric('menuGap', 'gap', '0.375rem'),
      '--settings-button-weight': metric('buttonWeight', 'font-weight', '400'),
      '--settings-nav-size': fontMetric('navFontSize', 'font-size', '0.875rem'),
      '--settings-nav-line-height': fontMetric('navLineHeight', 'line-height', '1.4286'),
      '--settings-nav-radius': metric('navRadius', 'border-radius', '0.5rem'),
      '--settings-nav-weight': metric('navWeight', 'font-weight', '400'),
      '--settings-nav-group-weight': metric('navGroupWeight', 'font-weight', '500'),
      '--settings-nav-group-color': colors.tertiary || colors.muted || mix(55),
      '--settings-heading-size': fontMetric('headingSize', 'font-size', '1rem'),
      '--settings-heading-line-height': fontMetric('headingLineHeight', 'line-height', '1.625'),
      '--settings-heading-weight': metric('headingWeight', 'font-weight', '600'),
      '--settings-heading-tracking': metric('headingTracking', 'letter-spacing', 'normal'),
      '--settings-control-duration': metric('transitionDuration', 'transition-duration', '150ms'),
      '--settings-control-ease': metric('transitionEase', 'transition-timing-function', 'ease'),
      '--settings-menu-enter': metric('enterDuration', 'transition-duration', '200ms'),
      '--settings-menu-exit': metric('transitionDuration', 'transition-duration', '150ms'),
      '--settings-ease': metric('enterEase', 'transition-timing-function', 'ease-out'),
      '--settings-exit-ease': metric('exitEase', 'transition-timing-function', 'ease-in'),
      '--settings-tooltip-radius': metric('tooltipRadius', 'border-radius', '0.75rem'),
      '--settings-tooltip-shape': metric('tooltipShape', 'corner-shape', 'round'),
      '--settings-tooltip-shadow': metric('tooltipShadow', 'box-shadow', '0 8px 18px #0003', true),
      '--settings-tooltip-size': fontMetric('tooltipSize', 'font-size', '0.875rem'),
      '--settings-tooltip-weight': metric('tooltipWeight', 'font-weight', '400'),
      '--settings-tooltip-line-height': fontMetric('tooltipLineHeight', 'line-height', '1.4'),
      '--settings-tooltip-tracking': metric('tooltipTracking', 'letter-spacing', 'normal'),
      '--settings-tooltip-padding-block': metric('tooltipPaddingBlock', 'padding', '5px'),
      '--settings-tooltip-padding-inline': metric('tooltipPaddingInline', 'padding', '12px'),
      '--settings-tooltip-background': colors.tooltip || ink,
      '--settings-tooltip-text': colors.tooltipText || paper,
      '--settings-tooltip-border': colors.tooltipBorder || 'transparent',
      '--settings-scrollbar-hover': colors.scrollbarHover || colors.scrollbar || mix(40),
      '--settings-input-hover-border': colors.inputHoverBorder || colors.border || mix(25),
      '--settings-input-focus-border': colors.inputFocusBorder || colors.focus || accent,
      '--settings-input-border': colors.inputBorder || colors.border || mix(15),
      '--settings-ghost-hover': colors.ghostHover || colors.hover || mix(5),
      '--settings-ghost-active': colors.ghostActive || colors.ghostHover || mix(12),
      '--settings-segmented': colors.segmented || mix(10),
      '--settings-segmented-hover': colors.segmentedHover || mix(15),
      '--settings-slider-track': colors.sliderTrack || colors.border || mix(15),
      '--settings-placeholder': colors.placeholder || colors.muted || mix(65),
      '--settings-disabled-background': colors.disabledBackground || mix(5),
      '--settings-disabled-border': colors.disabledBorder || mix(6),
      '--settings-disabled-text': colors.disabledText || mix(45),
      '--settings-button-background': colors.primary || accent,
      '--settings-button-hover': colors.primaryHover || colors.primary || accent,
      '--settings-button-active': colors.primaryActive || colors.primaryHover || accent,
      '--settings-button-text': colors.primaryText || colors.onAccent || paper,
      '--settings-menu-hover': colors.menuHover || colors.hover || mix(6),
      '--settings-backdrop': colors.backdrop || (theme === 'dark' ? '#0008' : '#0005'),
      '--settings-selection': colors.selection || colors.selected || mix(15),
      '--settings-scrollbar': colors.scrollbar || mix(30),
      '--settings-switch-disabled': colors.switchDisabled || mix(8),
      '--settings-switch-on-disabled': colors.switchOnDisabled || mix(25),
      '--settings-switch-thumb-disabled': colors.switchThumbDisabled || paper,
      '--buddy-page': paper,
      '--buddy-surface': colors.surface || paper,
      '--buddy-text': ink,
      '--buddy-muted': colors.muted || mix(65),
      '--buddy-border': colors.border || mix(14),
      '--buddy-input': colors.input || mix(4),
      '--buddy-subtle': colors.hover || mix(6),
      '--buddy-accent': accent,
      '--buddy-focus': colors.focus || accent,
      '--settings-control-border': colors.border || mix(14),
      '--settings-control-hover': colors.hover || mix(6),
      '--settings-menu-surface': colors.menu || colors.surface || paper,
      '--settings-rule': colors.border || mix(14),
      '--settings-orange': colors.accentText || accent,
      '--settings-accent-text': colors.accentText || accent,
      '--settings-selected': colors.selected || mix(10),
      '--settings-selected-text': ink,
      '--settings-switch-on': colors.switchOn || accent,
      '--settings-switch-thumb': colors.switchThumb || '#ffffff',
      '--switch-track': colors.switchTrack || mix(15),
      '--settings-primary-text': colors.onAccent || paper,
      '--error-foreground': colors.danger || (theme === 'dark' ? '#ff8583' : '#b42318'),
      '--error': `color-mix(in srgb, var(--error-foreground) 8%, ${paper})`,
      '--error-border': `color-mix(in srgb, var(--error-foreground) 25%, ${paper})`,
      '--notice': mix(4),
      '--notice-border': colors.border || mix(14),
      '--notice-foreground': ink,
      '--settings-text-size': 'var(--buddy-type-size, 16px)',
    };
    for (const [key, value] of Object.entries(values)) root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(values)) root.style.removeProperty(key);
    };
  }, [palette, theme, source, snapshot]);
  return source === 'chatgpt' || independentTypography
    ? palette?.typography || last.current?.typography
    : undefined;
}
