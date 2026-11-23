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

test('the watcher: a card is due once, when the night is ended or has gone quiet for 30 minutes', () => {
  const night = (status, pts) => ({ soc: { '2026-11': { s1: { date: '2026-11-22', rounds: 3, status: status, entries: { a: { name: 'Ana Lopez', points: pts, played: 3 }, b: { name: 'Bruno Diaz', points: 2, played: 3 }, c: { name: 'Gone', points: 9, left: true } } } } } });
  const at = (min, lehi, tempe, state, hour) => run(body('watch.js'), { lehi_raw: JSON.stringify(lehi || null), tempe_raw: JSON.stringify(tempe || null), state: state || '', now_ms: String(min * 60000),
    l_today: '2026-11-22', l_yday: '2026-11-21', l_hour: hour || '21', t_today: '2026-11-22', t_yday: '2026-11-21', t_hour: hour || '21' });
  let w = at(1000, night('live', 5));
  assert.deepEqual([w.fire, w.changed, w.watching], ['0', '1', '1'], 'a live night is only watched');
  let w2 = at(1015, night('live', 5), null, w.state);
  assert.deepEqual([w2.fire, w2.changed], ['0', '0'], 'nothing new: nothing to save');
  w2 = at(1030, night('live', 8), null, w.state);
  assert.equal(w2.fire, '0'); assert.equal(w2.changed, '1', 'a new score restarts the wait');
  let w3 = at(1045, night('live', 8), null, w2.state);
  assert.equal(w3.fire, '0', '15 minutes is not yet quiet');
  w3 = at(1060, night('live', 8), null, w2.state);
  assert.deepEqual([w3.fire, w3.club, w3.series, w3.key], ['1', 'lehi', 'soc', 'lehi|soc|2026-11-22']);
  assert.match(w3.why, /no score for 30 minutes/);
  assert.equal(at(1075, night('ended', 8), null, w3.state).fire, '0', 'only one card per night');
  const e = at(1000, null, night('ended', 5));
  assert.deepEqual([e.fire, e.club, e.why], ['1', 'tempe', 'ended in the app'], 'ended in the app: at once');
  const both = at(1000, night('ended', 5), night('ended', 5));
  assert.equal(both.club, 'lehi'); assert.equal(at(1015, night('ended', 5), night('ended', 5), both.state).club, 'tempe', 'the second one goes on the next run');
  assert.equal(run(body('watch.js'), { lehi_raw: JSON.stringify(night('ended', 5)), tempe_raw: 'null', state: '', now_ms: '60000000', l_today: '2026-11-23', l_yday: '2026-11-22', l_hour: '1', t_today: '2026-11-23', t_yday: '2026-11-22', t_hour: '1' }).fire, '1', 'just after midnight still counts');
  assert.equal(run(body('watch.js'), { lehi_raw: JSON.stringify(night('ended', 5)), tempe_raw: 'null', state: '', now_ms: '60000000', l_today: '2026-11-23', l_yday: '2026-11-22', l_hour: '9', t_today: '2026-11-23', t_yday: '2026-11-22', t_hour: '9' }).fire, '0', 'the next morning it is too late');
  assert.equal(at(1000, { soc: { '2026-11': { s1: { date: '2026-11-22', rounds: 0, status: 'ended', entries: { a: { name: 'A B' }, b: { name: 'C D' } } } } } }).watching, '0', 'a night with no round played is ignored');
});

test('the text says today for a daytime social and tonight for an evening one', () => {
  const withStart = start => { const r = JSON.parse(JSON.stringify(results)); r['2026-11'].s2.start = start; return Object.assign({}, nightIn, { results_raw: JSON.stringify(r) }); };
  assert.match(run(body('night.js'), withStart('06:31')).text, /Nights today!/);
  assert.match(run(body('night.js'), withStart('18:00')).text, /Nights today!/);
  assert.match(run(body('night.js'), withStart('18:01')).text, /Nights tonight!/);
  assert.match(run(body('night.js'), withStart('05:29')).text, /Nights tonight!/);
  assert.match(run(body('night.js'), Object.assign(withStart('09:00'), { today: '2026-11-23', yesterday: '2026-11-22', hour: '9' })).text, /Nights yesterday!/);
  assert.match(run(body('night.js'), Object.assign(withStart('09:00'), { today: '2026-11-25', yesterday: '2026-11-24', hour: '9' })).text, /Nights on Sunday!/);
});

