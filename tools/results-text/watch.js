// Make code module "Is a night over?": looks at both clubs' saved results and decides whether a card is due.
// A card is due once per night: as soon as the night was ended in the app, or, when nobody ended it, once no score
// has changed for 45 minutes. Only nights dated today count (or yesterday, until 3am).
// input: lehi_raw, tempe_raw (JSON of each club's results), state (JSON kept between runs), now_ms,
//        l_today, l_yday, l_hour, t_today, t_yday, t_hour (each club's own date and hour)
const QUIET_MIN = 45;
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const now = Math.round(Number(input.now_ms) / 60000) || Math.round(Date.now() / 60000);
const before = parse(input.state, {}), state = {}, due = [];
[['lehi', input.lehi_raw, input.l_today, input.l_yday, input.l_hour], ['tempe', input.tempe_raw, input.t_today, input.t_yday, input.t_hour]].forEach(c => {
  const club = c[0], res = parse(c[1], {}), today = String(c[2] || ''), yday = String(c[3] || ''), early = Number(c[4]) < 3, latest = {};
  Object.keys(res || {}).forEach(series => Object.keys(res[series] || {}).forEach(month => Object.keys(res[series][month] || {}).forEach(sid => {
    const d = res[series][month][sid];
    if (!d || !d.entries || !(Number(d.rounds) > 0)) return;
    if (!latest[series] || String(d.date) > String(latest[series].d.date) || (d.date === latest[series].d.date && sid > latest[series].sid)) latest[series] = { d: d, sid: sid };
  })));
  Object.keys(latest).sort().forEach(series => {
    const d = latest[series].d, date = String(d.date);
    if (!(date === today || (date === yday && early))) return;
    const rows = Object.keys(d.entries).sort().map(k => d.entries[k]).filter(e => e && !e.left && e.name);
    if (rows.length < 2) return;
    const key = club + '|' + series + '|' + date, was = before[key] || {};
    const print = hash(latest[series].sid + '|' + d.status + '|' + rows.map(e => e.name + ':' + (e.points || 0) + ':' + (e.played || 0)).join(','));
    const s = state[key] = { h: was.h || '', t: was.t || now, done: was.done || 0 };
    if (s.done) return;
    if (s.h !== print) { s.h = print; s.t = now; }
    if (d.status === 'ended') due.push({ key: key, club: club, series: series, why: 'ended in the app' });
    else if (now - s.t >= QUIET_MIN) due.push({ key: key, club: club, series: series, why: 'not ended in the app, no score for ' + (now - s.t) + ' minutes' });
  });
});
// one card per run: a second night that is due at the same moment waits for the next run
const fire = due[0] || null;
if (fire) state[fire.key].done = 1;
const out = JSON.stringify(state);
return { fire: fire ? '1' : '0', club: fire ? fire.club : '', series: fire ? fire.series : '', key: fire ? fire.key : '', why: fire ? fire.why : '',
  state: out, changed: out === JSON.stringify(before) ? '0' : '1', watching: String(Object.keys(state).length) };
