/* [INPUT]: 当前主题的宿主界面字体名称。
 * [OUTPUT]: 为宿主选中的具体本机字形注册同名 FontFace；换主题/销毁时回收。
 * [POS]: 仅设置文档，只使用 local()，不枚举、下载或分发字体文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect } from 'react';

export function useHostFonts(family?: string) {
  useEffect(() => {
    if (!family || typeof FontFace === 'undefined' || !document.fonts) return;
    let active = true;
    const installed: FontFace[] = [];
    // 宿主将具体 PostScript 字形映射到此别名；普通 family 列表继续由浏览器解析。
    const aliases = [...family.matchAll(/"(Codex selected (?:[^"\\]|\\.)+)"/g)]
      .slice(0, 3)
      .map((match) => match[1].replace(/\\(.)/g, '$1'));
    for (const alias of new Set(aliases)) {
      const name = alias.slice('Codex selected '.length);
      if (!name || name.length > 200) continue;
      try {
        const face = new FontFace(alias, `local(${JSON.stringify(name)})`);
        void face.load().then(
          () => {
            if (!active) return;
            document.fonts.add(face);
            installed.push(face);
          },
          () => {}, // 本机没有相应字形时保留既有 family 回退链。
        );
      } catch {
        // 旧浏览器或不可解析的字体名称不影响设置操作。
      }
    }
    return () => {
      active = false;
      for (const face of installed) document.fonts.delete(face);
    };
  }, [family]);
}
