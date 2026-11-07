/* [INPUT]: Real side-chat controller/native adapter, synthetic managed files and composer state.
 * [OUTPUT]: Native text-card append, readable snapshots, range, concurrency and rollback regressions.
 * [POS]: Isolated Chromium; no real files, user drafts or messages are changed.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sideChatFixture, showSideReply } from './side-chat-fixture.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});
const fixture = (options) => sideChatFixture(browser, { pastedCards: true, ...options });
const click = (page) => page.evaluate(() => void window.__palbooSideChat.bringToParent());
const settled = (page) => page.waitForFunction(() => !window.composerActionBusy());
const result = (page) =>
  page.evaluate(() => ({
    draft: window.rawComposerText(document.querySelector('main .ProseMirror')),
    source: window.rawComposerText(document.querySelector('aside .ProseMirror')),
    cards: window.cards,
    files: window.cardFiles,
    log: window.log,
    recovery: !!window.__palbooSideChat?.recovery(),
    status: document.querySelector('[data-palboo-side-chat=status]')?.textContent || '',
  }));
const noSend = (r) =>
  assert.equal(
    r.log.some(([kind]) =>
      ['send', 'optimize', 'navigate', 'close', 'rename', 'new-cloud'].includes(kind),
    ),
    false,
  );

test('local snapshot becomes one native file card; exact draft, rich references and existing cards survive', async () => {
  const page = await fixture({ title: 'Project notes' });
  try {
    const before = await page.evaluate(() => {
      const main = document.querySelector('main .ProseMirror');
      main.innerHTML =
        '<p>  existing draft</p><p><br></p><p><span contenteditable="false" data-mention="file">file reference</span> keep\n</p>';
      window.originalDraft = main.innerHTML;
      window.originalCard = {
        file: { path: '/fixture/original.txt' },
        hostId: 'local',
        preview: 'existing file',
      };
      window.cards = [window.originalCard];
      window.cardFiles['/fixture/original.txt'] = 'existing attachment';
      return {
        html: main.innerHTML,
        source: window.rawComposerText(document.querySelector('aside .ProseMirror')),
      };
    });
    await click(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.cards.length, 2);
    assert.equal(r.cards[1].preview, '侧聊记录 · Project notes');
    assert.equal(r.cards[1].file.label, '侧聊记录.md');
    const text = r.files[r.cards[1].file.path];
    assert.ok(
      text.includes(
        '## 第 1 轮\n\n### 用户\n\nfirst local question\n\n### 助手\n\nfirst local answer',
      ),
    );
    assert.ok(text.endsWith('## 侧聊未发送草稿：\n\n' + before.source));
    assert.equal(r.cards[1].characterCount, text.length);
    assert.equal(r.files['/fixture/original.txt'], 'existing attachment');
    assert.equal(r.source, before.source);
    assert.equal(r.recovery, false);
    assert.equal(await page.locator('main .ProseMirror').innerHTML(), before.html);
    assert.equal(await page.evaluate(() => window.cards[0] === window.originalCard), true);
    assert.equal(await page.locator('aside').isVisible(), false);
    noSend(r);

    // Reopening and repeating the same frozen range cannot create another card or file.
    await page.evaluate(() => {
      document.querySelector('aside').hidden = false;
      window.__palbooSideChat.refresh();
    });
    await click(page);
    await settled(page);
    const again = await result(page);
    assert.deepEqual(again.cards, r.cards);
    assert.equal(again.log.filter(([kind]) => kind === 'create-card-file').length, 1);
    assert.equal(await page.locator('main .ProseMirror').innerHTML(), before.html);
  } finally {
    await page.close();
  }
});

test('snapshot format keeps raw code, quotes and line breaks in both languages instead of JSON escapes', async () => {
  const page = await fixture();
  try {
    for (const locale of ['zh-CN', 'en']) {
      const text = await page.evaluate((locale) => {
        window.setLocale(locale);
        return window.side.handoffText({
          title: 'Notes',
          draft: '  draft\n\n',
          turns: [
            {
              user: 'A "quoted" question\n\nsecond paragraph',
              assistant: '```js\nconst value = "text";\n```\n\nanswer',
            },
            { user: 'next question', assistant: 'next answer' },
          ],
        });
      }, locale);
      assert.ok(text.includes('A "quoted" question\n\nsecond paragraph'));
      assert.ok(text.includes('```js\nconst value = "text";\n```'));
      assert.ok(!text.includes('\\n'));
      assert.ok(!text.includes('"turns":'));
      assert.ok(text.indexOf('second paragraph') < text.indexOf('next question'));
      assert.ok(
        text.includes(locale === 'en' ? '## Turn 2\n\n### User' : '## 第 2 轮\n\n### 用户'),
      );
      assert.ok(text.endsWith('  draft\n\n'));
    }
  } finally {
    await page.close();
  }
});

test('historical card includes offscreen prefix through the selected answer and excludes later records and current draft', async () => {
  const page = await fixture({ locale: 'en', title: 'History', draft: 'EXCLUDED DRAFT' });
  try {
    await page.evaluate(() => {
      window.pages = [
        {
          data: ['first', 'selected', 'later'].map((name) => ({
            id: name,
            itemsView: 'full',
            status: 'completed',
            items: [
              { type: 'userMessage', content: [{ type: 'text', text: `${name} question` }] },
              { type: 'agentMessage', text: `${name} answer` },
            ],
          })),
          nextCursor: null,
        },
      ];
      document
        .querySelector('[role=tabpanel]')
        .insertAdjacentHTML(
          'afterbegin',
          '<div class="contents" data-content-search-turn-key="selected"><div class="group"><h4 class="sr-only" data-conversation-role="assistant">Assistant</h4><p>selected answer</p><div class="answer-actions" style="display:flex"><button aria-label="Copy"></button><button aria-label="Read aloud"></button><button aria-label="Like"></button></div></div></div>',
        );
      window.__palbooSideChat.refresh();
    });
    await page
      .getByRole('button', { name: 'Bring to original chat through this reply', exact: true })
      .click();
    await settled(page);
    const r = await result(page);
    assert.equal(r.draft, 'parent draft');
    assert.equal(r.cards.length, 1);
    assert.equal(r.cards[0].preview, 'Side-chat transcript · History · Through selected reply');
    const text = r.files[r.cards[0].file.path];
    for (const phrase of ['first question', 'first answer', 'selected question', 'selected answer'])
      assert.ok(text.includes(phrase));
    assert.ok(!text.includes('later question'));
    assert.ok(!text.includes('later answer'));
    assert.ok(!text.includes('EXCLUDED DRAFT'));
    assert.equal(r.source, 'EXCLUDED DRAFT');
    noSend(r);
  } finally {
    await page.close();
  }
});

test('full-width side chat can create a card after revealing the parent while still checking retained source identity', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      document.querySelector('main').hidden = true;
    });
    await click(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.cards.length, 1);
    assert.equal(r.draft, 'parent draft');
    assert.equal(await page.locator('main').isVisible(), true);
    noSend(r);
  } finally {
    await page.close();
  }
});

test('editing the retained source after a full-width reveal cancels the pending card', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      document.querySelector('main').hidden = true;
      window.hooks.createAttachment = () =>
        new Promise((resolve) => {
          window.release = resolve;
        });
    });
    await click(page);
    await page.waitForFunction(() => !!window.release);
    await page.evaluate(() => {
      document.querySelector('aside .ProseMirror').textContent = 'changed retained draft';
      window.release();
    });
    await settled(page);
    const r = await result(page);
    assert.equal(r.source, 'changed retained draft');
    assert.equal(r.draft, 'parent draft');
    assert.deepEqual(r.cards, []);
    assert.deepEqual(r.files, {});
    assert.equal(r.recovery, true);
    noSend(r);
  } finally {
    await page.close();
  }
});

test('cloud or unavailable local card capability falls back to readable text and keeps existing draft', async () => {
  for (const mode of ['cloud', 'missing', 'cloud-composer']) {
    const page = await fixture({ cloud: mode === 'cloud' });
    try {
      await page.evaluate((mode) => {
        if (mode === 'missing') delete window.runtime.c.TSib;
        if (mode === 'cloud-composer') window.cardMode = 'cloud';
      }, mode);
      await click(page);
      await settled(page);
      const r = await result(page);
      assert.ok(r.draft.startsWith('parent draft\n\n上下文交接'));
      assert.ok(r.draft.includes('### 用户\n\nfirst'));
      assert.ok(r.draft.endsWith(r.source));
      assert.deepEqual(r.cards, []);
      assert.deepEqual(r.files, {});
      noSend(r);
    } finally {
      await page.close();
    }
  }
});

test('file and registration failures preserve all user content and clean only this operation without falling back to a second write', async () => {
  for (const mode of ['create', 'register', 'readback']) {
    const page = await fixture();
    try {
      await page.evaluate((mode) => {
        window.cards = [{ file: { path: '/fixture/keep.txt' }, hostId: 'local' }];
        window.cardFiles['/fixture/keep.txt'] = 'keep';
        if (mode === 'create')
          window.hooks.createAttachment = () => {
            throw Error('file failed');
          };
        if (mode === 'register')
          window.hooks.attachCard = () => {
            throw Error('registration failed');
          };
        if (mode === 'readback') {
          const original = window.runtime.c.TSib.exports.Rh;
          window.runtime.c.TSib.exports.Rh = (...args) => {
            original(...args);
            if (window.cards.length > 1) window.cardGeneration++;
          };
        }
      }, mode);
      await click(page);
      await settled(page);
      const r = await result(page);
      assert.equal(r.draft, 'parent draft');
      assert.deepEqual(
        r.cards.map((c) => c.file.path),
        ['/fixture/keep.txt'],
      );
      assert.deepEqual(r.files, { '/fixture/keep.txt': 'keep' });
      assert.equal(r.recovery, true);
      assert.equal(await page.locator('aside').isVisible(), true);
      assert.ok(r.status.length > 0);
      noSend(r);
    } finally {
      await page.close();
    }
  }
});

test('changes during file creation cancel late cards, retain concurrent edits and attachments, and keep the shared action lock', async () => {
  for (const change of [
    'draft',
    'source',
    'scope',
    'tab',
    'generation',
    'mode',
    'submitting',
    'attachment',
    'ime',
    'streaming',
    'destroy',
    'reinjection',
  ]) {
    const page = await fixture();
    try {
      await showSideReply(page);
      await page.evaluate(() => {
        window.installOptimizer();
        window.hooks.createAttachment = () =>
          new Promise((resolve) => {
            window.release = resolve;
          });
      });
      await click(page);
      await page.waitForFunction(() => !!window.release);
      assert.deepEqual(
        await page.evaluate(() => [
          ...Array.from(
            document.querySelectorAll('[data-palboo-side-chat=reply]'),
            (node) => node.disabled,
          ),
          window.promptButton.disabled,
        ]),
        [true, true, true],
      );
      await page.evaluate((change) => {
        const main = document.querySelector('main .ProseMirror');
        if (change === 'draft') main.textContent = 'new main draft';
        if (change === 'source')
          document.querySelector('aside .ProseMirror').textContent = 'new side draft';
        if (change === 'scope')
          window.attachScope(main, { ...window.parentScope, conversationId: 'other' });
        if (change === 'tab') window.tab.contentInstance = Symbol();
        if (change === 'generation') window.cardGeneration++;
        if (change === 'mode') window.cardMode = 'cloud';
        if (change === 'submitting') window.cardSubmitting = true;
        if (change === 'attachment') {
          window.cards = [{ file: { path: '/fixture/concurrent.txt' }, hostId: 'local' }];
          window.cardFiles['/fixture/concurrent.txt'] = 'user attachment';
        }
        if (change === 'ime')
          main.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        if (change === 'streaming')
          main
            .closest('form')
            .insertAdjacentHTML('beforeend', '<button aria-label="Stop"></button>');
        if (change === 'destroy') window.__palbooSideChat.destroy();
        if (change === 'reinjection') window.setup();
        if (!['destroy', 'reinjection'].includes(change)) window.promptButton.click();
        window.release();
      }, change);
      await settled(page);
      await page.waitForFunction(() => window.log.some(([kind]) => kind === 'remove-card-file'));
      const r = await result(page);
      assert.equal(r.draft, change === 'draft' ? 'new main draft' : 'parent draft', change);
      assert.equal(
        r.source,
        change === 'source' ? 'new side draft' : '  unsent\n\nkeep $1 & <text>\n',
        change,
      );
      assert.deepEqual(
        r.cards.map((c) => c.file.path),
        change === 'attachment' ? ['/fixture/concurrent.txt'] : [],
        change,
      );
      assert.deepEqual(
        r.files,
        change === 'attachment' ? { '/fixture/concurrent.txt': 'user attachment' } : {},
        change,
      );
      assert.equal(await page.locator('aside').isVisible(), true);
      noSend(r);
      await page.evaluate(() => window.prompt.destroy());
    } finally {
      await page.close();
    }
  }
});

test('a file arriving after the operation deadline is removed without touching drafts or adding a card', async () => {
  const page = await fixture();
  try {
    await page.clock.install();
    await page.evaluate(() => {
      window.hooks.createAttachment = () =>
        new Promise((resolve) => {
          window.release = resolve;
        });
    });
    await click(page);
    await page.waitForFunction(() => !!window.release);
    await page.clock.runFor(30100);
    await settled(page);
    await page.evaluate(() => window.release());
    await page.waitForFunction(() => window.log.some(([kind]) => kind === 'remove-card-file'));
    const r = await result(page);
    assert.equal(r.draft, 'parent draft');
    assert.deepEqual(r.cards, []);
    assert.deepEqual(r.files, {});
    assert.equal(r.recovery, true);
    assert.equal(await page.locator('aside').isVisible(), true);
    noSend(r);
  } finally {
    await page.close();
  }
});

test('if native rollback cannot detach its new card, its file remains readable instead of becoming a broken reference', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      const original = window.runtime.c.TSib.exports.Rh;
      let written = false;
      window.runtime.c.TSib.exports.Rh = (...args) => {
        if (written) throw Error('rollback unavailable');
        original(...args);
        written = true;
        window.cardGeneration++;
      };
    });
    await click(page);
    await settled(page);
    const r = await result(page);
    assert.equal(r.draft, 'parent draft');
    assert.equal(r.cards.length, 1);
    assert.ok(r.files[r.cards[0].file.path].includes('first local answer'));
    assert.equal(
      r.log.some(([kind]) => kind === 'remove-card-file'),
      false,
    );
    assert.equal(r.recovery, true);
    noSend(r);
  } finally {
    await page.close();
  }
});
