/*
 * Padel Socials — rotation + scoring engine.
 * Pure functions, no browser or network code, so it runs the same on the iPad and in the tests.
 *
 * Vocabulary
 *   level     index into session.courts (0 = bottom court, last = King's Court)
 *   round     { n, courts:[{court, level, a, b, sa, sb, w, void}], sitting:[teamId], entry:{teamId:level} }
 *   returner  a team that did not play the previous round (sat out, or just arrived)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Rules you might want to change -------------------------------------------------------
  var RULES = {
    // A team that LOST and then sat out comes back on the court it left (true) or one lower (false).
    returnerLoserHoldsCourt: true,
    // Where a team that arrives after the night has started first plays: 'bottom' or 'middle'.
    lateArrivalEntry: 'bottom'
  };

  // ---- Small helpers ------------------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function hashSeed() {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i]);
      for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 16777619) >>> 0; }
      h ^= 124; h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function makeRng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function randomId(prefix) {
    return (prefix || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }
  function toArray(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return x !== null && x !== undefined; });
    if (v && typeof v === 'object') {
      return Object.keys(v).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return v[k]; });
    }
    return [];
  }
  function cleanName(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function keyOf(s) {
    var k = cleanName(s).toLowerCase().replace(/[^a-z0-9À-￿]+/g, '_').replace(/^_+|_+$/g, '');
    return 'k_' + (k || 'x');
  }

  // ---- Session shape ------------------------------------------------------------------------
  function newSession(opts) {
    opts = opts || {};
    var date = opts.date || localDate(new Date());
    return {
      id: opts.id || (date + '-' + randomId()),
      seriesId: opts.seriesId || 'default',
      seriesName: opts.seriesName || '',
      format: opts.format || 'kings-fixed',
      scoring: opts.scoring || 'team',          // 'team' = points belong to the couple, 'player' = to each player
      date: date,
      month: date.slice(0, 7),
      status: 'setup',                           // setup -> live -> ended
      courts: (opts.courts || []).slice(),       // bottom -> top; the last one is King's Court
      round1: opts.round1 || 'random',           // 'random' or 'seeded' (seeded = team list order)
      seed: opts.seed || Math.floor(Math.random() * 1e9),
      teams: {},
      rounds: []
    };
  }
  function localDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // The database drops empty lists and empty values; put them back so the rest of the code can rely on them.
  function normalize(s) {
    if (!s || typeof s !== 'object') return null;
    s.status = s.status || 'setup';
    s.format = s.format || 'kings-fixed';
    s.scoring = s.scoring || 'team';
    s.round1 = s.round1 || 'random';
    s.courts = toArray(s.courts);
    s.teams = s.teams && typeof s.teams === 'object' ? s.teams : {};
    Object.keys(s.teams).forEach(function (id) {
      var t = s.teams[id];
      t.id = id;
      t.players = toArray(t.players);
      t.name = t.name || t.players.join(' & ');
      t.order = t.order || 0;
      t.joined = t.joined || 0;
      t.left = t.left || null;
      t.sitCredit = t.sitCredit || 0;
    });
    s.rounds = toArray(s.rounds);
    s.rounds.forEach(function (r) {
      r.courts = toArray(r.courts);
      r.sitting = toArray(r.sitting);
      r.entry = r.entry || {};
      r.redraw = r.redraw || 0;
      r.courts.forEach(function (c) {
        c.sa = c.sa === undefined ? null : c.sa;
        c.sb = c.sb === undefined ? null : c.sb;
        c.w = c.w || null;
        c.void = !!c.void;
      });
    });
    return s;
  }

  function teamList(session) {
    return Object.keys(session.teams).map(function (id) { return session.teams[id]; })
      .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
  }
  function activeTeams(session) { return teamList(session).filter(function (t) { return !t.left; }); }
  function currentRound(session) { return session.rounds.length ? session.rounds[session.rounds.length - 1] : null; }
  function courtDone(c) { return c.void || !!c.w; }
  function roundComplete(r) { return !!r && r.courts.length > 0 && r.courts.every(courtDone); }
  function roundHasScores(r) { return !!r && r.courts.some(function (c) { return !c.void && (c.w || c.sa !== null || c.sb !== null); }); }

  // ---- Stats by replaying the rounds --------------------------------------------------------
  function teamStats(session, upto) {
    var st = {};
    Object.keys(session.teams).forEach(function (id) {
      st[id] = { points: 0, against: 0, wins: 0, losses: 0, played: 0, sitOuts: session.teams[id].sitCredit || 0,
        satOut: 0, lastSat: 0, lastPlayed: null };
    });
    session.rounds.forEach(function (r) {
      if (upto !== undefined && upto !== null && r.n > upto) return;
      r.sitting.forEach(function (id) {
        if (!st[id]) return;
        st[id].sitOuts++; st[id].satOut++; st[id].lastSat = r.n;
      });
      r.courts.forEach(function (c) {
        if (c.void) { // opponent left mid-round: the remaining team keeps its place as if it had won, no points
          var stay = c.w === 'a' ? c.a : c.b;
          if (st[stay]) st[stay].lastPlayed = { n: r.n, level: c.level, won: true };
          return;
        }
        if (!c.w) return;
        var A = st[c.a], B = st[c.b], sa = c.sa || 0, sb = c.sb || 0;
        if (A) { A.points += sa; A.against += sb; A.played++; if (c.w === 'a') A.wins++; else A.losses++;
          A.lastPlayed = { n: r.n, level: c.level, won: c.w === 'a' }; }
        if (B) { B.points += sb; B.against += sa; B.played++; if (c.w === 'b') B.wins++; else B.losses++;
          B.lastPlayed = { n: r.n, level: c.level, won: c.w === 'b' }; }
      });
    });
    return st;
  }

  // ---- Round generation: King's Court, fixed partners, with sit-outs ------------------------
  function generateRound(session, n, redraw) {
    redraw = redraw || 0;
    var C = session.courts.length;
    var teams = activeTeams(session);
    var N = teams.length;
    var k = Math.min(C, Math.floor(N / 2));       // courts in use (the top k, so King's Court is always played)
    var top = C - 1, L0 = C - k;
    var S = N - 2 * k;                            // teams sitting out this round
    var rng = makeRng(hashSeed(session.seed, n, redraw));
    var round = { n: n, courts: [], sitting: [], entry: {}, redraw: redraw };
    if (k === 0) { round.sitting = teams.map(function (t) { return t.id; }); return round; }

    var slots = {}, l;
    for (l = L0; l <= top; l++) slots[l] = [];

    if (n === 1) {
      var order = session.round1 === 'seeded' ? teams.slice() : shuffle(teams, rng);
      var sitIds = {};
      shuffle(order, rng).slice(0, S).forEach(function (t) { sitIds[t.id] = true; });
      var playing = [], si = 0;
      order.forEach(function (t) {
        if (sitIds[t.id]) {
          round.sitting.push(t.id);
          // where this team comes in for round 2: spread the round-1 sitters over the courts, best seed highest
          round.entry[t.id] = clamp(top - Math.floor(si * k / S), L0, top);
          si++;
        } else playing.push(t.id);
      });
      for (var i = 0; i < k; i++) slots[top - i] = [playing[2 * i], playing[2 * i + 1]];
    } else {
      var st = teamStats(session, n - 1);
      var r1 = session.rounds[0];
      var entryMap = (r1 && r1.entry) || {};
      var lateLevel = RULES.lateArrivalEntry === 'middle' ? L0 + Math.floor((top - L0) / 2) : L0;
      var info = teams.map(function (t) {
        var s = st[t.id], lp = s.lastPlayed, playedPrev = !!lp && lp.n === n - 1;
        var x = {
          id: t.id, playedPrev: playedPrev, won: lp ? (lp.won ? 1 : 0) : 0,
          prevL: lp ? clamp(lp.level, L0, top) : -1,
          wins: s.wins, points: s.points, sit: s.sitOuts,
          // a team that has just arrived is treated as if it sat last round, so it plays before it sits
          lastSat: (!lp && !s.satOut) ? n - 1 : s.lastSat,
          tb: rng()
        };
        if (playedPrev) {                               // normal move: winners up, losers down
          x.target = clamp(x.prevL + (x.won ? 1 : -1), L0, top);
          x.floor = L0;
          // where this team would come back in if it sits this round
          x.retTarget = clamp(x.prevL + (x.won ? 1 : (RULES.returnerLoserHoldsCourt ? 0 : -1)), L0, top);
        } else if (lp) {                                // coming back from a sit-out
          x.target = clamp(x.prevL + (x.won ? 1 : (RULES.returnerLoserHoldsCourt ? 0 : -1)), L0, top);
          x.floor = RULES.returnerLoserHoldsCourt ? Math.min(x.prevL, x.target) : x.target;
          if (x.won) x.floor = x.prevL;
        } else {                                        // has not played yet tonight
          x.target = clamp(entryMap[t.id] !== undefined ? entryMap[t.id] : lateLevel, L0, top);
          x.floor = x.target;
        }
        x.tier = x.lastSat >= n - 1 ? 2 : (x.lastSat === n - 2 ? 1 : 0);
        return x;
      });

      // 1) Who sits: fewest sit-outs first; among those, teams that have played at least two rounds since
      //    their last sit-out; among those, the teams whose courts the returning teams are about to take.
      var sitters = chooseSitters(info, S, top);
      var sitSet = {}; sitters.forEach(function (x) { sitSet[x.id] = true; });
      round.sitting = teams.filter(function (t) { return sitSet[t.id]; }).map(function (t) { return t.id; });

      // 2) Place everyone else. Each team has a court it should get; when two teams want the same place the
      //    order of protection is: returning teams (never below the court they left), then winners (never
      //    down), and losers take whatever squeeze is left.
      var playingInfo = info.filter(function (x) { return !sitSet[x.id]; });
      var levels = [];
      for (l = top; l >= L0; l--) { levels.push(l); levels.push(l); }
      var cost = playingInfo.map(function (x) { return levels.map(function (lv) { return placeCost(x, lv); }); });
      var assigned = hungarian(cost);
      playingInfo.forEach(function (x, i) { slots[levels[assigned[i]]].push(x); });
      for (l = L0; l <= top; l++) {
        slots[l].sort(function (x, y) { return y.wins - x.wins || y.points - x.points || x.tb - y.tb; });
        slots[l] = slots[l].map(function (x) { return x.id; });
      }
    }

    for (l = top; l >= L0; l--) {
      round.courts.push({ court: session.courts[l], level: l, a: slots[l][0], b: slots[l][1], sa: null, sb: null, w: null, void: false });
    }
    return round;
  }

  // ---- Placement helpers --------------------------------------------------------------------
  // How bad is it to put team x on court level lv? Lower is better; 0 is the normal move.
  function placeCost(x, lv) {
    var c = 0;
    if (!x.playedPrev) {                                 // returning from a sit-out, or new tonight
      // below the court it left: only ever happens to a team that lost before sitting, and only when the
      // alternative is moving a team that has just won down a court
      if (lv < x.floor) c += (x.won ? 10000 : 1500) * (x.floor - lv);
      else if (lv < x.target) c += 60 * (x.target - lv); //   did not get the move up it had earned
      else c += 20 * (lv - x.target);
    } else if (x.won) {
      if (lv < x.prevL) c += 2000 * (x.prevL - lv);      //   a winner moving down
      else if (lv < x.target) c += 40;                   //   a winner staying put
      else c += 20 * (lv - x.target);                    //   a winner jumping two courts
    } else {
      if (lv > x.prevL) c += 500 * (lv - x.prevL);       //   a loser moving up
      else if (lv === x.prevL && x.target < x.prevL) c += 15;   // a loser staying put
      else if (lv < x.target) c += 25 + 90 * (x.target - lv - 1); // a loser dropping two courts (three is far worse)
    }
    return c - lv * (0.001 * (1 + x.wins) + 0.0001 * x.tb);    // all else equal, more wins = higher court
  }

  // Smallest total distance when pairing two sorted lists of court levels (extras in the longer list are free).
  function matchCost(a, b) {
    var A = a.length <= b.length ? a : b, B = a.length <= b.length ? b : a;
    var prev = [], i, j;
    for (j = 0; j <= B.length; j++) prev.push(0);
    for (i = 1; i <= A.length; i++) {
      var cur = [];
      for (j = 0; j <= B.length; j++) {
        if (j < i) { cur.push(Infinity); continue; }
        cur.push(Math.min(cur[j - 1], prev[j - 1] + Math.abs(A[i - 1] - B[j - 1])));
      }
      prev = cur;
    }
    return A.length ? prev[B.length] : 0;
  }

  function chooseSitters(info, S, top) {
    if (S <= 0) return [];
    var sorted = info.slice().sort(function (x, y) { return x.sit - y.sit || x.tier - y.tier || x.tb - y.tb; });
    var chosen = [], idx = 0;
    while (chosen.length < S) {
      var first = sorted[idx], group = [];
      while (idx < sorted.length && sorted[idx].sit === first.sit && sorted[idx].tier === first.tier) group.push(sorted[idx++]);
      if (chosen.length + group.length <= S) { chosen = chosen.concat(group); continue; }
      chosen = chosen.concat(pickFromGroup(info, chosen, group, S - chosen.length, top));
    }
    return chosen;
  }

  function sitCost(info, sitters, top) {
    var sitting = {}; sitters.forEach(function (x) { sitting[x.id] = true; });
    var asc = function (p, q) { return p - q; };
    // courts being vacated now vs courts the returning teams are entitled to
    var holes = sitters.filter(function (x) { return x.playedPrev; }).map(function (x) { return x.target; }).sort(asc);
    var wants = info.filter(function (x) { return !x.playedPrev && !sitting[x.id]; }).map(function (x) { return x.target; }).sort(asc);
    var c = 2 * matchCost(holes, wants);
    // next round these sitters come back: avoid sitting both teams of one court together (they would both
    // be owed that court, worst of all on King's Court), and avoid several coming back to the same court
    var sameCourt = {}, back = {};
    sitters.forEach(function (x) {
      if (!x.playedPrev) return;
      sameCourt[x.prevL] = (sameCourt[x.prevL] || 0) + 1;
      back[x.retTarget] = (back[x.retTarget] || 0) + 1;
    });
    Object.keys(sameCourt).forEach(function (lv) { if (sameCourt[lv] >= 2) c += Number(lv) === top ? 40 : 3; });
    Object.keys(back).forEach(function (lv) { if (back[lv] >= 2) c += 1 + 3 * (back[lv] - 2); });
    sitters.forEach(function (x) { c += x.tb * 0.001; });
    return c;
  }

  function pickFromGroup(info, fixed, group, need, top) {
    var combos = 1, i;
    for (i = 0; i < need; i++) combos = combos * (group.length - i) / (i + 1);
    var best = null, bestCost = Infinity;
    if (combos <= 20000) {                               // small enough to try every choice
      var pick = [];
      var rec = function (start) {
        if (pick.length === need) {
          var c = sitCost(info, fixed.concat(pick), top);
          if (c < bestCost) { bestCost = c; best = pick.slice(); }
          return;
        }
        for (var j = start; j <= group.length - (need - pick.length); j++) { pick.push(group[j]); rec(j + 1); pick.pop(); }
      };
      rec(0);
      return best;
    }
    best = [];                                           // very large nights: add one team at a time
    var left = group.slice();
    while (best.length < need) {
      var bi = 0; bestCost = Infinity;
      for (i = 0; i < left.length; i++) {
        var cc = sitCost(info, fixed.concat(best, [left[i]]), top);
        if (cc < bestCost) { bestCost = cc; bi = i; }
      }
      best.push(left.splice(bi, 1)[0]);
    }
    return best;
  }

  // Minimum-cost assignment of rows to columns (Hungarian method). cost[i][j], rows <= columns.
  function hungarian(cost) {
    var n = cost.length, m = n ? cost[0].length : 0, i, j;
    var u = [], v = [], p = [], way = [];
    for (j = 0; j <= m; j++) { v.push(0); p.push(0); way.push(0); }
    for (i = 0; i <= n; i++) u.push(0);
    for (i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0, minv = [], used = [];
      for (j = 0; j <= m; j++) { minv.push(Infinity); used.push(false); }
      do {
        used[j0] = true;
        var i0 = p[j0], delta = Infinity, j1 = 0;
        for (j = 1; j <= m; j++) {
          if (used[j]) continue;
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jp = way[j0]; p[j0] = p[jp]; j0 = jp; } while (j0);
    }
    var res = [];
    for (j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  // ---- Night actions (each one changes the session object in place) -------------------------
  function teamName(players) { return players.map(cleanName).filter(Boolean).join(' & '); }

  function addTeam(session, players) {
    players = (Array.isArray(players) ? players : [players]).map(cleanName).filter(Boolean);
    if (!players.length) return null;
    var name = teamName(players);
    var key = entityKey(players);
    var existing = teamList(session).filter(function (t) { return entityKey(t.players) === key; })[0];
    if (existing) {
      if (existing.left) { existing.left = null; return existing; }   // a team that left and came back
      return null;
    }
    var id = randomId('t');
    var maxOrder = teamList(session).reduce(function (m, t) { return Math.max(m, t.order); }, 0);
    var team = { id: id, name: name, players: players, order: maxOrder + 1, joined: session.rounds.length, left: null, sitCredit: 0 };
    if (session.rounds.length) { // arriving mid-night: start level with everyone else's sit-outs
      var st = teamStats(session), act = activeTeams(session);
      if (act.length) team.sitCredit = Math.round(act.reduce(function (sum, t) { return sum + st[t.id].sitOuts; }, 0) / act.length);
    }
    session.teams[id] = team;
    return team;
  }

  function removeTeam(session, id) {
    var t = session.teams[id];
    if (!t) return { removed: false };
    if (session.status === 'setup' || !session.rounds.length) { delete session.teams[id]; return { removed: true }; }
    var cur = currentRound(session), out = { removed: true };
    t.left = cur.n;
    var si = cur.sitting.indexOf(id);
    if (si >= 0) cur.sitting.splice(si, 1);
    cur.courts.forEach(function (c) {
      if (courtDone(c) || (c.a !== id && c.b !== id)) return;
      var side = c.a === id ? 'a' : 'b';
      if (cur.sitting.length) { // a team that was sitting out takes the place
        var st = teamStats(session);
        var sub = cur.sitting.slice().sort(function (x, y) { return st[y].sitOuts - st[x].sitOuts; })[0];
        cur.sitting.splice(cur.sitting.indexOf(sub), 1);
        c[side] = sub; c.sa = null; c.sb = null;
        out.substitute = sub; out.court = c.court;
      } else {                  // nobody to step in: the other team keeps its place
        c.void = true; c.w = side === 'a' ? 'b' : 'a'; c.sa = null; c.sb = null;
        out.voided = c.court;
      }
    });
    out.advanced = advance(session);
    return out;
  }

  function startNight(session) {
    if (session.status !== 'setup') return false;
    session.status = 'live';
    session.rounds = [];
    advance(session);
    return true;
  }
  function endNight(session) {
    var cur = currentRound(session);
    if (cur && !roundHasScores(cur)) session.rounds.pop();   // a round nobody played does not count
    session.status = 'ended';
  }
  function reopenNight(session) { if (session.status === 'ended') { session.status = 'live'; advance(session); } }

  // Create round 1, or the next round once every court of the current round has a result.
  function advance(session) {
    if (session.status !== 'live') return false;
    var cur = currentRound(session);
    if (cur && !roundComplete(cur)) return false;
    if (activeTeams(session).length < 2 || !session.courts.length) return false;
    session.rounds.push(generateRound(session, cur ? cur.n + 1 : 1, 0));
    return true;
  }

  function redrawRound(session) {
    var cur = currentRound(session);
    if (!cur || roundHasScores(cur)) return false;
    session.rounds[session.rounds.length - 1] = generateRound(session, cur.n, (cur.redraw || 0) + 1);
    return true;
  }

  // Enter or correct a score. winner ('a' or 'b') is only needed when the games are level.
  function setScore(session, roundNo, courtIdx, sa, sb, winner) {
    var r = session.rounds[roundNo - 1];
    if (!r) return { ok: false, error: 'No such round' };
    var c = r.courts[courtIdx];
    if (!c || c.void) return { ok: false, error: 'No such court' };
    var oldW = c.w;
    if (sa === null || sb === null || sa === undefined || sb === undefined) { c.sa = null; c.sb = null; c.w = null; }
    else {
      sa = Number(sa); sb = Number(sb);
      var w = sa > sb ? 'a' : sb > sa ? 'b' : (winner === 'a' || winner === 'b' ? winner : null);
      if (!w) return { ok: false, error: 'Level score: choose which team moves up' };
      c.sa = sa; c.sb = sb; c.w = w;
    }
    var out = { ok: true, regenerated: false, advanced: false, tooLate: false };
    var last = currentRound(session);
    if (session.status === 'live' && roundNo < last.n && oldW !== c.w) {
      if (roundNo === last.n - 1 && !roundHasScores(last)) {
        // the winner of the previous round changed and nobody has played the new round yet: redo it
        session.rounds.pop();
        if (roundComplete(r)) { session.rounds.push(generateRound(session, last.n, last.redraw || 0)); out.regenerated = true; }
      } else out.tooLate = true;   // points are corrected, court positions stay as played
    }
    out.advanced = advance(session);
    return out;
  }

  // ---- Scoring ------------------------------------------------------------------------------
  // Who gets the points for a team: the couple as one entry, or each player on their own.
  function entityKey(players) {
    return keyOf(players.map(function (p) { return cleanName(p).toLowerCase(); }).sort().join(' + '));
  }
  function scoringEntities(team, scoring) {
    if (scoring === 'player') return team.players.map(function (p) { return { key: keyOf(p), name: cleanName(p), players: [cleanName(p)] }; });
    return [{ key: entityKey(team.players), name: team.name, players: team.players.slice() }];
  }
  function rankRows(rows) {
    rows.sort(function (x, y) {
      return y.points - x.points || y.wins - x.wins || (y.diff || 0) - (x.diff || 0) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
    });
    rows.forEach(function (r, i) { r.rank = i > 0 && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1; });
    return rows;
  }
  function leaderboard(session) {
    var st = teamStats(session), rows = {};
    teamList(session).forEach(function (t) {
      var s = st[t.id];
      if (t.left && !s.played) return;
      scoringEntities(t, session.scoring).forEach(function (e) {
        var r = rows[e.key] || (rows[e.key] = { key: e.key, name: e.name, players: e.players, points: 0, wins: 0, played: 0, diff: 0, sitOuts: 0 });
        r.points += s.points; r.wins += s.wins; r.played += s.played; r.diff += s.points - s.against; r.sitOuts += s.satOut;
      });
    });
    return rankRows(Object.keys(rows).map(function (k) { return rows[k]; }));
  }
  // The small record saved for every night; the monthly table is the sum of these.
  function resultsDoc(session) {
    var entries = {};
    leaderboard(session).forEach(function (r) {
      if (r.played) entries[r.key] = { name: r.name, players: r.players, points: r.points, wins: r.wins, played: r.played };
    });
    return {
      date: session.date, status: session.status, scoring: session.scoring, format: session.format,
      rounds: session.rounds.filter(roundComplete).length, entries: entries
    };
  }
  function monthlyBoard(resultsBySession) {
    var rows = {};
    Object.keys(resultsBySession || {}).sort(function (a, b) {
      var da = (resultsBySession[a] || {}).date || a, db = (resultsBySession[b] || {}).date || b;
      return da < db ? -1 : da > db ? 1 : 0;
    }).forEach(function (sid) {
      var doc = resultsBySession[sid];
      if (!doc || !doc.entries) return;
      Object.keys(doc.entries).forEach(function (key) {
        var e = doc.entries[key];
        var r = rows[key] || (rows[key] = { key: key, name: e.name, players: e.players, points: 0, wins: 0, played: 0, nights: 0 });
        r.name = e.name || r.name; r.players = e.players || r.players;
        r.points += e.points || 0; r.wins += e.wins || 0; r.played += e.played || 0; r.nights++;
      });
    });
    return rankRows(Object.keys(rows).map(function (k) { return rows[k]; }));
  }

  // ---- Turning "before" and "after" into the smallest set of database writes -----------------
  function isObj(v) { return v !== null && typeof v === 'object'; }
  function diffPaths(a, b, prefix, out) {
    out = out || {};
    prefix = prefix || '';          // '' means "the whole thing" (used when nothing is saved yet)
    if (isObj(a) && isObj(b)) {
      var keys = {};
      Object.keys(a).forEach(function (k) { keys[k] = 1; });
      Object.keys(b).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) { diffPaths(a[k], b[k], prefix ? prefix + '/' + k : k, out); });
      return out;
    }
    var na = a === undefined ? null : a, nb = b === undefined ? null : b;
    if (isObj(nb) && !Object.keys(nb).length) nb = null;       // the database stores nothing for empty lists
    if (isObj(na) && !Object.keys(na).length) na = null;
    if (JSON.stringify(na) !== JSON.stringify(nb)) out[prefix] = nb;
    return out;
  }

  return {
    RULES: RULES,
    newSession: newSession, normalize: normalize, localDate: localDate, clone: clone, randomId: randomId,
    teamList: teamList, activeTeams: activeTeams, currentRound: currentRound,
    roundComplete: roundComplete, roundHasScores: roundHasScores, courtDone: courtDone,
    teamStats: teamStats, generateRound: generateRound,
    addTeam: addTeam, removeTeam: removeTeam, startNight: startNight, endNight: endNight, reopenNight: reopenNight,
    advance: advance, redrawRound: redrawRound, setScore: setScore,
    scoringEntities: scoringEntities, entityKey: entityKey, keyOf: keyOf, teamName: teamName,
    leaderboard: leaderboard, resultsDoc: resultsDoc, monthlyBoard: monthlyBoard,
    diffPaths: diffPaths
  };
});
