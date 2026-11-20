'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, rng, makeNight, playRound, playNight, history } = require('./helpers.js');

const TOP = 4; // level of King's Court with 5 courts

function checkRoundShape(s, r, expectPlaying, expectSitting) {
  const active = E.activeTeams(s).map(t => t.id);
  const seen = [];
  r.courts.forEach(c => {
    assert.ok(c.a && c.b, `round ${r.n} court ${c.court} has two teams`);
    assert.notEqual(c.a, c.b);
    seen.push(c.a, c.b);
  });
  r.sitting.forEach(id => seen.push(id));
  assert.equal(new Set(seen).size, seen.length, `round ${r.n}: no team appears twice`);
  if (expectPlaying !== undefined) assert.equal(r.courts.length * 2, expectPlaying);
  if (expectSitting !== undefined) assert.equal(r.sitting.length, expectSitting);
  return { seen, active };
}

test('14 teams, 5 courts, 8 rounds: every round has 10 playing and 4 sitting, nobody twice', () => {
  const s = playNight(makeNight({ teams: 14, seed: 7 }), 8, 42);
  assert.equal(s.rounds.length, 9, 'round 9 is generated automatically after round 8 is scored');
  s.rounds.forEach(r => {
    const { seen } = checkRoundShape(s, r, 10, 4);
    assert.equal(seen.length, 14);
    assert.deepEqual(r.courts.map(c => c.court), [7, 6, 5, 4, 3], 'King\'s Court first');
  });
});

test('14 teams, 5 courts, 8 rounds: sit-outs are spread evenly and never back to back', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = playNight(makeNight({ teams: 14, seed }), 8, seed * 13);
    const h = history(s);
    const counts = Object.keys(h).map(id => h[id].slice(0, 8).filter(x => x === 'sit').length);
    const min = Math.min(...counts), max = Math.max(...counts);
    assert.ok(max - min <= 1, `seed ${seed}: sit-outs between ${min} and ${max}`);
    assert.equal(counts.reduce((a, b) => a + b, 0), 32);
    Object.keys(h).forEach(id => {
      for (let i = 1; i < 8; i++) assert.ok(!(h[id][i] === 'sit' && h[id][i - 1] === 'sit'), `seed ${seed}: ${id} sat twice in a row`);
    });
  }
});

test('no sit-outs (10 teams, 5 courts): winners move up one, losers move down one, ends stay', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = playNight(makeNight({ teams: 10, seed }), 8, seed * 7);
    const h = history(s);
    Object.keys(h).forEach(id => {
      for (let i = 1; i < 8; i++) {
        const prev = h[id][i - 1], now = h[id][i];
        const expected = prev.won ? Math.min(TOP, prev.level + 1) : Math.max(0, prev.level - 1);
        assert.equal(now.level, expected, `seed ${seed} ${id} round ${i + 1}`);
      }
    });
  }
});

test('with sit-outs: a returning team comes back on the court it left or higher', () => {
  let returns = 0, lower = 0, lowerAfterWin = 0, winnersNotUp = 0, winnerReturns = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = playNight(makeNight({ teams: 14, seed }), 8, seed * 31);
    const h = history(s);
    Object.keys(h).forEach(id => {
      let last = null;
      for (let i = 0; i < 8; i++) {
        const now = h[id][i];
        if (now === 'sit') continue;
        if (last && i > 0 && h[id][i - 1] === 'sit') {
          returns++;
          if (now.level < last.level) { lower++; if (last.won) lowerAfterWin++; }
          if (last.won) { winnerReturns++; if (now.level < Math.min(TOP, last.level + 1)) winnersNotUp++; }
        }
        last = now;
      }
    });
  }
  assert.ok(returns > 5000);
  // The only exception allowed: a team that lost before sitting, when the alternative is moving down a team that just won.
  assert.equal(lowerAfterWin, 0, 'a team that won before sitting out never comes back lower');
  assert.ok(lower / returns < 0.005, `${lower} of ${returns} returns came back lower than the court they left`);
  assert.ok(winnersNotUp / winnerReturns < 0.12, `${winnersNotUp} of ${winnerReturns} winners did not get their move up after sitting out`);
});

