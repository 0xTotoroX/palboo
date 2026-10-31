import { SegmentedGroup } from './components/ui/segmented-group';
/* [INPUT]: Safe settings snapshots and shared feature/model preview adapters.
 * [OUTPUT]: Square compatibility scene showing Agent selection and the official-model boundary.
 * [POS]: In-memory demonstration only; never installs, starts, switches or requests a real Agent.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { Icon } from '../shared/icons/react';
import type { EditableSettings, View } from './api';
import type { TaskState } from '../features/board/api';
import type { ModelState } from '../features/model/catalog';
import { NativeSelect } from './components/ui/native-select';
import { FeaturePreviewContent } from './feature-preview';
import { ModelPreview } from './model-preview';
import { PreviewFrame } from './preview-frame';

export function CodexHostPreview({
  form,
  view,
  tasks,
  model,
}: {
  form: EditableSettings | null;
  view: View | null;
  tasks: TaskState | null;
  model: ModelState | null;
}) {
  useLocale();
  const [agent, setAgent] = useState('Codex');
  const [feature, setFeature] = useState('next');
  return (
    <PreviewFrame title={tr('兼容集成预览')} className="preview-compatibility">
      <header className="compatibility-preview-header">
        <span>ChatGPT</span>
        <span className="compatibility-preview-provider">CodexHost</span>
      </header>
      <SegmentedGroup
        value={feature}
        className="preview-selector"
        role="group"
        aria-label={tr('兼容功能预览')}
      >
        <button type="button" aria-pressed={feature === 'next'} onClick={() => setFeature('next')}>
          {tr('下一步')}
        </button>
        <button
          type="button"
          aria-pressed={feature === 'model'}
          onClick={() => setFeature('model')}
        >
          {tr('模型切换')}
        </button>
      </SegmentedGroup>
      <div className="compatibility-preview-content">
        <div hidden={feature !== 'next'}>
          <FeaturePreviewContent id="next" form={form} view={view} tasks={tasks} />
        </div>
        <div hidden={feature !== 'model' || agent !== 'Codex'}>
          <ModelPreview model={model} />
        </div>
        {feature === 'model' && agent !== 'Codex' && (
          <div className="compatibility-preview-boundary" role="status">
            <Icon name="feature-model" />
            <p>{tr('当前使用 {{agent}}，请通过 CodexHost 切换模型', { agent })}</p>
          </div>
        )}
      </div>
      <div className="compatibility-preview-agent">
        <label htmlFor="preview-compatibility-agent">{tr('示例 Agent')}</label>
        <NativeSelect
          id="preview-compatibility-agent"
          value={agent}
          onChange={(event) => setAgent(event.target.value)}
          controlWidth="short"
        >
          <option>Codex</option>
          <option>OpenCode</option>
        </NativeSelect>
      </div>
    </PreviewFrame>
  );
}
