// [INPUT]: Saved interface preference and the OS preferred language.
// [OUTPUT]: Chinese/English copy for native dialogs and window titles.
// [POS]: Presentation only; never changes Agent configuration or user content.
// [PROTOCOL]: Keep src/AGENTS.md in sync.
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};
static ENGLISH: AtomicBool = AtomicBool::new(false);
fn uses_english(preference: &str, system: &str) -> bool {
    match preference {
        "en" => true,
        "zh-CN" => false,
        _ => !system.to_ascii_lowercase().starts_with("zh"),
    }
}
fn system_language() -> &'static str {
    static LANGUAGE: OnceLock<String> = OnceLock::new();
    LANGUAGE.get_or_init(|| {
        std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLanguages"])
            .output()
            .ok()
            .filter(|value| value.status.success())
            .and_then(|value| String::from_utf8(value.stdout).ok())
            .and_then(|value| {
                value
                    .split_whitespace()
                    .find(|part| part.chars().any(|c| c.is_ascii_alphabetic()))
                    .map(|part| {
                        part.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-')
                            .to_owned()
                    })
            })
            .unwrap_or_else(|| "en".into())
    })
}
pub fn set_language(preference: &str) {
    ENGLISH.store(
        uses_english(preference, system_language()),
        Ordering::Relaxed,
    );
}
pub fn text<'a>(chinese: &'a str, english: &'a str) -> &'a str {
    if ENGLISH.load(Ordering::Relaxed) {
        english
    } else {
        chinese
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_language_wins_and_system_chinese_variants_are_supported() {
        assert!(uses_english("en", "zh-Hans-CN"));
        assert!(!uses_english("zh-CN", "en-US"));
        assert!(!uses_english("system", "zh-Hant-TW"));
        assert!(uses_english("system", "fr-FR"));
    }
}