test('the day\'s PlayByPoint roster: which program, which session, who was signed up, and the looser match within it', () => {
  const promo = { lehi: { items: [
    { program: 'kc-monday', name: 'King%27s%20Court%20Monday%20Open%20Play', date: '2026-11-23', start: '06:30', end: '08:30' },
    { program: 'evening-open', name: 'Evening%20Open%20Play', date: '2026-11-23', start: '19:00', end: '21:00' },
    { program: 'kc-monday', name: 'King%27s%20Court%20Monday%20Open%20Play', date: '2026-11-30', start: '06:30', end: '08:30' }] } };
  const which = o => run(body('which.js'), Object.assign({ pbp_raw: 'null', promo_raw: JSON.stringify(promo), date: '2026-11-23', start: '06:17', title: 'KC AM Open Play' }, o));
  assert.equal(which({}).program, 'kc-monday', 'the session that was on when the social started (it may start a little early)');
  assert.equal(which({ start: '19:05' }).program, 'evening-open');
  assert.equal(which({ start: '13:00' }).program, '', 'nothing on at that time');
  assert.equal(which({ start: '', title: 'Evening open' }).program, 'evening-open', 'no start time: by the name');
  assert.equal(which({ start: '', title: 'Something else' }).program, '');
  assert.equal(which({ pbp_raw: '"my-program"', start: '13:00' }).program, 'my-program', 'the social\'s own setting wins');
  assert.equal(which({ date: '2026-11-24' }).program, '');

  const sessions = { sessions: [{ id: 'S1', date: '2026-11-23', start_time: '06:30' }, { id: 'S2', date: '2026-11-30', start_time: '06:30' }] };
  const enr = { enrollments: [{ customer_id: 'c1', session_ids: ['S1'] }, { customer_id: 'c1', session_ids: ['S2'] }, { customer_id: 'c2', session_ids: ['S1'] }, { customer_id: 'c3', session_ids: ['S2'] }, { customer_id: 'guest', session_ids: ['S1'] }], next_cursor: null };
  const ros = o => run(body('roster.js'), Object.assign({ program: 'kc-monday', why: '', sess_a: JSON.stringify(sessions), sess_b: sessions, e1: enr, e2: { status: 422 }, e3: '', e4: null, date: '2026-11-23', start: '06:17', queries: 'Ana Lopez|Lopez|Ana' }, o));
  let r = ros({});
  assert.deepEqual([r.roster, r.paths, r.count], ['yes', 'customers/c1|customers/c2|customers/guest', '3']);
  assert.match(r.note, /roster of the 06:30 session that day \(3 signed up\)/);
  r = ros({ program: '' });
  assert.equal(r.roster, 'no'); assert.equal(r.paths, 'customers?q=Ana%20Lopez&limit=100|customers?q=Lopez&limit=100|customers?q=Ana&limit=100');
  assert.match(r.note, /looked up among all/);
  assert.equal(ros({ date: '2026-11-25' }).roster, 'no', 'no session that day: the old search');
  assert.equal(ros({ queries: '' }).roster, 'yes');
  assert.equal(ros({ program: '', queries: '' }).paths, 'customers?q=zzzz-nobody&limit=1', 'never an empty list');

  // the roster as the pool: exact, a spelling variant, a unique first name; the phone-less guest account is never guessed
  const pool = [{ customer: { id: 'c1', name: 'Jon Michael Ossola', phone: '4805550101', email: 'j@x.com' } }, { customer: { id: 'c2', name: 'J. Rod Rojas', phone: '(480) 555-0102' } },
    { customer: { id: 'c4', name: 'Alexander Stone', phone: '4805550104' } }, { customer: { id: 'guest', name: 'Conquer Padel Lehi Guest', phone: null } }].map(x => JSON.stringify(x)).join('\n');
  const pick = roster => run(matchSrc + '\n' + body('pick.js'), { names_json: JSON.stringify(['Jon Michael Osola', 'J. Rod Rojas', 'Alex', 'Rodrigo Stone', "John's Friend"]), pool: pool, extra: '', roster: roster });
  const p = pick('yes'), m = JSON.parse(p.matched_json), sk = JSON.parse(p.skipped_json);
  assert.deepEqual(m.map(x => x.name + '=' + x.cname), ['Jon Michael Osola=Jon Michael Ossola', 'J. Rod Rojas=J. Rod Rojas', 'Rodrigo Stone=Alexander Stone']);
  assert.deepEqual(sk.map(x => x.name + ': ' + x.why), ['Alex: not on the PlayByPoint roster of this session', "John's Friend: not on the PlayByPoint roster of this session"]);
  assert.equal(JSON.parse(pick('no').matched_json).length, 2, 'outside a roster the loose match is not used');
});

