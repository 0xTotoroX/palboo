import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Explicit action, consequence text, optional details and configuration revision.
 * [OUTPUT]: Shared confirmation dialog with measured height motion, safe initial focus, retained inert exit content, cancellation and failure feedback.
 * [POS]: Settings-only presentation; opening/cancelling never executes the supplied action.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from './components/ui/button';
import { useDialogHeight } from './use-dialog-height';

type Confirmation = {
  title: string;
  description?: string;
  notice?: ReactNode;
  details?: ReactNode;
  footerNote?: ReactNode;
  confirmLabel?: string;
  action: () => unknown | Promise<unknown>;
};
export function useConfirmation(revision?: number | string, blocked = false) {
  const [pending, setPending] = useState<(Confirmation & { revision?: number | string }) | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const lastContent = useRef<Pick<Confirmation, 'title' | 'description' | 'confirmLabel'> | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useDialogHeight(dialog, content);
  const id = useId();
  const latest = useRef({ revision, blocked });
  latest.current = { revision, blocked };
  useEffect(() => {
    const node = dialog.current;
    if (pending && !node?.open) {
      node?.showModal();
      node?.scrollTo(0, 0);
      cancel.current?.focus({ preventScroll: true });
    }
    if (!pending && node?.open) node.close();
  }, [pending]);
  function confirm(options: Confirmation) {
    if (flight.current) return;
    const { title, description, confirmLabel } = options;
    lastContent.current = { title, description, confirmLabel };
    setError('');
    setPending({ ...options, revision });
  }
  async function run() {
    if (!pending || flight.current || latest.current.blocked) return;
    if (latest.current.revision !== pending.revision) {
      setError(tr('设置已变化，请关闭后重新确认。'));
      return;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await pending.action();
      if (result === false) throw Error(tr('操作未完成，请检查页面中的错误提示后重试。'));
      setPending(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const hasDetails = Boolean(pending?.details);
  const description = lastContent.current?.description;
  const confirmation = (
    <dialog
      ref={dialog}
      className="settings-key-dialog"
      data-has-details={hasDetails ? 'true' : undefined}
      inert={!pending}
      data-settings-navigation
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        if (flight.current) event.preventDefault();
        else setPending(null);
      }}
    >
      <div ref={content} className="settings-dialog-content">
        <div className="settings-confirm-header">
          <h3 id={`${id}-title`}>{lastContent.current?.title}</h3>
          {description && (
            <p id={`${id}-description`} className="settings-confirm-description">
              {description}
            </p>
          )}
          {pending?.notice}
        </div>
        {pending?.details && <div className="settings-confirm-body">{pending.details}</div>}
        {error && (
          <p role="alert" className="settings-error settings-confirm-error">
            {error}
          </p>
        )}
        <div className="settings-confirm-footer">
          {pending?.footerNote && <p className="settings-confirm-note">{pending.footerNote}</p>}
          <div className="settings-confirm-actions">
            <Button
              ref={cancel}
              type="button"
              variant="outline"
              autoFocus
              data-settings-navigation
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {tr('取消')}
            </Button>
            <Button
              type="button"
              data-settings-navigation
              disabled={busy || blocked}
              aria-busy={busy}
              onClick={() => void run()}
            >
              {busy ? tr('处理中…') : lastContent.current?.confirmLabel || tr('确认')}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
  return { confirm, confirmation };
}
export function ConfirmationButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  revision,
  confirmDisabled,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'title'> & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: Confirmation['action'];
  revision?: number | string;
  confirmDisabled?: boolean;
}) {
  useLocale();
  const { confirm, confirmation } = useConfirmation(revision, confirmDisabled || props.disabled);
  return (
    <>
      <Button
        {...props}
        type="button"
        data-settings-navigation
        onClick={() => confirm({ title, description, confirmLabel, action: onConfirm })}
      />
      {confirmation}
    </>
  );
}
