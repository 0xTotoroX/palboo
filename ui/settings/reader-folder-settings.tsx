/* [INPUT]: Revisioned folder grants and the existing website settings save/open callbacks.
 * [OUTPUT]: A visible folder list and one retained folder editor; selecting a path never saves it.
 * [POS]: Local settings only; removing an entry never removes source files.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { Button, IconButton } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect } from './components/ui/native-select';
import { SettingsDetail, closeSettingsDetails, showSettingsDetail } from './settings-detail';
import { useConfirmation } from './settings-confirmation';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import type { NoteFolder, WebLibrary } from '../shared/web-library';

const empty = () => ({ id: '', name: '', path: '', attachments: '' });
const signature = (value: WebLibrary) => JSON.stringify(value.folders || []);
export function ReaderFolderSettings({
  state,
  active,
  disabled,
  error,
  clearError,
  save,
  open,
}: {
  state: WebLibrary | null;
  active: boolean;
  disabled: boolean;
  error: string;
  clearError: () => void;
  save: (patch: Partial<WebLibrary>, revision?: number) => Promise<boolean>;
  open: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState(empty);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const draft = useRef<{ revision: number; signature: string } | null>(null);
  const pathField = useRef<HTMLInputElement>(null);
  const pickerFlight = useRef(false);
  const confirmation = useConfirmation(state?.revision, disabled || picking);
  const blocked = disabled || picking;
  function load(folder?: NoteFolder) {
    draft.current = null;
    setPickerError('');
    clearError();
    setForm(folder ? { ...folder, attachments: folder.attachments.join('\n') } : empty());
  }
  useEffect(() => {
    if (!state) return;
    if (draft.current) {
      if (
        draft.current.signature === signature(state) &&
        draft.current.revision !== state.revision
      ) {
        draft.current.revision = state.revision;
        setForm((previous) => ({ ...previous }));
      }
    } else if (form.id) {
      load(state.folders?.find((folder) => folder.id === form.id));
    }
  }, [state]);
  function edit(patch: Partial<typeof form>) {
    if (state && !draft.current)
      draft.current = { revision: state.revision, signature: signature(state) };
    setForm((previous) => ({ ...previous, ...patch }));
  }
  function start(folder?: NoteFolder) {
    if (draft.current && folder?.id === form.id) {
      if (pathField.current) showSettingsDetail(pathField.current);
      return;
    }
    const show = () => {
      load(folder);
      if (pathField.current) showSettingsDetail(pathField.current);
    };
    if (draft.current && folder?.id !== form.id) {
      confirmation.confirm({
        title: tr('放弃未保存的修改？'),
        description: form.name || form.path,
        action: async () => {
          show();
          return true;
        },
      });
    } else show();
  }
  async function choose() {
    if (blocked || pickerFlight.current) return;
    pickerFlight.current = true;
    setPicking(true);
    setPickerError('');
    try {
      const result = await request<{ path: string | null }>('web-library/choose-directory', {});
      if (result.path) edit({ path: result.path });
    } catch (error) {
      setPickerError((error as Error).message);
    } finally {
      pickerFlight.current = false;
      setPicking(false);
    }
  }
  async function submit() {
    if (!state || blocked) return;
    const path = form.path.trim();
    const folder: NoteFolder = {
      id: form.id || crypto.randomUUID(),
      name: form.name.trim() || path.split('/').filter(Boolean).at(-1) || '',
      path,
      attachments: form.attachments
        .split('\n')
        .map((path) => path.trim())
        .filter(Boolean),
    };
    const folders = form.id
      ? (state.folders || []).map((item) => (item.id === form.id ? folder : item))
      : [...(state.folders || []), folder];
    if (await save({ folders }, draft.current?.revision ?? state.revision)) {
      closeSettingsDetails();
      load();
    }
  }
  return (
    <section className="settings-section reader-configuration">
      <div className="web-library-heading">
        <h2>{tr('本地笔记')}</h2>
        <SettingsDetail
          title={form.id ? tr('编辑文件夹') : tr('添加文件夹')}
          hidden={!active}
          compact
          footer={
            <>
              <Feedback text={pickerError || error} failed />
              <div className="settings-actions">
                {draft.current && state && draft.current.revision !== state.revision && (
                  <Button
                    variant="outline"
                    disabled={blocked}
                    onClick={() => load(state.folders?.find((folder) => folder.id === form.id))}
                  >
                    {tr('重新读取已保存目录')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => {
                    closeSettingsDetails();
                    load();
                  }}
                >
                  {tr('取消')}
                </Button>
                <Button
                  disabled={blocked || !draft.current || !form.path.trim()}
                  onClick={() => void submit()}
                >
                  {tr('保存')}
                </Button>
              </div>
            </>
          }
        >
          <Field label={tr('名称')} id="reader-folder-name">
            <Input
              id="reader-folder-name"
              value={form.name}
              maxLength={120}
              placeholder={tr('默认使用文件夹名称')}
              disabled={blocked}
              onChange={(event) => edit({ name: event.target.value })}
            />
          </Field>
          <label htmlFor="reader-vault" className="reader-folder-label">
            {tr('笔记文件夹')}
          </label>
          <div className="reader-folder-choice">
            {!!state?.vaults?.length && (
              <NativeSelect
                id="reader-vault-choice"
                aria-label={tr('已发现的笔记库')}
                value={state.vaults.includes(form.path) ? form.path : ''}
                disabled={blocked}
                onChange={(event) => edit({ path: event.target.value })}
              >
                <option value="">{form.path ? tr('自定义文件夹') : tr('选择笔记库')}</option>
                {state.vaults.map((path) => (
                  <option key={path} value={path}>
                    {path.split('/').at(-1)}
                    {state.vaults!.filter(
                      (other) => other.split('/').at(-1) === path.split('/').at(-1),
                    ).length > 1
                      ? ` · ${path}`
                      : ''}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Button variant="outline" disabled={blocked} onClick={() => void choose()}>
              <Icon name="reader-folder" />
              {tr('选择文件夹')}
            </Button>
          </div>
          <Input
            ref={pathField}
            id="reader-vault"
            value={form.path}
            disabled={blocked}
            placeholder={tr('选择文件夹，或粘贴完整路径')}
            onChange={(event) => edit({ path: event.target.value })}
          />
          <Field
            label={tr('额外附件目录')}
            id="reader-attachments"
            hint={tr('仅在图片位于笔记库外时添加，每行一个目录。')}
          >
            <textarea
              id="reader-attachments"
              rows={2}
              value={form.attachments}
              disabled={blocked}
              onChange={(event) => edit({ attachments: event.target.value })}
            />
          </Field>
        </SettingsDetail>
      </div>
      <div className="web-library-list reader-folder-list">
        {state?.folders?.map((folder) => (
          <div className="web-library-row" key={folder.id}>
            <Icon name="reader-folder" />
            <button
              className="web-library-open"
              disabled={disabled}
              onClick={() => void open(`folder:${folder.id}`)}
            >
              <span>{folder.name}</span>
              <small>{folder.path}</small>
            </button>
            <IconButton
              variant="ghost"
              aria-label={tr('编辑{{name}}', { name: folder.name })}
              disabled={blocked}
              onClick={() => start(folder)}
            >
              <Icon name="pencil" />
            </IconButton>
            <IconButton
              variant="ghost"
              aria-label={tr('移除{{name}}', { name: folder.name })}
              disabled={blocked}
              onClick={() =>
                confirmation.confirm({
                  title: tr('移除文件夹'),
                  description: tr('仅移除入口，原文件保留。'),
                  action: () =>
                    save({ folders: state.folders!.filter((item) => item.id !== folder.id) }),
                })
              }
            >
              <Icon name="trash" />
            </IconButton>
          </div>
        ))}
      </div>
      {confirmation.confirmation}
    </section>
  );
}
