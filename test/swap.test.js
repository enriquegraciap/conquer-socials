'use strict';
// Switching two places in the round being played: on court for on court, or on court for sitting out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, makeNight } = require('./helpers.js');

const everyoneOnce = s => {
  const r = E.currentRound(s), seen = [];
  r.courts.forEach(c => seen.push(...E.courtIds(c)));
  seen.push(...r.sitting);
  assert.equal(new Set(seen).size, seen.length, 'nobody appears twice');
  assert.equal(seen.length, E.activeTeams(s).length, 'everyone is playing or sitting');
};
const playRound = s => { const r = E.currentRound(s); r.courts.forEach((c, i) => { if (!c.w && !c.void) assert.ok(E.setScore(s, r.n, i, 4, 2).ok); }); };

test('fixed partners: two teams on different courts change places; a team sitting out comes in for one playing', () => {
  const s = makeNight({ teams: 7, courts: [5, 6, 7], seed: 5, format: 'kings-fixed' });
  E.startNight(s);
  const r = E.currentRound(s), [c0, c1] = r.courts, x = c0.a, y = c1.b, sit = r.sitting[0];
  assert.deepEqual(E.swapPlaces(s, x, y), { ok: true, court: c0.court, other: c1.court, sits: null });
  assert.deepEqual([c0.a, c1.b], [y, x]);
  everyoneOnce(s);
  assert.equal(E.swapPlaces(s, c0.a, c0.b).ok, false, 'the two teams of one court: nothing to switch');
  const out = E.swapPlaces(s, sit, c0.b), was = out.sits;
  assert.ok(out.ok && was && was !== sit);
  assert.equal(c0.b, sit);
  assert.deepEqual(r.sitting, [was], 'the team that came off sits out now');
  assert.equal(r.entry[was], c0.level, 'round 1: it comes back in on the court it left');
  everyoneOnce(s);
  // a court with a score cannot be touched until the score is cleared
  assert.ok(E.setScore(s, 1, 0, 4, 1).ok);
  const no = E.swapPlaces(s, c0.a, c1.a);
  assert.equal(no.ok, false); assert.match(no.error, /already has a score/);
  // the night goes on normally and the sit-out counts for the team that actually sat
  playRound(s);
  assert.equal(E.currentRound(s).n, 2);
  everyoneOnce(s);
  const st = E.teamStats(s);
  assert.equal(st[was].sitOuts, 1); assert.equal(st[sit].sitOuts, 0); assert.equal(st[sit].played, 1);
  assert.ok(E.currentRound(s).sitting.indexOf(was) < 0, 'who sat in round 1 plays round 2');
});

test('individual: players change partners on a court, change courts, or come in from sitting out', () => {
  const s = makeNight({ teams: 10, courts: [6, 7], seed: 9, format: 'kings-individual' });
  E.startNight(s);
  playRound(s);
  const r = E.currentRound(s), [c0, c1] = r.courts;
  assert.equal(r.n, 2);
  const [a1, a2] = c0.a, [b1, b2] = c0.b;
  assert.equal(E.swapPlaces(s, a1, a2).ok, false, 'partners on the same side: nothing to switch');
  assert.ok(E.swapPlaces(s, a2, b1).ok);                       // same court, across the net: new partners
  assert.deepEqual([c0.a, c0.b], [[a1, b1], [a2, b2]]);
  const z = c1.a[0];
  assert.ok(E.swapPlaces(s, a1, z).ok);                        // another court
  assert.deepEqual([c0.a, c1.a[0]], [[z, b1], a1]);
  const sitter = r.sitting[0], sitAt = r.sitting.indexOf(sitter);
  const out = E.swapPlaces(s, b2, sitter);
  assert.deepEqual([out.ok, out.sits], [true, b2]);
  assert.deepEqual(c0.b, [a2, sitter]);
  assert.equal(r.sitting[sitAt], b2);
  everyoneOnce(s);
  assert.equal(E.swapPlaces(s, r.sitting[0], r.sitting[1]).ok, false, 'two players sitting out: nothing to switch');
  // phones: a score sent for the court as it was before the switch is not used
  const stale = { c0: { sa: 4, sb: 0, w: 'a', at: 1, by: 'p', k: [a1, a2].join('+') + '|' + [b1, b2].join('+') } };
  assert.equal(E.currentRound(E.withPlayerScores(s, { r2: stale })).courts[0].w, null);
  playRound(s);
  assert.equal(E.currentRound(s).n, 3);
  everyoneOnce(s);
  const st = E.teamStats(s);
  assert.equal(st[sitter].played, r.sitting.indexOf(sitter) < 0 ? 2 : 1);
  assert.equal(st[b2].lastSat, 2, 'the player who came off is the one who sat round 2');
});

