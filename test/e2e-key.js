'use strict';
// The admin key stays on the device, also when the app is shown inside the club's own page (wrap.js) and the
// browser throws away what the framed page stored (an iPad's Safari does, whenever it reloads the tab).
// Start tools/mock-server.js first:  node test/e2e-key.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const APP = 'http://localhost:8787', CLUB = 'http://127.0.0.1:8787', DB = APP + '/db';       // two different sites, as in real life

(async () => {
  await fetch(APP + '/__reset');
  // (the two test sites are both on this machine: let the browser load one from the other)
  const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'] }), ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const step = m => console.log('  ' + m);
  // the club's page: one line that loads wrap.js from the app's site
  await page.route(CLUB + '/socials*', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><script src="' + APP + '/wrap.js"></script></body></html>' }));
  const url = CLUB + '/socials?db=' + encodeURIComponent(DB) + '&wrapper=' + encodeURIComponent(CLUB);
  const app = () => page.frameLocator('#cq-socials');
  const frame = () => page.frames().find(f => f.url().indexOf(APP + '/') === 0);
  const db = async () => (await (await fetch(APP + '/__dump')).json()).db.pub || {};
  const create = async name => { await app().locator('#newSeries').fill(name); await app().locator('text=Create').first().click(); };
  const forget = async () => { await frame().evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await ctx.clearCookies(); };

  // 1. the key arrives once (here in a staff link); the app saves with it and the club's page remembers it too
  await page.goto(url + '#k=test-key');
  await app().locator('.fmtpick').waitFor();
  await create('Key Night One');
  await app().locator('text=Courts').first().waitFor();
  assert.ok((await db()).series['key-night-one'], 'saved with the key from the link');
  await page.waitForFunction(() => localStorage.getItem('cq-socials-key') === 'test-key');
  assert.ok(!/k=/.test(frame().url()), 'the key does not stay in the app\'s address');
  step('key typed once: saved, and remembered by the club\'s page');

  // 2. the browser forgets everything the framed app stored (Safari on an iPad), the tab is reloaded: no key is asked for
  await forget();
  await page.goto(url); await page.reload();
  await app().locator('.topbar h1').waitFor();
  assert.equal(await frame().evaluate(() => window.Store.getKey()), 'test-key', 'the club\'s page handed the key back');
  if (!(await app().locator('.fmtpick').count())) await app().locator('text=Events').first().click();
  await create('Key Night Two');
  await app().locator('text=Courts').first().waitFor();
  assert.ok((await db()).series['key-night-two'], 'saved after the reload without typing the key again');
  assert.equal(await app().locator('#keyInput').count(), 0, 'no key box');
  step('framed storage wiped and tab reloaded: still saving, nobody asked for the key');

  // 3. while the page stays open, the key survives the storage being cleared under it
  await forget();
  assert.equal(await frame().evaluate(() => window.Store.getKey()), 'test-key', 'kept in memory while the page is open');
  step('storage cleared under an open page: the key is still there');

  // 4. a device that has never had the key is still asked for it, and typing it once is enough from then on
  await page.evaluate(() => localStorage.clear());
  await forget();
  await page.goto(url); await page.reload();
  await app().locator('.topbar h1').waitFor();
  assert.equal(await frame().evaluate(() => window.Store.getKey()), '', 'no key on a new device');
  if (!(await app().locator('.fmtpick').count())) await app().locator('text=Events').first().click();
  await create('Key Night Three');
  await app().locator('#keyInput').waitFor();
  await app().locator('#keyInput').fill('test-key');
  await app().locator('#keyInput').press('Enter');
  await app().locator('text=Courts').first().waitFor();
  assert.ok((await db()).series['key-night-three'], 'saved once the key was typed');
  await page.waitForFunction(() => localStorage.getItem('cq-socials-key') === 'test-key');
  step('new device: asked once, then remembered again');

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('admin key: all good');
})().catch(e => { console.error(e); process.exit(1); });
