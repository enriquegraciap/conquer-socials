'use strict';
/*
 * Builds the two Make scenarios of the "results text" from the code files in this folder (into private/, which is
 * not published). The blueprints hold no secrets: tokens are read at run time from the club's secrets data store.
 *   node tools/results-text/build.js
 * "Card": for one social (club + social id) finds the latest night, matches its players to PlayByPoint customers and
 * HighLevel contacts, and posts a card to the approvals chat on Telegram with Send and Skip buttons (links).
 * "Send": runs when a button is pressed; sends the text through HighLevel to the people on the card, once.
 * "Watch": every 15 minutes looks at both clubs' saved results and starts "Card" for a night that is over (once per night).
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
const PROGRAM = 'https://api.playbypoint.com/v1/programs/{{ifempty(52.result.program; "none")}}';
const pbp = (id, name, url, parsed) => http(id, name, { url: url, parse: !!parsed, headers: [{ name: 'Authorization', value: 'Bearer {{1.pbp_key}}' }, { name: 'Accept', value: 'application/json' }, { name: 'X-PBP-Facility-Id', value: FACILITY }] });
const bearer = (field, extra) => [{ name: 'Authorization', value: 'Bearer {{1.' + field + '}}' }, { name: 'Accept', value: 'application/json' }].concat(extra || []);

// (an answer that is not read as JSON arrives as raw bytes: toString() makes it text before it goes into the code)
// ---------------------------------------------------------------- the card
at = 0;
const REST_OF = () => [
    // The day's own PlayByPoint roster first (standing rule): which program the social is, its session that day, who was
    // signed up. A step that has nothing to ask still runs (it asks for a program called "none"), so the flow never stops.
    Object.assign(http(50, 'The club\'s PlayByPoint schedule', { url: DB + '/' + ROOT + '/promo.json', parse: false }), { filter: { name: 'There is a night with players', conditions: [[is('{{4.result.ok}}', 'yes')]] } }),
    http(51, 'The social\'s own PlayByPoint program, if set', { url: DB + '/' + ROOT + '/series/{{encodeURL(var.input.series)}}/pbp.json', parse: false }),
    code(52, 'Which PlayByPoint program', here('which.js'), { pbp_raw: '{{toString(51.data)}}', promo_raw: '{{toString(50.data)}}', date: '{{4.result.night}}', start: '{{4.result.start}}', title: '{{4.result.public_name}}' }),
    pbp(53, 'Its sessions, oldest first', PROGRAM + '/sessions?limit=100'),
    pbp(54, 'Its sessions, newest first', PROGRAM + '/sessions?limit=100&sort=-date'),
    pbp(55, 'Who is enrolled (page 1)', PROGRAM + '/enrollments?limit=100', true),
    pbp(56, 'Who is enrolled (page 2)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(55.data.next_cursor; "none")}}', true),
    pbp(57, 'Who is enrolled (page 3)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(56.data.next_cursor; "none")}}', true),
    pbp(58, 'Who is enrolled (page 4)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(57.data.next_cursor; "none")}}', true),
    // (PlayByPoint lists every sign-up the program has ever had, 100 at a time and in no useful order: a weekly social
    //  that has run for months needs many pages before tonight's players have all been seen)
    pbp(80, 'Who is enrolled (page 5)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(58.data.next_cursor; "none")}}', true),
    pbp(81, 'Who is enrolled (page 6)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(80.data.next_cursor; "none")}}', true),
    pbp(82, 'Who is enrolled (page 7)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(81.data.next_cursor; "none")}}', true),
    pbp(83, 'Who is enrolled (page 8)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(82.data.next_cursor; "none")}}', true),
    pbp(84, 'Who is enrolled (page 9)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(83.data.next_cursor; "none")}}', true),
    pbp(85, 'Who is enrolled (page 10)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(84.data.next_cursor; "none")}}', true),
    pbp(86, 'Who is enrolled (page 11)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(85.data.next_cursor; "none")}}', true),
    pbp(87, 'Who is enrolled (page 12)', PROGRAM + '/enrollments?limit=100&cursor={{ifempty(86.data.next_cursor; "none")}}', true),
    code(60, 'The day\'s roster', here('roster.js'), { program: '{{52.result.program}}', why: '{{52.result.why}}', sess_a: '{{toString(53.data)}}', sess_b: '{{toString(54.data)}}',
      e1: '{{55.data}}', e2: '{{56.data}}', e3: '{{57.data}}', e4: '{{58.data}}', e5: '{{80.data}}', e6: '{{81.data}}', e7: '{{82.data}}', e8: '{{83.data}}', e9: '{{84.data}}', e10: '{{85.data}}', e11: '{{86.data}}', e12: '{{87.data}}', date: '{{4.result.night}}', start: '{{4.result.start}}', queries: '{{4.result.queries}}' }),
    { id: 5, module: 'builtin:BasicFeeder', version: 1, parameters: {}, metadata: pos('Each customer to fetch'), mapper: { array: '{{split(60.result.paths; "|")}}' } },
    http(6, 'PlayByPoint customers', { url: 'https://api.playbypoint.com/v1/{{5.value}}', parse: false, headers: bearer('pbp_key', [{ name: 'X-PBP-Facility-Id', value: FACILITY }]) }),
    { id: 7, module: 'util:TextAggregator', version: 1, parameters: { feeder: 5, rowSeparator: '\n' }, metadata: pos('All answers'), mapper: { value: '{{toString(6.data)}}' } },
    code(8, 'Who is who', matchSrc + '\n' + here('pick.js'), { names_json: '{{4.result.names_json}}', pool: '{{7.text}}', extra: '{{var.input.extra}}', roster: '{{60.result.roster}}', prime: '{{60.result.prime}}' }),
    { id: 9, module: 'builtin:BasicFeeder', version: 1, parameters: {}, metadata: pos('Each matched player'), mapper: { array: '{{split(8.result.lookups; "|")}}' } },
    http(10, 'HighLevel: by phone', { url: GHL + '/contacts/search/duplicate?locationId=' + LOCATION + '&number={{encodeURL(get(split(9.value; "~"); 2))}}', parse: false, headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }]) }),
    http(16, 'HighLevel: by email', { url: GHL + '/contacts/search', method: 'post', parse: false, data: '{"locationId":"' + LOCATION + '","pageLimit":5,"query":"{{get(split(9.value; "~"); 3)}}"}',
      headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }, { name: 'Content-Type', value: 'application/json' }]) }),
    http(17, 'HighLevel: by name', { url: GHL + '/contacts/search', method: 'post', parse: false, data: '{"locationId":"' + LOCATION + '","pageLimit":20,"query":"{{get(split(9.value; "~"); 4)}}"}',
      headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }, { name: 'Content-Type', value: 'application/json' }]) }),
    { id: 11, module: 'util:TextAggregator', version: 1, parameters: { feeder: 9, rowSeparator: '\n' }, metadata: pos('All contacts'), mapper: { value: '{"i":"{{get(split(9.value; "~"); 1)}}","a":{{ifempty(toString(10.data); "null")}},"b":{{ifempty(toString(16.data); "null")}},"c":{{ifempty(toString(17.data); "null")}}}' } },
    // players who are in PlayByPoint but not in HighLevel are added there first (card.js as a plan, then the requests)
    code(43, 'Who needs a HighLevel contact', matchSrc + '\n' + here('card.js'), { plan: '1', matched_json: '{{8.result.matched_json}}', skipped_json: '{{8.result.skipped_json}}', ghl: '{{11.text}}', title: '{{4.result.public_name}}',
      club: '{{var.input.club}}', dry: '{{var.input.dry}}', test: '{{var.input.test}}', location: LOCATION }),
    { id: 44, module: 'json:ParseJSON', version: 1, parameters: { type: '' }, metadata: pos('Each contact to add'), mapper: { json: '{{43.result.creates}}' } },
    http(45, 'HighLevel: add the contact', { url: '{{44.u}}', method: 'post', parse: false, data: '{{44.b}}',
      headers: bearer('ghl_pit', [{ name: 'Version', value: '2021-07-28' }, { name: 'Content-Type', value: 'application/json' }]) }),
    { id: 46, module: 'util:TextAggregator', version: 1, parameters: { feeder: 44, rowSeparator: '\n' }, metadata: pos('What HighLevel answered'), mapper: { value: '{"i":"{{44.i}}","r":{{ifempty(toString(45.data); "null")}}}' } },
    code(12, 'The card', matchSrc + '\n' + here('card.js'), { created: '{{46.text}}', location: LOCATION, matched_json: '{{8.result.matched_json}}', skipped_json: '{{8.result.skipped_json}}', ghl: '{{11.text}}', text: '{{4.result.text}}', title: '{{4.result.title}}',
      club: '{{var.input.club}}', nice_date: '{{4.result.nice_date}}', players: '{{4.result.players}}', key: '{{4.result.key}}', dry: '{{var.input.dry}}', test: '{{var.input.test}}', roster_note: '{{60.result.note}}',
      from: '{{if(var.input.club = "tempe"; "' + CFG.from.tempe + '"; "' + CFG.from.lehi + '")}}', seed: '{{uuid}}' }),
    { id: 20, module: 'datastore:GetRecord', version: 1, mapper: { key: '{{4.result.key}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('Already a card for this night?') },
    { id: 13, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Keep it until a button is pressed'),
      filter: { name: 'Not sent already', conditions: [[not('{{20.status}}', 'sent'), not('{{20.status}}', 'sending')]] },
      mapper: { key: '{{4.result.key}}', overwrite: true, data: { status: '{{if(var.input.dry = "1"; "dry"; if(12.result.ok = "yes"; "pending"; "nobody"))}}', token: '{{12.result.token}}', club: '{{var.input.club}}', series: '{{var.input.series}}',
        title: '{{4.result.title}}', night: '{{4.result.night}}', text: '{{4.result.text}}', msg_json: '{{12.result.msg_json}}', from: '{{12.result.from}}', recipients: '{{12.result.recipients_json}}', count: '{{12.result.count}}',
        card: '{{12.result.card_text}}', created: '{{formatDate(now; "YYYY-MM-DD HH:mm"; ' + TZ + ')}}', result: '{{8.result.found}} PlayByPoint customers looked at' } } },
    { id: 19, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('So a button press finds this card'),
      mapper: { key: 'tok-{{12.result.token}}', overwrite: true, data: { status: 'pointer', night: '{{4.result.key}}', created: '{{formatDate(now; "YYYY-MM-DD HH:mm"; ' + TZ + ')}}' } } },
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
    { name: 'test', type: 'text', required: false, description: '1 = a test card: Send texts only the extra person, no player' },
    { name: 'retire', type: 'text', required: false, description: 'Telegram message id of an earlier card to mark as replaced (optional)' }], output: [] },
  flow: [
    secrets(1),
    http(2, 'The social\'s name', { url: DB + '/' + ROOT + '/series/{{encodeURL(var.input.series)}}/name.json', parse: false }),
    http(3, 'Its results', { url: DB + '/' + ROOT + '/results/{{encodeURL(var.input.series)}}.json', parse: false }),
    http(42, 'Its public name, if it has one', { url: DB + '/' + ROOT + '/series/{{encodeURL(var.input.series)}}/share.json', parse: false }),
    http(47, 'The name of its own table, if it has one', { url: DB + '/' + ROOT + '/series/{{encodeURL(var.input.series)}}/table/name.json', parse: false }),
    code(4, 'The night and the text', here('night.js'), { test: '{{var.input.test}}', club: '{{var.input.club}}', series: '{{var.input.series}}', name_raw: '{{toString(2.data)}}', results_raw: '{{toString(3.data)}}', share_raw: '{{toString(42.data)}}', table_raw: '{{toString(47.data)}}',
      today: '{{formatDate(now; "YYYY-MM-DD"; ' + TZ + ')}}', yesterday: '{{formatDate(addDays(now; -1); "YYYY-MM-DD"; ' + TZ + ')}}', hour: '{{formatDate(now; "H"; ' + TZ + ')}}' }),
    { id: 40, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: pos('Is there a night?'), routes: [
      { flow: [{ id: 41, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Note why there is no card'), filter: { name: 'No night to text about', conditions: [[not('{{4.result.ok}}', 'yes')]] },
        mapper: { key: 'last-run-without-a-card', overwrite: true, data: { status: 'nothing', club: '{{var.input.club}}', series: '{{var.input.series}}', created: '{{formatDate(now; "YYYY-MM-DD HH:mm"; ' + TZ + ')}}', result: '{{4.result.reason}}' } } }] },
      { flow: REST }] }
  ] });
at = 5; REST = REST_OF(); at = 0;
const card = cardOf();

// ---------------------------------------------------------------- the buttons
// A press on a card's button goes to the bot's own scenario (Telegram Approvals), whose "rt|" route calls this one's
// webhook with cb (the button's data: rt|s|token to send, rt|k|token to skip), cq (the press, to answer it) and by
// (who pressed). This scenario answers that call at once, so the other one never waits, and then does the work.
at = 0;
const TOKEN = 'get(split(1.cb; "|"); 3)', DO = 'get(split(1.cb; "|"); 2)';
const tg = (id, name, method, query, extra) => http(id, name, Object.assign({ url: 'https://api.telegram.org/bot{{2.telegram_bot_token}}/' + method + '?' + query, method: 'post' }, extra || {}));
const answer = (id, text, alert, filter) => tg(id, 'Answer the press', 'answerCallbackQuery', 'callback_query_id={{encodeURL(1.cq)}}' + (alert ? '&show_alert=true' : '') + '&text={{encodeURL(' + text + ')}}', { filter: filter });
const editSrc = "const head = String(input.head || ''), body = { chat_id: String(input.chat || ''), message_id: Number(input.msg || 0), text: '', disable_web_page_preview: true };\n" +
  "const lines = String(input.lines || '').split('\\n').filter(Boolean), failed = lines.filter(l => l !== 'ok');\n" +
  "const sent = lines.length - failed.length, summary = sent + ' sent' + (failed.length ? ', ' + failed.length + ' failed: ' + failed.map(f => f.replace(/^FAILED /, '')).join(', ') : '');\n" +
  "body.text = (head.replace('__SUMMARY__', summary) + '\\n' + String(input.card || '')).slice(0, 4000);\n" +
  "return { edit: JSON.stringify(body), summary: summary, sent: String(sent) };";
const edit = (id, codeId) => http(id, 'Relabel the card (its buttons go)', { url: 'https://api.telegram.org/bot{{2.telegram_bot_token}}/editMessageText', method: 'post', data: '{{' + codeId + '.result.edit}}', headers: [{ name: 'Content-Type', value: 'application/json' }] });
const marked = id => ' Card relabelled: {{if(' + id + '.data.ok; "yes"; "no, " + ' + id + '.data.description)}}';
const mine = [is('{{3.token}}', '{{' + TOKEN + '}}'), is('{{3.status}}', 'pending'), { a: '{{' + TOKEN + '}}', o: 'exist' }];
const stamp = '{{formatDate(now; "ddd MMM D, h:mm A"; if(3.club = "tempe"; "America/Phoenix"; "America/Denver"))}}';
const who = '{{ifempty(1.by; "someone")}}';
const send = { name: 'Conquer - Socials results text: Send / Skip buttons (Claude)', metadata: meta(true), interface: { input: [], output: [] },
  flow: [
    { id: 1, module: 'gateway:CustomWebHook', version: 1, parameters: { hook: HOOK, maxResults: 1 }, mapper: {}, metadata: pos('A button was pressed') },
    { id: 31, module: 'gateway:WebhookRespond', version: 1, parameters: {}, metadata: pos('Answer the caller at once'), mapper: { status: '200', body: 'ok', headers: [] } },
    secrets(2),
    { id: 32, module: 'datastore:GetRecord', version: 1, mapper: { key: 'tok-{{ifempty(' + TOKEN + '; "none")}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('Which night this button belongs to') },
    { id: 3, module: 'datastore:GetRecord', version: 1, mapper: { key: '{{ifempty(32.night; "none")}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('The card') },
    { id: 4, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: pos('Which button'), routes: [
      { flow: [
        { id: 10, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as being sent (so it cannot go twice)'), mapper: { key: '{{32.night}}', data: { status: 'sending' } },
          filter: { name: 'Send, with the card\'s own token, not handled yet', conditions: [mine.concat([is('{{' + DO + '}}', 's')])] } },
        answer(33, '"Sending to " + 3.count + "..."'),
        { id: 11, module: 'json:ParseJSON', version: 1, parameters: { type: '' }, metadata: pos('Each person'), mapper: { json: '{{3.recipients}}' } },
        http(12, 'Text through HighLevel', { url: GHL + '/conversations/messages', method: 'post', data: '{"type":"SMS","contactId":"{{11.cid}}","message":{{3.msg_json}},"fromNumber":"{{3.from}}"}',
          headers: [{ name: 'Authorization', value: 'Bearer {{2.ghl_pit}}' }, { name: 'Version', value: '2021-04-15' }, { name: 'Accept', value: 'application/json' }, { name: 'Content-Type', value: 'application/json' }] }),
        { id: 13, module: 'util:TextAggregator', version: 1, parameters: { feeder: 11, rowSeparator: '\n' }, metadata: pos('How each one went'), mapper: { value: '{{if(12.statusCode < 300; "ok"; "FAILED " + 11.name)}}' } },
        code(14, 'Count', editSrc, { lines: '{{13.text}}', head: '✅ SENT by ' + who + ', ' + stamp + ' (__SUMMARY__)', card: '{{3.card}}', chat: '{{3.chat}}', msg: '{{3.msg}}' }),
        edit(16, 14),
        { id: 15, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as sent'), mapper: { key: '{{32.night}}', data: { status: 'sent', result: '{{14.result.summary}}, by ' + who + ' on ' + stamp + '.' + marked(16) } } }
      ] },
      { flow: [
        { id: 20, module: 'datastore:UpdateRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Mark as skipped'), mapper: { key: '{{32.night}}', data: { status: 'skipped', result: 'skipped by ' + who + ' on ' + stamp } },
          filter: { name: 'Skip, with the card\'s own token, not handled yet', conditions: [mine.concat([is('{{' + DO + '}}', 'k')])] } },
        answer(34, '"Skipped. No texts were sent."'),
        code(21, 'New card text', editSrc, { lines: '', head: '❌ SKIPPED by ' + who + ', ' + stamp + ' (no texts sent)', card: '{{3.card}}', chat: '{{3.chat}}', msg: '{{3.msg}}' }),
        edit(22, 21)
      ] },
      { flow: [
        answer(35, '"Nothing was sent: this card was already handled (" + ifempty(3.status; "not found") + ")."', true,
          { name: 'Wrong token, or handled already', conditions: [[not('{{3.token}}', '{{' + TOKEN + '}}')], [not('{{3.status}}', 'pending')], [{ a: '{{' + TOKEN + '}}', o: 'notexist' }]] })
      ] }
    ] }
  ] };
// ---------------------------------------------------------------- the watcher
// Runs on a timer. Most runs cost two steps: it reads each club's results and stops unless one of them holds a night
// dated today (or yesterday, before 3am). Otherwise it works out whether a card is due (watch.js) and, if so and no
// card exists for that night yet, starts the card scenario for it.
at = 0;
const ZONE = { l: 'America/Denver', t: 'America/Phoenix' };
const day = (z, back) => '{{formatDate(' + (back ? 'addDays(now; -1)' : 'now') + '; "YYYY-MM-DD"; "' + ZONE[z] + '")}}', hourOf = z => '{{formatDate(now; "H"; "' + ZONE[z] + '")}}';
const dated = (id, z, back) => ({ a: '{{toString(' + id + '.data)}}', b: '"date":"' + day(z, back) + '"', o: 'text:contain' }), early = z => ({ a: hourOf(z), b: '3', o: 'number:less' });
const nowStamp = '{{formatDate(now; "YYYY-MM-DD HH:mm"; "America/Denver")}}';
const watch = { name: 'Conquer - Socials results text: watcher, makes the card when a night is over (Claude)', metadata: meta(false), interface: { input: [], output: [] },
  flow: [
    http(1, 'Lehi results', { url: DB + '/pub/results.json', parse: false }),
    http(2, 'Tempe results', { url: DB + '/tempe/results.json', parse: false }),
    { id: 3, module: 'datastore:GetRecord', version: 1, mapper: { key: 'watch-state', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('What was seen last time'),
      filter: { name: 'A night dated today (or yesterday, before 3am)', conditions: [[dated(1, 'l')], [dated(1, 'l', true), early('l')], [dated(2, 't')], [dated(2, 't', true), early('t')]] } },
    code(4, 'Is a night over?', here('watch.js'), { lehi_raw: '{{toString(1.data)}}', tempe_raw: '{{toString(2.data)}}', state: '{{3.text}}', now_ms: '{{formatDate(now; "x")}}',
      l_today: day('l'), l_yday: day('l', true), l_hour: hourOf('l'), t_today: day('t'), t_yday: day('t', true), t_hour: hourOf('t') }),
    { id: 5, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: pos('What to do'), routes: [
      { flow: [{ id: 10, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Remember what was seen'), filter: { name: 'Something changed', conditions: [[is('{{4.result.changed}}', '1')]] },
        mapper: { key: 'watch-state', overwrite: true, data: { status: 'state', text: '{{4.result.state}}', count: '{{4.result.watching}}', created: nowStamp } } }] },
      { flow: [
        { id: 20, module: 'datastore:GetRecord', version: 1, mapper: { key: '{{4.result.key}}', returnWrapped: false }, parameters: { datastore: STORE }, metadata: pos('Is there a card for this night already?'),
          filter: { name: 'A card is due', conditions: [[is('{{4.result.fire}}', '1')]] } },
        // (Make's own "call a scenario" step: no API key involved; it does not wait for the card to be made)
        { id: 22, module: 'scenario-service:CallSubscenario', version: 2, parameters: { scenario: 'SCN_' + CFG.scenarios.card, shouldWaitForExecutionEnd: false }, metadata: pos('Start the card scenario'),
          filter: { name: 'No card yet', conditions: [[{ a: '{{20.status}}', o: 'notexist' }]] }, mapper: { data: { club: '{{4.result.club}}', series: '{{4.result.series}}' } } },
        { id: 23, module: 'datastore:AddRecord', version: 1, parameters: { datastore: STORE }, metadata: pos('Note that it was started'),
          mapper: { key: 'auto-{{4.result.key}}', overwrite: true, data: { status: 'auto', club: '{{4.result.club}}', series: '{{4.result.series}}', created: nowStamp, result: '{{4.result.why}}; card scenario started' } } }
      ] }
    ] }
  ] };
fs.writeFileSync(PRIVATE + 'results-text-card.blueprint.json', ascii(clean(card)));
fs.writeFileSync(PRIVATE + 'results-text-send.blueprint.json', ascii(clean(send)));
fs.writeFileSync(PRIVATE + 'results-text-watch.blueprint.json', ascii(clean(watch)));
console.log('card', JSON.stringify(clean(card)).length, 'chars; send', JSON.stringify(clean(send)).length, 'chars; watch', JSON.stringify(clean(watch)).length, 'chars');
