'use strict';
// Wheel of Fortune: the wheel pairs players up; how the day runs depends on how many came.
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, rng } = require('./helpers.js');

function day(players, courts, seed) {
  const s = E.newSession({ seriesId: 'wheel', date: '2026-11-21', courts: courts || [6, 7], seed: seed || 1, format: 'wheel' });
  for (let i = 1; i <= players; i++) E.addTeam(s, ['P' + String(i).padStart(2, '0')]);
  return s;
}
const ids = s => E.activeTeams(s).map(t => t.id);
const pairKey = p => p.slice().sort().join('+');
// Play the current round: side A wins unless `pick` says otherwise.
function play(s, pick) {
  const r = E.currentRound(s);
  r.courts.forEach((c, i) => {
    if (c.void || c.w) return;
    const aWins = pick ? pick(c, i, r) : true, top = r.setTo;
    const res = E.setScore(s, r.n, i, aWins ? top : 1, aWins ? 1 : top);
    assert.ok(res.ok, res.error);
  });
}
function shape(s, r) {
  const seen = [];
  r.courts.forEach(c => { assert.equal(E.sideIds(c, 'a').length, 2); assert.equal(E.sideIds(c, 'b').length, 2); seen.push(...E.courtIds(c)); });
  seen.push(...r.sitting);
  assert.equal(new Set(seen).size, seen.length, `round ${r.n}: nobody appears twice`);
  assert.equal(seen.length, E.activeTeams(s).length, `round ${r.n}: everyone is playing or sitting`);
}

test('wheel: a new day scores per player and has its own plans by head count', () => {
  const s = day(8);
  assert.equal(s.scoring, 'player');
  assert.ok(E.isWheel(s));
  assert.equal(E.wheelPlan(3), null);
  const stages = n => E.wheelPlan(n).stages.join(' ');
  assert.equal(stages(4), 'set');
  assert.equal(stages(5), 'set set');
  assert.equal(stages(6), 'pool pool pool');
  assert.equal(stages(7), 'pool pool pool');
  assert.equal(stages(8), 'pool pool pool semi final');
  assert.equal(stages(9), 'pool pool pool semi final');
  assert.equal(stages(10), 'pool pool pool pool pool playin semi final');
  assert.equal(stages(12), 'pool pool pool pool pool place');
  assert.equal(stages(16), 'pool pool pool pool pool place');
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n => [E.wheelPlan(n).teams, E.wheelPlan(n).sit, E.wheelPlan(n).trio]),
    [[2, 0, false], [2, 1, false], [3, 0, false], [3, 1, false], [4, 0, false], [4, 0, true], [5, 0, false], [5, 0, true], [6, 0, false], [6, 0, true]]);
});

test('wheel: fewer than four players cannot spin; no courts cannot spin', () => {
  assert.equal(E.wheelSpin(day(3)).ok, false);
  const s = day(4); s.courts = [];
  assert.equal(E.wheelSpin(s).ok, false);
  assert.equal(s.status, 'setup');
});

test('wheel, 4 players: one set to 6, then the wheel spins again; three spins give three different partners', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = day(4, [7], seed), partners = {};
    assert.ok(E.startNight(s));
    for (let spin = 1; spin <= 3; spin++) {
      assert.equal(s.wheel.spin, spin);
      const r = E.currentRound(s);
      shape(s, r);
      assert.deepEqual([r.courts.length, r.setTo, r.stage], [1, 6, 'set']);
      r.courts.forEach(c => ['a', 'b'].forEach(side => { const [x, y] = E.sideIds(c, side); (partners[x] = partners[x] || new Set()).add(y); (partners[y] = partners[y] || new Set()).add(x); }));
      assert.equal(E.wheelState(s), 'playing');
      play(s);
      assert.equal(E.wheelState(s), 'spin', 'after the set it is time to spin');
      assert.equal(s.rounds.length, spin, 'no new round until the wheel is spun');
      if (spin < 3) assert.ok(E.wheelSpin(s).ok);
    }
    Object.values(partners).forEach(set => assert.equal(set.size, 3, `seed ${seed}: everyone has partnered everyone`));
  }
});

