/* [INPUT]: Product content/styles and the website's semantic theme and typography.
 * [OUTPUT]: Shadow-isolated product components, using the same CSS as the application.
 * [POS]: Website mount only; no host discovery, transport or persistent settings.
 * [PROTOCOL]: Keep website/AGENTS.md in sync. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import surfaceStyles from '../surfaces/workspace/content.css?inline';
import { rememberDemoSurface } from './demo-focus';

const theme = `:host {
  display:block; height:auto; min-width:0; font:inherit; color-scheme:inherit;
  --paper:var(--demo-paper,var(--site-surface)); --surface:var(--paper); --ink:var(--demo-ink,var(--site-text));
  --muted:var(--demo-muted,var(--site-muted)); --line:var(--demo-line,var(--site-border)); --border:var(--line);
  --hover:var(--demo-hover,var(--site-input)); --accent:var(--site-accent); --danger:var(--site-error,#bd3939);
  --error:var(--danger); --board-bg:transparent;
  --csw-text:var(--ink); --csw-muted:var(--muted); --csw-divider:var(--line);
  --csw-hover:var(--hover); --csw-accent:var(--accent); --csw-surface-opaque:var(--paper);
  --csw-item-font:1em; --csw-next-font:1em; --csw-outline-font:1em;
  --feature-status-font:max(14px,.875em); --board-font-size:1em;
}
.site-product-body{min-width:0;color:var(--ink);font:inherit;line-height:1.5}
.site-product-body :is(input,textarea,select,[contenteditable="true"]){scroll-margin-block:16px}
.feature-projection{min-width:0}
.site-product-body > .feature-pane-head{height:28px}
.site-product-body .csw-next-layout{min-height:0;grid-template-rows:max-content minmax(120px,auto)}
.site-product-body .board-app.embedded{height:auto}
.site-product-body .board-main{padding:12px 0}
.site-product-body .board-grid{overflow:visible}
`;

export function DemoSurface({
  kind,
  styles = '',
  children,
}: {
  kind: string;
  styles?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [mount] = useState(() => {
    const node = document.createElement('div');
    node.className = 'site-product-body';
    return node;
  });
  useLayoutEffect(() => {
    const root = host.current!.shadowRoot || host.current!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${styles}\n${surfaceStyles}\n${theme}`;
    root.replaceChildren(style, mount);
    return () => root.replaceChildren();
  }, [mount, styles]);
  return (
    <div
      ref={host}
      className="site-real-feature"
      data-real-feature={kind}
      onFocusCapture={() => rememberDemoSurface(host.current!)}
    >
      {createPortal(children, mount)}
    </div>
  );
}
