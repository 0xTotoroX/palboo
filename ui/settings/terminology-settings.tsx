/* [INPUT]: 认证术语 API、可唤起状态、共用卡片/动作图标与用户导入/输入。
 * [OUTPUT]: 卡片预览、识别/外观与词库检索；管理抽屉按新增/导入导出分区，保留草稿、深链接与导入确认。
 * [POS]: 详细设置的功能区，不访问主聊天内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { SettingsDrawer } from './settings-drawer';
import { PreviewFrame } from './preview-frame';
import { Field, Toggle } from './settings-controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useConfirmation } from './settings-confirmation';
import { request } from './api';
import { inheritedAppearance } from '../terminology/appearance.js';
import { NativeSelect } from './components/ui/native-select';
import { Button, IconButton } from './components/ui/button';
import { Input, inputStyles } from './components/ui/input';
import { Switch } from './components/ui/switch';
import { Icon } from '../shared/icons/react';
import { cardStyles, createCard } from '../terminology/card.js';

type Term = {
  id: string;
  name: string;
  english: string;
  definition: string;
  aliases: string[];
  category: string[];
  example: string;
  source: string;
};
type Library = {
  entries: Term[];
  preferences: {
    enabled: boolean;
    semantic: boolean;
    autoExpand: boolean;
    jumpOnClick?: boolean;
    cardStyle: string;
    cardMaterial?: string | null;
    cardLiquidVariant?: string;
    cardCustomColor?: string;
    cardWidth?: number;
    mastered: string[];
    favorites: string[];
    revision: number;
  };
};
const sample: Term = {
  id: 'sample',
  name: '竞态条件',
  english: 'Race Condition',
  definition: '多个操作的执行先后不可预测，最终结果随完成顺序变化。',
  aliases: [],
  category: ['程序基础与执行机制', '管理运行与并发'],
  example: '',
  source: '',
};
function Preview({ term, preferences }: { term: Term; preferences: Library['preferences'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current!;
    const card = createCard(term, {
      preferences,
      appearance: inheritedAppearance(node),
      locked: true,
    });
    node.replaceChildren(card);
    return () => {
      card.dispose();
      node.replaceChildren();
    };
  }, [term, preferences]);
  return <div ref={ref} className="term-preview" />;
}

function download(text: string, name: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TerminologySettings({ active }: { active: boolean }) {
  const [data, setData] = useState<Library | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''),
    [masteredOnly, setMasteredOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [name, setName] = useState(''),
    [english, setEnglish] = useState(''),
    [definition, setDefinition] = useState(''),
    [category, setCategory] = useState('');
  const [management, setManagement] = useState('add');
  const managementRoot = useRef<HTMLDivElement>(null);
  const [resultLimit, setResultLimit] = useState(80);
  useEffect(() => setResultLimit(80), [query, masteredOnly, favoritesOnly]);
  useLayoutEffect(() => {
    const root = managementRoot.current;
    const reveal = (event: Event) => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-term-management]');
      if (panel) flushSync(() => setManagement(panel.dataset.termManagement!));
    };
    root?.addEventListener('buddy-settings-detail-reveal', reveal);
    return () => root?.removeEventListener('buddy-settings-detail-reveal', reveal);
  }, [!!data]);
  const [preview, setPreview] = useState<Term>(sample);
  const load = () =>
    request<Library>('terminology')
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (active) void load();
  }, [active]);
  async function command(payload: object) {
    setBusy(true);
    setError('');
    try {
      const state = await request<Library>('terminology', payload);
      setData(state);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(manual = false, json = false) {
    setError('');
    try {
      const value = await request<{ filename: string; markdown: string; entries: Term[] }>(
        'terminology',
        { action: 'export', manual },
      );
      download(
        json ? JSON.stringify(value.entries, null, 2) : value.markdown,
        json ? value.filename.replace('.md', '.json') : value.filename,
        json ? 'application/json' : 'text/markdown;charset=utf-8',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const prefs = data?.preferences;
  const { confirm, confirmation } = useConfirmation(prefs?.revision, busy);
  const results = (data?.entries || []).filter(
    (t) =>
      (!masteredOnly || prefs?.mastered.includes(t.id)) &&
      (!favoritesOnly || prefs?.favorites?.includes(t.id)) &&
      [t.name, t.english, ...t.aliases, ...t.category].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  return (
    <section className="settings-section" id="settings-terminology" aria-label="术语释义设置">
      {confirmation}
      <style>{cardStyles}</style>
      {error && (
        <p role="alert" className="settings-feedback settings-error">
          {error}
        </p>
      )}
      {!prefs ? (
        <p>正在读取术语库…</p>
      ) : (
        <>
          <div className="settings-local-preview" aria-label="联动预览">
            <PreviewFrame title="术语卡片预览">
              <Preview term={preview} preferences={prefs} />
            </PreviewFrame>
          </div>
          <div className="term-behavior" role="group" aria-label="识别与操作">
            <Toggle
              label="在聊天中标注术语"
              checked={prefs.enabled}
              disabled={busy}
              onChange={(enabled) =>
                void command({ action: 'settings', revision: prefs.revision, enabled })
              }
            />
            <Toggle
              label="结合问答核对词义与识别概念"
              checked={prefs.semantic}
              disabled={busy}
              onChange={(semantic) =>
                void command({ action: 'settings', revision: prefs.revision, semantic })
              }
            />
            <Toggle
              label="联网核对并补充缺失术语"
              checked={prefs.autoExpand}
              disabled={busy}
              onChange={(autoExpand) =>
                void command({ action: 'settings', revision: prefs.revision, autoExpand })
              }
            />
            <p className="settings-hint">语义识别使用已配置模型处理当前问答；联网仅查询术语名。</p>
            <div className="settings-row">
              <label htmlFor="terms-jump-on-click">点击术语时跳转到上下文</label>
              <Switch
                id="terms-jump-on-click"
                checked={prefs.jumpOnClick ?? false}
                disabled={busy}
                onCheckedChange={(jumpOnClick) =>
                  void command({ action: 'settings', revision: prefs.revision, jumpOnClick })
                }
              />
            </div>
          </div>
          <section className="term-section" aria-labelledby="term-appearance-title">
            <h2 id="term-appearance-title">卡片外观</h2>
            <Field id="term-material" label="背景材质">
              <NativeSelect
                id="term-material"
                aria-label="术语卡片背景"
                disabled={busy}
                value={prefs.cardMaterial || (prefs.cardStyle === 'frost' ? 'frosted' : 'matte')}
                onChange={(e) =>
                  void command({
                    action: 'settings',
                    revision: prefs.revision,
                    cardMaterial: e.target.value,
                  })
                }
              >
                <option value="matte">哑光</option>
                <option value="frosted">磨砂</option>
                <option value="native-glass">液态</option>
                <option value="black">纯黑</option>
                <option value="custom">自定义</option>
              </NativeSelect>
            </Field>
            {prefs.cardMaterial === 'native-glass' && (
              <Field id="term-liquid-variant" label="液态变体">
                <NativeSelect
                  id="term-liquid-variant"
                  aria-label="术语卡片液态变体"
                  disabled={busy}
                  value={prefs.cardLiquidVariant || 'regular'}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      cardLiquidVariant: e.target.value,
                    })
                  }
                >
                  <option value="regular">Regular</option>
                  <option value="clear">Clear</option>
                </NativeSelect>
              </Field>
            )}
            {prefs.cardMaterial === 'custom' && (
              <Field id="term-custom-color" label="背景颜色">
                <Input
                  id="term-custom-color"
                  type="color"
                  aria-label="术语卡片自定义颜色"
                  disabled={busy}
                  value={prefs.cardCustomColor || '#33333a'}
                  onChange={(e) =>
                    void command({
                      action: 'settings',
                      revision: prefs.revision,
                      cardCustomColor: e.target.value,
                    })
                  }
                />
              </Field>
            )}
          </section>
          <section className="term-section" aria-labelledby="term-library-title">
            <div className="term-library-heading">
              <h2 id="term-library-title">术语库</h2>
              <span className="term-library-count">
                {data.entries.length} 条 · 已掌握 {prefs.mastered.length} 条
              </span>
            </div>
            <div className="term-library-tools">
              <Input
                type="search"
                aria-label="搜索术语"
                placeholder="搜索名称、别名或分类"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <SettingsDrawer
                id="settings-library"
                title="词库管理"
                footer={
                  error ? (
                    <p role="alert" className="settings-error text-sm">
                      {error}
                    </p>
                  ) : undefined
                }
              >
                <div ref={managementRoot}>
                  <nav
                    className="settings-section-tabs"
                    aria-label="词库管理操作"
                    data-settings-navigation
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={management === 'add'}
                      onClick={() => setManagement('add')}
                    >
                      新增词条
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={management === 'transfer'}
                      onClick={() => setManagement('transfer')}
                    >
                      导入与导出
                    </Button>
                  </nav>
                  <div
                    className="term-entry"
                    data-term-management="add"
                    hidden={management !== 'add'}
                  >
                    <Field id="term-name" label="中文术语名">
                      <Input
                        id="term-name"
                        aria-label="中文术语名"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field id="term-english" label="英文名称">
                      <Input
                        id="term-english"
                        aria-label="英文名称"
                        placeholder="可选"
                        value={english}
                        onChange={(e) => setEnglish(e.target.value)}
                      />
                    </Field>
                    <Field id="term-definition" label="中文释义">
                      <textarea
                        className={inputStyles + ' min-h-28 py-2 resize-y'}
                        id="term-definition"
                        aria-label="中文释义"
                        rows={3}
                        value={definition}
                        onChange={(e) => setDefinition(e.target.value)}
                      />
                    </Field>
                    <Field id="term-category" label="词条分类">
                      <NativeSelect
                        id="term-category"
                        aria-label="词条分类"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">
                          {prefs?.enabled ? '自动分类（使用模型）' : '请选择分类'}
                        </option>
                        {Array.from(
                          new Set(
                            (data?.entries || [])
                              .map((t) => JSON.stringify(t.category))
                              .filter((value) => value !== '[]'),
                          ),
                        )
                          .sort()
                          .map((value) => (
                            <option key={value} value={value}>
                              {JSON.parse(value).join(' / ')}
                            </option>
                          ))}
                      </NativeSelect>
                    </Field>
                    <div className="settings-actions">
                      <Button
                        variant="outline"
                        type="button"
                        disabled={
                          busy ||
                          (!prefs?.enabled && !category) ||
                          !name.trim() ||
                          !definition.trim()
                        }
                        onClick={async () => {
                          if (
                            await command({
                              action: 'manual',
                              entries: [
                                {
                                  id: 'manual',
                                  name,
                                  english,
                                  definition,
                                  aliases: [],
                                  category: category ? JSON.parse(category) : [],
                                  example: '',
                                  source: '',
                                },
                              ],
                            })
                          ) {
                            setName('');
                            setEnglish('');
                            setDefinition('');
                          }
                        }}
                      >
                        {category ? '添加词条' : '自动分类并添加'}
                      </Button>
                    </div>
                  </div>

                  <div
                    className="term-actions"
                    data-term-management="transfer"
                    hidden={management !== 'transfer'}
                  >
                    <Button variant="outline" type="button" onClick={() => void exportFile()}>
                      导出术语文档
                    </Button>
                    <Button variant="outline" type="button" onClick={() => void exportFile(true)}>
                      导出手动词条
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => void exportFile(false, true)}
                    >
                      导出可导入备份
                    </Button>
                    <label className="grid w-full gap-2 text-sm">
                      导入词库{' '}
                      <input
                        type="file"
                        className={
                          inputStyles +
                          ' h-auto py-2 file:mr-3 file:border-0 file:bg-transparent file:text-foreground'
                        }
                        accept=".json,application/json"
                        disabled={busy}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const input = e.target;
                          input.value = '';
                          setError('');
                          try {
                            if (file.size > 8_000_000) throw Error('文件过大');
                            const entries = JSON.parse(await file.text());
                            if (!Array.isArray(entries) || !entries.length)
                              throw Error('请选择包含词条的 JSON 数组');
                            confirm({
                              title: `导入 ${entries.length} 条术语？`,
                              description: `将从“${file.name}”合并词条，相同编号的已有释义会被替换；其他词条与掌握记录保留。建议先导出备份。`,
                              confirmLabel: '确认导入',
                              action: async () => {
                                setBusy(true);
                                let imported = 0;
                                try {
                                  for (let i = 0; i < entries.length; i += 20) {
                                    await request('terminology', {
                                      action: 'import',
                                      entries: entries.slice(i, i + 20),
                                    });
                                    imported += Math.min(20, entries.length - i);
                                  }
                                } catch (error) {
                                  throw Error(
                                    `已导入 ${imported} 条，其余未完成：${(error as Error).message}`,
                                  );
                                } finally {
                                  await load();
                                  setBusy(false);
                                }
                              },
                            });
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </SettingsDrawer>
            </div>
            <div className="term-filters" role="group" aria-label="词库筛选">
              <label>
                <input
                  type="checkbox"
                  checked={masteredOnly}
                  onChange={(e) => setMasteredOnly(e.target.checked)}
                />
                只看已掌握
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={favoritesOnly}
                  onChange={(e) => setFavoritesOnly(e.target.checked)}
                />
                只看收藏
              </label>
            </div>
            <div className="term-results">
              {results.slice(0, resultLimit).map((t) => (
                <div className="term-row" key={t.id}>
                  <button
                    type="button"
                    className="term-result-name"
                    aria-pressed={preview.id === t.id}
                    onClick={() => setPreview(t)}
                  >
                    <span>{t.name}</span>
                    {t.english && t.english !== t.name && (
                      <span className="term-result-english">{t.english}</span>
                    )}
                  </button>
                  <IconButton
                    aria-label={`${prefs.mastered.includes(t.id) ? '恢复提示' : '已掌握'}：${t.name}`}
                    disabled={busy}
                    onClick={() =>
                      void command({
                        action: prefs.mastered.includes(t.id) ? 'restore' : 'master',
                        id: t.id,
                      })
                    }
                  >
                    <Icon name={prefs.mastered.includes(t.id) ? 'return' : 'check'} />
                  </IconButton>
                </div>
              ))}
              {!results.length && <p className="settings-hint">没有匹配的术语</p>}
            </div>
            {results.length > resultLimit && (
              <div className="settings-actions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setResultLimit((count) => count + 80)}
                >
                  显示更多
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
