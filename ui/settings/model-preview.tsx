/* [INPUT]: Current model catalog/preferences/selection or isolated demo data and the shared model view.
 * [OUTPUT]: Linked model preview; actions mutate only an in-memory copy, with no real target or transport.
 * [POS]: Settings/website presentation adapter; no host commands or persisted preference changes.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
import { ModelView } from '../features/model/view';
import type { Model, ModelState, Selection } from '../features/model/catalog';
import type { Reading } from '../shared/features';

const fallback = (): Model[] =>
  ['A', 'B'].map((id) => ({
    id: `preview-${id}`,
    label: tr('示例模型 {{id}}', { id }),
    reasoning: ['low', 'medium', 'high'],
    fast: true,
  }));

function Sample({
  source,
  telemetry,
  demoSelection,
  mode,
  headerActions,
  showUsage,
}: {
  source: ModelState;
  telemetry?: ModelState['snapshot'];
  demoSelection?: Selection;
  mode: 'current' | 'example';
  headerActions?: HTMLElement;
  showUsage: boolean;
}) {
  useLocale();
  const reading = useRef<Reading>({});
  const [state, setState] = useState(source);
  const current = useRef(state);
  useEffect(() => {
    current.current = source;
    setState(source);
  }, [source]);
  useEffect(() => {
    if (!demoSelection) return;
    const next = {
      ...current.current,
      snapshot: { ...current.current.snapshot, current: demoSelection },
    };
    current.current = next;
    setState(next);
  }, [demoSelection]);
  const displayed = {
    ...state,
    preferences: { ...state.preferences, showUsage },
    snapshot: { ...state.snapshot, usage: telemetry?.usage, tokenMeter: telemetry?.tokenMeter },
  };
  return (
    <div
      className="preview-model-control"
      data-preview-source={mode}
      role="group"
      aria-label={tr('模型切换预览')}
    >
      <ModelView
        state={displayed}
        headerActions={headerActions}
        reading={reading.current}
        busy={false}
        footer={
          mode === 'example' && showUsage && !telemetry?.usage?.length ? (
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
  mode = 'example',
  headerActions,
}: {
  model: ModelState | null;
  demoSelection?: Selection;
  mode?: 'current' | 'example';
  headerActions?: HTMLElement;
}) {
  useLocale();
  // Only presentation data crosses this boundary. Never retain the host target or revision.
  const models =
    mode === 'current'
      ? (model?.snapshot?.models ?? [])
      : model?.snapshot?.models.length
        ? [...model.snapshot.models]
            .sort(
              (a, b) =>
                Number(model.preferences.pinned.includes(b.id)) -
                Number(model.preferences.pinned.includes(a.id)),
            )
            .slice(0, 2)
        : fallback();
  const serialized = JSON.stringify({
    revision: 0,
    snapshot: {
      target: mode === 'example' || model?.snapshot?.target ? { preview: true } : null,
      revision: 'preview',
      status: mode === 'current' ? (model?.snapshot?.status ?? 'waiting') : 'ready',
      message: mode === 'current' ? (model?.snapshot?.message ?? '') : '',
      models: models.map(({ id, label, reasoning, fast }) => ({ id, label, reasoning, fast })),
      current:
        mode === 'current'
          ? (model?.snapshot?.current ?? null)
          : {
              model: models[0].id,
              reasoning: models[0].reasoning[0] || '',
              speed: 'standard',
            },
    },
    preferences:
      mode === 'current' && model
        ? {
            ...model.preferences,
            pinned: model.preferences.pinned ?? [],
            presets: model.preferences.presets ?? [],
          }
        : {
            enabled: true,
            pinned: models.map((m) => m.id),
            presets: [],
            showUsage: true,
          },
  });
  const source = useMemo(() => JSON.parse(serialized) as ModelState, [serialized]);
  return (
    <Sample
      source={source}
      telemetry={model?.snapshot}
      mode={mode}
      demoSelection={demoSelection}
      headerActions={headerActions}
      showUsage={model?.preferences.showUsage !== false}
    />
  );
}
