import { useLocale } from '../shared/use-locale';
import { tr } from '../shared/i18n.js';
/* [INPUT]: Shared model editor, serialized save queue, saved-connection model API, credential controls and free-text dropdown.
 * [OUTPUT]: One directly visible model form in both modes, retaining credentials/drafts across navigation; advanced controls use a retained right-side drawer; connection tests report progress and results beside the action.
 * [POS]: Settings presentation only; all enabled API-backed features share the configured model.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { SettingsDrawer, DrawerSaveControls } from './settings-drawer';
import { useProviderFieldsMotion } from './settings-motion';
import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card } from './components/ui/card';
import { NativeSelect } from './components/ui/native-select';
import { SuggestionInput } from './components/ui/suggestion-input';
import { Field } from './settings-controls';
import { request, type EditableSettings } from './api';
import type { SettingsEditor } from './use-settings-form';
import { ActionIcon, ActionLabel } from './components/ui/action-feedback';
import { ModelApiKey, DeleteModelApiKey } from './model-credentials';
export function ModelSettings({ editor, simple }: { editor: SettingsEditor; simple?: boolean }) {
  useLocale();
  const { form, saved, change, dirty, save, remoteChanged, apiKey, clearKey } = editor;
  const fieldsRef = useProviderFieldsMotion(form?.provider);
  const [busy, setBusy] = useState('');
  const [testFeedback, setTestFeedback] = useState<{
    text: string;
    failed?: boolean;
    success?: boolean;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const testing = useRef(false);
  const latestEditor = useRef(editor);
  latestEditor.current = editor;
  useEffect(() => {
    if (!testing.current) setTestFeedback(null);
  }, [
    form,
    apiKey,
    clearKey,
    editor.jevApiKey,
    editor.clearJevKey,
    remoteChanged,
    saved?.configurationRevision,
  ]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [catalog, setCatalog] = useState<{
    revision: number;
    models: string[];
    loading: boolean;
    message?: string;
    success?: boolean;
  } | null>(null);
  const modelRequest = useRef(0);
  const connectionDirty =
    !!form &&
    !!saved &&
    (!!apiKey ||
      clearKey ||
      remoteChanged ||
      editor.saving ||
      (['provider', 'protocol', 'baseUrl', 'apiKeyEnv'] as const).some(
        (key) => form[key] !== saved[key],
      ));
  const currentCatalog = catalog?.revision === saved?.configurationRevision ? catalog : null;
  async function readModels() {
    if (!saved || connectionDirty || currentCatalog?.loading) return;
    const requestId = ++modelRequest.current;
    const revision = saved.configurationRevision;
    setCatalog({ revision, models: [], loading: true });
    try {
      const result = await request<{ models: string[] }>('settings/models');
      if (modelRequest.current !== requestId) return;
      setCatalog({
        revision,
        models: result.models,
        success: true,
        loading: false,
        message:
          result.models.length > 0
            ? undefined
            : saved.provider === 'codex'
              ? tr('当前登录未返回候选，可留空沿用当前模型，或直接输入模型 ID。')
              : tr('服务未返回模型列表，可直接输入模型 ID。'),
      });
    } catch (error) {
      if (modelRequest.current !== requestId) return;
      setCatalog({
        revision,
        models: [],
        loading: false,
        message: tr('{{value1}}。可直接输入模型 ID，或重新展开重试。', {
          value1: (error as Error).message,
        }),
      });
    }
  }
  async function test() {
    if (testing.current || !saved || remoteChanged) return;
    testing.current = true;
    setTestFeedback(null);
    setElapsed(0);
    let phase = dirty || editor.saving ? 'saving' : 'test';
    setBusy(phase);
    const start = performance.now();
    try {
      const testedSettings = phase === 'saving' ? await save() : saved;
      const revision = testedSettings?.configurationRevision ?? saved.configurationRevision;
      phase = 'test';
      setBusy(phase);
      const result = await request<{ items: unknown[]; generationAttempted: boolean }>(
        'settings/test',
        {},
      );
      const current = latestEditor.current;
      if (
        current.dirty ||
        current.saved?.configurationRevision !== revision ||
        current.remoteChanged
      ) {
        setTestFeedback({ text: tr('配置已更改，请重新测试。') });
      } else {
        const duration = ((performance.now() - start) / 1000).toFixed(1);
        setTestFeedback({
          success: result.generationAttempted !== false,
          text:
            result.generationAttempted === false
              ? tr('测试未完成，请重新验证模型连接。')
              : tr('连接成功 · {{duration}} 秒', { duration: duration }),
        });
      }
    } catch (error) {
      setTestFeedback({
        failed: true,
        text: tr('{{value1}}：{{value2}}', {
          value1: phase === 'saving' ? tr('保存失败，尚未测试') : tr('连接测试失败'),
          value2: (error as Error).message,
        }),
      });
    } finally {
      testing.current = false;
      setBusy('');
    }
  }
  if (!form || !saved) return null;
  return (
    <>
      <Card tabIndex={-1} id="settings-model" aria-labelledby="model-title">
        <div ref={fieldsRef} className="settings-model-editor">
          <div>
            <h2 id="model-title" hidden>
              {tr('模型服务')}
            </h2>
            {saved.environmentOverrides.length > 0 && (
              <div className="mb-4 rounded-[9px] border border-notice-border bg-notice px-[13px] py-[11px] text-[14px] leading-[1.8] text-notice-foreground [overflow-wrap:anywhere]">
                {tr('当前进程环境变量优先：')}
                {saved.environmentOverrides.join('、')}
                {tr('。修改对应字段后需去掉环境覆盖并重启。')}
              </div>
            )}
            <Field id="provider" label={tr('模型来源')}>
              <NativeSelect
                id="provider"
                controlWidth="short"
                value={form.provider}
                onChange={(e) => change('provider', e.target.value as 'codex' | 'api')}
              >
                <option value="codex">{tr('现有 Codex 登录')}</option>
                <option value="api">{tr('指定 API')}</option>
              </NativeSelect>
            </Field>
            {form.provider === 'api' && (
              <>
                <div hidden={simple}>
                  <Field id="protocol" label={tr('API 协议')}>
                    <NativeSelect
                      id="protocol"
                      controlWidth="medium"
                      value={form.protocol}
                      onChange={(e) =>
                        change('protocol', e.target.value as EditableSettings['protocol'])
                      }
                    >
                      <option value="responses">OpenAI Responses</option>
                      <option value="chat_completions">Chat Completions</option>
                      <option value="anthropic_messages">Anthropic Messages</option>
                      <option value="auto">{tr('自动识别')}</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Field id="base-url" label={tr('API 地址')}>
                  <Input
                    id="base-url"
                    type="url"
                    value={form.baseUrl}
                    onChange={(e) => change('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    spellCheck={false}
                  />
                </Field>
                <ModelApiKey editor={editor} busy={!!busy} />
              </>
            )}
            <Field id="model" label={tr('模型名称')}>
              <SuggestionInput
                id="model"
                value={form.model}
                options={connectionDirty ? [] : currentCatalog?.models || []}
                onValueChange={(value) => change('model', value)}
                placeholder={form.provider === 'codex' ? tr('沿用当前模型') : tr('模型 ID')}
                spellCheck={false}
                dropdown={{
                  label: tr('选择模型'),
                  onOpen: () => void readModels(),
                  loading: !connectionDirty && currentCatalog?.loading,
                  success: !connectionDirty && currentCatalog?.success,
                  message: connectionDirty
                    ? tr('请先保存连接配置，再读取模型列表；也可直接输入模型 ID。')
                    : currentCatalog?.message,
                }}
              />
            </Field>
            <div className="settings-actions mt-5">
              {!saved.available && (
                <p className="settings-error mr-auto">{saved.reason || tr('等待配置')}</p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={!!busy || remoteChanged}
                onClick={() => void test()}
                className="settings-connection-test"
                data-connection-state={
                  busy
                    ? 'pending'
                    : testFeedback?.success
                      ? 'success'
                      : testFeedback?.failed
                        ? 'error'
                        : 'idle'
                }
                aria-busy={!!busy}
                aria-describedby={busy || testFeedback ? 'model-test-feedback' : undefined}
              >
                <ActionIcon
                  name="connection"
                  retainSuccess
                  state={busy ? 'pending' : testFeedback?.success ? 'success' : 'idle'}
                />
                <ActionLabel
                  labels={[
                    tr('正在保存…'),
                    tr('正在测试…'),
                    tr('保存并测试'),
                    tr('测试连接'),
                    tr('连接成功'),
                    tr('重新测试'),
                  ]}
                  text={
                    busy === 'saving'
                      ? tr('正在保存…')
                      : busy
                        ? tr('正在测试…')
                        : dirty
                          ? tr('保存并测试')
                          : testFeedback?.success
                            ? tr('连接成功')
                            : testFeedback?.failed
                              ? tr('重新测试')
                              : tr('测试连接')
                  }
                />
              </Button>
            </div>
            {(busy || testFeedback) && (
              <p
                id="model-test-feedback"
                className={
                  testFeedback?.failed
                    ? 'settings-feedback settings-error text-right'
                    : 'settings-feedback text-right'
                }
                role={testFeedback?.failed ? 'alert' : 'status'}
              >
                {busy === 'saving'
                  ? tr('正在保存配置，随后测试连接。')
                  : busy
                    ? tr('正在用固定示例请求模型…')
                    : testFeedback?.text}
                {busy && (
                  <span aria-hidden="true">
                    {tr(' 已等待 ')}
                    {elapsed}
                    {tr(' 秒')}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </Card>
      <SettingsDrawer
        id="settings-limits"
        title={tr('高级设置')}
        hidden={simple}
        footer={<DrawerSaveControls editor={editor} />}
      >
        <section hidden={form.provider !== 'api'}>
          <h3>{tr('连接与密钥')}</h3>
          <Field
            id="api-key-env"
            label={tr('密钥环境变量名（可选）')}
            hint={tr('填变量名，不是密钥。后台读到非空值时优先使用；直接填写 API 密钥可留空。')}
          >
            <Input
              id="api-key-env"
              value={form.apiKeyEnv}
              onChange={(e) => change('apiKeyEnv', e.target.value)}
              placeholder="PALBOO_API_KEY"
              spellCheck={false}
            />
          </Field>
          <DeleteModelApiKey editor={editor} busy={!!busy} />
        </section>
        <div className="space-y-5">
          <Field
            id="context-scope"
            label={tr('输入上下文')}
            hint={tr('最近一次提问与回答，不包含更早历史。')}
          >
            <NativeSelect
              id="context-scope"
              controlWidth="medium"
              value={form.maxInputChars === 0 ? 'latest' : 'limited'}
              onChange={(e) => change('maxInputChars', e.target.value === 'latest' ? 0 : 12000)}
            >
              <option value="latest">{tr('最近一次聊天（完整）')}</option>
              <option value="limited">{tr('自定义字符上限')}</option>
            </NativeSelect>
          </Field>
          {form.maxInputChars !== 0 && (
            <Field id="max-input" label={tr('输入字符上限')}>
              <Input
                id="max-input"
                type="number"
                min="500"
                max="32000"
                step="100"
                value={form.maxInputChars}
                onChange={(e) => change('maxInputChars', Number(e.target.value))}
              />
            </Field>
          )}
          {form.provider === 'api' && (
            <Field id="max-output" label={tr('输出 token 上限')}>
              <Input
                id="max-output"
                type="number"
                min="128"
                max="16000"
                step="1"

                value={form.maxOutputTokens}
                onChange={(e) => change('maxOutputTokens', Number(e.target.value))}
              />
            </Field>
          )}
          <Field id="timeout" label={tr('请求超时（秒）')}>
            <Input
              id="timeout"
              type="number"
              min="1"
              max="300"
              value={form.timeoutMs / 1000}
              onChange={(e) => change('timeoutMs', Number(e.target.value) * 1000)}
            />
          </Field>
        </div>
      </SettingsDrawer>
    </>
  );
}
