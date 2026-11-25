/*
 * Padel Socials — rotation + scoring engine.
 * Pure functions, no browser or network code, so it runs the same on the iPad and in the tests.
 *
 * Vocabulary
 *   level     index into session.courts (0 = bottom court, last = King's Court)
 *   round     { n, courts:[{court, level, a, b, sa, sb, w, void}], sitting:[teamId], entry:{teamId:level} }
 *   returner  a team that did not play the previous round (sat out, or just arrived)
 *
 * Two formats share the same rules for courts, sit-outs and returning:
 *   kings-fixed       fixed partners. An entry in session.teams is a couple; a court's a and b are team ids.
 *   wheel             Wheel of Fortune: players sign up alone and a wheel pairs them up. How the day runs depends on
 *                     how many came (see wheelPlan): new partners after every set with 4 to 7 players; fixed
 *                     partners, pool rounds and play-offs with 8 or more. Points are per player.
 *   kings-individual  everyone plays for themselves. An entry in session.teams is ONE player; a court's a and b
 *                     are each a list of two player ids. After every round the pairs split: the two winners move
 *                     up a court and become opponents, each with a new partner; the two losers move down and split.
 *
 * Round robin (rr-individual, rr-fixed) has no King's Court and nobody moves up or down: every round is a fresh
 * mix, with the partners and opponents each player (or couple) has met least so far. Sit-outs are shared equally.
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

  // ---- Formats ------------------------------------------------------------------------------
  var FORMATS = {
    'kings-fixed': { name: 'Fixed partner, King\u2019s Court', solo: false, per: 2, scoring: 'team', unit: 'team', units: 'teams' },
    'kings-individual': { name: 'Individual, King\u2019s Court', solo: true, per: 4, scoring: 'player', unit: 'player', units: 'players' },
    'wheel': { name: 'Wheel of Fortune', solo: true, per: 4, scoring: 'player', unit: 'player', units: 'players', wheel: true },
    'rr-individual': { name: 'Individual, Round Robin', solo: true, per: 4, scoring: 'player', unit: 'player', units: 'players', rr: true },
    'rr-fixed': { name: 'Fixed partner, Round Robin', solo: false, per: 2, scoring: 'team', unit: 'team', units: 'teams', rr: true }
  };
  function formatOf(x) { return FORMATS[typeof x === 'string' ? x : (x && x.format)] || FORMATS['kings-fixed']; }
  function isSolo(session) { return formatOf(session).solo; }
  function isRR(session) { return formatOf(session).rr === true; }
  // King's Court nights: winners move up a court, losers move down (not the wheel, not a round robin).
  function isLadder(session) { var f = formatOf(session); return !f.wheel && !f.rr; }
  // How much a game won is worth tonight: 1, or 2 on a "double points" night.
  function multOf(x) { var m = Number(x && x.mult); return m > 1 && m <= 5 ? m : 1; }
  // The ids on one side of a court: one team (fixed partners) or two players (individual).
  function sideIds(c, side) {
    var v = c ? c[side] : null;
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return toArray(v);
    return v ? [v] : [];
  }
  function courtIds(c) { return sideIds(c, 'a').concat(sideIds(c, 'b')); }
  function sideOf(c, id) { return sideIds(c, 'a').indexOf(id) >= 0 ? 'a' : sideIds(c, 'b').indexOf(id) >= 0 ? 'b' : null; }
  function sideName(session, c, side) {
    return sideIds(c, side).map(function (id) { var t = session.teams[id]; return t ? t.name : '(removed)'; }).join(' & ');
  }

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
      scoring: opts.scoring || formatOf(opts.format).scoring,   // 'team' = points belong to the couple, 'player' = to each player
      date: date,
      month: date.slice(0, 7),
      status: 'setup',                           // setup -> live -> ended
      courts: (opts.courts || []).slice(),       // bottom -> top; the last one is King's Court
      round1: opts.round1 || 'random',           // 'random' or 'seeded' (seeded = team list order)
      setTo: opts.setTo === 6 ? 6 : 4,           // sets are played to 4 games or to 6 games
      seed: opts.seed || Math.floor(Math.random() * 1e9),
      mult: multOf(opts),                        // 2 = double points tonight (a 4-1 set gives 8 and 2)
      teams: {},
      rounds: []
    };
  }
  function localDate(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function localTime(d) { var h = d.getHours(), m = d.getMinutes(); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  // "Today" or "Tonight"? A social that starts between 5:30am and 6pm is a daytime one; later ones are at night.
  // x is a session or its saved results (both carry start, the HH:MM the first round was drawn at). Before the start
  // there is no time yet: pass now (a Date) to go by the clock. With neither, the wheel socials count as daytime.
  function isDaytime(x, now) {
    var t = /^(\d{1,2}):(\d{2})/.exec((x && x.start) || (now ? localTime(now) : ''));
    if (!t) return !!x && x.format === 'wheel';
    var min = Number(t[1]) * 60 + Number(t[2]);
    return min >= 330 && min <= 1080;
  }
  function dayWord(x, now) { return isDaytime(x, now) ? 'Today' : 'Tonight'; }

  // The database drops empty lists and empty values; put them back so the rest of the code can rely on them.
  function normalize(s) {
    if (!s || typeof s !== 'object') return null;
    s.status = s.status || 'setup';
    s.format = s.format || 'kings-fixed';
    s.scoring = s.scoring || 'team';
    s.round1 = s.round1 || 'random';
    s.setTo = Number(s.setTo) === 6 ? 6 : 4;
    s.mult = multOf(s);
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
    if (s.wheel && typeof s.wheel === 'object') {
      var w = s.wheel;
      w.spin = w.spin || 0; w.start = w.start || 0; w.respin = !!w.respin; w.hold = !!w.hold;
      w.left = toArray(w.left); w.right = toArray(w.right); w.sit = toArray(w.sit); w.stages = toArray(w.stages);
      w.teams = toArray(w.teams).map(toArray);
    } else if (s.wheel !== undefined) s.wheel = null;
    s.rounds = toArray(s.rounds);
    s.rounds.forEach(function (r) {
      r.courts = toArray(r.courts);
      r.sitting = toArray(r.sitting);
      r.entry = r.entry || {};
      r.redraw = r.redraw || 0;
      if (r.top === undefined || r.top === null) r.top = r.courts.reduce(function (m, c) { return Math.max(m, c.level || 0); }, 0);
      r.courts.forEach(function (c) {
        if (c.a && typeof c.a === 'object') c.a = toArray(c.a);
        if (c.b && typeof c.b === 'object') c.b = toArray(c.b);
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

  function roundTop(session, r) { return (r.top !== undefined && r.top !== null) ? r.top : session.courts.length - 1; }
  function isKingsCourt(session, r, c) { return !c.wait && c.level === roundTop(session, r); }

  // ---- Stats by replaying the rounds --------------------------------------------------------
  function teamStats(session, upto) {
    var st = {}, mult = multOf(session);
    Object.keys(session.teams).forEach(function (id) {
      st[id] = { points: 0, against: 0, wins: 0, losses: 0, played: 0, sitOuts: session.teams[id].sitCredit || 0,
        satOut: 0, lastSat: 0, lastPlayed: null };
    });
    session.rounds.forEach(function (r) {
      if (upto !== undefined && upto !== null && r.n > upto) return;
      var rtop = roundTop(session, r);   // courts are counted down from King's Court: depth 0 = King's Court
      r.sitting.forEach(function (id) {
        if (!st[id]) return;
        st[id].sitOuts++; st[id].satOut++; st[id].lastSat = r.n;
      });
      r.courts.forEach(function (c) {
        if (c.void) { // someone left mid-round and nobody could step in: no points. The side that stayed complete
          // keeps its place as if it had won; a player whose partner left simply holds the court.
          sideIds(c, c.w).forEach(function (id) { if (st[id]) st[id].lastPlayed = { n: r.n, level: c.level, depth: rtop - c.level, won: true }; });
          sideIds(c, c.w === 'a' ? 'b' : 'a').forEach(function (id) { if (st[id]) st[id].lastPlayed = { n: r.n, level: c.level, depth: rtop - c.level, won: false, hold: true }; });
          return;
        }
        if (!c.w) return;
        var sa = (c.sa || 0) * mult, sb = (c.sb || 0) * mult;
        ['a', 'b'].forEach(function (side) {
          var won = c.w === side, mine = side === 'a' ? sa : sb, theirs = side === 'a' ? sb : sa;
          sideIds(c, side).forEach(function (id) {
            var X = st[id];
            if (!X) return;
            X.points += mine; X.against += theirs; X.played++; if (won) X.wins++; else X.losses++;
            X.lastPlayed = { n: r.n, level: c.level, depth: rtop - c.level, won: won };
          });
        });
      });
    });
    return st;
  }

  // ---- Round generation: King's Court with sit-outs (fixed partners, or individual) ---------
  function generateRound(session, n, redraw) {
    redraw = redraw || 0;
    if (isRR(session)) return generateRoundRR(session, n, redraw);
    var C = session.courts.length;
    var teams = activeTeams(session);
    var N = teams.length;
    var solo = isSolo(session), per = solo ? 4 : 2;   // entries per court: two teams, or four players
    var k = Math.min(C, Math.floor(N / per));     // courts in use (the top k, so King's Court is always played)
    var top = C - 1, L0 = C - k;
    var S = N - per * k;                          // teams (or players) sitting out this round
    var rng = makeRng(hashSeed(session.seed, n, redraw));
    var round = { n: n, top: top, courts: [], sitting: [], entry: {}, redraw: redraw };
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
      for (var i = 0; i < k; i++) {
        var four = playing.slice(per * i, per * i + per);
        // individual: of the four on a court, first and last in the order play the middle two
        slots[top - i] = solo ? [[four[0], four[3]], [four[1], four[2]]] : four;
      }
    } else {
      var st = teamStats(session, n - 1);
      var r1 = session.rounds[0];
      var entryMap = {};                               // round-1 sitters' entry courts, re-anchored to King's Court
      if (r1 && r1.entry) Object.keys(r1.entry).forEach(function (id) { entryMap[id] = top - (roundTop(session, r1) - r1.entry[id]); });
      var lateLevel = RULES.lateArrivalEntry === 'middle' ? L0 + Math.floor((top - L0) / 2) : L0;
      var info = teams.map(function (t) {
        var s = st[t.id], lp = s.lastPlayed, playedPrev = !!lp && lp.n === n - 1;
        var x = {
          id: t.id, playedPrev: playedPrev, won: lp ? (lp.won ? 1 : 0) : 0,
          prevL: lp ? clamp(top - lp.depth, L0, top) : -1,   // same distance from King's Court as last time
          wins: s.wins, points: s.points, sit: s.sitOuts,
          // a team that has just arrived is treated as if it sat last round, so it plays before it sits
          lastSat: (!lp && !s.satOut) ? n - 1 : s.lastSat,
          tb: rng()
        };
        if (playedPrev) {                               // normal move: winners up, losers down
          x.target = clamp(x.prevL + (x.won ? 1 : (lp.hold ? 0 : -1)), L0, top);
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
      for (l = top; l >= L0; l--) for (var q = 0; q < per; q++) levels.push(l);
      var cost = playingInfo.map(function (x) { return levels.map(function (lv) { return placeCost(x, lv); }); });
      var assigned = hungarian(cost);
      playingInfo.forEach(function (x, i) { slots[levels[assigned[i]]].push(x); });
      var past = solo ? pairHistory(session, n) : null;
      for (l = L0; l <= top; l++) {
        slots[l].sort(function (x, y) { return y.wins - x.wins || y.points - x.points || x.tb - y.tb; });
        slots[l] = solo ? splitPairs(slots[l], past) : slots[l].map(function (x) { return x.id; });
      }
    }

    for (l = top; l >= L0; l--) {
      round.courts.push({ court: session.courts[l], level: l, a: slots[l][0], b: slots[l][1], sa: null, sb: null, w: null, void: false });
    }
    return round;
  }

  // ---- Round robin: a fresh mix every round ---------------------------------------------------
  // Who sits: whoever has sat out least so far; among those, whoever sat longest ago, so nobody sits twice running
  // while someone else could; then by lot. Who plays whom: many random mixes are tried and improved, and the one
  // kept has the fewest repeated partners and opponents (a partner or opponent of the round just played counts
  // most). The draw only depends on the night's seed and on who has met whom, so every screen works out the same one.
  function generateRoundRR(session, n, redraw) {
    var teams = activeTeams(session), N = teams.length, solo = isSolo(session), per = solo ? 4 : 2;
    var C = session.courts.length, k = Math.min(C, Math.floor(N / per)), S = N - per * k;
    var rng = makeRng(hashSeed(session.seed, 'rr', n, redraw));
    var round = { n: n, top: -1, courts: [], sitting: [], entry: {}, redraw: redraw };
    if (k === 0) { round.sitting = teams.map(function (t) { return t.id; }); return round; }
    var st = teamStats(session, n - 1), tb = {};
    teams.forEach(function (t) { tb[t.id] = rng(); });
    // someone who has just arrived counts as having sat the round before, so they play before they sit
    var lastSat = function (id) { var s = st[id]; return (!s.lastPlayed && !s.satOut && n > 1) ? n - 1 : s.lastSat; };
    var sitSet = {};
    teams.map(function (t) { return t.id; })
      .sort(function (x, y) { return st[x].sitOuts - st[y].sitOuts || lastSat(x) - lastSat(y) || tb[x] - tb[y]; })
      .slice(0, S).forEach(function (id) { sitSet[id] = true; });
    round.sitting = teams.filter(function (t) { return sitSet[t.id]; }).map(function (t) { return t.id; });
    var playing = teams.filter(function (t) { return !sitSet[t.id]; }).map(function (t) { return t.id; });

    var past = pairHistory(session, n), prev = n - 1;
    var cnt = function (map, x, y) { return (map[x] && map[x][y]) || 0; };
    var lastWith = {}, lastVs = {};                       // partners and opponents of the round just played
    (session.rounds[prev - 1] ? session.rounds[prev - 1].courts : []).forEach(function (c) {
      var A = sideIds(c, 'a'), B = sideIds(c, 'b');
      if (A.length === 2) { lastWith[A[0] + '|' + A[1]] = lastWith[A[1] + '|' + A[0]] = true; }
      if (B.length === 2) { lastWith[B[0] + '|' + B[1]] = lastWith[B[1] + '|' + B[0]] = true; }
      A.forEach(function (x) { B.forEach(function (y) { lastVs[x + '|' + y] = lastVs[y + '|' + x] = true; }); });
    });
    var withCost = function (x, y) { var c = cnt(past.partner, x, y); return 100 * c * c + (lastWith[x + '|' + y] ? 600 : 0); };
    var vsCost = function (x, y) { var c = cnt(past.opp, x, y); return (solo ? 12 : 100) * c * c + (lastVs[x + '|' + y] ? (solo ? 40 : 600) : 0); };
    var courtCost = function (o, i) {                    // the court that starts at place i of the order
      if (!solo) return vsCost(o[i], o[i + 1]);
      return withCost(o[i], o[i + 1]) + withCost(o[i + 2], o[i + 3]) +
        vsCost(o[i], o[i + 2]) + vsCost(o[i], o[i + 3]) + vsCost(o[i + 1], o[i + 2]) + vsCost(o[i + 1], o[i + 3]);
    };
    var best = null, bestCost = Infinity, P = playing.length;
    for (var tries = 0; tries < 6 && bestCost > 0; tries++) {
      var o = shuffle(playing, rng), costs = [], total = 0, i, j;
      for (i = 0; i < k; i++) { costs[i] = courtCost(o, i * per); total += costs[i]; }
      for (var pass = 0; pass < 8 && total > 0; pass++) {  // swap any two places while that makes the mix better
        var better = false;
        for (i = 0; i < P - 1; i++) for (j = i + 1; j < P; j++) {
          var ci = Math.floor(i / per), cj = Math.floor(j / per), t = o[i];
          o[i] = o[j]; o[j] = t;
          var ni = courtCost(o, ci * per), nj = ci === cj ? 0 : courtCost(o, cj * per), was = costs[ci] + (ci === cj ? 0 : costs[cj]);
          if (ni + nj < was) { total += ni + nj - was; costs[ci] = ni; if (ci !== cj) costs[cj] = nj; better = true; }
          else { t = o[i]; o[i] = o[j]; o[j] = t; }
        }
        if (!better) break;
      }
      if (total < bestCost) { bestCost = total; best = o.slice(); }
    }
    for (var m = 0; m < k; m++) {
      var four = best.slice(m * per, m * per + per);
      round.courts.push({ court: session.courts[m], level: m, a: solo ? [four[0], four[1]] : four[0], b: solo ? [four[2], four[3]] : four[1], sa: null, sb: null, w: null, void: false });
    }
    return round;
  }

  // ---- Individual format: who partners whom ---------------------------------------------------
  // Who has partnered and faced whom so far tonight (rounds before n), and everyone's most recent partner.
  function pairHistory(session, n) {
    var h = { partner: {}, opp: {}, last: {} };
    var bump = function (map, x, y) { (map[x] || (map[x] = {}))[y] = ((map[x] || {})[y] || 0) + 1; };
    session.rounds.forEach(function (r) {
      if (r.n >= n) return;
      r.courts.forEach(function (c) {
        var A = sideIds(c, 'a'), B = sideIds(c, 'b');
        [A, B].forEach(function (pair) {
          if (pair.length === 2) { bump(h.partner, pair[0], pair[1]); bump(h.partner, pair[1], pair[0]); h.last[pair[0]] = { n: r.n, id: pair[1] }; h.last[pair[1]] = { n: r.n, id: pair[0] }; }
        });
        A.forEach(function (x) { B.forEach(function (y) { bump(h.opp, x, y); bump(h.opp, y, x); }); });
      });
    });
    return h;
  }
  // Four players on a court become two pairs. The pair that just played together always splits (the two
  // winners coming up face each other, as do the two losers coming down); after that, the pairing with the
  // partners who have played together least, then the opponents who have met least.
  function splitPairs(four, past) {
    if (four.length < 4) return [four.slice(0, 2).map(function (x) { return x.id; }), four.slice(2).map(function (x) { return x.id; })];
    var count = function (map, x, y) { return (map[x] && map[x][y]) || 0; };
    var togetherLast = function (x, y) { var a = past.last[x.id], b = past.last[y.id]; return !!a && !!b && a.id === y.id && b.id === x.id && a.n === b.n; };
    var options = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]], best = null, bestCost = Infinity;
    options.forEach(function (o) {
      var c = 0;
      o.forEach(function (pr) {
        var x = four[pr[0]], y = four[pr[1]];
        if (togetherLast(x, y)) c += 1000;
        c += 30 * count(past.partner, x.id, y.id);
      });
      o[0].forEach(function (i) { o[1].forEach(function (j) { c += 2 * count(past.opp, four[i].id, four[j].id); }); });
      // all else equal, the fairer match: similar strength on both sides
      c += 0.01 * Math.abs((four[o[0][0]].wins + four[o[0][1]].wins) - (four[o[1][0]].wins + four[o[1][1]].wins));
      c += 0.001 * (four[o[0][0]].tb + four[o[1][1]].tb);
      if (c < bestCost) { bestCost = c; best = o; }
    });
    return best.map(function (pr) { return [four[pr[0]].id, four[pr[1]].id]; });
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

  // ---- Wheel of Fortune ---------------------------------------------------------------------
  // session.wheel = { spin, start, left, right, teams, sit, stages, respin }
  //   spin    counts the spins of the day (the TV plays the wheel animation when it changes)
  //   start   how many rounds had been played when this spin was made
  //   left / right   the players on the two wheels, in order; left[i] is paired with right[i]
  //   teams   the pairs (a team of three when the number playing is odd: one of the three rests each round)
  //   sit     players sitting out until the next spin
  //   stages  what each round after the spin is: 'set', 'pool', 'playin', 'semi', 'final', 'place'
  //   respin  true when the wheel spins again after the last stage (4 to 7 players)
  //   hold    true from the spin until the organizer sends the TV on to the courts (or the first score comes in):
  //           meanwhile the TV keeps the two wheels and the pairs on screen
  function isWheel(session) { return formatOf(session).wheel === true; }
  function roundSetTo(session, r) { return r && r.setTo ? r.setTo : (session.setTo === 6 ? 6 : 4); }

  // How the day runs for n players. Follows the organizer's guideline for 4, 5, 6, 8, 10 and 12 players; odd
  // numbers use the plan of the even number below with one player sitting (5, 7) or one team of three (9 and up).
  function wheelPlan(n) {
    if (!(n >= 4)) return null;
    var p;
    if (n === 4) p = { teams: 2, sit: 0, respin: true, stages: ['set'], text: 'Two teams play one set to 6. Then the wheel picks new partners.' };
    else if (n === 5) p = { teams: 2, sit: 1, respin: true, stages: ['set', 'set'], text: 'One player sits out; two teams play two sets to 6. Then the wheel spins again and someone else sits.' };
    else if (n <= 7) p = { teams: 3, sit: n - 6, respin: true, stages: ['pool', 'pool', 'pool'],
      text: (n === 7 ? 'One player sits out. ' : '') + 'Three teams: each plays the other two, sets to 4, one team resting each round. Then the wheel spins again.' };
    else {
      var T = Math.floor(n / 2), pools = Math.min(5, roundRobin(T).length), stages = [];
      for (var i = 0; i < pools; i++) stages.push('pool');
      if (T === 4) stages.push('semi', 'final'); else if (T === 5) stages.push('playin', 'semi', 'final'); else stages.push('place');
      p = { teams: T, sit: 0, respin: false, stages: stages,
        text: T + ' teams keep the same partner all day' + (n % 2 ? ' (one team of three takes turns resting)' : '') + '. ' + pools + ' pool rounds, sets to 4' + (T % 2 ? ', one team resting each round' : '') + '. ' +
          (T === 4 ? 'Then semifinals to 4, and a final and a bronze medal match to 6.' : T === 5 ? 'Then play-offs to 4: 4th v 5th, semifinals, then the final and a bronze medal match.' : 'Then medal matches to 6: 1st v 2nd, 3rd v 4th, and so on.') };
    }
    p.players = n; p.trio = n >= 8 && n % 2 === 1;
    return p;
  }
  function stageSetTo(stage, T) { return stage === 'set' || stage === 'place' || (stage === 'final' && T === 4) ? 6 : 4; }
  // Everyone plays everyone: a list of rounds, each { matches: [[i, j], ...], bye: [i] } (circle method).
  function roundRobin(T) {
    var ring = [], rounds = [], i;
    for (i = 0; i < T; i++) ring.push(i);
    if (T % 2) ring.push(-1);
    var n = ring.length;
    for (var r = 0; r < n - 1; r++) {
      var matches = [], bye = [];
      for (i = 0; i < n / 2; i++) {
        var a = ring[i], b = ring[n - 1 - i];
        if (a < 0) bye.push(b); else if (b < 0) bye.push(a); else matches.push([a, b]);
      }
      rounds.push({ matches: matches, bye: bye });
      ring.splice(1, 0, ring.pop());
    }
    return rounds;
  }
  // Which court the i-th match of a round is on. The first match gets the last court in the list; with more
  // matches than courts the extra ones wait for a court to come free.
  function wheelCourt(session, i) {
    var C = session.courts.length, level = C - 1 - (i % C);
    return { court: session.courts[level], level: level, wait: i >= C };
  }
  // Where the day stands: 'none' (not a wheel day, or not spun yet), 'playing', 'spin' (time for new partners)
  // or 'done' (the last match of the day has been played).
  function wheelState(session) {
    var w = session.wheel;
    if (!isWheel(session) || !w || session.status !== 'live') return 'none';
    var cur = currentRound(session), k = session.rounds.length - w.start;
    if (cur && !roundComplete(cur)) return 'playing';
    if (k >= w.stages.length) return w.respin ? 'spin' : 'done';
    return 'playing';
  }
  // Which wheel team (its place in wheel.teams) is on a side of a court. Courts carry it (ta, tb); older ones are
  // worked out from the players.
  function courtTeam(c, side, of) {
    var t = side === 'a' ? c.ta : c.tb;
    return t !== undefined && t !== null ? t : of[sideIds(c, side)[0]];
  }
  // The pool table of the current spin: teams ranked by matches won, then games won, then fewest games lost,
  // then the match between the two.
  function wheelStandings(session) {
    var w = session.wheel;
    if (!w) return [];
    var of = {}, rows = w.teams.map(function (t, i) { t.forEach(function (id) { of[id] = i; }); return { team: i, players: t.slice(), won: 0, lost: 0, gf: 0, ga: 0, played: 0 }; }), beat = {};
    session.rounds.slice(w.start).forEach(function (r) {
      if (r.stage !== 'pool' && r.stage !== 'set') return;
      r.courts.forEach(function (c) {
        if (!c.w || c.void) return;
        var A = rows[courtTeam(c, 'a', of)], B = rows[courtTeam(c, 'b', of)];
        if (!A || !B) return;
        A.played++; B.played++; A.gf += c.sa || 0; A.ga += c.sb || 0; B.gf += c.sb || 0; B.ga += c.sa || 0;
        var win = c.w === 'a' ? A : B, lose = c.w === 'a' ? B : A;
        win.won++; lose.lost++; beat[win.team + '>' + lose.team] = true;
      });
    });
    rows.sort(function (x, y) {
      return y.won - x.won || y.gf - x.gf || x.ga - y.ga || (beat[x.team + '>' + y.team] ? -1 : beat[y.team + '>' + x.team] ? 1 : 0) || x.team - y.team;
    });
    rows.forEach(function (row, i) { row.rank = i + 1; });
    return rows;
  }
  // The k-th round after the current spin.
  function wheelRound(session, k) {
    var w = session.wheel, stage = w.stages[k], T = w.teams.length, n = session.rounds.length + 1;
    var here = function (id) { return !!session.teams[id] && !session.teams[id].left; };
    var playing = function (ti) {                       // the two of a team who play this round
      var team = w.teams[ti].filter(here);
      if (team.length <= 2) return team;
      var rest = (k + ti) % team.length;                // a team of three: one rests, in turn
      return team.filter(function (x, i) { return i !== rest; });
    };
    var of = {};
    w.teams.forEach(function (t, i) { t.forEach(function (id) { of[id] = i; }); });
    var winnerOf = function (c) { return courtTeam(c, c.w, of); };
    var prev = currentRound(session), matches = [], labels = [], pools = w.stages.filter(function (x) { return x === 'pool'; }).length, title;
    if (stage === 'set') { matches = [[0, 1]]; title = 'Set ' + (k + 1) + (w.stages.length > 1 ? ' of ' + w.stages.length : ''); }
    else if (stage === 'pool') { var rr = roundRobin(T); matches = rr[k % rr.length].matches; title = (w.respin ? 'Round ' : 'Pool round ') + (k + 1) + ' of ' + pools; }
    else {
      var rank = wheelStandings(session).map(function (x) { return x.team; });
      if (stage === 'playin') { matches = [[rank[3], rank[4]]]; labels = ['Play-in']; title = 'Play-in: 4th v 5th'; }
      else if (stage === 'semi') {
        matches = T === 5 ? [[rank[0], winnerOf(prev.courts[0])], [rank[1], rank[2]]] : [[rank[0], rank[3]], [rank[1], rank[2]]];
        labels = ['Semifinal', 'Semifinal']; title = 'Semifinals';
      } else if (stage === 'final') {                   // the semifinal winners play the final, the losers the bronze medal match
        var loserOf = function (c) { return courtTeam(c, c.w === 'a' ? 'b' : 'a', of); }, l0 = loserOf(prev.courts[0]), l1 = loserOf(prev.courts[1]);
        matches = [[winnerOf(prev.courts[0]), winnerOf(prev.courts[1])]]; labels = ['Final']; title = 'Final';
        if (l0 !== undefined && l1 !== undefined && playing(l0).length === 2 && playing(l1).length === 2) { matches.push([l0, l1]); labels.push('Bronze match'); title = 'Final & bronze match'; }
      }
      else {
        var names = ['Gold match', 'Bronze match', '5th place', '7th place', '9th place', '11th place'];
        for (var i = 0; i + 1 < rank.length; i += 2) { matches.push([rank[i], rank[i + 1]]); labels.push(names[i / 2] || 'Placement'); }
        title = 'Medal matches';
      }
    }
    var round = { n: n, top: -1, courts: [], sitting: [], entry: {}, redraw: 0, stage: stage, setTo: stageSetTo(stage, T), title: title, spin: w.spin }, on = {};
    matches.forEach(function (m) {
      var a = playing(m[0]), b = playing(m[1]);
      if (a.length < 2 && b.length < 2) return;
      var at = wheelCourt(session, round.courts.length);
      var c = { court: at.court, level: at.level, a: a, b: b, sa: null, sb: null, w: null, void: false, ta: m[0], tb: m[1] };
      if (at.wait) c.wait = true;
      if (labels.length) c.label = labels[round.courts.length] || labels[0];
      if (a.length < 2 || b.length < 2) { c.void = true; c.w = a.length < 2 ? 'b' : 'a'; }     // a team that lost a player cannot play
      a.concat(b).forEach(function (id) { on[id] = true; });
      round.courts.push(c);
    });
    if ((stage === 'final' || stage === 'place') && round.courts.length) round.top = round.courts[0].level;
    round.sitting = activeTeams(session).map(function (t) { return t.id; }).filter(function (id) { return !on[id]; });
    return round;
  }
  function wheelAdvance(session) {
    var w = session.wheel;
    if (session.status !== 'live' || !w || !session.courts.length) return false;
    var cur = currentRound(session), k = session.rounds.length - w.start;
    if ((cur && !roundComplete(cur)) || k >= w.stages.length) return false;
    session.rounds.push(wheelRound(session, k));
    return true;
  }
  // Spin: decide who sits (the organizer's choice first, then whoever has sat least), put the others on two
  // wheels and pair them across, preferring partners who have not played together yet today. Starts the day
  // when it has not started, and a new set of teams when it has. opts.sit: ids the organizer wants to sit out.
  function wheelSpin(session, opts) {
    opts = opts || {};
    if (!isWheel(session)) return { ok: false, error: 'This social does not use the wheel.' };
    if (session.status !== 'setup' && session.status !== 'live') return { ok: false, error: 'The day has ended.' };
    var cur = currentRound(session);
    if (session.status === 'live' && cur && !roundComplete(cur) && roundHasScores(cur)) return { ok: false, error: 'Finish this round first: some of its matches have a score.' };
    var players = activeTeams(session), plan = wheelPlan(players.length);
    if (!plan) return { ok: false, error: 'The wheel needs at least four players.' };
    if (!session.courts.length) return { ok: false, error: 'Pick the courts first.' };
    if (session.status === 'setup') { session.status = 'live'; session.rounds = []; }
    else if (cur && !roundComplete(cur)) session.rounds.pop();          // a round nobody has played is dropped
    var spin = ((session.wheel && session.wheel.spin) || 0) + 1, rng = makeRng(hashSeed(session.seed, 'wheel', spin));
    var st = teamStats(session), ids = players.map(function (t) { return t.id; }), tb = {};
    ids.forEach(function (id) { tb[id] = rng(); });
    var sit = toArray(opts.sit).filter(function (id, i, a) { return ids.indexOf(id) >= 0 && a.indexOf(id) === i; }).slice(0, plan.sit);
    ids.filter(function (id) { return sit.indexOf(id) < 0; })
      .sort(function (x, y) { return st[x].sitOuts - st[y].sitOuts || st[x].lastSat - st[y].lastSat || tb[x] - tb[y]; })
      .slice(0, plan.sit - sit.length).forEach(function (id) { sit.push(id); });
    var playing = ids.filter(function (id) { return sit.indexOf(id) < 0; }), T = plan.teams;
    var past = pairHistory(session, Infinity), best = null, bestCost = Infinity;
    for (var tries = 0; tries < 120 && bestCost > 0; tries++) {
      var order = shuffle(playing, rng), cost = 0;
      for (var i = 0; i < T; i++) {
        var l = order[i], r = order[T + i], lastL = past.last[l];
        cost += 30 * ((past.partner[l] && past.partner[l][r]) || 0) + (lastL && lastL.id === r ? 1000 : 0);
      }
      if (cost < bestCost) { bestCost = cost; best = order; }
    }
    var left = best.slice(0, T), right = best.slice(T, 2 * T), teams = left.map(function (l, i) { return [l, right[i]]; });
    if (best.length > 2 * T) teams[Math.floor(rng() * T)].push(best[2 * T]);     // the odd one out joins a team as its third
    session.wheel = { spin: spin, start: session.rounds.length, left: left, right: right, teams: teams, sit: sit, stages: plan.stages, respin: plan.respin, hold: true };
    wheelAdvance(session);
    return { ok: true, spin: spin, teams: teams, sit: sit, plan: plan };
  }

  // The organizer has let everyone read the pairs: the TV moves on from the wheels to the courts.
  function wheelRelease(session) {
    if (!session.wheel || !session.wheel.hold) return false;
    session.wheel.hold = false;
    return true;
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
    if (isWheel(session) && session.wheel && session.status === 'live') {   // a pair that lost a player takes the newcomer
      var open = session.wheel.teams.filter(function (tm) {
        return tm.filter(function (x) { return session.teams[x] && !session.teams[x].left; }).length === 1;
      })[0];
      if (open) open.push(id);
    }
    return team;
  }

  // Correct a team's names at any time. Rounds refer to teams by an internal id, so every round, tonight's
  // leaderboard and the saved results pick up the new names. oldKey/newKey let the caller carry the change
  // over to earlier nights, so the monthly table keeps one line for the team.
  function renameTeam(session, id, players) {
    var t = session.teams[id];
    players = (Array.isArray(players) ? players : [players]).map(cleanName).filter(Boolean);
    if (!t) return { ok: false, error: 'That team is no longer on the list.' };
    if (!players.length) return { ok: false, error: 'Type at least one name.' };
    var oldKey = entityKey(t.players), newKey = entityKey(players);
    var clash = teamList(session).filter(function (x) { return x.id !== id && entityKey(x.players) === newKey; })[0];
    if (clash) return { ok: false, error: 'Another team already has those names.' };
    t.players = players; t.name = teamName(players);
    return { ok: true, oldKey: oldKey, newKey: newKey, name: t.name, players: players };
  }

  function removeTeam(session, id) {
    var t = session.teams[id];
    if (!t) return { removed: false };
    if (session.status === 'setup' || !session.rounds.length) { delete session.teams[id]; return { removed: true }; }
    var cur = currentRound(session), out = { removed: true };
    t.left = cur.n;
    var si = cur.sitting.indexOf(id);
    if (si >= 0) cur.sitting.splice(si, 1);
    if (isWheel(session)) {
      // her match this round: a third team-mate who was resting steps in; otherwise the match is called off
      var mates = (((session.wheel || {}).teams || []).filter(function (tm) { return tm.indexOf(id) >= 0; })[0] || []);
      cur.courts.forEach(function (c) {
        var side = sideOf(c, id);
        if (courtDone(c) || !side) return;
        var sub = mates.filter(function (x) { return x !== id && cur.sitting.indexOf(x) >= 0; })[0];
        if (sub) { cur.sitting.splice(cur.sitting.indexOf(sub), 1); c[side] = c[side].map(function (x) { return x === id ? sub : x; }); c.sa = null; c.sb = null; out.substitute = sub; out.court = c.court; }
        else { c.void = true; c.w = side === 'a' ? 'b' : 'a'; c.sa = null; c.sb = null; out.voided = c.court; }
      });
      out.advanced = advance(session);
      return out;
    }
    cur.courts.forEach(function (c) {
      var side = sideOf(c, id);
      if (courtDone(c) || !side) return;
      if (cur.sitting.length) { // a team (or player) that was sitting out takes the place
        var st = teamStats(session);
        var sub = cur.sitting.slice().sort(function (x, y) { return st[y].sitOuts - st[x].sitOuts; })[0];
        cur.sitting.splice(cur.sitting.indexOf(sub), 1);
        if (Array.isArray(c[side])) c[side] = c[side].map(function (x) { return x === id ? sub : x; }); else c[side] = sub;
        c.sa = null; c.sb = null;
        out.substitute = sub; out.court = c.court;
      } else {                  // nobody to step in: the other team keeps its place
        c.void = true; c.w = side === 'a' ? 'b' : 'a'; c.sa = null; c.sb = null;
        out.voided = c.court;
      }
    });
    out.advanced = advance(session);
    return out;
  }

  // Switch two places in the round being played: two teams (fixed partners) or two players (individual, wheel).
  // Each of the two is on a court that has no score yet, or is sitting out (or waiting to join). On court for
  // on court: they change places. On court for sitting out: the one sitting out plays and the other sits.
  // Wheel: the two change teams for the rest of this set of partners (two of the same team of three just change
  // whose turn it is to rest).
  function swapPlaces(session, x, y) {
    var cur = currentRound(session), one = formatOf(session).unit;
    if (session.status !== 'live' || !cur) return { ok: false, error: 'There is no round being played.' };
    if (x === y || !session.teams[x] || !session.teams[y] || session.teams[x].left || session.teams[y].left) return { ok: false, error: 'Pick two different ' + formatOf(session).units + '.' };
    var where = function (id) {
      for (var i = 0; i < cur.courts.length; i++) { var side = sideOf(cur.courts[i], id); if (side) return { c: cur.courts[i], side: side }; }
      return null;
    };
    var px = where(x), py = where(y);
    if (!px && !py) return { ok: false, error: 'Neither of them is on a court this round.' };
    var busy = [px, py].filter(function (p) { return p && courtDone(p.c); })[0];
    if (busy) return { ok: false, error: busy.c.void ? 'Court ' + busy.c.court + ' has no match this round.' : 'Court ' + busy.c.court + ' already has a score. Clear that score first.' };
    if (px && py && px.c === py.c && (px.side === py.side || !isSolo(session))) return { ok: false, error: 'They are on the same court' + (isSolo(session) ? ' and the same side' : '') + ': nothing would change.' };
    var put = function (p, from, to) {
      if (Array.isArray(p.c[p.side])) p.c[p.side] = p.c[p.side].map(function (id) { return id === from ? to : id; }); else p.c[p.side] = to;
      p.c.sa = null; p.c.sb = null;
    };
    var sitSwap = function (list, from, to) { var i = list.indexOf(from); if (i >= 0) list[i] = to; return i >= 0; };
    if (px && py) {
      if (px.c === py.c) { var A = px.c[px.side].map(function (id) { return id === x ? y : id; }), B = py.c[py.side].map(function (id) { return id === y ? x : id; }); px.c[px.side] = A; py.c[py.side] = B; px.c.sa = null; px.c.sb = null; }
      else { put(px, x, y); put(py, y, x); }
    } else {
      var on = px || py, inId = px ? y : x, outId = px ? x : y;     // inId was off court and now plays; outId sits
      put(on, outId, inId);
      if (!sitSwap(cur.sitting, inId, outId)) cur.sitting.push(outId);
      if (cur.n === 1 && isLadder(session)) {                      // round 1: the one who now sits comes in next round on the court they left
        cur.entry = cur.entry || {};
        delete cur.entry[inId];
        cur.entry[outId] = on.c.level;
      }
    }
    if (isWheel(session) && session.wheel) {                       // the pairs of this spin follow
      var w = session.wheel, flip = function (id) { return id === x ? y : id === y ? x : id; };
      w.teams = w.teams.map(function (t) { return t.map(flip); });
      w.left = w.left.map(flip); w.right = w.right.map(flip); w.sit = w.sit.map(flip);
    }
    return { ok: true, court: (px || py).c.court, other: px && py ? py.c.court : null, sits: px && py ? null : (px ? x : y) };
  }

  function startNight(session, opts) {
    if (session.status !== 'setup') return false;
    if (isWheel(session)) return wheelSpin(session, opts).ok;
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
    if (isWheel(session)) return wheelAdvance(session);
    var cur = currentRound(session);
    if (cur && !roundComplete(cur)) return false;
    if (activeTeams(session).length < formatOf(session).per || !session.courts.length) return false;
    session.rounds.push(generateRound(session, cur ? cur.n + 1 : 1, 0));
    return true;
  }

  // Change tonight's courts (numbers and/or how many), before or during the night. King's Court is always the
  // last one in the list, and every team keeps its distance from King's Court.
  //  - round on court has no scores yet: it is drawn again on the new courts
  //  - same number of courts: matches not yet scored move to the new court numbers straight away
  //  - different number of courts, round already under way: it finishes as it is; the next round uses the new list
  function setCourts(session, courts) {
    var old = session.courts.slice();
    session.courts = courts.slice();
    var out = { changed: JSON.stringify(old) !== JSON.stringify(session.courts), redrawn: false, moved: 0, nextRound: false };
    var cur = currentRound(session);
    if (!out.changed || session.status !== 'live' || !cur) return out;
    if (isWheel(session)) {                               // matches not scored yet move to the new courts
      cur.courts.forEach(function (c, i) {
        if (courtDone(c) || !session.courts.length) return;
        var at = wheelCourt(session, i);
        if (c.court !== at.court) out.moved++;
        c.court = at.court; c.level = at.level; c.wait = at.wait;
      });
      if (cur.top >= 0 && cur.courts.length) cur.top = cur.courts[0].level;
      out.nextRound = true;
      return out;
    }
    if (!roundHasScores(cur)) {
      session.rounds[session.rounds.length - 1] = generateRound(session, cur.n, cur.redraw || 0);
      out.redrawn = true;
    } else if (old.length === courts.length) {
      cur.courts.forEach(function (c) {
        if (courtDone(c) || c.court === session.courts[c.level]) return;
        c.court = session.courts[c.level]; out.moved++;
      });
      out.nextRound = true;
    } else out.nextRound = true;
    return out;
  }

  // Take the night back to the start of round n: round n and everything after it is deleted (scores included)
  // and round n is drawn again from how things stood after round n - 1. Teams that arrived during the deleted
  // rounds stay; teams that have left stay out. n = 1 restarts the night: round 1 is drawn with the teams that
  // are still here, and those that have left are taken off the list altogether.
  function rewindTo(session, n) {
    n = Math.floor(Number(n));
    if (isWheel(session)) {                               // the wheel only starts over: back to the sign-up list
      if (session.status !== 'live' || n !== 1) return { ok: false, removed: 0 };
      var gone = session.rounds.length;
      session.rounds = []; session.wheel = null; session.status = 'setup';
      Object.keys(session.teams).forEach(function (id) { if (session.teams[id].left) delete session.teams[id]; else { session.teams[id].joined = 0; session.teams[id].sitCredit = 0; } });
      return { ok: true, removed: gone, round: 1, setup: true };
    }
    if (session.status !== 'live' || !(n >= 1) || n > session.rounds.length) return { ok: false, removed: 0 };
    var removed = session.rounds.length - (n - 1);
    session.rounds = session.rounds.slice(0, n - 1);
    Object.keys(session.teams).forEach(function (id) {
      var t = session.teams[id];
      if (n === 1 && t.left) { delete session.teams[id]; return; }
      if (t.left && t.left > n) t.left = n;
      if (t.joined > n - 1) t.joined = n - 1;
      if (n === 1) t.sitCredit = 0;
    });
    advance(session);
    return { ok: true, removed: removed, round: n };
  }

  function redrawRound(session) {
    var cur = currentRound(session);
    if (!cur || roundHasScores(cur) || isWheel(session)) return false;
    session.rounds[session.rounds.length - 1] = generateRound(session, cur.n, (cur.redraw || 0) + 1);
    return true;
  }

  // Enter or correct a score. winner ('a' or 'b') is only needed when the games are level.
  // opts.revive: the court was called off ("no match", because someone left) but the match was played after all:
  // the score counts and the court is a normal one again. Clearing that score calls it off again, as it was.
  function setScore(session, roundNo, courtIdx, sa, sb, winner, opts) {
    var r = session.rounds[roundNo - 1];
    if (!r) return { ok: false, error: 'No such round' };
    var c = r.courts[courtIdx], revive = !!(opts && opts.revive);
    if (!c || (c.void && !revive)) return { ok: false, error: 'No such court' };
    var oldW = c.w;
    if (sa === null || sb === null || sa === undefined || sb === undefined) {
      if (c.void) return { ok: true, regenerated: false, advanced: false, tooLate: false };
      if (c.revived) { c.void = true; c.w = c.revived; c.sa = null; c.sb = null; delete c.revived; }
      else { c.sa = null; c.sb = null; c.w = null; }
    } else {
      sa = Number(sa); sb = Number(sb);
      var max = roundSetTo(session, r);
      if (!(sa >= 0 && sb >= 0) || sa > max || sb > max) return { ok: false, error: 'Scores go from 0 to ' + max + ' (sets to ' + max + ' games)' };
      var w = sa > sb ? 'a' : sb > sa ? 'b' : (winner === 'a' || winner === 'b' ? winner : null);
      if (!w) return { ok: false, error: 'Level score: choose which team moves up' };
      if (c.void) { c.void = false; c.revived = oldW === 'b' ? 'b' : 'a'; }
      c.sa = sa; c.sb = sb; c.w = w;
    }
    var out = { ok: true, regenerated: false, advanced: false, tooLate: false };
    var last = currentRound(session);
    if (isWheel(session)) {
      if (session.wheel && c.w) session.wheel.hold = false;      // play has started: the TV has to show the courts
      // a corrected result changes who meets whom in a play-off round nobody has played yet: draw it again
      if (session.status === 'live' && roundNo < last.n && oldW !== c.w && r.spin === last.spin && !roundHasScores(last) && last.stage !== 'pool' && last.stage !== 'set') {
        session.rounds.pop(); out.regenerated = true;
      }
      out.advanced = advance(session);
      return out;
    }
    if (session.status === 'live' && roundNo < last.n && oldW !== c.w && !isRR(session)) {   // (a round robin's next round does not depend on who won)
      if (roundNo === last.n - 1 && !roundHasScores(last)) {
        // the winner of the previous round changed and nobody has played the new round yet: redo it
        session.rounds.pop();
        if (roundComplete(r)) { session.rounds.push(generateRound(session, last.n, last.redraw || 0)); out.regenerated = true; }
      } else out.tooLate = true;   // points are corrected, court positions stay as played
    }
    out.advanced = advance(session);
    return out;
  }

  // ---- Scores sent in by players from their phones ------------------------------------------
  // Players write to a separate, narrow place in the database (never to the night itself). The organizer's
  // device reads those entries and applies them here, so the night keeps a single owner.
  // entries: { c0: {sa, sb, w, at, by}, c1: ... } for round `roundNo`; c0 is the first court of that round.
  // An entry counts only for the round being played now, and only once (court.pat remembers the last one used).
  //
  // The night does not wait for the organizer's device. A round is drawn from the night's own seed, so every
  // device that knows the night and the scores sent so far works out the same next round by itself
  // (withPlayerScores): the TV shows it and the phones send their next scores for it. When the organizer's device
  // is opened again it applies the same scores in the same order and saves the rounds everyone has been playing.
  // An entry may carry k, the players of the court it was sent for (courtKey): it is ignored for any other court,
  // so a score can never land on a match it was not meant for.
  function courtKey(c) { return sideIds(c, 'a').join('+') + '|' + sideIds(c, 'b').join('+'); }
  function pendingPlayerScores(session, roundNo, entries) {
    var cur = currentRound(session), out = [];
    if (!entries || session.status !== 'live' || !cur || cur.n !== roundNo) return out;
    var max = roundSetTo(session, cur);
    Object.keys(entries).sort().forEach(function (key) {
      var e = entries[key], idx = Number(String(key).replace(/^c/, '')), c = cur.courts[idx];
      if (!e || !c || c.void || typeof e.sa !== 'number' || typeof e.sb !== 'number' || typeof e.at !== 'number') return;
      if (e.k && e.k !== courtKey(c)) return;
      if (e.sa % 1 || e.sb % 1 || e.sa < 0 || e.sb < 0 || e.sa > max || e.sb > max) return;
      var w = e.sa > e.sb ? 'a' : e.sb > e.sa ? 'b' : (e.w === 'a' || e.w === 'b' ? e.w : null);
      if (!w || c.pat === e.at) return;
      out.push({ idx: idx, court: c.court, sa: e.sa, sb: e.sb, w: w, at: e.at, by: e.by || null });
    });
    return out;
  }
  function applyPlayerScores(session, roundNo, entries) {
    var out = { applied: [], advanced: false };
    var list = pendingPlayerScores(session, roundNo, entries);
    for (var i = 0; i < list.length; i++) {
      var p = list[i], c = session.rounds[roundNo - 1].courts[p.idx];
      c.pat = p.at;
      var res = setScore(session, roundNo, p.idx, p.sa, p.sb, p.w);
      if (res.ok) out.applied.push(p);
      if (res.advanced) { out.advanced = true; break; }   // the round is over: anything left belongs to the past
    }
    return out;
  }

  // Everything the phones have sent, applied: the round being played, then each round that follows from it.
  // all: { r3: { c0: {...}, c1: {...} }, r4: {...} }. Changes the session in place.
  function applyAllPlayerScores(session, all) {
    var out = { applied: [], advanced: 0 };
    for (var guard = 0; guard < 80; guard++) {
      var cur = currentRound(session);
      if (session.status !== 'live' || !cur) break;
      var res = applyPlayerScores(session, cur.n, (all || {})['r' + cur.n]);
      res.applied.forEach(function (p) { p.round = cur.n; out.applied.push(p); });
      if (!res.advanced) break;
      out.advanced++;
    }
    return out;
  }
  // The night as it stands for everyone: what is saved, plus the scores the phones have sent since. A copy.
  function withPlayerScores(session, all) {
    if (!session || session.status !== 'live' || !all) return session;
    var copy = normalize(clone(session));
    applyAllPlayerScores(copy, all);
    return copy;
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
  // Tonight's table. Whoever was removed during the night is not on it; withLeft: they are (marked left), because
  // the points they won still count for the month.
  function leaderboard(session, withLeft) {
    var st = teamStats(session), rows = {};
    teamList(session).forEach(function (t) {
      var s = st[t.id];
      if (t.left && (!withLeft || !s.played)) return;
      scoringEntities(t, session.scoring).forEach(function (e) {
        var r = rows[e.key] || (rows[e.key] = { key: e.key, name: e.name, players: e.players, points: 0, wins: 0, played: 0, diff: 0, sitOuts: 0, left: true });
        if (!t.left) r.left = false;
        r.points += s.points; r.wins += s.wins; r.played += s.played; r.diff += s.points - s.against; r.sitOuts += s.satOut;
      });
    });
    return rankRows(Object.keys(rows).map(function (k) { return rows[k]; }));
  }
  // The small record saved for every night; the monthly table is the sum of these.
  function resultsDoc(session) {
    var entries = {};
    leaderboard(session, true).forEach(function (r) {
      if (!r.played) return;
      entries[r.key] = { name: r.name, players: r.players, points: r.points, wins: r.wins, played: r.played, diff: r.diff };   // diff (games won minus lost) only breaks ties
      if (r.left) entries[r.key].left = true;            // removed during the night: counts for the month, not shown for the night
    });
    var doc = {
      date: session.date, status: session.status, scoring: session.scoring, format: session.format,
      rounds: session.rounds.filter(roundComplete).length, entries: entries
    };
    if (session.start) doc.start = session.start;        // when it began: decides "today" or "tonight" wherever the results are shown
    if (multOf(session) > 1) doc.mult = multOf(session); // a double points night (the points saved here are already doubled)
    return doc;
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
        var r = rows[key] || (rows[key] = { key: key, name: e.name, players: e.players, points: 0, wins: 0, played: 0, diff: 0, nights: 0 });
        r.name = e.name || r.name; r.players = e.players || r.players;
        r.points += e.points || 0; r.wins += e.wins || 0; r.played += e.played || 0; r.diff += e.diff || 0; if (!doc.brought) r.nights++;
      });
    });
    return rankRows(Object.keys(rows).map(function (k) { return rows[k]; }));
  }
  // A social can keep ONE table for all its nights instead of a table per month (series.table), for a league or a
  // "Fall Series": table.name is what it is called ("Fall Series"), and table.start the points everyone brings along
  // from before the social was run here ({ key: { name, points } }). tableDocs puts those starting points with the
  // nights' results (resultsByMonth: { '2026-11': { sessionId: doc } }), ready for monthlyBoard.
  // table.present: the table only lists whoever is on the list of the night being played (or of the latest night),
  // each with the points brought along plus the night's; people who are not there that night are left out (tableHere).
  function tableOf(series) { var t = series && series.table; return t && typeof t === 'object' ? t : null; }
  // table.others (a number): besides them, that many of the best placed who are NOT there that night ("tonight's 13 and
  // the top 7 of the rest"). Whoever is on the night's list without any points yet is listed too, with 0.
  function tableHere(rows, keys, others) {
    var have = {}, all = rows.slice(), left = Math.max(0, Math.floor(Number(others) || 0));
    rows.forEach(function (r) { have[r.key] = true; });
    Object.keys(keys).forEach(function (k) {
      var e = keys[k];
      if (!have[k] && e && e.name) all.push({ key: k, name: e.name, players: e.players || [e.name], points: 0, wins: 0, played: 0, diff: 0, nights: 0 });
    });
    rankRows(all);                                       // best first, so "the top 7 of the rest" are the first 7 met
    return rankRows(all.filter(function (r) { return keys[r.key] ? true : left-- > 0; }));
  }
  // Everyone on a night's list (session), by the key they have on a table: { key: { name, players } }.
  // Someone who was taken off the list without playing is not on it.
  function sessionKeys(session) {
    var keys = {}, st = teamStats(session);
    teamList(session).forEach(function (t) {
      if (t.left && !st[t.id].played) return;
      scoringEntities(t, session.scoring).forEach(function (e) { keys[e.key] = { name: e.name, players: e.players }; });
    });
    return keys;
  }
  function tableDocs(series, resultsByMonth) {
    var t = tableOf(series), docs = {};
    if (!t) return docs;
    var start = {}, any = false;
    Object.keys(t.start || {}).forEach(function (key) {
      var e = t.start[key];
      if (!e || !e.name) return;
      start[key] = { name: e.name, players: e.players ? toArray(e.players) : [e.name], points: Number(e.points) || 0, wins: 0, played: 0, diff: 0 }; any = true;
    });
    if (any) docs['0-start'] = { date: '0000-00-00', brought: true, entries: start };   // (brought: not a night that was played)
    Object.keys(resultsByMonth || {}).forEach(function (m) {
      Object.keys(resultsByMonth[m] || {}).forEach(function (sid) { if (resultsByMonth[m][sid]) docs[sid] = resultsByMonth[m][sid]; });
    });
    return docs;
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
    RULES: RULES, FORMATS: FORMATS, formatOf: formatOf, isSolo: isSolo, isRR: isRR, isLadder: isLadder, multOf: multOf, tableOf: tableOf, tableDocs: tableDocs, tableHere: tableHere, sessionKeys: sessionKeys, rankRows: rankRows, sideIds: sideIds, courtIds: courtIds, sideOf: sideOf, sideName: sideName,
    newSession: newSession, normalize: normalize, localDate: localDate, localTime: localTime, isDaytime: isDaytime, dayWord: dayWord, clone: clone, randomId: randomId,
    teamList: teamList, activeTeams: activeTeams, currentRound: currentRound,
    roundComplete: roundComplete, roundHasScores: roundHasScores, courtDone: courtDone,
    teamStats: teamStats, generateRound: generateRound,
    addTeam: addTeam, renameTeam: renameTeam, removeTeam: removeTeam, startNight: startNight, endNight: endNight, reopenNight: reopenNight,
    advance: advance, redrawRound: redrawRound, rewindTo: rewindTo, swapPlaces: swapPlaces,
    isWheel: isWheel, wheelPlan: wheelPlan, wheelSpin: wheelSpin, wheelRelease: wheelRelease, wheelState: wheelState, wheelStandings: wheelStandings, roundSetTo: roundSetTo, roundRobin: roundRobin, setScore: setScore, setCourts: setCourts, isKingsCourt: isKingsCourt,
    pendingPlayerScores: pendingPlayerScores, applyAllPlayerScores: applyAllPlayerScores, withPlayerScores: withPlayerScores, courtKey: courtKey, applyPlayerScores: applyPlayerScores,
    scoringEntities: scoringEntities, entityKey: entityKey, keyOf: keyOf, teamName: teamName,
    leaderboard: leaderboard, resultsDoc: resultsDoc, monthlyBoard: monthlyBoard,
    diffPaths: diffPaths
  };
});
