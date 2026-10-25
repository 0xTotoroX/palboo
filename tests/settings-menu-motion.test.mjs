/* [INPUT]: Actual settings menus/dialogs, built CSS and synthetic local state in Chromium.
 * [OUTPUT]: Reversible enter/exit transitions, inert closing content, retained drafts and immediate accessibility fallbacks.
 * [POS]: Synthetic data only; never connects to Palboo or writes user settings.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { emulateMedia, finishAnimations } from './browser-motion.mjs';

test('settings menus and dialogs share interruptible motion without delaying interaction', async () => {
  const script = (
    await build({
      stdin: {
        loader: 'jsx',
        resolveDir: process.cwd(),
        contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{SettingsTheme}from'./ui/settings/settings-theme';
import{SuggestionInput}from'./ui/settings/components/ui/suggestion-input';
import{NativeSelect}from'./ui/settings/components/ui/native-select';
import{SettingsDrawer}from'./ui/settings/settings-drawer';
import{SettingsSearch}from'./ui/settings/settings-search';
import{ConfirmationButton}from'./ui/settings/settings-confirmation';
import{useSettingsMotion}from'./ui/settings/settings-motion';
function App(){const[value,setValue]=useState('Alpha');const ref=useSettingsMotion('menus');
window.changes??=0;window.actions??=0;
return <div className="settings-app" ref={ref}>
<header className="settings-header"><SettingsTheme/><SettingsSearch navigate={()=>window.actions++}/></header>
<button id="outside" type="button">其他操作</button>
<main className="settings-content" data-settings-page="model" style={{maxWidth:500}}>
<label htmlFor="selection">生成方式</label><NativeSelect id="selection" defaultValue="manual" onChange={()=>window.changes++}><option value="manual">手动</option><option value="auto">自动</option><option disabled>不可用</option></NativeSelect>
<SettingsDrawer title="高级设置"><label htmlFor="draft">草稿</label><input id="draft" defaultValue="保留内容"/></SettingsDrawer>
<ConfirmationButton title="确认删除？" description="保留退出时的内容" confirmLabel="确认删除" onConfirm={()=>window.actions++}>删除示例</ConfirmationButton>
</main><div style={{position:'fixed',bottom:24,right:24,width:300}}><label htmlFor="candidate">候选名称</label><SuggestionInput id="candidate" value={value} options={['Alpha','Beta']} dropdown={{label:'选择候选',onOpen:()=>{}}} onValueChange={v=>{window.changes++;setValue(v)}}/></div>
</div>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
  ).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.setDefaultTimeout(4000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('http://menus.test/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
    );
    await page.goto('http://menus.test/');
    const html = await readFile('target/web/index.html', 'utf8');
    for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      await page.addStyleTag({ content: await readFile(`target/web${href}`, 'utf8') });
    await page.addScriptTag({ content: script });
    await page.locator('#outside').waitFor();
    await page.evaluate(() => {
      window.menuTransitions = [];
      document.addEventListener('transitionrun', (event) => {
        if (event.propertyName !== 'opacity') return;
        const node = event.target;
        const animation = node
          .getAnimations()
          .find(
            (a) =>
              a.transitionProperty === 'opacity' &&
              (a.effect.pseudoElement || '') === event.pseudoElement,
          );
        if (!animation) return;
        window.menuTransitions.push({
          className: node.className,
          pseudo: event.pseudoElement,
          duration: animation.effect.getTiming().duration,
          frames: animation.effect.getKeyframes().map((f) => f.opacity),
        });
      });
    });
    const theme = page.locator('.settings-theme-menu');
    const themeTrigger = page.locator('.settings-theme-trigger');
    const candidates = page.locator('.settings-suggestion-list');
    const candidateTrigger = page.getByRole('button', { name: '选择候选', exact: true });
    for (const [menu, trigger] of [
      [theme, themeTrigger],
      [candidates, candidateTrigger],
    ]) {
      await trigger.click();
      await finishAnimations(menu);
      assert.equal(await menu.evaluate((n) => n.inert), false);
      await menu.evaluate((n) => (window.retainedMenu = n));
      await trigger.click();
      assert.equal(await menu.evaluate((n) => n.inert), true);
      assert.equal(await menu.evaluate((n) => getComputedStyle(n).pointerEvents), 'none');
      await menu.waitFor({ state: 'hidden' });
      await trigger.click();
      assert.equal(await menu.evaluate((n) => n === window.retainedMenu), true);
      await trigger.evaluate(async (node) => {
        node.click();
        await new Promise(requestAnimationFrame);
        node.click();
      });
      await finishAnimations(menu);
      assert.equal(await menu.evaluate((n) => getComputedStyle(n).opacity), '1');
      assert.equal(await menu.evaluate((n) => n.inert), false);
      await page.keyboard.press('Escape');
      assert.equal(await menu.isVisible(), false);
      assert.equal(
        await trigger.evaluate((n) => n.getAnimations({ subtree: true }).length),
        0,
        'keyboard also stops the trigger arrow',
      );
    }
    await candidateTrigger.click();
    assert.equal(await candidates.getAttribute('data-above'), 'true');
    assert.equal(
      await candidates
        .evaluate((n) => getComputedStyle(n).transformOrigin)
        .then((s) => s.startsWith('0px ')),
      true,
    );
    await candidates.getByRole('option', { name: 'Beta', exact: true }).click();
    assert.equal(await page.locator('#candidate').inputValue(), 'Beta');
    assert.equal(
      await candidates.locator('li').count(),
      2,
      'outgoing choices retain their geometry',
    );
    await candidates.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.changes), 1);

    const selection = page.locator('#selection');
    assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
    // Native picker animations live in the UA shadow tree, outside select.getAnimations().
    await selection.evaluate((node) => {
      window.nativeFrames = [];
      window.sampleNative = true;
      const sample = () => {
        const style = getComputedStyle(node, '::picker(select)');
        window.nativeFrames.push({
          open: node.matches(':open'),
          opacity: Number(style.opacity),
          duration: style.transitionDuration,
        });
        if (window.sampleNative) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await selection.click();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#selection'), '::picker(select)').opacity === '1',
    );
    assert.equal(await selection.evaluate((n) => n.matches(':open')), true);
    await page.locator('#outside').click();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#selection'), '::picker(select)').display ===
        'none',
    );
    const nativeFrames = await page.evaluate(() => {
      window.sampleNative = false;
      return window.nativeFrames;
    });
    assert.ok(
      nativeFrames.some((f) => f.open && f.opacity > 0 && f.opacity < 1),
      'native picker has intermediate entry frames',
    );
    assert.ok(
      nativeFrames.some(
        (f) => !f.open && f.opacity > 0 && f.opacity < 1 && f.duration.startsWith('0.14s'),
      ),
      'native picker has intermediate exit frames',
    );
    assert.equal(
      await page.evaluate(() => window.changes),
      1,
      'opening/cancelling a native picker does not select',
    );

    const drawer = page.locator('.settings-drawer');
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    assert.equal(
      await drawer.evaluate((n) => getComputedStyle(n, '::backdrop').transitionDuration),
      '0.22s',
    );
    await page.locator('#draft').fill('未保存输入');
    await finishAnimations(drawer);
    await page.getByRole('button', { name: '关闭高级设置', exact: true }).click();
    assert.equal(await drawer.evaluate((n) => n.inert), true);
    await drawer.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '高级设置', exact: true }).click();
    assert.equal(await page.locator('#draft').inputValue(), '未保存输入');
    await page.keyboard.press('Escape');
    assert.equal(await drawer.isVisible(), false);

    const confirmation = page.locator('.settings-key-dialog');
    await page.getByRole('button', { name: '删除示例', exact: true }).click();
    await finishAnimations(confirmation);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await confirmation.locator('h3').textContent(), '确认删除？');
    assert.equal(await confirmation.evaluate((n) => n.inert), true);
    await confirmation.waitFor({ state: 'hidden' });

    const search = page.locator('.settings-search-dialog');
    await page.getByRole('button', { name: '搜索设置', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索设置' }).fill('草稿');
    await finishAnimations(search);
    await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
    assert.equal(
      await search.locator('input').inputValue(),
      '草稿',
      'search does not swap its content during exit',
    );
    assert.equal(await search.evaluate((n) => n.inert), true);
    await search.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '搜索设置', exact: true }).press('Enter');
    assert.equal(await search.locator('input').inputValue(), '');
    assert.equal(await search.evaluate((n) => n.getAnimations().length), 0);
    await page.keyboard.press('Escape');
    assert.equal(await search.isVisible(), false);

    const transitions = await page.evaluate(() => window.menuTransitions);
    for (const className of [
      'settings-theme-menu',
      'settings-suggestion-list',
      'settings-key-dialog',
      'settings-search-dialog',
    ]) {
      for (const [duration, frames] of [
        [180, ['0', '1']],
        [140, ['1', '0']],
      ])
        assert.ok(
          transitions.some(
            (t) =>
              t.className.includes(className) &&
              !t.pseudo &&
              t.duration === duration &&
              JSON.stringify(t.frames) === JSON.stringify(frames),
          ),
          `${className} ${duration}ms transition`,
        );
    }
    assert.ok(
      transitions.some(
        (t) => t.className.includes('settings-drawer') && !t.pseudo && t.duration === 160,
      ),
      'drawer exits faster than it enters',
    );

    await themeTrigger.click();
    await emulateMedia(page, { reducedMotion: 'reduce' });
    assert.equal(await theme.evaluate((n) => n.getAnimations().length), 0);
    await themeTrigger.click();
    assert.equal(await theme.isVisible(), false);
    for (const [surface, trigger] of [
      [candidates, candidateTrigger],
      [drawer, page.getByRole('button', { name: '高级设置', exact: true })],
      [search, page.getByRole('button', { name: '搜索设置', exact: true })],
      [confirmation, page.getByRole('button', { name: '删除示例', exact: true })],
    ]) {
      await trigger.click();
      assert.equal(await surface.evaluate((n) => n.getAnimations().length), 0);
      await page.keyboard.press('Escape');
      assert.equal(await surface.isVisible(), false);
    }
    assert.equal(await page.evaluate(() => window.actions), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
