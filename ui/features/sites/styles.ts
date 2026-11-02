/* [INPUT]: Host semantic colors and the shared SitesView structure.
 * [OUTPUT]: Scoped compact launch-list styles for workspace and rail popover.
 * [POS]: Text CSS for existing injected and standalone React mounts.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export const sitesStyles = `.sites-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.sites-view input {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--csw-divider, var(--line));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
}
.sites-view ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sites-view .sites-name {
  flex: 1;
  min-width: 0;
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sites-view li > button {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  width: 100%;
  min-height: 36px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  text-align: left;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.sites-view button:hover {
  background: var(--csw-hover, var(--hover));
}
.sites-view button:disabled {
  opacity: 0.45;
  cursor: default;
}
.sites-view button span {
  overflow-wrap: anywhere;
}
.sites-view button svg {
  flex: none;
}
.sites-view p {
  margin: 0;
  font-size: 0.875em;
  color: var(--csw-muted, var(--muted));
}
`;