test('wheel: set scores are checked against the set length of the round', () => {
  const s = day(8); E.startNight(s);
  assert.equal(E.setScore(s, 1, 0, 5, 2).ok, false, 'a pool set is to 4');
  assert.ok(E.setScore(s, 1, 0, 4, 3).ok);
  const t = day(4, [7]); E.startNight(t);
  assert.ok(E.setScore(t, 1, 0, 6, 4).ok, 'with four players the set is to 6');
  assert.equal(E.setScore(day(4, [7]), 1, 0, 6, 4).ok, false, 'no round before the spin');
});

test('wheel, 5 players: one sits (the organizer can choose), two sets to 6 with the same teams, then a new spin with someone else sitting', () => {
  const s = day(5, [7], 3), all = ids(s);
  assert.ok(E.startNight(s, { sit: [all[2]] }));
  assert.deepEqual(s.wheel.sit, [all[2]], 'the organizer chose who sits');
  const r1 = E.currentRound(s);
  shape(s, r1);
  assert.deepEqual(r1.sitting, [all[2]]);
  const teams1 = r1.courts.flatMap(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]).sort();
  play(s);
  const r2 = E.currentRound(s);
  assert.equal(r2.n, 2);
  assert.deepEqual(r2.courts.flatMap(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]).sort(), teams1, 'the second set is the same two teams');
  assert.deepEqual([r2.setTo, r2.title], [6, 'Set 2 of 2']);
  play(s);
  assert.equal(E.wheelState(s), 'spin');
  const sat = new Set([all[2]]);
  for (let i = 0; i < 4; i++) {                    // left alone, the app rotates: nobody sits twice before everyone has sat once
    assert.ok(E.wheelSpin(s).ok);
    assert.equal(s.wheel.sit.length, 1);
    assert.ok(!sat.has(s.wheel.sit[0]), 'a player who has not sat yet');
    sat.add(s.wheel.sit[0]);
    play(s); play(s);
  }
  assert.equal(sat.size, 5);
});

test('wheel, 6 players: three teams, everyone plays the other two, one team rests each round, then new teams', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = day(6, [7], seed);
    E.startNight(s);
    const first = s.wheel.teams.map(pairKey).sort(), met = {}, rested = [];
    for (let k = 0; k < 3; k++) {
      const r = E.currentRound(s);
      shape(s, r);
      assert.deepEqual([r.courts.length, r.setTo, r.sitting.length, r.title], [1, 4, 2, 'Round ' + (k + 1) + ' of 3']);
      const a = pairKey(E.sideIds(r.courts[0], 'a')), b = pairKey(E.sideIds(r.courts[0], 'b'));
      met[[a, b].sort().join(' v ')] = true;
      rested.push(pairKey(r.sitting));
      play(s);
    }
    assert.equal(Object.keys(met).length, 3, 'three different match-ups');
    assert.deepEqual(rested.slice().sort(), first, 'each team rested once');
    assert.equal(E.wheelState(s), 'spin');
    E.wheelSpin(s);
    const second = s.wheel.teams.map(pairKey);
    assert.ok(second.every(t => !first.includes(t)), `seed ${seed}: the second spin makes three new teams`);
  }
});

test('wheel, 7 players: as with six, with one player sitting out until the next spin', () => {
  const s = day(7, [7], 2);
  E.startNight(s);
  assert.equal(s.wheel.sit.length, 1);
  for (let k = 0; k < 3; k++) { const r = E.currentRound(s); shape(s, r); assert.ok(r.sitting.includes(s.wheel.sit[0])); assert.equal(r.sitting.length, 3); play(s); }
  const before = s.wheel.sit[0];
  E.wheelSpin(s);
  assert.notEqual(s.wheel.sit[0], before);
});

