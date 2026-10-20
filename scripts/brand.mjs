/*
 * [INPUT]: Current/legacy environment names and a selected source checkout.
 * [OUTPUT]: PALBOO-first environment with aliases for older worktrees.
 * [POS]: Script entry compatibility; no settings or credential files are modified.
 * [PROTOCOL]: Keep scripts/AGENTS.md in sync.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function compatibleEnvironment(input) {
  const result = { ...input };
  for (const [name, value] of Object.entries(input))
    if (name.startsWith('CODEX_BUDDY_')) {
      const current = `PALBOO_${name.slice('CODEX_BUDDY_'.length)}`;
      if (result[current] === undefined) result[current] = value;
    }
  for (const [name, value] of Object.entries(result))
    if (name.startsWith('PALBOO_')) result[`CODEX_BUDDY_${name.slice('PALBOO_'.length)}`] = value;
  return result;
}

export function sourceBinaryName(root) {
  try {
    if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'codex-buddy')
      return 'codex-buddy';
  } catch {
    // Source validation reports missing metadata; synthetic fixtures use PALBOO.
  }
  return 'palboo';
}

Object.assign(process.env, compatibleEnvironment(process.env));
