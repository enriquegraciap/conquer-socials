'use strict';
// Browser check of the TV handing a finished social's screen to the club flyers (start tools/mock-server.js first):
//   node test/e2e-rest.js
//   End night -> the final standings stay up, then the club flyers take over by themselves; the same when no score has
//   come in for 45 minutes; and the social is back on screen as soon as something happens in it again.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db';

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch(), errors = [];
  const step = m => console.log('  ' + m);
  const admin = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage();
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  [admin, tv].forEach(p => p.on('pageerror', e => errors.push(String(e))));
  const db = async () => (await (await fetch(BASE + '/__dump')).json()).db.pub;
  const patch = body => fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify(Object.assign({ 'gate/test-key': Date.now() }, body)) });
  const onFlyers = () => tv.waitForFunction(() => document.body.classList.contains('mode-flyers'), null, { timeout: 20000 });
  const onSocial = () => tv.waitForFunction(() => !document.body.classList.contains('mode-flyers') && !!document.querySelector('.tvroot'), null, { timeout: 20000 });
  const score = async (court, a, b) => { await admin.click(`.panel >> nth=0 >> .courtcard[data-court="${court}"]`); await admin.click(`.digits button[data-side="sa"][data-v="${a}"]`); await admin.click(`.digits button[data-side="sb"][data-v="${b}"]`); await admin.click('#saveScore'); };

  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.fill('#newSeries', 'Morning Open Play'); await admin.click('.fmtpick [data-format="kings-individual"]'); await admin.click('text=Create');
  await admin.waitForSelector('#startNight');
  for (const n of ['Ana Lopez', 'Bruno Diaz', 'Carla Ruiz', 'Dario Soto']) { await admin.fill('#p1', n); await admin.click('#addTeam'); }
  await admin.click('.courtpick .chip[data-court="1"]');
  await admin.click('#startNight');
  await admin.waitForSelector('.courtcard');
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForSelector('.tvcourt', { timeout: 15000 });
  await score(1, 4, 2);
  await admin.waitForSelector('.roundhead .big:text("Round 2")');
  const id = Object.keys((await db()).sessions['morning-open-play'])[0], at = 'pub/sessions/morning-open-play/' + id;
  assert.ok((await db()).sessions['morning-open-play'][id].scoredAt > Date.now() - 60000, 'the time of the last score is saved with the night');
  await tv.waitForTimeout(5000);
  assert.equal(await tv.evaluate(() => document.body.classList.contains('mode-flyers')), false, 'a social in play stays on screen');
  step('a social in play stays on the TV');

  // 1. no score for 45 minutes: the club flyers take over; a new score brings the social back
  await patch({ [at + '/scoredAt']: Date.now() - 46 * 60000, 'pub/live/morning-open-play/rev': 'quiet-1' });
  await onFlyers();
  step('no score for 45 minutes: the club flyers (and the month\'s leaderboards) take over');
  await score(1, 4, 1);
  await onSocial();
  await tv.waitForSelector('.tvcourt');
  step('a new score: the social is back on the TV by itself');

  // 2. End night: the final standings first, the flyers a few minutes later; reopening brings the social back
  await admin.click('text=End night'); await admin.click('#modalOk');
  await tv.waitForSelector('text=Final standings', { timeout: 15000 });
  const ended = (await db()).sessions['morning-open-play'][id].endedAt;
  assert.ok(ended > Date.now() - 60000, 'the time the night ended is saved');
  await tv.waitForTimeout(5000);
  assert.equal(await tv.evaluate(() => document.body.classList.contains('mode-flyers')), false, 'the final standings stay up for the first minutes');
  await patch({ [at + '/endedAt']: Date.now() - 6 * 60000, 'pub/live/morning-open-play/rev': 'ended-1' });
  await onFlyers();
  step('End night: the final standings first, then the club flyers by themselves');
  await admin.click('text=Reopen this night');
  await onSocial();
  step('the night reopened: the social is back');

  // 3. chosen by hand on the TV: it stays up for a while even though it is over
  await admin.click('text=End night'); await admin.click('#modalOk');
  await tv.waitForSelector('text=Final standings', { timeout: 15000 });
  await admin.waitForFunction(() => /Saved/.test((document.querySelector('.sync') || {}).textContent || ''));
  await patch({ [at + '/endedAt']: Date.now() - 6 * 60000, 'pub/live/morning-open-play/rev': 'ended-2' });
  await onFlyers();
  await tv.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /main menu/i.test(x.textContent)); b.click(); });
  await tv.waitForSelector('[data-pick="morning-open-play"]', { timeout: 15000 });
  await tv.click('[data-pick="morning-open-play"]');
  await tv.waitForSelector('text=Final standings', { timeout: 15000 });
  await tv.waitForTimeout(6000);
  assert.equal(await tv.evaluate(() => document.body.classList.contains('mode-flyers')), false, 'picked by hand: it is not taken away again at once');
  step('picked by hand on the TV: the finished social stays up');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('E2E REST OK');
})().catch(e => { console.error('E2E REST FAILED:', e.message); process.exit(1); });
