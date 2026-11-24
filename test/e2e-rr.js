'use strict';
// Browser check of the round robin format, a double points night and a social's own table
// (start tools/mock-server.js first):  node test/e2e-rr.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const NAMES = ['Ana Ruiz', 'Bruno Diaz', 'Carla Gil', 'Diego Mora', 'Elena Paz', 'Fran Soto', 'Gaby Luna', 'Hugo Rey', 'Ines Vega', 'Juan Cano'];

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv');
  const board = watch(await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage(), 'board');
  const db = async () => (await (await fetch(BASE + '/__dump')).json()).db.pub;
  const patch = body => fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify(Object.assign({ 'gate/test-key': Date.now() }, body)) });

  // 1. the format is offered, and creating the event keeps it
  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.waitForSelector('.fmtpick');
  assert.deepEqual(await admin.locator('.fmtpick .fmt b').allTextContents(), ['Fixed partner, King’s Court', 'Individual, King’s Court', 'Wheel of Fortune', 'Individual, Round Robin', 'Fixed partner, Round Robin']);
  await admin.fill('#newSeries', 'Taco Tuesday Fall Series');
  await admin.click('.fmtpick [data-format="rr-individual"]');
  await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  const id = Object.keys((await db()).series)[0];
  assert.deepEqual([(await db()).series[id].format, (await db()).series[id].scoring], ['rr-individual', 'player']);
  step('event created as Individual, Round Robin (' + id + ')');

  // 2. setup: no King's Court anywhere, no seeding, and the points can be doubled
  assert.equal(await admin.locator('text=King').count(), 0, 'the setup page does not mention King’s Court');
  assert.equal(await admin.locator('text=Seeded').count(), 0);
  await admin.waitForSelector('text=Every round is a new random mix');
  for (const c of [3, 4]) await admin.click(`.chip[data-court="${c}"]`);
  assert.equal((await admin.textContent('.ladder')).trim(), 'Courts 3 · 4');
  for (const n of NAMES) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await admin.waitForSelector('text=10 players on 2 courts: 8 play, 2 sit out each round.');
  assert.equal(await admin.getAttribute('[data-mult].on', 'data-mult'), '1', 'normal points unless chosen');
  await admin.click('[data-mult="2"]');
  await admin.waitForSelector('text=Double points: every game won is 2 points');
  await admin.screenshot({ path: SHOTS + 'rr-setup.png', fullPage: true });

  // 3. the social's own table: a name and the points people bring along
  const k = n => 'k_' + n.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const start = {};
  [['Ana Ruiz', 24], ['Zed Away', 66], ['Bruno Diaz', 5]].forEach(([n, p]) => { start[k(n)] = { name: n, points: p }; });
  await patch({ ['pub/series/' + id + '/table']: { name: 'Fall Series', start: start } });

  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=10 players checked in');
  assert.equal(await tv.locator('text=King').count(), 0, 'the TV does not mention King’s Court before the start');
  await tv.waitForFunction(() => [...document.querySelectorAll('.tvboard h2')].some(h => /Fall Series/.test(h.textContent)), null, { timeout: 15000 });
  await admin.click('#startNight');
  await tv.waitForSelector('.tvcourt', { timeout: 8000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 8000 });
  assert.equal(await tv.locator('.tvcourt.king').count(), 0);
  assert.deepEqual(await tv.locator('.tvcourt .cn span').allTextContents(), ['Court', 'Court']);
  assert.deepEqual(await tv.locator('.tvcourt .cn b').allTextContents(), ['3', '4']);
  assert.match(await tv.textContent('.tvhead .event'), /Sets to 4 · Double points/);
  step('round 1 on the TV: two plain courts, "Double points" beside the set length');

  // 4. a 4-1 set: 8 points and 2 points, today and on the Fall Series table (which starts from what they brought)
  const list = v => v === undefined || v === null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v];
  const s1 = () => db().then(d => { const all = d.sessions[id], x = all[Object.keys(all)[0]]; x.rounds = list(x.rounds); x.rounds.forEach(r => { r.courts = list(r.courts); r.sitting = list(r.sitting); }); return x; });
  let s = await s1();
  const c0 = s.rounds[0].courts[0], nameOf = pid => s.teams[pid].name;
  const winners = list(c0.a).map(nameOf), losers = list(c0.b).map(nameOf);
  await admin.click('.courtcard[data-court="3"]');
  await admin.waitForSelector('text=Double points: type the score as played');
  await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="1"]');
  await admin.click('#saveScore');
  await tv.waitForFunction(() => /4 – 1/.test(document.body.textContent), null, { timeout: 8000 });
  const boardRows = i => tv.evaluate(i => [...document.querySelectorAll('.tvboard')[i].querySelectorAll('.tvrow')].map(r => [r.querySelector('.nm').textContent.replace(/\(.*?\)/g, '').trim(), Number(r.querySelector('.pt').textContent)]), i);
  await tv.waitForFunction(() => { const r = document.querySelector('.tvboard .tvrow .pt'); return r && r.textContent === '8'; }, null, { timeout: 8000 });
  const today = Object.fromEntries(await boardRows(0)), table = Object.fromEntries(await boardRows(1));
  winners.forEach(n => assert.equal(today[n], 8, n + ' has 8 today'));
  losers.forEach(n => assert.equal(today[n], 2, n + ' has 2 today'));
  const brought = { 'Ana Ruiz': 24, 'Bruno Diaz': 5 };
  winners.forEach(n => assert.equal(table[n], (brought[n] || 0) + 8, n + ' on the Fall Series table'));
  losers.forEach(n => assert.equal(table[n], (brought[n] || 0) + 2, n + ' on the Fall Series table'));
  assert.equal(table['Zed Away'], 66, 'someone who is not here tonight keeps the points brought along');
  assert.match(await tv.textContent('.tvboard >> nth=1 >> h2'), /^Fall Series/);
  await tv.screenshot({ path: SHOTS + 'rr-tv.png' });
  step('4–1 gives 8 and 2; the Fall Series table adds them to the starting points');

  // 5. the next round comes by itself, with new partners, and the sit-outs move on
  await admin.click('.courtcard[data-court="4"]');
  await admin.click('.digits button[data-side="sa"][data-v="2"]'); await admin.click('.digits button[data-side="sb"][data-v="4"]');
  await admin.click('#saveScore');
  await admin.waitForSelector('text=Round 2');
  s = await s1();
  const r1 = s.rounds[0], r2 = s.rounds[1];
  assert.equal(r2.sitting.length, 2);
  r2.sitting.forEach(pid => assert.ok(r1.sitting.indexOf(pid) < 0, 'nobody sits twice in a row'));
  const pairs = r => r.courts.flatMap(c => [list(c.a).sort().join('+'), list(c.b).sort().join('+')]);
  pairs(r2).forEach(p => assert.ok(pairs(r1).indexOf(p) < 0, 'new partners in round 2'));
  assert.equal(r2.top, -1);
  step('round 2: new partners, different players sit out');

  // 6. the leaderboard to share: its second tab is the Fall Series
  await board.goto(BASE + '/board/?s=' + id + '&db=' + DB);
  await board.waitForSelector('#card');
  assert.deepEqual(await board.locator('.bd-tab').allTextContents().then(a => a[1]), 'Fall Series');
  await board.click('.bd-tab[data-view="month"]');
  await board.waitForSelector('text=Fall Series: everyone');
  const first = await board.locator('.bd-list li >> nth=0').textContent();
  assert.match(first, /Zed Away.*66/);
  await board.screenshot({ path: SHOTS + 'rr-board.png', fullPage: true });
  step('the leaderboard to share shows the Fall Series table');

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('round robin: all good');
})().catch(e => { console.error(e); process.exit(1); });
