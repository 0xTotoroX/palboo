/* [INPUT]: Reader-only API, safe Markdown with authenticated image rendering, note tree and browser navigation.
 * [OUTPUT]: Unified search, guarded reader history, link previews, responsive reading information and safe editing.
 * [POS]: Standalone document opened in ChatGPT; no settings token, composer access or AI calls.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  read,
  write,
  folderId,
  type Catalog,
  type Note,
  type Summary,
  type LinkPreview,
} from './api';
import { NoteEditor, useNoteEditor } from './editor';
import { Spreadsheet } from './spreadsheet';
import { NoteMarkdown, anchorKey, decodeLink } from './markdown';
import { ReaderPicture } from './picture';
import { Breadcrumbs, SidebarResize, useSidebarWidth } from './navigation';
import type { Heading } from './outline';
import { ReadingInfo, useReadingInfo } from './information';
import { HistoryButtons, useReaderHistory } from './history';
import { PreviewableMarkdown } from './link-preview';
import { SearchText } from './search';
import { useReaderSearch } from './search-state';
import { useReaderSidebar } from './sidebar';
import { ReaderHome, useRecentNotes } from './home';
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
  const searching = useReaderSearch(catalog);
  const {
    query,
    offset,
    search,
    results: displayedResults,
    active: activeResult,
    error: searchError,
  } = searching;
  const setQuery = searching.change;
  const setOffset = searching.page;
  const setActiveResult = searching.setActive;
  const nav = useReaderSidebar(searchInput);
  const menu = nav.visible;
  const recent = useRecentNotes(folderId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editor = useNoteEditor(setNote);
  const navigation = useRef(false);
  const selectedDocument = catalog?.notes.find((item) => item.id === selected);
  const [toc, setToc] = useState<Heading[]>([]);
  const [choices, setChoices] = useState<{ notes: Summary[]; anchor: string } | null>(null);
  const app = useRef<HTMLDivElement>(null);
  const information = useReadingInfo(app, nav.docked, Boolean(note) && !editor.active);
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
  useLayoutEffect(() => {
    resultsList.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeResult, query, displayedResults.length]);
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
  const travel = useReaderHistory(
    folderId,
    async () => {
      if (navigation.current) return false;
      return editor.finish();
    },
    () => {
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
      setError('');
      linkRequest.current?.abort();
      nav.dismiss();
      information.dismiss();
    },
  );
  useEffect(() => {
    window.addEventListener('pagehide', remember);
    return () => window.removeEventListener('pagehide', remember);
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
    readingReady.current = false;
  }, [note, editor.active]);
  // Restore after the heading-derived filename header has settled, before paint.
  useLayoutEffect(() => {
    if (!note || !content.current || !article.current) return;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = '';
    if (anchor) scrollAnchor(anchor);
    else article.current.scrollTop = positions.current[note.id] || 0;
    updateHeading();
    readingReady.current = true;
    document.title = `${note.title} · Palboo`;
    recent.visit(note.id);
  }, [toc, editor.active]);
  useLayoutEffect(() => {
    if (
      note?.id !== destination.id ||
      !readingReady.current ||
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
  }, [note, toc, destination, editor.active]);
  useEffect(() => {
    if (choices) chooser.current?.showModal();
    else chooser.current?.close();
  }, [choices]);
  async function open(id: string, anchor = '', searchQuery = '', backlink = '') {
    if (navigation.current || travel.busy()) return;
    navigation.current = true;
    const saved = await editor.finish();
    navigation.current = false;
    if (!saved) return;
    remember();
    setDestination((value) => ({ id, query: searchQuery, backlink, revision: value.revision + 1 }));
    linkRequest.current?.abort();
    setChoices(null);
    nav.dismiss();
    setError('');
    information.dismiss();
    travel.push(
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
    nav.show('tree');
    tree.revealFolder(folderPath);
  };
  return (
    <div
      ref={app}
      className="reader-app"
      data-information={information.rail}
      data-menu={menu}
      data-docked={nav.docked}
      data-drawer={nav.overlay}
      style={sidebar.style}
    >
      {nav.overlay && (
        <div className="reader-sidebar-scrim" onClick={nav.close} aria-hidden="true" />
      )}
      <aside
        ref={nav.panel}
        id="reader-navigation"
        className="reader-sidebar"
        hidden={!menu}
        role={nav.overlay ? 'dialog' : undefined}
        aria-modal={nav.overlay || undefined}
        aria-label={tr('目录与搜索')}
      >
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
            {nav.overlay && !nav.narrow && (
              <button
                type="button"
                className="reader-tool-btn"
                onClick={nav.pin}
                title={tr('固定侧栏')}
                aria-label={tr('固定侧栏')}
              >
                <Icon name="pin" />
              </button>
            )}
            <button
              type="button"
              className="reader-nav-toggle"
              title={tr(nav.docked ? '收起侧栏' : '关闭目录')}
              aria-label={tr(nav.docked ? '收起侧栏' : '关闭目录')}
              aria-expanded={menu}
              onClick={nav.close}
            >
              <Icon name="reader-sidebar" />
            </button>
          </div>
        </div>
        {nav.docked && (
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
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (!displayedResults.length) return;
                  event.preventDefault();
                  setActiveResult(
                    Math.max(
                      0,
                      Math.min(
                        displayedResults.length - 1,
                        activeResult + (event.key === 'ArrowDown' ? 1 : -1),
                      ),
                    ),
                  );
                } else if (event.key === 'Enter' && query.trim() && displayedResults.length) {
                  event.preventDefault();
                  const picked =
                    displayedResults[Math.min(activeResult, displayedResults.length - 1)];
                  void open(picked.id, '', query);
                } else if (event.key === 'Escape') {
                  if (query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery('');
                  } else {
                    event.currentTarget.blur();
                    if (nav.overlay) {
                      event.preventDefault();
                      nav.close();
                    }
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
          <nav aria-label={tr('搜索结果')} hidden={!query.trim()}>
            {query.trim() && (
              <>
                {searchError && <p role="alert">{searchError}</p>}
                {!search && !searchError && !displayedResults.length && (
                  <p className="reader-status" role="status">
                    {tr('正在搜索…')}
                  </p>
                )}
                {search && displayedResults.length === 0 && (
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
                          }}
                        >
                          {tr('上一页')}
                        </button>
                        <button
                          disabled={offset + 50 >= search.total}
                          onClick={() => {
                            setOffset(offset + 50);
                          }}
                        >
                          {tr('下一页')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </nav>
          <nav aria-label={tr('笔记目录')} hidden={!!query.trim()}>
            {catalog && (
              <NoteTree notes={catalog.notes} selected={selected} open={open} expansion={tree} />
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
        inert={nav.overlay}
        onScroll={() => {
          if (readingReady.current && note && note.id === selectedRef.current && article.current)
            positions.current[note.id] = article.current.scrollTop;
          updateHeading();
        }}
      >
        <div className="reader-topbar">
          <HistoryButtons back={travel.back} forward={travel.forward} go={travel.go} />
          {!nav.docked && (
            <div className="reader-navigation-actions">
              <button
                className="reader-tool-btn reader-open-directory"
                aria-label={tr('展开侧栏')}
                title={tr('展开侧栏')}
                aria-controls="reader-navigation"
                aria-expanded={menu}
                onClick={() => {
                  setQuery('');
                  nav.show('tree');
                }}
              >
                <Icon name="reader-sidebar" />
              </button>
              <button
                className="reader-tool-btn"
                aria-label={tr('搜索笔记')}
                title={tr('搜索笔记')}
                onClick={() => nav.show('search')}
              >
                <Icon name="search" />
              </button>
            </div>
          )}
          {selected ? (
            <>
              <button
                className="reader-tool-btn"
                aria-label={tr('阅读首页')}
                title={tr('阅读首页')}
                onClick={() => void open('')}
              >
                <Icon name="home" />
              </button>
              <Breadcrumbs
                id={selected}
                title={selectedDocument?.title}
                query={destination.id === selected ? destination.query : ''}
                onSelectFolder={editor.active ? undefined : selectFolderFromBreadcrumb}
              />
            </>
          ) : (
            <span className="reader-library-name">{catalog?.name || 'Palboo'}</span>
          )}
          {note && !editor.active && (
            <button
              ref={information.trigger}
              className="reader-tool-btn"
              aria-label={tr('阅读信息')}
              title={tr('阅读信息')}
              aria-controls="reader-information"
              aria-expanded={information.visible}
              onClick={information.toggle}
            >
              <Icon name="dock" />
            </button>
          )}
          {note && !editor.active && (
            <button
              type="button"
              className="reader-edit-btn"
              aria-label={tr('编辑笔记')}
              title={tr('编辑 Markdown，自动保存到原文件')}
              onClick={() => editor.begin(note)}
            >
              <Icon name="pencil" />
            </button>
          )}
        </div>
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
        {!selected && catalog && !error && (
          <ReaderHome catalog={catalog} recent={recent.ids} open={open} />
        )}
        {!note && selectedDocument?.kind !== 'spreadsheet' && (selected || !catalog) && !error && (
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
            <Spreadsheet key={selected} id={selected} revision={catalog?.revision || 0} />
          </div>
        )}
        {note && (
          <article>
            {editor.active ? (
              <>
                <NoteEditor editor={editor} />
              </>
            ) : (
              <>
                {!toc.some((item) => item.level === 1) && (
                  <header className="reader-note-header">
                    <h1>{note.title}</h1>
                  </header>
                )}
                <PreviewableMarkdown
                  source={selected}
                  revision={catalog?.revision || 0}
                  contentRef={content}
                  load={(target, signal) =>
                    read<LinkPreview>('preview', { id: note.id, target }, signal)
                  }
                  open={(id, anchor) => void open(id, anchor)}
                  follow={(target) => void follow(target)}
                >
                  <NoteMarkdown
                    key={note.id}
                    highlight={destination.id === note.id ? destination.query : ''}
                    backlink={destination.id === note.id ? destination.backlink : ''}
                    onTag={(tag) => {
                      setQuery(tag);
                      nav.show('search');
                    }}
                    image={ReaderPicture}
                    id={note.id}
                    text={note.markdown}
                    follow={(target) => void follow(target)}
                  />
                </PreviewableMarkdown>
              </>
            )}
          </article>
        )}
      </main>
      <ReadingInfo
        state={information}
        headings={toc}
        active={activeHeading}
        backlinks={note?.backlinks || []}
        inert={nav.overlay}
        jump={(id) => {
          const target = content.current?.querySelector<HTMLElement>(`#${id}`);
          if (target) {
            revealTarget(target, 'start');
            updateHeading();
          }
        }}
        open={(id) => void open(id, '', '', note?.id || '')}
      />
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
