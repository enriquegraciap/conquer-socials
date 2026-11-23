// Make code module "Who is who": matches the night's players to PlayByPoint customers (match.js is put in front of this).
// input: names_json, pool (one PlayByPoint answer per line), extra ("Name|phone": one more person to send to, optional)
const e164 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : d.length >= 11 ? '+' + d : ''; };
const byId = {}, customers = [];
String(input.pool || '').split('\n').forEach(line => {
  let j = null; try { j = JSON.parse(line); } catch (e) { j = null; }
  if (Array.isArray(j)) j = { customers: j };
  ((j && j.customers) || []).forEach(c => { if (!c || !c.id || byId[c.id]) return; byId[c.id] = true; customers.push({ id: c.id, name: c.name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim(), phone: e164(c.phone) }); });
});
let names = []; try { names = Array.isArray(input.names_json) ? input.names_json : JSON.parse(input.names_json || '[]'); } catch (e) { names = []; }
const out = matchPlayers(names, customers);
const matched = out.matched.map(m => ({ name: m.name, phone: m.customer.phone, close: m.how === 'exact' ? '' : m.customer.name }));
const extra = String(input.extra || '').split('|'), xp = e164(extra[1]);
if (xp && !matched.some(m => m.phone === xp)) matched.push({ name: (extra[0] || 'Extra').trim(), phone: xp, close: '', extra: true });
return { phones: matched.map(m => m.phone).join('|'), matched_json: JSON.stringify(matched), skipped_json: JSON.stringify(out.skipped), found: String(customers.length) };
