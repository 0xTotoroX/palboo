/* [INPUT]: 宿主三种来源的无正文排版快照、分窗口字体偏好和承载节点缩放。
 * [OUTPUT]: 分窗口字体契约、旧偏好继承、字体族回退与跨表面字号补偿。
 * [POS]: 字体纯计算，所有表面共用；不选择宿主来源、不保存配置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export type TypographyPreferences = {
  fontFamily?: string;
  mode: 'follow' | 'custom';
  source: 'body' | 'session' | 'composer';
  scale: number;
  customSize: number;
};
export type Typography = {
  sources?: Partial<Record<TypographyPreferences['source'], Typography>>;
  fontFamily: string;
  fontStyle?: string;
  fontStretch?: string;
  fontFeatureSettings?: string;
  fontVariationSettings?: string;
  fontOpticalSizing?: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: string;
  titleFamily: string;
  titleSize: number;
  titleWeight: string;
  zoom: number;
  source?: string;
};
export const defaultTypography: TypographyPreferences = {
  fontFamily: '',
  mode: 'follow',
  source: 'body',
  scale: 100,
  customSize: 16,
};
export const typographySurfaces = ['settings', 'sidebar', 'overlay', 'desktop', 'edge'] as const;
export type TypographySurface = (typeof typographySurfaces)[number];
export type SurfaceTypography = Partial<Record<TypographySurface, TypographyPreferences>>;
export function surfaceTypography(
  surface: TypographySurface,
  overrides?: SurfaceTypography,
  legacy?: TypographyPreferences,
): TypographyPreferences {
  return {
    ...defaultTypography,
    ...(overrides?.[surface] || (surface === 'settings' ? undefined : legacy)),
  };
}
export const fallbackTypography: Typography = {
  fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
  fontSize: 16,
  fontWeight: '400',
  lineHeight: 26,
  letterSpacing: 'normal',
  titleFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
  titleSize: 16,
  titleWeight: '600',
  zoom: 1,
  source: 'fallback',
};
export function layoutZoom(element?: Element | null): number {
  let zoom = 1;
  for (
    let node = element;
    node;
    node = node.parentElement || (node.getRootNode() as ShadowRoot).host
  ) {
    const value = Number.parseFloat(getComputedStyle(node).zoom);
    if (Number.isFinite(value) && value > 0) zoom *= value;
  }
  return zoom;
}
export function resolveTypography(
  snapshot?: Typography | null,
  preferences?: Partial<TypographyPreferences>,
): Typography {
  const p = { ...defaultTypography, ...preferences },
    source = snapshot?.sources?.[p.source] || snapshot || fallbackTypography;
  const size = p.mode === 'custom' ? p.customSize : (source.fontSize * p.scale) / 100;
  const ratio = size / source.fontSize;
  return {
    ...source,
    fontFamily: p.fontFamily ? `${p.fontFamily},${source.fontFamily}` : source.fontFamily,
    titleFamily: p.fontFamily ? `${p.fontFamily},${source.titleFamily}` : source.titleFamily,
    fontSize: size,
    titleSize: size,
    lineHeight: source.lineHeight * ratio,
    letterSpacing:
      source.letterSpacing === 'normal'
        ? 'normal'
        : `${(parseFloat(source.letterSpacing) || 0) * ratio}px`,
    zoom: p.mode === 'custom' ? 1 : source.zoom,
  };
}
export function typographyStyle(
  snapshot?: Typography | null,
  preferences?: Partial<TypographyPreferences>,
  localZoom = 1,
) {
  const t = resolveTypography(snapshot, preferences),
    ratio = t.zoom / localZoom;
  return {
    fontFamily: t.fontFamily,
    fontStyle: t.fontStyle || 'normal',
    fontStretch: t.fontStretch || 'normal',
    fontFeatureSettings: t.fontFeatureSettings || 'normal',
    fontVariationSettings: t.fontVariationSettings || 'normal',
    fontOpticalSizing: t.fontOpticalSizing === 'none' ? ('none' as const) : ('auto' as const),
    fontSize: `${t.fontSize * ratio}px`,
    fontWeight: t.fontWeight,
    lineHeight: `${t.lineHeight / t.fontSize}`,
    letterSpacing:
      t.letterSpacing === 'normal' ? 'normal' : `${parseFloat(t.letterSpacing) * ratio}px`,
  };
}
