'use strict';
// Browser check: the night goes on with the organizer's page closed. Phones send the scores; the TV and the phones
// move to the next round by themselves; when the organizer's page is opened again it catches up and saves the
// same rounds. For both clubs. Start tools/mock-server.js first:  node test/e2e-noadmin.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const TEAMS = [['Ana', 'Bruno'], ['Carla', 'Diego'], ['Elena', 'Fran'], ['Gaby', 'Hugo'], ['Ines', 'Javi']];

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const dump = async () => (await (await fetch(BASE + '/__dump')).json()).db;
  const list = x => Array.isArray(x) ? x : Object.values(x || {});

  for (const club of [{ name: 'Lehi', dir: '', root: 'pub', key: 'test-key', event: 'Padel Date Night', id: 'padel-date-night' },
                      { name: 'Tempe', dir: 'tempe/', root: 'tempe', key: 'tempe-key', event: 'Kings of the Desert', id: 'kings-of-the-desert' }]) {
    const adminCtx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    let admin = watch(await adminCtx.newPage(), club.name + ' admin');
    const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), club.name + ' tv');
    const saved = async () => { const d = (await dump())[club.root]; return d.sessions[club.id][d.live[club.id].sessionId]; };
    const scores = async () => { const d = (await dump())[club.root]; return (d.scores || {})[club.id] ? Object.values(d.scores[club.id])[0] : {}; };
    const tvRound = () => tv.evaluate(() => ({ title: (document.querySelector('.tvhead .round') || {}).textContent.trim(),
      courts: [...document.querySelectorAll('.tvcourt')].map(c => { const t = el => { const k = el.cloneNode(true); k.querySelectorAll('.crown').forEach(x => x.remove()); return k.textContent.replace(/ /g, ' ').trim(); };
        return { court: c.querySelector('.cn b').textContent.trim(), a: t(c.querySelector('.tm.a')), b: t(c.querySelector('.tm.b')), done: c.classList.contains('done') }; }) }));
    const tvOn = async n => { await tv.waitForFunction(k => (document.querySelector('.tvhead .round') || {}).textContent.trim() === 'Round ' + k && document.getElementById('inter').hidden, n, { timeout: 30000 }); return tvRound(); };
    // a player opens the phone page, picks their team and sends their court's score: their side wins 4-2
    const phoneSends = async team => {
      const p = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage(), club.name + ' phone');
      await p.goto(BASE + '/' + club.dir + 'p/?db=' + DB + '&s=' + club.id);
      await p.waitForSelector('#rolePlayer', { timeout: 15000 });
      await p.tap('#rolePlayer');
      await p.tap(`.pl-pick[data-team="${team}"]`);
      await p.waitForSelector('.pl-digits');
      await p.tap('.pl-digits button[data-who="us"][data-v="4"]'); await p.tap('.pl-digits button[data-who="them"][data-v="2"]'); await p.tap('#send');
      return p;
    };

    await admin.goto(BASE + '/' + club.dir + '?db=' + DB + '#k=' + club.key);
    await admin.waitForSelector('.fmtpick');
    await admin.fill('#newSeries', club.event); await admin.click('text=Create');
    await admin.waitForSelector('text=Courts');
    for (const c of [3, 4]) await admin.click(`.chip[data-court="${c}"]`);
    for (const t of TEAMS) { await admin.fill('#p1', t[0]); await admin.fill('#p2', t[1]); await admin.click('#addTeam'); }
    await tv.goto(BASE + '/' + club.dir + 'tv/?db=' + DB);
    await tv.waitForSelector('text=5 teams checked in');
    await admin.click('#startNight');
    await admin.waitForFunction(() => /Saved/.test((document.querySelector('.sync') || {}).textContent || ''));
    const r1 = await tvOn(1);
    await admin.close();                                              // from here on nobody has the organizer's page open
    assert.equal(list((await saved()).rounds).length, 1);

    // round 1: one court's score, then the other
    const first = await phoneSends(r1.courts[0].a);
    await tv.waitForFunction(() => document.querySelectorAll('.tvcourt.done').length === 1, null, { timeout: 12000 });
    assert.equal((await tvRound()).title, 'Round 1', 'one score missing: still round 1');
    await first.waitForSelector('text=Score is in');
    const second = await phoneSends(r1.courts[1].b);
    const r2 = await tvOn(2);
    assert.equal(r2.courts.length, 2);
    assert.ok(r2.courts.every(c => !c.done), 'a fresh round 2 on the TV');
    assert.equal(list((await saved()).rounds).length, 1, 'the saved night still has one round: no organizer device was there');
    assert.deepEqual(Object.keys(await scores()).sort(), ['r1']);
    // the phones moved on too: the one who sent last sees round 2 straight away
    await second.waitForFunction(() => /Round 2/.test(document.querySelector('.pl-top').textContent), null, { timeout: 8000 });
    await first.waitForFunction(() => /Round 2/.test(document.querySelector('.pl-top').textContent), null, { timeout: 8000 });
    const winners1 = [r1.courts[0].a, r1.courts[1].b];
    const kingNow = r2.courts[0];
    assert.ok(winners1.includes(kingNow.a) || winners1.includes(kingNow.b), 'a round 1 winner is on King’s Court in round 2: ' + JSON.stringify(kingNow));
    await tv.screenshot({ path: SHOTS + 'noadmin-' + club.name.toLowerCase() + '-round2.png' });
    step(club.name + ': round 1 finished from two phones, round 2 started on the TV and the phones with the organizer’s page closed');

    // round 2 and 3 the same way; the score entered for round 2 belongs to round 2's courts
    for (const c of r2.courts) await phoneSends(c.a);
    const r3 = await tvOn(3);
    for (const c of r3.courts) await phoneSends(c.b);
    const r4 = await tvOn(4);
    assert.deepEqual(Object.keys(await scores()).sort(), ['r1', 'r2', 'r3']);
    assert.equal(list((await saved()).rounds).length, 1);
    const board = await tv.evaluate(() => [...document.querySelectorAll('.tvboard')][0].textContent.replace(/\s+/g, ' '));
    const pts = (await tv.locator('.tvboard >> nth=0 >> .tvrow .pt').allTextContents()).reduce((a, x) => a + Number(x), 0);
    assert.equal(pts, 6 * 6, 'tonight’s leaderboard on the TV counts all three rounds (6 matches, 6 games each): ' + board.slice(0, 80));

    // the organizer opens the page again: it catches up and saves exactly the rounds on the TV
    admin = watch(await adminCtx.newPage(), club.name + ' admin again');
    await admin.goto(BASE + '/' + club.dir + '?db=' + DB);
    await admin.waitForSelector('text=Caught up with the scores sent from phones: 3 rounds played. Round 4 is on.', { timeout: 15000 });
    await admin.waitForFunction(() => /Saved/.test((document.querySelector('.sync') || {}).textContent || ''), null, { timeout: 15000 });
    const s = await saved();
    assert.equal(list(s.rounds).length, 4);
    await tv.waitForTimeout(3000);
    assert.deepEqual(await tvRound(), r4, 'the TV does not change when the organizer’s page saves the same rounds');
    const names = id => s.teams[id].name;
    assert.deepEqual(list(list(s.rounds)[3].courts).map(c => [String(c.court), names(c.a), names(c.b)]), r4.courts.map(c => [c.court, c.a, c.b]), 'the saved round 4 is the one everyone was already playing');
    const res = (await dump())[club.root].results[club.id];
    assert.equal(Object.values(Object.values(res)[0])[0].rounds, 3, 'and the leaderboard record is saved');
    // with the page open it works as before: a score typed there counts at once
    await admin.click(`.courtcard.todo[data-court="${r4.courts[0].court}"]`);
    await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="1"]'); await admin.click('#saveScore');
    await tv.waitForFunction(() => document.querySelectorAll('.tvcourt.done').length === 1, null, { timeout: 12000 });
    step(club.name + ': three rounds played from phones alone; the organizer’s page caught up to the same round 4 when it was opened');
    await adminCtx.close();
  }
  const db = await dump();
  assert.ok(db.pub.scores['padel-date-night'] && db.tempe.scores['kings-of-the-desert'] && !db.pub.scores['kings-of-the-desert'], 'each club’s scores stayed in its own part');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E NOADMIN OK');
})().catch(e => { console.error(e); process.exit(1); });
