/* [INPUT]: Independent website document root.
 * [OUTPUT]: Product introduction; development optionally loads the preset comparison.
 * [POS]: Website entry, separate from settings and native application builds.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import './locale';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get('preview') === 'github-buttons'
) {
  void import('./button-presets').then(({ ButtonPresets }) => {
    root.render(
      <StrictMode>
        <ButtonPresets />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
