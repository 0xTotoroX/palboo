/* [INPUT]: Shared Bot view, real surface styles and synthetic deferred full replies.
 * [OUTPUT]: Directory/detail navigation, complete Markdown, scroll/focus and stale-response boundaries.
 * [POS]: Isolated browser regression; no real Bot data. [PROTOCOL]: See tests/AGENTS.md. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

test('recent messages open one complete reply without reusing Bot composer clicks', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {BotsView} from './ui/features/bots/view';import {setLocale} from './ui/shared/i18n.js';
      window.locale=setLocale;window.calls=[];window.reads=[];window.pending=[];window.reading={};
      window.state={snapshot:{target:{threadId:'thread',token:'token'},catalog:{revision:'r1',stale:false},
        bots:Array.from({length:12},(_,i)=>({id:'b'+i,name:'Bot '+i,available:true,occupied:false,current:null,preview:'合成摘要，'.repeat(30)}))}};
      const root=createRoot(document.getElementById('root'));
      window.render=()=>root.render(<BotsView state={window.state} reading={window.reading} disabled={false}
        headerActions={document.getElementById('header')} action={v=>window.calls.push(v)}
        readReply={data=>{window.reads.push(data);return new Promise((resolve,reject)=>window.pending.push({data,resolve,reject}));}}/>);
      window.finish=(i,text)=>window.pending[i].resolve({...window.pending[i].data,messageId:'m'+i,text,hasAttachments:false});
      window.render();`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 340, height: 430 },
      reducedMotion: 'reduce',
    });
    let external = 0;
    await page.route('https://**/*', (route) => {
      external++;
      return route.abort();
    });
    await page.setContent(
      '<style>body{margin:0;font:16px system-ui;color:#222;--ink:#222;--muted:#555;--hover:#eee;--line:#ddd}#header{height:32px;display:flex;justify-content:flex-end}#root{height:340px!important}.feature-body{overflow:auto;height:340px}#header button{width:28px;height:28px}</style><div id="header"></div><section class="feature-view" data-feature="bots"><div class="feature-body" id="root"></div></section>',
    );
    await page.addStyleTag({ content: readFileSync('ui/surfaces/workspace/content.css', 'utf8') });
    await page.addStyleTag({ content: readFileSync('ui/features/bots/style.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: 'Bot 0', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls[0].action), 'ask');
    assert.equal(await page.evaluate(() => window.reads.length), 0);
    await page.getByRole('button', { name: '最近消息', exact: true }).click();
    const item = page.getByRole('button', { name: '查看「Bot 8」的完整回答', exact: true });
    await item.scrollIntoViewIfNeeded();
    const top = await page.locator('.feature-body').evaluate((n) => n.scrollTop);
    assert.ok(top > 100);
    await item.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: '正在读取回答' }).waitFor();
    assert.equal(await page.evaluate(() => window.reads[0].botId), 'b8');
    assert.equal(await page.locator('.palboo-bot-message').count(), 0);
    const markdown =
      '# 完整标题\n\n**加粗**与`代码`\n\n| 项目 | 结果 |\n| --- | --- |\n| 完整 | 是 |\n\n' +
      Array.from({ length: 120 }, (_, i) => `第 ${i} 段，这是超过摘要长度的合成回答。`).join(
        '\n\n',
      ) +
      '\n\n```js\n' +
      'LONG_CODE_'.repeat(150) +
      '\n```\n\n<script>window.injected=true</script>\n\n![外部图片](https://example.test/pixel)\n\n[危险](javascript:alert(1))\n\nEND_OF_FULL_REPLY';
    await page.evaluate((text) => window.finish(0, text), markdown);
    await page.getByRole('heading', { name: '完整标题' }).waitFor();
    assert.equal(await page.locator('.palboo-bot-markdown strong').textContent(), '加粗');
    assert.equal(await page.locator('.palboo-bot-markdown table').count(), 1);
    assert.match(await page.locator('.palboo-bot-markdown').textContent(), /END_OF_FULL_REPLY/);
    assert.equal(
      await page
        .locator('.palboo-bot-markdown img,.palboo-bot-markdown script,a[href^="javascript:"]')
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    assert.equal(external, 0);
    assert.equal(await page.evaluate(() => window.calls.length), 1);
    await page.locator('.feature-body').evaluate((n) => {
      n.scrollTop = 500;
    });
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: '返回最近消息', exact: true }).click();
    assert.ok(
      Math.abs((await page.locator('.feature-body').evaluate((n) => n.scrollTop)) - top) <= 1,
    );
    assert.equal(await item.evaluate((n) => n === document.activeElement), true);
    await item.click();
    await page.waitForFunction(() => window.reads.length === 2);
    await page.evaluate((text) => window.finish(1, text), markdown);
    await page.getByRole('heading', { name: '完整标题' }).waitFor();
    assert.ok(
      Math.abs((await page.locator('.feature-body').evaluate((n) => n.scrollTop)) - 500) <= 1,
    );
    await page.getByRole('button', { name: '返回最近消息', exact: true }).click();
    await item.click();
    await page.waitForFunction(() => window.reads.length === 3);
    await page.getByRole('button', { name: '返回最近消息', exact: true }).click();
    await page.evaluate(() => window.finish(2, 'LATE_PRIVATE_REPLY'));
    assert.doesNotMatch(await page.locator('.feature-body').innerText(), /LATE_PRIVATE_REPLY/);
    await item.click();
    await page.waitForFunction(() => window.reads.length === 4);
    await page.evaluate(() =>
      window.pending[3].reject(Error('请先在 Grok Bot 中打开此 Bot，同步完整回答后重试。')),
    );
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => window.reads.length === 5);
    await page.evaluate(() => window.finish(4, '# 重试成功\n\n正文完整'));
    await page.getByRole('heading', { name: '重试成功' }).waitFor();
    await page.setViewportSize({ width: 260, height: 220 });
    assert.equal(
      await page.locator('.palboo-bot-reader').evaluate((n) => n.scrollWidth <= n.clientWidth),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: '返回最近消息', exact: true }).isVisible(),
      true,
    );
    await page.evaluate(() => window.locale('en'));
    await page.getByRole('button', { name: 'Back to recent messages', exact: true }).waitFor();
    mkdirSync('target/reports/bots-reader', { recursive: true });
    await page.screenshot({ path: 'target/reports/bots-reader/narrow.png' });
    await page.evaluate(() => {
      window.state.snapshot.catalog.revision = 'r2';
      window.render();
    });
    await page.getByRole('button', { name: 'Back to Bots', exact: true }).waitFor();
    assert.equal(await page.locator('.palboo-bot-reader').count(), 0);
    await page.getByRole('button', { name: 'Back to Bots', exact: true }).click();
    await page.getByRole('button', { name: 'Bot 1', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.at(-1).action), 'ask');
  } finally {
    await browser.close();
  }
});

