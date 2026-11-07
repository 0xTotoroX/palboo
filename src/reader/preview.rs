// [INPUT]: Indexed Markdown and an optional resolved heading/block anchor.
// [OUTPUT]: A bounded, plain-text excerpt without frontmatter, HTML or image requests.
// [POS]: Read-only hover preview formatting; never reads files or executes note content.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

fn anchor_key(value: &str) -> String {
    value.trim().trim_start_matches('#').to_lowercase()
}

pub(super) fn excerpt(markdown: &str, anchor: &str) -> String {
    let options = Options::ENABLE_YAML_STYLE_METADATA_BLOCKS | Options::ENABLE_WIKILINKS;
    let anchor = anchor_key(anchor);
    let mut start = 0;
    if !anchor.is_empty() {
        let mut heading = None;
        let mut title = String::new();
        for (event, range) in Parser::new_ext(markdown, options).into_offset_iter() {
            match event {
                Event::Start(Tag::Heading { .. }) => {
                    heading = Some(range.start);
                    title.clear();
                }
                Event::Text(text) | Event::Code(text) if heading.is_some() => title.push_str(&text),
                Event::End(TagEnd::Heading(_)) => {
                    let key = anchor_key(&title);
                    let slug: String = key
                        .chars()
                        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-')
                        .map(|c| if c.is_whitespace() { '-' } else { c })
                        .collect();
                    if key == anchor || slug == anchor {
                        start = heading.unwrap_or(0);
                        break;
                    }
                    heading = None;
                }
                _ => {}
            }
        }
        if let Some(block) = anchor.strip_prefix('^') {
            let mut offset = 0;
            let suffix = format!("^{block}");
            for line in markdown.split_inclusive('\n') {
                if line.trim_end().to_lowercase().ends_with(&suffix) {
                    start = offset;
                    break;
                }
                offset += line.len();
            }
        }
    }
    let mut output = String::new();
    let mut remaining = 1200;
    let mut metadata = false;
    for event in Parser::new_ext(&markdown[start..], options) {
        match event {
            Event::Start(Tag::MetadataBlock(_)) => metadata = true,
            Event::End(TagEnd::MetadataBlock(_)) => metadata = false,
            Event::Text(text) | Event::Code(text) if !metadata => {
                for c in text.chars().take(remaining) {
                    output.push(c);
                    remaining -= 1;
                }
            }
            Event::SoftBreak
            | Event::HardBreak
            | Event::Rule
            | Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::CodeBlock
                | TagEnd::Item
                | TagEnd::BlockQuote(_),
            ) if !metadata && !output.ends_with('\n') && remaining > 0 => {
                output.push('\n');
                remaining -= 1;
            }
            _ => {}
        }
        if remaining == 0 {
            break;
        }
    }
    output.trim().to_owned()
}
