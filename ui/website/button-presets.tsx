import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: The real website and local GitHub button variants.
 * [OUTPUT]: In-context comparison with native radio and keyboard selection.
 * [POS]: Development-only preview; excluded from the static production build.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useState } from 'react';
import { App } from './app';
import type { GithubLinkVariant } from './github-link';
import './button-presets.css';

const presets = [
  {
    value: 'text',
    get label() {
      return tr('文字');
    },
  },
  {
    value: 'outline',
    get label() {
      return tr('描边');
    },
  },
  {
    value: 'solid',
    get label() {
      return tr('实心');
    },
  },
  {
    value: 'download',
    get label() {
      return tr('图标＋下载');
    },
  },
] as const;

export function ButtonPresets() {
  useLocale();
  const [variant, setVariant] = useState<GithubLinkVariant>('download');
  return (
    <>
      <App githubVariant={variant} />
      <fieldset className="button-presets">
        <legend className="sr-only">{tr('GitHub 按钮预设')}</legend>
        {presets.map((preset) => (
          <label key={preset.value}>
            <input
              type="radio"
              name="github-preset"
              value={preset.value}
              checked={variant === preset.value}
              onChange={() => setVariant(preset.value)}
            />
            <span>{preset.label}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
}
