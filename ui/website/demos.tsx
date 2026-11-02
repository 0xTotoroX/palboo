/* [INPUT]: Shared feature names, local drafts and visitor input.
 * [OUTPUT]: Website feature registration, brand eyes and an accessible local composer.
 * [POS]: Shared framing for the opening and combined scenes, no service requests.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useId } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
export { ModelDemo } from './model-demo';
export const features = [
  {
    id: 'next',
    get label() {
      return tr('下一步');
    },
    icon: 'feature-next',
  },
  {
    id: 'prompts',
    get label() {
      return tr('常用语');
    },
    icon: 'feature-prompts',
  },
  {
    id: 'outline',
    get label() {
      return tr('大纲');
    },
    icon: 'feature-outline',
  },
  {
    id: 'board',
    get label() {
      return tr('任务看板');
    },
    icon: 'feature-board',
  },
  {
    id: 'model',
    get label() {
      return tr('模型切换');
    },
    icon: 'feature-model',
  },
  {
    id: 'terms',
    get label() {
      return tr('术语释义');
    },
    icon: 'feature-terms',
  },
  { id: 'bots', label: 'Grok Bot', icon: 'feature-bots' },
] as const;
export function Eyes() {
  useLocale();
  return (
    <span className="demo-eyes" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function ComposerDemo({
  draft,
  onChange,
  label = tr('接着聊'),
}: {
  draft: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  useLocale();
  const id = useId();
  return (
    <div className="demo-composer">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        placeholder={tr('接着聊…')}
        rows={2}
      />
    </div>
  );
}