test('with sit-outs: teams that keep playing never move the wrong way', () => {
  let moves = 0, exact = 0, winnerDown = 0, loserUp = 0, far = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = playNight(makeNight({ teams: 14, seed }), 8, seed * 17);
    const h = history(s);
    Object.keys(h).forEach(id => {
      for (let i = 1; i < 8; i++) {
        const prev = h[id][i - 1], now = h[id][i];
        if (!prev || prev === 'sit' || now === 'sit') continue;
        moves++;
        const expected = prev.won ? Math.min(TOP, prev.level + 1) : Math.max(0, prev.level - 1);
        if (now.level === expected) exact++;
        if (prev.won && now.level < prev.level) winnerDown++;
        if (!prev.won && now.level > prev.level) loserUp++;
        if (Math.abs(now.level - expected) > 1) far++;
      }
    });
  }
  assert.equal(winnerDown, 0, 'a team that won and keeps playing never drops a court');
  assert.equal(loserUp, 0, 'a team that lost and keeps playing never climbs a court');
  assert.ok(far / moves < 0.02, `${far} of ${moves} moves landed more than one court from the normal move`);
  assert.ok(exact / moves > 0.7, `only ${(100 * exact / moves).toFixed(1)}% of moves were the normal one-court move`);
});

test('a team that wins every match ends on the top courts even after sitting out', () => {
  let onTop = 0, topTwo = 0, runs = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const s = makeNight({ teams: 14, seed });
    const champ = E.teamList(s)[seed % 14].id;
    playNight(s, 8, seed * 5, champ);
    const h = history(s)[champ];
    assert.ok(h.slice(0, 8).filter(x => x === 'sit').length >= 2, 'the winning team still takes its turns sitting out');
    const finalSpot = h[8] === 'sit' ? h[7] : h[8]; // where it stands after round 8
    runs++;
    if (finalSpot !== 'sit' && finalSpot.level === TOP) onTop++;
    if (finalSpot !== 'sit' && finalSpot.level >= TOP - 1) topTwo++;
  }
  assert.equal(topTwo, runs, `${topTwo}/${runs} finished on the top two courts`);
  assert.ok(onTop / runs > 0.9, `${onTop}/${runs} finished on King's Court`);
});

test('same seed gives the same draw; re-draw gives a different one', () => {
  const a = playNight(makeNight({ teams: 14, seed: 5 }), 3, 77);
  const b = playNight(makeNight({ teams: 14, seed: 5 }), 3, 77);
  const strip = s => s.rounds.map(r => r.courts.map(c => [s.teams[c.a].name, s.teams[c.b].name, c.sa, c.sb]));
  assert.deepEqual(strip(a), strip(b));
  const c = makeNight({ teams: 14, seed: 5 });
  E.startNight(c);
  const before = JSON.stringify(c.rounds[0].courts.map(x => [c.teams[x.a].name, c.teams[x.b].name]));
  assert.ok(E.redrawRound(c));
  const after = JSON.stringify(c.rounds[0].courts.map(x => [c.teams[x.a].name, c.teams[x.b].name]));
  assert.notEqual(before, after);
});

test('seeded round 1 follows the team list order from King\'s Court down', () => {
  const s = makeNight({ teams: 10, round1: 'seeded', seed: 3 });
  E.startNight(s);
  const names = s.rounds[0].courts.map(c => [s.teams[c.a].name, s.teams[c.b].name]);
  assert.deepEqual(names[0], ['Team 01', 'Team 02']);
  assert.deepEqual(names[4], ['Team 09', 'Team 10']);
});

