// Make code module "The night": picks the latest night of a social from its saved results and writes the text.
// input: club, series, name_raw (JSON of the social's name), results_raw (JSON of its results), today (YYYY-MM-DD in the
// club's time zone), yesterday, hour (0-23 there), test ("1" = a test card, kept apart from the night's real card)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const club = String(input.club || 'lehi').toLowerCase() === 'tempe' ? 'tempe' : 'lehi', series = String(input.series || '').trim();
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
const rawName = String(input.name_raw === undefined || input.name_raw === null ? '' : input.name_raw).trim();
const title = String(parse(input.name_raw, '') || (/^[\[{"]/.test(rawName) || rawName === 'null' ? '' : rawName)).trim(), res = parse(input.results_raw, {});
let best = null;
Object.keys(res || {}).forEach(m => Object.keys(res[m] || {}).forEach(sid => {
  const d = res[m][sid];
  if (!d || !d.entries || !(Number(d.rounds) > 0)) return;
  if (!best || String(d.date) > String(best.d.date) || (d.date === best.d.date && sid > best.sid)) best = { d: d, sid: sid, m: m };
}));
const none = why => ({ ok: 'no', reason: why + ' (' + typeof input.name_raw + ', ' + typeof input.results_raw + ', ' + String(input.results_raw === undefined ? '' : input.results_raw).length + ')', queries: '', names_json: '[]', text: '', key: '', night: '', title: title, players: '0', nice_date: '' });
if (!series || !title) return none('the social was not found');
if (!best) return none('no night with results yet');
const rows = Object.keys(best.d.entries).map(k => best.d.entries[k]).filter(e => e && !e.left && e.name)
  .sort((x, y) => (y.points || 0) - (x.points || 0) || (y.wins || 0) - (x.wins || 0) || (y.diff || 0) - (x.diff || 0) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
rows.forEach((r, i) => { r.rank = i > 0 && (rows[i - 1].points || 0) === (r.points || 0) ? rows[i - 1].rank : i + 1; });
if (rows.length < 2) return none('fewer than two players on the night');
const date = String(best.d.date), dt = new Date(date + 'T12:00:00Z');
// a social that started between 5:30am and 6pm is "today"; a later one is "tonight" (the app saves the start time)
const st = /^(\d{1,2}):(\d{2})/.exec(best.d.start || ''), mins = st ? Number(st[1]) * 60 + Number(st[2]) : -1, daytime = st ? mins >= 330 && mins <= 1080 : best.d.format === 'wheel';
const when = daytime ? (date === input.today ? 'today' : date === input.yesterday ? 'yesterday' : 'on ' + DAYS[dt.getUTCDay()])
  : date === input.today || (date === input.yesterday && Number(input.hour) < 4) ? 'tonight' : date === input.yesterday ? 'last night' : 'on ' + DAYS[dt.getUTCDay()];
const top = rows.slice(0, 3).map((r, i) => r.rank + '. ' + r.name + ' (' + (r.points || 0) + (i === 0 ? ' pts' : '') + ')').join(', ');
const link = 'go.playcnqr.com/socials?' + (club === 'tempe' ? 'c=tempe&' : '') + 'v=board&s=' + encodeURIComponent(series);
// (a social can have a fuller public name than the short one used in the app: Flyer and look, "Name on the leaderboard to share")
const shared = parse(input.share_raw, {}), publicName = String((shared && shared.name) || '').replace(/\s+/g, ' ').trim() || title;
const text = 'Conquer Padel: thanks for playing ' + publicName + ' ' + when + '! Congrats to our top ' + Math.min(3, rows.length) + ': ' + top + '. See the full results and the ' +
  MONTHS[Number(best.m.slice(5, 7)) - 1] + ' leaderboard, and share yours: ' + link;
// every player of the night (both players of a fixed pair), and what to look up in PlayByPoint: each full name, last
// name and first name (a customer spelled another way is found through the name that is spelled the same)
const names = [], seen = {};
rows.forEach(r => (Array.isArray(r.players) && r.players.length ? r.players : [r.name]).forEach(p => { const n = String(p || '').replace(/\s+/g, ' ').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; names.push(n); } }));
const plain = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const q = {}, queries = [];
names.forEach(n => { const p = plain(n), t = p.split(' '); if (t.length < 2) return; [p, t[t.length - 1], t[0]].forEach(x => { if (x.length >= 3 && !q[x.toLowerCase()]) { q[x.toLowerCase()] = true; queries.push(x); } }); });
return { ok: 'yes', reason: '', start: String(best.d.start || ''), public_name: publicName, queries: queries.join('|'), names_json: JSON.stringify(names), text: text,
  key: club + '|' + series + '|' + date + (String(input.test || '') === '1' ? '|test' : ''), night: date, title: title, players: String(names.length), nice_date: DAYS[dt.getUTCDay()] + ', ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate() };
