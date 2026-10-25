import { tr } from './i18n.js';
/* [INPUT]: Authenticated feature transport and shared business DTOs.
 * [OUTPUT]: Persisted edge navigation, six-feature icon mapping and placement, main ownership, default fonts, recursive split geometry with optional row collapse flags and transient view, preset and quick-prompt draft contracts.
 * [POS]: Presentation boundary. [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import type { BoardView } from '../features/board/app';
export const titles = {
  get outline() {
    return tr('大纲');
  },
  get board() {
    return tr('看板');
  },
  get next() {
    return tr('下一步');
  },
  get model() {
    return tr('模型切换');
  },
  get terms() {
    return tr('术语');
  },
  bots: 'Grok Bot',
};
export type FeatureId = keyof typeof titles;
export const featureIcons: Record<FeatureId, string> = {
  outline: 'feature-outline',
  board: 'feature-board',
  next: 'feature-next',
  model: 'feature-model',
  terms: 'feature-terms',
  bots: 'feature-bots',
};
export type FontSizes = Partial<Record<FeatureId, number>>;
export const defaultFontSizes: Record<FeatureId, number> = {
  outline: 16,
  next: 16,
  board: 15,
  model: 14,
  terms: 14,
  bots: 14,
};
export function featureFontSize(id: FeatureId, sizes?: FontSizes, legacySize?: number) {
  const size =
    sizes?.[id] ??
    (['outline', 'next'].includes(id) ? legacySize : undefined) ??
    defaultFontSizes[id];
  return Math.round(Math.max(10, Math.min(24, size)) * 10) / 10;
}
export type Placement = 'sidebar' | 'overlay' | 'desktop' | 'edge';
export type ModelPresetDraft = {
  id: string;
  name: string;
  selection: { model: string; reasoning: string; speed: string };
  creating: boolean;
};
export type Reading = {
  token?: string;
  top?: number;
  left?: number;
  selected?: number;
  previewTop?: number;
  board?: BoardView;
  termsFilter?: 'current' | 'favorites' | 'mastered';
  termsSelected?: string;
  quickPromptEditing?: boolean;
  quickPromptSaved?: { items: { label: string; prompt: string }[]; revision: number };
  quickPromptDraft?: {
    index: number | null;
    remove: boolean;
    label: string;
    prompt: string;
    revision: number;
    items: { label: string; prompt: string }[];
  };
  modelSearch?: string;
  modelTools?: boolean;
  modelOthers?: boolean;
  modelLeft?: number;
  modelPresetDraft?: ModelPresetDraft;
};
export type Entry = {
  id: FeatureId;
  desktopSupported?: boolean;
  placement: Placement;
  returnPlacement?: Placement;
  open: boolean;
  closing?: boolean;
  owner: string;
  size: [number, number];
  reveal: number;
  view: Reading;
  pending: { placement: Placement; owner: string; ready: boolean } | null;
};
export type LayoutGroup = { ids: string[]; active: string; weight: number; collapsed?: boolean };
export type LayoutNode = LayoutGroup | (FeatureLayout & { weight: number });
export type FeatureLayout = { axis: string; groups: LayoutNode[] };
export type EdgeTabs = { order: string[]; selected: string };
export type FeatureState = {
  edgeTabs?: EdgeTabs;
  edgeTabsRevision?: number;
  mainManaged?: boolean;
  layouts?: Record<string, FeatureLayout>;
  legacyLayouts?: Record<string, import('./contracts').WorkbenchLayout>;
  activeFeature?: string;
  mainPlacement?: Placement;
  returnPlacement?: Placement;
  pendingPlacement?: Placement | null;
  mainWindow?: { lease: string; pid?: number | null; size: [number, number] };
  features: Entry[];
  appearance?: {
    language?: 'system' | 'zh-CN' | 'en';
    typography?: import('./typography').Typography | null;
    typographyPreferences?: import('./typography').TypographyPreferences;
    theme?: string | null;
    fontSize?: number;
    colors?: Record<string, string>;
    themes: Record<string, import('../surfaces/theme/appearance').SurfaceTheme>;
  };
};
export type Request = <T = FeatureState>(input: Record<string, unknown>) => Promise<T>;
