/* [INPUT]: Local catalog and current selection.
 * [OUTPUT]: Lazy folder tree with native keyboard-accessible disclosure and note buttons.
 * [POS]: Reader navigation; never scans files or mounts children of closed folders.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useMemo, useState } from 'react';
import type { Summary } from './api';
type Branch = { folders: Map<string, Branch>; notes: Summary[] };
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
  const [expanded, setExpanded] = useState(selected.startsWith(path));
  useEffect(() => {
    if (selected.startsWith(path)) setExpanded(true);
  }, [selected, path]);
  return (
    <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary>{name}</summary>
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
      {[...branch.folders].map(([name, child]) => (
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
      {branch.notes.map((note) => (
        <li key={note.id}>
          <button
            aria-current={note.id === selected ? 'page' : undefined}
            title={note.id}
            onClick={() => open(note.id)}
          >
            {note.title}
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
  return <Contents branch={tree} path="" selected={selected} open={open} />;
}
