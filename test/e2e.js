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
  assert.match(await tv.getAttribute('.tvqr svg', 'data-qr'), /\/p\/\?(db=[^&]+&)?s=lehi-date-night$/, 'players\' QR points at the score page for this social');
  const bottomTeam = (await admin.locator('.courtcard[data-court="3"] .tm div').first().textContent()).trim();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const player = await phoneCtx.newPage();
  player.on('pageerror', e => errors.push('player: ' + e));
  await player.goto(BASE + '/p/?db=' + DB + '&s=lehi-date-night');
  await player.waitForSelector('#rolePlayer');
  assert.equal(await player.locator('.pl-pick').count(), 0, 'first the phone asks: player or admin');
  await player.screenshot({ path: SHOTS + 'phone-roles.png' });
  await player.click('#roleAdmin');                               // admin on a phone that has no key yet
  await player.fill('#adminKey', 'not-it');
  await player.click('#keyGo');
  await player.waitForSelector('text=That key was not accepted');
  await player.fill('#adminKey', 'test-key');
  await player.click('#keyGo');
  await player.waitForSelector('.roundhead .big', { timeout: 10000 });
  assert.match(player.url(), /:8787\/\?db=[^&]+&s=lehi-date-night$/, 'the right key opens the admin page for this social (and stays on the test database)');
  assert.ok(await player.locator('#endNight, #changeCourts').count() >= 2, 'with all the admin controls');
  await player.goto(BASE + '/p/?db=' + DB + '&s=lehi-date-night');
  await player.waitForSelector('#rolePlayer');
  await player.click('#rolePlayer');                              // and the player path
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
  // fireworks: something is drawn around the winner's name straight away, and it is gone again within about two seconds
  const lit = () => tv.evaluate(() => { const c = document.getElementById('fx'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++; return n; });
  await tv.waitForTimeout(250);
  const during = await lit();
  assert.ok(during > 50, 'fireworks are on screen right after the score comes in (' + during + ' lit points)');
  await tv.waitForTimeout(250);
  await tv.screenshot({ path: SHOTS + 'tv-fireworks.png' });
  // meanwhile the winner's crown is off dancing around the screen; the one beside the name is hidden until it lands
  assert.equal(await tv.locator('.crownfly').count(), 1, 'the crown is dancing');
  assert.equal(await tv.locator('.tvcourt.done .tm.a .crown.away').count(), 1, 'and its place beside the name is kept free');
  const lap = [];
  for (let i = 0; i < 28; i++) { lap.push(await tv.evaluate(() => { const e = document.querySelector('.crownfly'); if (!e) return null; const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2 / innerHeight; })); await tv.waitForTimeout(100); }
  const ys = lap.filter(v => v !== null);
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > 1, 'the crown swings off the top and the bottom of the screen (' + Math.min(...ys).toFixed(2) + ' to ' + Math.max(...ys).toFixed(2) + ')');
  await tv.waitForTimeout(1900);
  assert.equal(await lit(), 0, 'the fireworks have faded away a few seconds later');
  assert.equal(await tv.locator('.crownfly').count(), 0, 'the crown has landed');
  assert.equal(await tv.locator('.crown.away').count(), 0, 'and shows beside the winner again');
  assert.match(await tv.textContent('.tvcourt.done .mid'), /6 . 2/);
  assert.equal((await tv.textContent('.tvcourt.done .tm.a')).trim(), bottomTeam + '\u00a0\uD83D\uDC51', 'left side wins: the crown follows the name');
  assert.ok(!(await tv.textContent('.tvcourt.done .tm.b')).includes('\uD83D\uDC51'), 'and not the losing team\'s');
  const medals = await tv.locator('.tvboard >> nth=0 >> .tvrow .md').allTextContents();
  assert.deepEqual(medals.filter(Boolean), ['\uD83E\uDD47', '\uD83E\uDD48'], 'gold for the leader, silver for second; no medal for teams on zero');
  assert.ok(await tv.locator('.tvboard >> nth=0 >> .tvrow .md.gold').count() === 1);
  // (the organizer's "sent from a phone" note has come and gone while the crown danced; the court itself is the proof)
  await admin.waitForFunction(() => document.querySelectorAll('.panel')[0].querySelectorAll('.courtcard.todo').length === 4, null, { timeout: 8000 });
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
  // the admin scored court 7 as 3-4, so the right-hand team won there: crown first, then the name
  const kingsRight = (await admin.locator('details.prev .courtcard[data-court="7"] .tm div').nth(1).textContent().catch(() => '')).trim();
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
  await solo.waitForSelector('#rolePlayer');
  await solo.click('#rolePlayer');
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
  await tv2.waitForSelector('.tvmenu .code');                       // two socials now: a TV with nothing chosen opens on its main menu
  const code = (await tv2.textContent('.tvmenu .code')).trim();
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.match(await tv2.getAttribute('.tvmenu .side svg', 'data-qr'), new RegExp('/\\?(db=[^&]+&)?tv=' + code + '$'), 'the menu\'s QR opens the admin page for this TV');
  assert.deepEqual(await tv2.locator('.tvmenu .pickbtn b').allTextContents(), ['Lehi Date Night', 'Tempe Mixer', 'Club flyers', 'Special event flyers'], 'the menu lists every social and the two flyer slideshows');
  assert.equal(await tv2.textContent('#bartitle'), 'Main menu');
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
  await tv3.waitForSelector('.tvmenu .code');
  const code3 = (await tv3.textContent('.tvmenu .code')).trim();
  await admin2.fill('#tvCode', code3.toLowerCase());                 // typed by hand, any case
  await admin2.selectOption('#tvEvent', 'tempe-mixer');
  await admin2.click('#addTv');
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Tempe Mixer', null, { timeout: 8000 });
  assert.equal(await admin2.locator('.tvitem').count(), 2);
  await admin2.screenshot({ path: SHOTS + 'ipad-tvs.png', fullPage: true });
  step('two socials: one TV paired by QR, re-pointed from the TVs list, another added by typing its code');

  // 13d. the format under the title, and the TV's own main menu, worked with the remote's arrow keys
  assert.equal(await tv3.textContent('#barsub'), 'Fixed partner, king\u2019s court', 'the format shows under the social\'s name');
  assert.ok(await tv3.isVisible('#menu'), 'Main menu button is beside Full screen');
  assert.ok((await tv3.locator('#menu').boundingBox()).x < (await tv3.locator('#fs').boundingBox()).x, 'Main menu sits to the left of Full screen');
  await tv3.screenshot({ path: SHOTS + 'tv-buttons.png' });
  await tv3.click('#menu');
  await tv3.waitForSelector('.tvmenu .pickbtn');
  assert.ok(!(await tv3.isVisible('#menu')), 'no Main menu button on the main menu itself');
  assert.equal(await tv3.evaluate(() => document.activeElement.getAttribute('data-pick')), 'lehi-date-night', 'the first choice is in focus');
  await tv3.waitForTimeout(2500);                                    // the menu refreshes quietly: focus stays where it is
  await tv3.keyboard.press('ArrowDown');
  assert.equal(await tv3.evaluate(() => document.activeElement.getAttribute('data-pick')), 'tempe-mixer');
  await tv3.screenshot({ path: SHOTS + 'tv-menu.png' });
  await tv3.keyboard.press('ArrowUp');
  await tv3.keyboard.press('Enter');
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Lehi Date Night');
  await tv3.reload();
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Lehi Date Night', null, { timeout: 8000 });
  step('TV main menu: opened with the button, moved with the arrow keys, choice remembered after a reload');

  // 13e. club flyers: none yet, two uploaded from the flyers page, the TV shows them and moves on by itself
  await tv3.keyboard.press('m');
  await tv3.waitForSelector('.tvmenu .pickbtn');
  await tv3.keyboard.press('ArrowDown'); await tv3.keyboard.press('ArrowDown'); await tv3.keyboard.press('Enter');
  // no flyers uploaded yet: the slideshow is just the month's leaderboards (two nights of Lehi Date Night have ended)
  await tv3.waitForSelector('.lb.on .lbcard', { timeout: 8000 });
  assert.deepEqual(await tv3.locator('.lbcard .lbname b').allTextContents(), ['Lehi Date Night'], 'only socials with a finished night this month are listed');
  assert.equal(await tv3.locator('.lbcard .lbrow').count(), 3, 'top three');
  assert.ok(!(await tv3.isVisible('.tvbar')), 'no banner over the flyers');
  const fly = await ipad.newPage();
  fly.on('pageerror', e => errors.push('flyers: ' + e));
  await fly.goto(BASE + '/flyers/?db=' + DB);
  await fly.waitForSelector('text=No flyers yet');
  const picture = (w, hh, colour, label) => fly.evaluate(([w, hh, colour, label]) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, w, hh); g.fillStyle = '#fff'; g.font = 'bold ' + hh / 5 + 'px sans-serif'; g.textAlign = 'center'; g.fillText(label, w / 2, hh / 2); return c.toDataURL('image/png').split(',')[1]; }, [w, hh, colour, label]);
  await fly.setInputFiles('#pick', [
    { name: 'Summer League.png', mimeType: 'image/png', buffer: Buffer.from(await picture(3200, 1800, '#12508f', 'SUMMER LEAGUE'), 'base64') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') },
    { name: 'Kids Camp.png', mimeType: 'image/png', buffer: Buffer.from(await picture(1600, 900, '#1b7a4f', 'KIDS CAMP'), 'base64') }]);
  await fly.waitForSelector('text=2 flyers added');
  assert.deepEqual(await fly.locator('.flycard .nm').allTextContents(), ['Summer League', 'Kids Camp']);
  assert.match(await fly.textContent('.toast'), /Skipped: notes\.txt/);
  const stored = (await (await fetch(BASE + '/__dump')).json()).db.pub.flyers.club;
  const big = Object.values(stored.index).find(f => f.name === 'Summer League');
  const dims = await fly.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; }), stored.data[Object.keys(stored.index).find(k => stored.index[k] === big)]);
  assert.deepEqual(dims, [1920, 1080], 'a 3200-wide flyer is stored TV-sized');
  await fly.screenshot({ path: SHOTS + 'flyers-page.png', fullPage: true });
  const shown = () => tv3.evaluate(() => { const e = document.querySelector('.flyer.on'); return e ? e.getAttribute('data-id') : null; });
  await tv3.waitForSelector('.flyer.on', { timeout: 40000 });        // the TV looks for new flyers every half minute
  // (the TV may have caught the first photo while the second was still uploading, so wait for the lap to come round)
  const firstId = Object.keys(stored.index).find(k => stored.index[k] === big);
  await tv3.waitForFunction(id => { const e = document.querySelector('.flyer.on'); return e && e.getAttribute('data-id') === id; }, firstId, { timeout: 40000 });
  const first = await shown();
  const box = await tv3.locator('.flyer.on').boundingBox();
  assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 1920, 1080], 'a flyer fills the whole screen');
  await tv3.waitForTimeout(1500);
  await tv3.screenshot({ path: SHOTS + 'tv-flyers.png' });
  const tSlide = Date.now();
  await tv3.waitForFunction(was => { const e = document.querySelector('.flyer.on'); return e && e.getAttribute('data-id') !== was; }, first, { timeout: 20000 });
  assert.equal(stored.index[await shown()].name, 'Kids Camp', 'flyers follow the order of the list');
  step('club flyers: 2 photos uploaded (a text file skipped), TV showed the first and moved to the next after ' + Math.round((Date.now() - tSlide) / 1000) + ' s more');
  await fly.click('.flycard >> nth=1 >> text=Earlier');
  await fly.waitForFunction(() => document.querySelector('.flycard .nm').textContent === 'Kids Camp');
  await fly.click('.flycard >> nth=1 >> text=Remove');
  await fly.click('#modalOk');
  await fly.waitForSelector('text=Flyer removed');
  assert.deepEqual(await fly.locator('.flycard .nm').allTextContents(), ['Kids Camp'], 'reordered, then one removed');
  const left = (await (await fetch(BASE + '/__dump')).json()).db.pub.flyers.club;
  assert.equal(Object.keys(left.data).length, 1, 'the removed flyer\'s picture is gone from the database too');

  // 13e2. the second slideshow: flyers for a special event, kept apart from the club's
  await fly.click('#setSpecial');
  await fly.waitForSelector('h1:text("Special event flyers")');
  await fly.waitForSelector('text=No flyers yet');
  await fly.setInputFiles('#pick', { name: 'Grand Opening.png', mimeType: 'image/png', buffer: Buffer.from(await picture(1920, 1080, '#7a3fc0', 'GRAND OPENING'), 'base64') });
  await fly.waitForSelector('text=1 flyer added');
  const sets = (await (await fetch(BASE + '/__dump')).json()).db.pub.flyers;
  assert.deepEqual([Object.keys(sets.club.index).length, Object.keys(sets.special.index).length], [1, 1], 'each slideshow keeps its own flyers');
  await tv3.keyboard.press('m');
  await tv3.waitForSelector('.tvmenu .pickbtn');
  await tv3.click('[data-pick="@special"]');
  await tv3.waitForSelector('.flyer.on', { timeout: 10000 });
  assert.equal(await tv3.evaluate(() => document.querySelector('.flyer.on').getAttribute('data-id')), Object.keys(sets.special.index)[0], 'the special slideshow shows the special flyer');
  await tv3.waitForTimeout(2500);
  assert.equal(await tv3.locator('.lb.on').count(), 0, 'and no leaderboards slide: only the event\'s flyers');
  await tv3.reload();
  await tv3.waitForSelector('.flyer.on', { timeout: 10000 });
  assert.equal(await tv3.evaluate(() => document.querySelector('.flyer.on').getAttribute('data-id')), Object.keys(sets.special.index)[0], 'the TV remembers it is on the special slideshow');
  await fly.click('#setClub');
  await fly.waitForSelector('h1:text("Club flyers")');
  assert.deepEqual(await fly.locator('.flycard .nm').allTextContents(), ['Kids Camp'], 'the club set is untouched');
  step('special event flyers: their own page tab, their own slideshow on the TV, no leaderboards mixed in');

  // 13f. the iPad can send a TV to the flyers or back to a social; a rename reaches the TVs
  await admin2.selectOption(`#tvevent-${code}`, '@flyers');
  await tv2.waitForSelector('.flyer.on', { timeout: 15000 });
  await admin2.selectOption(`#tvevent-${code3}`, 'tempe-mixer');     // tv3 was on the flyers by its own menu: the newer choice wins
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Tempe Mixer', null, { timeout: 12000 });
  await admin2.click('[data-rename="tempe-mixer"]');
  await admin2.fill('#seriesName', 'Padel Date Night');
  await admin2.click('#saveSeriesName');
  await admin2.waitForSelector('[data-open="tempe-mixer"]:has-text("Padel Date Night")');
  await tv3.waitForFunction(() => document.getElementById('bartitle').textContent === 'Padel Date Night', null, { timeout: 40000 });
  step('iPad sent one TV to the flyers and another back to a social; renamed event reached the TV');

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