test('the text uses the social\'s public name when it has one', () => {
  const t = run(body('night.js'), Object.assign({}, nightIn, { share_raw: JSON.stringify({ over: "King's Court", title: 'AM Open Play', name: "King's Court AM Open Play" }) }));
  assert.match(t.text, /thanks for playing King's Court AM Open Play tonight!/);
  assert.equal(t.public_name, "King's Court AM Open Play"); assert.equal(t.title, 'ASU College Padel Nights', 'the card keeps the short name');
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { share_raw: 'null' })).text, /thanks for playing ASU College Padel Nights tonight!/);
});

test('a player who is in PlayByPoint but not in HighLevel is added there, then texted', () => {
  const matched = [{ i: '1', name: 'Ana Lopez', phone: '+14805550101', digits: '14805550101', email: 'ana@x.com', cname: 'Ana Lopez', cfirst: 'Ana', clast: 'Lopez', close: '' },
    { i: '2', name: 'Merlin Stone', phone: '+14805550102', digits: '14805550102', email: 'm@x.com', cname: 'Merlin Stone', cfirst: 'Merlin', clast: 'Stone', close: '' },
    { i: '3', name: 'No Phone', phone: '', digits: '', email: '', cname: 'No Phone', close: '' }];
  const ghl = [{ i: '1', a: { contact: { id: 'c1', phone: '+14805550101' } }, b: null, c: null }, { i: '2', a: {}, b: { contacts: [] }, c: { contacts: [] } }, { i: '3', a: {}, b: null, c: null }].map(x => JSON.stringify(x)).join('\n');
  const base = { matched_json: JSON.stringify(matched), skipped_json: '[]', ghl: ghl, text: 'T', title: 'King\'s Court AM Open Play', club: 'lehi', nice_date: 'Monday, November 23', players: '3', key: 'k', location: 'LOC', seed: 'abcdefabcdefabcdefabcdefabcdef12' };
  const plan = JSON.parse(run(matchSrc + '\n' + body('card.js'), Object.assign({ plan: '1' }, base)).creates);
  assert.equal(plan.length, 2, 'one contact to add, and the harmless search that is always there');
  assert.deepEqual([plan[0].i, plan[0].u], ['2', 'https://services.leadconnectorhq.com/contacts/']);
  assert.deepEqual(JSON.parse(plan[0].b), { locationId: 'LOC', firstName: 'Merlin', lastName: 'Stone', phone: '+14805550102', tags: ['club-lehi', 'lehi-social-player'], source: 'Socials app: played King\'s Court AM Open Play', email: 'm@x.com' });
  assert.match(plan[1].u, /contacts\/search$/);
  assert.equal(JSON.parse(run(matchSrc + '\n' + body('card.js'), Object.assign({ plan: '1', dry: '1' }, base)).creates).length, 1, 'nobody is added on a dry run');
  assert.equal(JSON.parse(run(matchSrc + '\n' + body('card.js'), Object.assign({ plan: '1', test: '1' }, base)).creates).length, 1, 'nor for a test card');
  const created = [{ i: '2', r: { contact: { id: 'new1' } } }, { i: '0', r: { contacts: [] } }].map(x => JSON.stringify(x)).join('\n');
  const c = run(matchSrc + '\n' + body('card.js'), Object.assign({ created: created }, base));
  assert.deepEqual(JSON.parse(c.recipients_json).map(r => r.cid), ['c1', 'new1']);
  assert.match(c.card_text, /ADDED TO HIGHLEVEL AS NEW CONTACTS \(1\)\nMerlin Stone/);
  assert.match(c.card_text, /No Phone: not a contact in HighLevel/);
  const dup = run(matchSrc + '\n' + body('card.js'), Object.assign({ created: JSON.stringify({ i: '2', r: { statusCode: 400, message: 'This location does not allow duplicated contacts.', meta: { contactId: 'old9' } } }) }, base));
  assert.deepEqual(JSON.parse(dup.recipients_json).map(r => r.cid), ['c1', 'old9'], 'HighLevel already had this person under other details: that contact is used');
  const bad = run(matchSrc + '\n' + body('card.js'), Object.assign({ created: JSON.stringify({ i: '2', r: { statusCode: 422, message: 'phone is invalid' } }) }, base));
  assert.match(bad.card_text, /Merlin Stone: could not be added to HighLevel \(phone is invalid\)/);
});

test('the top three in the text are numbered 1, 2, 3, also when two are level on points', () => {
  const r = JSON.parse(JSON.stringify(results)); r['2026-11'].s2.entries.c.points = 14; r['2026-11'].s2.entries.c.wins = 2;
  assert.match(run(body('night.js'), Object.assign({}, nightIn, { results_raw: JSON.stringify(r) })).text, /1\. Ana López \(16 pts\), 2\. Bruno Diaz \(14\), 3\. Carla Ruiz \(14\)\./);
});
