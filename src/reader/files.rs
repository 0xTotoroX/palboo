// [INPUT]: Canonical explicitly granted roots and relative note/image paths.
// [OUTPUT]: Bounded O_RDONLY reads through no-follow directory descriptors.
// [POS]: The reader's only filesystem read boundary; refuses symlinks, hidden paths and special files.
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Context, Result, ensure};
use std::{
    ffi::CString,
    fs::File,
    io::Read,
    os::fd::{AsRawFd, FromRawFd},
    os::unix::ffi::OsStrExt,
    path::{Component, Path, PathBuf},
};
pub const MAX_NOTE: u64 = 8 * 1024 * 1024;
pub const MAX_IMAGE: u64 = 32 * 1024 * 1024;

pub fn normalized(path: &Path) -> Result<PathBuf> {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => result.push("/"),
            Component::CurDir => {}
            Component::ParentDir => {
                ensure!(result.pop(), "路径超出授权目录");
            }
            Component::Normal(part) => {
                result.push(part);
            }
            _ => anyhow::bail!("路径无效"),
        }
    }
    Ok(result)
}
pub(super) fn open_at(parent: &File, name: &std::ffi::OsStr, directory: bool) -> Result<File> {
    let name = CString::new(name.as_bytes())?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    // Owned descriptors anchor every component; O_NOFOLLOW closes traversal/symlink races.
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    ensure!(fd >= 0, "文件不存在、不可读取或包含符号链接");
    Ok(unsafe { File::from_raw_fd(fd) })
}
pub(super) fn parent(roots: &[PathBuf], path: &Path) -> Result<(File, std::ffi::OsString)> {
    let path = normalized(path)?;
    let root = roots
        .iter()
        .filter(|root| path.starts_with(root))
        .max_by_key(|p| p.components().count())
        .context("文件不在授权目录内")?;
    let relative = path.strip_prefix(root)?;
    ensure!(!relative.as_os_str().is_empty(), "不能读取目录");
    // Begin at / and refuse links even in a root replaced after its authorization.
    let mut file = File::open("/")?;
    for part in root.components().filter_map(|p| {
        if let Component::Normal(v) = p {
            Some(v)
        } else {
            None
        }
    }) {
        file = open_at(&file, part, true)?;
    }
    let parts: Vec<_> = relative.components().collect();
    for (i, part) in parts.iter().enumerate() {
        let Component::Normal(name) = part else {
            anyhow::bail!("路径无效")
        };
        ensure!(!name.as_bytes().starts_with(b"."), "隐藏目录不可读取");
        if i + 1 == parts.len() {
            return Ok((file, name.to_os_string()));
        }
        file = open_at(&file, name, true)?;
    }
    anyhow::bail!("路径无效")
}
pub fn read(roots: &[PathBuf], path: &Path, limit: u64) -> Result<Vec<u8>> {
    let (parent, name) = parent(roots, path)?;
    let file = open_at(&parent, &name, false)?;
    read_file(&file, limit)
}
pub(super) fn read_file(file: &File, limit: u64) -> Result<Vec<u8>> {
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.len() <= limit,
        "文件类型或大小不受支持"
    );
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "文件过大");
    Ok(bytes)
}
pub fn image_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}
