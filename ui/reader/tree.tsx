/* [INPUT]: Local catalog and current selection.
 * [OUTPUT]: Lazy folder tree with collapse/reveal controls and wrapped full names.
 * [POS]: Reader navigation; never scans files or mounts children of closed folders.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
} from 'react';
import { tr } from '../shared/i18n.js';
import type { Summary } from './api';
import { Icon } from '../shared/icons/react';
type Branch = { folders: Map<string, Branch>; notes: Summary[] };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function compareNames(a: string, b: string) {
  return Number(b.startsWith('_')) - Number(a.startsWith('_')) || collator.compare(a, b);
}
const TreeState = createContext({
  expanded: new Set<string>(),
  toggle: (_path: string, _open: boolean) => {},
});
function Folder({
  name,
  path,
  branch,
  selected,
  open,
}: {
  name: string;
  path: string;
  branch: Branch;
  selected: string;
  open: (id: string) => void;
}) {
  const state = useContext(TreeState);
  const expanded = state.expanded.has(path);
  return (
    <details open={expanded} onToggle={(e) => state.toggle(path, e.currentTarget.open)}>
      <summary title={path}>
        <Icon name={expanded ? 'reader-folder-open' : 'reader-folder'} />
        <span className="reader-row-name">{name}</span>
      </summary>
      {expanded && <Contents branch={branch} path={path} selected={selected} open={open} />}
    </details>
  );
}
function Contents({
  branch,
  path,
  selected,
  open,
}: {
  branch: Branch;
  path: string;
  selected: string;
  open: (id: string) => void;
}) {
  return (
    <ul>
      {[...branch.folders]
        .sort(([a], [b]) => compareNames(a, b))
        .map(([name, child]) => (
          <li key={name}>
            <Folder
              name={name}
              path={`${path}${name}/`}
              branch={child}
              selected={selected}
              open={open}
            />
          </li>
        ))}
      {[...branch.notes]
        .sort((a, b) => compareNames(a.title, b.title))
        .map((note) => (
          <li key={note.id}>
            <button
              aria-current={note.id === selected ? 'page' : undefined}
              title={note.id}
              onClick={() => open(note.id)}
            >
              <Icon name={note.kind === 'spreadsheet' ? 'reader-sheet' : 'reader-note'} />
              <span className="reader-row-name">{note.title}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}
export function NoteTree({
  notes,
  selected,
  open,
}: {
  notes: Summary[];
  selected: string;
  open: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const [reveal, setReveal] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parts = selected.split('/');
    setExpanded((current) => {
      const next = new Set(current);
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/') + '/');
      return next;
    });
  }, [selected, reveal]);
  useLayoutEffect(() => {
    if (reveal)
      root.current
        ?.querySelector('[aria-current="page"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [expanded, reveal]);
  const tree = useMemo(() => {
    const tree: Branch = { folders: new Map(), notes: [] };
    for (const note of notes) {
      let branch = tree;
      const parts = note.id.split('/');
      parts.pop();
      for (const part of parts) {
        if (!branch.folders.has(part)) branch.folders.set(part, { folders: new Map(), notes: [] });
        branch = branch.folders.get(part)!;
      }
      branch.notes.push(note);
    }
    return tree;
  }, [notes]);
  return (
    <TreeState.Provider
      value={{
        expanded,
        toggle: (path, value) =>
          setExpanded((current) => {
            if (current.has(path) === value) return current;
            const next = new Set(current);
            if (value) next.add(path);
            else next.delete(path);
            return next;
          }),
      }}
    >
      <div ref={root} className="reader-tree">
        <div className="reader-tree-actions">
          <button
            title={tr('全部折叠')}
            aria-label={tr('全部折叠')}
            onClick={() => setExpanded(new Set())}
          >
            <Icon name="minus" />
          </button>
          <button
            title={tr('定位当前笔记')}
            aria-label={tr('定位当前笔记')}
            disabled={!selected || !notes.some((note) => note.id === selected)}
            onClick={() => setReveal((value) => value + 1)}
          >
            <Icon name="reader-note" />
          </button>
        </div>
        <Contents branch={tree} path="" selected={selected} open={open} />
      </div>
    </TreeState.Provider>
  );
}
