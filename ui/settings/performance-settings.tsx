import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: 认证性能 API、页面可见性与独立偏好修订号。
 * [OUTPUT]: 共用的连接暂停与诊断偏好、按需采样和实时仪表。
 * [POS]: Codex 连接的诊断内容；宿主指标与 Palboo 自身耗时明确区分。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Toggle } from './settings-controls';
import { useFeedbackTarget } from './settings-feedback';
import { PerformanceMonitor } from './performance-monitor';
import type { PerformanceSample } from './performance-history';

type Preferences = { integrationEnabled: boolean; monitoringEnabled: boolean; revision: number };
type State = {
  preferences: Preferences;
  connectionStatus: string;
  sample: PerformanceSample | null;
  connectionError?: string;
};
async function readState(path: string, body?: unknown): Promise<State> {
  const value = await request<State>(path, body);
  if (
    typeof value?.preferences?.integrationEnabled !== 'boolean' ||
    typeof value.preferences.monitoringEnabled !== 'boolean' ||
    !Number.isSafeInteger(value.preferences.revision)
  )
    throw Error(tr('当前后台尚未提供性能设置，请重新打开 Palboo 后再试。'));
  return value;
}
export function usePerformanceSettings(live: boolean, active: boolean) {
  useLocale();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const feedback = useFeedbackTarget();
  const writing = useRef(false),
    generation = useRef(0);
  const monitoring = state?.preferences.monitoringEnabled === true;
  const sampling = monitoring;
  useEffect(() => {
    if (!live || !active) return;
    let stopped = false,
      reading = false;
    const load = async () => {
      if (stopped || reading || writing.current || document.hidden) return;
      reading = true;
      const version = ++generation.current;
      try {
        const next = await readState(`performance${sampling ? '?sample=1' : ''}`);
        if (!stopped && version === generation.current) {
          setState(next);
          setMessage('');
        }
      } catch (error) {
        if (!stopped && version === generation.current) setMessage(String(error));
      } finally {
        reading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    document.addEventListener('visibilitychange', load);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [active, live, sampling]);
  async function save(patch: Partial<Preferences>) {
    if (!live || !active || !state || writing.current) return;
    feedback.capture();
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const next = await readState('performance', {
        expectedRevision: state.preferences.revision,
        ...patch,
      });
      setState(next);
      setMessage(next.connectionError || '');
    } catch (error) {
      setMessage(String(error));
      try {
        setState(await readState('performance'));
      } catch {
        /* 保留最后确认的值。 */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  return {
    state,
    monitoring,
    message,
    busy,
    disabled: !live || !state || busy,
    save,
    target: feedback.target,
  };
}

export function PerformanceSettings({
  performance,
  active,
}: {
  performance: ReturnType<typeof usePerformanceSettings>;
  active: boolean;
}) {
  useLocale();
  const { state, monitoring, message, disabled, save } = performance;
  return (
    <section id="settings-performance" className="settings-section" aria-label={tr('性能监测')}>
      <div className="performance-controls">
        <Toggle
          id="performance-monitoring"
          label={tr('性能监测')}
          checked={monitoring}
          disabled={disabled}
          onChange={(monitoringEnabled) => void save({ monitoringEnabled })}
        />
      </div>
      <PerformanceMonitor
        sample={active && monitoring && !message ? (state?.sample ?? null) : null}
        enabled={monitoring}
        active={active}
        connected={state?.connectionStatus === 'connected'}
        failed={!!message}
      />
    </section>
  );
}
