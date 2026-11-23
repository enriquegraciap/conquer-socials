'use strict';
/*
 * Results text: match the names on a night's leaderboard to the club's PlayByPoint customers.
 * Runs inside the Make scenario "Socials results text" (pasted into its code module) and here for the tests.
 *
 *   matchPlayers(names, customers) -> { matched: [{ name, customer, how }], skipped: [{ name, why }] }
 *     names       the players' names as typed on the organizer's page
 *     customers   [{ id, name, phone }] candidates (the session's sign-up list when there is one, else all customers)
 * A player is matched when exactly one customer has the same name, or one that is close enough: the same words
 * in another order or with a middle name left out, a typed first name plus last initial, or one or two letters'
 * difference in a long enough name. Two possible customers, or none, means the player is skipped.
 */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (a === b) return 0;
  var prev = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    var cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// 0 = not the same person as far as the names say; higher = closer
function score(p, c) {
  if (!p || !c) return 0;
  if (p === c) return 100;
  var pt = p.split(' '), ct = c.split(' ');
  if (pt.slice().sort().join(' ') === ct.slice().sort().join(' ')) return 95;                     // same words, other order
  var small = pt.length <= ct.length ? pt : ct, big = pt.length <= ct.length ? ct : pt;
  if (small.length >= 2 && small.every(function (w) { return big.indexOf(w) >= 0; }) && small[0] === big[0]) return 90;   // a middle or second last name left out
  if (pt.length >= 2 && ct.length >= 2 && pt[0] === ct[0]) {
    var pl = pt[pt.length - 1], cl = ct[ct.length - 1];
    if ((pl.length === 1 && cl[0] === pl) || (cl.length === 1 && pl[0] === cl)) return 70;        // "Carla R" for "Carla Ruiz"
    if (pl.length >= 5 && cl.length >= 5 && lev(pl, cl) <= 2) return 80;                         // a slip in the last name
  }
  if (pt.length >= 2 && ct.length >= 2 && pt[pt.length - 1] === ct[ct.length - 1] && pt[0].length >= 4 && ct[0].length >= 4 && lev(pt[0], ct[0]) <= 1) return 80;   // a slip in the first name
  var d = lev(p.replace(/ /g, ''), c.replace(/ /g, '')), len = Math.max(p.length, c.length);
  if (len >= 9 && d <= 2 && pt.length >= 2 && ct.length >= 2) return 75;                           // one or two letters out in the whole name, spacing aside
  return 0;
}
function matchPlayers(names, customers) {
  var cands = (customers || []).map(function (c) { return { c: c, n: norm(c.name) }; }).filter(function (x) { return x.n; });
  var matched = [], skipped = [], used = {};
  (names || []).forEach(function (name) {
    var p = norm(name), scored = cands.map(function (x) { return { c: x.c, s: score(p, x.n) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    if (p.split(' ').length < 2) return skipped.push({ name: name, why: 'only one name' });
    if (!scored.length) return skipped.push({ name: name, why: 'no customer with that name' });
    // the same person can be in the list twice (two accounts): fine when they share a phone, otherwise it must be clear which
    var top = scored.filter(function (x) { return x.s === scored[0].s; }), phones = {};
    top.forEach(function (x) { phones[String(x.c.phone || '').replace(/\D/g, '').slice(-10)] = true; });
    if (Object.keys(phones).length > 1) return skipped.push({ name: name, why: top.length + ' customers with that name' });
    var pick = top.filter(function (x) { return x.c.phone; })[0] || top[0];
    if (!pick.c.phone) return skipped.push({ name: name, why: 'no phone number on file' });
    var key = String(pick.c.phone).replace(/\D/g, '').slice(-10);
    if (used[key]) return skipped.push({ name: name, why: 'same phone as ' + used[key] });
    used[key] = name;
    matched.push({ name: name, customer: pick.c, how: pick.s === 100 ? 'exact' : 'close: ' + pick.c.name });
  });
  return { matched: matched, skipped: skipped };
}
if (typeof module === 'object' && module.exports) module.exports = { matchPlayers: matchPlayers, norm: norm, score: score };