test('odd numbers and small nights: 7 teams use 3 courts (top ones) with 1 sitting; 3 teams use 1 court', () => {
  const s = playNight(makeNight({ teams: 7, seed: 9 }), 6, 3);
  s.rounds.forEach(r => {
    checkRoundShape(s, r, 6, 1);
    assert.deepEqual(r.courts.map(c => c.court), [7, 6, 5]);
  });
  const h = history(s);
  const counts = Object.keys(h).map(id => h[id].slice(0, 6).filter(x => x === 'sit').length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  const tiny = playNight(makeNight({ teams: 3, seed: 2 }), 4, 3);
  tiny.rounds.forEach(r => { checkRoundShape(tiny, r, 2, 1); assert.equal(r.courts[0].court, 7); });
});

test('late arrival joins the next round, plays before it sits, and enters on the bottom court', () => {
  const s = makeNight({ teams: 14, seed: 11 });
  const rand = rng(5);
  E.startNight(s);
  playRound(s, rand); playRound(s, rand);          // rounds 1-2 done, round 3 on court
  const late = E.addTeam(s, ['Late', 'Couple']);
  assert.equal(late.name, 'Late & Couple');
  assert.ok(late.sitCredit >= 0);
  const r3 = E.currentRound(s);
  assert.ok(!r3.sitting.includes(late.id) && !r3.courts.some(c => c.a === late.id || c.b === late.id), 'not in the round already on court');
  playRound(s, rand);                               // round 3 done -> round 4 generated with 15 teams
  const r4 = E.currentRound(s);
  checkRoundShape(s, r4, 10, 5);
  const spot = r4.courts.filter(c => c.a === late.id || c.b === late.id)[0];
  assert.ok(spot, 'the late team plays in its first round');
  assert.equal(spot.level, 0, 'and starts on the bottom court');
  for (let n = 4; n <= 8; n++) playRound(s, rand);
  const st = E.teamStats(s, 8);
  const sits = E.activeTeams(s).map(t => st[t.id].sitOuts);
  assert.ok(Math.max(...sits) - Math.min(...sits) <= 1, 'sit-outs stay level after the late arrival: ' + sits.join(','));
});

test('removing a team mid-round: a sitting team steps in; with nobody sitting the other team keeps its place', () => {
  const s = makeNight({ teams: 14, seed: 21 });
  const rand = rng(8);
  E.startNight(s);
  playRound(s, rand);
  const r2 = E.currentRound(s);
  const leaving = r2.courts[2].a, stays = r2.courts[2].b;
  const out = E.removeTeam(s, leaving);
  assert.ok(out.substitute, 'a sitting team was moved onto the court');
  assert.equal(r2.courts[2].a, out.substitute);
  assert.equal(r2.courts[2].b, stays);
  assert.equal(r2.sitting.length, 3);
  assert.equal(s.teams[leaving].left, 2);
  playRound(s, rand);
  const r3 = E.currentRound(s);
  checkRoundShape(s, r3, 10, 3);
  assert.ok(!r3.sitting.includes(leaving) && !r3.courts.some(c => c.a === leaving || c.b === leaving));

  const t = makeNight({ teams: 10, seed: 4 });       // nobody sitting
  E.startNight(t);
  const c0 = t.rounds[0].courts[1], gone = c0.b, kept = c0.a;
  const res = E.removeTeam(t, gone);
  assert.equal(res.voided, c0.court);
  assert.ok(c0.void && c0.w === 'a');
  playRound(t, rng(1));
  const next = E.currentRound(t);
  assert.equal(next.n, 2);
  checkRoundShape(t, next, 8, 1);                    // 9 teams: 4 courts, 1 sits
  assert.ok(E.teamStats(t)[kept].played === 0, 'no points for a match that was not played');
});

test('scoring: every game won is a point, for the couple', () => {
  const s = makeNight({ teams: 4, courts: [1, 2], seed: 1 });
  E.startNight(s);
  const r = s.rounds[0];
  E.setScore(s, 1, 0, 4, 2);
  E.setScore(s, 1, 1, 1, 4);
  const lb = E.leaderboard(s);
  const pts = id => lb.filter(x => x.name === s.teams[id].name)[0].points;
  assert.equal(pts(r.courts[0].a), 4); assert.equal(pts(r.courts[0].b), 2);
  assert.equal(pts(r.courts[1].a), 1); assert.equal(pts(r.courts[1].b), 4);
  assert.equal(lb[0].rank, 1); assert.equal(lb[1].rank, 1, 'equal points share a rank');
  assert.equal(lb[2].rank, 3);
  assert.equal(s.rounds.length, 2, 'next round generated once all courts are scored');
});

test('correcting a score: points always update; the next round is redone if the winner changes before anyone has played it', () => {
  const s = makeNight({ teams: 4, courts: [1, 2], seed: 1 });
  E.startNight(s);
  const top = s.rounds[0].courts[0];
  E.setScore(s, 1, 0, 4, 2);
  E.setScore(s, 1, 1, 4, 0);
  assert.equal(s.rounds[1].courts[0].a === top.a || s.rounds[1].courts[0].b === top.a, true, 'winner stays on King\'s Court');
  const fix = E.setScore(s, 1, 0, 2, 4);              // mistyped: the other team actually won
  assert.ok(fix.regenerated);
  assert.equal(s.rounds.length, 2);
  assert.ok(s.rounds[1].courts[0].a === top.b || s.rounds[1].courts[0].b === top.b, 'the real winner is now on King\'s Court');
  assert.equal(E.teamStats(s)[top.a].points, 2);
  E.setScore(s, 2, 0, 4, 1);                          // round 2 under way
  const late = E.setScore(s, 1, 1, 0, 4);
  assert.ok(late.tooLate && !late.regenerated, 'positions stay once the next round has scores');
  assert.equal(s.rounds[1].courts[0].sa, 4, 'round 2 scores are untouched');
});

test('level scores need a chosen winner', () => {
  const s = makeNight({ teams: 4, courts: [1, 2], seed: 1 });
  E.startNight(s);
  assert.equal(E.setScore(s, 1, 0, 3, 3).ok, false);
  assert.equal(E.setScore(s, 1, 0, 3, 3, 'b').ok, true);
  assert.equal(s.rounds[0].courts[0].w, 'b');
  const st = E.teamStats(s);
  assert.equal(st[s.rounds[0].courts[0].a].points, 3);
});

test('sets are played to 4 or to 6 games: scores above the set length are refused, never 7', () => {
  const s = makeNight({ teams: 4, courts: [1, 2], seed: 1 });
  assert.equal(s.setTo, 4, 'sets to 4 by default');
  E.startNight(s);
  assert.equal(E.setScore(s, 1, 0, 5, 3).ok, false, '5 is not possible in a set to 4');
  assert.equal(s.rounds[0].courts[0].w, null, 'a refused score changes nothing');
  assert.equal(E.setScore(s, 1, 0, 4, 3).ok, true);
  s.setTo = 6;
  assert.equal(E.setScore(s, 1, 1, 6, 4).ok, true, '6-4 is fine in a set to 6');
  assert.equal(E.teamStats(s)[s.rounds[0].courts[1].a].points, 6);
  assert.equal(E.setScore(s, 2, 0, 7, 5).ok, false, '7 is never possible');
  assert.equal(E.normalize({ setTo: 9, teams: {}, rounds: [] }).setTo, 4, 'anything other than 6 means 4');
  assert.equal(E.newSession({ setTo: 6 }).setTo, 6);
});

test('courts can be renumbered mid-night: unscored matches move at once, scored ones keep their court', () => {
  const s = makeNight({ teams: 14, seed: 6 });
  const rand = rng(3);
  E.startNight(s); playRound(s, rand);
  const r2 = E.currentRound(s);
  E.setScore(s, 2, 0, 4, 1);                                   // King's Court already scored
  const lineup = r2.courts.map(c => [c.a, c.b].join());
  const out = E.setCourts(s, [1, 2, 5, 6, 7]);                 // courts 3 and 4 swapped for 1 and 2
  assert.equal(out.moved, 2);
  assert.deepEqual(r2.courts.map(c => c.court), [7, 6, 5, 2, 1]);
  assert.deepEqual(r2.courts.map(c => [c.a, c.b].join()), lineup, 'nobody changes opponent');
  playRound(s, rand);
  assert.deepEqual(E.currentRound(s).courts.map(c => c.court), [7, 6, 5, 2, 1], 'later rounds use the new numbers');
  assert.deepEqual(s.rounds[0].courts.map(c => c.court), [7, 6, 5, 4, 3], 'earlier rounds keep the courts they were played on');
});

test('fewer or more courts mid-night: King\'s Court stays the anchor and nobody is lost', () => {
  // 10 teams on 5 courts, then court 3 is taken away before round 3 has any scores
  const s = makeNight({ teams: 10, seed: 8 });
  const rand = rng(11);
  E.startNight(s); playRound(s, rand); playRound(s, rand);
  const r2 = s.rounds[1];
  const kingWinner = r2.courts[0].w === 'a' ? r2.courts[0].a : r2.courts[0].b;
  const sixWinner = r2.courts[1].w === 'a' ? r2.courts[1].a : r2.courts[1].b;
  const out = E.setCourts(s, [4, 5, 6, 7]);
  assert.ok(out.redrawn, 'round 3 had no scores, so it is drawn again');
  const r3 = E.currentRound(s);
  assert.equal(r3.n, 3);
  assert.deepEqual(r3.courts.map(c => c.court), [7, 6, 5, 4]);
  assert.equal(r3.sitting.length, 2);
  const seen = r3.sitting.concat(...r3.courts.map(c => [c.a, c.b]));
  assert.equal(new Set(seen).size, 10, 'all 10 teams are either on a court or sitting');
  const onKing = [r3.courts[0].a, r3.courts[0].b];
  [kingWinner, sixWinner].forEach(id => assert.ok(onKing.includes(id) || r3.sitting.includes(id), 'the teams that earned King\'s Court are on it (or sitting)'));
  assert.ok(E.isKingsCourt(s, r3, r3.courts[0]) && E.isKingsCourt(s, r2, r2.courts[0]));

  // 12 teams on 4 courts; two more courts open while round 2 is being played
  const t = makeNight({ teams: 12, courts: [4, 5, 6, 7], seed: 3 });
  E.startNight(t); playRound(t, rand);
  E.setScore(t, 2, 1, 4, 2);
  const res = E.setCourts(t, [2, 3, 4, 5, 6, 7]);
  assert.ok(res.nextRound && !res.redrawn);
  assert.deepEqual(E.currentRound(t).courts.map(c => c.court), [7, 6, 5, 4], 'the round on court finishes where it is');
  playRound(t, rand);
  const next = E.currentRound(t);
  assert.deepEqual(next.courts.map(c => c.court), [7, 6, 5, 4, 3, 2]);
  assert.equal(next.sitting.length, 0, 'with 6 courts all 12 teams play');
  const prevTop = t.rounds[1].courts[0];
  const stays = prevTop.w === 'a' ? prevTop.a : prevTop.b;
  assert.ok([next.courts[0].a, next.courts[0].b].includes(stays), 'King\'s Court winner is still on King\'s Court');
});

test('a whole night with court changes keeps sit-outs fair', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = makeNight({ teams: 14, seed });
    const rand = rng(seed * 7);
    E.startNight(s);
    for (let n = 1; n <= 8; n++) {
      if (n === 3) E.setCourts(s, [1, 2, 5, 6, 7]);            // same number, different courts
      if (n === 5) E.setCourts(s, [2, 5, 6, 7]);               // down to 4 courts
      if (n === 7) E.setCourts(s, [1, 2, 3, 5, 6, 7]);         // up to 6 courts
      const r = E.currentRound(s);
      const seen = r.sitting.concat(...r.courts.map(c => [c.a, c.b]));
      assert.equal(seen.length, 14); assert.equal(new Set(seen).size, 14, `seed ${seed} round ${n}`);
      playRound(s, rand);
    }
    const st = E.teamStats(s, 8);
    const sits = Object.keys(st).map(id => st[id].sitOuts);
    assert.ok(Math.max(...sits) - Math.min(...sits) <= 1, `seed ${seed}: sit-outs ${sits.join(',')}`);
  }
});

