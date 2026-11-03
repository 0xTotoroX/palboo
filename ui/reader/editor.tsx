/* [INPUT]: A versioned Markdown note and explicit user edits.
 * [OUTPUT]: Debounced serialized saves, guarded navigation and the shared editor view re-export.
 * [POS]: In-memory draft only; never saves on entry or overwrites an external version.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { read, ReaderError, write, type Note } from './api';
import { tr } from '../shared/i18n.js';
type Session = {
  id: string;
  text: string;
  saved: string;
  version: string;
  composing: boolean;
  failure: string;
  conflict: boolean;
};
const normalized = (text: string) => text.replace(/\r\n/g, '\n');
export function useNoteEditor(onSave: (note: Note) => void) {
  const session = useRef<Session | null>(null);
  const flight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [, render] = useState(0);
  const update = () => {
    if (mounted.current) render((value) => value + 1);
  };
  const savedCallback = useRef(onSave);
  savedCallback.current = onSave;
  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const dirty = () =>
    !!session.current && (session.current.text !== session.current.saved || !!flight.current);
  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      mounted.current = false;
      cancelTimer();
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  async function flush(): Promise<boolean> {
    cancelTimer();
    if (flight.current) {
      await flight.current;
      return session.current?.failure ? false : flush();
    }
    const edit = session.current;
    if (!edit || edit.text === edit.saved) return true;
    if (edit.composing || edit.conflict) return false;
    const save = async () => {
      edit.failure = '';
      update();
      while (session.current === edit && edit.text !== edit.saved) {
        const sent = edit.text;
        try {
          const result = await write<Note>('save', {
            id: edit.id,
            markdown: sent,
            expectedVersion: edit.version,
          });
          edit.saved = sent;
          edit.version = result.version;
          savedCallback.current(result);
          update();
        } catch (error) {
          edit.failure = (error as Error).message;
          edit.conflict = error instanceof ReaderError && error.status === 409;
          update();
          return false;
        }
        if (edit.composing) return false;
      }
      return true;
    };
    flight.current = save();
    update();
    try {
      return await flight.current;
    } finally {
      flight.current = null;
      update();
    }
  }
  function schedule() {
    cancelTimer();
    if (session.current && !session.current.composing && !session.current.conflict)
      timer.current = setTimeout(() => void flush(), 700);
  }
  async function finish() {
    if (!(await flush())) return false;
    session.current = null;
    update();
    return true;
  }
  return {
    active: !!session.current,
    activeRef: session,
    text: session.current?.text || '',
    failure: session.current?.failure || '',
    conflict: session.current?.conflict || false,
    status: flight.current
      ? tr('正在保存…')
      : session.current?.failure
        ? tr('未保存')
        : dirty()
          ? tr('等待保存…')
          : tr('已保存'),
    begin(note: Note) {
      session.current = {
        id: note.id,
        text: normalized(note.markdown),
        saved: normalized(note.markdown),
        version: note.version,
        composing: false,
        failure: '',
        conflict: false,
      };
      update();
    },
    change(text: string) {
      if (!session.current) return;
      session.current.text = text;
      update();
      schedule();
    },
    compose(composing: boolean) {
      if (!session.current) return;
      session.current.composing = composing;
      if (composing) cancelTimer();
      else schedule();
    },
    flush,
    finish,
    async reload() {
      const edit = session.current;
      if (!edit || !window.confirm(tr('重新读取会替换当前草稿。请先复制需要保留的内容。'))) return;
      try {
        const note = await read<Note>('note', { id: edit.id });
        if (session.current !== edit) return;
        edit.text = edit.saved = normalized(note.markdown);
        edit.version = note.version;
        edit.failure = '';
        edit.conflict = false;
        savedCallback.current(note);
        update();
      } catch (error) {
        edit.failure = (error as Error).message;
        update();
      }
    },
  };
}
export { NoteEditor } from './editor-view';
