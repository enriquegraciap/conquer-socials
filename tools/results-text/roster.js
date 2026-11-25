// Make code module "The day's roster": from the program's sessions and enrollments in PlayByPoint, who was signed
// up for the session on the social's day. Gives back what to fetch next (paths, joined by |): one customer per
// person on the roster, or, when there is no roster to go by, the old search by name among all customers.
// input: program, sess_a, sess_b (two readings of the program's sessions: oldest first, newest first),
//        e1..e4 (pages of the program's enrollments), date, start, queries (names to search for, joined by |)
const parse = (s, d) => { if (s && typeof s === 'object' && !(s.type === 'Buffer')) return s; if (s && s.type === 'Buffer' && s.data) s = Buffer.from(s.data).toString('utf8'); try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const search = why => {
  const q = String(input.queries || '').split('|').filter(Boolean).map(x => 'customers?q=' + encodeURIComponent(x) + '&limit=100');
  return { roster: 'no', paths: (q.length ? q : ['customers?q=zzzz-nobody&limit=1']).join('|'), count: '0', note: why + ': the names were looked up among all of the club\'s PlayByPoint customers.' };
};
if (!input.program) return search('No PlayByPoint session was found for this social (' + (input.why || 'not in the schedule') + ')');
const seen = {}, sessions = [];
[input.sess_a, input.sess_b].forEach(r => ((parse(r, {}) || {}).sessions || []).forEach(s => { if (s && s.id && !seen[s.id] && s.date === input.date) { seen[s.id] = true; sessions.push(s); } }));
if (!sessions.length) return search('PlayByPoint has no session of "' + input.program + '" on that day');
const at = mins(input.start);
sessions.sort((a, b) => at >= 0 ? Math.abs(mins(a.start_time) - at) - Math.abs(mins(b.start_time) - at) : 0);
const session = sessions[0], ids = [], got = {};
// every page of sign-ups that was read (e1, e2, ...): the program's whole history, so tonight's can be on any of them
const pages = Object.keys(input).filter(k => /^e\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(k => parse(input[k], {}) || {});
pages.forEach(p => (p.enrollments || []).forEach(e => {
  if (!e || !e.customer_id || got[e.customer_id] || (e.session_ids || []).indexOf(session.id) < 0) return;
  got[e.customer_id] = true; ids.push(e.customer_id);
}));
// still more sign-ups after the last page that was read: the roster may be short of some players
const lastPage = pages.filter(p => Array.isArray(p.enrollments)).pop(), cut = !!(lastPage && lastPage.next_cursor) ? ' PlayByPoint has more sign-ups for this program than this card reads, so someone on the roster may be missing here.' : '';
if (!ids.length) return search('Nobody is signed up in PlayByPoint for the ' + session.start_time + ' session');
// The three sessions before it: a regular who played without signing up this time, or who is in the app by first name
// only, is looked for on those rosters too (after the day's own roster, never instead of it).
const before = [], seenS = {};
[input.sess_a, input.sess_b].forEach(r => ((parse(r, {}) || {}).sessions || []).forEach(s => { if (s && s.id && !seenS[s.id] && String(s.date) < String(input.date)) { seenS[s.id] = true; before.push(s); } }));
before.sort((a, b) => (String(b.date) + String(b.start_time || '')).localeCompare(String(a.date) + String(a.start_time || '')));
const recent = before.slice(0, 3).map(s => s.id), earlier = [];
if (recent.length) pages.forEach(p => (p.enrollments || []).forEach(e => {
  if (!e || !e.customer_id || got[e.customer_id] || !(e.session_ids || []).some(id => recent.indexOf(id) >= 0)) return;
  got[e.customer_id] = true; earlier.push(e.customer_id);
}));
const more = earlier.slice(0, 60);
return { roster: 'yes', paths: ids.concat(more).map(id => 'customers/' + id).join('|'), count: String(ids.length), prime: ids.join('|'), earlier: String(more.length),
  note: 'Matched with the PlayByPoint roster of the ' + session.start_time + ' session that day (' + ids.length + ' signed up)' +
    (more.length ? ', then with the rosters of the ' + (recent.length === 1 ? 'session' : recent.length + ' sessions') + ' before it.' : '.') + cut };
