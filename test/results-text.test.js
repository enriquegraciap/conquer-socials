'use strict';
// The three code steps of the "results text" Make scenario, run here the way Make runs them (a body with `input`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const dir = __dirname + '/../tools/results-text/';
const body = f => fs.readFileSync(dir + f, 'utf8');
const run = (code, input) => new Function('input', code)(input);
const matchSrc = body('match.js').replace(/if \(typeof module[\s\S]*$/, '');

const results = { '2026-11': {
  '2026-11-01-carried-over': { date: '2026-11-01', rounds: 0, entries: { k_old: { name: 'Old Timer', players: ['Old Timer'], points: 40 } } },
  's1': { date: '2026-11-15', rounds: 5, status: 'ended', entries: { a: { name: 'Earlier Night', players: ['Earlier Night'], points: 9 }, b: { name: 'Someone Else', players: ['Someone Else'], points: 3 } } },
  's2': { date: '2026-11-22', rounds: 5, status: 'ended', entries: {
    a: { name: 'Ana López', players: ['Ana López'], points: 16, wins: 4 }, b: { name: 'Bruno Diaz', players: ['Bruno Diaz'], points: 14, wins: 3 },
    c: { name: 'Carla Ruiz', players: ['Carla Ruiz'], points: 13, wins: 3 }, d: { name: 'Zain', players: ['Zain'], points: 12, wins: 3 },
    e: { name: 'Gone Early', players: ['Gone Early'], points: 30, wins: 5, left: true }, f: { name: 'Dana Opted', players: ['Dana Opted'], points: 2, wins: 0 }, g: { name: 'Nick Nohl', players: ['Nick Nohl'], points: 1, wins: 0 } } } } };
const nightIn = { club: 'tempe', series: 'asu-college-padel-nights', name_raw: '"ASU College Padel Nights"', results_raw: JSON.stringify(results), today: '2026-11-22', yesterday: '2026-11-21', hour: '22' };

test('the night: latest night, its top three (removed players left out), the text and what to look up', () => {
  const n = run(body('night.js'), nightIn);
  assert.equal(n.ok, 'yes');
  assert.equal(n.text, 'Conquer Padel: thanks for playing ASU College Padel Nights tonight! Congrats to our top 3: 1. Ana López (16 pts), 2. Bruno Diaz (14), 3. Carla Ruiz (13). See the full results and the November leaderboard, and share yours: go.playcnqr.com/socials?c=tempe&v=board&s=asu-college-padel-nights');
  assert.deepEqual([n.key, n.night, n.players, n.nice_date], ['tempe|asu-college-padel-nights|2026-11-22', '2026-11-22', '6', 'Sunday, November 22']);
  assert.deepEqual(JSON.parse(n.names_json), ['Ana López', 'Bruno Diaz', 'Carla Ruiz', 'Zain', 'Dana Opted', 'Nick Nohl']);
  assert.equal(n.queries, 'Ana Lopez|Lopez|Bruno Diaz|Diaz|Carla Ruiz|Ruiz|Dana Opted|Opted|Nick Nohl|Nohl');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-23', yesterday: '2026-11-22', hour: '1' })).text, /Nights tonight!/, 'just after midnight it is still tonight');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-23', yesterday: '2026-11-22', hour: '9' })).text, /Nights last night!/);
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-25', yesterday: '2026-11-24', hour: '9' })).text, /Nights on Sunday!/);
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { club: 'lehi', series: 'tacotue' })).text, /share yours: go\.playcnqr\.com\/socials\?v=board&s=tacotue$/);
  assert.equal(run(body('night.js'), Object.assign({}, nightIn, { results_raw: 'null' })).ok, 'no');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { name_raw: 'null' })).reason, /^the social was not found /);
  assert.equal(run(body('night.js'), Object.assign({}, nightIn, { name_raw: 'ASU College Padel Nights', results_raw: results })).ok, 'yes', 'values already read as JSON (or a bare name) work too');
});