test('scores sent from phones: applied once, only for the round on court, and the last one starts the next round', () => {
  const s = makeNight({ teams: 10, seed: 5 });                 // 5 courts, nobody sitting
  E.startNight(s);
  const r1 = s.rounds[0];
  const entries = { c0: { sa: 4, sb: 2, by: r1.courts[0].a, at: 1001 }, c2: { sa: 1, sb: 4, by: r1.courts[2].b, at: 1002 } };
  assert.equal(E.pendingPlayerScores(s, 1, entries).length, 2);
  let out = E.applyPlayerScores(s, 1, entries);
  assert.equal(out.applied.length, 2); assert.equal(out.advanced, false);
  assert.equal(r1.courts[0].w, 'a'); assert.equal(r1.courts[2].w, 'b');
  assert.equal(E.pendingPlayerScores(s, 1, entries).length, 0, 'the same entries are not applied twice');

  E.setScore(s, 1, 0, 3, 4);                                   // organizer corrects court 0 by hand
  E.applyPlayerScores(s, 1, entries);
  assert.equal(r1.courts[0].sa, 3, 'an old phone entry does not undo the organizer\'s correction');

  entries.c0 = { sa: 4, sb: 1, by: r1.courts[0].b, at: 2001 }; // the players send a new score for court 0
  E.applyPlayerScores(s, 1, entries);
  assert.equal(r1.courts[0].sa, 4, 'a newer phone entry does count while the round is on');

  const bad = { c1: { sa: 9, sb: 2, at: 3001 }, c3: { sa: 3, sb: 3, at: 3002 }, c9: { sa: 4, sb: 0, at: 3003 }, c4: { sa: '4', sb: 0, at: 3004 } };
  assert.equal(E.pendingPlayerScores(s, 1, bad).length, 0, 'out-of-range, level-without-winner, unknown court and non-number entries are ignored');

  const rest = { c1: { sa: 4, sb: 0, at: 4001 }, c3: { sa: 3, sb: 3, w: 'b', at: 4002 }, c4: { sa: 2, sb: 4, at: 4003 } };
  out = E.applyPlayerScores(s, 1, rest);
  assert.equal(out.applied.length, 3); assert.ok(out.advanced, 'the last court coming in starts round 2');
  assert.equal(s.rounds.length, 2);
  assert.equal(r1.courts[3].w, 'b');
  assert.equal(E.pendingPlayerScores(s, 1, { c0: { sa: 0, sb: 4, at: 5001 } }).length, 0, 'a finished round no longer takes phone scores');
  const lb = E.leaderboard(s);
  assert.equal(lb.reduce((a, r) => a + r.points, 0), 4 + 1 + 4 + 0 + 1 + 4 + 3 + 3 + 2 + 4);
});

