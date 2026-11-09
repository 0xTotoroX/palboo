/* [INPUT]: Authenticated local backup API, current settings draft state and native file input.
 * [OUTPUT]: Two task-first file actions, conditional environment transfer and undo, and explicit difference review.
 * [POS]: Settings-only transfer controls; no cloud transport or automatic synchronization.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { request } from './api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { Field, Feedback, Toggle } from './settings-controls';
import { SettingsDrawer, revealSettingsDrawer, closeSettingsDrawers } from './settings-drawer';

type Target = { id: string; label: string; path: string; version: string | null; current: boolean };
type Status = {
  targets: Target[];
  sections: { id: string; label: string; default: boolean }[];
  canUndo: boolean;
  last?: { previewId: string; ok: boolean; id?: string; message?: string };
};
type Preview = {
  previewId: string;
  sections: string[];
  target: Target;
  restart: boolean;
  changes: { file: string; fields: string[]; secret: boolean; removed: boolean }[];
  available?: string[];
};
const fileLabels: Record<string, string> = {
  'config.json': '功能与模型服务',
  'panel.json': '外观与字体',
  'features.json': '布局与预设',
  'surfaces.json': '贴边与材质',
  'model-control.json': '模型分组与预设',
  'web-library.json': '阅读与网页',
  'tasks.json': '任务看板',
  'terminology-settings.json': '术语设置',
  'terminology-store.json': '术语与导入记录',
  'terminology-library.json': '基础术语',
  'terminology-manual.json': '个人术语',
  'secrets.json': 'API 密钥',
  'reader-preferences.json': '阅读器布局',
};
function targetLabel(label: string) {
  return label.startsWith('开发版 · ')
    ? tr('开发版 · {{name}}', { name: label.slice(6) })
    : tr(label);
}
function toBase64(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function BackupSettings({
  active,
  live,
  dirty,
}: {
  active: boolean;
  live: boolean;
  dirty: boolean;
}) {
  useLocale();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState(false);
  const [secrets, setSecrets] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [encryptedFile, setEncryptedFile] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  useEffect(() => {
    if (!file) return;
    let canceled = false;
    void file
      .slice(0, 19)
      .text()
      .then((prefix) => {
        if (!canceled) setEncryptedFile(prefix.startsWith('age-encryption.org/'));
      })
      .catch(() => {
        if (!canceled) setEncryptedFile(file.name.toLowerCase().endsWith('.age'));
      })
      .finally(() => {
        if (!canceled) setReadingFile(false);
      });
    return () => {
      canceled = true;
    };
  }, [file]);
  const [source, setSource] = useState('current');
  const [restoreTarget, setRestoreTarget] = useState('current');
  const [copyTarget, setCopyTarget] = useState('current');
  const [restoreSelection, setRestoreSelection] = useState<string[] | null>(null);
  const [copySelection, setCopySelection] = useState<string[] | null>(null);
  const restoreSections = restoreSelection || [];
  const copySections = copySelection || [];
  const reviewOpener = useRef('backup-restore');
  const targets = status?.targets || [];
  const multipleTargets = targets.length > 1;
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!active) {
      if (preview) setPreview(null);
      return;
    }
    const element = document.getElementById('backup-review');
    if (preview && element) revealSettingsDrawer(element);
  }, [active, preview]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active || !live) return;
    let canceled = false;
    void request<Status>('backup', { op: 'status' })
      .then((next) => {
        if (canceled) return;
        setStatus(next);
        const defaults = next.sections.filter((item) => item.default).map((item) => item.id);
        setRestoreSelection((current) => current ?? defaults);
        setCopySelection((current) => current ?? defaults);
        const validTarget = (id: string) =>
          next.targets.some((item) => item.id === id) ? id : 'current';
        setRestoreTarget(validTarget);
        setCopyTarget(validTarget);
        setSource(validTarget);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      });
    return () => {
      canceled = true;
    };
  }, [active, live]);
  const blocked = !live || !!busy || dirty;
  function invalidate() {
    setPreview(null);
    setError('');
    setMessage('');
  }
  async function run(op: string, action: () => Promise<void>) {
    if (blocked) return;
    setBusy(op);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function exportFile() {
    const result = await request<{ data: string; filename: string }>('backup', {
      op: 'export',
      includeData: data,
      includeSecrets: secrets,
      password: encrypt || secrets ? password : '',
    });
    const blob = new Blob([Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    setPassword('');
    closeSettingsDrawers();
    setMessage(tr('备份已生成，请保存下载文件。'));
  }
  async function inspect(copy = false) {
    const selected = copy ? copySections : restoreSections;
    let encoded: string | undefined;
    if (!copy) {
      if (!file) throw Error(tr('请选择备份文件'));
      if (file.size > 128 * 1024 * 1024) throw Error(tr('备份超过 128 MB'));
      encoded = toBase64(new Uint8Array(await file.arrayBuffer()));
    }
    const next = await request<Preview>('backup', {
      op: copy ? 'copy' : 'preview',
      data: encoded,
      password: copy || !encryptedFile ? undefined : importPassword,
      source: copy ? source : undefined,
      target: multipleTargets ? (copy ? copyTarget : restoreTarget) : 'current',
      sections: selected,
      includeData: selected.includes('data'),
      includeSecrets: selected.includes('secrets'),
    });
    reviewOpener.current = copy ? 'backup-copy' : 'backup-restore';
    setPreview(next);
    setImportPassword('');
  }
  async function apply() {
    if (!preview || dirty) return;
    const result = await request<{ restarting: boolean; remotePending?: boolean }>('backup', {
      op: 'apply',
      previewId: preview.previewId,
      confirm: true,
    });
    setPreview(null);
    closeSettingsDrawers();
    if (result.restarting || result.remotePending) {
      setMessage(tr('正在重新载入 Palboo…'));
      const until = Date.now() + 30000;
      while (Date.now() < until && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        try {
          const next = await request<Status>('backup', { op: 'status' });
          if (next.last?.previewId === preview.previewId && next.last.ok === false)
            throw Error(next.last.message);
          if (next.last?.previewId === preview.previewId && next.last.ok) {
            setStatus(next);
            setMessage(
              tr(
                result.restarting
                  ? '配置已恢复，Palboo 已重新就绪。'
                  : '配置已复制，目标环境已重新就绪。',
              ),
            );
            return;
          }
        } catch (e) {
          if (
            (e as Error).message &&
            !(e as Error).message.includes('恢复配置') &&
            !(e as Error).message.includes('fetch')
          ) {
            const next = await request<Status>('backup', { op: 'status' }).catch(() => null);
            if (next?.last?.previewId === preview.previewId && next.last.ok === false)
              throw Error(next.last.message);
          }
        }
      }
      throw Error(tr('恢复结果尚未确认，请重新打开设置页查看。'));
    }
    setMessage(tr('配置已应用；目标下次启动时生效。'));
    setStatus(await request<Status>('backup', { op: 'status' }));
  }
  const passwordVisible = encrypt || secrets;
  const scopeFields = (selected: string[], setSelection: typeof setRestoreSelection) => (
    <div className="settings-backup-sections" role="group" aria-label={tr('恢复范围')}>
      {status?.sections.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            disabled={blocked}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelection((items) =>
                checked
                  ? [...(items || []), item.id]
                  : (items || []).filter((id) => id !== item.id),
              );
              invalidate();
            }}
          />
          <span>{targetLabel(item.label)}</span>
        </label>
      ))}
    </div>
  );
  const targetField = (id: string, target: string, setTarget: (id: string) => void) =>
    multipleTargets && (
      <Field id={id} label={tr('目标环境')}>
        <NativeSelect
          id={id}
          value={target}
          disabled={blocked}
          onChange={(event) => {
            setTarget(event.target.value);
            invalidate();
          }}
        >
          {targets.map((item) => (
            <option key={item.id} value={item.id}>
              {targetLabel(item.label)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    );
  const undo = (opener: string, environment: string) =>
    void run('undo', async () => {
      const value = await request<Preview>('backup', { op: 'undo', target: environment });
      reviewOpener.current = opener;
      setPreview(value);
    });
  return (
    <section hidden={!active} data-settings-page="backup" className="settings-section">
      <Feedback text={error} failed />
      <Feedback text={message} />
      {dirty && <Feedback text={tr('请先保存或还原当前设置，再备份或恢复。')} failed />}
      <Card>
        <SettingsDrawer id="backup-export" title={tr('备份到文件')}>
          <Toggle
            label={tr('包含任务与术语数据')}
            checked={data}
            disabled={blocked}
            onChange={setData}
          />
          <Toggle
            label={tr('包含 API 密钥')}
            checked={secrets}
            disabled={blocked}
            onChange={setSecrets}
          />
          {!secrets && (
            <Toggle
              label={tr('加密备份')}
              checked={encrypt}
              disabled={blocked}
              onChange={setEncrypt}
            />
          )}
          <div hidden={!passwordVisible}>
            <Field id="backup-password" label={tr('备份密码')}>
              <Input
                id="backup-password"
                type="password"
                autoComplete="new-password"
                placeholder={tr('密码至少 10 个字符')}
                value={password}
                disabled={blocked || !passwordVisible}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </div>
          <div className="settings-actions">
            <Button
              type="button"
              disabled={blocked || (passwordVisible && password.length < 10)}
              onClick={() => void run('export', exportFile)}
            >
              {tr(busy === 'export' ? '正在导出…' : '导出备份')}
            </Button>
          </div>
        </SettingsDrawer>
        <SettingsDrawer id="backup-restore" title={tr('从文件恢复')}>
          <Field id="backup-file" label={tr('备份文件')}>
            <Input
              className="h-auto py-2 file:mr-3 file:border-0 file:bg-transparent file:text-foreground"
              id="backup-file"
              type="file"
              accept=".palboo,.age"
              disabled={blocked}
              onChange={(event) => {
                const next = event.target.files?.[0] || null;
                setFile(next);
                setReadingFile(!!next);
                setEncryptedFile(false);
                setImportPassword('');
                invalidate();
              }}
            />
          </Field>
          {file && (
            <>
              {targetField('backup-target', restoreTarget, setRestoreTarget)}
              {encryptedFile && (
                <Field id="backup-import-password" label={tr('备份密码')}>
                  <Input
                    id="backup-import-password"
                    type="password"
                    autoComplete="off"
                    value={importPassword}
                    disabled={blocked}
                    onChange={(event) => {
                      setImportPassword(event.target.value);
                      invalidate();
                    }}
                  />
                </Field>
              )}
              {scopeFields(restoreSections, setRestoreSelection)}
              <div className="settings-actions">
                <Button
                  disabled={
                    blocked ||
                    readingFile ||
                    !restoreSections.length ||
                    (encryptedFile && !importPassword)
                  }
                  onClick={() => void run('preview', () => inspect())}
                >
                  {tr('预览恢复')}
                </Button>
              </div>
            </>
          )}
        </SettingsDrawer>
        {multipleTargets && (
          <SettingsDrawer id="backup-copy" title={tr('在本机环境间复制')}>
            <Field id="backup-source" label={tr('复制来源')}>
              <NativeSelect
                id="backup-source"
                value={source}
                disabled={blocked}
                onChange={(event) => {
                  setSource(event.target.value);
                  invalidate();
                }}
              >
                {targets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {targetLabel(item.label)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {targetField('backup-copy-target', copyTarget, setCopyTarget)}
            {scopeFields(copySections, setCopySelection)}
            <div className="settings-actions">
              {copyTarget !== 'current' && (
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => undo('backup-copy', copyTarget)}
                >
                  {tr('撤销上次恢复')}
                </Button>
              )}
              <Button
                disabled={blocked || source === copyTarget || !copySections.length}
                onClick={() => void run('copy', () => inspect(true))}
              >
                {tr('预览复制')}
              </Button>
            </div>
          </SettingsDrawer>
        )}
        {status?.canUndo && (
          <div className="settings-actions">
            <Button
              id="backup-undo"
              variant="ghost"
              disabled={blocked}
              onClick={() => undo('backup-undo', 'current')}
            >
              {tr('撤销上次恢复')}
            </Button>
          </div>
        )}
      </Card>
      <SettingsDrawer
        id="backup-review"
        title={tr('确认恢复范围')}
        hidden={!preview}
        hideTrigger
        onClose={() => {
          setPreview(null);
          const opener = document.getElementById(reviewOpener.current);
          (opener?.matches('button') ? opener : opener?.querySelector('button'))?.focus({
            preventScroll: true,
          });
        }}
      >
        {preview && (
          <>
            <dl>
              <dt>{tr('目标环境')}</dt>
              <dd>{targetLabel(preview.target.label)}</dd>
              <dt>{tr('数据目录')}</dt>
              <dd className="break-all">{preview.target.path}</dd>
            </dl>
            <ul className="settings-backup-changes">
              {preview.changes.map((change) => (
                <li key={change.file}>
                  <span>{tr(fileLabels[change.file] || '导入原件')}</span>
                  <span>
                    {change.secret
                      ? tr('替换密钥')
                      : tr('{{count}} 项变化', { count: Math.max(1, change.fields.length) })}
                  </span>
                </li>
              ))}
            </ul>
            <p>{tr('所选模块将替换目标配置，应用前自动保存恢复点。')}</p>
            {preview.sections?.includes('machine') && (
              <p>{tr('将恢复本机目录与设备设置，包括所选阅读目录的访问范围。')}</p>
            )}
            {preview.sections?.includes('data') && (
              <p>{tr('任务与术语将被替换；提醒事项同步保持暂停，未完成的术语任务需手动重试。')}</p>
            )}
            {preview.restart && (
              <p>{tr('功能窗口将重新载入，请先保存其中的编辑；Codex 保持运行。')}</p>
            )}
            <div className="settings-actions">
              <Button
                disabled={blocked || !preview.changes.length}
                onClick={() => void run('apply', apply)}
              >
                {tr('应用配置')}
              </Button>
            </div>
          </>
        )}
      </SettingsDrawer>
    </section>
  );
}
