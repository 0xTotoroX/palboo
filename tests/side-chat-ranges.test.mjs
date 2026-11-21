/* [INPUT]: Real side-chat modules and isolated synthetic native history/routing.
 * [OUTPUT]: Whole-chat promotion and per-answer cutoff/draft/identity/geometry regressions.
 * [POS]: No real user conversations, model calls or messages are sent.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sideChatFixture } from './side-chat-fixture.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});
const fixture = (options) => sideChatFixture(browser, options);
const settle = (page) => page.waitForFunction(() => !window.composerActionBusy());
const result = (page) =>
  page.evaluate(() => ({
    text: window.rawComposerText(document.querySelector('main .ProseMirror')),
    log: window.log.filter(([kind]) => kind !== 'dispose'),
    source: window.rawComposerText(document.querySelector('aside .ProseMirror')),
    status: document.querySelector('[data-palboo-side-chat=status]')?.textContent || '',
    recovery: !!window.__palbooSideChat.recovery(),
    side: window.meta.sideConversation,
    title: window.meta.title,
    fork: window.forkSource,
    independent: window.newMeta,
    cards: window.cards.map((card) => window.cardFiles[card.file.path]),
  }));
const noSend = (r) =>
  assert.equal(
    r.log.some(([kind]) => kind === 'send' || kind === 'optimize'),
    false,
  );

async function replies(page, keys = ['b-selected']) {
  await page.evaluate((keys) => {
    const texts = [
      ['z-first', 'opening question', 'opening answer'],
      ['b-selected', 'selected question', 'Repeated answer'],
      ['a-latest', 'excluded question', 'Repeated answer'],
    ];
    window.pages = [
      {
        data: texts.map(([id, q, a]) => ({
          id,
          itemsView: 'full',
          status: 'completed',
          items: [
            { type: 'userMessage', content: [{ type: 'text', text: q }] },
            { type: 'agentMessage', text: a },
          ],
        })),
        nextCursor: null,
      },
    ];
    window.cloudTurns = texts.map(([id, q, a]) => ({
      id,
      turn: {
        items: [
          { type: 'user-message', message: q, attachments: [], images: [] },
          { type: 'assistant-message', messageId: `answer-${id}`, content: a, completed: true },
        ],
      },
    }));
    const panel = document.querySelector('[role=tabpanel]');
    for (const key of keys) {
      const turn = document.createElement('div');
      turn.className = 'contents';
      turn.dataset.contentSearchTurnKey = key;
      turn.innerHTML =
        '<div class="group"><h4 class="sr-only" data-conversation-role="assistant">Assistant</h4><p>Repeated answer</p><div class="answer-actions" style="display:flex;gap:4px"><button class="native-reply" aria-label="Copy"></button><button class="native-reply" aria-label="Read aloud"></button><button class="native-reply" aria-label="Like"></button><button data-palboo-outline-reply="outline" aria-label="Outline"></button></div></div>';
      panel.prepend(turn);
    }
    window.__palbooSideChat.refresh();
  }, keys);
}
const clickReply = (page, mode) =>
  page.locator(`[data-palboo-side-chat=reply][data-side-action=${mode}]`).first().click();

test('whole local promotion opens an ordinary chat in the same project with a transcript card and exact draft', async () => {
  const page = await fixture({
    pastedCards: true,
    currentAttachment: true,
    staleSource: true,
    draft: '  local draft\n\n',
    destinationDraft: 'target saved draft',
  });
  try {
    await page.evaluate(() => void window.__palbooSideChat.makeIndependent());
    await settle(page);
    const r = await result(page);
    assert.equal(r.text, 'target saved draft\n\n  local draft\n\n');
    assert.equal(r.side, true);
    assert.equal(r.title, null);
    assert.deepEqual(r.fork, { parentId: 'parent', turnId: 'turn-1' });
    assert.equal(r.independent.title, 'first local question');
    assert.equal(r.independent.sideConversation, false);
    assert.deepEqual(r.log.find(([k]) => k === 'thread/start')[1], {
      cwd: '/fixture/project',
      projectId: 'project-a',
      ephemeral: false,
      historyMode: 'paginated',
      threadSource: 'user',
    });
    assert.equal(r.log.find(([k]) => k === 'navigate')[1], '/local/independent-a');
    assert.equal(r.cards.length, 1);
    assert.ok(r.cards[0].includes('first local answer'));
    assert.ok(!r.cards[0].includes('local draft'));
    assert.equal(r.source, '  local draft\n\n');
    assert.equal(r.recovery, false);
    noSend(r);
  } finally {
    await page.close();
  }
});

test('whole cloud side chat opens a visible-history main draft with all text and side draft', async () => {
  const page = await fixture({ cloud: true, destinationDraft: 'existing new draft' });
  try {
    await page.evaluate(() => void window.__palbooSideChat.makeIndependent());
    await settle(page);
    const r = await result(page);
    assert.ok(r.text.startsWith('existing new draft\n\n'));
    assert.ok(r.text.includes('first cloud answer'));
    assert.ok(r.text.endsWith('  unsent\n\nkeep $1 & <text>\n'));
    assert.deepEqual(r.log.find(([k]) => k === 'new-cloud').slice(1), [
      'new-cloud-id',
      { hideFromHistory: false, isDoNotRemember: false },
    ]);
    assert.equal(r.log.find(([k]) => k === 'navigate')[1], '/c/new-cloud-id');
    noSend(r);
  } finally {
    await page.close();
  }
});

test('an ambiguous parent editor stops independent promotion before renaming or closing the side tab', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      const extra = document.querySelector('main form').cloneNode(true);
      document.querySelector('main').append(extra);
      void window.__palbooSideChat.makeIndependent();
    });
    await settle(page);
    const r = await result(page);
    assert.equal(r.text, 'parent draft');
    assert.equal(r.side, true);
    assert.equal(
      r.log.some(([kind]) => ['thread/start', 'close', 'navigate'].includes(kind)),
      false,
    );
    assert.ok(r.status.includes('无法确认原主聊天输入框'));
  } finally {
    await page.close();
  }
});

test('cloud history refuses incomplete answers or ambiguous branch keys before creating a new chat', async () => {
  for (const duplicate of [false, true]) {
    const page = await fixture({ cloud: true });
    try {
      await replies(page);
      await page.evaluate((duplicate) => {
        if (duplicate) window.cloudTurns.push(window.cloudTurns[0]);
        else window.cloudTurns[1].turn.items[1].completed = false;
      }, duplicate);
      await clickReply(page, 'independent');
      await settle(page);
      const r = await result(page);
      assert.equal(r.text, 'parent draft');
      assert.equal(
        r.log.some(([kind]) => ['new-cloud', 'close', 'navigate'].includes(kind)),
        false,
      );
      assert.ok(r.status.includes('无法确认所选回答'));
    } finally {
      await page.close();
    }
  }
});

for (const cloud of [false, true])
  for (const mode of ['parent', 'independent']) {
    test(`${cloud ? 'cloud' : 'local'} ${mode} cutoff includes offscreen prefix, excludes later turns and current draft`, async () => {
      const page = await fixture({
        cloud,
        pastedCards: !cloud && mode === 'independent',
        currentAttachment: true,
        draft: 'EXCLUDED SIDE DRAFT',
        destinationDraft: cloud ? 'new saved draft' : '',
      });
      try {
        await replies(page);
        // The host's internal boundary is a raw model item, outside the rendered question/answer API.
        if (mode === 'independent' && !cloud)
          await page.evaluate(() =>
            window.pages[0].data[0].items.unshift({
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Side conversation boundary. Sub-agents are off-limits.',
                },
              ],
            }),
          );
        await clickReply(page, mode);
        await settle(page);
        const r = await result(page);
        assert.equal(r.source, 'EXCLUDED SIDE DRAFT');
        assert.equal(
          r.log.some(([k]) => ['close', 'reload'].includes(k)),
          false,
        );
        assert.equal(r.recovery, false);
        if (mode === 'independent' && !cloud) {
          assert.equal(r.log.find(([k]) => k === 'navigate')[1], '/local/independent-a');
          assert.equal(r.text, '');
          assert.equal(r.side, true);
          assert.equal(r.title, null);
          assert.equal(r.cards.length, 1);
          assert.ok(r.cards[0].includes('opening question'));
          assert.ok(r.cards[0].includes('selected question'));
          assert.equal((r.cards[0].match(/Repeated answer/g) || []).length, 1);
          assert.ok(!r.cards[0].includes('excluded question'));
          assert.ok(!r.cards[0].includes('EXCLUDED SIDE DRAFT'));
          assert.ok(!r.cards[0].includes('Side conversation boundary.'));
          assert.deepEqual(r.independent.turns, []);
        } else {
          assert.ok(
            r.text.startsWith(mode === 'parent' ? 'parent draft\n\n' : 'new saved draft\n\n'),
          );
          assert.ok(r.text.includes('opening question'));
          assert.ok(r.text.includes('opening answer'));
          assert.ok(r.text.includes('selected question'));
          assert.equal((r.text.match(/Repeated answer/g) || []).length, 1);
          assert.equal(r.text.includes('excluded question'), false);
          assert.equal(r.text.includes('EXCLUDED SIDE DRAFT'), false);
          assert.equal(r.text.includes('侧聊未发送草稿：'), false);
        }
        noSend(r);
      } finally {
        await page.close();
      }
    });
  }

test('native reply controls align beside Outline, use distinct icons and disappear outside the side chat', async () => {
  const page = await fixture({ locale: 'en' });
  try {
    await replies(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.evaluate(() => {
      document.querySelector('aside').style.width = '260px';
      window.installOptimizer();
    });
    const controls = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-palboo-side-chat=reply]')];
      return nodes.map((n) => ({
        icon: n.querySelector('svg').dataset.icon,
        label: n.getAttribute('aria-label'),
        title: n.title,
        x: n.getBoundingClientRect().x,
        y: n.getBoundingClientRect().y,
        w: n.getBoundingClientRect().width,
        h: n.getBoundingClientRect().height,
        svg: n.querySelector('svg').getBoundingClientRect().width,
      }));
    });
    assert.equal(new Set(controls.map((c) => c.icon)).size, 2);
    assert.equal(await page.locator('form [data-palboo-side-chat]').count(), 0);
    assert.equal(await page.locator('span[data-palboo-prompt]').count(), 1);
    for (const c of controls) {
      assert.ok(c.w >= 28 && c.h >= 28);
      assert.equal(c.svg, 18);
      assert.equal(c.title, c.label);
      assert.equal(c.y, controls[0].y);
    }
    const sorted = [...controls].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++)
      assert.ok(sorted[i].x >= sorted[i - 1].x + sorted[i - 1].w);
    const actions = page.locator('[data-palboo-side-chat=reply]');
    assert.equal(await actions.count(), 2);
    assert.equal(
      await actions.first().getAttribute('title'),
      'Bring to original chat through this reply',
    );
    assert.equal(
      await actions.last().getAttribute('title'),
      'Create independent chat through this reply',
    );
    assert.ok(
      await actions
        .first()
        .evaluate((n) => n.parentElement.querySelector('[data-palboo-outline-reply]') !== null),
    );
    await actions.first().focus();
    await page.keyboard.press('Tab');
    assert.ok(await actions.last().evaluate((n) => n === document.activeElement));
    await page.evaluate(() => {
      document.querySelector('aside').hidden = true;
      window.__palbooSideChat.refresh();
    });
    assert.equal(await actions.count(), 0);
    assert.equal(await page.locator('[data-palboo-side-chat=true]').count(), 0);
  } finally {
    await page.close();
  }
});

test('changed answer identity, changed prefix, missing or duplicate cutoff cannot append or create a chat', async () => {
  for (const variant of ['answer-edit', 'prefix-edit', 'missing', 'duplicate', 'unknown-key']) {
    const page = await fixture();
    try {
      await replies(page, variant === 'unknown-key' ? ['turn-index-1'] : ['b-selected']);
      await page.evaluate((variant) => {
        if (variant === 'missing') window.pages[0].data.splice(1, 1);
        if (variant === 'duplicate') window.pages[0].data.push(window.pages[0].data[1]);
        let reads = 0;
        window.hooks.history = () => {
          reads++;
          if (variant === 'answer-edit')
            document.querySelector('aside .group p').textContent = 'regenerated';
          if (variant === 'prefix-edit' && reads === 2)
            window.pages[0].data[0].items[1].text = 'changed prefix';
        };
      }, variant);
      await clickReply(page, 'independent');
      await settle(page);
      const r = await result(page);
      assert.equal(r.text, 'parent draft', variant);
      assert.equal(
        r.log.some(([k]) => ['thread/start', 'navigate', 'close'].includes(k)),
        false,
        variant,
      );
      assert.ok(r.status, variant);
      noSend(r);
    } finally {
      await page.close();
    }
  }
});

test('an inherited thread is rejected before navigation and preserves source and recovery', async () => {
  const page = await fixture();
  try {
    await replies(page);
    await page.evaluate(() => {
      window.startOverrides = { forkedFromId: 'side-a' };
    });
    await clickReply(page, 'independent');
    await settle(page);
    const r = await result(page);
    assert.equal(r.text, 'parent draft');
    assert.equal(r.side, true);
    assert.equal(r.recovery, true);
    assert.ok(r.status.includes('独立聊天未完整准备'));
    assert.equal(
      r.log.some(([k]) => ['navigate', 'close'].includes(k)),
      false,
    );
    noSend(r);
  } finally {
    await page.close();
  }
});

test('cloud plain-div turns and repeated markdown sub-keys resolve one answer; historical range leaves rich side drafts untouched', async () => {
  const page = await fixture({ cloud: true });
  try {
    await replies(page);
    await page.evaluate(() => {
      const turn = document.querySelector('aside [data-content-search-turn-key]');
      turn.className = '';
      const p = turn.querySelector('p');
      p.dataset.contentSearchTurnKey = 'b-selected';
      document.querySelector('aside .ProseMirror').innerHTML =
        '<p>keep <span contenteditable="false" data-mention="file">file reference</span></p>';
      window.__palbooSideChat.refresh();
    });
    assert.equal(await page.locator('[data-palboo-side-chat=reply]').count(), 2);
    await clickReply(page, 'parent');
    await settle(page);
    const r = await result(page);
    assert.ok(r.text.includes('selected question'));
    assert.equal(r.text.includes('file reference'), false);
    assert.equal(await page.locator('aside [data-mention]').count(), 1);
    assert.equal(r.recovery, false);
  } finally {
    await page.close();
  }
});

test('promotion stops on failed naming or source change; all side actions share the optimizer lock', async () => {
  for (const variant of ['title', 'source', 'optimizer']) {
    const page = await fixture();
    try {
      await replies(page);
      await page.evaluate((variant) => {
        if (variant === 'title')
          window.hooks.rename = () => {
            throw Error('Naming failed');
          };
        if (variant === 'source')
          window.hooks.rename = () => {
            document.querySelector('aside .ProseMirror').textContent = 'new draft';
          };
        if (variant === 'optimizer') {
          window.installOptimizer();
          window.promptButton.click();
        }
        void window.__palbooSideChat.makeIndependent();
      }, variant);
      if (variant === 'optimizer') {
        assert.equal(await page.locator('[data-palboo-side-chat=reply]:disabled').count(), 2);
        await page.evaluate(() => window.promptButton.click());
      }
      await settle(page);
      const r = await result(page);
      assert.equal(
        r.log.some(([k]) => ['close', 'navigate'].includes(k)),
        false,
      );
      assert.equal(r.text, 'parent draft');
    } finally {
      await page.close();
    }
  }
});
