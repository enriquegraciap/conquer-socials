'use strict';
// End-to-end check in a real browser against the local stand-in server (start tools/mock-server.js first).
//   node test/e2e.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';
const names = [['Ana', 'Luis'], ['Brooke', 'Tyler'], ['Carla', 'Mateo'], ['Dana', 'Chris'], ['Elena', 'Marco'], ['Fran', 'Javi'], ['Gaby', 'Diego'],
  ['Hannah', 'Jake'], ['Ines', 'Pablo'], ['Julia', 'Sam'], ['Karla', 'Hunter'], ['Lucia', 'Andres'], ['Maria', 'Milan'], ['Nora', 'Christopher-Alexander']];

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const ipad = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1 });
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const admin = await ipad.newPage(), tv = await tvCtx.newPage();
  const errors = [];
  [admin, tv].forEach(p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); }); });
  const step = (m) => console.log('  ' + m);

  // 1. no key yet: creating an event asks for the admin key, a wrong key is refused
  await admin.goto(BASE + '/?db=' + DB);
  await admin.fill('#newSeries', 'Lehi Date Night');
  await admin.click('text=Create');
  await admin.fill('#keyInput', 'wrong-key');
  await admin.click('#saveKey');
  await admin.waitForSelector('text=That key was not accepted');
  await admin.fill('#keyInput', 'test-key');
  await admin.click('#saveKey');
  await admin.waitForSelector('text=Courts');
  step('admin key: wrong key refused, right key accepted, event created');

  // 2. setup: courts bottom to top, 14 teams
  for (const c of [3, 4, 5, 6, 7]) await admin.click(`.chip[data-court="${c}"]`);
  assert.match(await admin.textContent('.ladder'), /3 → 4 → 5 → 6 → 7 King/);
  for (const [a, b] of names) { await admin.fill('#p1', a); await admin.fill('#p2', b); await admin.click('#addTeam'); }
  assert.equal(await admin.locator('.teamlist li').count(), 14);
  await admin.waitForSelector('text=14 teams on 5 courts: 10 play, 4 sit out each round.');
  await admin.waitForSelector('.sync:text("Saved")');
  await admin.screenshot({ path: SHOTS + 'ipad-setup.png' });
  step('setup: courts 3-7 picked in order, 14 teams entered');

  // 3. TV before the start
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('text=14 teams checked in');
  await tv.screenshot({ path: SHOTS + 'tv-setup.png' });

  // 4. start the night: TV shows round 1 within a few seconds
  await admin.click('#startNight');
  let t0 = Date.now();
  await tv.waitForSelector('.tvhead .round:text("Round 1")', { timeout: 6000 });
  step('TV showed round 1 after ' + (Date.now() - t0) + ' ms');
  assert.equal(await tv.locator('.tvcourt').count(), 5);
  assert.equal((await tv.textContent('.tvsit .names')).split('\u00b7').length, 4);
  assert.match(await tv.textContent('.tvcourt.king .cn'), /King.s Court\s*7/);
  await tv.screenshot({ path: SHOTS + 'tv-round1.png' });

  // 5. enter a round of scores; the next round appears by itself
  async function scoreRound(n, shots) {
    const cards = admin.locator(`.courtcards >> nth=0 >> .courtcard`);
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await admin.locator(`.panel >> nth=0 >> .courtcard.todo`).first().click();
      const aWins = (n + i) % 2 === 0, lose = (n * 3 + i) % 4;
      await admin.click(`.digits button[data-side="sa"][data-v="${aWins ? 4 : lose}"]`);
      await admin.click(`.digits button[data-side="sb"][data-v="${aWins ? lose : 4}"]`);
      if (shots && i === 0) await admin.screenshot({ path: SHOTS + 'ipad-score.png' });
      await admin.click('#saveScore');
      if (shots && i === 1) { await tv.waitForSelector('.mid.score'); await tv.screenshot({ path: SHOTS + 'tv-midround.png' }); await admin.screenshot({ path: SHOTS + 'ipad-live.png' }); }
    }
  }
  await scoreRound(1, true);
  await admin.waitForSelector('.roundhead .big:text("Round 2")');
  t0 = Date.now();
  await tv.waitForSelector('.tvhead .round:text("Round 2")', { timeout: 6000 });
  step('round 2 generated automatically; TV caught up after ' + (Date.now() - t0) + ' ms');
  const tonight = await tv.locator('.tvboard >> nth=0 >> .tvrow').count();
  assert.equal(tonight, 14);

  // 6. correct a mistyped score from round 1: round 2 is redone because nobody has played it yet
  await admin.click('details.prev summary');
  const firstPrev = admin.locator('details.prev .courtcard').first();
  const lineup = async () => (await admin.locator('.panel >> nth=0 >> .courtcards').textContent()) + (await admin.locator('.panel >> nth=0 >> .sitlist >> nth=0').textContent());
  const before = await lineup();
  await firstPrev.click();
  await admin.click('.digits button[data-side="sa"][data-v="4"]');   // was 3-4: the other team actually won
  await admin.click('.digits button[data-side="sb"][data-v="1"]');
  await admin.click('#saveScore');
  await admin.waitForSelector('text=has been redone with the corrected result');
  const after = await lineup();
  assert.notEqual(before, after, 'round 2 line-up changed after the round 1 winner was corrected');
  step('score correction redid round 2');

  // 7. level score needs a winner
  await admin.locator('.panel >> nth=0 >> .courtcard.todo').first().click();
  await admin.click('.digits button[data-side="sa"][data-v="3"]');
  await admin.click('.digits button[data-side="sb"][data-v="3"]');
  assert.ok(await admin.locator('#saveScore').isDisabled());
  await admin.click('.notice .btn >> nth=0');
  await admin.click('#saveScore');
  step('level score asked which team moves up');

  // 8. late arrival and a team leaving mid-round
  await admin.fill('#p1', 'Olga'); await admin.fill('#p2', 'Pete'); await admin.click('#addTeam');
  await admin.waitForSelector('text=Joining next round: Olga & Pete');
  const leaving = (await admin.locator('.panel >> nth=0 >> .courtcard.todo >> nth=0 >> .tm div >> nth=0').textContent()).trim();
  await admin.click(`[aria-label="Remove ${leaving}"]`);
  await admin.click('#modalOk');
  await admin.waitForSelector('text=steps in on court');
  step('late team queued for next round; a sitting team replaced the team that left');
  await scoreRound(2, false);
  await admin.waitForSelector('.roundhead .big:text("Round 3")');
  await tv.waitForSelector('.tvhead .round:text("Round 3")', { timeout: 6000 });
  assert.ok((await tv.textContent('.tvcourts')).includes('Olga & Pete'), 'late team is on a court in round 3');
  assert.ok(!(await tv.textContent('.tvleft')).includes(leaving), 'team that left is not in round 3');
  for (let n = 3; n <= 5; n++) { await scoreRound(n, false); await admin.waitForSelector(`.roundhead .big:text("Round ${n + 1}")`); }
  await tv.waitForSelector('.tvhead .round:text("Round 6")', { timeout: 6000 });
  await tv.screenshot({ path: SHOTS + 'tv-round6.png' });

  // 9. reload the iPad page: everything comes back from the database
  await admin.reload();
  await admin.waitForSelector('.roundhead .big:text("Round 6")');
  step('iPad reload restored round 6 from the database');

  // 10. end the night: TV shows final standings, monthly table has tonight
  await admin.click('#endNight'); await admin.click('#modalOk');
  await tv.waitForSelector('.tvhead .round:text("Final standings")', { timeout: 6000 });
  await tv.screenshot({ path: SHOTS + 'tv-final.png' });
  await admin.screenshot({ path: SHOTS + 'ipad-ended.png' });
  const dump = await (await fetch(BASE + '/__dump')).json();
  const month = Object.keys(dump.db.pub.results['lehi-date-night'])[0];
  const nights = dump.db.pub.results['lehi-date-night'][month];
  assert.equal(Object.keys(nights).length, 1);
  const res = nights[Object.keys(nights)[0]];
  assert.equal(res.status, 'ended'); assert.equal(res.rounds, 5);
  const tvMonthTop = await tv.locator('.tvboard >> nth=1 >> .tvrow >> nth=0 >> .pt').textContent();
  const tvTonightTop = await tv.locator('.tvboard >> nth=0 >> .tvrow >> nth=0 >> .pt').textContent();
  assert.equal(tvMonthTop, tvTonightTop, 'with one night in the month, the monthly leader has tonight\'s top score');
  step('night ended: ' + res.rounds + ' rounds saved under ' + month + ', ' + Object.keys(res.entries).length + ' teams, ' + dump.writes + ' database writes in total');

  // 11. next night offers the regulars; a second night adds to the monthly table
  await admin.click('#nextNight');
  await admin.waitForSelector('text=Played before (tap to add):');
  assert.equal(await admin.locator('.regulars button').count(), 15);
  for (let i = 0; i < 4; i++) await admin.locator('.regulars button').first().click();
  assert.equal(await admin.locator('.teamlist li').count(), 4);
  await admin.click('#startNight');
  await scoreRound(1, false);
  await admin.click('#endNight'); await admin.click('#modalOk');
  await tv.waitForSelector('.tvboard >> nth=1 >> h2 small:text("2 nights")', { timeout: 6000 });
  step('second night added to the monthly table (2 nights)');

  // 12. discard removes it again
  await admin.waitForSelector('.sync:text("Saved")');
  await admin.click('text=Discard this night'); await admin.click('#modalOk');
  await admin.waitForSelector('text=Night discarded');
  const d2 = await (await fetch(BASE + '/__dump')).json();
  assert.equal(Object.keys(d2.db.pub.results['lehi-date-night'][month]).length, 1);
  step('discarded night no longer counts');

  // 13. phone-width check of the admin page (no sideways scroll)
  const phone = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/?db=' + DB + '#k=test-key');
  await pp.waitForSelector('text=Courts');
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no sideways scroll at phone width (overflow ' + overflow + 'px)');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E OK');
})().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
