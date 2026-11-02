/* [INPUT]: Revisioned local website preferences and independently authorized folders.
 * [OUTPUT]: Shared sites/configuration contracts; no note bodies or access credentials.
 * [POS]: Settings and feature presentation boundary.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export type Site = { id: string; name: string; url: string };
export type NoteFolder = { id: string; name: string; path: string; attachments: string[] };
export type FolderSummary = Pick<NoteFolder, 'id' | 'name'>;
export type WebLibrary = {
  revision: number;
  enabled: boolean;
  vault: string | null;
  attachments: string[];
  folders?: NoteFolder[];
  sites: Site[];
  vaults?: string[];
  presentationError?: string;
};
export type SiteState = {
  enabled: boolean;
  configured: boolean;
  sites: Site[];
  folders?: FolderSummary[];
};
