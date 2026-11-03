/*
 * [INPUT]: 工作台真实浏览器夹具与合成回答。
 * [OUTPUT]: 回答操作栏同排/样式/键盘入口、宿主角色兼容、标题分级回退、不均匀段落与同名前缀、去重、重挂载定位与过期拒绝回归。
 * [POS]: 由 workbench.mjs 执行；不读取真实聊天，不调用模型或外部服务。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import assert from 'node:assert/strict';

const body = '这里使用合成材料说明当前段落，保留自然段边界与完整的原文定位。'.repeat(9);
const paragraphs = (count = 12, english = false) =>
  Array.from({ length: count }, (_, index) => {
    const label = english ? `Reading point ${index + 1}.` : `这是第 ${index + 1} 个阅读位置。`;
    const detail = english
      ? 'This synthetic paragraph explains the current example without contacting any service. '.repeat(
          6,
        )
      : body;
    return `<div><p data-outline-fixture="${index}" style="min-height:180px"><strong>${label}</strong> ${detail}</p></div>`;
  }).join('');

async function setAnswer(page, html) {
  await page.evaluate((html) => {
    document.querySelector('#answer').innerHTML = html;
    window.__companionFloatingPanel.scan();
  }, html);
  await page.waitForFunction(() => {
    const state = window.__companionFloatingPanel.state;
    return (
      state.outlineSourceHash === state.lastAssistantHash &&
      ['ready', 'empty'].includes(state.outlineStatus)
    );
  });
}

const items = (page) =>
  page.evaluate(() =>
    window.__companionFloatingPanel.state.outlineItems.map((item) => ({
      id: item.id,
      text: item.text,
      kind: item.kind,
      target: item.el.getAttribute('data-outline-fixture'),
    })),
  );

async function checkTargets(page, result) {
  for (const item of result) {
    await page.locator(`[data-view-body="outline"] [data-outline-id="${item.id}"]`).click();
    await page.waitForFunction(({ id, target }) => {
      const element = document.querySelector(
        `#answer [data-companion-stepwise-outline-id="${id}"]`,
      );
      const viewport = document.querySelector('.thread-scroll-container').getBoundingClientRect();
      const rect = element?.getBoundingClientRect();
      return (
        element?.getAttribute('data-outline-fixture') === target &&
        element.classList.contains('companion-stepwise-outline-target-flash') &&
        rect.top >= viewport.top &&
        rect.top < viewport.bottom
      );
    }, item);
  }
}

export function outlineCases({ mode }) {
  return [
    [
      '大纲：目录入口与新版回答操作栏同排并沿用宿主按钮样式',
      async (page) => {
        await mode(page, true);
        await setAnswer(page, '<h2>目录入口验收</h2><p>这是一条合成回答。</p>');
        await page.addStyleTag({
          content: `.fixture-actions{display:flex;align-items:center;gap:2px}
            .fixture-actions .fixture-native-action{display:flex;align-items:center;justify-content:center;width:26px;height:26px;min-height:0;padding:4px;margin:0;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--fixture-action-color);cursor:pointer}
            .fixture-native-action:hover{background:var(--fixture-action-hover)}
            .fixture-native-action:focus-visible{outline:2px solid currentColor}
            @layer host{.fixture-native-icon{width:16px;height:16px}}`,
        });
        for (const english of [false, true]) {
          for (const dark of [false, true]) {
            await page.evaluate(
              ({ english, dark }) => {
                const reply = document.querySelector('[data-message-author-role="assistant"]');
                reply.style.setProperty('--fixture-action-color', dark ? '#999' : '#666');
                reply.style.setProperty('--fixture-action-hover', dark ? '#333' : '#eee');
                reply.querySelector('.assistant-actions')?.remove();
                const actions = document.createElement('div');
                actions.className = 'assistant-actions turn-action-controls';
                const labels = english
                  ? ['Copy', 'Give feedback', 'Read aloud', 'More actions']
                  : ['复制', '评价回复', '朗读', '更多操作'];
                actions.innerHTML = `<div class="fixture-actions">${labels
                  .map(
                    (label) =>
                      `<button class="fixture-native-action" aria-label="${label}"><svg class="fixture-native-icon" viewBox="0 0 24 24"></svg></button>`,
                  )
                  .join('')}</div><span>14:02</span>`;
                reply.append(actions);
                window.__companionFloatingPanel.scan();
              },
              { english, dark },
            );
            const button = page.locator('[data-palboo-outline-reply]');
            await button.waitFor();
            await button.scrollIntoViewIfNeeded();
            const metrics = await button.evaluate((button) => {
              const group = document.querySelector('.fixture-actions');
              const buttons = [...group.querySelectorAll('button')];
              const read = (node) => {
                const r = node.getBoundingClientRect(),
                  s = getComputedStyle(node);
                const icon = node.querySelector('svg').getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  color: s.color,
                  padding: s.padding,
                  radius: s.borderRadius,
                  icon: [icon.width, icon.height],
                };
              };
              return {
                sameRow: button.parentElement === group,
                count: document.querySelectorAll('[data-palboo-outline-reply]').length,
                glyph: button.querySelector('svg').getAttribute('data-icon'),
                reference: read(buttons[0]),
                previous: read(buttons.at(-2)),
                actual: read(button),
                next: read(buttons[1]),
              };
            });
            assert.equal(metrics.sameRow, true);
            assert.equal(metrics.count, 1);
            assert.equal(metrics.glyph, 'feature-outline');
            for (const key of ['y', 'width', 'height', 'color', 'padding', 'radius', 'icon'])
              assert.deepEqual(metrics.actual[key], metrics.reference[key], key);
            assert.ok(
              Math.abs(
                metrics.actual.x -
                  metrics.previous.x -
                  metrics.previous.width -
                  (metrics.next.x - metrics.reference.x - metrics.reference.width),
              ) < 0.5,
            );
            await button.hover();
            assert.equal(
              await button.evaluate((b) => getComputedStyle(b).backgroundColor),
              dark ? 'rgb(51, 51, 51)' : 'rgb(238, 238, 238)',
            );
            await button.focus();
            await button.press('Enter');
            await page
              .locator('[data-view-body="outline"]')
              .getByRole('button', { name: '目录入口验收' })
              .waitFor();
          }
        }
        // A temporarily missing action row must not leave a separate line below the reply.
        await page.evaluate(() => {
          document.querySelector('.assistant-actions').remove();
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(() => !document.querySelector('[data-palboo-outline-reply]'));
      },
    ],
    [
      '大纲：选择旧回复，定位原文，再恢复跟随最新回答',
      async (page) => {
        await mode(page, true);
        await setAnswer(
          page,
          '<h2 data-outline-fixture="old">旧回复的正式标题</h2>' + paragraphs(4),
        );
        await page.evaluate(() => {
          const turn = document.querySelector('[data-content-search-turn-key]');
          const newer = turn.cloneNode(true);
          newer.setAttribute('data-content-search-turn-key', 'turn-0002');
          newer
            .querySelectorAll('[data-palboo-outline-reply]')
            .forEach((button) => button.remove());
          const answer = newer.querySelector('#answer');
          answer.id = 'answer-new';
          answer.innerHTML = '<h2>新回复的正式标题</h2><p>这是一条较新的合成回答。</p>';
          turn.after(newer);
          window.__companionFloatingPanel.scan();
        });
        const outline = page.locator('[data-view-body="outline"]');
        await outline.getByRole('button', { name: '新回复的正式标题' }).waitFor();
        const oldButton = page.locator('[data-palboo-outline-reply="turn-0001"]');
        await oldButton.click();
        await outline.getByRole('button', { name: '旧回复的正式标题' }).waitFor();
        await oldButton.and(page.locator('[aria-pressed="true"]')).waitFor();
        assert.equal(await oldButton.getAttribute('aria-pressed'), 'true');
        await checkTargets(page, await items(page));

        await page.evaluate(() => {
          document.querySelector('#answer-new h2').textContent = '更新后的最新回答';
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(() => {
          const view = window.__companionFloatingPanel.exportPanelState();
          return (
            view.context.assistantMessageId === 'turn:turn-0002' &&
            view.outlineHistorical &&
            view.outlineItems[0]?.text === '旧回复的正式标题'
          );
        });
        await page.evaluate(() => {
          const old = document.querySelector('[data-content-search-turn-key="turn-0001"]');
          const next = old.nextElementSibling;
          old.remove();
          window.addEventListener(
            'fixture-remount-old-reply',
            () => {
              next.before(old);
              window.__companionFloatingPanel.scan();
            },
            { once: true },
          );
        });
        await outline.getByText('所选回复未显示，请滚动到原文。').waitFor();
        await page.evaluate(() => window.dispatchEvent(new Event('fixture-remount-old-reply')));
        await outline.getByRole('button', { name: '旧回复的正式标题' }).waitFor();
        await outline.getByRole('button', { name: '跟随最新回答' }).click();
        await outline.getByRole('button', { name: '更新后的最新回答' }).waitFor();
        assert.equal(await outline.getByRole('button', { name: '跟随最新回答' }).count(), 0);
      },
    ],
    [
      '大纲：新版角色属性和隐藏打印标签、旧版中英文标签均识别回答',
      async (page) => {
        await mode(page, true);
        const variants = [
          { attribute: true, user: '未知本地化名称', assistant: '未知本地化名称', hidden: true },
          { attribute: false, user: '你说：', assistant: 'ChatGPT 说：', hidden: true },
          { attribute: false, user: 'You said:', assistant: 'Codex said:', hidden: true },
          { attribute: false, user: '你说：', assistant: 'ChatGPT 说：', hidden: false },
          { attribute: false, user: 'You said:', assistant: 'Assistant:', hidden: false },
        ];
        for (const [index, variant] of variants.entries()) {
          await page.evaluate(
            ({ index, variant }) => {
              const turn = document.querySelector('[data-content-search-turn-key]');
              turn.setAttribute('data-content-search-turn-key', `turn-label-${index}`);
              for (const role of ['user', 'assistant']) {
                const label = turn.querySelector(`[data-message-author-role="${role}"] h4.sr-only`);
                if (variant.attribute) label.setAttribute('data-conversation-role', role);
                else label.removeAttribute('data-conversation-role');
                label.replaceChildren(document.createTextNode(variant[role]));
                if (variant.hidden) {
                  const hidden = document.createElement('span');
                  hidden.className = 'hidden print:inline';
                  hidden.setAttribute('aria-hidden', 'true');
                  hidden.textContent = role === 'user' ? 'You' : 'ChatGPT';
                  label.append(hidden);
                }
              }
            },
            { index, variant },
          );
          await setAnswer(page, `<h2 data-outline-fixture="0">原文标题</h2>${paragraphs(3)}`);
          assert.equal((await items(page)).length, 1);
          assert.equal(
            await page.evaluate(() => {
              const state = window.__companionFloatingPanel.state;
              return !!state.latestTurnAnchor?.userText && !!state.latestTurnAnchor?.assistantText;
            }),
            true,
          );
          await checkTargets(page, await items(page));
        }
        // 明确的未知角色不能被旧标签文字误认成 assistant。
        await page.evaluate(() => {
          const turn = document.querySelector('[data-content-search-turn-key]');
          turn.setAttribute('data-content-search-turn-key', 'turn-label-z');
          turn
            .querySelector('[data-message-author-role="assistant"] h4')
            .setAttribute('data-conversation-role', 'tool');
          window.__companionFloatingPanel.scan();
        });
        await page.waitForFunction(
          () => window.__companionFloatingPanel.state.scanStatus === 'no-assistant-message',
        );
        assert.deepEqual(await items(page), []);
      },
    ],
    [
      '大纲：长度不均的自然段保留导航与实际定位',
      async (page) => {
        await mode(page, true);
        for (const lengths of [
          [400, 800],
          [800, 400],
          [600, 600],
          [120, 1080],
        ]) {
          await setAnswer(
            page,
            lengths
              .map(
                (length, index) =>
                  `<p data-outline-fixture="${index}">${String.fromCharCode(0x7532 + index).repeat(length - 1)}。</p>`,
              )
              .join(''),
          );
          const result = await items(page);
          assert.deepEqual(
            result.map((item) => item.target),
            ['0', '1'],
          );
          await checkTargets(page, result);
        }
      },
    ],
    [
      '大纲：相同首句及截断前缀保留不同正文，标签唯一且定位各自段落',
      async (page) => {
        await mode(page, true);
        for (const prefix of ['这一部分需要单独检查。', '共同的长前缀'.repeat(16)]) {
          await setAnswer(
            page,
            Array.from(
              { length: 6 },
              (_, index) =>
                `<p data-outline-fixture="${index}">${prefix}${String.fromCharCode(0x7532 + index).repeat(700)}</p>`,
            ).join(''),
          );
          const result = await items(page);
          assert.equal(result.length, 6);
          assert.equal(new Set(result.map((item) => item.text)).size, 6);
          assert.ok(result.every((item) => Array.from(item.text).length <= 56));
          await checkTargets(page, result);
        }
      },
    ],
    [
      '大纲：跨正文块优先使用正式标题，无正式标题时才使用编号加粗',
      async (page) => {
        await mode(page, true);
        await page.locator('#answer').evaluate((node) => node.classList.remove('markdown'));
        const section = (index) =>
          `<p data-outline-fixture="${index}"><strong>${index}. 检查第 ${index} 项</strong></p><p>${body}</p>`;
        const block = (html) => `<div class="markdown">${html}</div>`;
        await setAnswer(
          page,
          block(section(1)) +
            block('<h2 data-outline-fixture="2"><strong>整体接入方案</strong></h2>') +
            block(
              section(3) + '<div class="prose"><h3 data-outline-fixture="4">验证与交付</h3></div>',
            ),
        );
        let result = await items(page);
        assert.deepEqual(
          result.map((item) => [item.target, item.kind]),
          [
            ['2', 'semantic'],
            ['4', 'semantic'],
          ],
        );
        await checkTargets(page, result);

        await setAnswer(page, block(section(1)) + block(section(3)));
        result = await items(page);
        assert.deepEqual(
          result.map((item) => [item.target, item.kind]),
          [
            ['1', 'pseudo'],
            ['3', 'pseudo'],
          ],
        );
        await checkTargets(page, result);
      },
    ],
    [
      '大纲：无标题中英文长回答只补少量段落，点击与键盘准确定位',
      async (page) => {
        await mode(page, true);
        for (const english of [false, true]) {
          await setAnswer(page, paragraphs(18, english));
          const result = await items(page);
          assert.ok(result.length >= 2 && result.length <= 6);
          assert.ok(result.every((item) => item.kind === 'paragraph'));
          assert.equal(new Set(result.map((item) => item.text)).size, result.length);
          assert.equal(new Set(result.map((item) => item.target)).size, result.length);
          assert.equal(result[0].target, '0');
          const chosen = result.at(-1);
          const row = page.locator(`[data-view-body="outline"] [data-outline-id="${chosen.id}"]`);
          if (english) await row.press('Enter');
          else await row.click();
          assert.equal(
            await page
              .locator('#answer .companion-stepwise-outline-target-flash')
              .getAttribute('data-outline-fixture'),
            chosen.target,
          );
          await page.waitForFunction((target) => {
            const element = document.querySelector(`#answer [data-outline-fixture="${target}"]`);
            const viewport = document
              .querySelector('.thread-scroll-container')
              .getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return rect.top >= viewport.top && rect.top < viewport.bottom;
          }, chosen.target);
        }
      },
    ],
    [
      '大纲：原文标题包括短标题与单标题优先，不混入段落入口',
      async (page) => {
        await setAnswer(page, `<h2>成本</h2>${paragraphs(5)}<h3>细节</h3>${paragraphs(4, true)}`);
        assert.deepEqual(
          (await items(page)).map(({ text, kind }) => [text, kind]),
          [
            ['成本', 'semantic'],
            ['细节', 'semantic'],
          ],
        );
        await setAnswer(page, `<h2>原文唯一标题</h2>${paragraphs()}`);
        assert.deepEqual(
          (await items(page)).map((item) => item.text),
          ['原文唯一标题'],
        );
      },
    ],
    [
      '大纲：列表表格与短引导句同组，重复段落与代码不产生重复入口',
      async (page) => {
        const section = (index) => `<div>
          <p data-outline-fixture="${index}">这里列出第 ${index} 组材料：</p>
          <ul><li><p>${body}</p></li><li><p>${body}</p></li></ul>
          <table><tbody><tr><td><p>${body}</p></td></tr></tbody></table>
          <pre><code>${'const synthetic = 1;\n'.repeat(10)}</code></pre>
        </div>`;
        await setAnswer(page, [0, 1, 1, 2, 3, 4, 5].map(section).join(''));
        const result = await items(page);
        assert.ok(result.length >= 2 && result.length <= 6);
        assert.ok(result.every((item) => item.target !== null && item.text.startsWith('这里列出')));
        assert.equal(new Set(result.map((item) => item.text)).size, result.length);
        assert.equal(
          await page
            .locator(
              '#answer li [data-companion-stepwise-outline-id], #answer td [data-companion-stepwise-outline-id]',
            )
            .count(),
          0,
        );
      },
    ],
    [
      '大纲：短回答与代码空态不强行补导航',
      async (page) => {
        await setAnswer(page, '<p>第一段是简短的确认。</p><p>第二段补充一个小细节。</p>');
        assert.deepEqual(await items(page), []);
        await setAnswer(page, `<pre><code>${'const synthetic = 1;\n'.repeat(80)}</code></pre>`);
        assert.deepEqual(await items(page), []);
        await setAnswer(
          page,
          `<h2 hidden>隐藏标题</h2><p>单独一个自然段没有可供分组的边界。${body.repeat(3)}</p>`,
        );
        assert.deepEqual(await items(page), []);
      },
    ],
    [
      '大纲：段落重挂载保持定位，原文变化或同文换聊天拒绝旧点击',
      async (page) => {
        await setAnswer(page, paragraphs());
        const rebuilt = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems.at(-1);
          const target = item.el.getAttribute('data-outline-fixture');
          const answer = document.querySelector('#answer');
          answer.innerHTML = answer.innerHTML;
          const reply = panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
          return {
            ok: reply.ok,
            target,
            actual: answer
              .querySelector('.companion-stepwise-outline-target-flash')
              ?.getAttribute('data-outline-fixture'),
          };
        });
        assert.equal(rebuilt.ok, true);
        assert.equal(rebuilt.actual, rebuilt.target);
        const staleText = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems.at(-1);
          // 标签开头不变，只改末尾；必须在下一次扫描前拒绝旧定位。
          item.el.append(document.createTextNode(' 此段末尾已有新内容。'));
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(staleText.ok, false);
        await setAnswer(page, paragraphs(14));
        const staleChat = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems[0];
          document.querySelector('.thread-scroll-container').dataset.sessionId =
            'another-outline-chat';
          document
            .querySelector('[data-response-annotation-conversation]')
            .setAttribute('data-response-annotation-conversation', 'another-outline-chat');
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(staleChat.ok, false);
      },
    ],
    [
      '大纲：相同正文的新轮次拒绝旧点击并恢复新目录',
      async (page) => {
        await setAnswer(page, paragraphs());
        const reply = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          const source = panel.exportPanelState();
          const item = panel.state.outlineItems[0];
          document
            .querySelector('[data-content-search-turn-key]')
            .setAttribute('data-content-search-turn-key', 'turn-0002');
          return panel.panelCommand({ ...source, kind: 'outline-jump', id: item.id });
        });
        assert.equal(reply.ok, false);
        await page.evaluate(() => window.__companionFloatingPanel.scan());
        await page.waitForFunction(() => {
          const state = window.__companionFloatingPanel.state;
          return (
            state.outlineStatus === 'ready' &&
            state.outlineContext?.assistantMessageId === state.activeContext.assistantMessageId
          );
        });
        const current = await page.evaluate(() => {
          const panel = window.__companionFloatingPanel;
          return panel.panelCommand({
            ...panel.exportPanelState(),
            kind: 'outline-jump',
            id: panel.state.outlineItems[0].id,
          });
        });
        assert.equal(current.ok, true);
      },
    ],
  ];
}
