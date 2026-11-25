// Make code module "The card" (match.js is put in front of this): who really gets the text (a HighLevel contact that
// takes texts), and the Telegram card.
// input: matched_json, skipped_json, ghl (one line per matched player: {"i": number, "a": HighLevel's answer for the phone,
// "b": its answer for the email, "c": its answer for the name}), text, title, club, nice_date, players, key, dry,
// from (the club's own number the text goes out from), seed (a random id), roster_note (where the names were looked up),
// location (the club's HighLevel account), plan and created (see below)
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return d; } };
const matched = parse(input.matched_json, []), skipped = parse(input.skipped_json, []), answers = {};
String(input.ghl || '').split('\n').forEach(line => { const j = parse(line, null); if (j && j.i) answers[j.i] = j; });
const tail = p => String(p || '').replace(/\D/g, '').slice(-9);
const fullName = c => String(c.contactName || ((c.firstName || c.firstNameLowerCase || '') + ' ' + (c.lastName || c.lastNameLowerCase || ''))).replace(/\s+/g, ' ').trim();
// The player's HighLevel contact: the one with that phone; else one found by email or name whose phone or email is the
// customer's; else the only contact whose name is (as good as) the customer's or the player's.
const contactFor = m => {
  const a = answers[m.i] || {}, byPhoneC = a.a && a.a.contact && a.a.contact.id ? a.a.contact : null;
  if (byPhoneC) return { c: byPhoneC, how: '' };
  const seen = {}, list = [];
  [a.b, a.c].forEach(r => ((r && r.contacts) || []).forEach(c => { if (c && c.id && !seen[c.id]) { seen[c.id] = true; list.push(c); } }));
  const t = tail(m.digits || m.phone);
  let hit = t.length >= 7 ? list.filter(c => tail(c.phone) === t) : [];
  if (hit.length === 1) return { c: hit[0], how: '' };
  hit = m.email ? list.filter(c => String(c.email || '').toLowerCase() === m.email) : [];
  if (hit.length === 1) return { c: hit[0], how: 'email' };
  hit = list.filter(c => c.phone && Math.max(m.cname ? nameScore(m.cname, fullName(c)) : 0, nameScore(m.name, fullName(c))) >= 93);
  if (hit.length === 1) return { c: hit[0], how: 'name' };
  return { c: null, how: hit.length > 1 ? hit.length + ' contacts in HighLevel with that name' : 'not a contact in HighLevel' };
};
// a test card texts only the extra person: no player is on it
const test = String(input.test || '') === '1';
// A player found in PlayByPoint who is not in HighLevel at all is added there as a new contact of the club (standing
// rule), so the text can reach them. This code runs twice: first as a plan (input.plan = "1": it only lists the
// contacts to make, as requests for the next step), then for real, with HighLevel's answers (input.created: one line
// per request, {"i": number, "r": answer}). Nobody is added for a test card or a dry run.
const plan = String(input.plan || '') === '1', GHL = 'https://services.leadconnectorhq.com', made = {}, creates = [], added = [];
String(input.created || '').split('\n').forEach(line => { const j = parse(line, null); if (j && j.i) made[j.i] = j.r; });
const mayAdd = !test && String(input.dry || '') !== '1' && !!input.location;
const recipients = [], close = [], seenC = {};
matched.forEach(m => {
  if (test && !m.extra) return;
  const got = contactFor(m); let c = got.c;
  if (!c && mayAdd && !m.extra && m.phone && got.how === 'not a contact in HighLevel') {
    if (plan) {
      const words = String(m.cname || m.name).split(' '), body = { locationId: String(input.location), firstName: m.cfirst || words[0], lastName: m.clast || words.slice(1).join(' '), phone: m.phone,
        tags: ['club-' + (input.club === 'tempe' ? 'tempe' : 'lehi'), (input.club === 'tempe' ? 'tempe' : 'lehi') + '-social-player'], source: 'Socials app: played ' + String(input.title || 'a social') };
      if (m.email) body.email = m.email;
      return creates.push({ i: m.i, u: GHL + '/contacts/', b: JSON.stringify(body) });
    }
    const r = made[m.i];
    if (r && r.contact && r.contact.id) { c = r.contact; if (!c.phone) c.phone = m.phone; added.push(m.name); }
    else if (r && r.meta && r.meta.contactId) c = { id: r.meta.contactId, phone: m.phone };      // HighLevel says it has this person already
    else if (r) return skipped.push({ name: m.name, why: 'could not be added to HighLevel' + (r.message ? ' (' + String(r.message).slice(0, 90) + ')' : '') });
  }
  if (!c) return skipped.push({ name: m.name, why: got.how });
  // (HighLevel keeps this per channel, as "SMS" or "sms": active = switched off by staff, permanent = the person replied STOP)
  const dnd = c.dndSettings || {}, ch = dnd.SMS || dnd.sms, sms = !!ch && (ch.status === 'active' || ch.status === 'permanent');
  if (c.dnd === true || sms) return skipped.push({ name: m.name, why: 'opted out of texts in HighLevel' });
  if (!c.phone) return skipped.push({ name: m.name, why: 'no phone on the HighLevel contact' });
  if (seenC[c.id]) return skipped.push({ name: m.name, why: 'same contact as ' + seenC[c.id] });
  seenC[c.id] = m.name;
  recipients.push({ cid: c.id, name: m.name, extra: !!m.extra });
  const notes = [];
  if (m.close) notes.push('PlayByPoint "' + m.close + '"' + (m.earlier ? ' (on an earlier session\'s roster)' : ''));
  if (got.how) notes.push('HighLevel "' + fullName(c) + '" (found by ' + got.how + ')');
  if (notes.length) close.push('"' + m.name + '" = ' + notes.join(', '));
});
// (the plan: the contacts to make, and always one harmless search, so that the next step has something to do)
if (plan) return { creates: JSON.stringify(creates.concat([{ i: '0', u: GHL + '/contacts/search', b: JSON.stringify({ locationId: String(input.location || ''), pageLimit: 1, query: 'zzzz-nobody' }) }])), count: String(creates.length) };
const players = recipients.filter(r => !r.extra), extras = recipients.filter(r => r.extra);
const Club = input.club === 'tempe' ? 'Tempe' : 'Lehi';
// the buttons' one-time token: Make's own random id (random numbers made inside this step repeat from run to run)
let token = String(input.seed || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 32);
if (token.length < 24) for (let i = 0; i < 28; i++) token += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)];
const lines = [(test ? 'TEST CARD | ' : '') + 'RESULTS TEXT | ' + input.title + ' (' + Club + ') | ' + input.nice_date,
  test ? 'Test only: Send texts ' + (extras.map(r => r.name).join(', ') || 'nobody') + ' and no player.' : 'Send goes to ' + players.length + ' of ' + input.players + ' players' + (extras.length ? ', plus ' + extras.map(r => r.name).join(', ') : '') + '. Nothing is sent until you press Send.',
  '', 'TEXT', input.text, '', 'WILL RECEIVE (' + (test ? extras : players).length + ')', (test ? extras : players).map(r => r.name).join(', ') || 'nobody'];
