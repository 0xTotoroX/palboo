/* [INPUT]: React external-store subscription and the shared locale.
 * [OUTPUT]: Reactive language changes without remounting forms or losing drafts.
 * [POS]: React adapter for shared/i18n.js.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from './i18n.js';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
