/* [INPUT]: A saved direction and the backend's immutable built-in catalog.
 * [OUTPUT]: Localized defaults only; user edits and saved values remain untouched.
 * [POS]: Settings presentation shared by the picker, selected list and library. */
import type { Direction } from '../shared/contracts';
import { tr } from '../shared/i18n.js';
export function directionCopy(
  item: Direction | undefined,
  originals: readonly Partial<Direction>[],
  field: 'name' | 'instruction' = 'name',
): string {
  if (!item) return '';
  const original = originals.find((value) => value.id === item.id);
  const value = item[field];
  return original?.[field] === value ? tr(value) : value;
}