test('recent message rows stay aligned inside the complete shared feature shell', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import {mountFeature} from './ui/surfaces/workspace/mount';
import {setLocale} from './ui/shared/i18n';
import {iconSvg} from './ui/shared/icons';
let mounted;
window.calls=[];
window.show=(width,height,language,font,theme)=>{
 mounted?.dispose();setLocale(language);
 const pane=document.querySelector('main');
 pane.style.cssText='display:flex;flex-direction:column;width:'+width+'px;height:'+height+'px;--csw-chrome-font:'+font+'px;--feature-refresh-opacity:1';
 pane.innerHTML='<header class="csw-workbench-pane-header"><span class="csw-feature-tabs">'+iconSvg('feature-bots')+'</span><span class="csw-feature-header-actions"></span></header><div class="feature-mount" style="flex:1;min-height:0"></div>';
 const state={appearance:{theme,language,fontSizes:{bots:font}},snapshot:{target:{threadId:'fixture',token:'safe'},catalog:{revision:'r1',stale:false},bots:[
  {id:'short',name:'短回答',available:true,occupied:false,current:null,preview:'完成。'},
  {id:'long',name:'长回答',available:true,occupied:false,current:null,preview:'这是一段较长的合成消息。'.repeat(30)}
 ]}};
 mounted=mountFeature(pane.querySelector('.feature-mount'),{id:'bots',owner:'test',open:true,placement:'sidebar',view:{},size:[width,height],reveal:1,pending:null},'test','sidebar',async request=>{
  if(request.op==='action'){
   window.calls.push(request.data);
   if(request.data.action==='latest-reply')return {reply:{...request.data,messageId:'reply',text:'# 完整回答\\n\\n'+'合成完整正文。\\n\\n'.repeat(80)+'END_OF_FULL_REPLY',hasAttachments:false}};
  }
  return state;
 },()=>{});
 pane.querySelector('.csw-feature-header-actions').append(mounted.headerActions);
};`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'inline-css',
        setup(builder) {
          builder.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
            path: resolve(dirname(args.importer), args.path.split('?')[0]),
            namespace: 'css-text',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'css-text' }, (args) => ({
            contents: readFileSync(args.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 760 },
      reducedMotion: 'reduce',
    });
    await page.setContent('<style>body{margin:0}</style><main class="csw-workbench-pane"></main>');
    await page.addStyleTag({ content: readFileSync('ui/surfaces/workspace/styles.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const [width, height, language, font, theme] of [
      [240, 280, 'zh-CN', 16, 'dark'],
      [760, 620, 'en', 24, 'light'],
      [460, 360, 'zh-CN', 20, 'light'],
    ]) {
      await page.evaluate((args) => window.show(...args), [width, height, language, font, theme]);
      const english = language === 'en';
      await page
        .getByRole('button', { name: english ? 'Recent messages' : '最近消息', exact: true })
        .click();
      const geometry = await page.locator('.palboo-bot-message').evaluateAll((rows) =>
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          const body = row.closest('.feature-body').getBoundingClientRect();
          const name = row.querySelector('.palboo-bot-message-name').getBoundingClientRect();
          const preview = row.querySelector('.palboo-bot-preview');
          const previewRect = preview.getBoundingClientRect();
          return {
            nameInset: name.x - rect.x,
            previewInset: previewRect.x - rect.x,
            left: rect.x - body.x,
            right: body.right - rect.right,
            top: rect.top - body.top,
            previewHeight: previewRect.height,
            lineHeight: parseFloat(getComputedStyle(preview).lineHeight),
          };
        }),
      );
      assert.equal(geometry.length, 2);
      for (const row of geometry) {
        assert.ok(Math.abs(row.nameInset) < 1, 'short and long Bot names share the row left edge');
        assert.ok(Math.abs(row.previewInset) < 1, 'previews share the name left edge');
        assert.equal(row.left, 12, 'one surface inset');
        assert.equal(row.right, 12, 'whole row remains clickable');
        assert.ok(
          row.previewHeight <= row.lineHeight * 2 + 1,
          'directory keeps two-line summaries',
        );
      }
      assert.equal(geometry[0].top, 12, 'content starts directly below the existing header');
      await page.locator('.palboo-bot-message').first().focus();
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '完整回答', exact: true }).waitFor();
      await page.locator('.palboo-bot-markdown > :last-child').scrollIntoViewIfNeeded();
      assert.equal(
        await page.locator('.palboo-bot-markdown > :last-child').textContent(),
        'END_OF_FULL_REPLY',
      );
      await page
        .getByRole('button', {
          name: english ? 'Back to recent messages' : '返回最近消息',
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .locator('.palboo-bot-message')
          .first()
          .evaluate((n) => n.getRootNode().activeElement === n),
        true,
      );
      await page
        .getByRole('button', { name: english ? 'Back to Bots' : '返回 Bot 列表', exact: true })
        .click();
      await page.getByRole('button', { name: '短回答', exact: true }).click();
      assert.equal(await page.evaluate(() => window.calls.at(-1).action), 'ask');
    }
  } finally {
    await browser.close();
  }
});
