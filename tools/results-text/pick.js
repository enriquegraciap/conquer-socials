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
// The pool can be the day's own roster followed by the rosters of the sessions before it (input.prime: the ids of the
// day's own). The day's roster always comes first; the earlier ones are only for players it did not settle.
const rosterMode = String(input.roster || '') === 'yes', primeIds = {};
String(input.prime || '').split('|').filter(Boolean).forEach(id => { primeIds[id] = true; });
const hasPrime = Object.keys(primeIds).length > 0, isPrime = c => !hasPrime || !!primeIds[c.id];
const out = matchPlayers(names, rosterMode ? customers.filter(isPrime) : customers);
// With a roster the choice is small, so a looser match is safe: a player still unmatched is the one person left on
// the roster who shares the last name, or (failing that) the first name, or a first name that is nearly the same
// (Kristen and Kristin, Ellie and Elly). Those are shown on the card to check.
if (rosterMode) {
  const taken = {}; out.matched.forEach(m => { taken[m.customer.id] = true; });
  const first = s => parts(s)[0] || '', last = s => { const p = parts(s); return p[p.length - 1] || ''; };
  const short = s => s.replace(/(ie|ey|ee|y|i|e)$/, '');
  const oneOff = (a, b) => {                                   // one letter changed, added or left out
    if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 5) return false;
    let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
    return d + (a.length - i) + (b.length - j) <= 1;
  };
  const near = (a, b) => !!a && !!b && (short(a).length >= 3 && short(a) === short(b) || oneOff(a, b) || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)));
  // three passes over whoever is still unmatched, the surest first: the same last name, the same first name, a first
  // name that is nearly the same. Each needs exactly one person left in the pool who fits.
  const loose = (pool, where, earlier) => {
    [(c, sk) => parts(sk.name).length >= 2 && last(c.name) === last(sk.name), (c, sk) => first(c.name) === first(sk.name), (c, sk) => near(first(c.name), first(sk.name))].forEach(fits => {
      out.skipped = out.skipped.filter(sk => {
        if (/^same customer/.test(sk.why)) return true;
        // (someone on a roster without a phone in PlayByPoint still counts: HighLevel may have their number. Only the
        //  club's phone-less guest accounts are never guessed.)
        const hit = pool.filter(c => !taken[c.id] && (c.phone || !/\bguest\b/i.test(c.name)) && fits(c, sk));
        if (hit.length !== 1) { sk.why = where; return true; }
        taken[hit[0].id] = true; out.matched.push({ name: sk.name, customer: hit[0], how: 'close: ' + hit[0].name, earlier: earlier });
        return false;
      });
    });
  };
  loose(customers.filter(isPrime), 'not on the PlayByPoint roster of this session', false);
  const old = customers.filter(c => !isPrime(c));
  if (old.length) {
    // full names first, exactly as with the day's roster; then the looser match
    const again = matchPlayers(out.skipped.filter(sk => !/^same customer/.test(sk.why)).map(sk => sk.name), old.filter(c => !taken[c.id]));
    again.matched.forEach(m => { taken[m.customer.id] = true; m.earlier = true; out.matched.push(m); });
    const done = {}; again.matched.forEach(m => { done[m.name] = true; });
    out.skipped = out.skipped.filter(sk => !done[sk.name]);
    loose(old, 'not on the PlayByPoint roster of this session or of the sessions before it', true);
  }
}
const matched = out.matched.map(m => ({ name: m.name, phone: m.customer.phone, digits: m.customer.raw.replace(/\D/g, ''), email: m.customer.email, cname: m.customer.name, cfirst: m.customer.first || '', clast: m.customer.last || '',
  close: m.how === 'exact' && !m.earlier ? '' : m.customer.name, earlier: m.earlier ? '1' : '' }));
const extra = String(input.extra || '').split('|'), xp = e164(extra[1]);
if (xp && !matched.some(m => m.phone === xp)) matched.push({ name: (extra[0] || 'Extra').trim(), phone: xp, digits: xp.replace(/\D/g, ''), email: '', cname: '', close: '', extra: true });
const safe = s => String(s || '').replace(/[|~"\\\n\r]/g, ' ').trim();
matched.forEach((m, i) => { m.i = String(i + 1); });
// HighLevel is asked for the last name alone (it finds "Damian Cucu" for "Cucu", not for "Damian-Alexandru Cucu")
const lastWord = s => { const w = safe(s).split(' ').filter(x => x.length >= 3); return w.length ? w[w.length - 1] : safe(s); };
return { lookups: matched.map(m => [m.i, m.phone, safe(m.email) || 'none', lastWord(m.cname || m.name) || 'none'].join('~')).join('|'), matched_json: JSON.stringify(matched), skipped_json: JSON.stringify(out.skipped), found: String(customers.length) };
