'use strict';
// Browser check of the banner made from the flyer itself (start tools/mock-server.js first):  node test/e2e-band.js
//   Flyer and look offers blown-up strips of the flyer; the one tapped fills the TV banner; a pattern can take over again.
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

  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.fill('#newSeries', 'Morning Open Play'); await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForFunction(() => document.getElementById('bartitle').textContent === 'Morning Open Play');

  // a made-up portrait flyer: cream paper, a red brush stroke, a navy band, small print at the bottom
  const flyer = await admin.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1500; const g = c.getContext('2d');
    g.fillStyle = '#f3ece2'; g.fillRect(0, 0, 1200, 1500);
    g.fillStyle = '#d6294f'; g.fillRect(90, 240, 1020, 230);
    g.fillStyle = '#12303f'; g.fillRect(60, 760, 1080, 190);
    g.fillStyle = '#9aa7ad'; g.fillRect(200, 520, 800, 150);
    g.fillStyle = '#12303f'; g.font = '28px sans-serif'; for (let i = 0; i < 6; i++) g.fillText('Mondays 6:30 to 8:30 am, four courts, eighteen spots', 90, 1150 + i * 44);
    return c.toDataURL('image/png').split(',')[1];
  });
  await admin.click('.topbar .linkbtn:text("Events")');
  await admin.click('[data-look="morning-open-play"]');
  await admin.setInputFiles('#flyer-tall', { name: 'flyer.png', mimeType: 'image/png', buffer: Buffer.from(flyer, 'base64') });
  await admin.waitForSelector('.bandopt', { timeout: 30000 });
  const n = await admin.locator('.bandopt').count();
  assert.ok(n >= 2 && n <= 5, 'a few strips of the flyer are offered: ' + n);
  assert.equal(await admin.getAttribute('#lookbar', 'data-band'), null, 'none is chosen until one is tapped');
  step(n + ' strips of the flyer offered as the banner');

  await admin.click('.bandopt[data-band="1"]');
  await admin.waitForSelector('.bandopt.on[data-band="1"]');
  assert.match(await admin.getAttribute('#lookbar', 'data-band'), /^(light|dark)$/);
  assert.equal(await admin.locator('.patchips .chip.on').count(), 0, 'no pattern is marked while a strip is the banner');
  await tv.waitForFunction(() => /^url\("data:image\/jpeg/.test(document.getElementById('tvbar').style.backgroundImage), null, { timeout: 45000 });
  assert.match(await tv.getAttribute('#tvbar', 'data-band'), /^(light|dark)$/);
  assert.equal(await tv.getAttribute('#tvbar', 'data-pattern'), null);
  const meta = (await (await fetch(BASE + '/__dump')).json()).db.pub;
  assert.ok(/^data:image\/jpeg/.test(meta.eventflyers['morning-open-play'].band), 'the chosen strip is saved as its own picture');
  assert.equal(meta.series['morning-open-play'].look.band, true);
  step('the tapped strip fills the banner on the TV (lettering ' + await tv.getAttribute('#tvbar', 'data-band') + ')');

  await admin.click('.patchips [data-pattern="stripes"]');
  await admin.waitForSelector('#lookbar[data-pattern="stripes"]');
  await tv.waitForSelector('#tvbar[data-pattern="stripes"]', { timeout: 45000 });
  assert.equal(await tv.getAttribute('#tvbar', 'data-band'), null);
  const after = (await (await fetch(BASE + '/__dump')).json()).db.pub;
  assert.ok(!after.eventflyers['morning-open-play'].band && !after.series['morning-open-play'].look.band, 'the strip is gone from the database');
  step('a pattern takes the banner back');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('E2E BAND OK');
})().catch(e => { console.error('E2E BAND FAILED:', e.message); process.exit(1); });
