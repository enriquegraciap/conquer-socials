'use strict';
// Switch players (or teams) in the round being played, from the organizer's page; the TV follows.
// Needs the mock server: node tools/mock-server.js 8787 test-key
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';

(async () => {
  const browser = await chromium.launch(), errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv');
  const clean = t => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const tvCourts = () => tv.evaluate(() => { const txt = el => { const k = el.cloneNode(true); k.querySelectorAll('.crown').forEach(x => x.remove()); return k.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); };
    return [...document.querySelectorAll('.tvcourt')].map(c => ({ court: c.querySelector('.cn b').textContent.trim(), a: txt(c.querySelector('.tm.a')), b: txt(c.querySelector('.tm.b')) })); });
  const tvSit = async () => clean(await tv.getAttribute('.tvsit.sign', 'data-names'));
  const waitTv = (fn, arg) => tv.waitForFunction(fn, arg, { timeout: 12000 });
  const tap = name => admin.click(`.swchip:text-is("${name}")`);
  const start = async (root, key, name, format, courts, people) => {
    await fetch(BASE + '/__reset');
    await admin.goto('about:blank');
    await admin.goto(BASE + root + '/?db=' + DB + '#k=' + key);
    await admin.waitForSelector('.fmtpick');
    await admin.fill('#newSeries', name); await admin.click(`.fmtpick [data-format="${format}"]`); await admin.click('text=Create');
    await admin.waitForSelector('text=Courts');
    for (const c of courts) await admin.click(`.chip[data-court="${c}"]`);
    for (const p of people) { if (Array.isArray(p)) { await admin.fill('#p1', p[0]); await admin.fill('#p2', p[1]); } else await admin.fill('#p1', p); await admin.click('#addTeam'); }
    await tv.goto(BASE + root + '/tv/?db=' + DB);
    await tv.waitForSelector('.tvroot');
    await admin.click('#startNight');
  };

  // ---------------------------------------------------------------- individual (Lehi): 9 players, 2 courts, one sits
  const NINE = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fran', 'Gaby', 'Hugo', 'Ines'];
  await start('', 'test-key', 'Taco Tuesday', 'kings-individual', [6, 7], NINE);
  await tv.waitForSelector('.tvcourt', { timeout: 10000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 9000 });
  let courts = await tvCourts(), sitter = await tvSit();
  assert.ok(NINE.includes(sitter));
  assert.equal((await admin.textContent('#switchPlaces')).trim(), 'Switch players');
  await admin.click('#switchPlaces');
  assert.equal(await admin.locator('.swcourt').count(), 3, 'both courts and the one sitting out');
  assert.deepEqual((await admin.locator('.swcourt.off .swchip').allTextContents()).map(clean), [sitter]);
  assert.ok(await admin.isDisabled('#doSwitch'), 'nothing to switch until two are picked');
  // 1. the player sitting out comes in for one on King's Court
  const king = courts[0], off = king.a.split(' & ')[0], stays = king.a.split(' & ')[1];
  await tap(sitter);
  assert.match(clean(await admin.textContent('#switchSay')), new RegExp('^' + sitter + ' \\(sitting out\\): now tap'));
  await tap(off);
  assert.equal(clean(await admin.textContent('#switchSay')), `${sitter} (sitting out) and ${off} (court ${king.court}) change places.`);
  await admin.screenshot({ path: SHOTS + 'switch-admin.png' });
  await admin.click('#doSwitch');
  await admin.waitForSelector(`.toast:text("${sitter} plays on court ${king.court}. ${off} sits out.")`);
  await waitTv(([a, s]) => { const c = document.querySelector('.tvcourt .tm.a'), g = document.querySelector('.tvsit.sign'); return c && c.textContent.replace(/ /g, ' ').includes(a) && g.getAttribute('data-names').trim() === s; }, [sitter, off]);
  courts = await tvCourts();
  assert.equal(courts[0].a, `${sitter} & ${stays}`, 'the TV shows who plays now');
  assert.equal(await tvSit(), off);
  assert.deepEqual((await admin.locator('.swcourt.off .swchip').allTextContents()).map(clean), [off], 'the window stays open and shows the round as it is now');
  assert.ok(await admin.isDisabled('#doSwitch'));
  step(`individual: ${sitter} came in from sitting out for ${off}; the TV follows`);
  // 2. two players on different courts change places
  const x = courts[0].b.split(' & ')[1], y = courts[1].a.split(' & ')[0];
  await tap(x); await tap(y); await admin.click('#doSwitch');
  await admin.waitForSelector(`.toast:text("${x} and ${y} have changed places.")`);
  await waitTv(([p, q]) => { const c = document.querySelectorAll('.tvcourt'); return c[0].querySelector('.tm.b').textContent.includes(q) && c[1].querySelector('.tm.a').textContent.includes(p); }, [x, y]);
  // 3. the same court, across the net: new partners
  courts = await tvCourts();
  const [p1, p2] = courts[1].a.split(' & '), [q1, q2] = courts[1].b.split(' & ');
  await tap(p2); await tap(q1); await admin.click('#doSwitch');
  await waitTv(([a, b]) => { const c = document.querySelectorAll('.tvcourt')[1], t = el => el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); return t(c.querySelector('.tm.a')) === a && t(c.querySelector('.tm.b')) === b; }, [`${p1} & ${q1}`, `${p2} & ${q2}`]);
  // partners already: picking them and pressing Switch changes nothing and says why
  await tap(p1); await tap(q1); await admin.click('#doSwitch');
  await admin.waitForSelector('.toast:text("same court and the same side")');
  await admin.click('text=Done');
  // 4. a court with a score is left alone
  await admin.click(`.courtcard.todo[data-court="${courts[1].court}"]`);
  await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="1"]'); await admin.click('#saveScore');
  await admin.click('#switchPlaces');
  assert.equal(await admin.locator('.swcourt:not(.off)').count(), 1);
  await admin.waitForSelector('text=1 court is not shown: it already has a result.');
  await admin.click('text=Done');
  // the night goes on: the last score brings round 2, with everyone in it once
  await admin.click(`.courtcard.todo[data-court="${courts[0].court}"]`);
  await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="2"]'); await admin.click('#saveScore');
  await tv.waitForSelector('.tvhead .round:text("Round 2")', { timeout: 20000 });
  await tv.waitForFunction(() => document.querySelectorAll('.tvcourt .mid.score').length === 0, null, { timeout: 15000 });
  const r2 = await tvCourts(), all = r2.flatMap(c => c.a.split(' & ').concat(c.b.split(' & '))).concat(await tvSit());
  assert.deepEqual(all.slice().sort(), NINE.slice().sort(), 'round 2 has everyone exactly once');
  assert.notEqual(await tvSit(), off, 'whoever sat in round 1 plays round 2');
  step('individual: across courts, across the net, not on a scored court; round 2 follows as usual');

  // ---------------------------------------------------------------- fixed partners (Tempe): 5 teams, 2 courts
  const TEAMS = [['Ana', 'Bea'], ['Carl', 'Dan'], ['Eva', 'Flo'], ['Gus', 'Hal'], ['Ivy', 'Jo']];
  await start('/tempe', 'tempe-key', 'Kings of the Desert', 'kings-fixed', [1, 2], TEAMS);
  await tv.waitForSelector('.tvcourt', { timeout: 10000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 9000 });
  courts = await tvCourts(); sitter = await tvSit();
  assert.equal((await admin.textContent('#switchPlaces')).trim(), 'Switch teams');
  await admin.click('#switchPlaces');
  const outTeam = courts[1].b;
  await tap(sitter); await tap(outTeam); await admin.click('#doSwitch');
  await admin.waitForSelector(`.toast:text("${sitter} plays on court ${courts[1].court}. ${outTeam} sits out.")`);
  await waitTv(([a, s]) => document.querySelectorAll('.tvcourt')[1].querySelector('.tm.b').textContent.replace(/ /g, ' ').includes(a.split(' & ')[0]) && document.querySelector('.tvsit.sign').getAttribute('data-names').replace(/ /g, ' ').trim() === s, [sitter, outTeam]);
  const t1 = courts[0].a, t2 = (await tvCourts())[1].a;
  await tap(t1); await tap(t2); await admin.click('#doSwitch');
  await waitTv(([a, b]) => { const c = document.querySelectorAll('.tvcourt'), t = el => el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); return t(c[0].querySelector('.tm.a')) === b && t(c[1].querySelector('.tm.a')) === a; }, [t1, t2]);
  await admin.click('text=Done');
  step('fixed partners (Tempe): a team sitting out came in; two teams changed courts');

  // ---------------------------------------------------------------- wheel (Lehi): 8 players, 4 teams
  const EIGHT = NINE.slice(0, 8);
  await fetch(BASE + '/__reset');
  await admin.goto('about:blank');
  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.waitForSelector('.fmtpick');
  await admin.fill('#newSeries', 'Wheel Day'); await admin.click('.fmtpick [data-format="wheel"]'); await admin.click('text=Create');
  await admin.waitForSelector('#wheelPlan');
  for (const c of [6, 7]) await admin.click(`.chip[data-court="${c}"]`);
  for (const n of EIGHT) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=8 players checked in');
  await admin.click('#startNight');
  await admin.waitForSelector('#showCourts', { timeout: 15000 });
  await tv.waitForSelector('.wheelshow', { timeout: 15000 });
  await admin.click('#showCourts');
  await tv.waitForFunction(() => !document.querySelector('.wheelshow') && document.querySelectorAll('.tvcourt').length === 2, null, { timeout: 20000 });
  courts = await tvCourts();
  const wx = courts[0].a.split(' & ')[0], wxMate = courts[0].a.split(' & ')[1], wy = courts[1].b.split(' & ')[0], wyMate = courts[1].b.split(' & ')[1];
  await admin.click('#switchPlaces');
  await admin.waitForSelector('text=On a wheel day the two also change teams until the next spin.');
  await tap(wx); await tap(wy); await admin.click('#doSwitch');
  await waitTv(([a, b]) => { const c = document.querySelectorAll('.tvcourt'), t = el => el.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); return t(c[0].querySelector('.tm.a')) === a && t(c[1].querySelector('.tm.b')) === b; }, [`${wy} & ${wxMate}`, `${wx} & ${wyMate}`]);
  await admin.click('text=Done');
  // the new pairs stay together in the next pool round
  for (const c of courts) { await admin.click(`.courtcard.todo[data-court="${c.court}"]`); await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="2"]'); await admin.click('#saveScore'); }
  await tv.waitForFunction(() => /2 of 3/.test(document.querySelector('.tvhead .round').textContent) && document.querySelectorAll('.tvcourt .mid.score').length === 0, null, { timeout: 25000 });
  const next = (await tvCourts()).flatMap(c => [c.a, c.b]).map(p => p.split(' & ').sort().join(' & '));
  assert.ok(next.includes([wy, wxMate].sort().join(' & ')) && next.includes([wx, wyMate].sort().join(' & ')), 'the two play with their new partners in the next round: ' + next.join(' | '));
  step('wheel: two players changed teams; the next pool round keeps the new pairs');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('E2E SWITCH OK');
})().catch(e => { console.error(e); process.exit(1); });
