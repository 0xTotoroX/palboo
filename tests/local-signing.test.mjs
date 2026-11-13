/* [INPUT]: Synthetic security/codesign identity listings.
 * [OUTPUT]: Stable signer selection and refusal to silently change installed identity.
 * [POS]: Local installation regression; no keychain modification or signing operation.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLocalSigner } from '../scripts/local-signing.mjs';

const first = '1'.repeat(40),
  second = '2'.repeat(40);
const one = `  1) ${first} "Apple Development: Fixture (TEAM1)"\n  1 valid identities found`;
const two = one + `\n  2) ${second} "Developer ID Application: Other (TEAM2)"`;
test('local installation uses the single certificate and retains it across updates', () => {
  assert.equal(chooseLocalSigner(one, 'Signature=adhoc\nTeamIdentifier=not set'), first);
  assert.equal(chooseLocalSigner(two, 'Authority=Apple Development: Fixture (TEAM1)'), first);
  assert.equal(chooseLocalSigner('', 'Signature=adhoc'), '-');
});
test('missing or ambiguous signing identity cannot silently reset authorization', () => {
  assert.throws(() => chooseLocalSigner(two), /多个/);
  assert.throws(
    () => chooseLocalSigner('', 'Authority=Apple Development: Fixture (TEAM1)'),
    /原 Palboo/,
  );
  assert.throws(
    () => chooseLocalSigner(one, 'Authority=Developer ID Application: Other (TEAM2)'),
    /原 Palboo/,
  );
  assert.throws(
    () => chooseLocalSigner(one + one, 'Authority=Apple Development: Fixture (TEAM1)'),
    /唯一/,
  );
});
