/* [INPUT]: 当前主题的宿主界面字体名称。
 * [OUTPUT]: 具体本机字形及按需认证读取的 App 包内 OpenAI 字体注册为 FontFace；换主题/销毁时回收。
 * [POS]: 仅设置文档；字体来自本机宿主，不联网下载、不安装、不随包分发。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect } from 'react';
import { request, requestHostFont } from './api';

interface HostFont {
  id: string;
  family: string;
  weight: number;
  style: string;
}

export function useHostFonts(family?: string) {
  useEffect(() => {
    if (!family || typeof FontFace === 'undefined' || !document.fonts) return;
    let active = true;
    const abort = new AbortController();
    const installed: FontFace[] = [];
    const install = async (face: FontFace) => {
      await face.load();
      if (!active) return;
      document.fonts.add(face);
      installed.push(face);
    };
    // 宿主将具体 PostScript 字形映射到此别名；普通 family 列表继续由浏览器解析。
    const aliases = [...family.matchAll(/"(Codex selected (?:[^"\\]|\\.)+)"/g)]
      .slice(0, 3)
      .map((match) => match[1].replace(/\\(.)/g, '$1'));
    for (const alias of new Set(aliases)) {
      const name = alias.slice('Codex selected '.length);
      if (!name || name.length > 200) continue;
      try {
        const face = new FontFace(alias, `local(${JSON.stringify(name)})`);
        void install(face).catch(() => {}); // 不存在的本机字体保留原回退链。
      } catch {
        // 旧浏览器或不可解析的字体名称不影响设置操作。
      }
    }
    const families = family.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''));
    const bundled = ['OpenAI Sans', 'OpenAI Serif'].filter((name) => families.includes(name));
    if (bundled.length) {
      void request<{ fonts: HostFont[] }>('host-fonts', undefined, abort.signal)
        .then(async ({ fonts }) => {
          if (!active) return;
          await Promise.allSettled(
            fonts
              .filter((font) => bundled.includes(font.family))
              .slice(0, 4)
              .map(async (font) => {
                const bytes = await requestHostFont(font.id, abort.signal);
                if (active)
                  await install(
                    new FontFace(font.family, bytes, {
                      weight: String(font.weight),
                      style: font.style,
                      display: 'swap',
                    }),
                  );
              }),
          );
        })
        .catch(() => {}); // 老后台、未安装宿主或不支持的包格式不阻止设置页使用。
    }
    return () => {
      active = false;
      abort.abort();
      for (const face of installed) document.fonts.delete(face);
    };
  }, [family]);
}