test('wheel, 8 players: same partner all day; three pool rounds to 4, semifinals 1v4 and 2v3 to 4, final to 6', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const s = day(8, [6, 7], seed), rand = rng(seed * 3);
    E.startNight(s);
    const teams = s.wheel.teams.map(pairKey), met = new Set();
    for (let k = 0; k < 3; k++) {
      const r = E.currentRound(s);
      shape(s, r);
      assert.deepEqual([r.courts.length, r.setTo, r.stage, r.title, r.sitting.length], [2, 4, 'pool', 'Pool round ' + (k + 1) + ' of 3', 0]);
      assert.deepEqual(r.courts.map(c => c.court), [7, 6]);
      r.courts.forEach(c => { const a = pairKey(E.sideIds(c, 'a')), b = pairKey(E.sideIds(c, 'b')); assert.ok(teams.includes(a) && teams.includes(b), 'pairs stay together'); met.add([a, b].sort().join(' v ')); });
      play(s, () => rand() < 0.5);
    }
    assert.equal(met.size, 6, 'everyone met everyone in the pool');
    const table = E.wheelStandings(s);
    for (let i = 1; i < 4; i++) assert.ok(table[i - 1].won > table[i].won || (table[i - 1].won === table[i].won && table[i - 1].gf >= table[i].gf), 'ranked by matches won, then games won');
    const semi = E.currentRound(s), key = t => pairKey(t.players);
    assert.deepEqual([semi.stage, semi.setTo, semi.title, semi.courts.map(c => c.label).join()], ['semi', 4, 'Semifinals', 'Semifinal,Semifinal']);
    assert.deepEqual(semi.courts.map(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]), [[key(table[0]), key(table[3])], [key(table[1]), key(table[2])]], '1st v 4th and 2nd v 3rd');
    play(s, (c, i) => i === 0);                   // 1st beats 4th, 3rd beats 2nd
    const fin = E.currentRound(s);
    assert.deepEqual([fin.stage, fin.setTo, fin.courts.length, fin.courts[0].label, fin.sitting.length], ['final', 6, 1, 'Final', 4]);
    assert.deepEqual([pairKey(E.sideIds(fin.courts[0], 'a')), pairKey(E.sideIds(fin.courts[0], 'b'))], [key(table[0]), key(table[2])]);
    assert.ok(E.isKingsCourt(s, fin, fin.courts[0]), 'the final is the highlighted court');
    assert.equal(E.wheelState(s), 'playing');
    play(s);
    assert.equal(E.wheelState(s), 'done');
    assert.equal(s.rounds.length, 5, 'nothing more is drawn after the final');
  }
});

test('wheel: points are per player, every game her team won, play-offs included', () => {
  const s = day(8, [6, 7], 4);
  E.startNight(s);
  for (let k = 0; k < 5; k++) play(s);
  const board = E.leaderboard(s), total = board.reduce((a, r) => a + r.points, 0);
  assert.equal(board.length, 8);
  let games = 0;
  s.rounds.forEach(r => r.courts.forEach(c => { games += 2 * (c.sa + c.sb); }));
  assert.equal(total, games, 'both players of a team get its games');
  const doc = E.resultsDoc(s);
  assert.deepEqual([doc.scoring, doc.format, Object.keys(doc.entries).length], ['player', 'wheel', 8]);
});

test('wheel, 8 players: correcting a pool result before the semifinals are played redraws them', () => {
  const s = day(8, [6, 7], 9);
  E.startNight(s);
  play(s); play(s); play(s);
  const semis = () => E.currentRound(s).courts.map(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]);
  const before = JSON.stringify(semis());
  const c = s.rounds[2].courts[0], out = E.setScore(s, 3, 0, c.sb, c.sa);     // the other team won after all
  assert.ok(out.ok && out.regenerated);
  assert.equal(s.rounds.length, 4);
  assert.notEqual(JSON.stringify(semis()), before, 'the semifinals follow the corrected table');
});

test('wheel, 9 players: one team of three; its players take turns resting, everyone else plays every round', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const s = day(9, [6, 7], seed);
    E.startNight(s);
    const trio = s.wheel.teams.find(t => t.length === 3), rests = [];
    assert.ok(trio, 'one team has three players');
    assert.equal(s.wheel.teams.filter(t => t.length === 2).length, 3);
    for (let k = 0; k < 3; k++) {
      const r = E.currentRound(s);
      shape(s, r);
      assert.equal(r.sitting.length, 1);
      assert.ok(trio.includes(r.sitting[0]), 'the one resting is from the team of three');
      rests.push(r.sitting[0]);
      play(s);
    }
    assert.equal(new Set(rests).size, 3, `seed ${seed}: each of the three rested once in the pool`);
    assert.equal(E.currentRound(s).stage, 'semi');
  }
});

