import { useLocale } from '../../shared/use-locale';
import { tr } from '../../shared/i18n.js';
/* [INPUT]: Existing model control envelope and serialized actions.
 * [OUTPUT]: Title-aligned reasoning headings, content-sized favorites matrix (auto-displaying active external CLI models when none are pinned), independent Fast charge/strike and divider controls, CodexHost CLI switcher bar (direct switch in draft chats, new-chat context handoff in locked chats), explicitly bookmarked presets separated from catalog pins, with saved reasoning and speed, a shared bottom row with lower-edge-aligned account usage, icons and an independent footer slot, in-panel catalog and wrapping presets with synchronous draft handoff, measured horizontal reading restoration and capability-driven selection.
 * [POS]: Reusable business view; surfaces own placement and theme.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ModelHeading } from './heading';
import { useFastMotion } from './fast-motion';
import { useModelMotion } from './interaction-motion';
import { iconSvg } from '../../shared/icons/index.js';
import type { ModelPresetDraft, Reading } from '../../shared/features';
import {
  groupedModels,
  scopedModelPreferences,
  organizationPatch,
  orderedModelIds,
  uniquePresetName,
  type ModelState,
  type Selection,
} from './catalog';
export type { ModelState } from './catalog';
const dischargeShape =
  'M24 0 L23 43 L27 86 L20 122 L26 166 L23 209 L28 256 L21 295 L25 328 L24 360';
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const presetLabel = (name: string, selection: Selection) =>
  [name, label(selection.reasoning), selection.speed === 'fast' ? 'Fast' : '']
    .filter(Boolean)
    .join(' · ');
const icon = (name: string) => <span dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
export function ModelView({
  state,
  action,
  busy,
  reading,
  headerActions,
  footer,
  hasNotice = false,
}: {
  hasNotice?: boolean;
  footer?: ReactNode;
  headerActions?: HTMLElement;
  reading: Reading;
  state: ModelState;
  action: (data: unknown, action: string) => Promise<unknown>;
  busy: boolean;
}) {
  useLocale();
  const [tools, setTools] = useState(reading.modelTools || false),
    [others, setOthers] = useState(false),
    [browserHeight, setBrowserHeight] = useState(0),
    [drop, setDrop] = useState(''),
    [dragging, setDragging] = useState(false),
    [columnWidth, setColumnWidth] = useState<number | null>(null),
    [metrics, setMetrics] = useState({ available: 0, widths: [] as number[] }),
    [presetDraft, renderPresetDraft] = useState<ModelPresetDraft | null>(() =>
      structuredClone(reading.modelPresetDraft || null),
    );
  function setPresetDraft(draft: ModelPresetDraft | null) {
    // 输入事件内同步交接副本，确保紧接着卸载或移动时 capture 不依赖 effect 时机。
    if (draft) reading.modelPresetDraft = structuredClone(draft);
    else delete reading.modelPresetDraft;
    renderPresetDraft(draft);
  }
  function closeTools() {
    setTools((reading.modelTools = false));
  }
  function renamePreset(p: ModelState['preferences']['presets'][number]) {
    setPresetDraft({ ...p, selection: { ...p.selection }, creating: false });
  }
  const matrix = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const favorites = useRef<HTMLDivElement>(null);
  const feedback = useModelMotion({ root, favorites, picker, catalog: others });
  const pickerActions = useRef<HTMLDivElement>(null);
  const pickerToggle = useRef<HTMLButtonElement>(null);
  const restorePickerFocus = useRef(false);
  useLayoutEffect(() => {
    if (!others && restorePickerFocus.current) {
      restorePickerFocus.current = false;
      pickerToggle.current?.focus({ preventScroll: true });
    }
  }, [others]);
  const headings = useRef<HTMLDivElement>(null);
  const motion = useFastMotion();
  const fastButton = motion.button,
    discharge = motion.beam,
    dischargePath = motion.path;
  const stopDischarge = motion.stop;
  useEffect(() => {
    if (others) stopDischarge();
  }, [others]);
  useEffect(() => {
    if (!others) return;
    const document = root.current!.ownerDocument;
    const outside = (event: MouseEvent) => {
      const path = event.composedPath();
      if (
        !path.includes(picker.current!) &&
        !path.includes(pickerToggle.current!) &&
        !path.includes(pickerActions.current!)
      )
        setOthers(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || resize.current) return;
      event.stopPropagation();
      feedback.keyboard();
      restorePickerFocus.current = true;
      setOthers(false);
    };
    // Wait for the click: closing on pointerdown can move a wrapping header tab before release.
    document.addEventListener('click', outside, true);
    document.addEventListener('keydown', escape, true);
    picker.current?.querySelector<HTMLButtonElement>('.model-tile')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('click', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [others]);
  const resize = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    width: number;
    value: number;
    scale: number;
  } | null>(null);
  const restoredReading = useRef(false);
  const s = state.snapshot;
  const currentAgent = s.agent?.current || 'codex';
  const prefs = scopedModelPreferences(state.preferences, currentAgent);
  const statusMessage = hasNotice
    ? ''
    : !prefs.enabled
      ? tr('模型切换已停用，请在设置页开启。')
      : s.status === 'busy'
        ? ''
        : tr(s.message);
  const emptyMessage =
    hasNotice || statusMessage || s.status === 'busy'
      ? ''
      : tr(s.status === 'waiting' ? '正在读取模型…' : '暂无可用模型');
  const scopedPresets = prefs.presets.filter(
    (preset) => preset.agent === currentAgent && !preset.catalogPin,
  );
  const currentModel = s.models.find((model) => model.id === s.current?.model);
  const fastActive = !!currentModel?.fast && s.current?.speed === 'fast';
  const allowed = !!s.target && ['ready', 'waiting'].includes(s.status) && prefs.enabled;
  const apply = (selection: Selection, preserveSpeed = false) =>
    action({ target: s.target, expectedRevision: s.revision, selection, preserveSpeed }, 'apply');
  const applyAgent = async (agent: string) => {
    const result = await action({ target: s.target, expectedRevision: s.revision, agent }, 'apply');
    if ((result as ModelState | null)?.snapshot?.agent?.current === agent) {
      setOthers(false);
      closeTools();
      setPresetDraft(null);
    }
  };
  const agentOptions = s.agent?.options || [];
  const pinnedAgents = prefs.pinnedAgents || [];
  const directoryAgents = [...agentOptions].sort(
    (a, b) => Number(pinnedAgents.includes(b.id)) - Number(pinnedAgents.includes(a.id)),
  );
  const handoffNotice = tr('切换 Agent 会新建聊天');
  const canSwitchAgent = (agent: string) =>
    !busy &&
    prefs.enabled &&
    !!s.target &&
    ['ready', 'waiting', 'unavailable'].includes(s.status) &&
    agentOptions.some((option) => option.id === agent && option.available);
  const needsNewChat = (agent?: string) => !!agent && agent !== currentAgent && !!s.agent?.locked;
  const save = (patch: object) => action({ revision: state.revision, patch }, 'preferences');
  const saveOrganization = (patch: Parameters<typeof organizationPatch>[2]) =>
    save(organizationPatch(state.preferences, currentAgent, patch));
  const priorAgent = useRef(currentAgent);
  useEffect(() => {
    if (priorAgent.current === currentAgent) return;
    priorAgent.current = currentAgent;
    delete reading.modelLeft;
    restoredReading.current = false;
    if (matrix.current) matrix.current.scrollLeft = 0;
    setOthers(false);
    closeTools();
    setPresetDraft(null);
  }, [currentAgent]);
  const addPreset = async () => {
    if (busy || !allowed || !s.current) return;
    closeTools();
    setOthers(false);
    const preset = {
      id: crypto.randomUUID(),
      name: uniquePresetName(
        s.models.find((m) => m.id === s.current?.model)?.label || s.current.model,
        scopedPresets,
        s.current.speed,
        currentAgent,
      ),
      selection: { ...s.current },
      agent: currentAgent,
    };
    const result = await save({ presets: [...prefs.presets, preset] });
    if (result !== null) setPresetDraft(null);
  };
  const saveWidth = async (width: number) => {
    try {
      await saveOrganization({ modelColumnWidth: width });
    } finally {
      setColumnWidth(null);
    }
  };
  const valid = (selection: Selection) =>
    s.models.some(
      (m) =>
        m.id === selection.model &&
        (m.reasoning.includes(selection.reasoning) ||
          (!m.reasoning.length && !selection.reasoning)) &&
        (selection.speed !== 'fast' || m.fast),
    );
  const modelOrder = orderedModelIds(s.models, prefs);
  const models = modelOrder.flatMap((id) => {
    const model = s.models.find((m) => m.id === id);
    return model ? [model] : [];
  });
  const fixedModels = models.filter(
    (model) =>
      prefs.pinned.includes(model.id) ||
      prefs.presets.some(
        (preset) =>
          preset.catalogPin && preset.agent === currentAgent && preset.selection.model === model.id,
      ),
  );
  const visible = fixedModels.length
    ? fixedModels
    : models.filter((model) => model.id === s.current?.model);
  const boundPreset = (model: ModelState['snapshot']['models'][number]) =>
    prefs.presets.find(
      (p) => p.catalogPin && p.agent === currentAgent && p.selection.model === model.id,
    );
  const toggleModel = async (model: ModelState['snapshot']['models'][number]) => {
    const preset = boundPreset(model);
    const wasPinned = prefs.pinned.includes(model.id) || !!preset;
    return save({
      ...organizationPatch(state.preferences, currentAgent, {
        pinned: wasPinned
          ? prefs.pinned.filter((id) => id !== model.id)
          : [...prefs.pinned, model.id],
      }),
      ...(preset
        ? {
            presets: prefs.presets.filter(
              (p) => !(p.catalogPin && p.agent === currentAgent && p.selection.model === model.id),
            ),
          }
        : {}),
    });
  };
  const groups = groupedModels(models, prefs);
  const dragType = 'application/x-palboo-model';
  const order = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const columns = [
    ...new Set(visible.flatMap((m) => (m.reasoning.length ? m.reasoning : ['']))),
  ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // 按实际表头文字保留思考列的可读宽度，不用最长标题把每一列都撑宽。
  useLayoutEffect(() => {
    const node = matrix.current;
    if (!node) return;
    const labels = [
      ...(headings.current?.querySelectorAll<HTMLElement>('[data-reasoning-label]') || []),
    ];
    const measure = () => {
      if (!node.clientWidth || (columns.length && !headings.current?.offsetWidth)) return;
      const widths = labels.map((label) => Math.max(28, label.offsetWidth + 12));
      const available = node.clientWidth;
      setMetrics((previous) =>
        previous.available === available &&
        previous.widths.length === widths.length &&
        widths.every((w, i) => w === previous.widths[i])
          ? previous
          : { available, widths },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    labels.forEach((label) => observer.observe(label));
    measure();
    return () => observer.disconnect();
  }, [columns.join('|'), others]);
  const widths = columns.length ? columns.map((_, i) => metrics.widths[i] || 63) : [28];
  const reasoningWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 4;
  const maxNameWidth = metrics.available
    ? Math.max(100, Math.min(560, Math.floor(metrics.available - 16 - reasoningWidth)))
    : 560;
  const clampWidth = (width: number) => Math.max(100, Math.min(maxNameWidth, Math.round(width)));
  const nameWidth = clampWidth(columnWidth ?? prefs.modelColumnWidth ?? 140);
  useLayoutEffect(() => {
    const node = matrix.current;
    // Initial fallback column widths are replaced after measuring the heading.
    // Restoring sooner clamps the saved offset and the resulting scroll event
    // overwrites it before the final matrix width is available.
    if (!node || others || !metrics.available || restoredReading.current) return;
    node.scrollLeft = reading.modelLeft || 0;
    restoredReading.current = node.scrollWidth - node.clientWidth >= (reading.modelLeft || 0);
  }, [metrics.available, nameWidth, widths.join('|'), reading, others]);
  useLayoutEffect(() => {
    const node = matrix.current;
    if (!node) return;
    const takeOver = () => {
      restoredReading.current = true;
      reading.modelLeft = node.scrollLeft;
    };
    for (const event of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
      node.addEventListener(event, takeOver, { passive: true });
    return () => {
      for (const event of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
        node.removeEventListener(event, takeOver);
    };
  }, [reading, others]);
  const rows = (items: typeof models) =>
    items.map((m) => (
      <div
        className="model-row"
        data-model-row={m.id}
        data-drop={drop.startsWith(`${m.id}:`) ? drop.split(':').at(-1) : undefined}
        key={m.id}
        onDragOver={(event) => {
          if (busy || !prefs.enabled || !event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          setDrop(`${m.id}:${event.clientY < rect.y + rect.height / 2 ? 'before' : 'after'}`);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop('');
        }}
        onDrop={(event) => {
          setDrop('');
          if (busy || !prefs.enabled || !event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault();
          event.stopPropagation();
          const id = event.dataTransfer.getData(dragType);
          if (
            id === m.id ||
            !models.some((model) => model.id === id) ||
            !fixedModels.some((item) => item.id === id)
          )
            return;
          const next = modelOrder.filter((item) => item !== id);
          const rect = event.currentTarget.getBoundingClientRect();
          next.splice(
            next.indexOf(m.id) + (event.clientY >= rect.y + rect.height / 2 ? 1 : 0),
            0,
            id,
          );
          void saveOrganization({ modelOrder: next });
        }}
      >
        <div className="model-name">
          <strong
            draggable={!busy && prefs.enabled}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData(dragType, m.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDrop('')}
          >
            <span>{label(m.label).split(' · ')[0]}</span>
            {m.label.includes(' · ') && (
              <span className="model-route">{m.label.split(' · ').slice(1).join(' · ')}</span>
            )}
            {models.some((other) => other.id !== m.id && other.label === m.label) && (
              <small className="model-route">{m.id}</small>
            )}
          </strong>
        </div>
        <div className="model-choices">
          {columns.map((reasoning) => {
            const supported =
              m.reasoning.includes(reasoning) || (!m.reasoning.length && !reasoning);
            const selected =
              supported && s.current?.model === m.id && s.current.reasoning === reasoning;
            return (
              <button
                key={reasoning}
                disabled={busy || !allowed || !supported}
                aria-label={tr('{{value1}} · {{value2}}', {
                  value1: label(m.label),
                  value2: label(reasoning) || tr('选择'),
                })}
                data-model={m.id}
                data-reasoning={reasoning}
                data-choice-label={label(reasoning) || tr('选择')}
                aria-pressed={selected}
                onClick={async (event) => {
                  const button = event.currentTarget;
                  const pointer = event.detail > 0;
                  const result = await apply({ model: m.id, reasoning, speed: 'standard' }, true);
                  feedback.confirm(result, button, pointer);
                }}
              >
                {supported ? (selected ? '●' : '○') : '—'}
              </button>
            );
          })}
        </div>
      </div>
    ));
  const presetEditor = presetDraft && (
    <form
      key={presetDraft.id}
      className="model-preset-editor"
      aria-label={presetDraft.creating ? tr('保存模型预设') : tr('重命名模型预设')}
      onSubmit={async (event) => {
        event.preventDefault();
        const requestedName = presetDraft.name.trim();
        if (busy || !prefs.enabled || !requestedName) return;
        const name = uniquePresetName(
          requestedName,
          prefs.presets.filter((p) => !p.catalogPin && p.id !== presetDraft.id),
          presetDraft.selection.speed,
          presetDraft.agent,
        );
        const preset = {
          id: presetDraft.id,
          name,
          selection: presetDraft.selection,
          ...(presetDraft.agent ? { agent: presetDraft.agent } : {}),
        };
        const result = await save({
          presets: presetDraft.creating
            ? [...prefs.presets, preset]
            : prefs.presets.map((item) => (item.id === preset.id ? { ...item, name } : item)),
        });
        if (result !== null) setPresetDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!busy) setPresetDraft(null);
        }
      }}
    >
      {presetDraft.selection.speed === 'fast' && icon('bolt-filled')}
      <input
        aria-label={tr('预设名称')}
        placeholder={tr('预设名称')}
        autoFocus
        maxLength={256}
        value={presetDraft.name}
        disabled={busy || !prefs.enabled}
        onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })}
      />
      {presetDraft.selection.reasoning && (
        <span className="model-preset-reasoning">{label(presetDraft.selection.reasoning)}</span>
      )}
      <button
        type="submit"
        aria-label={tr('保存')}
        disabled={busy || !prefs.enabled || !presetDraft.name.trim()}
      >
        {icon('check')}
      </button>
      <button
        type="button"
        aria-label={tr('取消')}
        disabled={busy}
        onClick={() => setPresetDraft(null)}
      >
        {icon('close')}
      </button>
    </form>
  );
  const allButton = (
    <button
      ref={pickerToggle}
      className="model-icon-button model-picker-toggle"
      data-model-picker
      aria-label={tr('所有模型')}
      title={tr('所有模型')}
      aria-expanded={others}
      onClick={() => {
        if (!others) {
          setBrowserHeight(Math.max(300, main.current?.offsetHeight || 0));
          restoredReading.current = false;
        }
        setPresetDraft(null);
        setOthers(!others);
      }}
    >
      {icon('catalog')}
    </button>
  );
  const catalogControls = (
    <div className="model-picker-actions" ref={pickerActions} data-model-catalog-actions>
      {headerActions && (
        <style>{`
          [data-model-catalog-actions] { display: inline-flex; align-items: center; gap: 4px; margin: 0; }
          [data-model-catalog-actions] > button { display: grid; place-items: center; flex: none; width: 28px; height: 28px; min-width: 28px; min-height: 28px; padding: 5px; border: 0; border-radius: 6px; color: inherit; background: transparent; cursor: pointer; }
          [data-model-catalog-actions] > button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
          [data-model-catalog-actions] > button:disabled { opacity: .45; cursor: default; }
          [data-model-catalog-actions] svg { display: block; width: 18px; height: 18px; }
        `}</style>
      )}
      <button
        className="model-icon-button"
        data-refresh="model"
        style={{ '--feature-refresh-opacity': 1 } as CSSProperties}
        aria-label={tr('刷新可用模型')}
        disabled={busy || !prefs.enabled}
        onClick={() => void action({}, 'refresh')}
      >
        {icon('refresh')}
      </button>
      <button
        className="model-icon-button"
        aria-label={tr('关闭所有模型')}
        onClick={() => {
          restorePickerFocus.current = true;
          setOthers(false);
        }}
      >
        {icon('close')}
      </button>
    </div>
  );
  return (
    <section
      ref={root}
      className="feature-model"
      aria-busy={busy || s.status === 'busy'}
      onPointerDownCapture={feedback.pointer}
      onKeyDown={(event) => {
        feedback.keyboard();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && tools) {
          event.stopPropagation();
          closeTools();
        }
      }}
      style={
        {
          '--name-width': `${nameWidth}px`,
          '--model-browser-height': `${browserHeight}px`,
          '--columns': Math.max(1, columns.length),
          '--reasoning-min-width': `${reasoningWidth}px`,
          '--reasoning-columns': widths.map((width) => `minmax(${width}px, 1fr)`).join(' '),
        } as CSSProperties
      }
    >
      <div className="model-main" ref={main} data-view={others ? 'all' : 'favorites'}>
        <div className="model-favorites" ref={favorites} aria-hidden={others} inert={others}>
          <div
            className="model-scroll"
            ref={matrix}
            onScroll={(event) => {
              if (restoredReading.current && event.currentTarget.clientWidth)
                reading.modelLeft = event.currentTarget.scrollLeft;
            }}
          >
            <div className="model-matrix">
              <div className="model-intrinsic-width" data-intrinsic-width hidden />
              <ModelHeading
                matrix={matrix}
                headings={headings}
                nameWidth={nameWidth}
                widths={widths}
                hidden={others}
              >
                <button
                  type="button"
                  ref={fastButton}
                  className="model-icon-button model-fast"
                  aria-label="Fast"
                  aria-pressed={fastActive}
                  data-phase={motion.phase}
                  data-filled={fastActive}
                  style={{ left: nameWidth - 6 }}
                  disabled={
                    busy || motion.phase !== 'idle' || !allowed || !s.current || !currentModel?.fast
                  }
                  onClick={async () => {
                    if (!s.current) return;
                    const enabling = s.current.speed !== 'fast';
                    if (!enabling) stopDischarge();
                    const request = apply({
                      ...s.current,
                      speed: enabling ? 'fast' : 'standard',
                    });
                    if (enabling) {
                      await motion.start(
                        request.then(
                          (result) =>
                            result !== null &&
                            (result as ModelState | undefined)?.snapshot?.current?.speed !==
                              'standard',
                        ),
                      );
                    } else await request;
                  }}
                >
                  {icon('bolt')}
                  <span
                    ref={motion.fill}
                    className="model-fast-fill"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: iconSvg('bolt-filled') }}
                  />
                </button>
                <div
                  className="model-choices"
                  style={{
                    gridTemplateColumns: widths.map((width) => `minmax(${width}px, 1fr)`).join(' '),
                  }}
                >
                  {columns.map((c) => (
                    <span key={c}>
                      <span data-reasoning-label>{label(c) || tr('选择')}</span>
                    </span>
                  ))}
                </div>
              </ModelHeading>
              <div className="model-primary">
                <button
                  type="button"
                  className="model-column-resize"
                  aria-label={tr('调整模型名称宽度')}
                  aria-description={tr('左右拖动或方向键调整，当前 {{nameWidth}}px', {
                    nameWidth: nameWidth,
                  })}
                  data-column-min={100}
                  data-column-max={maxNameWidth}
                  data-column-width={nameWidth}
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : 0}
                  data-resizing={!!resize.current}
                  data-dragging={dragging}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || busy || resize.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.focus({ preventScroll: true });
                    stopDischarge();
                    setDragging(false);
                    resize.current = {
                      pointer: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                      scale:
                        matrix.current!.getBoundingClientRect().width /
                          matrix.current!.offsetWidth || 1,
                      width: nameWidth,
                      value: nameWidth,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setColumnWidth(nameWidth);
                  }}
                  onPointerMove={(event) => {
                    const drag = resize.current;
                    if (!drag || drag.pointer !== event.pointerId) return;
                    const dx = event.clientX - drag.x;
                    const dy = event.clientY - drag.y;
                    if (!drag.moved && (Math.abs(dx) < 2 || Math.abs(dx) < Math.abs(dy))) return;
                    if (!drag.moved) setDragging(true);
                    drag.moved = true;
                    drag.value = clampWidth(drag.width + (event.clientX - drag.x) / drag.scale);
                    setColumnWidth(drag.value);
                  }}
                  onPointerUp={(event) => {
                    const drag = resize.current;
                    if (!drag || drag.pointer !== event.pointerId) return;
                    setDragging(false);
                    resize.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag.value !== drag.width) void saveWidth(drag.value);
                    else setColumnWidth(null);
                  }}
                  onLostPointerCapture={() => {
                    if (!resize.current) return;
                    setDragging(false);
                    resize.current = null;
                    setColumnWidth(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && resize.current) {
                      event.stopPropagation();
                      setDragging(false);
                      event.currentTarget.releasePointerCapture(resize.current.pointer);
                      resize.current = null;
                      setColumnWidth(null);
                      return;
                    }
                    if (busy || resize.current || !['ArrowLeft', 'ArrowRight'].includes(event.key))
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const width = clampWidth(nameWidth + (event.key === 'ArrowLeft' ? -16 : 16));
                    if (width === nameWidth) return;
                    setColumnWidth(width);
                    void saveWidth(width);
                  }}
                >
                  <span className="model-divider-line" />
                </button>
                <div className="model-discharge" ref={discharge} aria-hidden="true">
                  <svg viewBox="0 0 48 360" preserveAspectRatio="none">
                    <g ref={dischargePath}>
                      <path
                        className="model-discharge-glow"
                        d={dischargeShape}
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        className="model-discharge-core"
                        d={dischargeShape}
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        className="model-discharge-branches"
                        d="M20 122 L12 144 L15 158 M28 256 L35 270 L32 284"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </svg>
                </div>

                {rows(visible)}
                {!hasNotice && !statusMessage && !!models.length && !visible.length && (
                  <p className="model-empty-favorites">{tr('在目录中固定常用模型')}</p>
                )}
                {!models.length && emptyMessage && <p role="status">{emptyMessage}</p>}
              </div>
            </div>
          </div>
          <section className="model-collections" aria-label={tr('收藏')}>
            <div className="model-presets" data-editing={tools}>
              {scopedPresets.map((p) => (
                <div className="model-preset-tag" key={p.id}>
                  {presetDraft?.id === p.id && !presetDraft.creating ? (
                    presetEditor
                  ) : (
                    <button
                      className="model-preset-choice"
                      disabled={busy}
                      aria-disabled={!tools && (!allowed || !valid(p.selection))}
                      aria-label={presetLabel(p.name, p.selection)}
                      aria-description={tools ? tr('点击重命名') : undefined}
                      title={presetLabel(
                        s.models.find((m) => m.id === p.selection.model)?.label ||
                          p.selection.model,
                        p.selection,
                      )}
                      aria-pressed={
                        s.current?.model === p.selection.model &&
                        s.current.reasoning === p.selection.reasoning &&
                        s.current.speed === p.selection.speed
                      }
                      onClick={async (event) => {
                        if (tools) renamePreset(p);
                        else if (allowed && valid(p.selection)) {
                          const button = event.currentTarget;
                          const pointer = event.detail > 0;
                          const result = await apply(p.selection);
                          feedback.confirm(result, button, pointer);
                        }
                      }}
                    >
                      {p.selection.speed === 'fast' && icon('bolt-filled')}
                      <span>
                        {p.name}
                        {p.selection.reasoning && (
                          <span className="model-preset-reasoning">
                            {' · '}
                            {label(p.selection.reasoning)}
                          </span>
                        )}
                      </span>
                    </button>
                  )}
                  {tools && (
                    <button
                      className="model-preset-delete"
                      aria-label={tr('删除预设 {{value1}}', { value1: p.name })}
                      disabled={busy}
                      onClick={async () => {
                        const result = await save({
                          presets: prefs.presets.filter((item) => item.id !== p.id),
                        });
                        if (result !== null && presetDraft?.id === p.id) setPresetDraft(null);
                      }}
                    >
                      {icon('close')}
                    </button>
                  )}
                </div>
              ))}
              {presetDraft?.creating && presetEditor}
            </div>
          </section>
        </div>
        <div className="model-status-row">
          <div className="model-metrics">
            {prefs.showUsage !== false && !!s.usage?.length && (
              <span
                className="model-usage"
                aria-label={tr('Codex 剩余额度')}
                title={tr('Codex 剩余额度')}
              >
                {[...s.usage]
                  .sort((a, b) => b.minutes - a.minutes)
                  .map((window) => (
                    <span key={window.minutes}>
                      {window.minutes === 300 ? tr('5小时') : tr('周')} {window.remainingPercent}%
                    </span>
                  ))}
              </span>
            )}
            {footer}
          </div>
          <div className="model-preset-actions">
            <button
              className="model-icon-button model-preset-edit"
              aria-label={tr('编辑预设')}
              title={tr('编辑预设')}
              aria-pressed={tools}
              disabled={busy || !scopedPresets.length}
              onClick={() => {
                setTools((reading.modelTools = !tools));
                if (tools) setPresetDraft(null);
              }}
            >
              {icon('pencil')}
            </button>
            <button
              className="model-icon-button model-preset-add"
              aria-label={tr('添加预设')}
              title={tr('添加预设')}
              disabled={busy || !allowed || !s.current}
              onClick={addPreset}
            >
              {icon('bookmark')}
            </button>
            {allButton}
          </div>
        </div>
        {others && (
          <div className="model-picker" ref={picker} role="region" aria-label={tr('所有模型')}>
            {headerActions ? createPortal(catalogControls, headerActions) : catalogControls}
            <div className="model-other-list">
              {directoryAgents.length > 0 && (
                <section className="model-agents" aria-label="Agent">
                  {directoryAgents.some(
                    (option) => option.available && needsNewChat(option.id),
                  ) && <p className="model-agent-notice">{handoffNotice}</p>}
                  <div className="model-agent-options" role="group" aria-label="CLI">
                    {directoryAgents.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="model-agent-choice"
                        data-agent-option={option.id}
                        disabled={option.id === currentAgent || !canSwitchAgent(option.id)}
                        aria-pressed={option.id === currentAgent}
                        aria-description={
                          needsNewChat(option.id) && option.available ? handoffNotice : undefined
                        }
                        title={!option.available ? tr('暂不可用') : undefined}
                        onClick={() => void applyAgent(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {groups.map((group) => (
                <section
                  className="model-group"
                  data-model-group={group.id}
                  key={group.id}
                  aria-label={group.name}
                >
                  <h3>{group.name}</h3>
                  <div className="model-tiles">
                    {group.models.map((m) => (
                      <button
                        className="model-tile"
                        key={m.id}
                        data-model-tile={m.id}
                        aria-label={m.label}
                        aria-pressed={!!boundPreset(m) || prefs.pinned.includes(m.id)}
                        disabled={busy || !prefs.enabled}
                        onClick={async (event) => {
                          const button = event.currentTarget;
                          const pointer = event.detail > 0;
                          const result = await toggleModel(m);
                          feedback.confirm(result, button, pointer);
                          if (button.isConnected) button.focus({ preventScroll: true });
                        }}
                      >
                        <span>{m.label}</span>
                        {models.some((other) => other.id !== m.id && other.label === m.label) && (
                          <small className="model-route">{m.id}</small>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!models.length && emptyMessage && <p role="status">{emptyMessage}</p>}
            </div>
          </div>
        )}
      </div>
      {statusMessage && (
        <footer className="model-footer">
          <span role="status">{statusMessage}</span>
        </footer>
      )}
    </section>
  );
}
