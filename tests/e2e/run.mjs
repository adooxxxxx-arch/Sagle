// End-to-end test: drives the real Aether UI in Chromium against local fixtures.
// Usage: npm run test:e2e   (screenshots → test-results/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ARTICLE_TITLE, startFixtures } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = new URL('../../test-results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PORT = 5174;
const APP = `http://localhost:${PORT}`;
const results = [];
let page;
let failed = 0;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`PASS  ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    failed++;
    results.push(`FAIL  ${name}: ${e.message.split('\n').slice(0, 3).join(' ')}`);
    await page?.screenshot({ path: OUT + `fail-${failed}.png` }).catch(() => {});
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const fixtures = await startFixtures(8765);
// The escape hatch lets the server fetch 127.0.0.1 fixtures. Never set on a real deployment.
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, AETHER_ALLOW_PRIVATE_NETWORK: '1' },
  stdio: 'ignore',
});
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(APP)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
const address = () => page.getByRole('textbox', { name: 'Address and search bar' });
const go = async (url) => {
  await address().click();
  await address().fill(url);
  await address().press('Enter');
};

try {
  await step('app boots to the new tab page', async () => {
    await page.goto(APP);
    await page.getByPlaceholder('Search the web or enter an address').waitFor({ timeout: 10000 });
    await page.screenshot({ path: OUT + '01-newtab-dark.png' });
  });

  await step('site that forbids framing opens in Reader view with real extraction', async () => {
    await go(`${fixtures.base}/article`);
    await page.locator('article.reader h1', { hasText: ARTICLE_TITLE }).waitFor({ timeout: 15000 });
    const bar = await page.getByText('(this site blocks embedding)').count();
    assert(bar === 1, 'info bar should explain the reader fallback');
    const body = await page.locator('article.reader').innerText();
    assert(body.includes('amorphous solid'), 'article text missing');
    assert(!body.includes('Home · World'), 'nav boilerplate should be stripped');
    const scripts = await page.locator('article.reader script').count();
    assert(scripts === 0, 'scripts must not be rendered');
    const onclick = await page.locator('article.reader [onclick]').count();
    assert(onclick === 0, 'event handler attributes must be stripped');
    assert((await page.title()) !== 'hacked', 'page scripts must not run');
    const checked = await page.getByRole('radiogroup', { name: 'View mode' }).getByRole('radio', { checked: true }).innerText();
    assert(checked.trim() === 'Reader', 'toolbar view mode shows ' + checked);
    await page.screenshot({ path: OUT + '02-reader.png' });
  });

  await step('page report shows measured trackers and discarded cookies', async () => {
    await page.getByRole('button', { name: /Page report/ }).click();
    const report = await page.locator('text=Trackers referenced').locator('..').innerText();
    assert(/Trackers referenced \((\d+)\)/i.test(report) && Number(report.match(/\((\d+)\)/)[1]) >= 2, 'expected ≥2 trackers: ' + report);
    const cookies = await page.locator('text=Cookies the site set').locator('..').innerText();
    assert(cookies.includes('2'), 'expected 2 cookies: ' + cookies);
    await page.screenshot({ path: OUT + '03-page-report.png' });
    await page.getByRole('button', { name: /Page report/ }).click();
  });

  await step('highlight from reader selection persists as a mark', async () => {
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('article.reader p')].find((x) => x.textContent.includes('float glass'));
      const range = document.createRange();
      const text = p.firstChild;
      range.setStart(text, 0);
      range.setEnd(text, 'Modern float glass'.length);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Highlight' }).click();
    await page.locator('mark[data-aether-hl]', { hasText: 'Modern float glass' }).waitFor({ timeout: 3000 });
  });

  await step('embeddable site renders in a sandboxed live iframe', async () => {
    await page.locator('article.reader a', { hasText: 'companion piece' }).click();
    const frame = page.locator('iframe[title]');
    await frame.waitFor({ timeout: 15000 });
    const src = await frame.getAttribute('src');
    assert(src === `${fixtures.base}/embeddable`, 'iframe src ' + src);
    const sandbox = await frame.getAttribute('sandbox');
    assert(sandbox.includes('allow-scripts') && !sandbox.includes('allow-top-navigation'), 'sandbox ' + sandbox);
    assert((await frame.getAttribute('referrerpolicy')) === 'no-referrer', 'referrer policy');
    const inner = page.frameLocator('iframe[title]').getByRole('heading', { name: 'Companion Piece' });
    await inner.waitFor({ timeout: 10000 });
    await page.screenshot({ path: OUT + '04-live.png' });
  });

  await step('back navigation and bookmark shortcut', async () => {
    await page.getByRole('button', { name: 'Back' }).click();
    await page.locator('article.reader h1', { hasText: ARTICLE_TITLE }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Alt+KeyD');
    await page.getByText('Bookmarked').waitFor({ timeout: 3000 });
  });

  await step('AI assistant streams a cited answer using only the shared page', async () => {
    await page.goto(`${APP}/`);
    await page.getByRole('tablist', { name: 'Workspaces' }).waitFor();
    await page.keyboard.press('Control+KeyK');
    await page.getByRole('textbox', { name: 'Command' }).fill('settings');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'AI' }).waitFor();
    await page.getByRole('button', { name: /OpenAI-compatible/ }).click();
    await page.getByLabel('OpenAI-compatible (your key) API key').fill('sk-test-123');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByLabel('Model').fill('fixture-model');
    await page.getByLabel('Base URL').fill(`${fixtures.base}/v1`);
    // Reopen the article tab via history
    await go(`${fixtures.base}/article`);
    await page.locator('article.reader h1 >> visible=true').waitFor({ timeout: 15000 });
    await page.keyboard.press('Alt+KeyA');
    await page.getByRole('radio', { name: 'Page' }).click();
    await page.getByLabel('Message the assistant').fill('Summarize this page');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.locator('aside[aria-label="AI assistant"] .md table').waitFor({ timeout: 10000 });
    const cites = await page.locator('aside[aria-label="AI assistant"] a.cite').count();
    assert(cites >= 2, 'expected citation chips, got ' + cites);
    const req = fixtures.aiRequests.at(-1);
    assert(req.auth === 'Bearer sk-test-123', 'API key not sent from browser');
    const sys = req.body.messages[0].content;
    assert(sys.includes('amorphous solid') && sys.includes('[1]'), 'page text should be in the system prompt as source [1]');
    assert(!sys.includes('window.evil'), 'scripts must not leak into AI context');
    await page.screenshot({ path: OUT + '05-ai.png' });
  });

  await step('context "None" sends no page content', async () => {
    await page.getByRole('radio', { name: 'None' }).click();
    await page.getByLabel('Message the assistant').fill('What is 2+2?');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.waitForTimeout(800);
    const sys = fixtures.aiRequests.at(-1).body.messages[0].content;
    assert(!sys.includes('amorphous solid'), 'page content leaked with context None');
  });

  await step('privacy center shows measured stats', async () => {
    await page.keyboard.press('Alt+KeyP');
    await page.getByRole('heading', { name: /Privacy center/ }).waitFor();
    const stat = await page.locator('text=Pages analyzed').locator('..').innerText();
    assert(Number(stat.split('\n')[0]) >= 1, 'pages analyzed ' + stat);
    await page.screenshot({ path: OUT + '06-privacy.png', fullPage: false });
  });

  await step('private workspace needs consent before sharing a page with AI', async () => {
    await page.getByRole('tab', { name: 'Private' }).click();
    await go(`${fixtures.base}/article`);
    await page.locator('article.reader h1 >> visible=true').waitFor({ timeout: 15000 });
    const before = fixtures.aiRequests.length;
    await page.getByRole('radio', { name: 'Page' }).click();
    await page.getByLabel('Message the assistant').fill('Summarize');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('dialog', { name: 'Share private browsing with AI?' }).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(400);
    assert(fixtures.aiRequests.length === before, 'request sent without consent');
    await page.screenshot({ path: OUT + '07-private.png' });
  });

  await step('reload: persistent workspace restored, private workspace erased, no history from private', async () => {
    await page.reload();
    await page.getByRole('tab', { name: 'Personal' }).waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Private' }).click();
    const privateTabs = await page.locator('nav[aria-label="Open tabs"] li').allInnerTexts();
    assert(privateTabs.length === 1 && privateTabs[0].includes('New Tab'), 'private tabs persisted: ' + privateTabs);
    await page.getByRole('tab', { name: 'Personal' }).click();
    const tabs = await page.locator('nav[aria-label="Open tabs"] li').allInnerTexts();
    assert(tabs.some((t) => t.includes(ARTICLE_TITLE)), 'personal tabs lost: ' + tabs);
    const hist = await page.evaluate(async () => {
      const raw = await new Promise((res) => {
        const r = indexedDB.open('aether');
        r.onsuccess = () => {
          const g = r.result.transaction('kv').objectStore('kv').get('aether-browser');
          g.onsuccess = () => res(g.result);
        };
      });
      return JSON.parse(raw).state;
    });
    const priv = hist.workspaces.find((w) => w.name === 'Private');
    assert(!hist.history.some((h) => h.workspaceId === priv.id), 'private history written to disk');
    assert(!hist.tabs.some((t) => t.workspaceId === priv.id), 'private tabs written to disk');
  });

  await step('light theme + mobile layout render', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.keyboard.press('Alt+KeyT');
    await page.getByPlaceholder('Search the web or enter an address').locator('visible=true').waitFor();
    await page.screenshot({ path: OUT + '08-newtab-light.png' });
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(APP);
    await mp.getByPlaceholder('Search the web or enter an address').locator('visible=true').waitFor();
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!overflow, 'horizontal overflow on mobile');
    await mp.screenshot({ path: OUT + '09-mobile.png' });
    await mp.getByRole('button', { name: 'Tabs and workspaces' }).click();
    await mp.screenshot({ path: OUT + '10-mobile-sidebar.png' });
    await m.close();
  });

  await step('no uncaught errors in the console', async () => {
    const real = consoleErrors.filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
    assert(real.length === 0, real.join(' | '));
  });
} finally {
  await browser.close();
  vite.kill();
  fixtures.server.close();
}

console.log(results.join('\n'));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
