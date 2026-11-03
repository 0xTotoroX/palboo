/* [INPUT]: Authorized document identity and paginated local workbook API.
 * [OUTPUT]: Workbook request state and sheet/page selection, rendered by the shared WorkbookView.
 * [POS]: Reader attachment view; does not evaluate formulas or change spreadsheet files.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useState } from 'react';
import { read } from './api';
import { WorkbookView, type Workbook } from './spreadsheet-view';
export function Spreadsheet({ id, revision }: { id: string; revision: number }) {
  const [sheet, setSheet] = useState('');
  const [offset, setOffset] = useState(0);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void read<Workbook>('workbook', { id, sheet, offset }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWorkbook(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id, sheet, offset, revision, retry]);
  return (
    <WorkbookView
      id={id}
      sheet={sheet}
      offset={offset}
      workbook={workbook}
      error={error}
      busy={busy}
      retry={() => setRetry(retry + 1)}
      selectSheet={(value) => {
        setSheet(value);
        setOffset(0);
      }}
      selectOffset={setOffset}
    />
  );
}
