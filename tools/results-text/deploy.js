'use strict';
/*
 * Puts a built blueprint (private/…blueprint.json) into its Make scenario, through the club's blueprint patcher:
 *   node tools/results-text/deploy.js card|send|watch [dry]
 * It hands the patcher its job and code (the new flow travels inside the code, byte for byte, so nothing is retyped).
 * The patcher scenario itself is then run from the Make side; it writes what happened to patch_result / patch_resp.
 * Ids and the uploader's address and secret are read from private/results-text.json (not in this public repository).
 */
const fs = require('fs');
const PRIVATE = __dirname + '/../../private/', CFG = JSON.parse(fs.readFileSync(PRIVATE + 'results-text.json', 'utf8'));
const which = process.argv[2], mode = process.argv[3] === 'dry' ? 'dry' : 'apply', id = CFG.scenarios[which];
if (!id) { console.error('which one? card, send or watch'); process.exit(1); }
const bp = JSON.parse(fs.readFileSync(PRIVATE + 'results-text-' + which + '.blueprint.json', 'utf8'));
const dj = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
const flow = JSON.stringify(bp.flow), b64 = Buffer.from(flow, 'utf8').toString('base64');
const code = [
  'const B64 = "' + b64 + '";',
  'const flowText = Buffer.from(B64, "base64").toString("utf8");',
  'const dj = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; } return h; };',
  'if (dj(flowText) !== ' + dj(flow) + ') return { ok: false, log: "checksum mismatch " + dj(flowText), dump: "" };',
  'const raw = input.bp_text && input.bp_text.type === "Buffer" && input.bp_text.data ? Buffer.from(input.bp_text.data).toString("utf8") : String(input.bp_text);',
  'const j = JSON.parse(raw); const bp = j.response.blueprint; const before = JSON.stringify(bp.flow).length;',
  'if (String(bp.name) !== ' + JSON.stringify(bp.name) + ') return { ok: false, log: "this is not the scenario the flow was built for: " + bp.name, dump: "" };',
  'bp.flow = JSON.parse(flowText);',
  'return { ok: true, patch_body: JSON.stringify({ blueprint: JSON.stringify(bp) }), log: "flow replaced | before " + before + " chars, now " + flowText.length + " | checksum " + dj(flowText), dump: "" };'
].join('\n');
const send = (key, body) => fetch(CFG.uploader.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: CFG.uploader.secret, key: key, body: body }) }).then(r => r.text());
(async () => {
  console.log('code:', await send('patch_code', code), '(sent ' + code.length + ')');
  console.log('job: ', await send('patch_job', id + '|' + mode));
  console.log('now run the patcher scenario; expect "flow replaced" and checksum', dj(flow));
})().catch(e => { console.error(e); process.exit(1); });
