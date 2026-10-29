// [INPUT]: 已验证的 App 原位置/备份位置、当前用户 Dock 偏好与私有恢复目录。
// [OUTPUT]: repair；保持已有 Palboo 固定项的顺序/GUID，解除指向旧 inode 的书签。
// [POS]: 完整 App 更新后的入口恢复；不新增固定项，不改其他安装或应用。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::Result;
use serde_json::{Value, json};
use std::path::Path;
use tokio::process::Command;

pub async fn repair(app: &Path, previous: &Path, control: &Path) -> Result<()> {
    let changed = repair_domain(
        "com.apple.dock",
        app,
        previous,
        &control.join("app-update-dock.plist"),
    )
    .await?;
    if changed {
        let status = Command::new("/usr/bin/killall")
            .args(["-u", &unsafe { libc::getuid() }.to_string(), "Dock"])
            .status()
            .await?;
        anyhow::ensure!(
            status.success() || status.code() == Some(1),
            "Dock 入口已保存，但刷新失败"
        );
    }
    Ok(())
}
async fn repair_domain(domain: &str, app: &Path, previous: &Path, backup: &Path) -> Result<bool> {
    let config = json!({"domain":domain,"destination":app,"previous":previous,"backup":backup});
    let mut command = Command::new("/usr/bin/osascript");
    command.args([
        "-l",
        "JavaScript",
        "-e",
        &format!("const options = {config};\n{SCRIPT}"),
    ]);
    let result: Value = serde_json::from_str(&super::install::output(command).await?)?;
    Ok(result["changed"].as_u64().unwrap_or(0) > 0)
}
// 与 scripts/dev-dock.mjs 使用相同 Foundation 写入方式；只修复本次安装的路径。
const SCRIPT: &str = r#"
ObjC.import('Foundation');
const defaults = $.NSUserDefaults.alloc.initWithSuiteName(options.domain);
const current = defaults.persistentDomainForName(options.domain);
const apps = current.isNil() ? $() : current.objectForKey('persistent-apps');
const normalize = path => ObjC.unwrap($(path).stringByResolvingSymlinksInPath).replace(/\/+$/, '');
const ownedPaths = [options.destination, options.previous].map(normalize);
let changed = 0;
if (!apps.isNil()) {
  const next = $.NSMutableArray.alloc.init;
  for (let i = 0; i < apps.count; i++) {
    const entry = apps.objectAtIndex(i);
    const data = entry.objectForKey('tile-data');
    const id = data.isNil() ? $() : data.objectForKey('bundle-identifier');
    const file = data.isNil() ? $() : data.objectForKey('file-data');
    const url = file.isNil() ? $() : file.objectForKey('_CFURLString');
    let path = '';
    if (!url.isNil()) {
      const text = ObjC.unwrap(url);
      path = text.startsWith('file:') ? ObjC.unwrap($.NSURL.URLWithString(text).path) : text;
      path = normalize(path);
    }
    if (id.isNil() || ObjC.unwrap(id) !== 'local.palboo.launcher' || !ownedPaths.includes(path)) {
      next.addObject(entry); continue;
    }
    const replacement = entry.mutableCopy;
    replacement.removeObjectForKey('book');
    replacement.setObjectForKey($({
      'file-data': {'_CFURLString': ObjC.unwrap($.NSURL.fileURLWithPathIsDirectory(options.destination, true).absoluteString), '_CFURLStringType': 15},
      'file-label': 'Palboo', 'bundle-identifier': 'local.palboo.launcher', 'file-type': 41
    }), 'tile-data');
    next.addObject(replacement);
    if (!entry.isEqualToDictionary(replacement)) changed++;
  }
  if (changed) {
    const bytes = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(apps, $.NSPropertyListXMLFormat_v1_0, 0, null);
    if (!$.NSFileManager.defaultManager.createFileAtPathContentsAttributes(options.backup, bytes, $({'NSFilePosixPermissions': 384}))) throw Error('无法保存 Dock 恢复副本');
    if (!defaults.persistentDomainForName(options.domain).objectForKey('persistent-apps').isEqualToArray(apps)) throw Error('Dock 已被其他操作修改，未覆盖');
    defaults.setObjectForKey(next, 'persistent-apps');
    if (!defaults.synchronize || !defaults.persistentDomainForName(options.domain).objectForKey('persistent-apps').isEqualToArray(next)) throw Error('Dock 偏好回读不一致');
  }
}
JSON.stringify({changed});
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rebinds_only_the_updated_app_and_preserves_pin_position_and_other_entries() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("Palboo.app");
        let previous = root.path().join("old/Palboo.app");
        let domain = format!("local.palboo.update-test.{}", uuid::Uuid::new_v4());
        let entry = |id: &str, path: &Path, guid: u32| json!({"GUID":guid,"book":"synthetic bookmark","tile-type":"file-tile","tile-data":{"bundle-identifier":id,"file-data":{"_CFURLString":format!("file://{}/",path.display()),"_CFURLStringType":15}}});
        let original = json!([
            entry("other.app", Path::new("/Applications/Other.app"), 1),
            entry("local.palboo.launcher", &previous, 2),
            entry("local.palboo.launcher", Path::new("/another/Palboo.app"), 3)
        ]);
        let mut seed = Command::new("/usr/bin/osascript");
        seed.args(["-l", "JavaScript", "-e", &format!("ObjC.import('Foundation');const d=$.NSUserDefaults.alloc.initWithSuiteName({domain:?});d.setObjectForKey($({original}), 'persistent-apps');d.synchronize;")]);
        super::super::install::output(seed).await.unwrap();
        let result =
            repair_domain(&domain, &app, &previous, &root.path().join("backup.plist")).await;
        let mut read = Command::new("/usr/bin/osascript");
        read.args(["-l", "JavaScript", "-e", &format!("ObjC.import('Foundation');const d=$.NSUserDefaults.alloc.initWithSuiteName({domain:?});JSON.stringify(ObjC.deepUnwrap(d.objectForKey('persistent-apps')));")]);
        let read = super::super::install::output(read).await;
        let mut clean = Command::new("/usr/bin/defaults");
        clean.args(["delete", &domain]);
        let _ = super::super::install::output(clean).await;
        assert!(result.unwrap());
        let actual: Value = serde_json::from_str(&read.unwrap()).unwrap();
        assert_eq!(actual[0], original[0]);
        assert_eq!(actual[2], original[2]);
        assert_eq!(actual[1]["GUID"], 2);
        assert!(actual[1].get("book").is_none());
        assert_eq!(
            actual[1]["tile-data"]["file-data"]["_CFURLString"],
            format!("file://{}/", app.display())
        );
        assert!(root.path().join("backup.plist").exists());
    }
}