test('wheel, 10 players: five pool rounds with one team resting, then 4th v 5th, semifinals and a final, all to 4', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const s = day(10, [6, 7], seed), rand = rng(seed * 7);
    E.startNight(s);
    const rested = [], met = new Set();
    for (let k = 0; k < 5; k++) {
      const r = E.currentRound(s);
      shape(s, r);
      assert.deepEqual([r.courts.length, r.setTo, r.sitting.length, r.title], [2, 4, 2, 'Pool round ' + (k + 1) + ' of 5']);
      rested.push(pairKey(r.sitting));
      r.courts.forEach(c => met.add([pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))].sort().join(' v ')));
      play(s, () => rand() < 0.5);
    }
    assert.equal(new Set(rested).size, 5, 'each team rested once');
    assert.equal(met.size, 10, 'everyone met everyone');
    const table = E.wheelStandings(s), key = i => pairKey(table[i].players);
    const playin = E.currentRound(s);
    assert.deepEqual([playin.stage, playin.setTo, playin.courts.length, playin.sitting.length], ['playin', 4, 1, 6]);
    assert.deepEqual([pairKey(E.sideIds(playin.courts[0], 'a')), pairKey(E.sideIds(playin.courts[0], 'b'))], [key(3), key(4)], '4th v 5th');
    play(s, () => false);                         // 5th wins
    const semi = E.currentRound(s);
    assert.deepEqual(semi.courts.map(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]), [[key(0), key(4)], [key(1), key(2)]], '1st v the play-in winner, 2nd v 3rd');
    assert.equal(semi.sitting.length, 2);
    play(s);
    const fin = E.currentRound(s);
    assert.deepEqual([fin.stage, fin.setTo, pairKey(E.sideIds(fin.courts[0], 'a')), pairKey(E.sideIds(fin.courts[0], 'b'))], ['final', 4, key(0), key(1)]);
    play(s);
    assert.equal(E.wheelState(s), 'done');
    assert.equal(s.rounds.length, 8);
  }
});

test('wheel, 12 players on two courts: five pool rounds of three matches (one waits for a court), then gold, bronze and 5th place to 6', () => {
  const s = day(12, [6, 7], 5), rand = rng(11);
  E.startNight(s);
  for (let k = 0; k < 5; k++) {
    const r = E.currentRound(s);
    shape(s, r);
    assert.deepEqual([r.courts.length, r.sitting.length, r.setTo], [3, 0, 4]);
    assert.deepEqual(r.courts.map(c => [c.court, !!c.wait]), [[7, false], [6, false], [7, true]], 'the third match waits for a court');
    play(s, () => rand() < 0.5);
  }
  const table = E.wheelStandings(s), key = i => pairKey(table[i].players), place = E.currentRound(s);
  assert.deepEqual([place.stage, place.setTo, place.title], ['place', 6, 'Medal matches']);
  assert.deepEqual(place.courts.map(c => c.label), ['Gold match', 'Bronze match', '5th place']);
  assert.deepEqual(place.courts.map(c => [pairKey(E.sideIds(c, 'a')), pairKey(E.sideIds(c, 'b'))]), [[key(0), key(1)], [key(2), key(3)], [key(4), key(5)]]);
  assert.ok(E.isKingsCourt(s, place, place.courts[0]) && !E.isKingsCourt(s, place, place.courts[1]), 'the gold match is the highlighted one');
  play(s);
  assert.equal(E.wheelState(s), 'done');
  const three = day(12, [5, 6, 7], 5);
  E.startNight(three);
  assert.deepEqual(E.currentRound(three).courts.map(c => [c.court, !!c.wait]), [[7, false], [6, false], [5, false]], 'with a third court nobody waits');
});

test('wheel, 14 and 16 players: five pool rounds, then placement matches for everyone', () => {
  [[14, 7], [16, 8], [15, 7]].forEach(([n, T]) => {
    const s = day(n, [5, 6, 7], n);
    E.startNight(s);
    assert.equal(s.wheel.teams.length, T);
    for (let k = 0; k < 5; k++) { const r = E.currentRound(s); shape(s, r); assert.equal(r.courts.length, Math.floor(T / 2)); play(s, (c, i) => (i + k) % 2 === 0); }
    const place = E.currentRound(s);
    assert.deepEqual([place.stage, place.courts.length], ['place', Math.floor(T / 2)]);
    play(s);
    assert.equal(E.wheelState(s), 'done');
  });
});

