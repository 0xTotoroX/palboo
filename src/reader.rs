// [INPUT]: Explicit source roots, versioned Markdown edits, local images/spreadsheets and a separate credential.
// [OUTPUT]: Searchable catalog, links/backlinks, local previews and conflict-protected Markdown saves.
// [POS]: Human reading/editing only; no vault body enters model context or App projections.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
mod edit;
mod files;
mod http;
mod index;
mod spreadsheet;
pub use http::start;
pub use index::Index;
#[cfg(test)]
mod tests;
