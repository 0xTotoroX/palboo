/* [INPUT]: The real website and local GitHub button variants.
 * [OUTPUT]: In-context comparison with native radio and keyboard selection.
 * [POS]: Development-only preview; excluded from the static production build.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useState } from 'react';
import { App } from './app';
import type { GithubLinkVariant } from './github-link';
import './button-presets.css';

const presets = [
  { value: 'text', label: '文字' },
  { value: 'outline', label: '描边' },
  { value: 'solid', label: '实心' },
  { value: 'install', label: '图标＋安装' },
] as const;

export function ButtonPresets() {
  const [variant, setVariant] = useState<GithubLinkVariant>('install');
  return (
    <>
      <App githubVariant={variant} />
      <fieldset className="button-presets">
        <legend className="sr-only">GitHub 按钮预设</legend>
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
