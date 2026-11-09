// [INPUT]: Explicit local backup payload and optional user passphrase.
// [OUTPUT]: Versioned, bounded Palboo archives; secret-bearing exports require age encryption.
// [POS]: Transfer format only; never opens application directories or writes credentials to logs.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::{Read, Write},
};

pub const LIMIT: usize = 128 * 1024 * 1024;
pub const SECTIONS: &[(&str, &str)] = &[
    ("settings", "功能与模型服务"),
    ("appearance", "外观与字体"),
    ("layout", "布局与预设"),
    ("surfaces", "贴边与材质"),
    ("models", "模型分组与预设"),
    ("reading", "阅读与网页"),
    ("tasks", "任务看板设置"),
    ("terminology", "术语设置"),
    ("data", "任务与术语数据"),
    ("machine", "本机目录与设备设置"),
    ("secrets", "API 密钥"),
];
pub type Files = BTreeMap<String, Value>;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub version: u32,
    pub files: Files,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Archive {
    pub format: String,
    pub version: u32,
    pub app_version: String,
    pub created_at: u64,
    pub sections: BTreeMap<String, Section>,
    pub attachments: BTreeMap<String, String>,
}
impl Archive {
    pub fn check(&self) -> Result<()> {
        ensure!(
            self.format == "palboo-backup" && self.version == 1,
            "备份格式或版本不受支持"
        );
        ensure!(
            semver::Version::parse(&self.app_version)?
                <= semver::Version::parse(crate::config::VERSION)?,
            "备份来自更新版本，请先更新目标 Palboo"
        );
        ensure!(self.sections.len() <= SECTIONS.len(), "备份模块无效");
        for (id, section) in &self.sections {
            ensure!(
                SECTIONS.iter().any(|(known, _)| known == id) && section.version == 1,
                "备份模块版本不受支持"
            );
            super::snapshot::check_section(id, &section.files)?;
        }
        ensure!(
            self.attachments.len() <= 100
                && (self.attachments.is_empty() || self.sections.contains_key("data")),
            "导入原件列表无效"
        );
        let mut total = 0;
        for (path, value) in &self.attachments {
            super::snapshot::check_attachment(path)?;
            let bytes = STANDARD.decode(value).context("导入原件损坏")?;
            ensure!(
                bytes.len() <= crate::terminology_import::MAX_FILE,
                "导入原件超过 8 MB"
            );
            total += bytes.len();
            ensure!(total <= LIMIT / 2, "导入原件总大小超过 64 MB");
        }
        Ok(())
    }
}
pub fn encode(value: &Archive, password: &str) -> Result<Vec<u8>> {
    value.check()?;
    ensure!(
        !value.sections.contains_key("secrets") || password.chars().count() >= 10,
        "包含密钥时，请设置至少 10 个字符的备份密码"
    );
    let bytes = serde_json::to_vec(value)?;
    ensure!(
        bytes.len() <= LIMIT,
        "备份超过 128 MB，请取消包含个人数据后重试"
    );
    if password.is_empty() {
        return Ok(bytes);
    }
    ensure!(
        password.chars().count() >= 10 && password.len() <= 1024,
        "备份密码需为 10–1024 个字符"
    );
    let encryptor = age::Encryptor::with_user_passphrase(password.to_owned().into());
    let mut out = Vec::new();
    let mut writer = encryptor.wrap_output(&mut out)?;
    writer.write_all(&bytes)?;
    writer.finish()?;
    ensure!(
        out.len() <= LIMIT,
        "加密后的备份超过 128 MB，请取消包含个人数据后重试"
    );
    Ok(out)
}
pub fn decode(bytes: &[u8], password: &str) -> Result<Archive> {
    ensure!(bytes.len() <= LIMIT, "备份超过 128 MB");
    let encrypted = bytes.starts_with(b"age-encryption.org/");
    let plain = if encrypted {
        ensure!(
            !password.is_empty() && password.len() <= 1024,
            "请输入备份密码"
        );
        let decryptor = age::Decryptor::new(bytes).context("加密备份损坏")?;
        let mut identity = age::scrypt::Identity::new(password.to_owned().into());
        identity.set_max_work_factor(20);
        let reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .context("备份密码错误或文件损坏")?;
        let mut plain = Vec::new();
        reader
            .take(LIMIT as u64 + 1)
            .read_to_end(&mut plain)
            .context("备份密码错误或文件损坏")?;
        ensure!(plain.len() <= LIMIT, "备份超过 128 MB");
        plain
    } else {
        bytes.to_vec()
    };
    let value: Archive = serde_json::from_slice(&plain).context("不是有效的 Palboo 备份")?;
    value.check()?;
    ensure!(
        encrypted || !value.sections.contains_key("secrets"),
        "包含密钥的备份必须加密"
    );
    Ok(value)
}
pub fn base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}
pub fn unbase64(value: &str) -> Result<Vec<u8>> {
    ensure!(value.len() <= LIMIT * 4 / 3 + 8, "备份超过 128 MB");
    STANDARD.decode(value).context("备份文件编码无效")
}
