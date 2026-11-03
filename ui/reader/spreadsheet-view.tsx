/* [INPUT]: A workbook page and sheet/pagination callbacks.
 * [OUTPUT]: Shared inert table cells, navigation and loading/error states.
 * [POS]: Transport-free reader table; never evaluates formulas or changes workbook files.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
export type Workbook = {
  sheets: string[];
  sheet: string;
  rows: string[][];
  offset: number;
  startRow: number;
  startColumn: number;
  totalRows: number;
  totalColumns: number;
};
function columnName(column: number) {
  let text = '';
  for (column++; column > 0; column = Math.floor((column - 1) / 26))
    text = String.fromCharCode(65 + ((column - 1) % 26)) + text;
  return text;
}
export function WorkbookView({
  id,
  sheet,
  offset,
  workbook,
  error = '',
  busy = false,
  retry,
  selectSheet,
  selectOffset,
}: {
  id: string;
  sheet: string;
  offset: number;
  workbook: Workbook | null;
  error?: string;
  busy?: boolean;
  retry: () => void;
  selectSheet: (sheet: string) => void;
  selectOffset: (offset: number) => void;
}) {
  return (
    <section className="reader-workbook" aria-label={id.split('/').at(-1)} aria-busy={busy}>
      <h1>{id.split('/').at(-1)}</h1>
      {error && (
        <div role="alert" className="reader-error">
          {error}
          <button onClick={retry}>{tr('重试')}</button>
        </div>
      )}
      {!workbook && busy && <p role="status">{tr('正在读取表格…')}</p>}
      {workbook && (
        <>
          <div className="reader-sheet-controls">
            <label>
              {tr('工作表')}
              <select
                aria-label={tr('工作表')}
                value={sheet || workbook.sheet}
                disabled={busy}
                onChange={(e) => {
                  selectSheet(e.target.value);
                }}
              >
                {workbook.sheets.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <span>
              {tr('{{rows}} 行 · {{columns}} 列', {
                rows: workbook.totalRows,
                columns: workbook.totalColumns,
              })}
            </span>
          </div>
          <div className="reader-sheet-scroll" tabIndex={0} aria-label={tr('表格内容')}>
            <table>
              <thead>
                <tr>
                  <th aria-label={tr('行号')} />
                  {Array.from({ length: workbook.totalColumns }, (_, col) => (
                    <th key={col} scope="col">
                      {columnName(workbook.startColumn + col)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workbook.rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{workbook.startRow + workbook.offset + i + 1}</th>
                    {Array.from({ length: workbook.totalColumns }, (_, col) => (
                      <td
                        key={col}
                        className={
                          /^-?\d+(\.\d+)?$/.test(row[col] || '') ? 'reader-number' : undefined
                        }
                      >
                        {row[col] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {workbook.totalRows === 0 && <p>{tr('工作表为空')}</p>}
          {workbook.totalRows > 100 && (
            <div className="reader-pagination">
              <button
                disabled={busy || offset === 0}
                onClick={() => selectOffset(Math.max(0, offset - 100))}
              >
                {tr('上一页')}
              </button>
              <span>
                {workbook.offset + 1}–{Math.min(workbook.offset + 100, workbook.totalRows)}
              </span>
              <button
                disabled={busy || offset + 100 >= workbook.totalRows}
                onClick={() => selectOffset(offset + 100)}
              >
                {tr('下一页')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