test('wheel: a player who arrives after the spin waits for the next one; spinning again mid-day makes new teams with everyone', () => {
  const s = day(6, [7], 8);
  E.startNight(s);
  play(s);
  const late = E.addTeam(s, ['Late Lucy']);
  play(s);
  const r3 = E.currentRound(s);
  shape(s, r3);
  assert.ok(r3.sitting.includes(late.id), 'she sits until the wheel spins again');
  play(s);
  assert.ok(E.wheelSpin(s).ok);
  assert.equal(s.wheel.sit.length, 1, 'seven players: one sits');
  assert.notEqual(s.wheel.sit[0], late.id, 'and it is not the one who has been waiting');
  assert.ok(s.wheel.teams.flat().includes(late.id));
});

test('wheel: the wheel cannot be spun in the middle of a round that has scores; an unplayed round is simply replaced', () => {
  const s = day(8, [6, 7], 2);
  E.startNight(s);
  assert.ok(E.wheelSpin(s).ok, 'nobody has played: spin again is fine');
  assert.equal(s.rounds.length, 1);
  assert.equal(s.wheel.spin, 2);
  E.setScore(s, 1, 0, 4, 1);
  assert.equal(E.wheelSpin(s).ok, false);
  assert.equal(s.wheel.spin, 2);
});

test('wheel: a player who leaves; her match is called off unless a resting team-mate can step in', () => {
  const s = day(8, [6, 7], 6);
  E.startNight(s);
  const c = E.currentRound(s).courts[0], leaver = E.sideIds(c, 'a')[0];
  const out = E.removeTeam(s, leaver);
  assert.equal(out.voided, c.court);
  assert.ok(c.void && c.w === 'b');
  play(s);
  const r2 = E.currentRound(s);
  assert.ok(r2.courts.some(x => x.void), 'her team cannot play its next match either');
  const t = day(9, [6, 7], 6);
  E.startNight(t);
  const trio = t.wheel.teams.find(x => x.length === 3), r = E.currentRound(t), resting = r.sitting[0];
  const on = trio.find(x => x !== resting), court = r.courts.find(x => E.courtIds(x).includes(on));
  const res = E.removeTeam(t, on);
  assert.equal(res.substitute, resting, 'the third of the team steps in');
  assert.ok(E.courtIds(court).includes(resting) && !court.void);
});

test('wheel: restarting goes back to the sign-up list, ready for a first spin', () => {
  const s = day(8, [6, 7], 3);
  E.startNight(s); play(s); play(s);
  const out = E.rewindTo(s, 1);
  assert.ok(out.ok && out.setup);
  assert.deepEqual([s.status, s.rounds.length, s.wheel], ['setup', 0, null]);
  assert.equal(E.rewindTo(day(8), 1).ok, false);
  assert.ok(E.startNight(s));
  assert.equal(s.wheel.spin, 1);
});

test('wheel: the state survives a trip through the database', () => {
  const s = day(9, [6, 7], 4);
  E.startNight(s); play(s);
  const stored = JSON.parse(JSON.stringify(s, (k, v) => (Array.isArray(v) && !v.length) || v === null || v === false ? undefined : v));   // the database drops empty lists, nulls are omitted
  const back = E.normalize(stored);
  assert.deepEqual(back.wheel.teams, s.wheel.teams);
  assert.deepEqual(back.wheel.sit, []);
  assert.equal(back.rounds[1].setTo, 4);
  assert.equal(E.wheelState(back), 'playing');
  play(back);
  assert.equal(back.rounds.length, 3);
});

test('wheel: a late player takes the place of one who left, next to the partner left alone', () => {
  const s = day(8, [6, 7], 6);
  E.startNight(s);
  const c = E.currentRound(s).courts[0], leaver = E.sideIds(c, 'a')[0], alone = E.sideIds(c, 'a')[1];
  E.removeTeam(s, leaver);
  const late = E.addTeam(s, ['Late Lucy']);
  play(s);
  const r2 = E.currentRound(s);
  shape(s, r2);
  assert.ok(!r2.courts.some(x => x.void), 'nobody is left without a match');
  const court = r2.courts.find(x => E.courtIds(x).includes(late.id)), side = E.sideOf(court, late.id);
  assert.deepEqual(E.sideIds(court, side).slice().sort(), [alone, late.id].sort());
  play(s); play(s);
  assert.equal(E.wheelStandings(s).reduce((a, r) => a + r.played, 0), 10, 'the pool table still counts the matches from before the change');
  assert.equal(E.currentRound(s).stage, 'semi');
});
