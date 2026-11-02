/* [INPUT]: Vite / React and this independent public page's source.
 * [OUTPUT]: Local-only development server and portable target/site static assets.
 * [POS]: Website build boundary; no settings API proxy or Rust embedded assets.
 * [PROTOCOL]: Keep website/AGENTS.md and package scripts in sync. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [
    react(),
    {
      name: 'website-licenses',
      apply: 'build',
      generateBundle() {
        const files = [
          ['Palboo — GPL-3.0-only', '../../LICENSE'],
          ['Palboo licensing scope', '../../LICENSING.md'],
          ['OpenAI apps-sdk-ui control icons — MIT', '../shared/icons/LICENSE'],
          ['GitHub Octicons — MIT; GitHub mark is a GitHub trademark', './media/LICENSE-octicons'],
          [
            'CodexHost Agent identification assets — provenance',
            '../settings/codex-host-assets/NOTICE.md',
          ],
          ['CodexHost assets — LGPL-3.0', '../settings/codex-host-assets/LICENSE'],
          [
            'CodexHost assets — incorporated GPL-3.0',
            '../settings/codex-host-assets/COPYING-GPL-3.0',
          ],
          ['i18next — MIT', '../../node_modules/i18next/LICENSE'],
          ['React — MIT', '../../node_modules/react/LICENSE'],
          ['React DOM — MIT', '../../node_modules/react-dom/LICENSE'],
          ['Scheduler — MIT', '../../node_modules/scheduler/LICENSE'],
          ['shadcn/ui adapted controls — MIT', '../settings/components/ui/LICENSE'],
          ['Radix Slot — MIT', '../../node_modules/@radix-ui/react-slot/LICENSE'],
          ['Radix Compose Refs — MIT', '../../node_modules/@radix-ui/react-compose-refs/LICENSE'],
          [
            'Class Variance Authority — Apache-2.0',
            '../../node_modules/class-variance-authority/LICENSE',
          ],
          ['clsx — MIT', '../../node_modules/clsx/license'],
          ['tailwind-merge — MIT', '../../node_modules/tailwind-merge/LICENSE.md'],
        ];
        const source = files
          .map(
            ([name, path]) => `${name}\n\n${readFileSync(new URL(path, import.meta.url), 'utf8')}`,
          )
          .join('\n\n----------------------------------------\n\n');
        this.emitFile({ type: 'asset', fileName: 'LICENSES.txt', source });
      },
    },
  ],
  cacheDir: fileURLToPath(new URL('../../target/vite-site', import.meta.url)),
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@': fileURLToPath(new URL('../settings', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 52152, strictPort: true },
  preview: { host: '127.0.0.1', port: 52153, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('../../target/site', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
