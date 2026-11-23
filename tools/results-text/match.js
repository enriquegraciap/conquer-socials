'use strict';
/*
 * Results text: match the names on a night's leaderboard to people in another list (PlayByPoint customers, HighLevel
 * contacts). Runs inside the Make scenario "Socials results text" (put in front of its code steps) and here for tests.
 *
 *   matchPlayers(names, customers) -> { matched: [{ name, customer, how }], skipped: [{ name, why }] }
 *     names       the players' names as typed on the organizer's page
 *     customers   [{ id, name, phone, email }]
 *   nameScore(a, b) -> 0 (not the same person as far as the names say) to 100 (the same name)
 *
 * Names are compared by first name and last name, each allowed to differ the way names do between two lists:
 * another spelling of the same name (Mohamed, Mohammad, Muhammad; Fayoumi, Fayoumy), "Al" or "El" in front or not
 * (Elfayoumy, Fayoumy; Al Johani, Aljohani), a letter or two off, a short form (Alex, Alexander), a middle name or a
 * second last name left out (Damian Alexandru Cucu, Damian Cucu), or the two the other way round. When two different
 * people fit about equally well the player is skipped; the card lists every close match so a person can check it.
 */
var PARTICLES = { al: 1, el: 1, bin: 1, ibn: 1, de: 1, del: 1, la: 1, da: 1, van: 1, von: 1 };
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function norm(s) { return fold(s); }
// the words of a name that count: no "al", "el", "de"... standing alone
function parts(s) {
  var t = fold(s).split(' ').filter(Boolean), out = t.filter(function (w) { return !PARTICLES[w]; });
  return out.length < 2 ? t : out;
}
// "elfayoumy" and "alshihab" without their article
function bare(w) { return w.length >= 6 && (w.slice(0, 2) === 'al' || w.slice(0, 2) === 'el') ? w.slice(2) : w; }
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
// a word without its vowels, h and doubled letters, and with the letters that stand for one sound made the same:
// equal for most spellings of one name (Mohamed and Muhammad, Yousef and Yusuf, Baqer and Bagher, Lopes and Lopez)
function skeleton(w) {
  var rest = w.slice(1).replace(/[aeiouyh]/g, '').replace(/[qgc]/g, 'k').replace(/z/g, 's').replace(/(.)\1+/g, '$1');
  return w[0].replace(/[qgc]/, 'k').replace('z', 's') + rest;
}
function alikeAsWritten(a, b) {
  if (a === b) return 1;
  var short = Math.min(a.length, b.length), d = lev(a, b), n = a.length;
  // Maria and Mario, Francisco and Francisca are two people
  if (n === b.length && n >= 4 && a.slice(0, -1) === b.slice(0, -1) && /[ao]/.test(a[n - 1]) && /[ao]/.test(b[n - 1])) return 0;
  if (short >= 6 && d <= 1) return 0.92;
  if (short >= 6 && d <= 2) return 0.86;
  if (short >= 4 && d <= 2 && skeleton(a) === skeleton(b)) return d <= 1 ? 0.9 : 0.86;
  if (short >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return short >= 4 ? 0.8 : 0.7;      // a short form
  if (short === 1 && a[0] === b[0]) return 0.5;                                                     // an initial
  return 0;
}
// how alike two words of a name are, 0 to 1 (also tried without "al" / "el" in front)
function alike(a, b) {
  if (!a || !b) return 0;
  var s = alikeAsWritten(a, b), a2 = bare(a), b2 = bare(b);
  if (a2 !== a || b2 !== b) s = Math.max(s, 0.97 * alikeAsWritten(a2, b), 0.97 * alikeAsWritten(a, b2), 0.97 * alikeAsWritten(a2, b2));
  return s;
}
function nameScore(a, b) {
  var fa = fold(a), fb = fold(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 100;
  var p = parts(a), c = parts(b);
  if (p.join(' ') === c.join(' ')) return 99;
  if (p.slice().sort().join(' ') === c.slice().sort().join(' ')) return 97;
  if (p.length < 2 || c.length < 2) return 0;
  var best = function (x, list) { return list.reduce(function (m, w) { return Math.max(m, alike(x, w)); }, 0); };
  // first name with first name; last name with any of the other side's later words (two last names, a middle name)
  var first = alike(p[0], c[0]), last = Math.max(best(p[p.length - 1], c.slice(1)), best(c[c.length - 1], p.slice(1)));
  var straight = first >= 0.7 && last >= 0.8 ? first * last : first === 1 && last === 0.5 ? 0.62 : 0;
  // the two the other way round ("Diaz Bruno")
  var f2 = alike(p[0], c[c.length - 1]), l2 = alike(p[p.length - 1], c[0]), turned = f2 >= 0.86 && l2 >= 0.86 ? f2 * l2 * 0.96 : 0;
  // written as one word or two ("Abu Alsamh", "Abualsamh"), a letter or two off over the whole name
  var ja = p.join(''), jb = c.join(''), whole = p.length !== c.length && Math.max(ja.length, jb.length) >= 9 && lev(ja, jb) <= 2 ? 0.78 : 0;
  var s = Math.max(straight, turned, whole);
  return s ? Math.round(60 + 36 * s) : 0;
}
function matchPlayers(names, customers) {
  var cands = (customers || []).filter(function (c) { return c && fold(c.name); });
  var matched = [], skipped = [], used = {};
  var tail = function (p) { return String(p || '').replace(/\D/g, '').slice(-9); };
  (names || []).forEach(function (name) {
    if (parts(name).length < 2) return skipped.push({ name: name, why: 'only one name' });
    var scored = cands.map(function (c) { return { c: c, s: nameScore(name, c.name) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    if (!scored.length) return skipped.push({ name: name, why: 'no customer with a name like that' });
    // the same person can be in the list twice (two accounts): fine when they share a phone, otherwise it must be clear which
    // (a customer with exactly the player's name comes before any that is only like it; accounts without a phone do not make it unclear)
    var top = scored[0].s, near = scored.filter(function (x) { return top >= 99 ? x.s >= 99 : x.s >= top - 6; }), phones = {};
    near.forEach(function (x) { if (tail(x.c.phone)) phones[tail(x.c.phone)] = true; });
    if (Object.keys(phones).length > 1) return skipped.push({ name: name, why: near.length + ' customers with a name like that: ' + near.slice(0, 3).map(function (x) { return x.c.name; }).join(', ') });
    var pick = near.filter(function (x) { return x.c.phone; })[0] || near[0];
    var key = tail(pick.c.phone) || String(pick.c.email || '').toLowerCase() || 'id:' + pick.c.id;
    if (used[key]) return skipped.push({ name: name, why: 'same customer as ' + used[key] });
    used[key] = name;
    matched.push({ name: name, customer: pick.c, how: fold(name) === fold(pick.c.name) ? 'exact' : 'close: ' + pick.c.name, score: pick.s });
  });
  return { matched: matched, skipped: skipped };
}
if (typeof module === 'object' && module.exports) module.exports = { matchPlayers: matchPlayers, nameScore: nameScore, norm: norm, parts: parts };
