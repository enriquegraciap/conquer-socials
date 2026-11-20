'use strict';
// Browser check of "Speak the names" with a pretend microphone and a stand-in for the speech service
// (start tools/mock-server.js first):  node test/e2e-voice.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:8787', DB = BASE + '/db', SHOTS = __dirname + '/shots/';

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const step = m => console.log('  ' + m);
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, permissions: ['microphone'] });
  const admin = await ctx.newPage();
  admin.on('pageerror', e => errors.push(String(e)));
  const VOICE = encodeURIComponent(BASE + '/__voice');

  // no voice service configured: no button
  await admin.goto(BASE + '/?db=' + DB + '#k=test-key');
  await admin.fill('#newSeries', 'Padel Date Night'); await admin.click('text=Create'); await admin.waitForSelector('text=Courts');
  assert.equal(await admin.locator('#speakNames').count(), 0, 'without a voice service there is no button');

  // 1. fixed partners: record, review, correct, add
  await admin.goto(BASE + '/?db=' + DB + '&voice=' + VOICE);
  await admin.waitForSelector('#speakNames');
  await admin.fill('#p1', 'Carter Maclean'); await admin.fill('#p2', 'Kasey Maclean'); await admin.click('#addTeam');   // already there before speaking
  await admin.click('#speakNames');
  await admin.waitForSelector('text=Speak the names');
  await admin.screenshot({ path: SHOTS + 'voice-start.png' });
  await admin.click('#voiceStart');
  await admin.waitForSelector('#voiceClock');
  await admin.waitForTimeout(2300);
  assert.match(await admin.textContent('#voiceClock'), /^0:0[2-3]$/, 'a clock runs while recording');
  await admin.screenshot({ path: SHOTS + 'voice-recording.png' });
  await admin.click('#voiceStop');
  await admin.waitForSelector('text=Check the names', { timeout: 15000 });
  const seen = await (await fetch(BASE + '/__voice')).json();
  assert.deepEqual([seen.key, seen.format, seen.wav, seen.type], ['test-key', 'team', 'RIFF', 'application/x-www-form-urlencoded'], 'the service gets the admin key, the format and a WAV file');
  assert.ok(seen.audioChars > 40000 && seen.audioChars < 400000, 'about two seconds of 16 kHz sound (' + seen.audioChars + ' characters)');
  assert.ok(/Carter Maclean/.test(seen.known), 'and the names the club already knows, to help with spelling');
  assert.equal(await admin.locator('.voicerow').count(), 3);
  assert.equal(await admin.locator('.voicerow.dup').count(), 1, 'the couple already entered is marked');
  await admin.fill('#vn2p2', 'Tessa Dunn');                           // correct a spelling
  await admin.screenshot({ path: SHOTS + 'voice-review.png' });
  await admin.click('#voiceAdd');
  await admin.waitForSelector('text=2 teams added. Already on the list: Carter Maclean & Kasey Maclean.');
  assert.deepEqual((await admin.locator('.teamlist .nmbtn').allTextContents()).sort(), ['Carter Maclean & Kasey Maclean', 'Jodi Ream & Tessa Dunn', 'Lexi Mecham & Spencer Mecham']);
  step('fixed partners: recorded, three couples came back, one corrected, one already there, two added');

  // 2. the service fails or is not set up: a clear message, nothing added
  await admin.goto(BASE + '/?db=' + DB + '&voice=' + encodeURIComponent(BASE + '/__voice?fail=1'));
  await admin.waitForSelector('#speakNames');
  await admin.click('#speakNames'); await admin.click('#voiceStart'); await admin.waitForSelector('#voiceClock'); await admin.waitForTimeout(1200); await admin.click('#voiceStop');
  await admin.waitForSelector('text=the Gemini key is missing or was not accepted', { timeout: 15000 });
  await admin.click('text=Close');
  assert.equal(await admin.locator('.teamlist .nmbtn').count(), 3);
  step('service not set up: says so, adds nothing');

  // 3. individual format: one name per line
  await admin.goto(BASE + '/?db=' + DB + '&voice=' + VOICE);
  await admin.waitForSelector('.topbar .linkbtn:text("Events")'); await admin.click('.topbar .linkbtn:text("Events")');
  await admin.fill('#newSeries', 'Tapas Fridays'); await admin.click('.fmtpick [data-format="kings-individual"]'); await admin.click('text=Create');
  await admin.waitForSelector('text=Courts');
  await admin.click('#speakNames'); await admin.click('#voiceStart'); await admin.waitForSelector('#voiceClock'); await admin.waitForTimeout(1200); await admin.click('#voiceStop');
  await admin.waitForSelector('text=Check the names', { timeout: 15000 });
  assert.equal((await (await fetch(BASE + '/__voice')).json()).format, 'solo');
  assert.equal(await admin.locator('.voicerow.solo').count(), 3);
  await admin.click('.voicerow >> nth=1 >> text=×');             // drop one
  await admin.click('#voiceAdd');
  await admin.waitForSelector('text=2 players added.');
  assert.deepEqual(await admin.locator('.teamlist .nmbtn').allTextContents(), ['Ana Lopez', 'Zoe Hart']);
  step('individual format: three names came back, one removed, two players added');

  assert.deepEqual(errors, [], 'no script errors');
  await browser.close();
  console.log('E2E VOICE OK');
})().catch(e => { console.error('E2E VOICE FAILED:', e.message); process.exit(1); });
