'use strict';
// Browser check of each social's flyer and look (start tools/mock-server.js first):  node test/e2e-look.js
//   the flyer is uploaded on the admin page -> the TV banner takes its colours and the chosen pattern,
//   phones show the flyer for a few seconds on arrival, and the TV announces every new round over the flyer.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(tag + ': ' + e)); return p; };
  const step = m => console.log('  ' + m);
  const admin = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage(), 'admin');
  const tv = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tv');

  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.fill('#newSeries', 'Padel Date Night'); await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  await tv.goto(BASE + '/tv/?db=' + DB);
  await tv.waitForFunction(() => document.getElementById('bartitle').textContent === 'Padel Date Night');
  assert.equal(await tv.getAttribute('#tvbar', 'data-pattern'), null, 'no flyer yet: the banner keeps the club colours');

  // a made-up flyer: deep red with pink and cream, the way a date-night flyer might look
  const flyer = (w, hh) => admin.evaluate(([w, hh]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d');
    g.fillStyle = '#8f1239'; g.fillRect(0, 0, w, hh);
    g.fillStyle = '#ff5fa2'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(w * (0.1 + i * 0.1), hh * (i % 2 ? 0.25 : 0.75), Math.min(w, hh) * 0.09, 0, 7); g.fill(); }
    g.fillStyle = '#ffe9c7'; g.fillRect(w * 0.2, hh * 0.42, w * 0.6, hh * 0.16);
    g.fillStyle = '#8f1239'; g.font = 'bold ' + hh * 0.1 + 'px sans-serif'; g.textAlign = 'center'; g.fillText('PADEL DATE NIGHT', w / 2, hh * 0.535);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, hh]);

  // 1. upload the wide flyer, pick a pattern
  await admin.click('.topbar .linkbtn:text("Events")');
  await admin.click('[data-look="padel-date-night"]');
  await admin.waitForSelector('#lookbar');
  assert.equal(await admin.getAttribute('#lookbar', 'data-pattern'), null);
  assert.equal(await admin.locator('.patchips').count(), 0, 'patterns are offered once there is a flyer');
  await admin.setInputFiles('#flyer-wide', { name: 'date-night-wide.png', mimeType: 'image/png', buffer: Buffer.from(await flyer(2400, 1350), 'base64') });
  await admin.waitForSelector('text=Flyer saved');
  await admin.waitForSelector('.patchips .chip.on');
  await admin.click('.patchips [data-pattern="hearts"]');
  await admin.waitForSelector('#lookbar[data-pattern="hearts"]');
  const dump1 = (await (await fetch(BASE + '/__dump')).json()).db.pub;
  const look = dump1.series['padel-date-night'].look;
  look.cands = Object.values(look.cands);
  assert.ok(look.wide && look.rev && look.cands.length >= 2 && look.pattern === 'hearts', 'the look is stored with the social: ' + JSON.stringify(look.cands));
  assert.ok(/^data:image\/jpeg/.test(dump1.eventflyers['padel-date-night'].wide) && /^data:image\/jpeg/.test(dump1.eventflyers['padel-date-night'].phone), 'TV and phone pictures are stored');
  const barColour = await admin.evaluate(() => getComputedStyle(document.getElementById('lookbar')).backgroundColor);
  const [r, g, b] = barColour.match(/\d+/g).map(Number);
  assert.ok(r > g * 1.5 && r > b && r < 150, 'the banner is a dark shade of the flyer\'s red (' + barColour + ')');
  await admin.screenshot({ path: SHOTS + 'look-editor.png' });
  for (const p of ['confetti', 'stripes', 'waves', 'diamonds', 'balls', 'plain', 'hearts']) {
    await admin.click(`.patchips [data-pattern="${p}"]`);
    await admin.waitForSelector(`#lookbar[data-pattern="${p}"]`);
    await admin.locator('#lookbar').screenshot({ path: SHOTS + 'banner-' + p + '.png' });
  }
  const before = barColour;
  await admin.click('#otherColours');
  await admin.waitForFunction(was => getComputedStyle(document.getElementById('lookbar')).backgroundColor !== was, before);
  for (let i = 1; i < look.cands.length; i++) await admin.click('#otherColours');      // all the way round, back to the red
  await admin.waitForFunction(was => getComputedStyle(document.getElementById('lookbar')).backgroundColor === was, before);
  await admin.click('#lookDone');
  step('flyer uploaded on the admin page; banner preview follows its colours; 7 patterns and the colour choices work');

  // 2. the TV's banner follows within half a minute; white logo and letters stay
  await tv.waitForSelector('#tvbar[data-pattern="hearts"]', { timeout: 40000 });
  assert.equal(await tv.evaluate(() => getComputedStyle(document.getElementById('tvbar')).backgroundColor), barColour);
  assert.equal(await tv.evaluate(() => getComputedStyle(document.getElementById('bartitle')).color), 'rgb(255, 255, 255)');
  await tv.screenshot({ path: SHOTS + 'tv-banner-look.png' });
  step('TV banner picked up the pattern and colours');

  // 3. a phone: flyer first, then Player / Admin; not again on a reload
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = watch(await phoneCtx.newPage(), 'phone');
  const t0 = Date.now();
  await phone.goto(BASE + '/p/?db=' + DB + '&s=padel-date-night');
  await phone.waitForSelector('#splash.ready');
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: SHOTS + 'phone-splash.png' });
  await phone.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
  const shownFor = Date.now() - t0;
  assert.ok(shownFor > 3000 && shownFor < 6000, 'the flyer stays for 3 to 4 seconds (' + shownFor + ' ms from opening the page)');
  await phone.waitForSelector('#rolePlayer');
  // the welcome screen: title and round centred, a plain "Hi, welcome!", the P symbol at the bottom, and the flyer
  // blurred behind it all
  await phone.waitForSelector('#plbg.has');
  const hello = await phone.evaluate(() => { const c = q => { const b = document.querySelector(q).getBoundingClientRect(); return Math.round(b.left + b.width / 2); }, bg = getComputedStyle(document.getElementById('plbg'));
    return { title: c('.pl-top.center b'), greet: c('.pl-hello h2'), logo: c('.pl-logo img'), logoBottom: innerHeight - document.querySelector('.pl-logo img').getBoundingClientRect().bottom,
      order: document.querySelector('.pl-top.center').getBoundingClientRect().top < document.querySelector('.pl-hello').getBoundingClientRect().top,
      font: getComputedStyle(document.querySelector('.pl-hello h2')).fontFamily === getComputedStyle(document.querySelector('.pl-role b')).fontFamily,
      picture: /^url\("data:image/.test(bg.backgroundImage), blurred: /blur/.test(bg.filter) }; });
  assert.ok(Math.abs(hello.title - 195) < 4 && Math.abs(hello.greet - 195) < 4 && Math.abs(hello.logo - 195) < 4, 'title, greeting and logo are centred ' + JSON.stringify(hello));
  assert.ok(hello.logoBottom < 70 && hello.order && hello.font && hello.picture && hello.blurred, 'logo at the bottom, greeting in the buttons\' font, blurred flyer behind ' + JSON.stringify(hello));
  await phone.waitForTimeout(700);
  await phone.screenshot({ path: SHOTS + 'phone-welcome-flyer.png' });
  await phone.reload();
  await phone.waitForSelector('#rolePlayer');
  assert.equal(await phone.locator('#splash').count(), 0, 'no flyer again on a reload');
  const phone2 = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(), 'phone2');
  await phone2.goto(BASE + '/p/?db=' + DB + '&s=padel-date-night');
  await phone2.waitForSelector('#splash.ready');
  await phone2.tap('#splash');
  await phone2.waitForSelector('#splash', { state: 'detached', timeout: 1500 });
  step('phone: flyer for ' + (shownFor / 1000).toFixed(1) + ' s, then Player / Admin; a tap skips it; not repeated on reload');

  // 3b. a tall flyer takes over on phones; removing it falls back to the wide one
  await admin.click('[data-look="padel-date-night"]');
  await admin.setInputFiles('#flyer-tall', { name: 'date-night-tall.png', mimeType: 'image/png', buffer: Buffer.from(await flyer(1200, 1800), 'base64') });
  await admin.waitForSelector('text=Phone flyer saved');
  const size = async () => { const d = (await (await fetch(BASE + '/__dump')).json()).db.pub.eventflyers['padel-date-night'].phone; return admin.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; }), d); };
  assert.deepEqual(await size(), [1080, 1620], 'phones get the tall flyer');
  await admin.click('[data-slot="tall"] [data-remove="tall"]');
  await admin.waitForSelector('text=Phones show the wide flyer again');
  assert.deepEqual(await size(), [1200, 675], 'and the wide one again once the tall one is removed');
  await admin.click('#lookDone');
  step('tall flyer used on phones when there is one');

  // 4. the night: round 1 is announced over the flyer when the night starts, round 2 when round 1 is complete
  await admin.click('[data-open="padel-date-night"]');
  await admin.waitForSelector('text=Courts');
  for (const c of [6, 7]) await admin.click(`.chip[data-court="${c}"]`);
  for (const [x, y] of [['Ana', 'Luis'], ['Brooke', 'Tyler'], ['Carla', 'Mateo'], ['Dana', 'Chris']]) { await admin.fill('#p1', x); await admin.fill('#p2', y); await admin.click('#addTeam'); }
  await tv.waitForSelector('text=4 teams checked in', { timeout: 8000 });
  assert.ok(await tv.evaluate(() => document.getElementById('inter').hidden), 'nothing is announced while the night is being set up');
  await admin.click('#startNight');
  await tv.waitForSelector('#inter.on[data-round="1"]', { timeout: 8000 });
  assert.ok(await tv.evaluate(() => document.getElementById('inter').classList.contains('pic') && /^data:image/.test(document.getElementById('interpic').src)), 'the wide flyer is behind the announcement');
  assert.equal(await tv.textContent('#inter .num'), '1');
  await tv.waitForTimeout(1300);
  await tv.screenshot({ path: SHOTS + 'tv-round-1.png' });
  assert.equal((await tv.textContent('#inter .pun')).trim(), 'Let\u2019s get this padel started!');
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 9000 });
  assert.equal((await tv.textContent('.tvhead .round')).trim(), 'Round 1');
  const score = async (court, sa, sb) => { await admin.click(`.panel >> nth=0 >> .courtcard[data-court="${court}"]`); await admin.click(`.digits button[data-side="sa"][data-v="${sa}"]`); await admin.click(`.digits button[data-side="sb"][data-v="${sb}"]`); await admin.click('#saveScore'); };
  await score(7, 4, 2);
  await tv.waitForSelector('.tvcourt.done', { timeout: 6000 });
  await tv.waitForSelector('.crownfly');                               // the winner is being celebrated...
  const t1 = Date.now();
  await score(6, 1, 4);                                                // ...when the last score completes the round
  await tv.waitForSelector('#inter.on[data-round="2"]', { timeout: 12000 });
  assert.equal(await tv.locator('.crownfly').count(), 0, 'the announcement waits for the crown to land');
  const kinds = ['slam', 'spin', 'smash'];
  assert.ok(await tv.evaluate(k => document.getElementById('inter').classList.contains(k), kinds[2 % 3]), 'round 2 uses its own entrance');
  const tUp = Date.now();
  const pun = (await tv.textContent('#inter .pun')).trim();
  assert.ok(pun.length > 8, 'a padel pun comes with the round');
  await tv.waitForTimeout(1300);
  await tv.screenshot({ path: SHOTS + 'tv-round-2.png' });
  assert.equal(await tv.locator('#inter .buddy svg').count(), 1, 'the padel ball is part of the show');
  for (const [ms, name] of [[1500, 'b'], [900, 'c'], [700, 'd']]) { await tv.waitForTimeout(ms); await tv.screenshot({ path: SHOTS + 'tv-round-2' + name + '.png' }); }
  await tv.waitForFunction(() => document.getElementById('inter').hidden, null, { timeout: 8000 });
  const upFor = Date.now() - tUp;
  assert.ok(upFor > 5000 && upFor < 7500, 'the announcement stays about six seconds (' + upFor + ' ms)');
  assert.equal((await tv.textContent('.tvhead .round')).trim(), 'Round 2');
  step('TV announced round 1 at the start and round 2 ' + ((tUp - t1) / 1000).toFixed(1) + ' s after the last score, for ' + (upFor / 1000).toFixed(1) + ' s, over the flyer, with: ' + pun);

  // 5. opening the TV page mid-round announces nothing
  const tvLate = watch(await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage(), 'tvLate');
  await tvLate.goto(BASE + '/tv/?db=' + DB);
  await tvLate.waitForSelector('.tvcourt');
  await tvLate.waitForTimeout(600);
  assert.ok(await tvLate.evaluate(() => document.getElementById('inter').hidden), 'a TV opened in the middle of a round goes straight to the round');
  step('a TV opened mid-round shows the round straight away');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E LOOK OK');
})().catch(e => { console.error('E2E LOOK FAILED:', e.message); process.exit(1); });
