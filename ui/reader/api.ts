/* [INPUT]: Fragment reader credential on a separate loopback origin.
 * [OUTPUT]: Cancellable read-only JSON/image requests; credential is never read from Palboo settings storage.
 * [POS]: Reader transport; URL credentials are removed before rendering any note.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { tr } from '../shared/i18n.js';
const params = new URLSearchParams(location.hash.slice(1));
const incoming = params.get('reader');
let credential = incoming || '';
try {
  credential ||= sessionStorage.getItem('palboo-reader') || '';
  if (incoming) sessionStorage.setItem('palboo-reader', incoming);
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
  const response = await fetch(
    `/api/${operation}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
    {
      headers: { Authorization: `Bearer ${credential}` },
      signal,
      cache: 'no-store',
      credentials: 'omit',
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw Error(tr(failure?.message || '读取失败，请重试'));
  }
  return response;
}
export type Summary = { id: string; title: string };
export type Catalog = {
  name: string;
  revision: number;
  skipped: number;
  notes: Summary[];
  appearance?: import('../shared/contracts').HostSettingsAppearance;
  language?: string;
  systemLanguage?: string;
};
export type Note = Summary & { markdown: string; backlinks: Summary[] };
export type Search = { total: number; offset: number; results: (Summary & { snippet: string })[] };
