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
          ['React — MIT', '../../node_modules/react/LICENSE'],
          ['React DOM — MIT', '../../node_modules/react-dom/LICENSE'],
          ['Scheduler — MIT', '../../node_modules/scheduler/LICENSE'],
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
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 52152, strictPort: true },
  preview: { host: '127.0.0.1', port: 52153, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('../../target/site', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
