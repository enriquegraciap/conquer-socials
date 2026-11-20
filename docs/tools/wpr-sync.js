// WPR sync for the Conquer socials app. Input: rows.json = the "WPR requests" tab as a 2D array (first row = headers).
// Output (printed as JSON): names to append to the sheet, what was written, and what could not be matched.
// Set DRY_RUN=1 to change nothing.
const fs = require('fs');
const DB = 'https://conquer-socials-default-rtdb.firebaseio.com', KEY = process.env.SOCIALS_KEY || '';
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const keyOf = s => 'k_' + (clean(s).toLowerCase().replace(/[^a-z0-9À-￿]+/g, '_').replace(/^_+|_+$/g, '') || 'x');
const get = async p => { const r = await fetch(DB + '/' + p + '.json'); if (!r.ok) throw new Error(p + ' -> ' + r.status); return r.json(); };
const list = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2] || 'rows.json', 'utf8'));
  const head = (rows[0] || []).map(h => clean(h).toLowerCase()), col = n => head.indexOf(n);
  for (const need of ['name', 'wpr_s', 'status']) if (col(need) < 0) throw new Error('The sheet has no "' + need + '" column; nothing was changed.');
  const [series, results, sessions, ratings] = await Promise.all([get('pub/series'), get('pub/results'), get('pub/sessions'), get('pub/ratings')]);
  const players = {};                                              // key -> name as written in the app
  const add = n => { n = clean(n); if (n) players[keyOf(n)] = n; };
  Object.values(results || {}).forEach(months => Object.values(months || {}).forEach(nights => Object.values(nights || {}).forEach(doc => Object.values((doc && doc.entries) || {}).forEach(e => list(e.players).forEach(add)))));
  Object.values(sessions || {}).forEach(nights => Object.values(nights || {}).forEach(s => { if (s && !s.discarded) Object.values(s.teams || {}).forEach(t => list(t.players).forEach(add)); }));
  const inSheet = {}, done = {}, open = [];
  rows.slice(1).forEach(r => {
    const name = clean(r[col('name')]); if (!name) return;
    const k = keyOf(name), status = clean(r[col('status')]).toLowerCase();
    inSheet[k] = true;
    if (status === 'done') done[k] = { s: clean(r[col('wpr_s')]), c: col('wpr') >= 0 ? clean(r[col('wpr')]) : '', id: col('wpr_id') >= 0 ? clean(r[col('wpr_id')]) : '' };
    else if (status === 'ambiguous' || status === 'not found') open.push(name + ' (' + status + ')');
  });
  const num = t => { const v = Number(String(t).replace(',', '.')); return t !== '' && v >= 0 && v <= 21 ? Math.round(v * 100) / 100 : null; };
  const toAppend = Object.keys(players).filter(k => !inSheet[k] && players[k].split(' ').length >= 2).map(k => players[k]).sort();
  const noFullName = Object.keys(players).filter(k => players[k].split(' ').length < 2).map(k => players[k]).sort();
  const up = {}, written = [], doneNoSocial = [];
  Object.keys(done).forEach(k => {
    if (!players[k]) return;                                       // answered, but nobody by that exact name in the app
    const s = num(done[k].s), c = num(done[k].c), cur = (ratings || {})[k];
    if (s === null) { doneNoSocial.push(players[k]); return; }
    if (cur && cur.s === s && cur.by === 'wpr') return;            // already up to date
    const rec = { s: s, name: players[k], at: Date.now(), by: 'wpr' };
    if (c !== null) rec.c = c;
    if (done[k].id) rec.id = done[k].id;
    up['pub/ratings/' + k] = rec; written.push(players[k] + ' ' + s.toFixed(2));
  });
  let status = 'nothing to write';
  if (written.length && !process.env.DRY_RUN) {
    if (!KEY) throw new Error('SOCIALS_KEY is not set; nothing was written.');
    Object.keys(series || {}).forEach(id => { up['pub/live/' + id + '/ping'] = Date.now(); });     // TVs read the ratings again
    up['gate/' + KEY] = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const r = await fetch(DB + '/.json', { method: 'PATCH', body: JSON.stringify(up) });
    status = 'write ' + r.status;
    if (!r.ok) throw new Error('Firebase refused the write: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  } else if (written.length) status = 'dry run, not written';
  console.log(JSON.stringify({ playersInApp: Object.keys(players).length, toAppend, written, status, doneButNoSocialRating: doneNoSocial, notFoundOrAmbiguous: open, noFullNameInApp: noFullName }, null, 1));
})().catch(e => { console.error('WPR SYNC FAILED: ' + e.message); process.exit(1); });
