// [INPUT]: Authenticated local settings service, optional settings destination and connected host.
// [OUTPUT]: One settings entry inside the host browser, including preset deep links; no external fallback.
// [POS]: Navigation only; preserves settings, drafts and host identity.
// [PROTOCOL]: Keep src/AGENTS.md in sync.
use crate::{lifecycle::Runtime, state::App};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::time::Duration;

fn destination(base: &str, section: Option<&str>) -> Result<String> {
    ensure!(
        matches!(
            section,
            None | Some("") | Some("layout-presets") | Some("sites")
        ),
        "未知设置页面"
    );
    let mut url = reqwest::Url::parse(base)?;
    ensure!(
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost")),
        "设置地址必须是本机服务"
    );
    if let Some(section) = section.filter(|s| !s.is_empty()) {
        url.query_pairs_mut().append_pair("open", section);
    }
    Ok(url.into())
}

impl App {
    pub(crate) fn settings_destination(&self, section: Option<&str>) -> Result<String> {
        destination(&Runtime::read(&self.paths)?.url(), section)
    }

    pub(crate) async fn open_settings_in_host(&self, section: Option<&str>) -> Result<Value> {
        // Validate before activating anything. The host obtains the URL through its existing bridge.
        self.settings_destination(section)?;
        let client = self
            .desktop_client()
            .await
            .context("ChatGPT 尚未连接，无法在应用内打开设置")?;
        client.request("Page.bringToFront", json!({})).await?;
        let options = json!({"section":section});
        let result = client.evaluate_with_timeout(format!(
            "window.__companionFloatingPanel?.openSettings?.({options}) ?? {{ok:false,message:'设置入口尚未就绪，请稍后重试'}}"
        ), Duration::from_secs(15)).await?;
        ensure!(
            result["ok"] == true,
            "{}",
            result["message"]
                .as_str()
                .unwrap_or("未能在 ChatGPT 内打开设置，请重试")
        );
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preset_destination_keeps_auth_and_rejects_unknown_pages() {
        let base = "http://127.0.0.1:1234/#token=synthetic";
        assert_eq!(
            destination(base, Some("layout-presets")).unwrap(),
            "http://127.0.0.1:1234/?open=layout-presets#token=synthetic"
        );
        assert_eq!(destination(base, None).unwrap(), base);
        assert_eq!(
            destination(base, Some("sites")).unwrap(),
            "http://127.0.0.1:1234/?open=sites#token=synthetic"
        );
        assert!(destination(base, Some("https://example.com")).is_err());
        assert!(destination("https://example.com", None).is_err());
    }
}
