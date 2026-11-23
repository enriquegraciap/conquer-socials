'use strict';
/*
 * Builds the two Make scenarios of the "results text" from the code files in this folder (into private/, which is
 * not published). The blueprints hold no secrets: tokens are read at run time from the club's secrets data store.
 *   node tools/results-text/build.js
 * "Card": for one social (club + social id) finds the latest night, matches its players to PlayByPoint customers and
 * HighLevel contacts, and posts a card to the approvals chat on Telegram with Send and Skip buttons (links).
 * "Send": runs when a button is pressed; sends the text through HighLevel to the people on the card, once.
 */
const fs = require('fs');
// (the code goes into the scenario without its comment lines, and the files are written in plain ASCII)
const here = f => fs.readFileSync(__dirname + '/' + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s+\/\/ [^'"]*$/, '')).join('\n').replace(/\n{2,}/g, '\n').trim() + '\n';
const ascii = o => JSON.stringify(o).replace(/[\u007f-\uffff]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
// The ids of this club's own Make account (data stores, the buttons' webhook, HighLevel and PlayByPoint ids) are not
// in this public repository: they are read from private/results-text.json, and the blueprints are written to private/.
const PRIVATE = __dirname + '/../../private/', CFG = JSON.parse(fs.readFileSync(PRIVATE + 'results-text.json', 'utf8'));
const SECRETS = CFG.secretsStore, STORE = CFG.store, HOOK = CFG.hook, HOOK_URL = CFG.hookUrl;
const DB = 'https://conquer-socials-default-rtdb.firebaseio.com', GHL = 'https://services.leadconnectorhq.com', LOCATION = CFG.location;
const FACILITY = '{{if(var.input.club = "tempe"; "' + CFG.facility.tempe + '"; "' + CFG.facility.lehi + '")}}';
const ROOT = '{{if(var.input.club = "tempe"; "tempe"; "pub")}}', TZ = 'if(var.input.club = "tempe"; "America/Phoenix"; "America/Denver")';
let at = 0;
const pos = name => ({ designer: { x: 300 * at++, y: 0, name: name } });
const http = (id, name, o) => ({ id: id, module: 'http:ActionSendData', version: 3, metadata: pos(name), filter: o.filter,
  mapper: { ca: '', qs: [], url: o.url, data: o.data, gzip: true, method: o.method || 'get', headers: o.headers || [], timeout: '', useMtls: false, authPass: '', authUser: '',
    bodyType: o.data !== undefined ? 'raw' : null, contentType: o.data !== undefined ? 'application/json' : undefined, serializeUrl: false, shareCookies: false, parseResponse: o.parse !== false,
    followRedirect: true, useQuerystring: false, followAllRedirects: false, rejectUnauthorized: true },
  parameters: { handleErrors: false, useNewZLibDeCompress: true } });
const code = (id, name, src, input, filter) => ({ id: id, module: 'code:ExecuteCode', version: 1, parameters: {}, metadata: pos(name), filter: filter,
  mapper: { input: Object.keys(input).map(k => ({ name: k, value: input[k] })), language: 'javascript', inputFormat: 'editor', codeEditorJavascript: src } });
const secrets = id => ({ id: id, module: 'datastore:GetRecord', version: 1, mapper: { key: 'prod', returnWrapped: false }, parameters: { datastore: SECRETS }, metadata: pos('Secrets') });
const clean = o => JSON.parse(JSON.stringify(o));
const is = (a, b) => ({ a: a, b: b, o: 'text:equal' }), not = (a, b) => ({ a: a, b: b, o: 'text:notequal' });
const meta = instant => ({ instant: !!instant, version: 1, scenario: { dlq: false, slots: null, dataloss: false, maxErrors: 3, autoCommit: true, roundtrips: 1, sequential: false, confidential: false, freshVariables: false, autoCommitTriggerLast: true } });
const matchSrc = here('match.js').replace(/if \(typeof module[\s\S]*$/, '').replace(/^'use strict';\n/, '');   // (the same name matching goes into two of the code steps)
const bearer = (field, extra) => [{ name: 'Authorization', value: 'Bearer {{1.' + field + '}}' }, { name: 'Accept', value: 'application/json' }].concat(extra || []);

// (an answer that is not read as JSON arrives as raw bytes: toString() makes it text before it goes into the code)
// ---------------------------------------------------------------- the card
at = 0;
const REST_OF = () => [
    { id: 5, module: 'builtin:BasicFeeder', version: 1, parameters: {}, metadata: pos('Each name to look up'), mapper: { array: '{{split(4.result.queries; "|")}}' },
      filter: { name: 'There is a night with players', conditions: [[is('{{4.result.ok}}', 'yes')]] } },
    http(6, 'PlayByPoint customers', { url: 'https://api.playbypoint.com/v1/customers?q={{encodeURL(5.value)}}&limit=100', parse: false, headers: bearer('pbp_key', [{ name: 'X-PBP-Facility-Id', value: FACILITY }]) }),
    { id: 7, module: 'util:TextAggregator', version: 1, parameters: { feeder: 5, rowSeparator: '\n' }, metadata: pos('All answers'), mapper: { value: '{{toString(6.data)}}' } },
    code(8, 'Who is who', matchSrc + '\n' + here('pick.js'), { names_json: '{{4.result.names_json}}', pool: '{{7.text}}', extra: '{{var.input.extra}}' }),
    { id: 9, module: 'builtin:BasicFeeder', version: 1, parameters: {}, metadata: pos('Each matched player'), mapper: { array: '{{split(8.result.lookups; "|")}}' } },
    http(10, 'HighLevel: by phone', { url: GHL + '/contacts/search/duplicate?locationId=' + LOCATION + '&number={{encodeURL(get(split(9.value; "~"); 2))}}', parse: false, headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }]) }),
    http(16, 'HighLevel: by email', { url: GHL + '/contacts/search', method: 'post', parse: false, data: '{"locationId":"' + LOCATION + '","pageLimit":5,"query":"{{get(split(9.value; "~"); 3)}}"}',
      headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }, { name: 'Content-Type', value: 'application/json' }]) }),
    http(17, 'HighLevel: by name', { url: GHL + '/contacts/search', method: 'post', parse: false, data: '{"locationId":"' + LOCATION + '","pageLimit":20,"query":"{{get(split(9.value; "~"); 4)}}"}',
      headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }, { name: 'Content-Type', value: 'application/json' }]) }),
    { id: 11, module: 'util:TextAggregator', version: 1, parameters: { feeder: 9, rowSeparator: '\n' }, metadata: pos('All contacts'), mapper: { value: '{"i":"{{get(split(9.value; "~"); 1)}}","a":{{ifempty(toString(10.data); "null")}},"b":{{ifempty(toString(16.data); "null")}},"c":{{ifempty(toString(17.data); "null")}}}' } },
    code(12, 'The card', matchSrc + '\n' + here('card.js'), { matched_json: '{{8.result.matched_json}}', skipped_json: '{{8.result.skipped_json}}', ghl: '{{11.text}}', text: '{{4.result.text}}', title: '{{4.result.title}}',
      club: '{{var.input.club}}', nice_date: '{{4.result.nice_date}}', players: '{{4.result.players}}', key: '{{4.result.key}}', hook: HOOK_URL, dry: '{{var.input.dry}}',
      from: '{{if(var.input.club = "tempe"; "' + CFG.from.tempe + '"; "' + CFG.from.lehi + '")}}', seed: '{{uuid}}' }),
    { id: 20, module: 'datastore:GetRecord', version: 1, mapper: { key: '{{4.result.key}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('Already a card for this night?') },
    { id: 13, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Keep it until a button is pressed'),
      filter: { name: 'Not sent already', conditions: [[not('{{20.status}}', 'sent'), not('{{20.status}}', 'sending')]] },
      mapper: { key: '{{4.result.key}}', overwrite: true, data: { status: '{{if(var.input.dry = "1"; "dry"; if(12.result.ok = "yes"; "pending"; "nobody"))}}', token: '{{12.result.token}}', club: '{{var.input.club}}', series: '{{var.input.series}}',
        title: '{{4.result.title}}', night: '{{4.result.night}}', text: '{{4.result.text}}', msg_json: '{{12.result.msg_json}}', from: '{{12.result.from}}', recipients: '{{12.result.recipients_json}}', count: '{{12.result.count}}',
        card: '{{12.result.card_text}}', created: '{{formatDate(now; "YYYY-MM-DD HH:mm"; ' + TZ + ')}}', result: '{{8.result.found}} PlayByPoint customers looked at' } } },
    http(14, 'Post the card', { url: 'https://api.telegram.org/bot{{1.telegram_bot_token}}/sendMessage', method: 'post', data: '{{replace(12.result.card; "__CHAT__"; 1.telegram_chat_id)}}',
      headers: [{ name: 'Content-Type', value: 'application/json' }], filter: { name: 'Not a dry run', conditions: [[not('{{var.input.dry}}', '1')]] } }),
    { id: 15, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Remember where the card is'),
      mapper: { key: '{{4.result.key}}', data: { chat: '{{14.data.result.chat.id}}', msg: '{{14.data.result.message_id}}' } } },
    // an earlier card for the same night that nobody pressed: it no longer sends anything, and says so
    http(18, 'Retire the earlier card', { url: 'https://api.telegram.org/bot{{1.telegram_bot_token}}/editMessageText', method: 'post', headers: [{ name: 'Content-Type', value: 'application/json' }],
      data: '{"chat_id":"{{ifempty(20.chat; 1.telegram_chat_id)}}","message_id":{{ifempty(var.input.retire; 20.msg)}},"text":"REPLACED by a newer card for the same night (further down). This one no longer sends anything."}',
      filter: { name: 'There was an earlier card still waiting', conditions: [[is('{{20.status}}', 'pending'), { a: '{{20.msg}}', o: 'exist' }], [{ a: '{{var.input.retire}}', o: 'exist' }]] } })
  ];
let REST = null;
const cardOf = () => ({ name: 'Conquer - Socials results text: card for approval (Claude)', metadata: meta(false),
  interface: { input: [
    { name: 'club', type: 'text', required: true, description: 'lehi or tempe' },
    { name: 'series', type: 'text', required: true, description: 'The social\'s id in the socials app (the s= part of its links), for example asu-college-padel-nights' },
    { name: 'extra', type: 'text', required: false, description: 'One more person to send to, as Name|phone (optional)' },
    { name: 'dry', type: 'text', required: false, description: '1 = work everything out and save it, but post no card' },
    { name: 'retire', type: 'text', required: false, description: 'Telegram message id of an earlier card to mark as replaced (optional)' }], output: [] },
  flow: [
    secrets(1),
    http(2, 'The social\'s name', { url: DB + '/' + ROOT + '/series/{{encodeURL(var.input.series)}}/name.json', parse: false }),
    http(3, 'Its results', { url: DB + '/' + ROOT + '/results/{{encodeURL(var.input.series)}}.json', parse: false }),
    code(4, 'The night and the text', here('night.js'), { club: '{{var.input.club}}', series: '{{var.input.series}}', name_raw: '{{toString(2.data)}}', results_raw: '{{toString(3.data)}}',
      today: '{{formatDate(now; "YYYY-MM-DD"; ' + TZ + ')}}', yesterday: '{{formatDate(addDays(now; -1); "YYYY-MM-DD"; ' + TZ + ')}}', hour: '{{formatDate(now; "H"; ' + TZ + ')}}' }),
    { id: 40, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: pos('Is there a night?'), routes: [
      { flow: [{ id: 41, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Note why there is no card'), filter: { name: 'No night to text about', conditions: [[not('{{4.result.ok}}', 'yes')]] },
        mapper: { key: 'last-run-without-a-card', overwrite: true, data: { status: 'nothing', club: '{{var.input.club}}', series: '{{var.input.series}}', created: '{{formatDate(now; "YYYY-MM-DD HH:mm"; ' + TZ + ')}}', result: '{{4.result.reason}}' } } }] },
      { flow: REST }] }
  ] });
at = 5; REST = REST_OF(); at = 0;
const card = cardOf();

// ---------------------------------------------------------------- the buttons
at = 0;
const page = (title, line) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>' +
  '<body style="margin:0;font:20px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;background:#071a30;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center">' +
  '<div style="padding:24px;max-width:520px"><h1 style="font-size:30px;margin:0 0 12px">' + title + '</h1><p style="margin:0">' + line + '</p><p style="opacity:.7;font-size:16px">You can close this page.</p></div>';
const respond = (id, name, title, line, filter) => ({ id: id, module: 'gateway:WebhookRespond', version: 1, parameters: {}, metadata: pos(name), filter: filter,
  mapper: { status: '200', body: page(title, line), headers: [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }] } });
