/* [INPUT]: Reader-only API, safe Markdown with authenticated image rendering, note tree and browser navigation.
 * [OUTPUT]: Resizable navigation, unified instant/full-text search, breadcrumbs, active outline and safe note editing.
 * [POS]: Standalone document opened in ChatGPT; no settings token, composer access or AI calls.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { read, write, folderId, type Catalog, type Note, type Summary, type Search } from './api';
import { NoteEditor, useNoteEditor } from './editor';
import { Spreadsheet } from './spreadsheet';
import { NoteMarkdown, anchorKey, decodeLink } from './markdown';
import { ReaderPicture } from './picture';
import { Breadcrumbs, SidebarResize, useSidebarWidth } from './navigation';
import { ReadingOutline, type Heading } from './outline';
import { SearchText } from './search';
import { NoteTree, useTreeExpansion } from './tree';
import { Icon } from '../shared/icons/react';
import { tr, setLocale } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import { useHostAppearance } from '../settings/use-host-appearance';
import '../shared/tokens.css';
import './style.css';

setLocale('system');
const positionKey = `palboo-reader-positions:${folderId || 'obsidian'}`;
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  ? '⌘O'
  : 'Ctrl O';
function savedPositions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(positionKey) || '{}');
  } catch {
    return {};
  }
}
function Reader() {
  useLocale();
  const sidebar = useSidebarWidth('palboo-reader-sidebar-width');
  const [destination, setDestination] = useState({ id: '', query: '', backlink: '', revision: 0 });
  const handledDestination = useRef(-1);
  const [activeHeading, setActiveHeading] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLUListElement>(null);
  const pendingSearchFocus = useRef(false);
  const [activeResult, setActiveResult] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const theme = catalog?.appearance?.theme || (systemDark ? 'dark' : 'light');
  useHostAppearance(catalog?.appearance, theme);
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    setLocale(catalog?.language || 'system', catalog?.systemLanguage);
  }, [theme, catalog?.language, catalog?.systemLanguage]);
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('note') || '');
  const tree = useTreeExpansion(selected);
  const [note, setNote] = useState<Note | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(() => {
    try {
      const saved = sessionStorage.getItem('palboo-reader-sidebar');
      if (saved !== null) return saved === 'true';
    } catch {}
    return !matchMedia('(max-width: 640px)').matches;
  });
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        ['o', 'k'].includes(event.key.toLowerCase()) &&
        !event.isComposing
      ) {
        event.preventDefault();
        if (menu) {
          searchInput.current?.focus();
          searchInput.current?.select();
        } else {
          pendingSearchFocus.current = true;
          setMenu(true);
        }
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [menu]);
  useLayoutEffect(() => {
    if (menu && pendingSearchFocus.current) {
      pendingSearchFocus.current = false;
      searchInput.current?.focus();
      searchInput.current?.select();
    }
  }, [menu]);
  const editor = useNoteEditor(setNote);
  const navigation = useRef(false);
  const selectedDocument = catalog?.notes.find((item) => item.id === selected);
  useEffect(() => {
    try {
      sessionStorage.setItem('palboo-reader-sidebar', String(menu));
    } catch {}
  }, [menu]);
  const [toc, setToc] = useState<Heading[]>([]);
  const [choices, setChoices] = useState<{ notes: Summary[]; anchor: string } | null>(null);
  const article = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLDialogElement>(null);
  const positions = useRef(savedPositions());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const pendingAnchor = useRef(decodeLink(location.hash.slice(1)));
  const readingReady = useRef(false);
  const catalogRequest = useRef<AbortController | null>(null);
  const linkRequest = useRef<AbortController | null>(null);
  const quickMatches = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed || !catalog) return [];
    const terms = trimmed.split(/\s+/).filter(Boolean);
    return catalog.notes
      .filter((item) =>
        terms.every((term) => `${item.title} ${item.id}`.toLocaleLowerCase().includes(term)),
      )
      .sort(
        (a, b) =>
          Number(b.title.toLocaleLowerCase().startsWith(trimmed)) -
          Number(a.title.toLocaleLowerCase().startsWith(trimmed)),
      )
      .slice(0, 50)
      .map((item) => ({ ...item, snippet: '' }));
  }, [catalog, query]);
  const displayedResults = search ? search.results : offset === 0 ? quickMatches : [];
  useLayoutEffect(() => {
    resultsList.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeResult]);
  const remember = useCallback(() => {
    if (readingReady.current && note && article.current && note.id === selectedRef.current) {
      positions.current[note.id] = article.current.scrollTop;
      try {
        sessionStorage.setItem(
          positionKey,
          JSON.stringify(Object.fromEntries(Object.entries(positions.current).slice(-100))),
        );
      } catch {
        /* Session persistence is optional. */
      }
    }
  }, [note]);
  const refresh = useCallback(async (rescan = true) => {
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await read<Catalog>('catalog', { refresh: rescan }, controller.signal);
      if (!controller.signal.aborted) setCatalog(result);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('focus', focus);
      catalogRequest.current?.abort();
      linkRequest.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    const change = async () => {
      if (!(await editor.finish())) {
        history.pushState(
          null,
          '',
          `?${folderId ? `folder=${encodeURIComponent(folderId)}&` : ''}note=${encodeURIComponent(selectedRef.current)}`,
        );
        return;
      }
      remember();
      setDestination((value) => ({
        id: '',
        query: '',
        backlink: '',
        revision: value.revision + 1,
      }));
      pendingAnchor.current = decodeLink(location.hash.slice(1));
      const id = new URLSearchParams(location.search).get('note') || '';
      if (id === selectedRef.current && pendingAnchor.current) {
        scrollAnchor(pendingAnchor.current);
        pendingAnchor.current = '';
      }
      setSelected(id);
      setChoices(null);
    };
    window.addEventListener('popstate', change);
    window.addEventListener('pagehide', remember);
    return () => {
      window.removeEventListener('popstate', change);
      window.removeEventListener('pagehide', remember);
    };
  }, [remember]);
  useEffect(() => {
    if (editor.activeRef.current) return;
    if (!selected || !catalog || selectedDocument?.kind === 'spreadsheet') {
      setNote(null);
      return;
    }
    const controller = new AbortController();
    readingReady.current = false;
    setError('');
    setNote((current) => (current?.id === selected ? current : null));
    void read<Note>('note', { id: selected }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setNote(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [selected, catalog?.revision]);
  useEffect(() => {
    if (!query.trim() || !catalog) {
      setSearch(null);
      setSearchError('');
      return;
    }
    const controller = new AbortController();
    setSearch(null);
    setSearchError('');
    const timer = setTimeout(() => {
      void read<Search>('search', { q: query, offset }, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setSearch(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setSearchError(e.message);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, offset, catalog?.revision]);
  function scrollAnchor(anchor: string) {
    const key = anchorKey(anchor);
    const target = [
      ...(content.current?.querySelectorAll<HTMLElement>('[data-note-anchor]') || []),
    ].find(
      (node) =>
        node.dataset.noteAnchor === key ||
        node.id === anchor ||
        node.dataset.noteAnchor?.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') === key,
    );
    if (target) {
      revealTarget(target, 'start');
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } else if (anchor) setError(tr('未找到这个标题或段落'));
  }
  function revealTarget(target: HTMLElement, block: ScrollLogicalPosition = 'center') {
    let parent = target.parentElement;
    while (parent && parent !== content.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    target.scrollIntoView({ block });
  }
  function updateHeading() {
    if (!article.current || !content.current) return;
    const top = article.current.getBoundingClientRect().top + 64;
    const headings = [...content.current.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')].filter(
      (node) => node.getClientRects().length,
    );
    const atEnd =
      article.current.scrollTop + article.current.clientHeight >= article.current.scrollHeight - 2;
    const current = atEnd
      ? headings.at(-1)
      : headings.filter((node) => node.getBoundingClientRect().top <= top).at(-1) || headings[0];
    setActiveHeading(current?.id || '');
  }
  useLayoutEffect(() => {
    if (!note || !content.current || !article.current) return;
    setToc(
      [...content.current.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((node) => ({
        id: node.id,
        text: node.textContent || '',
        level: Number(node.tagName.slice(1)),
      })),
    );
    const anchor = pendingAnchor.current;
    pendingAnchor.current = '';
    if (anchor) scrollAnchor(anchor);
    else article.current.scrollTop = positions.current[note.id] || 0;
    updateHeading();
    readingReady.current = true;
    document.title = `${note.title} · Palboo`;
  }, [note, editor.active]);
  useLayoutEffect(() => {
    if (
      note?.id !== destination.id ||
      editor.active ||
      handledDestination.current === destination.revision
    )
      return;
    handledDestination.current = destination.revision;
    const target =
      content.current?.querySelector<HTMLElement>('[data-search-hit], [data-backlink-hit]') ||
      article.current?.querySelector<HTMLElement>('.reader-breadcrumbs [data-search-hit]');
    if (target) revealTarget(target);
    updateHeading();
  }, [note, destination, editor.active]);
  useEffect(() => {
    if (choices) chooser.current?.showModal();
    else chooser.current?.close();
  }, [choices]);
  async function open(id: string, anchor = '', searchQuery = '', backlink = '') {
    if (navigation.current) return;
    navigation.current = true;
    const saved = await editor.finish();
    navigation.current = false;
    if (!saved) return;
    remember();
    setDestination((value) => ({ id, query: searchQuery, backlink, revision: value.revision + 1 }));
    linkRequest.current?.abort();
    setChoices(null);
    if (matchMedia('(max-width: 640px)').matches) setMenu(false);
    setError('');
    history.pushState(
      null,
      '',
      `?${folderId ? `folder=${encodeURIComponent(folderId)}&` : ''}note=${encodeURIComponent(id)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`,
    );
    if (selected === id) {
      if (anchor) scrollAnchor(anchor);
      return;
    }
    pendingAnchor.current = anchor;
    setSelected(id);
  }
  async function switchFolder(id: string) {
    if (navigation.current || id === catalog?.folder) return;
    navigation.current = true;
    try {
      if (!(await editor.finish())) return;
      remember();
      const result = await write<{ url: string }>('folder-open', { id });
      location.assign(result.url);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      navigation.current = false;
    }
  }
  async function follow(target: string) {
    if (!note) return;
    linkRequest.current?.abort();
    const controller = new AbortController();
    linkRequest.current = controller;
    try {
      const result = await read<{ candidates: Summary[]; anchor: string }>(
        'resolve',
        { id: note.id, target },
        controller.signal,
      );
      if (controller.signal.aborted || selectedRef.current !== note.id) return;
      if (result.candidates.length === 1) open(result.candidates[0].id, result.anchor);
      else if (result.candidates.length)
        setChoices({ notes: result.candidates, anchor: result.anchor });
      else setError(tr('链接指向的笔记不存在'));
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    }
  }
  const selectFolderFromBreadcrumb = (folderPath: string) => {
    setQuery('');
    setOffset(0);
    setMenu(true);
    tree.revealFolder(folderPath);
  };
  return (
    <div className="reader-app" data-menu={menu} style={sidebar.style}>
      <aside className="reader-sidebar" aria-label={tr('目录与搜索')}>
        <div className="reader-library-row">
          {menu &&
            ((catalog?.folders?.length || 0) > 1 ? (
              <div className="reader-folder-select">
                <select
                  aria-label={tr('切换笔记文件夹')}
                  value={catalog?.folder || ''}
                  onChange={(e) => void switchFolder(e.target.value)}
                >
                  {catalog?.folders?.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" />
              </div>
            ) : (
              <strong title={catalog?.name}>{catalog?.name || 'Obsidian'}</strong>
            ))}
          <div className="reader-library-tools">
            {menu && !query.trim() && (
              <>
                <button
                  type="button"
                  className="reader-tool-btn"
                  title={tr('定位当前笔记')}
                  aria-label={tr('定位当前笔记')}
                  disabled={!selected || !catalog?.notes.some((item) => item.id === selected)}
                  onClick={() => tree.revealCurrent()}
                >
                  <Icon name="reader-locate" />
                </button>
                <button
                  type="button"
                  className="reader-tool-btn"
                  title={tr('全部折叠')}
                  aria-label={tr('全部折叠')}
                  onClick={() => tree.collapseAll()}
                >
                  <Icon name="reader-collapse" />
                </button>
              </>
            )}
            <button
              type="button"
              className="reader-nav-toggle"
              title={tr(menu ? '收起侧栏' : '展开侧栏')}
              aria-label={tr('目录与搜索')}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Icon name="reader-sidebar" />
            </button>
          </div>
        </div>
        {menu && (
          <SidebarResize
            width={sidebar.width}
            defaultWidth={sidebar.defaultWidth}
            setWidth={sidebar.setWidth}
          />
        )}
        <div className="reader-sidebar-body" hidden={!menu}>
          <label className="reader-search">
            <Icon name="search" />
            <input
              ref={searchInput}
              type="search"
              aria-label={tr('搜索笔记')}
              placeholder={tr('搜索笔记')}
              title={tr('搜索标题、路径和正文')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
                setActiveResult(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (!displayedResults.length) return;
                  event.preventDefault();
                  setActiveResult((value) =>
                    Math.max(
                      0,
                      Math.min(
                        displayedResults.length - 1,
                        value + (event.key === 'ArrowDown' ? 1 : -1),
                      ),
                    ),
                  );
                } else if (event.key === 'Enter' && query.trim() && displayedResults.length) {
                  event.preventDefault();
                  const picked =
                    displayedResults[Math.min(activeResult, displayedResults.length - 1)];
                  void open(picked.id, '', query);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  if (query) {
                    setQuery('');
                    setOffset(0);
                    setActiveResult(0);
                  } else {
                    event.currentTarget.blur();
                    if (matchMedia('(max-width: 640px)').matches && selected) setMenu(false);
                  }
                }
              }}
            />
            {query ? (
              <button
                type="button"
                className="reader-search-clear"
                aria-label={tr('清除搜索')}
                title={tr('清除搜索')}
                onClick={() => {
                  setQuery('');
                  setOffset(0);
                  setActiveResult(0);
                  searchInput.current?.focus();
                }}
              >
                <Icon name="close" />
              </button>
            ) : (
              <kbd className="reader-search-kbd" aria-hidden="true">
                {shortcutLabel}
              </kbd>
            )}
          </label>
          <nav aria-label={tr('笔记目录')}>
            {query.trim() ? (
              <>
                {searchError && <p role="alert">{searchError}</p>}
                {!search && !searchError && !displayedResults.length && (
                  <p className="reader-status" role="status">
                    {tr('正在搜索…')}
                  </p>
                )}
                {search && search.total === 0 && (
                  <p className="reader-status" role="status">
                    {tr('没有匹配的笔记')}
                  </p>
                )}
                {displayedResults.length > 0 && (
                  <>
                    {search && (
                      <p className="reader-count">
                        {tr('{{count}} 个结果', { count: search.total })}
                      </p>
                    )}
                    <ul ref={resultsList} className="reader-results">
                      {displayedResults.map((item, index) => (
                        <li key={item.id}>
                          <button
                            data-active={
                              index === Math.min(activeResult, displayedResults.length - 1) ||
                              undefined
                            }
                            onMouseEnter={() => setActiveResult(index)}
                            onClick={() => void open(item.id, '', query)}
                            aria-current={item.id === selected ? 'page' : undefined}
                          >
                            <div className="reader-result-head">
                              <Icon
                                name={item.kind === 'spreadsheet' ? 'reader-sheet' : 'reader-note'}
                              />
                              <strong>
                                <SearchText text={item.title} query={query} />
                              </strong>
                            </div>
                            <small>
                              <SearchText text={item.id} query={query} />
                            </small>
                            {item.snippet && (
                              <span>
                                <SearchText text={item.snippet} query={query} />
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {search && search.total > 50 && (
                      <div className="reader-pagination">
                        <button
                          disabled={offset === 0}
                          onClick={() => {
                            setOffset(Math.max(0, offset - 50));
                            setActiveResult(0);
                          }}
                        >
                          {tr('上一页')}
                        </button>
                        <button
                          disabled={offset + 50 >= search.total}
                          onClick={() => {
                            setOffset(offset + 50);
                            setActiveResult(0);
                          }}
                        >
                          {tr('下一页')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              catalog && (
                <NoteTree notes={catalog.notes} selected={selected} open={open} expansion={tree} />
              )
            )}
          </nav>
        </div>
        {menu && (
          <div className="reader-sidebar-actions">
            <button
              title={tr('笔记文件夹设置')}
              aria-label={tr('笔记文件夹设置')}
              onClick={async () => {
                if (!(await editor.finish())) return;
                try {
                  await write('settings-open', {});
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <Icon name="settings" />
            </button>
            <button
              title={tr('刷新')}
              aria-label={tr('刷新')}
              disabled={busy}
              onClick={async () => {
                if (editor.activeRef.current && !(await editor.flush())) return;
                remember();
                void refresh();
              }}
            >
              <Icon name="refresh" />
            </button>
          </div>
        )}
      </aside>
      <main
        ref={article}
        className="reader-main"
        onScroll={() => {
          if (readingReady.current && note && article.current)
            positions.current[note.id] = article.current.scrollTop;
          updateHeading();
        }}
      >
        {error && (
          <div role="alert" className="reader-error">
            {error}
            <button onClick={() => void refresh()}>{tr('重试')}</button>
            <button aria-label={tr('关闭')} onClick={() => setError('')}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {catalog && catalog.skipped > 0 && (
          <p className="reader-skipped" role="status">
            {tr('{{count}} 篇笔记未索引（无法读取或超过 8 MB）', { count: catalog.skipped })}
          </p>
        )}
        {!note && selectedDocument?.kind !== 'spreadsheet' && (
          <p className="reader-empty" role="status">
            {busy
              ? tr('正在读取笔记目录…')
              : selected && !error
                ? tr('正在读取笔记…')
                : tr('选择一篇笔记开始阅读')}
          </p>
        )}
        {selectedDocument?.kind === 'spreadsheet' && (
          <div className="reader-sheet-shell">
            <div className="reader-topbar">
              <Breadcrumbs
                id={selected}
                title={selectedDocument.title}
                onSelectFolder={selectFolderFromBreadcrumb}
              />
            </div>
            <Spreadsheet key={selected} id={selected} revision={catalog?.revision || 0} />
          </div>
        )}
        {note && (
          <article>
            {editor.active ? (
              <>
                <div className="reader-topbar">
                  <Breadcrumbs id={note.id} title={note.title} />
                </div>
                <NoteEditor editor={editor} />
              </>
            ) : (
              <>
                <div className="reader-topbar">
                  <Breadcrumbs
                    id={note.id}
                    title={note.title}
                    query={destination.id === note.id ? destination.query : ''}
                    onSelectFolder={selectFolderFromBreadcrumb}
                  />
                  <button
                    type="button"
                    className="reader-edit-btn"
                    aria-label={tr('编辑笔记')}
                    title={tr('编辑 Markdown，自动保存到原文件')}
                    onClick={() => editor.begin(note)}
                  >
                    <Icon name="pencil" />
                  </button>
                </div>
                {!toc.some((item) => item.level === 1) && (
                  <header className="reader-note-header">
                    <h1>{note.title}</h1>
                  </header>
                )}
                <ReadingOutline
                  headings={toc}
                  active={activeHeading}
                  jump={(id) => {
                    const target = content.current?.querySelector<HTMLElement>(`#${id}`);
                    if (target) {
                      revealTarget(target, 'start');
                      updateHeading();
                    }
                  }}
                />
                <div className="reader-markdown" ref={content}>
                  <NoteMarkdown
                    key={note.id}
                    highlight={destination.id === note.id ? destination.query : ''}
                    backlink={destination.id === note.id ? destination.backlink : ''}
                    onTag={(tag) => {
                      setQuery(tag);
                      setOffset(0);
                      setActiveResult(0);
                      setMenu(true);
                    }}
                    image={ReaderPicture}
                    id={note.id}
                    text={note.markdown}
                    follow={(target) => void follow(target)}
                  />
                </div>
                <footer className="reader-backlinks">
                  <div className="reader-backlinks-head">
                    <h2>{tr('反向链接')}</h2>
                    {note.backlinks.length > 0 && (
                      <span className="reader-meta-count">{note.backlinks.length}</span>
                    )}
                  </div>
                  {note.backlinks.length ? (
                    <ul>
                      {note.backlinks.map((item) => (
                        <li key={item.id}>
                          <button title={item.id} onClick={() => open(item.id, '', '', note.id)}>
                            <Icon name="reader-note" />
                            <span className="reader-backlink-title">{item.title}</span>
                            <small>{item.id}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{tr('暂无反向链接')}</p>
                  )}
                </footer>
              </>
            )}
          </article>
        )}
      </main>
      <dialog className="reader-choices" ref={chooser} onClose={() => setChoices(null)}>
        <h2>{tr('选择链接目标')}</h2>
        <ul>
          {choices?.notes.map((item) => (
            <li key={item.id}>
              <button onClick={() => open(item.id, choices.anchor)}>
                {item.title}
                <small>{item.id}</small>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => setChoices(null)}>{tr('取消')}</button>
      </dialog>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Reader />);
