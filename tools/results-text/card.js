// Make code module "The card" (match.js is put in front of this): who really gets the text (a HighLevel contact that
// takes texts), and the Telegram card.
// input: matched_json, skipped_json, ghl (one line per matched player: {"i": number, "a": HighLevel's answer for the phone,
// "b": its answer for the email, "c": its answer for the name}), text, title, club, nice_date, players, key, hook, dry,
// from (the club's own number the text goes out from), seed (a random id)
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
const recipients = [], close = [], seenC = {};
matched.forEach(m => {
  const got = contactFor(m), c = got.c;
  if (!c) return skipped.push({ name: m.name, why: got.how });
  const sms = c.dndSettings && c.dndSettings.SMS && c.dndSettings.SMS.status === 'active';
  if (c.dnd === true || sms) return skipped.push({ name: m.name, why: 'opted out of texts in HighLevel' });
  if (!c.phone) return skipped.push({ name: m.name, why: 'no phone on the HighLevel contact' });
  if (seenC[c.id]) return skipped.push({ name: m.name, why: 'same contact as ' + seenC[c.id] });
  seenC[c.id] = m.name;
  recipients.push({ cid: c.id, name: m.name, extra: !!m.extra });
  const notes = [];
  if (m.close) notes.push('PlayByPoint "' + m.close + '"');
  if (got.how) notes.push('HighLevel "' + fullName(c) + '" (found by ' + got.how + ')');
  if (notes.length) close.push('"' + m.name + '" = ' + notes.join(', '));
});
const players = recipients.filter(r => !r.extra), extras = recipients.filter(r => r.extra);
const Club = input.club === 'tempe' ? 'Tempe' : 'Lehi';
// the buttons' one-time token: Make's own random id (random numbers made inside this step repeat from run to run)
let token = String(input.seed || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 32);
if (token.length < 24) for (let i = 0; i < 28; i++) token += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)];
const lines = ['RESULTS TEXT | ' + input.title + ' (' + Club + ') | ' + input.nice_date,
  'Send goes to ' + players.length + ' of ' + input.players + ' players' + (extras.length ? ', plus ' + extras.map(r => r.name).join(', ') : '') + '. Nothing is sent until you press Send.',
  '', 'TEXT', input.text, '', 'WILL RECEIVE (' + players.length + ')', players.map(r => r.name).join(', ') || 'nobody'];
if (close.length) lines.push('', 'MATCHED BY A SIMILAR NAME, PLEASE CHECK (' + close.length + ')', close.join('\n'));
if (skipped.length) lines.push('', 'NOT SENT (' + skipped.length + ')', skipped.map(s => s.name + ': ' + s.why).join('\n'));
const cardText = lines.join('\n').slice(0, 3900);
const url = what => String(input.hook) + '?id=' + encodeURIComponent(input.key) + '&t=' + token + '&do=' + what;
const card = { chat_id: '__CHAT__', disable_web_page_preview: true, text: cardText };
if (recipients.length) card.reply_markup = { inline_keyboard: [[{ text: 'Send to ' + recipients.length, url: url('send') }, { text: 'Skip', url: url('skip') }]] };
return { ok: recipients.length ? 'yes' : 'no', recipients_json: JSON.stringify(recipients.map(r => ({ cid: r.cid, name: r.name }))), count: String(recipients.length), card: JSON.stringify(card), card_text: cardText,
  token: token, msg_json: JSON.stringify(String(input.text)), from: String(input.from || '') };
