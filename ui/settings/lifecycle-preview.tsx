/* [INPUT]: Saved, revision-checked lifecycle preview choices and local playback actions.
 * [OUTPUT]: Isolated startup/shutdown rehearsal, centered notification and the selected energy-meter animation.
 * [POS]: General settings for real App notifications; rehearsal actions never start or stop applications.
 * [PROTOCOL]: Update ui/settings/AGENTS.md when responsibilities change. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import type { AppearanceSettings, LifecyclePreviewPreferences } from '../shared/contracts';
import { request } from './api';
import { reducedMotion } from './settings-motion';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';

const defaults: LifecyclePreviewPreferences = {
  display: 'popup',
  material: 'auto',
  progress: 'energy',
};
const startup = ['准备 Palboo', '打开 Codex', '连接兼容服务', '恢复工作台', '确认界面可用'];
const shutdown = ['保存当前状态', '结束关联任务', '关闭兼容服务', '确认后台已退出'];
const clamp = (n: number) => Math.min(1, Math.max(0, n));
function Eyes() {
  return (
    <svg viewBox="0 0 40 32" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="9" y="3" width="7" height="21" rx="3.5" />
        <rect x="25" y="3" width="7" height="21" rx="3.5" />
      </g>
      <g fill="#f4a3ad">
        <circle cx="5" cy="25" r="2" />
        <circle cx="35" cy="25" r="2" />
      </g>
    </svg>
  );
}
export function LifecycleBar({ value, animate = false }: { value: number; animate?: boolean }) {
  const target = Math.floor(clamp(value) * 20);
  const [cells, setCells] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!animate || reducedMotion(media) || target <= shown.current) {
      shown.current = target;
      setCells(target);
      return;
    }
    const timer = setInterval(() => {
      shown.current = reducedMotion(media) ? target : Math.min(target, shown.current + 1);
      setCells(shown.current);
      if (shown.current === target) clearInterval(timer);
    }, 65);
    return () => clearInterval(timer);
  }, [target, animate]);
  return (
    <div className="lifecycle-bar" data-style="energy" aria-hidden="true">
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} data-filled={i < cells} />
      ))}
    </div>
  );
}
export function LifecyclePreviewSettings({
  value,
  live,
}: {
  value?: AppearanceSettings;
  live: boolean;
}) {
  useLocale();
  const [prefs, setPrefs] = useState(value);
  const [draft, setDraft] = useState(value?.lifecyclePreview || defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [flow, setFlow] = useState<'start' | 'exit'>('start');
  const [step, setStep] = useState(2);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timings = useRef<number[]>([0.6, 0.8]);
  const [run, setRun] = useState(0);
  const scene = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    if (!saving.current && value && (!prefs || value.revision > prefs.revision)) {
      setPrefs(value);
      setDraft(value.lifecyclePreview || defaults);
    }
  }, [value, prefs]);
  async function save({ display, material }: LifecyclePreviewPreferences) {
    if (!live || !prefs || saving.current) return;
    const next: LifecyclePreviewPreferences = { display, material, progress: 'energy' };
    saving.current = true;
    setBusy(true);
    setDraft(next);
    setError('');
    setSaved(false);
    try {
      const result = await request<AppearanceSettings>('appearance', {
        expectedRevision: prefs.revision,
        lifecyclePreview: next,
      });
      if (!result.lifecyclePreview)
        throw new Error(tr('当前后台尚未支持启停预览，请等待开发更新完成。'));
      setPrefs(result);
      setDraft(result.lifecyclePreview);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const steps = flow === 'start' ? startup : shutdown;
  const finished = step === steps.length;
  const title = failed
    ? tr('退出尚未完成')
    : finished
      ? tr(flow === 'start' ? 'Palboo 已就绪' : 'Palboo 已完全退出')
      : tr(flow === 'start' ? '正在启动 Palboo' : '正在退出 Palboo');
  function play(next: 'start' | 'exit', stuck = false) {
    timings.current = stuck ? [0.7, 1.1] : [];
    setFlow(next);
    setFailed(stuck);
    setStep(stuck ? 2 : 0);
    setElapsed(0);
    setShown(draft.display === 'popup');
    setRun((n) => n + 1);
    setRunning(!stuck);
  }
  useEffect(() => {
    if (!running) return;
    const origin = performance.now();
    const intervals = flow === 'start' ? [700, 1800, 3600, 4600, 5300] : [700, 1800, 3200, 3900];
    let phaseStart = origin;
    const timers = intervals.map((ms, i) =>
      setTimeout(() => {
        const now = performance.now();
        timings.current[i] = (now - phaseStart) / 1000;
        phaseStart = now;
        setStep(i + 1);
      }, ms),
    );
    const clock = setInterval(() => setElapsed((performance.now() - origin) / 1000), 200);
    timers.push(setTimeout(() => clearInterval(clock), intervals.at(-1)!));
    timers.push(
      setTimeout(
        () => {
          setShown(false);
          setRunning(false);
        },
        intervals.at(-1)! + 2000,
      ),
    );
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(clock);
    };
  }, [run, running, flow]);
  useEffect(() => {
    const node = scene.current?.closest('[data-settings-page]');
    if (!node) return;
    const observer = new MutationObserver(() => {
      if (node.hasAttribute('hidden')) setRunning(false);
    });
    observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    return () => observer.disconnect();
  }, []);
  const disabled = !live || !prefs || busy;
  return (
    <Card
      id="settings-lifecycle-preview"
      data-settings-navigation
      onChange={(event) => event.stopPropagation()}
    >
      <h2>{tr('启停反馈')}</h2>
      <p className="lifecycle-notice">{tr('下方为演示预览；保存的选择会用于实际启动和退出。')}</p>
      <div className="lifecycle-scene" ref={scene}>
        <div className="lifecycle-menubar">
          <span>Palboo</span>
          {draft.display !== 'hidden' && (
            <button
              type="button"
              aria-label={tr('展开或收起提示')}
              title={title}
              onClick={() => setShown((v) => !v)}
            >
              <Eyes />
            </button>
          )}
        </div>
        {shown && draft.display !== 'hidden' && (
          <div
            className="lifecycle-notification"
            data-material={draft.material}
            data-failed={failed}
          >
            <header>
              <Eyes />
              <strong>{title}</strong>
              <button
                type="button"
                aria-label={tr('收起提示')}
                onClick={() => setShown(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setShown(false);
                }}
              >
                <Icon name="close" />
              </button>
            </header>
            <ol aria-live="polite">
              {steps.slice(0, Math.min(step + 1, steps.length)).map((text, i) => (
                <li key={`${flow}-${i}`} data-done={i < step}>
                  <span className="lifecycle-mark" aria-hidden="true">
                    <Icon name={i < step ? 'check' : failed ? 'warning' : 'next'} />
                  </span>
                  <span className="lifecycle-step-label">
                    {tr(failed && i === step ? '兼容服务仍在退出' : text)}
                  </span>
                  <time>
                    {i < step
                      ? `${(timings.current[i] ?? 0.8).toFixed(1)}s`
                      : failed
                        ? tr('等待中')
                        : `${Math.max(0, elapsed - timings.current.reduce((sum, n) => sum + n, 0)).toFixed(1)}s`}
                  </time>
                </li>
              ))}
            </ol>
            <div
              role="progressbar"
              aria-label={tr('已完成步骤')}
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={step}
            >
              <LifecycleBar value={step / steps.length} animate={running && !failed} />
            </div>
            <footer>
              {tr('{{completed}} / {{total}} 步', { completed: step, total: steps.length })}
            </footer>
          </div>
        )}
        {(!shown || draft.display === 'hidden') && (
          <p className="lifecycle-quiet" role="status">
            {draft.display === 'hidden' ? tr('不显示启停提示') : title}
          </p>
        )}
      </div>
      <div className="lifecycle-actions">
        <Button type="button" variant="outline" onClick={() => play('start')}>
          {tr('播放启动')}
        </Button>
        <Button type="button" variant="outline" onClick={() => play('exit')}>
          {tr('播放退出')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => play('exit', true)}>
          {tr('模拟卡住')}
        </Button>
      </div>
      <Field id="lifecycle-display" label={tr('提示方式')}>
        <NativeSelect
          id="lifecycle-display"
          controlWidth="medium"
          disabled={disabled}
          value={draft.display}
          onChange={(e) => {
            const display = e.target.value as typeof draft.display;
            setShown(display === 'popup');
            void save({ ...draft, display });
          }}
        >
          <option value="popup">{tr('自动弹出')}</option>
          <option value="menu">{tr('仅菜单栏，不弹窗')}</option>
          <option value="hidden">{tr('不显示')}</option>
        </NativeSelect>
      </Field>
      <Field id="lifecycle-material" label={tr('提示材质')}>
        <NativeSelect
          id="lifecycle-material"
          controlWidth="medium"
          disabled={disabled}
          value={draft.material}
          onChange={(e) =>
            void save({ ...draft, material: e.target.value as typeof draft.material })
          }
        >
          <option value="auto">{tr('自动')}</option>
          <option value="glass">{tr('液态')}</option>
          <option value="frosted">{tr('磨砂')}</option>
          <option value="matte">{tr('哑光')}</option>
        </NativeSelect>
      </Field>
      <p className="lifecycle-notice">
        {tr('网页材质为近似预览。原生预览在旧系统使用磨砂；减少透明度时使用哑光。')}
      </p>
      <Feedback text={error} failed />
      <Feedback text={saved ? tr('设置已保存') : ''} />
      {error && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => void save(draft)}
        >
          {tr('重试保存')}
        </Button>
      )}
    </Card>
  );
}
