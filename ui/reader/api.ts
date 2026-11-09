/* [INPUT]: Fragment reader credential on a separate loopback origin.
 * [OUTPUT]: Folder-scoped JSON/image reads, layout preferences and same-origin edits; each tab retains its own folder credential.
 * [POS]: Reader transport; URL credentials are removed before rendering any note.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
const params = new URLSearchParams(location.hash.slice(1));
export const folderId = new URLSearchParams(location.search).get('folder') || '';
const credentialKey = folderId ? `palboo-reader:${folderId}` : 'palboo-reader';
const incoming = params.get('reader');
let credential = incoming || '';
try {
  credential ||= sessionStorage.getItem(credentialKey) || '';
  if (incoming) sessionStorage.setItem(credentialKey, incoming);
} catch {
  /* Memory-only access remains available. */
}
if (incoming) history.replaceState(null, '', location.pathname + location.search);
export async function read<T>(
  operation: string,
  params: Record<string, string | number | boolean> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await raw(operation, params, signal);
  return response.json();
}
export async function raw(
  operation: string,
  params: Record<string, string | number | boolean>,
  signal?: AbortSignal,
) {
  return request(
    `/api/${operation}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
    { signal },
  );
}
export class ReaderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request(url: string, options: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(folderId ? { 'X-Palboo-Folder': folderId } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ReaderError(tr('本地服务暂时断开，请重试；若仍无法连接，请从 Palboo 重新打开'), 0);
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new ReaderError(tr(failure?.message || '读取失败，请重试'), response.status);
  }
  return response;
}
export async function write<T>(operation: string, body: unknown): Promise<T> {
  return (
    await request(`/api/${operation}`, { method: 'POST', body: JSON.stringify(body) })
  ).json();
}
export type Summary = { id: string; title: string; kind?: 'markdown' | 'spreadsheet' };
export type Catalog = {
  folder?: string;
  folders?: import('../shared/web-library').FolderSummary[];
  name: string;
  revision: number;
  skipped: number;
  notes: Summary[];
  appearance?: import('../shared/contracts').HostSettingsAppearance;
  language?: string;
  systemLanguage?: string;
};
export type Note = Summary & { markdown: string; backlinks: Summary[]; version: string };
export type Search = { total: number; offset: number; results: (Summary & { snippet: string })[] };

export type LinkPreview = {
  candidates: Summary[];
  total: number;
  anchor: string;
  excerpt: string | null;
};

export async function savePreferences(value: Record<string, number | boolean>) {
  const response = await request('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  return response.json();
}
