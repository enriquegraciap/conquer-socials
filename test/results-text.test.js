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
  assert.equal(n.queries, 'Ana Lopez|Lopez|Ana|Bruno Diaz|Diaz|Bruno|Carla Ruiz|Ruiz|Carla|Dana Opted|Opted|Dana|Nick Nohl|Nohl|Nick');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-23', yesterday: '2026-11-22', hour: '1' })).text, /Nights tonight!/, 'just after midnight it is still tonight');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-23', yesterday: '2026-11-22', hour: '9' })).text, /Nights last night!/);
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { today: '2026-11-25', yesterday: '2026-11-24', hour: '9' })).text, /Nights on Sunday!/);
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { club: 'lehi', series: 'tacotue' })).text, /share yours: go\.playcnqr\.com\/socials\?v=board&s=tacotue$/);
  assert.equal(run(body('night.js'), Object.assign({}, nightIn, { results_raw: 'null' })).ok, 'no');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { name_raw: 'null' })).reason, /^the social was not found /);
  assert.equal(run(body('night.js'), Object.assign({}, nightIn, { name_raw: 'ASU College Padel Nights', results_raw: results })).ok, 'yes', 'values already read as JSON (or a bare name) work too');
});

test('who is who, and the card: the HighLevel contact is found by phone, email or name; everyone else is listed with the reason', () => {
  const n = run(body('night.js'), nightIn);
  const pool = [
    { customers: [{ id: 'c1', first_name: 'Ana', last_name: 'Lopez', name: 'Ana Lopez', phone: '4805550001', email: 'Ana@X.com' }] },
    { customers: [{ id: 'c1', name: 'Ana Lopez', phone: '4805550001' }, { id: 'c9', name: 'Maria Lopez', phone: '4805550009' }] },
    { customers: [{ id: 'c2', name: 'Bruno Diaz', phone: '0766 088 881', email: 'bruno@x.edu' }] }, { type: 'problem', status: 429 },
    { customers: [{ id: 'c3', name: 'Carla Maria Ruiz', phone: '966501234567' }] },
    { customers: [{ id: 'c4', name: 'Dana Opted', phone: '4805550004' }] }, { customers: [{ id: 'c5', name: 'Nick Nohl', phone: '', email: 'nick@x.com' }] }
  ].map(x => JSON.stringify(x)).join('\n') + '\nnot json';
  const p = run(matchSrc + '\n' + body('pick.js'), { names_json: n.names_json, pool: pool, extra: 'Enrique (you)|480-555-0100' });
  assert.equal(p.lookups, '1~+14805550001~ana@x.com~Lopez|2~+10766088881~bruno@x.edu~Diaz|3~+966501234567~none~Ruiz|4~+14805550004~none~Opted|5~~nick@x.com~Nohl|6~+14805550100~none~(you)');
  assert.deepEqual(JSON.parse(p.skipped_json), [{ name: 'Zain', why: 'only one name' }]);
  const none = { contacts: [] }, ghl = [
    { i: '1', a: { contact: { id: 'g1', firstName: 'Ana', phone: '+14805550001' } }, b: none, c: none },
    // the phone on file does not find him (another country code), the search by email does
    { i: '2', a: { contact: null }, b: { contacts: [{ id: 'g2', firstNameLowerCase: 'bruno', lastNameLowerCase: 'diaz', phone: '+40766088881', email: 'other@x.edu' }] }, c: none },
    // nothing by phone or email, one contact with her name
    { i: '3', a: { message: 'not found' }, b: none, c: { contacts: [{ id: 'g3', firstNameLowerCase: 'carla', lastNameLowerCase: 'ruiz', phone: '+14805559999' }, { id: 'gx', firstNameLowerCase: 'carlos', lastNameLowerCase: 'ruiz', phone: '+14805558888' }] } },
    { i: '4', a: { contact: { id: 'g4', phone: '+14805550004', dndSettings: { sms: { status: 'permanent', message: 'STOP_KEYWORD' } } } }, b: none, c: none },
    { i: '5', a: null, b: none, c: { contacts: [{ id: 'g7', firstNameLowerCase: 'nicole', lastNameLowerCase: 'nohl', phone: '+14805557777' }] } },
    { i: '6', a: { contact: { id: 'g0', phone: '+14805550100' } }, b: none, c: none }].map(x => JSON.stringify(x)).join('\n');
  const c = run(matchSrc + '\n' + body('card.js'), { matched_json: p.matched_json, skipped_json: p.skipped_json, ghl: ghl, text: n.text, title: n.title, club: 'tempe', nice_date: n.nice_date, players: n.players, key: n.key, dry: '', from: '+14805550199' });
  assert.equal(c.ok, 'yes');
  assert.deepEqual(JSON.parse(c.recipients_json), [{ cid: 'g1', name: 'Ana López' }, { cid: 'g2', name: 'Bruno Diaz' }, { cid: 'g3', name: 'Carla Ruiz' }, { cid: 'g0', name: 'Enrique (you)' }]);
  assert.deepEqual([c.count, c.from, JSON.parse(c.msg_json)], ['4', '+14805550199', n.text]);
  const card = JSON.parse(c.card);
  assert.equal(card.text, ['RESULTS TEXT | ASU College Padel Nights (Tempe) | Sunday, November 22', 'Send goes to 3 of 6 players, plus Enrique (you). Nothing is sent until you press Send.', '', 'TEXT', n.text, '',
    'WILL RECEIVE (3)', 'Ana López, Bruno Diaz, Carla Ruiz', '', 'MATCHED BY A SIMILAR NAME, PLEASE CHECK (1)', '"Carla Ruiz" = PlayByPoint "Carla Maria Ruiz", HighLevel "carla ruiz" (found by name)', '',
    'NOT SENT (3)', 'Zain: only one name', 'Dana Opted: opted out of texts in HighLevel', 'Nick Nohl: not a contact in HighLevel'].join('\n'));
  assert.ok(!/^#/.test(card.text) && !/—/.test(card.text), 'never looks like a lead card (those start with # and carry a long-dash line)');
  const [send, skip] = card.reply_markup.inline_keyboard[0];
  assert.equal(send.text, '\u2705 Send to 4'); assert.equal(skip.text, '\u274c Skip');
  assert.match(send.callback_data, /^rt\|s\|[a-z0-9]{28}$/, 'a one-tap button: its data starts with rt| and carries the card\'s token');
  assert.equal(skip.callback_data, 'rt|k|' + c.token);
  assert.ok(send.callback_data.length <= 64 && !send.url, 'within Telegram\'s limit for a button, and no link to open');
  const seeded = run(matchSrc + '\n' + body('card.js'), { matched_json: p.matched_json, skipped_json: '[]', ghl: ghl, text: n.text, title: n.title, club: 'tempe', nice_date: n.nice_date, players: n.players, key: n.key, seed: '0b9c7f1e-52aa-4c1d-9e0f-3a6d8c2b7e41' });
  assert.equal(JSON.parse(seeded.card).reply_markup.inline_keyboard[0][0].callback_data.length, 37);
  assert.equal(seeded.token, '0b9c7f1e52aa4c1d9e0f3a6d8c2b7e41', 'the token is the random id Make hands in');
  // nobody to send to: a card with no buttons
  const empty = run(matchSrc + '\n' + body('card.js'), { matched_json: '[]', skipped_json: p.skipped_json, ghl: '', text: n.text, title: n.title, club: 'lehi', nice_date: n.nice_date, players: n.players, key: n.key });
  assert.deepEqual([empty.ok, empty.count, JSON.parse(empty.card).reply_markup, empty.from], ['no', '0', undefined, '']);
});

test('a test card texts only the extra person and is kept apart from the real card', () => {
  const n = run(body('night.js'), Object.assign({}, nightIn, { test: "1" }));
  assert.ok(/\|test$/.test(n.key));
  const matched = [{ i: '1', name: 'Ana Lopez', phone: '+14805550101', digits: '14805550101', email: '', cname: 'Ana Lopez', close: '' },
    { i: '2', name: 'Owner', phone: '+14805550100', digits: '14805550100', email: '', cname: '', close: '', extra: true }];
  const ghl = [{ i: '1', a: { contact: { id: 'c1', phone: '+14805550101' } }, b: null, c: null }, { i: '2', a: { contact: { id: 'c2', phone: '+14805550100' } }, b: null, c: null }].map(x => JSON.stringify(x)).join('\n');
  const c = run(matchSrc + '\n' + body('card.js'), { matched_json: JSON.stringify(matched), skipped_json: '[]', ghl: ghl, text: n.text, title: n.title, club: 'tempe', nice_date: n.nice_date, players: n.players, key: n.key, test: '1', seed: 'abcdefabcdefabcdefabcdefabcdef12' });
  assert.deepStrictEqual(JSON.parse(c.recipients_json).map(r => r.cid), ['c2']);
  assert.ok(/^TEST CARD \| RESULTS TEXT/.test(c.card_text));
  assert.ok(!/Ana Lopez/.test(c.card_text.split('WILL RECEIVE')[1]));
});

test('the watcher: a card is due once, when the night is ended or has gone quiet for 45 minutes', () => {
  const night = (status, pts) => ({ soc: { '2026-11': { s1: { date: '2026-11-22', rounds: 3, status: status, entries: { a: { name: 'Ana Lopez', points: pts, played: 3 }, b: { name: 'Bruno Diaz', points: 2, played: 3 }, c: { name: 'Gone', points: 9, left: true } } } } } });
  const at = (min, lehi, tempe, state, hour) => run(body('watch.js'), { lehi_raw: JSON.stringify(lehi || null), tempe_raw: JSON.stringify(tempe || null), state: state || '', now_ms: String(min * 60000),
    l_today: '2026-11-22', l_yday: '2026-11-21', l_hour: hour || '21', t_today: '2026-11-22', t_yday: '2026-11-21', t_hour: hour || '21' });
  let w = at(1000, night('live', 5));
  assert.deepEqual([w.fire, w.changed, w.watching], ['0', '1', '1'], 'a live night is only watched');
  let w2 = at(1015, night('live', 5), null, w.state);
  assert.deepEqual([w2.fire, w2.changed], ['0', '0'], 'nothing new: nothing to save');
  w2 = at(1030, night('live', 8), null, w.state);
  assert.equal(w2.fire, '0'); assert.equal(w2.changed, '1', 'a new score restarts the wait');
  let w3 = at(1074, night('live', 8), null, w2.state);
  assert.equal(w3.fire, '0', '44 minutes is not yet quiet');
  w3 = at(1075, night('live', 8), null, w2.state);
  assert.deepEqual([w3.fire, w3.club, w3.series, w3.key], ['1', 'lehi', 'soc', 'lehi|soc|2026-11-22']);
  assert.match(w3.why, /no score for 45 minutes/);
  assert.equal(at(1090, night('ended', 8), null, w3.state).fire, '0', 'only one card per night');
  const e = at(1000, null, night('ended', 5));
  assert.deepEqual([e.fire, e.club, e.why], ['1', 'tempe', 'ended in the app'], 'ended in the app: at once');
  const both = at(1000, night('ended', 5), night('ended', 5));
  assert.equal(both.club, 'lehi'); assert.equal(at(1015, night('ended', 5), night('ended', 5), both.state).club, 'tempe', 'the second one goes on the next run');
  assert.equal(run(body('watch.js'), { lehi_raw: JSON.stringify(night('ended', 5)), tempe_raw: 'null', state: '', now_ms: '60000000', l_today: '2026-11-23', l_yday: '2026-11-22', l_hour: '1', t_today: '2026-11-23', t_yday: '2026-11-22', t_hour: '1' }).fire, '1', 'just after midnight still counts');
  assert.equal(run(body('watch.js'), { lehi_raw: JSON.stringify(night('ended', 5)), tempe_raw: 'null', state: '', now_ms: '60000000', l_today: '2026-11-23', l_yday: '2026-11-22', l_hour: '9', t_today: '2026-11-23', t_yday: '2026-11-22', t_hour: '9' }).fire, '0', 'the next morning it is too late');
  assert.equal(at(1000, { soc: { '2026-11': { s1: { date: '2026-11-22', rounds: 0, status: 'ended', entries: { a: { name: 'A B' }, b: { name: 'C D' } } } } } }).watching, '0', 'a night with no round played is ignored');
});
