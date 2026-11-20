'use strict';
// Individual King's Court: everyone plays for themselves, pairs split after every round.
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, rng, makeNight, playRound, playNight, history } = require('./helpers.js');

const solo = (players, courts, seed) => makeNight({ teams: players, courts, seed: seed || 1, format: 'kings-individual' });

function shape(s, r) {
  const seen = [];
  r.courts.forEach(c => {
    assert.equal(E.sideIds(c, 'a').length, 2, `round ${r.n} court ${c.court}: two players on side A`);
    assert.equal(E.sideIds(c, 'b').length, 2, `round ${r.n} court ${c.court}: two players on side B`);
    seen.push(...E.courtIds(c));
  });
  seen.push(...r.sitting);
  assert.equal(new Set(seen).size, seen.length, `round ${r.n}: nobody appears twice`);
  assert.equal(seen.length, E.activeTeams(s).length, `round ${r.n}: everyone is either playing or sitting`);
}

test('individual: a new night scores per player', () => {
  const s = solo(8, [6, 7]);
  assert.equal(s.format, 'kings-individual');
  assert.equal(s.scoring, 'player');
  assert.equal(E.formatOf(s).per, 4);
});

test('individual, 16 players on 4 courts: winners move up and split, losers move down and split', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = playNight(solo(16, [4, 5, 6, 7], seed), 8, seed * 7);
    const h = history(s), top = 3;
    s.rounds.forEach(r => { shape(s, r); assert.equal(r.courts.length, 4); assert.equal(r.sitting.length, 0); });
    Object.keys(h).forEach(id => {
      for (let i = 1; i < 9; i++) {
        const prev = h[id][i - 1], now = h[id][i];
        const want = Math.max(0, Math.min(top, prev.level + (prev.won ? 1 : -1)));
        assert.equal(now.level, want, `seed ${seed} round ${i + 1}: a ${prev.won ? 'winner' : 'loser'} on level ${prev.level} goes to level ${want}`);
        assert.notEqual(now.with, prev.with, `seed ${seed} round ${i + 1}: partners always split`);
      }
    });
    // the two winners of a court face each other in the next round
    s.rounds.slice(0, 8).forEach((r, idx) => {
      r.courts.forEach(c => {
        const [w1, w2] = E.sideIds(c, c.w), next = s.rounds[idx + 1].courts.find(x => E.courtIds(x).includes(w1));
        assert.notEqual(E.sideOf(next, w1), E.sideOf(next, w2), `seed ${seed}: winners of round ${r.n} are opponents in round ${r.n + 1}`);
        assert.ok(E.sideOf(next, w2), 'and on the same court');
      });
    });
  }
});

test('individual, 18 players on 4 courts: two sit each round, evenly, never twice in a row, and come back no lower', () => {
  let lower = 0, winnersDown = 0, returns = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = playNight(solo(18, [4, 5, 6, 7], seed), 9, seed * 11);
    const h = history(s);
    s.rounds.forEach(r => { shape(s, r); assert.equal(r.courts.length, 4); assert.equal(r.sitting.length, 2); });
    const counts = Object.keys(h).map(id => h[id].slice(0, 9).filter(x => x === 'sit').length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `seed ${seed}: sit-outs between ${Math.min(...counts)} and ${Math.max(...counts)}`);
    assert.equal(counts.reduce((a, b) => a + b, 0), 18, 'nine rounds, two sitting each: everyone sits exactly once');
    Object.keys(h).forEach(id => {
      for (let i = 1; i < 10; i++) {
        const prev = h[id][i - 1], now = h[id][i];
        assert.ok(!(prev === 'sit' && now === 'sit'), `seed ${seed}: nobody sits twice in a row`);
        if (prev === 'sit' && now !== 'sit' && i >= 2 && h[id][i - 2] !== 'sit' && h[id][i - 2]) { returns++; if (now.level < h[id][i - 2].level) lower++; }
        if (prev && prev !== 'sit' && now && now !== 'sit') {
          if (prev.won && now.level < prev.level) winnersDown++;
          assert.notEqual(now.with, prev.with, `seed ${seed}: partners always split`);
        }
      }
    });
  }
  assert.equal(lower, 0, `a player back from a sit-out is never below the court they left (${returns} returns checked)`);
  assert.equal(winnersDown, 0, 'a winner never moves down');
});

