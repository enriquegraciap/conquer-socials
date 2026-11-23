'use strict';
// The leaderboard to share: one phone-shaped picture per social (the night and the month), a Share button, the full list.
// Needs the mock server: node tools/mock-server.js 8787 test-key
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch(), errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fran', 'Gaby', 'Hugo', 'Ines'];
  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.waitForSelector('.fmtpick');
  await admin.fill('#newSeries', 'Taco Tuesday'); await admin.click('.fmtpick [data-format="kings-individual"]'); await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  for (const c of [6, 7]) await admin.click(`.chip[data-court="${c}"]`);
  for (const n of NAMES) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await admin.click('#startNight');
  for (let round = 1; round <= 2; round++) {
    await admin.waitForSelector(`.roundhead .big:text("Round ${round}")`);
    for (const [a, b] of [[4, 1], [4, 3]]) {
      await admin.locator('.courtcard.todo').first().click();
      await admin.click(`.digits button[data-side="sa"][data-v="${a}"]`); await admin.click(`.digits button[data-side="sb"][data-v="${b}"]`); await admin.click('#saveScore');
    }
  }
  await admin.waitForSelector('.roundhead .big:text("Round 3")');
  const href = await admin.getAttribute('#boardLink', 'href');
  assert.match(href, /\/board\/\?db=.*&s=taco-tuesday$/, 'the organizer’s page links to it: ' + href);
  const board = await admin.evaluate(() => [...document.querySelectorAll('table.board tbody tr')].map(tr => [tr.children[1].textContent.trim(), Number(tr.children[5].textContent)]));
  await admin.waitForSelector('.sync:text("Saved")', { timeout: 15000 });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {                       // a phone's share sheet: remember what it was handed
    window.__shared = null;
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = d => { window.__shared = { title: d.title, files: (d.files || []).map(f => [f.name, f.type, f.size]) }; return Promise.resolve(); };
  });
  const phone = watch(await ctx.newPage(), 'phone');
  await phone.goto(href);
  await phone.waitForSelector('#card');
  const top = (await phone.getAttribute('#card', 'data-top')).split('|');
  assert.deepEqual(top, board.slice(0, 3).map(r => r[0] + ':' + r[1]), 'the same top three as the organizer’s table');
  assert.match(await phone.getAttribute('#card', 'aria-label'), /^Taco Tuesday: Standings so far\. 1\. /);
  assert.deepEqual((await phone.locator('.bd-tab').allTextContents()).map(t => t.trim().toLowerCase()).slice(0, 1), ['tonight']);
  const g = await phone.evaluate(() => { const c = document.getElementById('card'), r = c.getBoundingClientRect(), s = document.getElementById('share').getBoundingClientRect(); return { w: c.width, h: c.height, top: r.top, bottom: r.bottom, ratio: r.width / r.height, shareBottom: s.bottom, H: innerHeight, over: document.documentElement.scrollWidth > innerWidth }; });
  assert.deepEqual([g.w, g.h], [1080, 1920], 'the picture is a phone-shaped 1080 x 1920');
  assert.ok(Math.abs(g.ratio - 9 / 16) < 0.01 && g.top >= 0 && g.shareBottom <= g.H && !g.over, 'the whole picture and the Share button are on one screen: ' + JSON.stringify(g));
  await phone.screenshot({ path: SHOTS + 'board-phone.png' });
  step('the page shows tonight’s table as one picture that fits the screen, with the organizer’s top three');

  // Share hands the picture to the phone's share sheet
  await phone.click('#share');
  await phone.waitForFunction(() => !!window.__shared);
  const shared = await phone.evaluate(() => window.__shared);
  assert.equal(shared.title, 'Taco Tuesday');
  assert.match(shared.files[0][0], /^taco-tuesday-\d{4}-\d\d-\d\d\.png$/); assert.equal(shared.files[0][1], 'image/png'); assert.ok(shared.files[0][2] > 20000);
  // the month, and marking your own name
  const before = await phone.evaluate(() => document.getElementById('card').toDataURL().length);
  const mine = board[board.length - 1][0];
  await phone.click(`.bd-list button[data-name="${mine}"]`);
  await phone.waitForSelector(`.bd-list button.me[data-name="${mine}"]`);
  assert.notEqual(await phone.evaluate(() => document.getElementById('card').toDataURL().length), before, 'the picture was drawn again with the name marked');
  await phone.click('.bd-tab[data-view="month"]');
  assert.equal(await phone.getAttribute('#card', 'data-view'), 'month');
  assert.match(await phone.getAttribute('#card', 'aria-label'), / leaderboard\. 1\. /);
  await phone.reload(); await phone.waitForSelector('#card');
  assert.equal(await phone.locator('.bd-list button.me').count(), 1, 'the phone remembers whose it is');
  await phone.click('#copy');
  await phone.waitForSelector('#bdnote:not([hidden])');
  assert.match(await phone.textContent('#bdnote'), /Link copied\.|\/board\/\?/);
  step('Share gives the phone a PNG of the picture; a tapped name is marked and remembered; the month has its own picture');

  // the night ends: the same address now says "Final standings"
  await admin.click('#endNight'); await admin.click('#modalOk');
  await admin.waitForSelector('text=Night ended');
  await admin.waitForSelector('.sync:text("Saved")', { timeout: 15000 });
  await phone.reload(); await phone.waitForSelector('#card');
  assert.match(await phone.getAttribute('#card', 'aria-label'), /^Taco Tuesday: Final standings\./);
  // a wrong link says so; the other club has its own page
  await phone.goto(BASE + '/board/?db=' + DB + '&s=nothing-here');
  await phone.waitForSelector('text=This social was not found.');
  const t = await (await fetch(BASE + '/tempe/board/')).text();
  assert.ok(/SOCIALS_CLUB = 'tempe'/.test(t) && /board\.js/.test(t), 'Tempe has the page too');
  await phone.goto(BASE + '/tempe/board/?db=' + DB + '&s=taco-tuesday');
  await phone.waitForSelector('text=This social was not found.');
  step('after End night it reads Final standings; Tempe’s page does not see a Lehi social');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('E2E BOARD OK');
})().catch(e => { console.error(e); process.exit(1); });
