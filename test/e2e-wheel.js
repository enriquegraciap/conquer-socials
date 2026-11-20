'use strict';
// Browser check of the Wheel of Fortune format (start tools/mock-server.js first):  node test/e2e-wheel.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const NAMES = ['Ana Lopez', 'Bea Ruiz', 'Carla Diaz', 'Dani Mora', 'Elena Gil', 'Fran Soto', 'Gaby Luna', 'Hilda Paz'];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv');
  const phone = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage(), 'phone');
  const db = async () => (await (await fetch(BASE + '/__dump')).json()).db.pub;
  const session = async id => { const d = await db(); return d.sessions[id][d.live[id].sessionId]; };
  const list = x => Array.isArray(x) ? x : Object.values(x || {});
  const create = async (name, players, courts) => {
    await fetch(BASE + '/__reset');
    await admin.goto('about:blank');
    await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
    await admin.waitForSelector('.fmtpick');
    await admin.fill('#newSeries', name);
    await admin.click('.fmtpick [data-format="wheel"]');
    await admin.click('text=Create');
    await admin.waitForSelector('#wheelPlan');
    for (const c of courts) await admin.click(`.chip[data-court="${c}"]`);
    for (const n of players) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
    return Object.keys((await db()).series)[0];
  };
  const score = async (court, a, b) => {
    await admin.click(`.courtcard.todo[data-court="${court}"]`);
    await admin.click(`.digits button[data-side="sa"][data-v="${a}"]`); await admin.click(`.digits button[data-side="sb"][data-v="${b}"]`);
    await admin.click('#saveScore');
  };
  const tvCourts = () => tv.evaluate(() => { const txt = el => { const k = el.cloneNode(true); k.querySelectorAll('.crown').forEach(x => x.remove()); return k.textContent.replace(/\u00a0/g, ' ').trim(); };
    return [...document.querySelectorAll('.tvcourt')].map(c => ({
    label: c.querySelector('.cn span').textContent.trim(), court: c.querySelector('.cn b').textContent.trim(), king: c.classList.contains('king'),
    a: txt(c.querySelector('.tm.a')), b: txt(c.querySelector('.tm.b')) })); });
  const showOver = () => tv.waitForFunction(() => !document.querySelector('.wheelshow'), null, { timeout: 45000 });
  const release = async () => { await admin.click('#showCourts'); await tv.waitForFunction(() => !document.querySelector('.wheelshow'), null, { timeout: 8000 }); };
  const introOver = () => tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 9000 });

  // ---------------------------------------------------------------- 8 players: one spin, pool, semifinals, final
  const id = await create('Wheel of Fortune - Ladies Round Robin', NAMES.slice(0, 3), [6, 7]);
  assert.deepEqual([(await db()).series[id].format, (await db()).series[id].scoring], ['wheel', 'player']);
  assert.ok(await admin.isDisabled('#startNight'), 'three players cannot spin');
  await admin.waitForSelector('text=Add at least four players.');
  for (const n of NAMES.slice(3)) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await admin.waitForSelector('text=8 players on 2 courts, 4 teams.');
  assert.match(await admin.textContent('#wheelPlan'), /4 teams keep the same partner all day\. 3 pool rounds, sets to 4\. Then semifinals to 4, and a final and a bronze medal match to 6\./);
  assert.equal(await admin.locator('.sitpick').count(), 0, 'nobody sits with eight');
  assert.equal(await admin.locator('[data-sets]').count(), 0, 'the set length is not a choice here');
  await admin.screenshot({ path: SHOTS + 'wheel-setup.png', fullPage: true });
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=8 players checked in');
  assert.equal(await tv.textContent('#barsub'), 'Wheel of fortune');
  assert.deepEqual((await tv.locator('.wheelidle text').allTextContents()).sort(), NAMES.slice().sort(), 'everyone who checked in is on the wheel');
  await tv.screenshot({ path: SHOTS + 'wheel-tv-checkin.png' });
  await phone.goto(BASE + '/p/?db=' + DB + '&s=' + id);
  await phone.waitForSelector('#rolePlayer', { timeout: 15000 });
  await phone.tap('#rolePlayer');
  await phone.tap(`.pl-pick[data-team="${NAMES[0]}"]`);
  await phone.waitForSelector('text=Your partner and court appear here when the wheel has been spun');
  step('setup: plan for 8 players shown, the TV has the wheel with every name');

  await admin.click('#startNight');
  await tv.waitForSelector('.wheelshow[data-teams="4"]', { timeout: 8000 });
  let s = await session(id);
  const teams = list(s.wheel.teams).map(list), nameOf = pid => s.teams[pid].name, pairName = t => t.map(nameOf).join(' & ');
  assert.equal(teams.length, 4);
  await tv.waitForSelector('.wheelshow[data-shown="2"]', { timeout: 15000 });
  await tv.screenshot({ path: SHOTS + 'wheel-tv-spin.png' });
  await tv.waitForSelector('.wheelshow.all', { timeout: 30000 });
  assert.deepEqual(await tv.locator('.wpair').allTextContents(), teams.map(pairName), 'the TV draws the pairs the organizer’s device made');
  // each wheel stopped with the last pair's names under its pointers
  const under = await tv.evaluate(() => [...document.querySelectorAll('.wbox')].map(box => {
    const r = box.getBoundingClientRect(), left = box.classList.contains('l'), x = left ? r.right - r.width * 0.2 : r.left + r.width * 0.2, y = r.top + r.height / 2;
    return [...box.querySelectorAll('text')].map(t => { const b = t.getBoundingClientRect(); return [t.textContent, Math.hypot((b.left + b.right) / 2 - x, (b.top + b.bottom) / 2 - y)]; }).sort((p, q) => p[1] - q[1])[0][0];
  }));
  assert.deepEqual(under, teams[3].map(nameOf), 'the pointers are on the last pair');
  await tv.screenshot({ path: SHOTS + 'wheel-tv-pairs.png' });
  // the wheels stay up until the organizer sends the TV on; a TV switched on meanwhile shows the pairs too
  await admin.waitForSelector('#wheelHold');
  await tv.waitForTimeout(6500);
  assert.equal(await tv.locator('.wheelshow.all:not(.out)').count(), 1, 'still on the wheels well after the last pair');
  await tv.reload();
  await tv.waitForSelector('.wheelshow.all', { timeout: 15000 });
  assert.deepEqual(await tv.locator('.wpair').allTextContents(), teams.map(pairName), 'a TV opened now shows the same pairs');
  await tv.waitForTimeout(2500);
  assert.equal(await tv.locator('.wheelshow.all:not(.out)').count(), 1);
  await admin.screenshot({ path: SHOTS + 'wheel-admin-hold.png' });
  await release();
  assert.equal(await admin.locator('#wheelHold').count(), 0);
  assert.equal((await tv.textContent('.tvhead .round')).trim(), 'Pool round 1 of 3');
  assert.equal((await tv.textContent('.tvhead .event')).trim(), 'Sets to 4');
  let courts = await tvCourts();
  assert.deepEqual(courts.map(c => [c.label, c.court, c.king]), [['Court', '7', false], ['Court', '6', false]]);
  courts.forEach(c => [c.a, c.b].forEach(side => assert.ok(teams.map(pairName).includes(side), 'a pair the wheel made: ' + side)));
  assert.equal(await tv.getAttribute('.tvsit.sign', 'data-names'), '', 'everyone plays');
  assert.equal((await tv.textContent('.tvboard >> nth=0 >> h2')).trim().slice(0, 5), 'Today');
  await tv.screenshot({ path: SHOTS + 'wheel-tv-pool.png' });
  step('spin: two wheels drew ' + teams.map(pairName).join(', '));

  // the phone: partner, court, digits up to the set length
  await phone.waitForSelector('.pl-court');
  assert.match((await phone.textContent('.pl-top')).replace(/\s+/g, ' '), /Pool round 1 of 3 · sets to 4/i);
  assert.equal(await phone.locator('.pl-digits button[data-who="us"]').count(), 5, 'digits 0 to 4');
  const myTeam = teams.find(t => t.map(nameOf).includes(NAMES[0])), partner = myTeam.map(nameOf).find(n => n !== NAMES[0]);
  assert.match(await phone.textContent('.pl-vs .us'), new RegExp('You & ' + partner));
  await phone.tap('.pl-digits button[data-who="us"][data-v="4"]'); await phone.tap('.pl-digits button[data-who="them"][data-v="2"]'); await phone.tap('#send');
  await admin.waitForFunction(() => document.querySelectorAll('.courtcard.todo').length === 1, null, { timeout: 8000 });
  await phone.screenshot({ path: SHOTS + 'wheel-phone.png' });
  const other = await admin.getAttribute('.courtcard.todo', 'data-court');
  await score(other, 3, 4);
  await tv.waitForSelector('#inter.on', { timeout: 20000 });
  assert.deepEqual([(await tv.textContent('#inter .word')).trim(), (await tv.textContent('#inter .num')).trim()], ['Pool round', '2']);
  await introOver();
  assert.equal((await tv.textContent('.tvhead .round')).trim(), 'Pool round 2 of 3');
  assert.equal(await admin.locator('#spinAgain').count(), 1, 'between rounds the wheel can be spun again');
  assert.equal(await admin.locator('[data-delete-from]').count(), 0, 'no round-by-round delete on a wheel day');
  for (const c of [7, 6]) await score(c, 4, 1);
  await admin.waitForSelector('text=Pool round 3 of 3');
  await tv.waitForFunction(() => /Pool round 3 of 3/i.test((document.querySelector('.tvhead .round') || {}).textContent || ''), null, { timeout: 20000 });
  await introOver();
  for (const c of [7, 6]) await score(c, 2, 4);
  await admin.waitForSelector('.roundhead >> text=Semifinals');
  for (let i = 0; i < 40 && list((await session(id)).rounds).length < 4; i++) await admin.waitForTimeout(100);      // saved a moment after it shows
  s = await session(id);
  assert.deepEqual(list(s.rounds).map(r => r.stage), ['pool', 'pool', 'pool', 'semi']);
  assert.equal(await admin.locator('#poolTable tbody tr').count(), 4);
  await tv.waitForFunction(() => document.querySelector('#inter.on .num.text'), null, { timeout: 20000 });
  assert.deepEqual([(await tv.textContent('#inter .word')).trim(), (await tv.textContent('#inter .num')).trim()], ['Time for the', 'Semis']);
  await tv.waitForTimeout(900);
  await tv.screenshot({ path: SHOTS + 'wheel-tv-semis-intro.png' });
  await introOver();
  courts = await tvCourts();
  assert.deepEqual(courts.map(c => c.label), ['Semifinal', 'Semifinal']);
  await admin.screenshot({ path: SHOTS + 'wheel-admin-semis.png', fullPage: true });
  step('pool played, semifinals drawn from the table');

  for (const c of [7, 6]) await score(c, 4, 3);
  await admin.waitForSelector('.roundhead >> text=Final & bronze match');
  await admin.click('.courtcard.todo[data-court="7"]');
  assert.equal(await admin.locator('.digits button[data-side="sa"]').count(), 7, 'the final is to 6');
  assert.match(await admin.textContent('.sheet h3'), /Final & bronze match · Court 7 · Final/);
  await admin.click('.digits button[data-side="sa"][data-v="6"]'); await admin.click('.digits button[data-side="sb"][data-v="4"]');
  await tv.waitForFunction(() => /^\s*Final & bronze match\s*$/i.test((document.querySelector('.tvhead .round') || {}).textContent || ''), null, { timeout: 20000 });
  await tv.waitForTimeout(700);
  assert.deepEqual([(await tv.textContent('#inter .word')).trim(), (await tv.textContent('#inter .num')).trim()], ['Here comes the', 'Final']);
  await introOver();
  await tv.waitForSelector('.tvcourt.king', { timeout: 8000 });
  courts = await tvCourts();
  assert.deepEqual(courts.map(c => [c.label, c.court, c.king]), [['Final', '7', true], ['Bronze match', '6', false]]);
  assert.equal((await tv.textContent('.tvhead .event')).trim(), 'Sets to 6');
  assert.equal(await tv.getAttribute('.tvsit.sign', 'data-names'), '', 'everyone plays: the losing semifinalists play for bronze');
  await tv.screenshot({ path: SHOTS + 'wheel-tv-final.png' });
  await admin.click('#saveScore');
  await score(6, 3, 6);
  await admin.waitForSelector('#wheelNext >> text=All matches played');
  await tv.waitForFunction(() => /All matches played/i.test((document.querySelector('.tvhead .round') || {}).textContent || ''), null, { timeout: 8000 });
  await phone.waitForSelector('text=Thanks for playing. The standings are on the screen.');
  s = await session(id);
  let games = 0;
  list(s.rounds).forEach(r => list(r.courts).forEach(c => { games += 2 * (c.sa + c.sb); }));
  const points = (await tv.locator('.tvboard >> nth=0 >> .tvrow .pt').allTextContents()).reduce((a, x) => a + Number(x), 0);
  assert.equal(points, games, 'every game is a point for both players of the pair');
  await admin.screenshot({ path: SHOTS + 'wheel-admin-done.png', fullPage: true });
  await admin.click('#endDay'); await admin.click('#modalOk');
  await admin.waitForSelector('text=Night ended');
  const doc = Object.values(Object.values((await db()).results[id])[0])[0];
  assert.deepEqual([doc.format, doc.scoring, Object.keys(doc.entries).length], ['wheel', 'player', 8]);
  step('semifinals, final to 6, day ended: ' + points + ' points on the board, saved for the month');

  // ---------------------------------------------------------------- 5 players: someone sits, two sets, spin again
  const five = NAMES.slice(0, 5), id5 = await create('Wheel of Fortune', five, [7]);
  await admin.waitForSelector('.sitpick');
  assert.match(await admin.textContent('#wheelPlan'), /One player sits out; two teams play two sets to 6/);
  await admin.click(`.sitpick [data-sit="${five[4]}"]`);
  await tv.goto('about:blank'); await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=5 players checked in');
  await admin.click('#startNight');
  await tv.waitForSelector('.wheelshow[data-spin="1"][data-teams="2"]', { timeout: 8000 });
  await tv.waitForSelector('.wheelshow.all', { timeout: 20000 });
  assert.match(await tv.textContent('.wextra'), new RegExp('Sitting out: ' + five[4]));
  await release();
  assert.equal((await tv.textContent('.tvhead .round')).trim(), 'Set 1 of 2');
  assert.equal((await tv.textContent('.tvhead .event')).trim(), 'Sets to 6');
  assert.equal(await tv.getAttribute('.tvsit.sign', 'data-names'), five[4].replace(/ /g, ' '));
  await score(7, 6, 3);
  await admin.waitForSelector('.roundhead >> text=Set 2 of 2');
  await score(7, 5, 6);
  await admin.waitForSelector('#wheelNext >> text=Time to spin the wheel');
  await tv.waitForFunction(() => /Wheel time!/i.test((document.querySelector('.tvhead .round') || {}).textContent || ''), null, { timeout: 8000 });
  await admin.screenshot({ path: SHOTS + 'wheel-admin-spin.png', fullPage: true });
  await admin.click('#spinWheel');
  await tv.waitForSelector('.wheelshow[data-spin="2"]', { timeout: 8000 });
  await tv.screenshot({ path: SHOTS + 'wheel-tv-respin.png' });
  s = await session(id5);
  assert.equal(list(s.wheel.sit).length, 1);
  assert.notEqual(s.teams[list(s.wheel.sit)[0]].name, five[4], 'somebody else sits after the second spin');
  assert.equal(list(s.rounds).length, 3);
  // forgotten the button? the first score sends the TV on to the courts as well
  await tv.waitForSelector('.wheelshow.all', { timeout: 20000 });
  await score(7, 6, 1);
  await showOver();
  // a sixth player arrives: she waits for the next spin
  await admin.fill('#p1', 'Late Lucy'); await admin.click('#addTeam');
  await admin.waitForSelector('text=gets a partner at the next spin of the wheel');
  // restart: back to the list, ready for a first spin
  await admin.click('#restartNight'); await admin.click('#modalOk');
  await admin.waitForSelector('#wheelPlan');
  await admin.waitForSelector('text=6 players on 1 court, 3 teams.');
  await tv.waitForSelector('text=6 players checked in', { timeout: 8000 });
  await admin.click('#startNight');
  await tv.waitForSelector('.wheelshow[data-spin="1"][data-teams="3"]', { timeout: 8000 });
  step('5 players: chosen sitter, two sets to 6, a second spin with a new sitter; restart goes back to the list');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('wheel e2e ok');
})().catch(e => { console.error(e); process.exit(1); });
