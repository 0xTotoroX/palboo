/* [INPUT]: Bundled locale catalogs and presentation helpers with synthetic user data.
 * [OUTPUT]: Locale fallback, placeholder parity and persistent-data preservation checks.
 * [POS]: No network, host, real settings or user glossary access.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import messages from '../ui/shared/locales/en.js';
import websiteMessages from '../ui/website/locales/en.js';

const output = await build({
  stdin: {
    contents: `export * from './ui/shared/i18n.js';
      export * from './ui/features/model/catalog.ts';
      export * from './ui/settings/direction-copy.ts';`,
    resolveDir: process.cwd(),
  },
  platform: 'node',
  format: 'esm',
  bundle: true,
  write: false,
});
const {
  setLocale,
  getLocale,
  resolveLocale,
  subscribeLocale,
  tr,
  modelGroup,
  directionCopy,
  manufacturerValue,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);

test('catalogs preserve interpolation fields and do not leave authored Chinese in English copy', () => {
  const fields = (text) =>
    [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();
  for (const [source, english] of Object.entries({ ...messages, ...websiteMessages })) {
    assert.deepEqual(fields(english), fields(source), source);
    assert.ok(english.trim(), source);
    assert.doesNotMatch(english, /[\u3400-\u9fff]/, source);
  }
});

test('language changes update subscribers once and preserve unknown user text', () => {
  setLocale('zh-CN');
  let updates = 0;
  const stop = subscribeLocale(() => updates++);
  assert.equal(tr('下一步'), '下一步');
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(tr('下一步'), 'Next steps');
  assert.equal(tr('启用{{name}}', { name: 'My custom feature' }), 'Enable My custom feature');
  assert.equal(tr('我的私人词条・蓝鲸'), '我的私人词条・蓝鲸');
  setLocale('en');
  assert.equal(updates, 1);
  stop();
  setLocale('zh-CN');
  assert.equal(updates, 1);
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('zh-CN'), 'zh-CN');
  assert.ok(['en', 'zh-CN'].includes(resolveLocale('system')));
});

test('built-in display names translate without changing model group identities or user directions', () => {
  const prefs = { groups: [], modelOverrides: {}, pinned: [], presets: [] };
  const model = { id: 'qwen3', label: 'Qwen 3', reasoning: [] };
  setLocale('zh-CN');
  const saved = modelGroup(model, prefs);
  const direction = { id: 'advance', name: '整体推进', instruction: 'Original direction' };
  const originals = [{ ...direction }];
  const snapshot = JSON.stringify({ prefs, direction, originals });
  setLocale('en');
  const localized = modelGroup(model, prefs);
  assert.equal(localized.id, saved.id);
  assert.notEqual(localized.name, saved.name);
  assert.equal(manufacturerValue(localized.name), '阿里云');
  assert.notEqual(directionCopy(direction, originals), direction.name);
  assert.equal(directionCopy({ ...direction, name: '我的方向' }, originals), '我的方向');
  assert.equal(directionCopy({ ...direction, id: 'custom' }, originals), '整体推进');
  assert.equal(JSON.stringify({ prefs, direction, originals }), snapshot);
  setLocale('zh-CN');
});
