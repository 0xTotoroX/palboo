/* [INPUT]: Local catalog, current selection and optional controlled expansion state.
 * [OUTPUT]: Lazy folder tree with single-line rows, indent guides and folder/note reveal support.
 * [POS]: Reader navigation; never scans files or mounts children of closed folders.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Summary } from './api';
import { Icon } from '../shared/icons/react';

type Branch = { folders: Map<string, Branch>; notes: Summary[] };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function compareNames(a: string, b: string) {
  return Number(b.startsWith('_')) - Number(a.startsWith('_')) || collator.compare(a, b);
}
function ancestors(id: string) {
  const result = new Set<string>();
  const parts = id.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) result.add(`${parts.slice(0, i).join('/')}/`);
  return result;
}
export type TreeExpansion = ReturnType<typeof useTreeExpansion>;
export function useTreeExpansion(selected: string) {
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestors(selected));
  const [reveal, setReveal] = useState<{ tick: number; folder: string }>({ tick: 0, folder: '' });
  useEffect(() => {
    if (!selected) return;
    setExpanded((current) => {
      const needed = ancestors(selected);
      if ([...needed].every((item) => current.has(item))) return current;
      const next = new Set(current);
      for (const item of needed) next.add(item);
      return next;
    });
  }, [selected]);
  return {
    expanded,
    reveal,
    toggle(path: string, value: boolean) {
      setExpanded((current) => {
        if (current.has(path) === value) return current;
        const next = new Set(current);
        if (value) next.add(path);
        else next.delete(path);
        return next;
      });
    },
    collapseAll() {
      setExpanded(new Set());
    },
    revealCurrent() {
      if (!selected) return;
      setExpanded((current) => {
        const next = new Set(current);
        for (const item of ancestors(selected)) next.add(item);
        return next;
      });
      setReveal((value) => ({ tick: value.tick + 1, folder: '' }));
    },
    revealFolder(folderPath: string) {
      const clean = folderPath.replace(/\/+$/, '');
      if (!clean) return;
      const parts = clean.split('/');
      setExpanded((current) => {
        const next = new Set(current);
        for (let i = 1; i <= parts.length; i++) next.add(`${parts.slice(0, i).join('/')}/`);
        return next;
      });
      setReveal((value) => ({ tick: value.tick + 1, folder: `${clean}/` }));
    },
  };
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
      <summary data-folder-path={path} title={name}>
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
              title={note.id.includes('/') ? `${note.title}\n${note.id}` : note.title}
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
  expansion,
}: {
  notes: Summary[];
  selected: string;
  open: (id: string) => void;
  expansion?: TreeExpansion;
}) {
  const internal = useTreeExpansion(selected);
  const state = expansion || internal;
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!state.reveal.tick || !root.current) return;
    const selector = state.reveal.folder
      ? `summary[data-folder-path="${CSS.escape(state.reveal.folder)}"]`
      : '[aria-current="page"]';
    const target = root.current.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.expanded, state.reveal]);
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
    <TreeState.Provider value={{ expanded: state.expanded, toggle: state.toggle }}>
      <div ref={root} className="reader-tree">
        <Contents branch={tree} path="" selected={selected} open={open} />
      </div>
    </TreeState.Provider>
  );
}
