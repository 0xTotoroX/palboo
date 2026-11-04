/* [INPUT]: Transport-free reader components, original reader CSS and synthetic portfolio documents.
 * [OUTPUT]: In-memory reading/editing/workbooks with previews, outline/backlinks, reading history and an isolated web-reference tab.
 * [POS]: Website adapter only; edits stay in memory and links never contact a backend or remote site.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Breadcrumbs, SidebarResize, useSidebarWidth } from '../reader/navigation';
import { NoteTree } from '../reader/tree';
import { PreviewableMarkdown } from '../reader/link-preview';
import { ReadingInfo, useReadingInfo } from '../reader/information';
import { HistoryButtons } from '../reader/history';
import type { Heading } from '../reader/outline';
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
  const locale = useLocale();
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
  const app = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [trail, setTrail] = useState({ entries: ['plan.md'], index: 0 });
  const positions = useRef<Record<string, number>>({});
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState('');
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
  const information = useReadingInfo(app, true, Boolean(note) && !editing && tab === 'notes');
  const backlinks = notes.filter(
    (item) => item.id !== selected && item.markdown.includes(`[[${selected}`),
  );
  useLayoutEffect(() => {
    setHeadings(
      [
        ...(content.current?.querySelectorAll<HTMLElement>(
          '.reader-markdown :is(h1,h2,h3,h4,h5,h6)',
        ) || []),
      ].map((node) => ({
        id: node.id,
        text: node.textContent || '',
        level: Number(node.tagName.slice(1)),
      })),
    );
    if (content.current && !editing) content.current.scrollTop = positions.current[selected] || 0;
  }, [selected, editing, edits, locale]);
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
  async function open(id: string, traversing = false) {
    if (!catalog.some((item) => item.id === id)) {
      setError(tr('链接指向的笔记不存在'));
      return;
    }
    positions.current[selected] = content.current?.scrollTop || 0;
    await editor.finish();
    if (id !== selected && !traversing)
      setTrail((current) => ({
        entries: [...current.entries.slice(0, current.index + 1), id],
        index: current.index + 1,
      }));
    information.dismiss();
    focusContent.current = true;
    setSelected(id);
    setMenu(false);
    setError('');
  }
  const historyActions = (
    <HistoryButtons
      back={trail.index > 0}
      forward={trail.index + 1 < trail.entries.length}
      go={(delta) => {
        const index = trail.index + delta;
        setTrail({ ...trail, index });
        void open(trail.entries[index], true);
      }}
    />
  );
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
          <div
            ref={app}
            className="reader-app"
            data-menu={menu}
            data-information={information.rail}
            style={sidebar.style}
          >
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
            <div
              className="reader-main"
              ref={content}
              tabIndex={-1}
              onScroll={() => {
                const root = content.current;
                if (root)
                  setActiveHeading(
                    [
                      ...root.querySelectorAll<HTMLElement>(
                        '.reader-markdown :is(h1,h2,h3,h4,h5,h6)',
                      ),
                    ]
                      .filter(
                        (node) =>
                          node.getBoundingClientRect().top <= root.getBoundingClientRect().top + 64,
                      )
                      .at(-1)?.id ||
                      headings[0]?.id ||
                      '',
                  );
              }}
            >
              {error && <p role="alert">{error}</p>}
              {selected === 'assets.xlsx' ? (
                <div className="reader-sheet-shell">
                  <div className="reader-topbar">
                    {historyActions}
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
                    {historyActions}
                    {navigationActions}
                    <Breadcrumbs id={selected} title={note.title} />
                  </div>
                  <NoteEditor editor={editor} />
                </article>
              ) : (
                <article>
                  <div className="reader-topbar">
                    {historyActions}
                    {navigationActions}
                    <Breadcrumbs id={selected} title={note.title} query={query} />
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
                  <PreviewableMarkdown
                    source={selected}
                    revision={`${locale}:${note.markdown}`}
                    load={async (target) => {
                      const item = catalog.find((item) => item.id === target);
                      return {
                        candidates: item ? [item] : [],
                        total: item ? 1 : 0,
                        anchor: '',
                        excerpt:
                          item && 'markdown' in item
                            ? item.markdown.replace(/[#*]/g, '').slice(0, 1200)
                            : null,
                      };
                    }}
                    open={(id) => void open(id)}
                    follow={(target) => void open(target)}
                  >
                    <NoteMarkdown
                      key={note.id}
                      highlight={query}
                      id={note.id}
                      text={note.markdown}
                      follow={(target) => void open(target)}
                      openExternal={() => setTab('reference')}
                    />
                  </PreviewableMarkdown>
                </article>
              )}
            </div>
            <ReadingInfo
              state={information}
              bounds={app}
              headings={headings}
              active={activeHeading}
              backlinks={backlinks}
              jump={(id) =>
                content.current?.querySelector(`#${id}`)?.scrollIntoView({ block: 'start' })
              }
              open={(id) => void open(id)}
            />
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
