'use strict';
// Browser check of the second club (Tempe): its own pages, data and admin key, nothing shared with the first club;
// and the TV on a portrait screen. Start tools/mock-server.js first:  node test/e2e-tempe.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const TEAMS = [['Carter Maclean', 'Kasey Maclean'], ['Lexi Mecham', 'Spencer Mecham'], ['Amanda Rushton', 'Parker Rushton'], ['Silvia Martinez', 'Andres Martinez'], ['Jodi Ream', 'Tess Dunn']];

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  // one device (one browser profile) used for both clubs, as a manager's iPad might be
  const ipad = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const lehi = watch(await ipad.newPage(), 'lehi admin'), tempe = watch(await ipad.newPage(), 'tempe admin');
  const dump = async () => (await (await fetch(BASE + '/__dump')).json()).db;

  // 1. each club's admin page, with its own key
  await lehi.goto(BASE + '/?db=' + DB + '#k=test-key');
  await lehi.waitForSelector('.fmtpick');
  assert.equal((await lehi.textContent('.topbar h1')).trim(), 'Padel Socials');
  assert.equal(await lehi.locator('.fmtpick .fmt').count(), 3);
  await lehi.fill('#newSeries', 'Lehi Date Night'); await lehi.click('text=Create');
  await lehi.waitForSelector('text=Courts');
  await tempe.goto(BASE + '/tempe/?db=' + DB + '#k=tempe-key');
  await tempe.waitForSelector('.fmtpick');
  assert.equal((await tempe.textContent('.topbar h1')).trim(), 'Padel Socials · Tempe');
  assert.deepEqual(await tempe.locator('.fmtpick .fmt b').allTextContents(), ['Fixed partner, King’s Court', 'Individual, King’s Court'], 'no Wheel of Fortune in Tempe');
  assert.equal(await tempe.locator('[data-open]').count(), 0, 'Tempe starts empty: it does not see the other club’s events');
  await tempe.fill('#newSeries', 'Kings of the Desert'); await tempe.click('text=Create');
  await tempe.waitForSelector('text=Courts');
  for (const c of [1, 2]) await tempe.click(`.chip[data-court="${c}"]`);
  for (const t of TEAMS) { await tempe.fill('#p1', t[0]); await tempe.fill('#p2', t[1]); await tempe.click('#addTeam'); }
  await tempe.waitForSelector('text=5 teams on 2 courts');
  let db = await dump();
  assert.deepEqual(Object.keys(db.pub.series), ['lehi-date-night']);
  assert.deepEqual(Object.keys(db.tempe.series), ['kings-of-the-desert']);
  assert.ok(!db.pub.sessions || !db.pub.sessions['kings-of-the-desert'], 'nothing of Tempe’s is in the first club’s part');
  step('two clubs, two sets of events; Tempe offers the two King’s Court formats only');

  // 2. the keys do not cross: on the same device each club remembers its own, and the other club's key is refused
  await lehi.click('text=Events');
  assert.deepEqual((await lehi.locator('[data-open]').allTextContents()).map(t => t.trim().split('  ')[0]), ['Lehi Date Night']);
  const stored = await lehi.evaluate(() => Object.keys(localStorage).filter(k => /adminKey/.test(k)).sort().map(k => k + '=' + localStorage.getItem(k)));
  assert.deepEqual(stored, ['socials.adminKey=test-key', 'socials.tempe.adminKey=tempe-key']);
  const wrong = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 } })).newPage(), 'wrong key');
  await wrong.goto(BASE + '/tempe/?db=' + DB + '#k=test-key');                 // a Lehi key on the Tempe page
  await wrong.waitForSelector('#addTeam');                                       // (with one event the page opens it)
  await wrong.fill('#p1', 'Should'); await wrong.fill('#p2', 'Not Exist'); await wrong.click('#addTeam');
  await wrong.waitForSelector('text=That key was not accepted');
  const bad = await fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify({ 'gate/test-key': Date.now(), 'tempe/series/x': { name: 'x' } }) });
  const bad2 = await fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify({ 'gate/tempe-key': Date.now(), 'pub/series/x': { name: 'x' } }) });
  assert.deepEqual([bad.status, bad2.status], [401, 401], 'the database refuses one club’s key for the other club’s data');
  db = await dump();
  assert.deepEqual([Object.keys(db.pub.series), Object.keys(db.tempe.series)], [['lehi-date-night'], ['kings-of-the-desert']]);
  step('each club’s key opens only its own club, in the page and in the database');

  // 3. Tempe's TV: its own address, only its own events, the QR code leads to its own phone page
  const wide = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv wide');
  const tall = watch(await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage(), 'tv tall');
  await wide.goto(BASE + '/tempe/tv/?db=' + DB); await tall.goto(BASE + '/tempe/tv/?db=' + DB);
  await wide.waitForSelector('text=5 teams checked in');
  await tall.waitForSelector('text=5 teams checked in');
  assert.equal((await wide.textContent('#bartitle')).trim(), 'Kings of the Desert', 'with one event of its own, the Tempe TV shows it');
  const lehiTv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'lehi tv');
  await lehiTv.goto(BASE + '/tv/?db=' + DB);
  await lehiTv.waitForFunction(() => /Lehi Date Night/i.test(document.getElementById('bartitle').textContent), null, { timeout: 10000 });
  await tempe.click('#startNight');
  await wide.waitForSelector('.tvcourt', { timeout: 10000 });
  await tall.waitForSelector('.tvcourt', { timeout: 10000 });
  await tall.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 12000 });
  await wide.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 12000 });
  const link = await wide.evaluate(() => window.Store.link('player', { s: 'kings-of-the-desert' }));
  assert.ok(link.startsWith(BASE + '/tempe/p/?'), 'players are sent to the Tempe phone page: ' + link);
  assert.equal(await lehiTv.locator('.tvcourt').count(), 0, 'nothing happens on the other club’s TV');

  // 4. a phone sends a score for Tempe without a key; it lands in Tempe's part only
  const phone = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage(), 'phone');
  await phone.goto(link);
  await phone.waitForSelector('#rolePlayer', { timeout: 15000 });
  await phone.tap('#rolePlayer');
  const playing = await tempe.evaluate(() => [...document.querySelectorAll('.courtcard.todo .tm div')].map(d => d.textContent.trim()));
  await phone.tap(`.pl-pick[data-team="${playing[0]}"]`);
  await phone.waitForSelector('.pl-digits');
  await phone.tap('.pl-digits button[data-who="us"][data-v="4"]'); await phone.tap('.pl-digits button[data-who="them"][data-v="2"]'); await phone.tap('#send');
  await tempe.waitForFunction(() => document.querySelectorAll('.courtcard.todo').length === 1, null, { timeout: 10000 });
  db = await dump();
  assert.ok(!db.pub.scores && db.tempe.scores && db.tempe.scores['kings-of-the-desert'], 'the phone’s score went to Tempe’s part');
  step('Tempe TV and phones work on their own addresses; the Lehi TV is untouched');

  // 5. the same TV page on a landscape and on a portrait screen
  await tall.waitForSelector('.tvcourt.done', { timeout: 10000 });
  await tall.waitForTimeout(9000);                                                // (fireworks over)
  const boxes = p => p.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const boards = [...document.querySelectorAll('.tvboard')].map(e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; });
    return { left: r('.tvleft'), courts: r('.tvcourts'), right: r('.tvright'), boards, sign: r('.tvsit.sign'), qr: r('.tvqr'), date: r('#date'), W: innerWidth, H: innerHeight,
      over: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      cut: [...document.querySelectorAll('.tvrow .nm, .tvcourt .tm')].filter(e => e.scrollWidth > e.clientWidth + 1).length }; });
  const L = await boxes(wide), P = await boxes(tall);
  assert.ok(L.right.l >= L.left.r && Math.abs(L.right.t - L.left.t) < 4, 'landscape: the leaderboards are beside the courts');
  assert.ok(L.boards[1].t >= L.boards[0].b, 'landscape: one leaderboard above the other');
  assert.ok(L.sign.t >= L.courts.b && L.sign.r <= L.right.l, 'landscape: the sign and QR code stay under the courts, on the left');
  assert.ok(P.right.t >= P.courts.b && P.right.w > P.W * 0.9, 'portrait: the leaderboards are under the courts, full width');
  assert.ok(Math.abs(P.boards[0].t - P.boards[1].t) < 4 && P.boards[1].l >= P.boards[0].r, 'portrait: tonight and the month side by side');
  assert.ok(P.sign.t >= P.right.b - 1 && P.qr.t >= P.right.b - 1 && P.qr.l >= P.sign.r, 'portrait: last, the sign with the QR code to its right');
  assert.ok(P.date.t >= P.sign.b - 1 && P.date.t >= P.qr.b - 1, 'portrait: date and clock at the very foot');
  assert.ok(!L.over && !P.over, 'nothing runs off either screen');
  assert.deepEqual([L.cut, P.cut], [0, 0], 'no name is cut off on either screen');
  assert.equal((await tall.textContent('.tvboard >> nth=0 >> h2')).trim().slice(0, 7), 'Tonight');
  await tall.screenshot({ path: SHOTS + 'tempe-tv-portrait.png' });
  await wide.screenshot({ path: SHOTS + 'tempe-tv-landscape.png' });
  // a second event: the TV's main menu lists Tempe's events only, also on the portrait screen
  await tempe.click('text=Events');
  await tempe.fill('#newSeries', 'Tempe Tapas Night'); await tempe.click('.fmtpick [data-format="kings-individual"]'); await tempe.click('text=Create');
  await tempe.waitForSelector('text=Courts');
  const menu = watch(await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage(), 'tv menu');
  await menu.goto(BASE + '/tempe/tv/?db=' + DB);
  await menu.waitForSelector('.tvmenu .pickbtn', { timeout: 10000 });
  const items = (await menu.locator('.tvmenu .pickbtn b').allTextContents()).map(t => t.trim());
  assert.ok(items.includes('Kings of the Desert') && items.includes('Tempe Tapas Night') && !items.some(t => /Lehi/i.test(t)), 'menu: ' + items.join(', '));
  assert.equal(await menu.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await menu.screenshot({ path: SHOTS + 'tempe-tv-menu-portrait.png' });
  // flyers are per club too
  const fly = watch(await ipad.newPage(), 'flyers');
  await fly.goto(BASE + '/tempe/flyers/?db=' + DB);
  await fly.waitForSelector('.topbar h1');
  assert.equal((await fly.textContent('.topbar h1')).trim(), 'Club flyers · Tempe');
  step('one TV page: leaderboards beside the courts on a landscape screen, under them on a portrait one');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E TEMPE OK');
})().catch(e => { console.error(e); process.exit(1); });
