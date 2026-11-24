'use strict';
// Browser check of videos in the flyers slideshow (start tools/mock-server.js first):  node test/e2e-video.js
//   A video is added on the flyers page by its link (nothing is uploaded); the TV plays it once, muted, and moves on.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', CLIP = 'https://media.example/clips/open-play.webm';

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch(), errors = [];
  const step = m => console.log('  ' + m);
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 1300 } }), ctxT = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const admin = await ctxA.newPage(), tv = await ctxT.newPage();
  [admin, tv].forEach(p => p.on('pageerror', e => errors.push(String(e))));
  const db = async () => (await (await fetch(BASE + '/__dump')).json()).db.pub || {};

  // a made-up clip of about a second, recorded in the browser, served wherever its made-up address is asked for
  await admin.goto(BASE + '/flyers/?db=' + DB);
  await admin.waitForSelector('#vurl');
  const clip = Buffer.from(await admin.evaluate(() => new Promise(done => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0;
    const paint = () => { g.fillStyle = n++ % 2 ? '#d6294f' : '#12303f'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.fillRect(20 + n * 6, 70, 40, 40); };
    paint(); const tick = setInterval(paint, 80);
    const rec = new MediaRecorder(c.captureStream(12), { mimeType: 'video/webm' }), parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    rec.onstop = () => { clearInterval(tick); const r = new FileReader(); r.onload = () => done(r.result.split(',')[1]); r.readAsDataURL(new Blob(parts, { type: 'video/webm' })); };
    rec.start(); setTimeout(() => rec.stop(), 1300);
  })), 'base64');
  assert.ok(clip.length > 500, 'the test clip was recorded');
  for (const ctx of [ctxA, ctxT]) await ctx.route(CLIP, r => r.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Access-Control-Allow-Origin': '*' }, body: clip }));
  await ctxA.route('https://media.example/not-a-video', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>a page</p>' }));

  // 1. what is not a video is refused; a real one is added by its link (the key is asked for first)
  await admin.fill('#vurl', 'https://media.example/not-a-video'); await admin.click('#addVideo');
  await admin.fill('#keyInput', 'test-key'); await admin.click('#saveKey');
  await admin.waitForSelector('text=That link does not open as a video', { timeout: 30000 });
  assert.equal(Object.keys((await db()).flyers || {}).length, 0, 'nothing was saved for it');
  await admin.fill('#vurl', CLIP); await admin.fill('#vname', 'Open play clip'); await admin.click('#addVideo');
  await admin.waitForSelector('text=Video added', { timeout: 30000 });
  let idx = (await db()).flyers.club.index, vid = Object.keys(idx)[0];
  assert.deepEqual([idx[vid].name, idx[vid].video, idx[vid].vk], ['Open play clip', CLIP, 'file']);
  assert.ok(!(await db()).flyers.club.data, 'the video itself is not stored in the database');
  assert.equal(await admin.locator('.flycard .pic.vid .play').count(), 1, 'it is listed with a play mark');
  step('a video is added by its link; a link that is not a video is refused');

  // 2. YouTube links are understood (the single video, whatever shape the link has)
  await admin.fill('#vurl', 'https://youtu.be/dQw4w9WgXcQ?si=abc'); await admin.click('#addVideo');
  await admin.waitForFunction(() => document.querySelectorAll('.flycard').length === 2, null, { timeout: 15000 });
  idx = (await db()).flyers.club.index;
  const yt = Object.keys(idx).find(k => idx[k].vk === 'yt');
  assert.deepEqual([idx[yt].yt, idx[yt].video, idx[yt].thumb], ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg']);
  await admin.click('.flycard[data-flyer="' + yt + '"] button:text("Remove")'); await admin.click('#modalOk');
  await admin.waitForFunction(() => document.querySelectorAll('.flycard').length === 1);
  step('a YouTube link is understood, and a video is removed like a flyer');

  // 3. a photo after it, then the TV: the video plays first and to its end, then the photo follows
  const png = await admin.evaluate(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); g.fillStyle = '#f4b63f'; g.fillRect(0, 0, 1280, 720); return c.toDataURL('image/png').split(',')[1]; });
  await admin.setInputFiles('#pick', { name: 'flyer.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await admin.waitForSelector('text=1 flyer added', { timeout: 20000 });
  await tv.goto(BASE + '/tv/?db=' + DB + '&flyers=1');
  await tv.waitForSelector('.tvflyers .vbox.on video', { timeout: 20000 });
  assert.equal(await tv.evaluate(() => document.querySelector('.tvflyers .vbox video').muted), true, 'it plays without sound');
  await tv.waitForFunction(() => { const v = document.querySelector('.tvflyers .vbox video'); return !!v && v.currentTime > 0.2; }, null, { timeout: 15000 });
  await tv.waitForSelector('.tvflyers img.flyer.on', { timeout: 20000 });
  assert.equal(await tv.locator('.tvflyers .vbox.on').count(), 0, 'when it ends the next flyer takes over');
  assert.equal(await tv.locator('.tvflyers .vbox video').count(), 0, 'and the video is put away');
  step('the TV plays the video once, muted, then shows the next flyer');

  assert.deepEqual(errors, []);
  await browser.close();
  console.log('E2E VIDEO OK');
})().catch(e => { console.error('E2E VIDEO FAILED:', e.message); process.exit(1); });