test('wheel: a switch moves the two players to each other’s team for the rest of the spin; played matches stay with their team', () => {
  const s = E.newSession({ seriesId: 'wheel', date: '2026-11-21', courts: [5, 6, 7], seed: 3, format: 'wheel' });
  for (let i = 1; i <= 9; i++) E.addTeam(s, ['P' + i]);              // four teams, one of three
  assert.ok(E.wheelSpin(s).ok);
  playRound(s);                                                      // pool round 1: side A wins 4-2 everywhere
  const before = E.wheelStandings(s).map(x => [x.team, x.won, x.gf]);
  const r = E.currentRound(s), w = s.wheel, c0 = r.courts[0], c1 = r.courts[1];
  const x = c0.a[0], y = c1.b[1], tx = w.teams.findIndex(t => t.includes(x)), ty = w.teams.findIndex(t => t.includes(y));
  assert.ok(E.swapPlaces(s, x, y).ok);
  assert.ok(c0.a.includes(y) && c1.b.includes(x));
  assert.ok(s.wheel.teams[tx].includes(y) && s.wheel.teams[ty].includes(x), 'they changed teams');
  assert.deepEqual(E.wheelStandings(s).map(z => [z.team, z.won, z.gf]), before, 'the table of matches already played is as it was');
  everyoneOnce(s);
  // a team of three: the one resting comes in for a team-mate, who rests instead
  const trio = s.wheel.teams.find(t => t.length === 3), resting = trio.find(id => r.sitting.includes(id)), mate = trio.find(id => id !== resting);
  const out = E.swapPlaces(s, mate, resting);
  assert.deepEqual([out.ok, out.sits], [true, mate]);
  assert.ok(r.sitting.includes(mate) && !r.sitting.includes(resting));
  everyoneOnce(s);
  // the rest of the day runs: every later round has the new pairs
  for (let k = 0; k < 6 && E.wheelState(s) === 'playing'; k++) {
    playRound(s);
    const cur = E.currentRound(s);
    cur.courts.forEach(c => ['a', 'b'].forEach(side => { const ids = E.sideIds(c, side), t = s.wheel.teams.findIndex(tm => tm.includes(ids[0])); assert.ok(ids.every(id => s.wheel.teams[t].includes(id)), 'partners are of one team'); }));
  }
  assert.equal(E.wheelState(s), 'done');
});

test('switching is only for the round being played', () => {
  const s = makeNight({ teams: 8, courts: [6, 7], seed: 2, format: 'kings-individual' });
  const ids = E.activeTeams(s).map(t => t.id);
  assert.equal(E.swapPlaces(s, ids[0], ids[1]).ok, false, 'not before the night starts');
  E.startNight(s);
  assert.equal(E.swapPlaces(s, ids[0], ids[0]).ok, false);
  assert.equal(E.swapPlaces(s, ids[0], 'nobody').ok, false);
  E.endNight(s);
  assert.equal(E.swapPlaces(s, ids[0], ids[1]).ok, false, 'not after it has ended');
});
