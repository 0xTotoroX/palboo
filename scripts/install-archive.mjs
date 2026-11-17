/* [INPUT]: Verified previous App and private backup destination on the same volume.
 * [OUTPUT]: Rename-only archive retaining the running image's native identity.
 * [POS]: Local install handoff; failure leaves the original in staging, never copy-and-delete.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync. */
import { mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function archiveApplication(previous, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  renameSync(previous, destination);
}
