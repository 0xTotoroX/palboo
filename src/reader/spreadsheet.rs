// [INPUT]: Bounded local spreadsheet bytes read through the reader's authorized file boundary.
// [OUTPUT]: Sheet names and paginated plain cell values; no formulas, macros or external links execute.
// [POS]: On-demand Calamine/CSV adapter; workbook bodies never enter the note search index.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use calamine::{Data, DataRef, Reader, Sheets, open_workbook_auto_from_rs};
use serde_json::{Value, json};
use std::{collections::BTreeMap, io::Cursor, path::Path};
pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
const PAGE: usize = 100;
const MAX_CELLS: usize = 2_000_000;
pub fn supported(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        matches!(
            e.to_ascii_lowercase().as_str(),
            "xlsx" | "xls" | "xlsm" | "xlsb" | "ods" | "csv" | "tsv"
        )
    })
}
fn cell(value: &Data) -> String {
    if let Data::DateTime(value) = value {
        if value.is_duration() {
            return value
                .as_duration()
                .map(|v| v.to_string())
                .unwrap_or_else(|| value.to_string());
        }
        if let Some(date) = value.as_datetime() {
            return if date.time() == Default::default() {
                date.date().to_string()
            } else {
                date.to_string()
            };
        }
    }
    value.to_string()
}
fn streamed_page(
    mut next: impl FnMut() -> Result<Option<((u32, u32), String)>>,
    offset: usize,
) -> Result<Value> {
    let mut cells = BTreeMap::new();
    let mut height = 0;
    let mut width = 0;
    let mut count = 0;
    let mut text_size = 0;
    while let Some(((row, column), value)) = next()? {
        let (row, column) = (row as usize, column as usize);
        count += 1;
        text_size += value.len();
        ensure!(
            row < 100_000 && column < 512 && count <= MAX_CELLS && text_size <= 128 * 1024 * 1024,
            "表格过大，请在原应用中打开"
        );
        height = height.max(row + 1);
        width = width.max(column + 1);
        if (offset..offset + PAGE).contains(&row) {
            cells.insert((row, column), value);
        }
    }
    let rows: Vec<Vec<String>> = (offset..height.min(offset + PAGE))
        .map(|row| {
            (0..width)
                .map(|column| cells.remove(&(row, column)).unwrap_or_default())
                .collect()
        })
        .collect();
    Ok(
        json!({"rows":rows,"offset":offset,"startRow":0,"startColumn":0,"totalRows":height,"totalColumns":width}),
    )
}
pub fn preview(id: &str, bytes: Vec<u8>, sheet: &str, offset: usize) -> Result<Value> {
    ensure!(offset <= 100_000, "阅读请求过长");
    let extension = Path::new(id)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "csv" | "tsv") {
        let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
        let text = std::str::from_utf8(bytes).context("CSV 或 TSV 文件需要 UTF-8 编码")?;
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .delimiter(if extension == "tsv" { b'\t' } else { b',' })
            .from_reader(text.as_bytes());
        let mut rows = Vec::new();
        let mut total = 0;
        let mut columns = 0;
        let mut cells = 0;
        for record in reader.records() {
            let record = record.context("表格内容无法解析")?;
            columns = columns.max(record.len());
            cells += record.len();
            ensure!(
                cells <= MAX_CELLS && columns <= 512 && total < 100_000,
                "表格过大，请在原应用中打开"
            );
            if (offset..offset + PAGE).contains(&total) {
                rows.push(record.iter().map(str::to_owned).collect::<Vec<_>>());
            }
            total += 1;
        }
        return Ok(
            json!({"sheets":["CSV"],"sheet":"CSV","rows":rows,"offset":offset,"startRow":0,"startColumn":0,"totalRows":total,"totalColumns":columns}),
        );
    }
    if bytes.starts_with(b"PK") {
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).context("表格内容无法解析")?;
        ensure!(archive.len() <= 10_000, "表格过大，请在原应用中打开");
        let mut expanded = 0u64;
        for i in 0..archive.len() {
            expanded = expanded.saturating_add(archive.by_index(i)?.size());
            ensure!(expanded <= 128 * 1024 * 1024, "表格过大，请在原应用中打开");
        }
    }
    let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes))
        .context("表格无法打开，可能已加密或格式不受支持")?;
    let sheets = workbook.sheet_names();
    ensure!(sheets.len() <= 200, "表格工作表过多");
    let selected = if sheet.is_empty() {
        sheets.first().context("表格没有工作表")?
    } else {
        sheets
            .iter()
            .find(|name| name.as_str() == sheet)
            .context("工作表不存在")?
    };
    // Streaming avoids allocating a giant dense range for a few widely spaced Excel cells.
    let streamed = match &mut workbook {
        Sheets::Xlsx(workbook) => {
            let mut reader = workbook.worksheet_cells_reader(selected)?;
            Some(streamed_page(
                || {
                    Ok(reader.next_cell_with_formula()?.map(|entry| {
                        let value = if matches!(entry.value, DataRef::Empty) {
                            entry
                                .formula
                                .map(|formula| format!("={formula}"))
                                .unwrap_or_default()
                        } else {
                            cell(&entry.value.into())
                        };
                        (entry.pos, value)
                    }))
                },
                offset,
            )?)
        }
        Sheets::Xlsb(workbook) => {
            let mut reader = workbook.worksheet_cells_reader(selected)?;
            Some(streamed_page(
                || {
                    Ok(reader.next_cell()?.map(|entry| {
                        (
                            entry.get_position(),
                            cell(&entry.get_value().clone().into()),
                        )
                    }))
                },
                offset,
            )?)
        }
        _ => None,
    };
    if let Some(mut value) = streamed {
        value["sheets"] = json!(sheets);
        value["sheet"] = json!(selected);
        return Ok(value);
    }
    let range = workbook
        .worksheet_range(selected)
        .context("工作表无法读取")?;
    let (height, width) = range.get_size();
    ensure!(
        height <= 100_000 && width <= 512 && height.saturating_mul(width) <= MAX_CELLS,
        "表格过大，请在原应用中打开"
    );
    let (row, column) = range.start().unwrap_or_default();
    let rows: Vec<Vec<String>> = range
        .rows()
        .skip(offset)
        .take(PAGE)
        .map(|r| r.iter().map(cell).collect())
        .collect();
    Ok(
        json!({"sheets":sheets,"sheet":selected,"rows":rows,"offset":offset,"startRow":row,"startColumn":column,"totalRows":height,"totalColumns":width}),
    )
}
