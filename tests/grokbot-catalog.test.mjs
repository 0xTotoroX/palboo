/* [INPUT]: Synthetic account/roster cache fixtures, never real accounts or transcripts.
 * [OUTPUT]: Dynamic additions, rename, account isolation, staleness and schema rejection.
 * [POS]: PALBOO catalog adapter tests. [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheFile, readCatalog } from '../scripts/grokbot-adapter/catalog.mjs';
const slotKey = 'sand.client.slice.client-meta.account-slot';
const rosterKey = (slot) =>
  `sand.client.slice.account.${encodeURIComponent(slot)}.roster.last-roster`;
const row = (n, name) => ({
  id: `${n}0000000-0000-0000-0000-000000000000`,
  name,
  harness: 'temporal',
  avatarShape: 'cloud',
  avatarColor: 'violet',
  lastEntry: { text: 'SYNTHETIC'.repeat(100) },
  description: 'Synthetic description',
  path: 'PRIVATE_PATH',
  accessToken: 'SECRET',
});
test('catalog updates without fixed names, keeps identity revision stable for metadata changes and isolates accounts', () => {
  const root = mkdtempSync(join(tmpdir(), 'palboo-catalog-'));
  const put = (key, schemaVersion, value) =>
    writeFileSync(join(root, cacheFile(key)), JSON.stringify({ schemaVersion, value }));
  try {
    put(slotKey, 1, 'test|account-a');
    put(rosterKey('test|account-a'), 4, { rows: [row(1, 'Bot A')] });
    const first = readCatalog({ root, running: true });
    assert.equal(first.bots.length, 1);
    assert.equal(first.bots[0].preview.length, 240);
    assert.doesNotMatch(JSON.stringify(first), /PRIVATE_PATH|SECRET|test\|account/);
    put(rosterKey('test|account-a'), 4, { rows: [row(1, 'Bot A'), row(2, 'New Bot')] });
    const second = readCatalog({ root, running: true });
    assert.equal(second.bots[1].name, 'New Bot');
    assert.notEqual(first.revision, second.revision);
    put(rosterKey('test|account-a'), 4, {
      rows: [{ ...row(2, 'New Bot'), avatarColor: 'green' }, row(1, 'Bot A')],
    });
    assert.equal(readCatalog({ root, running: true }).revision, second.revision);
    put(rosterKey('test|account-a'), 4, { rows: [row(1, 'Renamed'), row(2, 'renamed')] });
    assert.ok(readCatalog({ root, running: true }).bots.every((b) => !b.available));
    const file = join(root, cacheFile(rosterKey('test|account-a')));
    utimesSync(file, new Date(0), new Date(0));
    assert.equal(readCatalog({ root, running: true }).stale, true);
    put(slotKey, 1, 'test|account-b');
    assert.throws(() => readCatalog({ root, running: true }));
    put(rosterKey('test|account-b'), 4, { rows: [] });
    const other = readCatalog({ root, running: true });
    assert.notEqual(other.account, first.account);
    assert.deepEqual(other.bots, []);
    put(rosterKey('test|account-b'), 99, { rows: [row(1, 'Bot A')] });
    assert.throws(() => readCatalog({ root, running: true }), /格式/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
