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
  const ipad = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 1 });   // iPad held in portrait
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
  assert.equal(await admin.getAttribute('.a-sets [data-sets="4"]', 'aria-pressed'), 'true', 'sets to 4 by default');
  await admin.click('.a-sets [data-sets="6"]');   // tonight: sets to 6 games
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
  assert.match(await tv.textContent('.tvhead .event'), /Sets to 6/);
  assert.equal(await tv.textContent('#bartitle'), 'Lehi Date Night', 'event name is in the top banner');
  assert.equal(await tv.locator('.tvhead .clock, #clock').count(), 0, 'only one clock on screen: the running one at the bottom left');
  assert.ok(await tv.evaluate(() => { const i = document.querySelector('.tvbar-l img'); return !i.hidden && i.naturalWidth > 0; }), 'P symbol is showing top left');
  assert.match(await tv.textContent('#daytext'), /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day, [A-Z][a-z]+ \d{1,2}(st|nd|rd|th)$/, 'date reads like "Thursday, November 18th"');
  const t1 = await tv.textContent('#timetext');
  assert.match(t1, /^\d{1,2}:\d\d:\d\d (AM|PM)$/, 'clock shows hours, minutes and seconds');
  await tv.waitForTimeout(2100);
  assert.notEqual(await tv.textContent('#timetext'), t1, 'and it is running');
  const dateBox = await tv.locator('#date').boundingBox();
  assert.ok(dateBox.x + dateBox.width <= 1920 && dateBox.y + dateBox.height <= 1080 && dateBox.y > 1000, 'date sits at the bottom of the screen');
  assert.equal(await tv.locator('#fs').isVisible(), true, 'Full screen button is showing');
  await tv.waitForTimeout(9000);
  assert.equal(await tv.evaluate(() => getComputedStyle(document.getElementById('fs')).opacity), '1', 'and it has not faded after 9 seconds');
  const btnBox = await tv.locator('#fs').boundingBox(), boardBox = await tv.locator('.tvboard >> nth=1').boundingBox();
  assert.ok(boardBox.y + boardBox.height <= btnBox.y, 'the button does not cover the leaderboard');
  await tv.screenshot({ path: SHOTS + 'tv-round1.png' });

  // 4b. the TV shows a QR code for players; one of them sends in the bottom court's score from a phone
  assert.ok((await tv.getAttribute('.tvqr svg', 'data-qr')).endsWith('/p/?s=lehi-date-night'), 'players\' QR points at the score page for this social');
  const bottomTeam = (await admin.locator('.courtcard[data-court="3"] .tm div').first().textContent()).trim();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const player = await phoneCtx.newPage();
  player.on('pageerror', e => errors.push('player: ' + e));
  await player.goto(BASE + '/p/?db=' + DB + '&s=lehi-date-night');
  await player.waitForSelector('.pl-pick');
  assert.equal(await player.locator('.pl-pick').count(), 14, 'the phone lists tonight\'s teams');
  await player.click(`.pl-pick[data-team="${bottomTeam}"]`);
  await player.waitForSelector('#send');
  assert.match(await player.textContent('.pl-court'), /Court\s*3/);
  assert.deepEqual(await player.locator('.pl-digits button[data-who="us"]').allTextContents(), ['0', '1', '2', '3', '4', '5', '6']);
  assert.ok(await player.locator('#send').isDisabled(), 'nothing to send until both scores are picked');
  await player.screenshot({ path: SHOTS + 'phone-entry.png' });
  await player.click('.pl-digits button[data-who="us"][data-v="6"]');
  await player.click('.pl-digits button[data-who="them"][data-v="2"]');
  await player.click('#send');
  await player.waitForSelector('text=Score is in');
  await tv.waitForSelector('.tvcourt.done', { timeout: 6000 });
  assert.equal(await tv.locator('.tvcourt.done').count(), 1, 'that court turns green on the TV');
  assert.match(await tv.textContent('.tvcourt.done .mid'), /6 . 2/);
  await admin.waitForSelector('text=sent from a phone', { timeout: 8000 });
  assert.equal(await admin.locator('.panel >> nth=0 >> .courtcard.todo').count(), 4, 'the organizer\'s page picked the score up');
  assert.equal(await player.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, true, 'phone page has no sideways scroll');
  await player.screenshot({ path: SHOTS + 'phone-sent.png' });
  step('a player sent 6-2 for court 3 from a phone: TV went green, organizer\'s page applied it');

  // 5. enter a round of scores; the next round appears by itself
  async function scoreRound(n, shots) {
    for (let i = 0; i < 20; i++) {
      const todo = admin.locator(`.panel >> nth=0 >> .courtcard.todo[data-round="${n}"]`);
      if (!(await todo.count())) break;
      await todo.first().click();
      const aWins = (n + i) % 2 === 0, lose = (n * 3 + i) % 4;
      await admin.click(`.digits button[data-side="sa"][data-v="${aWins ? 4 : lose}"]`);
      await admin.click(`.digits button[data-side="sb"][data-v="${aWins ? lose : 4}"]`);
      if (shots && i === 0) {
        const labels = await admin.locator('.digits button[data-side="sa"]').allTextContents();
        assert.deepEqual(labels, ['0', '1', '2', '3', '4', '5', '6'], 'score buttons run 0 to 6 for sets to 6, never 7');
        await admin.screenshot({ path: SHOTS + 'ipad-score.png' });
      }
      await admin.click('#saveScore');
      if (shots && i === 1) { await tv.waitForSelector('.mid.score'); await tv.screenshot({ path: SHOTS + 'tv-midround.png' }); await admin.screenshot({ path: SHOTS + 'ipad-live.png' }); }
    }
  }
  await scoreRound(1, true);
  await admin.waitForSelector('.roundhead .big:text("Round 2")');
  await player.waitForFunction(() => /Round 2/.test(document.querySelector('.pl-top span').textContent), null, { timeout: 8000 });
  assert.ok(await player.locator('#send, .pl-card h2').count(), 'the phone moved on to round 2 by itself');
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

  // 7b. change courts mid-round: courts 3 and 4 are swapped for 1 and 2; unscored matches move, nobody changes opponent
  const sevenCourts = await admin.locator('.chip').count();
  await admin.click('#changeCourts');
  assert.equal(await admin.locator('.sheet .chip').count(), 7, 'the picker offers courts 1 to 7');
  await admin.click('.sheet .chip[data-court="3"]'); await admin.click('.sheet .chip[data-court="4"]');
  await admin.click('.sheet .chip[data-court="1"]'); await admin.click('.sheet .chip[data-court="2"]');
  await admin.click('.sheet >> text=Sort low to high');
  assert.match(await admin.textContent('.sheet .ladder'), /1 → 2 → 5 → 6 → 7 King/);
  await admin.screenshot({ path: SHOTS + 'ipad-courts.png' });
  await admin.click('#applyCourts');
  await admin.waitForSelector('text=moved to the new court numbers');
  await tv.waitForFunction(() => Array.from(document.querySelectorAll('.tvcourt .cn b')).map(b => b.textContent).join() === '7,6,5,2,1', null, { timeout: 6000 });
  step('courts changed mid-round: TV now shows courts 7, 6, 5, 2, 1');

  // 7c. fix a mistyped name mid-night: it changes on the courts, the leaderboard and the TV
  await admin.click('[data-edit="Ana & Luis"]');
  await admin.fill('#rn1', 'Anna');
  await admin.click('#saveNames');
  await admin.waitForSelector('text=Now Anna & Luis');
  assert.equal(await admin.locator('text=Ana & Luis').count(), 0, 'the old name is gone from the admin page');
  await tv.waitForFunction(() => document.body.textContent.includes('Anna & Luis') && !document.body.textContent.includes('Ana & Luis'), null, { timeout: 8000 });
  step('renamed "Ana & Luis" to "Anna & Luis" mid-night: admin page and TV both follow');

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

  // 13. a night set to 4 games offers 0 to 4 only
  await admin.click('.a-sets [data-sets="4"]');
  for (let i = 0; i < 2; i++) await admin.locator('.regulars button').first().click();
  await admin.click('#startNight');
  await admin.locator('.courtcard.todo').first().click();
  assert.deepEqual(await admin.locator('.digits button[data-side="sb"]').allTextContents(), ['0', '1', '2', '3', '4']);
  await admin.click('text=Cancel');
  step('score buttons: 0-6 for sets to 6, 0-4 for sets to 4');

  // 13b. two teams, one court: the phone sends the only score and the next round starts without touching the iPad
  await admin.waitForSelector('.sync:text("Saved")');
  const solo = await phoneCtx.newPage();
  await solo.goto(BASE + '/p/?db=' + DB + '&s=lehi-date-night');
  await solo.waitForSelector('.pl-pick');
  assert.equal(await solo.locator('.pl-pick').count(), 2);
  await solo.locator('.pl-pick').first().click();
  await solo.waitForSelector('#send');
  await solo.click('.pl-digits button[data-who="us"][data-v="4"]');
  await solo.click('.pl-digits button[data-who="them"][data-v="4"]');
  assert.ok(await solo.locator('#send').isDisabled(), 'level score: must say who moves up');
  await solo.click('.pl-two button >> nth=0');
  await solo.click('#send');
  await tv.waitForSelector('.tvhead .round:text("Round 2")', { timeout: 10000 });
  await solo.waitForFunction(() => /Round 2/.test(document.querySelector('.pl-top span').textContent), null, { timeout: 8000 });
  await solo.waitForSelector('#send');
  step('last score sent from a phone: round 2 started by itself on the TV and on the phone');

  // 13c. a second social, and TVs paired to one or the other
  const admin2 = await ipad.newPage();
  admin2.on('pageerror', e => errors.push('admin2: ' + e));
  await admin2.goto(BASE + '/?db=' + DB);
  await admin2.waitForSelector('.topbar .linkbtn:text("Events")');
  await admin2.click('.topbar .linkbtn:text("Events")');
  await admin2.fill('#newSeries', 'Tempe Mixer');
  await admin2.click('text=Create');
  await admin2.waitForSelector('text=Courts');
  await admin2.waitForSelector('.sync:text("Saved")');
  const tv2 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  tv2.on('pageerror', e => errors.push('tv2: ' + e));
  await tv2.goto(BASE + '/tv/?db=' + DB);
  await tv2.waitForSelector('.tvpair .code');
  const code = (await tv2.textContent('.tvpair .code')).trim();
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.ok((await tv2.getAttribute('.tvpair svg', 'data-qr')).endsWith('/?tv=' + code), 'pairing QR opens the admin page for this TV');
  await tv2.screenshot({ path: SHOTS + 'tv-pairing.png' });
  await admin2.goto(BASE + '/?db=' + DB + '&tv=' + code);          // what scanning the QR does
  await admin2.waitForSelector('[data-pick="tempe-mixer"]');
  await admin2.screenshot({ path: SHOTS + 'ipad-pair.png' });
  await admin2.click('[data-pick="tempe-mixer"]');
  await tv2.waitForFunction(() => document.getElementById('bartitle').textContent === 'Tempe Mixer', null, { timeout: 8000 });
  assert.equal(await tv.textContent('#bartitle'), 'Lehi Date Night', 'the first TV is untouched');
  await admin2.waitForSelector(`#tvevent-${code}`);
  await admin2.selectOption(`#tvevent-${code}`, 'lehi-date-night');     // re-point it from the TVs list
  await tv2.waitForFunction(() => document.getElementById('bartitle').textContent === 'Lehi Date Night', null, { timeout: 12000 });
  const tv3 = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv3.goto(BASE + '/tv/?db=' + DB);
  await tv3.waitForSelector('.tvpair .code');
  const code3 = (await tv3.textContent('.tvpair .code')).trim();
  await admin2.fill('#tvCode', code3.toLowerCase());                 // typed by hand, any case
  await admin2.selectOption('#tvEvent', 'tempe-mixer');
  await admin2.click('#addTv');
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Tempe Mixer', null, { timeout: 8000 });
  assert.equal(await admin2.locator('.tvitem').count(), 2);
  await admin2.screenshot({ path: SHOTS + 'ipad-tvs.png', fullPage: true });
  step('two socials: one TV paired by QR, re-pointed from the TVs list, another added by typing its code');

  // 14. phone-width check of the admin page (no sideways scroll)
  const phone = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/?db=' + DB + '#k=test-key');
  await pp.waitForSelector('.tvadd');
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no sideways scroll at phone width (overflow ' + overflow + 'px)');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E OK');
})().catch(e => { console.error('E2E FAILED:', e.message); process.exit(1); });
