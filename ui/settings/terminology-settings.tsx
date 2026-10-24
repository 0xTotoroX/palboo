/* [INPUT]: 认证术语 API、可唤起状态、共用卡片/动作图标与用户导入/输入。
 * [OUTPUT]: 独立外观预览、词条原位展开与词库检索；管理抽屉按新增/导入导出分区，保留草稿与深链接，名称/文件排队交给下次主聊天，个人导出与确认重置。
 * [POS]: 详细设置的功能区，不访问主聊天内容。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { SettingsDrawer } from './settings-drawer';
import { PreviewFrame } from './preview-frame';
import { Field, Toggle } from './settings-controls';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useConfirmation } from './settings-confirmation';
import { request, uploadTerminology } from './api';
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
type ImportJob = {
  id: string;
  name: string;
  kind: 'name' | 'file';
  status: string;
  error: string;
  count: number;
};
const jobStatus = (job: ImportJob) =>
  job.status === 'done'
    ? `已添加 ${job.count} 条`
    : job.status === 'error'
      ? '未完成'
      : job.status === 'prepared'
        ? '等待聊天处理'
        : '待下次聊天处理';
type Library = {
  entries: Term[];
  imports?: { revision: number; jobs: ImportJob[] };
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
  const [name, setName] = useState('');
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
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const resultsRoot = useRef<HTMLDivElement>(null);
  const detailId = useId();
  useLayoutEffect(() => {
    if (!active || !expandedTerm) return;
    const list = resultsRoot.current;
    const row = list?.querySelector<HTMLElement>('.term-result:has([aria-expanded="true"])');
    if (!list || !row) return;
    // 只调整词库自身的阅读位置，让展开的开头可见，不把整页拉回顶部。
    const bounds = list.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const visibleHeight = Math.min(rect.height, list.clientHeight);
    if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
    else if (rect.top + visibleHeight > bounds.bottom)
      list.scrollTop += rect.top + visibleHeight - bounds.bottom;
  }, [active, expandedTerm]);
  const load = () =>
    request<Library>('terminology')
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (active) void load();
  }, [active]);
  const hasPending = data?.imports?.jobs.some((job) => job.status === 'prepared');
  useEffect(() => {
    if (!active || !hasPending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, hasPending, busy]);
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
  async function exportFile() {
    setError('');
    try {
      const value = await request<{ filename: string; markdown: string; entries: Term[] }>(
        'terminology',
        { action: 'export' },
      );
      download(value.markdown, value.filename);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const prefs = data?.preferences;
  const { confirm, confirmation } = useConfirmation(
    `${prefs?.revision}:${data?.imports?.revision}`,
    busy,
  );
  const pendingJobs = (data?.imports?.jobs ?? []).filter(
    (job) => job.status !== 'done' && job.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
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
              <Preview term={sample} preferences={prefs} />
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
                    <Field id="term-name" label="术语名称">
                      <textarea
                        id="term-name"
                        aria-label="术语名称"
                        className={inputStyles + ' min-h-24 resize-y py-2'}
                        placeholder="每行一个名称"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <div className="settings-actions">
                      <Button
                        type="button"
                        disabled={busy || !name.trim()}
                        onClick={async () => {
                          if (
                            await command({
                              action: 'add-names',
                              names: name
                                .split(/\r?\n/)
                                .map((v) => v.trim())
                                .filter(Boolean),
                            })
                          )
                            setName('');
                        }}
                      >
                        添加
                      </Button>
                    </div>
                    <p className="settings-hint">
                      名称立即加入；下次主聊天运行时，由当前 Agent 联网补全。
                    </p>
                  </div>

                  <div
                    className="term-actions"
                    data-term-management="transfer"
                    hidden={management !== 'transfer'}
                  >
                    <label className="grid w-full gap-2 text-sm">
                      导入文件
                      <input
                        type="file"
                        aria-label="导入术语文件"
                        className={
                          inputStyles +
                          ' h-auto py-2 file:mr-3 file:border-0 file:bg-transparent file:text-foreground'
                        }
                        disabled={busy}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          setError('');
                          setBusy(true);
                          try {
                            if (!file.size || file.size > 8_000_000)
                              throw Error('文件需为 1 字节至 8 MB');
                            setData(await uploadTerminology<Library>(file));
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    </label>
                    <p className="settings-hint">
                      不限格式，最多 8 MB；下次主聊天由当前 Agent 解析，支持范围取决于其文件能力。
                    </p>
                    <div className="settings-actions">
                      <Button
                        variant="outline"
                        type="button"
                        disabled={busy}
                        onClick={() => void exportFile()}
                      >
                        导出我的术语
                      </Button>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          confirm({
                            title: '重置词库？',
                            description:
                              '删除个人添加、导入内容、导入文件及待处理任务，保留基础词库和其中的收藏、掌握记录。',
                            confirmLabel: '重置词库',
                            action: () =>
                              command({
                                action: 'reset-library',
                                revision: data.imports?.revision ?? 0,
                              }),
                          })
                        }
                      >
                        重置词库
                      </Button>
                    </div>
                  </div>
                  {!!data.imports?.jobs.length && (
                    <section className="term-import-jobs" aria-label="术语处理记录">
                      {data.imports.jobs.map((job) => (
                        <div className="term-import-job" key={job.id}>
                          <div>
                            <strong>{job.name}</strong>
                            <span>{jobStatus(job)}</span>
                            {job.error && <p role="alert">{job.error}</p>}
                          </div>
                          <div className="settings-actions">
                            {['prepared', 'error'].includes(job.status) && (
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void command({ action: 'retry-import', id: job.id })}
                              >
                                重试
                              </Button>
                            )}
                            <IconButton
                              aria-label={`移除记录：${job.name}`}
                              disabled={busy}
                              onClick={() => void command({ action: 'remove-import', id: job.id })}
                            >
                              <Icon name="close" />
                            </IconButton>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
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
            <div className="term-results" ref={resultsRoot}>
              {!favoritesOnly &&
                !masteredOnly &&
                pendingJobs.map((job) => (
                  <div className="term-row" key={job.id}>
                    <span className="term-result-name">{job.name}</span>
                    <span className="term-import-status">{jobStatus(job)}</span>
                  </div>
                ))}
              {results.slice(0, resultLimit).map((t) => (
                <div
                  className="term-result"
                  key={t.id}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || expandedTerm !== t.id) return;
                    event.preventDefault();
                    setExpandedTerm(null);
                    event.currentTarget
                      .querySelector<HTMLButtonElement>('.term-result-name')
                      ?.focus({ preventScroll: true });
                  }}
                >
                  <div className="term-row">
                    <button
                      type="button"
                      className="term-result-name"
                      aria-expanded={expandedTerm === t.id}
                      aria-controls={`${detailId}-${t.id}`}
                      onClick={() => setExpandedTerm((current) => (current === t.id ? null : t.id))}
                    >
                      <span>{t.name}</span>
                      {t.english && t.english !== t.name && (
                        <span className="term-result-english">{t.english}</span>
                      )}
                      <Icon name="chevron-down" />
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
                  <div
                    id={`${detailId}-${t.id}`}
                    className="term-result-detail"
                    role="region"
                    aria-label={`${t.name}释义`}
                    hidden={expandedTerm !== t.id}
                  >
                    <p>{t.definition}</p>
                    {t.category.length > 0 && (
                      <p className="term-result-category">{t.category.join(' › ')}</p>
                    )}
                  </div>
                </div>
              ))}
              {!results.length && (favoritesOnly || masteredOnly || !pendingJobs.length) && (
                <p className="settings-hint">没有匹配的术语</p>
              )}
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
