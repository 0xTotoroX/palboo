/* [INPUT]: A storage object containing this product's old preference keys.
 * [OUTPUT]: One-time Palboo keys; current choices win and legacy values remain recoverable.
 * [POS]: Identity migration only; values are copied verbatim and never sent to a service.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
export function migrateBrandStorage(storage) {
  const marker = 'palboo-storage-migrated-v1';
  try {
    if (storage.getItem(marker)) return;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith('codex-buddy')) continue;
      const current = key.replaceAll('codex-buddy', 'palboo');
      if (storage.getItem(current) === null) {
        const value = storage.getItem(key);
        if (value !== null) storage.setItem(current, value);
      }
    }
    storage.setItem(marker, '1');
  } catch {
    // Restricted storage must not prevent the application from opening.
  }
}

export function migrateBrowserBrandStorage() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      migrateBrandStorage(window[name]);
    } catch {
      // Access to the storage object itself can be blocked.
    }
  }
}