test('individual: odd numbers and few courts still share the sit-outs', () => {
  [[14, [5, 6, 7], 2], [17, [4, 5, 6, 7], 1], [22, [3, 4, 5, 6, 7], 2], [20, [5, 6, 7], 8], [9, [6, 7], 1], [7, [5, 6, 7], 3]].forEach(([players, courts, sitting]) => {
    for (let seed = 1; seed <= 40; seed++) {
      const rounds = 10, s = playNight(solo(players, courts, seed), rounds, seed * 5);
      const h = history(s);
      s.rounds.forEach(r => { shape(s, r); assert.equal(r.sitting.length, sitting, `${players} players on ${courts.length} courts: ${sitting} sit`); });
      const counts = Object.keys(h).map(id => h[id].slice(0, rounds).filter(x => x === 'sit').length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${players} players, seed ${seed}: sit-outs between ${Math.min(...counts)} and ${Math.max(...counts)}`);
    }
  });
});

test('individual: every game won is a point for both players of the pair; the leaderboard is per player', () => {
  const s = solo(8, [6, 7], 3);
  E.startNight(s);
  const r = E.currentRound(s), king = r.courts[0], other = r.courts[1];
  E.setScore(s, 1, 0, 4, 2);
  E.setScore(s, 1, 1, 1, 4);
  const board = E.leaderboard(s), by = Object.fromEntries(board.map(x => [x.name, x]));
  assert.equal(board.length, 8, 'one line per player');
  const nm = id => s.teams[id].name;
  E.sideIds(king, 'a').forEach(id => assert.equal(by[nm(id)].points, 4));
  E.sideIds(king, 'b').forEach(id => assert.equal(by[nm(id)].points, 2));
  E.sideIds(other, 'a').forEach(id => assert.equal(by[nm(id)].points, 1));
  E.sideIds(other, 'b').forEach(id => { assert.equal(by[nm(id)].points, 4); assert.equal(by[nm(id)].wins, 1); });
  const doc = E.resultsDoc(s);
  assert.equal(doc.scoring, 'player'); assert.equal(doc.format, 'kings-individual');
  assert.equal(Object.keys(doc.entries).length, 8);
  // two nights add up per player
  const month = E.monthlyBoard({ a: doc, b: doc });
  assert.equal(month.length, 8);
  assert.equal(month[0].points, 8);
  assert.equal(s.rounds.length, 2, 'round 2 is drawn once both courts are scored');
});

test('individual: a player who always wins climbs to King\'s Court and stays there', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = solo(18, [4, 5, 6, 7], seed);
    const champ = E.teamList(s)[seed % 18].id;
    playNight(s, 10, seed * 3, champ);
    const h = history(s)[champ].slice(0, 10).filter(x => x && x !== 'sit');
    assert.equal(h[h.length - 1].level, 3, `seed ${seed}: ends on King's Court`);
    for (let i = 1; i < h.length; i++) assert.ok(h[i].level >= h[i - 1].level, `seed ${seed}: never moves down`);
  }
});

test('individual: partners get mixed over a night', () => {
  let worst = 0, total = 0, repeats = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const s = playNight(solo(16, [4, 5, 6, 7], seed), 8, seed * 9), h = history(s);
    Object.keys(h).forEach(id => {
      const seen = {};
      h[id].slice(0, 8).forEach(x => { if (x && x !== 'sit') seen[x.with] = (seen[x.with] || 0) + 1; });
      const most = Math.max(...Object.values(seen));
      worst = Math.max(worst, most); total += 8; repeats += 8 - Object.keys(seen).length;
    });
  }
  assert.ok(worst <= 3, `nobody has the same partner more than three times in eight rounds (worst seen: ${worst})`);
  assert.ok(repeats / total < 0.2, `repeat partners are rare (${(100 * repeats / total).toFixed(1)}% of matches)`);
});

test('individual: a player who leaves mid-round is replaced by someone sitting out', () => {
  const s = solo(9, [6, 7], 2);
  E.startNight(s);
  const r = E.currentRound(s), c = r.courts[0], leaver = E.sideIds(c, 'a')[0], partner = E.sideIds(c, 'a')[1], sitter = r.sitting[0];
  const out = E.removeTeam(s, leaver);
  assert.equal(out.substitute, sitter);
  assert.deepEqual(E.sideIds(c, 'a').slice().sort(), [partner, sitter].sort(), 'the sitter takes the place beside the same partner');
  assert.equal(r.sitting.length, 0);
  shape(s, r);
});

test('individual: with nobody to step in, the court is called off and the three who are left keep their place', () => {
  const s = solo(8, [6, 7], 4);
  E.startNight(s);
  const r = E.currentRound(s), c = r.courts[0], leaver = E.sideIds(c, 'b')[0], partner = E.sideIds(c, 'b')[1], others = E.sideIds(c, 'a').slice();
  const out = E.removeTeam(s, leaver);
  assert.equal(out.voided, c.court);
  assert.ok(c.void);
  E.setScore(s, 1, 1, 4, 1);
  assert.equal(s.rounds.length, 2, 'the round still completes');
  const r2 = E.currentRound(s);
  shape(s, r2);
  assert.equal(r2.courts.length, 1, 'seven players: one court, three sit');
  const st = E.teamStats(s);
  [partner, ...others].forEach(id => assert.equal(st[id].points, 0, 'no points from the called-off court'));
});

test('individual: a late player starts on the bottom court and plays before sitting', () => {
  const s = solo(16, [4, 5, 6, 7], 6);
  const rand = rng(5);
  E.startNight(s); playRound(s, rand); playRound(s, rand);
  const late = E.addTeam(s, ['Late Lucy']);
  playRound(s, rand);
  const r = E.currentRound(s);
  shape(s, r);
  assert.equal(r.sitting.length, 1);
  assert.ok(!r.sitting.includes(late.id), 'the new player plays first');
  assert.equal(r.courts.find(c => E.courtIds(c).includes(late.id)).level, 0, 'on the bottom court');
});

test('individual: fewer than four players cannot start a round', () => {
  const s = solo(3, [7], 1);
  E.startNight(s);
  assert.equal(s.rounds.length, 0);
  E.addTeam(s, ['Fourth']);
  E.advance(s);
  assert.equal(s.rounds.length, 1);
  shape(s, s.rounds[0]);
});

test('individual: the same names cannot be entered twice, and a rename carries the player\'s results', () => {
  const s = solo(0, [7], 1);
  assert.ok(E.addTeam(s, ['Ana']));
  assert.equal(E.addTeam(s, ['ana ']), null);
  const t = E.teamList(s)[0], out = E.renameTeam(s, t.id, ['Anna']);
  assert.ok(out.ok); assert.equal(out.oldKey, E.keyOf('ana')); assert.equal(out.newKey, E.keyOf('anna'));
});
