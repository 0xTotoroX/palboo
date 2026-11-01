/* [INPUT]: Actual read-only CDP expression and synthetic upstream v2 Agent menus.
 * [OUTPUT]: Current target isolation, real labels/groups/availability and fail-closed snapshots.
 * [POS]: No live ChatGPT, external Agent, installation or saved configuration.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const source = readFileSync(new URL('../ui/codex/codex-host-preview.js', import.meta.url), 'utf8');
test('Agent preview reads the mounted menu and probe without opening, selecting or installing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<section><textarea id="input-a">private draft</textarea><div data-codexhost-agent-control="a"></div></section>
<section><textarea id="input-b"></textarea><div data-codexhost-agent-control="b"></div></section>
<div id="a-agent-menu" role="menu" hidden>
 <div><div><button data-agent="codex" role="menuitemradio" aria-checked="false" disabled><img><span>Codex</span></button></div>
 <div><button data-agent="custom-agent" role="menuitemradio" aria-checked="true" disabled><img><span>我的 Agent</span></button></div></div>
 <button>更多 Agent</button><div style="display:none"><div>
 <div><button data-agent="pi" role="menuitemradio" disabled><img><span>Pi</span></button><span><button data-mode="install">+</button></span></div>
 <div><button data-agent="grok" role="menuitemradio" disabled><img><span>Grok</span></button><span><button data-mode="error">!</button></span></div>
 <div><button data-agent="checking" role="menuitemradio" disabled><img><span>检查中的 Agent</span></button><span><button data-mode="install" disabled style="visibility:hidden">+</button></span></div>
 </div></div>
</div><div id="b-agent-menu" role="menu"><div><div><button data-agent="codex" role="menuitemradio" aria-checked="true"><span>另一窗口 Codex</span></button></div></div></div>`);
    await page.evaluate(() => {
      window.calls = [];
      document.addEventListener('click', () => window.calls.push('click'));
      window.fetch = () => {
        window.calls.push('fetch');
        throw Error('not allowed');
      };
      window.fixture = {
        version: 2,
        enabledAgents: ['codex', 'pi', 'grok', 'custom-agent', 'checking'],
        availability: {
          pi: 'notInstalled',
          grok: 'error',
          'custom-agent': 'ready',
          checking: 'checking',
        },
        selections: [
          { composerId: 'a', agent: 'custom-agent' },
          { composerId: 'b', agent: 'codex' },
        ],
      };
      window.__codexhostRendererBindingProbeV1 = { status: () => structuredClone(window.fixture) };
      window.__palbooModelControl = {
        inputTarget: () => ({ composer: document.getElementById('input-a') }),
      };
    });
    const result = await page.evaluate(source);
    assert.equal(result.status, 'ready');
    assert.equal(result.current, 'custom-agent');
    assert.deepEqual(
      result.agents.map(({ id, label, group }) => [id, label, group]),
      [
        ['codex', 'Codex', 'main'],
        ['custom-agent', '我的 Agent', 'main'],
        ['pi', 'Pi', 'more'],
        ['grok', 'Grok', 'more'],
        ['checking', '检查中的 Agent', 'more'],
      ],
    );
    assert.deepEqual(
      result.agents.map(({ available, canAdd, availability }) => [available, canAdd, availability]),
      [
        [true, false, 'ready'],
        [true, false, 'ready'],
        [false, true, 'notInstalled'],
        [false, false, 'error'],
        [false, false, 'checking'],
      ],
    );
    assert.ok(!JSON.stringify(result).includes('private draft'));
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    assert.equal(await page.locator('#a-agent-menu').isVisible(), false);

    // Ambiguous or stale input ownership must not borrow another composer's current Agent.
    await page.evaluate(() => {
      window.__palbooModelControl.inputTarget = () => null;
    });
    assert.equal((await page.evaluate(source)).status, 'unavailable');
    await page.evaluate(() => {
      document.querySelector('[data-codexhost-agent-control="a"]').style.cssText =
        'width:24px;height:24px';
      document.querySelector('[data-codexhost-agent-control="b"]').hidden = true;
    });
    assert.equal(
      (await page.evaluate(source)).current,
      'custom-agent',
      'settings foreground can use the only visible Agent control',
    );
    await page.evaluate(() => {
      document.querySelector('[data-codexhost-agent-control="a"]').hidden = true;
    });
    await page.evaluate(() => {
      window.fixture.selections = [{ composerId: 'a', agent: 'custom-agent' }];
    });
    assert.equal(
      (await page.evaluate(source)).current,
      'custom-agent',
      'one confirmed composer remains readable while settings is foreground',
    );
    await page.evaluate(() => {
      window.fixture.selections[0].agent = 'codex';
    });
    assert.equal(
      (await page.evaluate(source)).status,
      'unavailable',
      'mismatched menu/probe cannot display a mixed snapshot',
    );
    await page.evaluate(() => {
      window.fixture.version = 3;
    });
    assert.equal((await page.evaluate(source)).status, 'unavailable');
    await page.evaluate(() => {
      window.__codexhostRendererBindingProbeV1.status = () => {
        throw Error('fixture');
      };
    });
    assert.deepEqual((await page.evaluate(source)).agents, []);
    await page.evaluate(() => {
      delete window.__codexhostRendererBindingProbeV1;
    });
    assert.deepEqual((await page.evaluate(source)).agents, []);
    assert.deepEqual(await page.evaluate(() => window.calls), []);
  } finally {
    await browser.close();
  }
});
