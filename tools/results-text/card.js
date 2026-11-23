// Make code module "The card": who really gets the text (a HighLevel contact that takes texts), and the Telegram card.
// input: matched_json, skipped_json, ghl (one line per phone: {"p": phone, "r": HighLevel's answer}), text, title, club,
// nice_date, players, key, hook, dry, from (the club's own number the text goes out from), seed (a random id)
const parse = (s, d) => { if (s && typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return d; } };
const matched = parse(input.matched_json, []), skipped = parse(input.skipped_json, []), byPhone = {};
String(input.ghl || '').split('\n').forEach(line => { const j = parse(line, null); if (j && j.p) byPhone[j.p] = j.r && j.r.contact ? j.r.contact : null; });
const recipients = [], close = [], seen = {};
matched.forEach(m => {
  const c = byPhone[m.phone];
  if (!c || !c.id) return skipped.push({ name: m.name, why: 'not a contact in HighLevel' });
  const sms = c.dndSettings && c.dndSettings.SMS && c.dndSettings.SMS.status === 'active';
  if (c.dnd === true || sms) return skipped.push({ name: m.name, why: 'opted out of texts in HighLevel' });
  if (seen[c.id]) return skipped.push({ name: m.name, why: 'same contact as ' + seen[c.id] });
  seen[c.id] = m.name;
  recipients.push({ cid: c.id, name: m.name, extra: !!m.extra });
  if (m.close) close.push('"' + m.name + '" = PlayByPoint "' + m.close + '"');
});
const players = recipients.filter(r => !r.extra), extras = recipients.filter(r => r.extra);
const Club = input.club === 'tempe' ? 'Tempe' : 'Lehi';
// the buttons' one-time token: Make's own random id (random numbers made inside this step repeat from run to run)
let token = String(input.seed || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 32);
if (token.length < 24) for (let i = 0; i < 28; i++) token += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)];
const lines = ['RESULTS TEXT | ' + input.title + ' (' + Club + ') | ' + input.nice_date,
  'Send goes to ' + players.length + ' of ' + input.players + ' players' + (extras.length ? ', plus ' + extras.map(r => r.name).join(', ') : '') + '. Nothing is sent until you press Send.',
  '', 'TEXT', input.text, '', 'WILL RECEIVE (' + players.length + ')', players.map(r => r.name).join(', ') || 'nobody'];
if (close.length) lines.push('', 'MATCHED BY A CLOSE NAME (' + close.length + ')', close.join('\n'));
if (skipped.length) lines.push('', 'NOT SENT (' + skipped.length + ')', skipped.map(s => s.name + ': ' + s.why).join('\n'));
const cardText = lines.join('\n').slice(0, 3900);
const url = what => String(input.hook) + '?id=' + encodeURIComponent(input.key) + '&t=' + token + '&do=' + what;
const card = { chat_id: '__CHAT__', disable_web_page_preview: true, text: cardText };
if (recipients.length) card.reply_markup = { inline_keyboard: [[{ text: 'Send to ' + recipients.length, url: url('send') }, { text: 'Skip', url: url('skip') }]] };
return { ok: recipients.length ? 'yes' : 'no', recipients_json: JSON.stringify(recipients.map(r => ({ cid: r.cid, name: r.name }))), count: String(recipients.length), card: JSON.stringify(card), card_text: cardText,
  token: token, msg_json: JSON.stringify(String(input.text)), from: String(input.from || '') };
