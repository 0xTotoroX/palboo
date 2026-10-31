/* [INPUT]: Actual per-window font forms, host sampler, settings theme and feature views.
 * [OUTPUT]: Independent sources/families/sizes, retained drafts, original theme and responsive roles.
 * [POS]: Isolated browser fixture with synthetic text; no user preferences or host settings.
 * [PROTOCOL]: Keep tests/AGENTS.md in sync. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test(
  'each window owns its typography while navigation retains drafts and themes retain layout',
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SurfaceTypographySettings} from './ui/settings/typography-settings';
import {SettingsTheme} from './ui/settings/settings-theme';
import {FeatureView} from './ui/surfaces/workspace/feature-session';
import {defaultTypography, fallbackTypography, surfaceTypography} from './ui/shared/typography';
import {createTypographyTracker} from './ui/codex/typography';
import {setLocale} from './ui/shared/i18n.js';
const raw={...fallbackTypography,source:'body',fontFamily:'serif',fontSize:18,lineHeight:27,sources:{body:{...fallbackTypography,source:'body',fontFamily:'serif',fontSize:18,lineHeight:27},session:{...fallbackTypography,source:'session',fontFamily:'monospace',fontSize:14,lineHeight:21},composer:{...fallbackTypography,source:'composer',fontSize:20,lineHeight:30}}};
const host={theme:'light',typography:{...fallbackTypography,fontSize:16,source:'interface'},colors:{page:'#ffffff',text:'#1f2328'},geometry:{navFontSize:'15px',navLineHeight:'20px',headingSize:'16px'}};
window.saved={};window.fail=false;window.calls=[];window.language=setLocale;
window.tracker=createTypographyTracker(()=>document.querySelector('#chat'),()=>document.querySelector('#composer'));
function App(){const [fonts,setFonts]=useState({});const [theme,setTheme]=useState('chatgpt');window.styleSource=setTheme;
const appearance={revision:0,ui:{},surfaceTypography:fonts,typography:defaultTypography,settingsStyle:theme};
return <div className="settings-app"><SettingsTheme codexTheme="light" hostAppearance={host} typography={raw} appearance={appearance}/>
<nav className="settings-nav"><div className="settings-nav-children"><a className="settings-nav-link" href="#settings-appearance"><span>外观与字体</span></a></div></nav>
<main className="settings-content"><section id="fonts" className="settings-form-column"><SurfaceTypographySettings value={fonts} legacy={defaultTypography} save={async(surface,value)=>{window.calls.push({surface,value});if(window.fail)return false;window.saved={...window.saved,[surface]:value};setFonts(window.saved);return true;}}/></section>
<div id="views">{['sidebar','overlay','desktop','edge'].map(placement=><div id={'view-'+placement} key={placement}><FeatureView entry={{id:'terms',owner:placement,open:true,pending:null,view:{},size:[400,500],reveal:0,placement}} owner={placement} request={async()=>({appearance:{typography:raw,typographyPreferences:surfaceTypography(placement,fonts,defaultTypography)},entries:[],preferences:{favorites:[],mastered:[]},involved:[]})} onState={()=>{}}/></div>)}</div></main></div>}
createRoot(document.querySelector('#root')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      loader: { '.css': 'text' },
    });
    const html = await readFile('target/web/index.html', 'utf8');
    let css = '';
    for (const [, href] of html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g))
      css += await readFile(`target/web${href}`, 'utf8');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        reducedMotion: 'reduce',
        viewport: { width: 1200, height: 900 },
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent(
        '<div id="root"></div><aside class="app-shell-left-panel"><a href="/threads/a">标题</a></aside><main id="chat"><div class="markdown"><p style="font:18px/27px serif">正文</p></div><div id="composer" contenteditable style="font:20px/30px sans-serif">输入</div></main>',
      );
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.locator('#typography-surface').waitFor();
      const choose = (surface) => page.locator('#typography-surface').selectOption(surface);
      const rendered = () =>
        page.evaluate(() =>
          Object.fromEntries(
            ['sidebar', 'overlay', 'desktop', 'edge'].map((surface) => {
              const style = getComputedStyle(
                document.querySelector('#view-' + surface + ' .feature-view'),
              );
              return [surface, { size: style.fontSize, family: style.fontFamily }];
            }),
          ),
        );
      await page.locator('#view-edge .feature-view').waitFor();
      assert.ok(Object.values(await rendered()).every((value) => value.size === '18px'));
      assert.equal(
        await page.locator('html').evaluate((e) => getComputedStyle(e).fontSize),
        '16px',
      );
      await page.evaluate(() => window.tracker.snapshot());
      await page.waitForTimeout(220);
      const sample = await page.evaluate(() => {
        window.tracker.configure({
          surfaces: {
            sidebar: { source: 'composer', mode: 'follow', scale: 110 },
            desktop: { mode: 'custom', customSize: 23, fontFamily: 'monospace' },
          },
        });
        return {
          raw: window.tracker.snapshot(),
          sidebar: window.tracker.resolved('sidebar'),
          desktop: window.tracker.resolved('desktop'),
          overlay: window.tracker.resolved('overlay'),
        };
      });
      assert.equal(sample.sidebar.fontSize, 22);
      assert.equal(sample.desktop.fontSize, 23);
      assert.ok(sample.desktop.fontFamily.startsWith('monospace'));
      assert.equal(sample.overlay.fontSize, 18);
      assert.equal(sample.raw.sources.body.fontSize, 18);
      assert.equal(sample.raw.sources.composer.fontSize, 20);
      for (const [surface, size] of [
        ['sidebar', 21],
        ['overlay', 22],
        ['desktop', 23],
        ['edge', 24],
      ]) {
        await choose(surface);
        await page.locator('#typography-' + surface + '-mode').selectOption('custom');
        await page.locator('#typography-' + surface + '-size').fill(String(size));
        await page.locator('#typography-' + surface + '-size').press('Enter');
        await page
          .locator('#typography-' + surface + '-family')
          .selectOption('ui-monospace,monospace');
        await page.waitForFunction(
          ({ surface, size }) =>
            getComputedStyle(document.querySelector('#view-' + surface + ' .feature-view'))
              .fontSize ===
            size + 'px',
          { surface, size },
        );
        assert.equal(
          await page.locator('html').evaluate((e) => getComputedStyle(e).fontSize),
          '16px',
        );
      }
      const values = await rendered();
      assert.deepEqual(
        Object.values(values).map((v) => v.size),
        ['21px', '22px', '23px', '24px'],
      );
      assert.ok(Object.values(values).every((v) => v.family.includes('monospace')));
      await choose('settings');
      await page.locator('#typography-settings-mode').selectOption('custom');
      await page.locator('#typography-settings-size').fill('24');
      await page.locator('#typography-settings-size').press('Enter');
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).fontSize === '24px',
      );
      assert.equal(
        await page.locator('.settings-nav-link').evaluate((e) => getComputedStyle(e).fontSize),
        '22.5px',
      );
      assert.deepEqual(await rendered(), values);
      await page.locator('#typography-settings-family').selectOption('ui-monospace,monospace');
      await page.waitForFunction(() =>
        getComputedStyle(document.querySelector('.settings-nav-link')).fontFamily.includes(
          'monospace',
        ),
      );
      assert.ok(
        await page
          .locator('#typography-settings-mode')
          .evaluate((e) => getComputedStyle(e).fontFamily.includes('monospace')),
      );
      // Switching windows is navigation and must neither save nor discard an invalid draft.
      await choose('sidebar');
      await page.locator('#typography-sidebar-size').fill('99');
      const count = await page.evaluate(() => window.calls.length);
      await choose('desktop');
      await choose('sidebar');
      assert.equal(await page.locator('#typography-sidebar-size').inputValue(), '99');
      assert.equal(await page.evaluate(() => window.calls.length), count);
      await page.locator('#typography-sidebar-size').press('Enter');
      assert.equal(await page.evaluate(() => window.calls.length), count);
      await page.locator('#typography-sidebar-size').fill('20');
      await page.evaluate(() => (window.fail = true));
      await page.locator('#typography-sidebar-size').press('Enter');
      await choose('edge');
      await choose('sidebar');
      assert.equal(await page.locator('#typography-sidebar-size').inputValue(), '20');
      assert.equal((await rendered()).sidebar.size, '21px');
      await page.evaluate(() => (window.fail = false));
      await page.locator('#typography-sidebar-mode').selectOption('follow');
      await page.locator('#typography-sidebar-source').selectOption('session');
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('#view-sidebar .feature-view')).fontSize ===
          '14px',
      );
      for (const theme of ['palboo', 'chatgpt']) {
        await page.evaluate((theme) => window.styleSource(theme), theme);
        await page.waitForFunction(
          (theme) => document.documentElement.dataset.settingsStyle === 'chatgpt',
          theme,
        );
        assert.equal(
          await page.locator('html').evaluate((e) => getComputedStyle(e).fontSize),
          '24px',
        );
        for (const width of [390, 740, 1200]) {
          await page.setViewportSize({ width, height: 900 });
          await choose('settings');
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
        }
      }
      await choose('settings');
      await page.locator('#typography-settings-mode').selectOption('follow');
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).fontSize === '16px',
      );
      await page.evaluate(() => window.styleSource('palboo'));
      await page.waitForFunction(
        () => document.documentElement.dataset.settingsStyle === 'chatgpt',
      );
      assert.equal(
        await page.locator('html').evaluate((e) => getComputedStyle(e).fontSize),
        '16px',
      );
      await page.evaluate(() => window.language('en'));
      assert.equal(
        await page.locator('#typography-surface option:checked').textContent(),
        'Settings',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
