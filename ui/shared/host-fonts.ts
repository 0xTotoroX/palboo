/* [INPUT]: Effective font-family and a window-local authenticated font source.
 * [OUTPUT]: On-demand local aliases/App font faces; stable across state polling, cancelled on replacement/disposal.
 * [POS]: Document font resource lifecycle shared by settings and native surfaces; no preference or layout writes.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
export interface HostFont {
  id: string;
  family: string;
  weight: number;
  style: string;
}
export interface HostFontSource {
  list(signal: AbortSignal): Promise<{ fonts: HostFont[] }>;
  read(id: string, signal: AbortSignal): Promise<ArrayBuffer>;
}

export function createHostFontSync(source: HostFontSource) {
  const resources = new Map<string, () => void>();
  let destroyed = false;
  return {
    update(family?: string) {
      if (destroyed || typeof FontFace === 'undefined' || !document.fonts) return;
      const aliases = [...(family || '').matchAll(/"(Codex selected (?:[^"\\]|\\.)+)"/g)]
        .slice(0, 3)
        .map((match) => match[1].replace(/\\(.)/g, '$1'))
        .filter((alias) => alias.length > 'Codex selected '.length && alias.length <= 215);
      const families = (family || '')
        .split(',')
        .map((name) => name.trim().replace(/^["']|["']$/g, ''));
      const bundled = ['OpenAI Sans', 'OpenAI Serif'].filter((name) => families.includes(name));
      const wanted = new Set([...aliases, ...bundled]);
      for (const [key, dispose] of resources) {
        if (wanted.has(key)) continue;
        dispose();
        resources.delete(key);
      }
      for (const name of wanted) {
        if (resources.has(name)) continue;
        let active = true;
        const abort = new AbortController();
        const installed: FontFace[] = [];
        resources.set(name, () => {
          active = false;
          abort.abort();
          for (const face of installed) document.fonts.delete(face);
        });
        const install = async (face: FontFace) => {
          await face.load();
          if (!active) return;
          document.fonts.add(face);
          installed.push(face);
        };
        // Retain unchanged fallback faces when only the selected local font changes.
        if (name.startsWith('Codex selected ')) {
          try {
            void install(
              new FontFace(name, `local(${JSON.stringify(name.slice('Codex selected '.length))})`),
            ).catch(() => {});
          } catch {
            // Missing/unsupported local faces retain the existing CSS fallback chain.
          }
        } else {
          void source
            .list(abort.signal)
            .then(async ({ fonts }) => {
              if (!active) return;
              await Promise.allSettled(
                fonts
                  .filter((font) => font.family === name)
                  .slice(0, 4)
                  .map(async (font) => {
                    const bytes = await source.read(font.id, abort.signal);
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
            .catch(() => {}); // An unavailable package never blocks the window or its content.
        }
      }
    },
    destroy() {
      destroyed = true;
      for (const dispose of resources.values()) dispose();
      resources.clear();
    },
  };
}
