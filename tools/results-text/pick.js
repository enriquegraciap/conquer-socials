// Make code module "Who is who": matches the night's players to PlayByPoint customers (match.js is put in front of this).
// input: names_json, pool (one PlayByPoint answer per line), extra ("Name|phone": one more person to send to, optional),
//        roster ("yes" when the pool is the day's PlayByPoint roster of this social, not a search among all customers)
// Gives back, for every matched player, what to look for in HighLevel: "number~phone~email~name" (lookups, joined by |).
const e164 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : d.length >= 11 ? '+' + d : ''; };
const byId = {}, customers = [];
String(input.pool || '').split('\n').forEach(line => {
  let j = null; try { j = JSON.parse(line); } catch (e) { j = null; }
  if (Array.isArray(j)) j = { customers: j };
  if (j && j.customer) j = { customers: [j.customer] };
  ((j && j.customers) || []).forEach(c => { if (!c || !c.id || byId[c.id]) return; byId[c.id] = true;
    customers.push({ id: c.id, first: String(c.first_name || '').trim(), last: String(c.last_name || '').trim(), name: String(c.name || ((c.first_name || '') + ' ' + (c.last_name || ''))).replace(/\s+/g, ' ').trim(), phone: e164(c.phone), raw: String(c.phone || ''), email: String(c.email || '').trim().toLowerCase() }); });
});
let names = []; try { names = Array.isArray(input.names_json) ? input.names_json : JSON.parse(input.names_json || '[]'); } catch (e) { names = []; }
const out = matchPlayers(names, customers);
// With the day's own roster the choice is small, so a looser match is safe: a player still unmatched is the one person
// left on the roster who shares the last name, or (failing that) the first name. Those are shown on the card to check.
if (String(input.roster || '') === 'yes') {
  const taken = {}; out.matched.forEach(m => { taken[m.customer.id] = true; });
  const first = s => parts(s)[0] || '', last = s => { const p = parts(s); return p[p.length - 1] || ''; };
  out.skipped = out.skipped.filter(sk => {
    if (/^same customer/.test(sk.why)) return true;
    const free = customers.filter(c => !taken[c.id] && c.phone), solo = parts(sk.name).length < 2;
    let hit = solo ? [] : free.filter(c => last(c.name) === last(sk.name));
    if (hit.length !== 1) hit = free.filter(c => first(c.name) === first(sk.name));
    if (hit.length !== 1) { sk.why = 'not on the PlayByPoint roster of this session'; return true; }
    taken[hit[0].id] = true; out.matched.push({ name: sk.name, customer: hit[0], how: 'close: ' + hit[0].name });
    return false;
  });
}
const matched = out.matched.map(m => ({ name: m.name, phone: m.customer.phone, digits: m.customer.raw.replace(/\D/g, ''), email: m.customer.email, cname: m.customer.name, cfirst: m.customer.first || '', clast: m.customer.last || '', close: m.how === 'exact' ? '' : m.customer.name }));
const extra = String(input.extra || '').split('|'), xp = e164(extra[1]);
if (xp && !matched.some(m => m.phone === xp)) matched.push({ name: (extra[0] || 'Extra').trim(), phone: xp, digits: xp.replace(/\D/g, ''), email: '', cname: '', close: '', extra: true });
const safe = s => String(s || '').replace(/[|~"\\\n\r]/g, ' ').trim();
matched.forEach((m, i) => { m.i = String(i + 1); });
// HighLevel is asked for the last name alone (it finds "Damian Cucu" for "Cucu", not for "Damian-Alexandru Cucu")
const lastWord = s => { const w = safe(s).split(' ').filter(x => x.length >= 3); return w.length ? w[w.length - 1] : safe(s); };
return { lookups: matched.map(m => [m.i, m.phone, safe(m.email) || 'none', lastWord(m.cname || m.name) || 'none'].join('~')).join('|'), matched_json: JSON.stringify(matched), skipped_json: JSON.stringify(out.skipped), found: String(customers.length) };