const editSrc = "const head = String(input.head || ''), body = { chat_id: String(input.chat || ''), message_id: Number(input.msg || 0), text: (head + '\\n' + String(input.card || '')).slice(0, 4000), disable_web_page_preview: true };\n" +
  "const lines = String(input.lines || '').split('\\n').filter(Boolean), failed = lines.filter(l => l !== 'ok');\n" +
  "const sent = lines.length - failed.length, summary = sent + ' sent' + (failed.length ? ', ' + failed.length + ' failed: ' + failed.map(f => f.replace(/^FAILED /, '')).join(', ') : '');\n" +
  "body.text = (head.replace('__SUMMARY__', summary) + '\\n' + String(input.card || '')).slice(0, 4000);\n" +
  "return { edit: JSON.stringify(body), summary: summary, sent: String(sent), has_card: body.chat_id && body.message_id ? 'yes' : 'no' };";
// the card is relabelled first (its buttons go), what Telegram answered is kept with the record, then the person is told
const edit = (id, codeId) => http(id, 'Mark the card', { url: 'https://api.telegram.org/bot{{2.telegram_bot_token}}/editMessageText', method: 'post', data: '{{' + codeId + '.result.edit}}', headers: [{ name: 'Content-Type', value: 'application/json' }] });
const marked = id => ' Card relabelled: {{if(' + id + '.data.ok; "yes"; "no, " + ' + id + '.data.description)}}';
const mine = [is('{{3.token}}', '{{1.t}}'), is('{{3.status}}', 'pending'), { a: '{{1.t}}', o: 'exist' }];
const stamp = '{{formatDate(now; "ddd MMM D, h:mm A"; if(3.club = "tempe"; "America/Phoenix"; "America/Denver"))}}';
const send = { name: 'Conquer - Socials results text: Send / Skip buttons (Claude)', metadata: meta(true), interface: { input: [], output: [] },
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', version: 1, parameters: { hook: HOOK, maxResults: 1 }, mapper: {}, metadata: pos('A button was pressed') },
    Object.assign(secrets(2), {}),
    { id: 3, module: 'datastore:GetRecord', version: 1, mapper: { key: '{{1.id}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('The card') },
    { id: 4, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: pos('Which button'), routes: [
      { flow: [
        { id: 10, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as being sent (so it cannot go twice)'), mapper: { key: '{{1.id}}', data: { status: 'sending' } },
          filter: { name: 'Send, with the card\'s own token, not handled yet', conditions: [mine.concat([is('{{1.do}}', 'send')])] } },
        { id: 11, module: 'json:ParseJSON', version: 1, parameters: { type: '' }, metadata: pos('Each person'), mapper: { json: '{{3.recipients}}' } },
        http(12, 'Text through HighLevel', { url: GHL + '/conversations/messages', method: 'post', data: '{"type":"SMS","contactId":"{{11.cid}}","message":{{3.msg_json}},"fromNumber":"{{3.from}}"}',
          headers: [{ name: 'Authorization', value: 'Bearer {{2.ghl_pit}}' }, { name: 'Version', value: '2021-04-15' }, { name: 'Accept', value: 'application/json' }, { name: 'Content-Type', value: 'application/json' }] }),
        { id: 13, module: 'util:TextAggregator', version: 1, parameters: { feeder: 11, rowSeparator: '\n' }, metadata: pos('How each one went'), mapper: { value: '{{if(12.statusCode < 300; "ok"; "FAILED " + 11.name)}}' } },
        code(14, 'Count', editSrc, { lines: '{{13.text}}', head: 'SENT ' + stamp + ' (__SUMMARY__)', card: '{{3.card}}', chat: '{{3.chat}}', msg: '{{3.msg}}' }),
        edit(16, 14),
        { id: 15, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as sent'), mapper: { key: '{{1.id}}', data: { status: 'sent', result: '{{14.result.summary}} on ' + stamp + '.' + marked(16) } } },
        respond(17, 'Tell the person', 'Sent', '{{14.result.summary}}.{{if(16.data.ok; " The card in Telegram now says SENT."; "")}}')
      ] },
      { flow: [
        { id: 20, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as skipped'), mapper: { key: '{{1.id}}', data: { status: 'skipped', result: 'skipped on ' + stamp } },
          filter: { name: 'Skip, with the card\'s own token, not handled yet', conditions: [mine.concat([is('{{1.do}}', 'skip')])] } },
        code(21, 'New card text', editSrc, { lines: '', head: 'SKIPPED ' + stamp + ' (no texts sent)', card: '{{3.card}}', chat: '{{3.chat}}', msg: '{{3.msg}}' }),
        edit(22, 21),
        respond(23, 'Tell the person', 'Skipped', 'No texts were sent.')
      ] },
      { flow: [
        respond(30, 'Nothing to do', 'Nothing was sent', 'This card was already handled, or the link is not the card\'s own.',
          { name: 'Wrong token, or handled already', conditions: [[not('{{3.token}}', '{{1.t}}')], [not('{{3.status}}', 'pending')], [{ a: '{{1.t}}', o: 'notexist' }]] })
      ] }
    ] }
  ] };
fs.writeFileSync(PRIVATE + 'results-text-card.blueprint.json', ascii(clean(card)));
fs.writeFileSync(PRIVATE + 'results-text-send.blueprint.json', ascii(clean(send)));
console.log('card', JSON.stringify(clean(card)).length, 'chars; send', JSON.stringify(clean(send)).length, 'chars');
