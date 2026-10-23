/* [INPUT]: Read-only model catalog metadata and the shared model view.
 * [OUTPUT]: Interactive model/reasoning preview with an isolated in-memory action adapter.
 * [POS]: No host target, transport, credentials or persisted preference changes.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useRef, useState } from 'react';
import { ModelView } from '../features/model/view';
import type { Model, ModelState, Selection } from '../features/model/catalog';
import type { Reading } from '../shared/features';

const fallback: Model[] = ['A', 'B'].map((id) => ({
  id: `preview-${id}`,
  label: `示例模型 ${id}`,
  reasoning: ['low', 'medium', 'high'],
  fast: true,
}));

function Sample({ models }: { models: Model[] }) {
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
    preferences: { enabled: true, showUsage: false, pinned: models.map((m) => m.id), presets: [] },
  }));
  const current = useRef(state);
  return (
    <div className="preview-model-control" role="group" aria-label="模型切换预览">
      <ModelView
        state={state}
        reading={reading.current}
        busy={false}
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

export function ModelPreview({ model }: { model: ModelState | null }) {
  // Catalog capabilities are safe to reuse. Live targets and current selections never enter the demo.
  const catalog = model?.snapshot?.models || [];
  const ordered = [...catalog].sort(
    (a, b) =>
      Number(model?.preferences.pinned.includes(b.id)) -
      Number(model?.preferences.pinned.includes(a.id)),
  );
  const models = (ordered.length ? ordered.slice(0, 3) : fallback).map(
    ({ id, label, reasoning, fast }) => ({ id, label, reasoning, fast }),
  );
  return <Sample key={JSON.stringify(models)} models={models} />;
}