if (input.roster_note) lines.splice(2, 0, String(input.roster_note));
if (added.length) lines.push('', 'ADDED TO HIGHLEVEL AS NEW CONTACTS (' + added.length + ')', added.join(', '));
if (close.length) lines.push('', 'MATCHED BY A SIMILAR NAME, PLEASE CHECK (' + close.length + ')', close.join('\n'));
if (skipped.length && !test) lines.push('', 'NOT SENT (' + skipped.length + ')', skipped.map(s => s.name + ': ' + s.why).join('\n'));
const cardText = lines.join('\n').slice(0, 3900);
// Buttons like the club's other approval cards: one tap, no page to open. The press reaches the bot's own scenario
// ("Telegram Approvals"), which hands anything that starts with "rt|" to the results-text Send scenario.
const card = { chat_id: '__CHAT__', disable_web_page_preview: true, text: cardText };
if (recipients.length) card.reply_markup = { inline_keyboard: [[{ text: '\u2705 Send to ' + recipients.length, callback_data: 'rt|s|' + token }, { text: '\u274c Skip', callback_data: 'rt|k|' + token }]] };
return { ok: recipients.length ? 'yes' : 'no', recipients_json: JSON.stringify(recipients.map(r => ({ cid: r.cid, name: r.name }))), count: String(recipients.length), card: JSON.stringify(card), card_text: cardText,
  token: token, msg_json: JSON.stringify(String(input.text)), from: String(input.from || '') };
