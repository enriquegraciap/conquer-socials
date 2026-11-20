'use strict';
/*
 * Local stand-in for testing: serves the app folder and imitates the small part of the Firebase
 * Realtime Database web interface the app uses (read a path, write several paths at once, admin-key rule).
 *   node tools/mock-server.js [port] [adminKey]
 *   app:      http://localhost:8787/
 *   database: http://localhost:8787/db   (open the app with ?db=http://localhost:8787/db)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 8787);
const KEY = process.argv[3] || 'test-key';
const APP = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

let db = {};
let writes = 0;

function getPath(obj, parts) {
  let cur = obj;
  for (const p of parts) { if (cur === null || typeof cur !== 'object') return null; cur = cur[p]; if (cur === undefined) return null; }
  return cur === undefined ? null : cur;
}
// Like the real database: empty values and empty objects are not stored.
function prune(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const p = prune(x); if (p !== undefined) o[i] = p; }); return Object.keys(o).length ? o : undefined; }
  if (typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { const p = prune(v[k]); if (p !== undefined) o[k] = p; }); return Object.keys(o).length ? o : undefined; }
  return v;
}
function setPath(obj, parts, value) {
  if (!parts.length) return;
  let cur = obj; const stack = [];
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    stack.push([cur, parts[i]]); cur = cur[parts[i]];
  }
  const v = prune(value);
  if (v === undefined) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = v;
  for (let i = stack.length - 1; i >= 0; i--) { const [o, k] = stack[i]; if (o[k] && typeof o[k] === 'object' && !Object.keys(o[k]).length) delete o[k]; }
}
// Objects whose keys are 0..n-1 come back as lists, as the real database does.
function arrays(v) {
  if (v === null || typeof v !== 'object') return v;
  const keys = Object.keys(v);
  const out = {};
  keys.forEach(k => { out[k] = arrays(v[k]); });
  if (keys.length && keys.every(k => /^\d+$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    if (keys.length * 2 > max) { const a = []; for (let i = 0; i <= max; i++) a.push(out[i] === undefined ? null : out[i]); return a; }
  }
  return out;
}

function send(res, status, body, type) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, PATCH, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-cache' });
  res.end(text);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__reset') { db = {}; writes = 0; return send(res, 200, { ok: true }); }
  if (u.pathname === '/__dump') return send(res, 200, { writes, db });
  if (u.pathname.startsWith('/db/') || u.pathname === '/db/.json') {
    if (req.method === 'OPTIONS') return send(res, 200, '');
    if (!u.pathname.endsWith('.json')) return send(res, 404, { error: 'append .json' });
    const parts = u.pathname.slice(4, -5).split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method === 'GET') {
      if (parts[0] !== 'pub') return send(res, 401, { error: 'Permission denied' });
      return send(res, 200, JSON.stringify(arrays(getPath(db, parts))));
    }
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'Invalid data; couldn\'t parse JSON object.' }); }
      const updates = req.method === 'PATCH' ? Object.keys(body).map(k => [parts.concat(k.split('/').filter(Boolean)), body[k]]) : [[parts, body]];
      const gateBefore = getPath(db, ['gate', KEY]);
      const gateWrite = updates.filter(([p]) => p[0] === 'gate');
      const okGate = gateWrite.length === 1 && gateWrite[0][0].length === 2 && gateWrite[0][0][1] === KEY && gateWrite[0][1] !== gateBefore;
      if (updates.some(([p]) => p[0] !== 'pub' && p[0] !== 'gate') || gateWrite.some(([p]) => p[1] !== KEY) || !okGate) {
        return send(res, 401, { error: 'Permission denied' });
      }
      updates.forEach(([p, v]) => setPath(db, p, v));
      writes++;
      send(res, 200, body);
    });
    return;
  }
  // static files
  let file = decodeURIComponent(u.pathname);
  if (file.endsWith('/')) file += 'index.html';
  const full = path.join(APP, file);
  if (!full.startsWith(APP)) return send(res, 403, 'no', 'text/plain');
  fs.readFile(full, (err, data) => {
    if (err) {
      if (!path.extname(full)) { res.writeHead(302, { Location: u.pathname + '/' + u.search }); return res.end(); }
      return send(res, 404, 'Not found', 'text/plain');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log('mock server on http://localhost:' + PORT + '  admin key: ' + KEY));
