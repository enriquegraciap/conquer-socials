// Make code module "Which PlayByPoint program": the PlayByPoint program this social is run as, so that its own
// roster for the day can be read (instead of looking names up among all the club's customers).
// Either the social names it itself (its "pbp" setting), or it is the program in the club's PlayByPoint schedule
// (the same list the TV's "Coming up" sign uses) that was on at the time the social started.
// input: pbp_raw (JSON of the social's pbp setting), promo_raw (JSON of the club's schedule), date (YYYY-MM-DD),
//        start (HH:MM the social started at, may be empty), title (the social's name)
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
const own = parse(input.pbp_raw, '');
if (typeof own === 'string' && /^[A-Za-z0-9_.~-]{2,120}$/.test(own.trim())) return { program: own.trim(), why: 'set on the social' };
const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const plain = s => { let x = String(s || ''); try { x = decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { /* as it is */ } return x; };
const words = s => plain(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length >= 3 && !/^(the|and|for|padel|play)$/.test(w));
const promo = parse(input.promo_raw, {}), items = [];
Object.keys(promo || {}).forEach(k => { const list = promo[k] && promo[k].items; (Array.isArray(list) ? list : Object.keys(list || {}).map(x => list[x])).forEach(it => { if (it && it.program && it.date === input.date) items.push(it); }); });
if (!items.length) return { program: '', why: 'no PlayByPoint session that day in the club schedule' };
const at = mins(input.start), mine = words(input.title);
const alike = it => { const w = words(it.name); return mine.filter(x => w.indexOf(x) >= 0).length; };
let pool = items;
if (at >= 0) pool = items.filter(it => mins(it.start) >= 0 && at >= mins(it.start) - 75 && at <= (mins(it.end) >= 0 ? mins(it.end) : mins(it.start) + 120));
if (!pool.length) return { program: '', why: 'no PlayByPoint session at that time in the club schedule' };
pool.sort((a, b) => (alike(b) - alike(a)) || (at >= 0 ? Math.abs(mins(a.start) - at) - Math.abs(mins(b.start) - at) : 0));
if (at < 0 && pool.length > 1 && !alike(pool[0])) return { program: '', why: 'several PlayByPoint sessions that day and no start time to tell them apart' };
return { program: String(pool[0].program), why: 'the session at ' + pool[0].start + ' in the club schedule: ' + plain(pool[0].name) };
