import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Read-only model catalog, saved quota visibility, optional synthetic tour selection and the shared model view.
 * [OUTPUT]: Content-sized model preview with linked quota visibility and isolated in-memory actions.
 * [POS]: No host target, transport, credentials or persisted preference changes.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { ModelView } from '../features/model/view';
import type { Model, ModelState, Selection } from '../features/model/catalog';
import type { Reading } from '../shared/features';

const fallback = (): Model[] =>
  ['A', 'B'].map((id) => ({
    id: `preview-${id}`,
    label: tr('示例模型 {{id}}', { id: id }),
    reasoning: ['low', 'medium', 'high'],
    fast: true,
  }));

function Sample({
  models,
  showUsage,
  usage,
  demoSelection,
}: {
  models: Model[];
  showUsage: boolean;
  usage: ModelState['snapshot']['usage'];
  demoSelection?: Selection;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [state, setState] = useState<ModelState>(() => ({
    revision: 0,
    snapshot: {
      target: { preview: true },
      revision: 'preview',
      status: 'ready',
      message: '',
      models,
      current: {
        model: models[0].id,
        reasoning: models[0].reasoning[0] || '',
        speed: 'standard',
      },
    },
    preferences: { enabled: true, pinned: models.map((m) => m.id), presets: [] },
  }));
  const current = useRef(state);
  useEffect(() => {
    if (!demoSelection) return;
    const next = {
      ...current.current,
      snapshot: { ...current.current.snapshot, current: demoSelection },
    };
    current.current = next;
    setState(next);
  }, [demoSelection]);
  return (
    <div className="preview-model-control" role="group" aria-label={tr('模型切换预览')}>
      <ModelView
        state={{
          ...state,
          snapshot: { ...state.snapshot, models, usage },
          preferences: { ...state.preferences, showUsage },
        }}
        reading={reading.current}
        busy={false}
        footer={
          showUsage && !usage?.length ? (
            <span className="model-usage" aria-label={tr('额度暂无数据')}>
              <span>{tr('周 —')}</span>
              <span>{tr('5小时 —')}</span>
            </span>
          ) : undefined
        }
        action={async (data, action) => {
          const payload = data as {
            selection?: Selection;
            patch?: Partial<ModelState['preferences']>;
          };
          const next = structuredClone(current.current);
          if (action === 'apply' && payload.selection) next.snapshot.current = payload.selection;
          else if (action === 'preferences' && payload.patch)
            Object.assign(next.preferences, payload.patch);
          else if (action !== 'refresh') return null;
          next.revision++;
          current.current = next;
          setState(next);
          return next;
        }}
      />
    </div>
  );
}

export function ModelPreview({
  model,
  demoSelection,
}: {
  model: ModelState | null;
  demoSelection?: Selection;
}) {
  useLocale();
  // Catalog capabilities are safe to reuse. Live targets and current selections never enter the demo.
  const catalog = model?.snapshot?.models || [];
  const ordered = [...catalog].sort(
    (a, b) =>
      Number(model?.preferences.pinned.includes(b.id)) -
      Number(model?.preferences.pinned.includes(a.id)),
  );
  const models = (ordered.length ? ordered.slice(0, 2) : fallback()).map(
    ({ id, label, reasoning, fast }) => ({ id, label, reasoning, fast }),
  );
  return (
    <Sample
      key={JSON.stringify(models.map(({ id, reasoning, fast }) => [id, reasoning, fast]))}
      models={models}
      showUsage={model?.preferences.showUsage !== false}
      usage={model?.snapshot?.usage}
      demoSelection={demoSelection}
    />
  );
}
