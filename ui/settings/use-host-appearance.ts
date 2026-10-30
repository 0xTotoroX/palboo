/* [INPUT]: 无正文宿主界面外观快照、设置页主题来源与明暗模式。
 * [OUTPUT]: 设置专属颜色/尺寸变量及界面字体；分别保留浅/深色末次读数。
 * [POS]: 只影响设置文档，不更改功能布局、业务字体偏好或宿主。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef } from 'react';
import type { HostSettingsAppearance } from '../shared/contracts';

export function useHostAppearance(
  snapshot: HostSettingsAppearance | null | undefined,
  theme: 'light' | 'dark',
  source: 'chatgpt' | 'palboo',
) {
  const palettes = useRef<Partial<Record<'light' | 'dark', HostSettingsAppearance>>>({});
  const last = useRef<HostSettingsAppearance | null>(null);
  if (snapshot && ['light', 'dark'].includes(snapshot.theme) && snapshot.typography) {
    last.current = snapshot;
    palettes.current[snapshot.theme] = snapshot;
  }
  const palette = palettes.current[theme];
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
    ) => {
      const value = geometry[key];
      return value && CSS.supports(property, value) ? value : fallback;
    };
    const values: Record<string, string> = {
      '--settings-space': metric('space', 'gap', '0.25rem'),
      '--settings-control-radius': metric('controlRadius', 'border-radius', '0.625rem'),
      '--settings-button-radius': metric('buttonRadius', 'border-radius', '0.75rem'),
      '--settings-popup-radius': metric('menuRadius', 'border-radius', '1rem'),
      '--settings-item-radius': metric('menuItemRadius', 'border-radius', '0.75rem'),
      '--settings-dialog-radius': metric('dialogRadius', 'border-radius', '0.75rem'),
      '--settings-control-height': `max(${metric('controlHeight', 'height', '2.25rem')}, calc(var(--settings-text-size) * 1.5 + 12px))`,
      '--settings-control-padding': metric('controlPadding', 'padding', '0.75rem'),
      '--settings-button-gap': metric('buttonGap', 'gap', '4px'),
      '--settings-menu-padding': metric('menuPadding', 'padding', '0.25rem'),
      '--settings-item-padding': metric('menuItemPadding', 'padding', '0.3125rem 0.5rem'),
      '--settings-switch-width': metric('switchWidth', 'width', '32px'),
      '--settings-switch-height': metric('switchHeight', 'height', '19px'),
      '--settings-switch-size': metric('switchThumbSize', 'width', '13px'),
      '--settings-switch-offset': metric('switchOffset', 'padding', '3px'),
      '--settings-switch-shadow': metric('switchShadow', 'box-shadow', '0 1px 2px #0003'),
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
      '--settings-menu-surface': colors.surface || paper,
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
  return source === 'chatgpt' ? palette?.typography || last.current?.typography : undefined;
}
