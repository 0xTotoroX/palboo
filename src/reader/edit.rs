// [INPUT]: Existing authorized Markdown, content digest and a user-created edit.
// [OUTPUT]: Size-bounded atomic replacement; stale content, links and special files are rejected.
// [POS]: The only note write boundary. No create/delete/rename API or attachment writes.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use super::files;
use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    ffi::CString,
    fs::File,
    io::{Seek, SeekFrom, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::Path,
};

#[derive(Debug)]
pub struct Conflict;
impl std::fmt::Display for Conflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "文件已在其他地方修改，草稿已保留，请比较后重新读取")
    }
}
impl std::error::Error for Conflict {}
pub fn version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

struct Pending<'a> {
    parent: &'a File,
    name: CString,
}
impl Drop for Pending<'_> {
    fn drop(&mut self) {
        unsafe {
            libc::unlinkat(self.parent.as_raw_fd(), self.name.as_ptr(), 0);
        }
    }
}
pub fn save(vault: &Path, id: &str, expected: &str, text: &str) -> Result<String> {
    ensure!(
        Path::new(id)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md")),
        "仅支持编辑 Markdown 笔记"
    );
    ensure!(text.len() as u64 <= files::MAX_NOTE, "文件过大");
    let (parent, name) = files::parent(&[vault.to_owned()], &vault.join(id))?;
    let mut source = files::open_at(&parent, &name, false)?;
    let metadata = source.metadata()?;
    ensure!(
        metadata.is_file() && metadata.nlink() == 1 && metadata.mode() & 0o222 != 0,
        "文件不可写或存在硬链接"
    );
    fs2::FileExt::try_lock_exclusive(&source)?;
    let original = files::read_file(&source, files::MAX_NOTE)?;
    if version(&original) != expected {
        return Err(Conflict.into());
    }
    let original_text = std::str::from_utf8(&original)?;
    let mut text = text.replace("\r\n", "\n");
    if original_text.contains("\r\n") && !original_text.replace("\r\n", "").contains('\n') {
        text = text.replace('\n', "\r\n");
    }
    if original_text.starts_with('\u{feff}') && !text.starts_with('\u{feff}') {
        text.insert(0, '\u{feff}');
    }
    ensure!(text.len() as u64 <= files::MAX_NOTE, "文件过大");
    if original == text.as_bytes() {
        return Ok(text);
    }
    // A same-directory exclusive temporary file makes the final replacement atomic.
    let pending = Pending {
        parent: &parent,
        name: CString::new(format!(".palboo-{}.tmp", uuid::Uuid::new_v4().simple()))?,
    };
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            pending.name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    ensure!(fd >= 0, "无法保存笔记，请检查文件夹权限");
    let mut replacement = unsafe { File::from_raw_fd(fd) };
    replacement.write_all(text.as_bytes())?;
    ensure!(
        unsafe {
            libc::fchmod(
                replacement.as_raw_fd(),
                (metadata.mode() & 0o777) as libc::mode_t,
            )
        } == 0,
        "无法保留文件权限"
    );
    replacement.sync_all()?;
    // Re-read immediately before replacing, including identity changes from an external atomic save.
    source.seek(SeekFrom::Start(0))?;
    let latest = files::open_at(&parent, &name, false)?;
    let latest_metadata = latest.metadata()?;
    if latest_metadata.ino() != metadata.ino()
        || latest_metadata.dev() != metadata.dev()
        || version(&files::read_file(&source, files::MAX_NOTE)?) != expected
        || version(&files::read_file(&latest, files::MAX_NOTE)?) != expected
    {
        return Err(Conflict.into());
    }
    let name = CString::new(name.as_bytes())?;
    ensure!(
        unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                pending.name.as_ptr(),
                parent.as_raw_fd(),
                name.as_ptr(),
            )
        } == 0,
        "无法保存笔记，请重试"
    );
    Ok(text)
}
