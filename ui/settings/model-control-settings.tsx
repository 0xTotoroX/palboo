import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Model state, revision-checked API. [OUTPUT]: Feature/usage switches, a slot for the chat-speed option, serialized organization settings and read-only preview snapshot.
 * [POS]: Business enablement only; all placement and themes belong to shared settings.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pageTitles } from './settings-outline';
import { FeatureSwitch, Feedback } from './settings-controls';
import { useFeedbackTarget } from './settings-feedback';
import { request } from './api';
import { ModelOrganization } from './model-organization';
import {
  scopedModelPreferences,
  organizationPatch,
  type ModelState,
  type ModelPreferences,
} from '../features/model/catalog';
export function ModelControlSettings({
  live,
  active = true,
  detailed = true,
  enablementTarget,
  onSnapshot,
  children,
}: {
  live: boolean;
  active?: boolean;
  detailed?: boolean;
  enablementTarget?: HTMLElement | null;
  onSnapshot?: (state: ModelState | null) => void;
  children?: ReactNode;
}) {
  useLocale();
  const [state, setState] = useState<ModelState | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const writing = useRef(false);
  const feedback = useFeedbackTarget();
  const generation = useRef(0);
  useEffect(() => onSnapshot?.(state), [state, onSnapshot]);
  useEffect(() => {
    if (!live || !active) return;
    let disposed = false;
    let reading = false;
    const load = async (initial = false) => {
      if (writing.current || reading || (!initial && document.hidden)) return;
      reading = true;
      const version = ++generation.current;
      try {
        const value = await request<ModelState>('model-control/state');
        if (!disposed && version === generation.current) {
          setEnabled(value.preferences.enabled);
          setState(value);
        }
      } catch (error) {
        if (!disposed && version === generation.current) setMessage(String(error));
      } finally {
        reading = false;
      }
    };
    const refresh = () => void load();
    void load(true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [live, active]);
  async function change(open: boolean) {
    if (writing.current) return;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      await request(`model-control/${open ? 'open' : 'close'}`, {});
      const value = await request<ModelState>('model-control/state');
      setState(value);
      setEnabled(value.preferences.enabled);
    } catch (error) {
      setMessage(String(error));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function operate(patch?: Partial<ModelPreferences>) {
    if (writing.current || !state) return false;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const value = await request<ModelState>(
        patch ? 'model-control/preferences' : 'model-control/refresh',
        patch ? { revision: state.revision, patch } : {},
      );
      setState(value);
      setEnabled(value.preferences.enabled);
      return true;
    } catch (error) {
      setMessage(
        String(error).includes('model_control_conflict')
          ? tr('模型设置已在其他窗口更新，已重新读取。请检查后再保存。')
          : String(error),
      );
      try {
        const value = await request<ModelState>('model-control/state');
        setState(value);
        setEnabled(value.preferences.enabled);
      } catch {
        /* 保留旧状态和失败草稿。 */
      }
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const agent = state?.snapshot?.agent?.current || 'codex';
  return (
    <section
      id="settings-model-control"
      tabIndex={-1}
      aria-label={tr('模型切换设置')}
      className="settings-section"
      onChangeCapture={feedback.track}
    >
      <FeatureSwitch
        name={pageTitles['model-control']}
        portalTarget={enablementTarget}
        checked={enabled ?? false}
        disabled={!live || busy || enabled === null}
        onChange={(value) => void change(value)}
      />
      {!feedback.target?.closest('dialog') && (
        <Feedback
          text={message || (busy ? tr('正在保存…') : '')}
          failed={!!message}
          target={feedback.target || (!detailed ? enablementTarget : null)}
        />
      )}
      <div hidden={!detailed}>
        <FeatureSwitch
          name={tr('额度显示')}
          checked={state?.preferences.showUsage !== false}
          disabled={!live || busy || !state}
          onChange={(value) => void operate({ showUsage: value })}
        />
        {children}
        {state?.snapshot?.models && (
          <ModelOrganization
            feedback={message}
            key={agent}
            state={{
              ...state,
              preferences: {
                ...scopedModelPreferences(state.preferences, agent),
                presets: state.preferences.presets.filter((preset) => preset.agent === agent),
              },
            }}
            busy={busy || !live}
            save={(patch) => operate(organizationPatch(state.preferences, agent, patch))}
            refresh={() => operate()}
          />
        )}
      </div>
    </section>
  );
}
