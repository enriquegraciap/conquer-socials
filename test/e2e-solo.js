'use strict';
// Browser check of the individual King's Court format (start tools/mock-server.js first):  node test/e2e-solo.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const NAMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena', 'Fran', 'Gaby', 'Hugo', 'Ines'];

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv');
  const db = async () => (await (await fetch(BASE + '/__dump')).json()).db.pub;

  // 1. create the event and choose its format
  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.waitForSelector('.fmtpick');
  assert.deepEqual(await admin.locator('.fmtpick .fmt b').allTextContents(), ['Fixed partner, King’s Court', 'Individual, King’s Court']);
  assert.equal(await admin.getAttribute('.fmtpick .fmt.on', 'data-format'), 'kings-fixed', 'fixed partner is the choice until another is tapped');
  await admin.fill('#newSeries', 'Tapas Fridays - Intermediate King’s Court');
  await admin.click('.fmtpick [data-format="kings-individual"]');
  await admin.screenshot({ path: SHOTS + 'solo-create.png' });
  await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  const id = Object.keys((await db()).series)[0];
  assert.deepEqual([(await db()).series[id].format, (await db()).series[id].scoring], ['kings-individual', 'player']);
  step('event created with the Individual format (' + id + ')');

  // 2. players are entered one name at a time
  assert.equal(await admin.locator('#p2').count(), 0, 'one name field, not two');
  for (const c of [6, 7]) await admin.click(`.chip[data-court="${c}"]`);
  for (const n of NAMES) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await admin.fill('#p1', 'ana'); await admin.click('#addTeam');
  await admin.waitForSelector('text=That player is already on the list');
  await admin.waitForSelector('text=9 players on 2 courts: 8 play, 1 sits out each round.');
  await admin.screenshot({ path: SHOTS + 'solo-setup.png', fullPage: true });
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=9 players checked in');
  assert.equal(await tv.textContent('#barsub'), 'Individual, king’s court');
  await admin.click('#startNight');
  await tv.waitForSelector('.tvcourt', { timeout: 8000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 8000 });
  const sides = async () => tv.evaluate(() => [...document.querySelectorAll('.tvcourt')].map(c => [c.querySelector('.tm.a').textContent.trim(), c.querySelector('.tm.b').textContent.trim()]));
  const r1 = await sides();
  r1.flat().forEach(t => assert.match(t, /^\w+ & \w+$/, 'each side of a court is two players: ' + t));
  let sitting = (await tv.getAttribute('.tvsit', 'data-names')).trim();
  assert.ok(NAMES.includes(sitting), 'one player sits out: ' + sitting);
  assert.equal((await tv.textContent('.tvboard >> nth=0 >> h2 small')).trim(), '9 players');
  await tv.screenshot({ path: SHOTS + 'solo-tv-round1.png' });
  step('round 1 on the TV: two pairs per court, ' + sitting + ' sits out');

  // 2b. the sign under the courts: the sitter's name first, then what is coming up at the club, then the name again
  const day = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  assert.equal(await tv.getAttribute('.tvsit.sign', 'data-phase'), 'wait', 'a new round starts with who is sitting out');
  assert.equal((await tv.textContent('.tvsit.sign .lab')).trim(), 'Sitting out this round');
  assert.equal((await tv.textContent('.tvsit.sign .track')).trim(), sitting, 'one name fits, so it stands still and is written once');
  await fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify({ 'gate/test-key': Date.now(), 'pub/promo/lehi': { at: Date.now(), items: [
    { program: 'old', name: 'Yesterday\u2019s Clinic', date: day(-1), start: '18:00', end: '19:00', count: 9 },
    { program: 'tapas', name: 'TAPAS FRIDAYS - WPR 4.5-9 Round Robin Series', date: day(1), start: '09:00', end: '10:00', count: 12 },
    { program: 'wheel', name: 'Wheel of Fortune - Ladies Round Robin', date: day(1), start: '10:00', end: '12:00', count: 2 },
    { program: 'kings', name: 'King\u2019s Court Monday Open Play', date: day(3), start: '06:30', end: '08:30', count: 5 },
    { program: 'wheel', name: 'Wheel of Fortune - Ladies Round Robin', date: day(8), start: '10:00', end: '12:00', count: 0 },
    { program: 'taco', name: 'Taco Tuesday', date: day(4), start: '19:00', end: '21:00', count: 7 }] } }) });
  await tv.reload();                                                  // (a TV reads what is coming up when it starts, then every five minutes)
  await tv.waitForSelector('.tvsit.sign[data-phase="wait"]', { timeout: 8000 });
  const tSign = Date.now();
  await tv.waitForSelector('.tvsit.sign[data-phase="ads"]', { timeout: 40000 });
  const waited = Date.now() - tSign;
  assert.ok(waited > 20000, 'the name stays for the first 30 seconds of the round (' + waited + ' ms seen)');
  assert.equal((await tv.textContent('.tvsit.sign .lab')).trim(), 'Coming up at Conquer');
  const ads = await tv.evaluate(() => [...document.querySelector('.tvsit.sign .track .run').querySelectorAll('.ad')].map(a => [a.querySelector('b').textContent, a.querySelector('.when').textContent, a.querySelector('small') ? a.querySelector('small').textContent : '']));
  assert.deepEqual(ads, [['Wheel of Fortune - Ladies Round Robin', 'Tomorrow \u00b7 10 AM to 12 PM', ''], ['King\u2019s Court Monday Open Play', (await tv.evaluate(n => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.now() + n * 86400000).getDay()], 3)) + ' \u00b7 6:30 AM to 8:30 AM', '5 players signed up']],
    'the next two events, not the past one, not this social itself, one per program; sign-ups shown only from three');
  const x1 = await tv.evaluate(() => document.querySelector('.tvsit.sign .track').getBoundingClientRect().x);
  await tv.waitForTimeout(1000);
  const x2 = await tv.evaluate(() => document.querySelector('.tvsit.sign .track').getBoundingClientRect().x);
  assert.ok(x2 < x1 - 30 && x2 > x1 - 160, 'the letters run from right to left, unhurried (' + Math.round(x1) + ' -> ' + Math.round(x2) + ' px in a second)');
  assert.ok(await tv.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tvsit.sign .track')).fontSize) > innerHeight * 0.035), 'in clear letters');
  await tv.screenshot({ path: SHOTS + 'tv-sign-ads.png' });
  const tAds = Date.now();
  await tv.waitForSelector('.tvsit.sign[data-phase="wait"]', { timeout: 40000 });
  assert.ok(Date.now() - tAds > 15000, 'announcements run for about 30 seconds');
  const tNames = Date.now();
  await tv.waitForSelector('.tvsit.sign[data-phase="ads"]', { timeout: 20000 });
  const namesFor = Date.now() - tNames;
  assert.ok(namesFor > 7000 && namesFor < 14000, 'then the names for about 10 seconds (' + namesFor + ' ms)');
  step('sign: sitter\'s name for the first 30 s, then announcements 30 s / names 10 s; next two events with sign-ups from 3');

  // 3. a player's phone: pick your name, see your partner and opponents, send the score
  const [kingA, kingB] = r1[0], me = kingA.split(' & ')[0], mate = kingA.split(' & ')[1];
  const phone = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(), 'phone');
  await phone.goto(BASE + '/p/?db=' + DB + '&s=' + id);
  await phone.waitForSelector('#rolePlayer');
  assert.equal((await phone.textContent('.pl-hello h2')).trim(), 'Hi, welcome!');
  const look = sel => phone.evaluate(q => getComputedStyle(document.querySelector(q)).backgroundColor, sel);
  assert.equal(await look('#rolePlayer'), await look('#roleAdmin'), 'Player and Admin are the same kind of button');
  assert.notEqual(await look('#rolePlayer'), 'rgb(255, 255, 255)', 'dark until pressed');
  await phone.screenshot({ path: SHOTS + 'phone-welcome.png' });
  const tTap = Date.now();
  await phone.tap('#rolePlayer');
  await phone.waitForSelector('#rolePlayer.pressed');
  await phone.waitForTimeout(200);
  assert.equal(await look('#rolePlayer'), 'rgb(255, 255, 255)', 'a pressed button turns white');
  await phone.screenshot({ path: SHOTS + 'phone-welcome-pressed.png' });
  await phone.waitForSelector('text=Who are you?');
  assert.ok(Date.now() - tTap >= 450, 'and stays white for about half a second before moving on');
  assert.equal(await phone.locator('.pl-pick').count(), 9, 'the list is players, not teams');
  await phone.tap(`.pl-pick[data-team="${me}"]`);
  await phone.waitForSelector('.pl-vs');
  assert.equal((await phone.textContent('.pl-vs .us')).trim(), 'You & ' + mate);
  assert.equal((await phone.textContent('.pl-vs div:last-child')).trim(), kingB);
  await phone.screenshot({ path: SHOTS + 'solo-phone.png' });
  await phone.tap('.pl-digits button[data-who="us"][data-v="4"]');
  await phone.tap('.pl-digits button[data-who="them"][data-v="1"]');
  await phone.tap('#send');
  await phone.waitForSelector('text=Score is in');
  await tv.waitForSelector('.tvcourt.done', { timeout: 8000 });
  assert.equal((await tv.textContent('.tvcourt.done .tm.a')).trim(), kingA + ' 👑', 'the crown goes to the winning pair');
  // the other court from the organizer's iPad
  await admin.waitForFunction(() => document.querySelectorAll('.panel')[0].querySelectorAll('.courtcard.todo').length === 1, null, { timeout: 8000 });
  await admin.click('.panel >> nth=0 >> .courtcard[data-court="6"]');
  assert.equal((await admin.locator('.scoreteam .nm').allTextContents()).join(' | '), r1[1].join(' | '), 'the score sheet names both pairs');
  await admin.click('.digits button[data-side="sa"][data-v="2"]'); await admin.click('.digits button[data-side="sb"][data-v="4"]'); await admin.click('#saveScore');
  await tv.waitForFunction(() => /Round 2/.test(document.querySelector('.tvhead .round').textContent), null, { timeout: 15000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 8000 });

  // 4. round 2: pairs split, winners up, the player who sat comes in, and the leaderboard is per player
  const r2 = await sides();
  const pairs1 = r1.flat().map(t => t.split(' & ').sort().join('+')), pairs2 = r2.flat().map(t => t.split(' & ').sort().join('+'));
  pairs2.forEach(p => assert.ok(!pairs1.includes(p), 'no pair stays together: ' + p));
  const [winner1, winner2] = kingA.split(' & ');
  const kingNow = r2[0].map(t => t.split(' & ')), sits2 = (await tv.getAttribute('.tvsit', 'data-names')).trim();
  assert.notEqual(sits2, sitting, 'a different player sits out in round 2');
  // (with nine players one of round 1's winners may be the one sitting now; everyone else follows the rule)
  [winner1, winner2, ...r1[1][1].split(' & ')].filter(n => n !== sits2).forEach(w => assert.ok(kingNow.flat().includes(w), w + ' won and is on King\'s Court'));
  if (![winner1, winner2].includes(sits2)) assert.ok(kingNow[0].includes(winner1) !== kingNow[0].includes(winner2), 'the two King\'s Court winners now face each other');
  assert.ok(r2.flat().join(' ').includes(sitting), sitting + ' sat out round 1 and plays round 2');
  const board = await tv.evaluate(() => [...document.querySelectorAll('.tvboard')[0].querySelectorAll('.tvrow')].map(r => [r.querySelector('.nm').childNodes[0].textContent, Number(r.querySelector('.pt').textContent)]));
  assert.equal(board.length, 9);
  const pts = Object.fromEntries(board);
  assert.deepEqual([pts[winner1], pts[winner2]], [4, 4], 'both players of a pair get the games the pair won');
  kingB.split(' & ').forEach(n => assert.equal(pts[n], 1));
  assert.equal(pts[sitting], 0);
  await tv.screenshot({ path: SHOTS + 'solo-tv-round2.png' });
  await phone.waitForFunction(() => /Round 2/.test(document.querySelector('.pl-top span').textContent), null, { timeout: 8000 });
  if (sits2 === me) await phone.waitForSelector('text=You are sitting out round 2');
  else {
    await phone.waitForSelector('.pl-vs .us');
    assert.match((await phone.textContent('.pl-vs .us')).trim(), /^You & \w+$/);
    assert.notEqual((await phone.textContent('.pl-vs .us')).trim(), 'You & ' + mate, 'the phone shows the new partner');
  }
  step('round 2: every pair split, winners moved up and face each other, leaderboard is per player');

  // 4b. delete rounds: back to round 1 restarts the night; the score a phone sent for the old round 1 must not come back
  await admin.click('details.prev summary');
  assert.equal(await admin.locator('[data-delete-from]').count(), 1, 'round 1 is the only earlier round');
  await admin.click('[data-delete-from="1"]');
  await admin.waitForSelector('text=Restart the night?');
  await admin.screenshot({ path: SHOTS + 'solo-restart.png' });
  await admin.click('#modalOk');
  await admin.waitForSelector('text=The night starts again');
  await admin.waitForSelector('.roundhead .big:text("Round 1")');
  await tv.waitForFunction(() => /Round 1/.test(document.querySelector('.tvhead .round').textContent), null, { timeout: 10000 });
  await tv.waitForTimeout(5000);                                     // long enough for a stale phone score to have been applied, if one were left
  assert.equal(await admin.locator('.panel >> nth=0 >> .courtcard.todo').count(), 2, 'both courts of the new round 1 are still to play');
  assert.equal(await tv.locator('.tvcourt.done').count(), 0);
  assert.ok(!(await tv.evaluate(() => !document.getElementById('inter').hidden)), 'going back does not set off the round announcement');
  const zero = await tv.evaluate(() => [...document.querySelectorAll('.tvboard')[0].querySelectorAll('.tvrow .pt')].map(p => p.textContent));
  assert.ok(zero.length === 9 && zero.every(p => p === '0'), 'everyone is back on zero points');
  assert.equal(((await db()).scores || {})[id], undefined, 'the phone scores of the deleted rounds are gone from the database');
  assert.equal(await admin.locator('details.prev').count(), 0, 'no earlier rounds are left');
  sitting = (await tv.getAttribute('.tvsit', 'data-names')).trim();
  for (const c of [7, 6]) { await admin.click(`.panel >> nth=0 >> .courtcard[data-court="${c}"]`); await admin.click('.digits button[data-side="sa"][data-v="4"]'); await admin.click('.digits button[data-side="sb"][data-v="2"]'); await admin.click('#saveScore'); }
  await admin.waitForSelector('.roundhead .big:text("Round 2")');
  await tv.waitForFunction(() => /Round 2/.test(document.querySelector('.tvhead .round').textContent), null, { timeout: 15000 });
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 10000 });
  step('deleted every round: the night restarted on a fresh round 1 with everyone on zero; then played on to round 2');

  // 5. rename a player, then end the night: results are saved per player
  await admin.click(`.teamlist [data-edit="${sitting}"]`);
  assert.equal(await admin.locator('#rn2').count(), 0, 'one name to edit');
  await admin.fill('#rn1', sitting + ' Jr');
  await admin.click('#saveNames');
  await tv.waitForSelector(`.tvcourt .tm:has-text("${sitting} Jr")`, { timeout: 8000 });
  // 5b. WPR Social ratings after the names on both leaderboards; NR for anyone without one
  const rated = NAMES.find(n => n !== sitting);
  await admin.click(`.teamlist [data-edit="${rated}"]`);
  await admin.fill('#rt1', '4.37');
  await admin.click('#saveNames');
  await tv.waitForSelector(`.tvboard >> nth=0 >> .tvrow .nm:has-text("${rated}") >> .rt:text("(4.37)")`, { timeout: 10000 });
  const boards = await tv.evaluate(() => [...document.querySelectorAll('.tvboard')].map(b => [...b.querySelectorAll('.tvrow .nm')].map(n => n.textContent)));
  assert.ok(boards[0].includes(rated + '(4.37)') && boards[1].includes(rated + '(4.37)'), 'on tonight\'s board and on the month\'s');
  assert.ok(boards[0].filter(t => /\(NR\)$/.test(t)).length === 8, 'everyone else shows (NR)');
  await tv.screenshot({ path: SHOTS + 'solo-tv-ratings.png' });
  await admin.click(`.teamlist [data-edit="${rated}"]`);
  assert.equal(await admin.inputValue('#rt1'), '4.37', 'the rating is there next time the player is edited');
  await admin.fill('#rt1', 'abc'); await admin.click('#saveNames');
  await admin.waitForSelector('text=A WPR rating is a number like 4.37');
  await admin.fill('#rt1', ''); await admin.click('#saveNames');
  await tv.waitForSelector(`.tvboard >> nth=0 >> .tvrow .nm:has-text("${rated}") >> .rt:text("(NR)")`, { timeout: 10000 });
  await admin.click(`.teamlist [data-edit="${rated}"]`); await admin.fill('#rt1', '4.37'); await admin.click('#saveNames');
  step('WPR Social rating typed on the iPad shows after the name on both TV leaderboards; empty is NR');

  await admin.click('text=End night'); await admin.click('#modalOk');
  await admin.waitForSelector('text=Night ended');
  await admin.waitForSelector('.sync:text("Saved")');
  const res = Object.values(Object.values((await db()).results[id])[0])[0];
  assert.equal(res.scoring, 'player'); assert.equal(res.format, 'kings-individual');
  assert.equal(Object.keys(res.entries).length, 8, 'eight players have played a scored round');
  step('player renamed mid-night; night ended with ' + Object.keys(res.entries).length + ' player results saved');

  // 6. club flyers: with the night ended, the slideshow has a slide with this month's top three of every social
  const tvF = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tvF');
  await tvF.goto(BASE + '/tv/?db=' + DB + '&flyers=1');
  await tvF.waitForSelector('.lb.on .lbcard', { timeout: 10000 });
  assert.match(await tvF.textContent('.lbhead h1'), /leaderboards$/i);
  assert.equal((await tvF.textContent('.lbcard .lbname b')).trim(), 'Tapas Fridays - Intermediate King\u2019s Court', 'the long name fits in full');
  const top3 = await tvF.evaluate(() => [...document.querySelectorAll('.lbcard .lbrow')].map(r => [r.querySelector('.nm').textContent, parseInt(r.querySelector('.pt').textContent, 10)]));
  const best = Object.values(res.entries).sort((x, y) => y.points - x.points || y.wins - x.wins || (x.name < y.name ? -1 : 1)).slice(0, 3).map(e => [e.name, e.points]);
  assert.deepEqual(top3.map(r => r[1]), best.map(r => r[1]), 'the three highest totals of the month');
  assert.equal(top3.length, 3);
  await tvF.waitForTimeout(1400);
  await tvF.screenshot({ path: SHOTS + 'tv-leaderboards.png' });
  step('club flyers show the month\'s top three: ' + top3.map(r => r[0] + ' ' + r[1]).join(', '));

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E SOLO OK');
})().catch(e => { console.error('E2E SOLO FAILED:', e.message); process.exit(1); });
