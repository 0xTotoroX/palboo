// [INPUT]: Authorized vault files and CommonMark/Obsidian links parsed without executing HTML.
// [OUTPUT]: Bounded index/search, resolved plain-text hover previews, link resolution and backlinks.
// [POS]: In-memory derived state; refreshed explicitly/on reader focus, never persisted into the vault.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::{edit, files, spreadsheet};
use crate::web_library::Preferences;
use anyhow::{Context, Result, ensure};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Clone)]
struct Note {
    title: String,
    text: String,
    links: Vec<String>,
    size: u64,
    modified: Option<SystemTime>,
}
#[derive(Default)]
pub struct Index {
    vault: Option<PathBuf>,
    notes: BTreeMap<String, Note>,
    documents: BTreeMap<String, String>,
    names: BTreeMap<String, Vec<String>>,
    images: Vec<PathBuf>,
    backlinks: BTreeMap<String, BTreeSet<String>>,
    pub skipped: usize,
    pub revision: u64,
}
pub fn decode(value: &str) -> Result<String> {
    let mut bytes = Vec::new();
    let input = value.as_bytes();
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%'
            && i + 2 < input.len()
            && let Ok(hex) = std::str::from_utf8(&input[i + 1..i + 3])
            && let Ok(byte) = u8::from_str_radix(hex, 16)
        {
            bytes.push(byte);
            i += 3;
            continue;
        }
        bytes.push(input[i]);
        i += 1;
    }
    let text = String::from_utf8(bytes)?;
    ensure!(!text.chars().any(char::is_control), "链接无效");
    Ok(text)
}
fn walk(root: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(root).context("无法读取授权目录")? {
        let entry = entry?;
        if entry.file_name().as_encoded_bytes().starts_with(b".") {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            walk(&entry.path(), files)?;
        } else if kind.is_file() {
            files.push(entry.path());
            ensure!(files.len() <= 100_000, "目录文件过多，请选择更小的笔记目录");
        }
    }
    Ok(())
}
fn links(text: &str) -> Vec<String> {
    Parser::new_ext(
        text,
        Options::ENABLE_WIKILINKS | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS,
    )
    .filter_map(|event| match event {
        Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
            Some(dest_url.into_string())
        }
        _ => None,
    })
    .collect()
}
fn without_md(value: &str) -> &str {
    if value.to_ascii_lowercase().ends_with(".md") {
        &value[..value.len() - 3]
    } else {
        value
    }
}
impl Index {
    pub fn refresh(&mut self, preferences: &Preferences) -> Result<()> {
        let vault = preferences
            .vault
            .as_ref()
            .context("尚未选择 Obsidian 笔记库")?;
        let mut paths = Vec::new();
        walk(vault, &mut paths)?;
        paths.sort();
        let mut notes = BTreeMap::new();
        let mut documents = BTreeMap::new();
        let mut images = Vec::new();
        let mut skipped = 0;
        let mut total = 0usize;
        for path in paths {
            if spreadsheet::supported(&path) {
                documents.insert(
                    path.strip_prefix(vault)?.to_string_lossy().into_owned(),
                    path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                );
                continue;
            }
            if files::image_type(&path).is_some() {
                images.push(path);
                continue;
            }
            if !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            {
                continue;
            }
            let id = path.strip_prefix(vault)?.to_string_lossy().into_owned();
            let metadata = std::fs::symlink_metadata(&path)?;
            let previous = self.notes.get(&id).filter(|note| {
                self.vault.as_ref() == Some(vault)
                    && note.size == metadata.len()
                    && note.modified == metadata.modified().ok()
            });
            let note = if let Some(note) = previous {
                note.clone()
            } else {
                let content = files::read(std::slice::from_ref(vault), &path, files::MAX_NOTE)
                    .and_then(|b| Ok(String::from_utf8(b)?));
                let Ok(text) = content else {
                    skipped += 1;
                    continue;
                };
                Note {
                    title: path
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into(),
                    links: links(&text),
                    text,
                    size: metadata.len(),
                    modified: metadata.modified().ok(),
                }
            };
            total += note.text.len();
            ensure!(
                total <= 128 * 1024 * 1024,
                "笔记正文超过 128 MB 索引上限，请选择较小的目录"
            );
            notes.insert(id, note);
        }
        for root in &preferences.attachments {
            let mut paths = Vec::new();
            walk(root, &mut paths)?;
            images.extend(paths.into_iter().filter(|p| files::image_type(p).is_some()));
        }
        let mut names = BTreeMap::<String, Vec<String>>::new();
        for id in notes.keys().chain(documents.keys()) {
            let parts: Vec<_> = without_md(id).split('/').collect();
            for i in 0..parts.len() {
                names
                    .entry(parts[i..].join("/").to_lowercase())
                    .or_default()
                    .push(id.clone());
            }
        }
        self.vault = Some(vault.clone());
        self.notes = notes;
        self.documents = documents;
        self.names = names;
        self.images = images;
        self.skipped = skipped;
        self.revision += 1;
        self.rebuild_backlinks();
        Ok(())
    }
    fn rebuild_backlinks(&mut self) {
        let mut backlinks = BTreeMap::<String, BTreeSet<String>>::new();
        for (id, note) in &self.notes {
            for link in &note.links {
                if let Ok((candidates, _)) = self.resolve(id, link)
                    && candidates.len() == 1
                    && candidates[0] != *id
                {
                    backlinks
                        .entry(candidates[0].clone())
                        .or_default()
                        .insert(id.clone());
                }
            }
        }
        self.backlinks = backlinks;
    }
    pub fn ready(&self, p: &Preferences) -> bool {
        self.vault == p.vault && self.vault.is_some()
    }
    pub fn catalog(&self) -> Value {
        json!({"name":self.vault.as_ref().and_then(|p|p.file_name()).map(|s|s.to_string_lossy()),"revision":self.revision,"skipped":self.skipped,"notes":self.notes.keys().chain(self.documents.keys()).map(|id|self.summary(id)).collect::<Vec<_>>()})
    }
    pub fn summary(&self, id: &str) -> Value {
        json!({"id":id,"title":self.notes.get(id).map(|n| &n.title).or_else(||self.documents.get(id)),"kind":if self.documents.contains_key(id) { "spreadsheet" } else { "markdown" }})
    }
    pub fn preview(&self, from: &str, target: &str) -> Result<Value> {
        let (candidates, anchor) = self.resolve(from, target)?;
        let excerpt = if candidates.len() == 1 {
            self.notes
                .get(&candidates[0])
                .map(|note| super::preview::excerpt(&note.text, &anchor))
        } else {
            None
        };
        Ok(json!({
            "candidates": candidates.iter().take(8).map(|id| self.summary(id)).collect::<Vec<_>>(),
            "total": candidates.len(), "anchor": anchor, "excerpt": excerpt
        }))
    }
    pub fn search(&self, query: &str, offset: usize) -> Value {
        let query = query.trim().to_lowercase();
        let words: Vec<_> = query.split_whitespace().collect();
        let mut matches = Vec::new();
        for (id, note) in &self.notes {
            let title = note.title.to_lowercase();
            let name = format!("{title} {}", id.to_lowercase());
            let text = note.text.to_lowercase();
            if words.iter().all(|w| name.contains(w) || text.contains(w)) {
                let rank = if words.iter().all(|word| name.contains(word)) {
                    usize::from(!title.starts_with(&query))
                } else {
                    2
                };
                // Snippet offsets use characters, not the lowercased UTF-8 byte offsets.
                let chars: Vec<_> = note.text.chars().collect();
                let position = words
                    .first()
                    .and_then(|w| text.find(w))
                    .map(|p| text[..p].chars().count())
                    .unwrap_or(0);
                let snippet: String = chars
                    .iter()
                    .skip(position.saturating_sub(35))
                    .take(150)
                    .collect();
                matches.push((rank, 0, id, snippet));
            }
        }
        for (id, title) in &self.documents {
            let title = title.to_lowercase();
            let name = format!("{title} {}", id.to_lowercase());
            if words.iter().all(|word| name.contains(word)) {
                matches.push((
                    usize::from(!title.starts_with(&query)),
                    1,
                    id,
                    String::new(),
                ));
            }
        }
        // Match the catalog's stable title-first ordering used by instant search.
        matches.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
        json!({"total":matches.len(),"offset":offset,"results":matches.iter().skip(offset).take(50).map(|(_,_,id,snippet)|{let mut value=self.summary(id);value["snippet"]=json!(snippet);value}).collect::<Vec<_>>()})
    }
    pub fn resolve(&self, from: &str, raw: &str) -> Result<(Vec<String>, String)> {
        ensure!(self.notes.contains_key(from), "来源笔记已不存在，请刷新");
        let (dest, fragment) = raw.split_once('#').unwrap_or((raw, ""));
        let dest = decode(dest)?;
        let fragment = decode(fragment)?;
        ensure!(
            !dest.contains(':') && !dest.starts_with("//"),
            "不是库内链接"
        );
        if dest.is_empty() {
            return Ok((vec![from.to_owned()], fragment));
        }
        let vault = self.vault.as_ref().unwrap();
        let relative = files::normalized(&vault.join(from).parent().unwrap().join(&dest));
        if let Ok(path) = relative
            && let Ok(path) = path.strip_prefix(vault)
        {
            let path = path.to_string_lossy();
            if self.documents.contains_key(path.as_ref()) {
                return Ok((vec![path.into_owned()], fragment));
            }
            let id = format!("{}.md", without_md(&path));
            if self.notes.contains_key(&id) {
                return Ok((vec![id], fragment));
            }
            let key = without_md(&path).to_lowercase();
            let matches: Vec<_> = self
                .names
                .get(&key)
                .into_iter()
                .flatten()
                .filter(|id| without_md(id).to_lowercase() == key)
                .cloned()
                .collect();
            if !matches.is_empty() {
                return Ok((matches, fragment));
            }
        }
        let target = without_md(dest.trim_start_matches('/'));
        if dest.starts_with('.') {
            return Ok((Vec::new(), fragment));
        }
        let direct = format!("{target}.md");
        if self.documents.contains_key(target) {
            return Ok((vec![target.to_owned()], fragment));
        }
        if target.contains('/') && self.notes.contains_key(&direct) {
            return Ok((vec![direct], fragment));
        }
        Ok((
            self.names
                .get(&target.to_lowercase())
                .cloned()
                .unwrap_or_default(),
            fragment,
        ))
    }
    pub fn note(&self, p: &Preferences, id: &str) -> Result<Value> {
        ensure!(self.notes.contains_key(id), "笔记不存在，请刷新目录");
        let vault = p.vault.as_ref().context("尚未选择笔记库")?;
        let text = String::from_utf8(files::read(
            std::slice::from_ref(vault),
            &vault.join(id),
            files::MAX_NOTE,
        )?)?;
        Ok(
            json!({"id":id,"title":self.notes[id].title,"kind":"markdown","version":edit::version(text.as_bytes()),"markdown":text,"backlinks":self.backlinks.get(id).into_iter().flatten().map(|id|self.summary(id)).collect::<Vec<_>>()}),
        )
    }
    pub fn save(
        &mut self,
        p: &Preferences,
        id: &str,
        version: &str,
        markdown: &str,
    ) -> Result<Value> {
        ensure!(self.notes.contains_key(id), "笔记不存在，请刷新目录");
        let vault = p.vault.as_ref().context("尚未选择笔记库")?;
        ensure!(
            self.notes
                .iter()
                .filter(|(key, _)| key.as_str() != id)
                .map(|(_, note)| note.text.len())
                .sum::<usize>()
                + markdown.len()
                <= 128 * 1024 * 1024,
            "笔记正文超过 128 MB 索引上限，请选择较小的目录"
        );
        let text = edit::save(vault, id, version, markdown)?;
        let note = self.notes.get_mut(id).unwrap();
        note.text = text.clone();
        note.links = links(&text);
        note.size = text.len() as u64;
        note.modified = None;
        self.revision += 1;
        self.rebuild_backlinks();
        Ok(
            json!({"id":id,"title":self.notes[id].title,"kind":"markdown","version":edit::version(text.as_bytes()),"markdown":text,"backlinks":self.backlinks.get(id).into_iter().flatten().map(|id|self.summary(id)).collect::<Vec<_>>()}),
        )
    }
    pub fn workbook(&self, p: &Preferences, id: &str, sheet: &str, offset: usize) -> Result<Value> {
        ensure!(self.documents.contains_key(id), "表格不存在，请刷新目录");
        let vault = p.vault.as_ref().context("尚未选择笔记库")?;
        let bytes = files::read(
            std::slice::from_ref(vault),
            &vault.join(id),
            spreadsheet::MAX_BYTES,
        )?;
        spreadsheet::preview(id, bytes, sheet, offset)
    }
    pub fn image(&self, p: &Preferences, from: &str, raw: &str) -> Result<(Vec<u8>, &'static str)> {
        ensure!(self.notes.contains_key(from), "来源笔记不存在");
        let dest = decode(raw.split('#').next().unwrap_or(raw))?;
        ensure!(
            !dest.contains(':') && !dest.starts_with("//"),
            "不是本地图片"
        );
        let vault = p.vault.as_ref().context("尚未选择笔记库")?;
        let mut roots = vec![vault.clone()];
        roots.extend(p.attachments.clone());
        let candidates = [
            vault.join(from).parent().unwrap().join(&dest),
            vault.join(dest.trim_start_matches('/')),
        ];
        for path in candidates {
            if let Some(mime) = files::image_type(&path)
                && let Ok(bytes) = files::read(&roots, &path, files::MAX_IMAGE)
            {
                return Ok((bytes, mime));
            }
        }
        if !dest.contains('/') {
            let matches: Vec<_> = self
                .images
                .iter()
                .filter(|p| p.file_name().is_some_and(|name| name == dest.as_str()))
                .collect();
            ensure!(matches.len() <= 1, "存在同名图片，请使用相对路径");
            if let Some(path) = matches.first() {
                return Ok((
                    files::read(&roots, path, files::MAX_IMAGE)?,
                    files::image_type(path).unwrap(),
                ));
            }
        }
        anyhow::bail!("图片不存在、未授权或格式不受支持")
    }
}