test('who is who, and the card: only HighLevel contacts that take texts; everyone else is listed with the reason', () => {
  const n = run(body('night.js'), nightIn);
  const pool = [
    { customers: [{ id: 'c1', first_name: 'Ana', last_name: 'Lopez', name: 'Ana Lopez', phone: '4805550001' }] },
    { customers: [{ id: 'c1', name: 'Ana Lopez', phone: '4805550001' }, { id: 'c9', name: 'Maria Lopez', phone: '4805550009' }] },
    { customers: [{ id: 'c2', name: 'Bruno Diaz', phone: '(480) 555-0002' }] }, { type: 'problem', status: 429 },
    { customers: [{ id: 'c3', name: 'Carla Maria Ruiz', phone: '966501234567' }] },
    { customers: [{ id: 'c4', name: 'Dana Opted', phone: '4805550004' }] }, { customers: [{ id: 'c5', name: 'Nick Nohl', phone: '4805550005' }] }
  ].map(x => JSON.stringify(x)).join('\n') + '\nnot json';
  const p = run(matchSrc + '\n' + body('pick.js'), { names_json: n.names_json, pool: pool, extra: 'Enrique (you)|480-555-0100' });
  assert.equal(p.phones, '+14805550001|+14805550002|+966501234567|+14805550004|+14805550005|+14805550100');
  assert.deepEqual(JSON.parse(p.skipped_json), [{ name: 'Zain', why: 'only one name' }]);
  const ghl = [
    '{"p":"+14805550001","r":{"contact":{"id":"g1","firstName":"Ana"}}}', '{"p":"+14805550002","r":{"contact":{"id":"g2"}}}', '{"p":"+966501234567","r":{"contact":{"id":"g3"}}}',
    '{"p":"+14805550004","r":{"contact":{"id":"g4","dnd":true}}}', '{"p":"+14805550005","r":{"contact":null}}', '{"p":"+14805550100","r":{"contact":{"id":"g0"}}}'].join('\n');
  const c = run(body('card.js'), { matched_json: p.matched_json, skipped_json: p.skipped_json, ghl: ghl, text: n.text, title: n.title, club: 'tempe', nice_date: n.nice_date, players: n.players, key: n.key, hook: 'https://hook.example/x', dry: '', from: '+14805550199' });
  assert.equal(c.ok, 'yes');
  assert.deepEqual(JSON.parse(c.recipients_json), [{ cid: 'g1', name: 'Ana López' }, { cid: 'g2', name: 'Bruno Diaz' }, { cid: 'g3', name: 'Carla Ruiz' }, { cid: 'g0', name: 'Enrique (you)' }]);
  assert.deepEqual([c.count, c.from, JSON.parse(c.msg_json)], ['4', '+14805550199', n.text]);
  const card = JSON.parse(c.card);
  assert.equal(card.text, ['RESULTS TEXT | ASU College Padel Nights (Tempe) | Sunday, November 22', 'Send goes to 3 of 6 players, plus Enrique (you). Nothing is sent until you press Send.', '', 'TEXT', n.text, '',
    'WILL RECEIVE (3)', 'Ana López, Bruno Diaz, Carla Ruiz', '', 'MATCHED BY A CLOSE NAME (1)', '"Carla Ruiz" = PlayByPoint "Carla Maria Ruiz"', '',
    'NOT SENT (3)', 'Zain: only one name', 'Dana Opted: opted out of texts in HighLevel', 'Nick Nohl: not a contact in HighLevel'].join('\n'));
  assert.ok(!/^#/.test(card.text) && !/—/.test(card.text), 'never looks like a lead card (those start with # and carry a long-dash line)');
  const [send, skip] = card.reply_markup.inline_keyboard[0];
  assert.equal(send.text, 'Send to 4');
  assert.match(send.url, /^https:\/\/hook\.example\/x\?id=tempe%7Casu-college-padel-nights%7C2026-11-22&t=[a-z0-9]{28}&do=send$/);
  const seeded = run(body('card.js'), { matched_json: p.matched_json, skipped_json: '[]', ghl: ghl, text: n.text, title: n.title, club: 'tempe', nice_date: n.nice_date, players: n.players, key: n.key, hook: 'https://hook.example/x', seed: '0b9c7f1e-52aa-4c1d-9e0f-3a6d8c2b7e41' });
  assert.equal(seeded.token, '0b9c7f1e52aa4c1d9e0f3a6d8c2b7e41', 'the token is the random id Make hands in');
  assert.equal(skip.url, send.url.replace(/send$/, 'skip'));
  assert.ok(send.url.includes('&t=' + c.token));
  // nobody to send to: a card with no buttons
  const none = run(body('card.js'), { matched_json: '[]', skipped_json: p.skipped_json, ghl: '', text: n.text, title: n.title, club: 'lehi', nice_date: n.nice_date, players: n.players, key: n.key, hook: 'https://hook.example/x' });
  assert.deepEqual([none.ok, none.count, JSON.parse(none.card).reply_markup, none.from], ['no', '0', undefined, '']);
});
