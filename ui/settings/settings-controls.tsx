/* [INPUT]: 现有基础控件、动作反馈和设置保存队列。
 * [OUTPUT]: 统一设置行、功能开关、就近保存反馈及跨页无效字段定位；仅输入控件失焦自动保存，原表单归属与队列不变。
 * [POS]: 设置页组合组件，不持有业务数据或新增保存服务。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useId, useRef, useState, useEffect, type ReactNode } from 'react';
import { revealSettingsField } from './settings-outline';
import { ConfirmationButton } from './settings-confirmation';
import { Button } from './components/ui/button';
import { ActionIcon, type ActionState } from './components/ui/action-feedback';
import { Switch } from './components/ui/switch';
import { request, type Settings } from './api';
import type { SettingsEditor } from './use-settings-form';
import { NearbyFeedback } from './settings-feedback';
export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <div className="min-w-0">
        {children}
        {hint && <p className="settings-hint">{hint}</p>}
      </div>
    </div>
  );
}
export function Toggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id?: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}
export function FeatureSwitch({
  name,
  checked,
  disabled,
  onChange,
  actions,
}: {
  name: string;
  actions?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="settings-row settings-feature-switch">
      <label htmlFor={id}>{name}</label>
      <div className="flex shrink-0 items-center gap-4">
        {actions}
        <Switch
          id={id}
          aria-label={`启用${name}`}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
    </div>
  );
}
export function Feedback({
  text,
  failed = false,
  target,
}: {
  text?: string;
  failed?: boolean;
  target?: HTMLElement | null;
}) {
  return text ? (
    <NearbyFeedback target={target}>
      <p
        className={failed ? 'settings-feedback settings-error' : 'settings-feedback'}
        role={failed ? 'alert' : 'status'}
      >
        {text}
      </p>
    </NearbyFeedback>
  ) : null;
}
export function SettingsForm({
  editor,
  notify,
  children,
  active,
}: {
  editor: SettingsEditor;
  notify: (text: string, failed?: boolean) => void;
  children: ReactNode;
  active: boolean;
}) {
  const { dirty, saving, remoteChanged, save, schedule, load } = editor;
  const formId = useId();
  const [manualState, setManualState] = useState<ActionState>('idle');
  const [savedBriefly, setSavedBriefly] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving && !dirty && !editor.saveError && !remoteChanged)
      setSavedBriefly(true);
    if (dirty || saving || editor.saveError || remoteChanged) setSavedBriefly(false);
    wasSaving.current = saving;
  }, [saving, dirty, editor.saveError, remoteChanged]);
  useEffect(() => {
    if (!savedBriefly) return;
    const timer = setTimeout(() => setSavedBriefly(false), 1200);
    return () => clearTimeout(timer);
  }, [savedBriefly]);
  const manualFlight = useRef(false);
  useEffect(() => {
    if (manualState !== 'success') return;
    const timer = setTimeout(() => setManualState('idle'), 1200);
    return () => clearTimeout(timer);
  }, [manualState]);
  const actionState =
    saving || manualState === 'pending'
      ? 'pending'
      : !dirty && !remoteChanged
        ? manualState
        : 'idle';
  async function saveManually() {
    if (manualFlight.current) return;
    manualFlight.current = true;
    setManualState('pending');
    try {
      const result = await save();
      setManualState(result && !result.presentationError ? 'success' : 'idle');
    } catch (error) {
      setManualState('idle');
      notify((error as Error).message, true);
    } finally {
      manualFlight.current = false;
    }
  }
  return (
    <form
      id={formId}
      onChangeCapture={(event) => editor.trackFeedback(event.target)}
      onInvalidCapture={(event) => {
        if ((event.target as HTMLElement).closest('[hidden],dialog:not([open])'))
          event.preventDefault();
        const first = event.currentTarget.querySelector(
          'input:invalid,select:invalid,textarea:invalid',
        );
        if (event.target === first) revealSettingsField(event.target as HTMLElement);
      }}
      onBlurCapture={(e) => {
        // Action buttons and navigation can lose focus without leaving an edited field.
        // In particular, leaving Save must not queue its old snapshot a second time.
        if (
          !(e.target instanceof Element) ||
          !e.target.matches('input, textarea, select, [contenteditable="true"]') ||
          e.target.closest('[data-settings-navigation]')
        )
          return;
        if (!(
          e.relatedTarget instanceof Element &&
          e.relatedTarget.closest('button[type="submit"], [data-settings-navigation]')
        ))
          schedule(e.currentTarget);
      }}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) schedule(e.currentTarget);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void saveManually();
      }}
    >
      {children}
      <NearbyFeedback target={editor.feedbackAt?.closest('dialog') ? null : editor.feedbackAt}>
        <div
          data-settings-form-feedback
          hidden={
            (!active && !editor.feedbackAt) ||
            !editor.form ||
            (!dirty &&
              !saving &&
              !editor.saveError &&
              !remoteChanged &&
              manualState === 'idle' &&
              !savedBriefly)
          }
        >
          {!remoteChanged && <Feedback text={editor.saveError} failed />}
          {remoteChanged && (
            <div className="settings-feedback settings-error" role="alert">
              设置已在其他窗口更新，当前编辑已保留。
              <ConfirmationButton
                type="button"
                variant="ghost"
                title="放弃当前草稿并重新载入？"
                description="尚未保存的编辑和新输入密钥会被丢弃，重新读取其他窗口已保存的设置。"
                confirmLabel="确认重新载入"
                onConfirm={() => request<Settings>('settings').then(load)}
              >
                重新载入设置
              </ConfirmationButton>
            </div>
          )}
          <div
            className="settings-save"
            data-save-state={saving ? 'saving' : dirty ? 'dirty' : 'saved'}
            hidden={!dirty && !saving && manualState === 'idle' && !savedBriefly}
          >
            <span role="status">
              {saving
                ? '正在保存…'
                : !dirty && !editor.saveError && (savedBriefly || actionState === 'success')
                  ? '已保存'
                  : ''}
            </span>
            {(dirty || manualState !== 'idle') && (
              <Button
                type="submit"
                form={formId}
                variant="outline"
                aria-busy={actionState === 'pending'}
                disabled={saving || manualFlight.current || remoteChanged || !dirty}
              >
                <ActionIcon name="bookmark" state={actionState} />
                保存设置
              </Button>
            )}
          </div>
        </div>
      </NearbyFeedback>
    </form>
  );
}
