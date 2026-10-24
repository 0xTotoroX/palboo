/* [INPUT]: Independent website document root.
 * [OUTPUT]: Product introduction; no host connections or business data access.
 * [POS]: Website entry, separate from settings and native application builds.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
