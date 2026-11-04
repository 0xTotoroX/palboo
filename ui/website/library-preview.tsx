/* [INPUT]: Transport-free reader components, original reader CSS and synthetic portfolio documents.
 * [OUTPUT]: In-memory reading/editing/workbooks with resizable navigation, compact reopen actions and an isolated web-reference tab.
 * [POS]: Website adapter only; edits stay in memory and links never contact a backend or remote site.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Breadcrumbs, SidebarResize, useSidebarWidth } from '../reader/navigation';
import { NoteTree } from '../reader/tree';
import { NoteMarkdown } from '../reader/markdown';
import { NoteEditor, type NoteEditorState } from '../reader/editor-view';
import { WorkbookView } from '../reader/spreadsheet-view';
import { Icon } from '../shared/icons/react';
import { tr } from '../shared/i18n.js';
import { useLocale } from '../shared/use-locale';
import readerStyles from '../reader/style.css?inline';
import previewStyles from './library-preview.css?inline';
import { DemoSurface } from './demo-surface';
import { libraryNotes, libraryWorkbook, referenceArticle } from './library-examples';

const styles = `${readerStyles}\n${previewStyles}`;

export function LocalLibraryPreview() {
  useLocale();
  const sidebar = useSidebarWidth(undefined, 232);
  const [tab, setTab] = useState('notes');
  const [selected, setSelected] = useState('plan.md');
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState('screenshots');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const focusContent = useRef(false);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const notes = libraryNotes().map((note) => ({
    ...note,
    markdown: edits[note.id] ?? note.markdown,
  }));
  const catalog = [
    ...notes,
    { id: 'assets.xlsx', title: tr('素材清单'), kind: 'spreadsheet' as const },
  ];
  const note = notes.find((item) => item.id === selected)!;
  const workbook = libraryWorkbook(sheet);
  const filtered = catalog.filter((item) =>
    `${item.title} ${'markdown' in item ? item.markdown : ''}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  useLayoutEffect(() => {
    if (menu && focusSearch.current) {
      focusSearch.current = false;
      searchInput.current?.focus();
    }
    if (focusContent.current) {
      focusContent.current = false;
      content.current?.focus({ preventScroll: true });
    }
  }, [selected, menu]);
  const save = async () => {
    if (editing) setEdits((current) => ({ ...current, [selected]: draft }));
    return true;
  };
  const editor: NoteEditorState = {
    text: draft,
    status: tr('仅保存在演示中'),
    failure: '',
    conflict: false,
    change: setDraft,
    compose: () => {},
    flush: save,
    async finish() {
      await save();
      setEditing(false);
      return true;
    },
    reload: async () => {},
  };
  async function open(id: string) {
    if (!catalog.some((item) => item.id === id)) {
      setError(tr('链接指向的笔记不存在'));
      return;
    }
    await editor.finish();
    focusContent.current = true;
    setSelected(id);
    setMenu(false);
    setError('');
    content.current?.scrollTo(0, 0);
  }
  const tabs = [
    { id: 'notes', label: tr('本地笔记'), icon: 'reader-folder' },
    { id: 'reference', label: tr('设计参考'), icon: 'feature-sites' },
  ];
  const navigationActions = (
    <div className="library-navigation-actions">
      <button
        className="reader-tool-btn"
        aria-label={tr('目录与搜索')}
        title={tr('目录与搜索')}
        onClick={() => setMenu(true)}
      >
        <Icon name="reader-sidebar" />
      </button>
      <button
        className="reader-tool-btn"
        aria-label={tr('搜索笔记')}
        title={tr('搜索笔记')}
        onClick={() => {
          focusSearch.current = true;
          setMenu(true);
        }}
      >
        <Icon name="search" />
      </button>
    </div>
  );
  return (
    <DemoSurface kind="reader" styles={styles}>
      <div className="library-demo">
        <div className="library-tabs" role="tablist" aria-label={tr('示例页签')}>
          {tabs.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                tabButtons.current[index] = node;
              }}
              id={`library-tab-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`library-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
                setTab(tabs[next].id);
                tabButtons.current[next]?.focus({ preventScroll: true });
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div
          id="library-panel-notes"
          role="tabpanel"
          aria-labelledby="library-tab-notes"
          className="library-tab-panel"
          hidden={tab !== 'notes'}
        >
          <div className="reader-app" data-menu={menu} style={sidebar.style}>
            <aside className="reader-sidebar" aria-label={tr('目录与搜索')}>
              <div className="reader-library-row">
                <strong>{tr('作品集笔记')}</strong>
                <button
                  className="reader-nav-toggle"
                  aria-label={tr('目录与搜索')}
                  title={tr('目录与搜索')}
                  aria-expanded={menu}
                  onClick={() => setMenu(!menu)}
                >
                  <Icon name="reader-sidebar" />
                </button>
              </div>
              <SidebarResize
                width={sidebar.width}
                defaultWidth={sidebar.defaultWidth}
                setWidth={sidebar.setWidth}
              />
              <div className="reader-sidebar-body">
                <label className="reader-search">
                  <Icon name="search" />
                  <input
                    ref={searchInput}
                    type="search"
                    aria-label={tr('搜索笔记')}
                    placeholder={tr('搜索笔记')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <nav aria-label={tr('笔记目录')}>
                  <NoteTree notes={filtered} selected={selected} open={(id) => void open(id)} />
                  {!filtered.length && <p role="status">{tr('没有匹配的笔记')}</p>}
                </nav>
              </div>
            </aside>
            <div className="reader-main" ref={content} tabIndex={-1}>
              {error && <p role="alert">{error}</p>}
              {selected === 'assets.xlsx' ? (
                <div className="reader-sheet-shell">
                  <div className="reader-topbar">
                    {navigationActions}
                    <Breadcrumbs id={selected} title={tr('素材清单')} />
                  </div>
                  <WorkbookView
                    id={`${tr('素材清单')}.xlsx`}
                    workbook={workbook}
                    sheet={workbook.sheet}
                    offset={0}
                    selectSheet={(value) => setSheet(value === tr('文字') ? 'copy' : 'screenshots')}
                    selectOffset={() => {}}
                    retry={() => {}}
                  />
                </div>
              ) : editing ? (
                <article>
                  <div className="reader-topbar">
                    {navigationActions}
                    <Breadcrumbs id={selected} title={note.title} />
                  </div>
                  <NoteEditor editor={editor} />
                </article>
              ) : (
                <article>
                  <div className="reader-topbar">
                    {navigationActions}
                    <Breadcrumbs id={selected} title={note.title} query={query} />
                    <button
                      type="button"
                      className="reader-edit-btn"
                      aria-label={tr('编辑笔记')}
                      title={tr('编辑笔记')}
                      onClick={() => {
                        setDraft(note.markdown);
                        setEditing(true);
                      }}
                    >
                      <Icon name="pencil" />
                    </button>
                  </div>
                  <div className="reader-markdown">
                    <NoteMarkdown
                      key={note.id}
                      highlight={query}
                      id={note.id}
                      text={note.markdown}
                      follow={(target) => void open(target)}
                      openExternal={() => setTab('reference')}
                    />
                  </div>
                </article>
              )}
            </div>
          </div>
        </div>
        <div
          id="library-panel-reference"
          role="tabpanel"
          aria-labelledby="library-tab-reference"
          className="library-tab-panel"
          hidden={tab !== 'reference'}
        >
          <div className="reader-main library-reference">
            <article className="reader-markdown">
              <NoteMarkdown id="reference" text={referenceArticle()} follow={() => {}} />
            </article>
          </div>
        </div>
      </div>
    </DemoSurface>
  );
}
