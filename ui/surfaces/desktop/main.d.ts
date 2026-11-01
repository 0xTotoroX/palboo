/* [INPUT]: Shared authenticated feature/font contracts. [OUTPUT]: Desktop entry declaration.
 * [POS]: Types for main.js; no runtime implementation. [PROTOCOL]: Keep desktop/AGENTS.md in sync. */
import type { Request } from '../../shared/features';
import type { HostFontSource } from '../../shared/host-fonts';
export function startDesktop(request: Request, lease: string, fontSource?: HostFontSource): void;
