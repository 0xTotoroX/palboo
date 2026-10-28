/* [INPUT]: Actual feature mounts, shared shell styles and synthetic state.
 * [OUTPUT]: Compact header filters and a visible model footer across short/narrow panes.
 * [POS]: Isolated Chromium; no host, model calls or persisted settings.
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

test('full feature shells keep term filters in the header and model metrics outside scrolling', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import {mountFeature} from './ui/surfaces/workspace/mount';
import {setLocale} from './ui/shared/i18n';
import {iconSvg} from './ui/shared/icons';
let mounts=[];
window.show=async(width,height,language,font=16)=>{
 mounts.forEach(m=>m.dispose());mounts=[];document.querySelector('main').replaceChildren();setLocale(language);
 for(const id of ['terms','model']){
  const pane=document.createElement('section');pane.className='csw-workbench-pane';pane.dataset.test=id;pane.style.cssText='display:flex;flex-direction:column;width:'+width+'px;height:'+height+'px';
  pane.innerHTML='<header class="csw-feature-pane-head"><nav class="csw-workbench-tabs" data-icon-tabs><button aria-label="'+id+'">'+iconSvg('feature-'+id)+'</button></nav><div class="csw-feature-header-actions"></div></header><div class="csw-feature-content"><div class="feature-mount" style="height:100%"></div></div>';document.querySelector('main').append(pane);
  const selection={model:'model-0',reasoning:'high',speed:'standard'};
  const state=id==='terms'?{entries:[{id:'a',name:'布局',english:'Layout',definition:'合成词义',category:[]},{id:'b',name:'Viewport',english:'Viewport',definition:'合成词义',category:[]}],preferences:{favorites:['b'],mastered:['a']},involved:['a','b'],context:'synthetic',phase:'ready',message:''}:{revision:1,preferences:{enabled:true,pinned:Array.from({length:8},(_,i)=>'model-'+i),presets:Array.from({length:5},(_,i)=>({id:'p'+i,name:'Preset '+i,selection}))},snapshot:{target:{id:'synthetic'},revision:'one',status:'ready',current:selection,models:Array.from({length:8},(_,i)=>({id:'model-'+i,label:'Model '+i,reasoning:['low','medium','high','xhigh','max','ultra'],fast:true})),usage:[{minutes:10080,remainingPercent:72},{minutes:300,remainingPercent:86}],tokenMeter:{phase:'tool',speed:null,lastSpeed:38.4,average:null,official:null}}};
  state.appearance={theme:'dark',fontSizes:{terms:font,model:font}};
  const m=mountFeature(pane.querySelector('.feature-mount'),{id,owner:'test',open:true,placement:'sidebar',view:{},size:[width,height],reveal:1,pending:null},'test','sidebar',async()=>state,()=>{});mounts.push(m);pane.querySelector('.csw-feature-header-actions').append(m.headerActions);
 }
};`,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'inline-css',
        setup(b) {
          b.onResolve({ filter: /\.css\?inline$/ }, (a) => ({
            path: resolve(dirname(a.importer), a.path.split('?')[0]),
            namespace: 'css-text',
          }));
          b.onLoad({ filter: /.*/, namespace: 'css-text' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text',
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  const geometry = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 850 },
      reducedMotion: 'reduce',
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(
      '<style>body{background:#181818;color:#eee;--csw-text:#eee;--csw-muted:#aaa;--csw-accent:#aaa;--feature-refresh-opacity:1;--csw-chrome-font:16px}main{display:flex;gap:24px}</style><main></main>',
    );
    await page.addStyleTag({ content: readFileSync('ui/surfaces/workspace/styles.css', 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const [width, height, language, font = 16] of [
      [240, 280, 'zh-CN'],
      [240, 280, 'en'],
      [240, 650, 'zh-CN'],
      [520, 420, 'en'],
      [240, 320, 'en', 20],
    ]) {
      await page.evaluate((args) => window.show(...args), [width, height, language, font]);
      const terms = page.locator('[data-test=terms]'),
        model = page.locator('[data-test=model]');
      await terms.locator('.term-brick').first().waitFor();
      await model.locator('.token-meter-readout').waitFor();
      const filters = terms.locator('header .palboo-term-filters button');
      assert.equal(await filters.count(), 3);
      assert.deepEqual(
        (await filters.allTextContents()).map((text) => text.trim()),
        ['', '', ''],
      );
      assert.equal(await terms.locator('.term-module nav').count(), 0);
      const boxes = await terms.evaluate((n) => {
        const s = n.querySelector('.feature-mount').shadowRoot,
          b = s.querySelector('.feature-body').getBoundingClientRect(),
          t = s.querySelector('.term-brick').getBoundingClientRect();
        return {
          left: t.left - b.left,
          top: t.top - b.top,
          buttons: [...n.querySelectorAll('.palboo-term-filters button')].map((b) => ({
            w: b.getBoundingClientRect().width,
            h: b.getBoundingClientRect().height,
          })),
        };
      });
      assert.equal(boxes.left, 12);
      assert.equal(boxes.top, 12);
      assert.ok(boxes.buttons.every((b) => b.w >= 28 && b.h >= 28));
      await filters.nth(1).focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await terms.locator('.term-brick').allTextContents(), ['Viewport']);
      const meter = () =>
        model.evaluate((n) => {
          const s = n.querySelector('.feature-mount').shadowRoot,
            b = s.querySelector('.feature-body').getBoundingClientRect(),
            m = s.querySelector('.token-meter-readout').getBoundingClientRect(),
            a = s.querySelector('.model-preset-actions').getBoundingClientRect();
          return {
            top: m.top,
            bottom: m.bottom,
            inside: m.top >= b.top && m.bottom <= b.bottom && a.bottom <= b.bottom,
            bodyWidth: s.querySelector('.feature-body').clientWidth,
            scrollWidth: s.querySelector('.feature-body').scrollWidth,
          };
        });
      const before = await meter();
      assert.equal(before.inside, true, JSON.stringify({ width, height, before }));
      assert.ok(before.scrollWidth <= before.bodyWidth + 1);
      await model.locator('.model-favorites').evaluate((n) => {
        n.scrollTop = n.scrollHeight;
      });
      const after = await meter();
      assert.ok(Math.abs(before.top - after.top) < 1, 'scrolling models does not move the footer');
      await model
        .getByRole('button', { name: language === 'en' ? 'Edit preset' : '编辑预设', exact: true })
        .click();
      await page.keyboard.press('Escape');
      assert.equal(await model.locator('.model-preset-edit').getAttribute('aria-pressed'), 'false');
      geometry.push({ width, height, language, terms: boxes, meter: before });
    }
    assert.deepEqual(errors, []);
    mkdirSync('target/reports/compact-feature-layout', { recursive: true });
    writeFileSync(
      'target/reports/compact-feature-layout/geometry.json',
      JSON.stringify(geometry, null, 2),
    );
  } finally {
    await browser.close();
  }
});
