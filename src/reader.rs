// [INPUT]: Explicit source roots, read-only Markdown/image files and a separate loopback credential.
// [OUTPUT]: Searchable note catalog, resolved links/backlinks, authenticated note and image reads.
// [POS]: Human reader only; source files are opened O_RDONLY and no vault content enters App projections.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
mod files;
mod http;
mod index;
pub use http::start;
pub use index::Index;
#[cfg(test)]
mod tests;