test('ending the night drops an unplayed round; monthly table sums the nights of the month', () => {
  const nights = {};
  ['2026-11-06', '2026-11-13', '2026-11-20'].forEach((date, i) => {
    const s = playNight(makeNight({ teams: 14, seed: i + 1, date }), 6, i + 50);
    E.endNight(s);
    assert.equal(s.rounds.length, 6, 'round 7 was generated but never played, so it is dropped');
    nights[s.id] = E.resultsDoc(s);
  });
  const month = E.monthlyBoard(nights);
  assert.equal(month.length, 14);
  const total = month.reduce((a, r) => a + r.points, 0);
  const expected = Object.keys(nights).reduce((a, id) => a + Object.keys(nights[id].entries).reduce((b, k) => b + nights[id].entries[k].points, 0), 0);
  assert.equal(total, expected);
  assert.ok(month.every(r => r.nights === 3));
  assert.ok(month[0].points >= month[13].points);
});

test('per-player scoring (for later formats): each player gets the team\'s games', () => {
  const s = E.newSession({ courts: [1], scoring: 'player', seed: 1 });
  E.addTeam(s, ['Ana', 'Luis']); E.addTeam(s, ['Bea', 'Marco']);
  E.startNight(s);
  const c = s.rounds[0].courts[0];
  E.setScore(s, 1, 0, 4, 3);
  const lb = E.leaderboard(s);
  assert.equal(lb.length, 4);
  const winners = s.teams[c.a].players;
  winners.forEach(p => assert.equal(lb.filter(x => x.name === p)[0].points, 4));
});

test('the same couple typed in either order is one entry on the monthly table', () => {
  assert.equal(E.entityKey(['Ana', 'Luis']), E.entityKey([' luis ', 'ANA']));
  const s = E.newSession({ courts: [1] });
  assert.ok(E.addTeam(s, ['Ana', 'Luis']));
  assert.equal(E.addTeam(s, ['Luis', 'Ana']), null, 'adding the same couple twice is ignored');
});

test('database round trip: empty lists and blanks are restored, and edits become small writes', () => {
  const s = playNight(makeNight({ teams: 10, seed: 2 }), 2, 9);
  const stored = JSON.parse(JSON.stringify(s, (k, v) => (v === null || (Array.isArray(v) && !v.length)) ? undefined : v));
  const back = E.normalize(stored);
  assert.deepEqual(back.rounds[2].sitting, []);
  assert.equal(back.rounds[2].courts[0].w, null);
  const before = E.clone(s);
  E.setScore(s, 3, 0, 4, 1);
  const d = E.diffPaths(before, s);
  assert.deepEqual(Object.keys(d).sort(), ['rounds/2/courts/0/sa', 'rounds/2/courts/0/sb', 'rounds/2/courts/0/w']);
  const fresh = E.diffPaths(null, s);
  assert.deepEqual(Object.keys(fresh), [''], 'a night that is not saved yet is written whole, at its own path');
  assert.equal(fresh[''].id, s.id);
  assert.deepEqual(E.diffPaths(s, null), { '': null }, 'and removed whole');
  assert.deepEqual(E.diffPaths(s, E.clone(s)), {}, 'no change, no write');
});
