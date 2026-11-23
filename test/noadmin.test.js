'use strict';
// The night goes on without the organizer's device: every device works out the next round from the saved night and
// the scores the phones have sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { E, makeNight } = require('./helpers.js');

const snap = s => JSON.stringify(s.rounds.map(r => r.courts.map(c => [c.court, E.courtKey(c), c.sa, c.sb, c.w])));
// what the phones of one round send: side A wins 4-2 on every court, with the court's players as k
function phones(s, at) {
  const r = E.currentRound(s), out = {};
  r.courts.forEach((c, i) => { if (!c.void) out['c' + i] = { sa: 4, sb: 2, w: 'a', at: at + i, by: 'p', k: E.courtKey(c) }; });
  return out;
}

for (const format of ['kings-fixed', 'kings-individual']) {
  test(format + ': with every score of a round sent from phones, the next round follows on any device, the same on all of them', () => {
    const saved = makeNight({ teams: format === 'kings-fixed' ? 9 : 13, courts: [5, 6, 7], seed: 77, format });
    E.startNight(saved);
    const frozen = JSON.stringify(saved), all = {};
    let seen = saved;
    for (let n = 1; n <= 6; n++) {
      assert.equal(E.currentRound(seen).n, n);
      all['r' + n] = phones(seen, 1000 * n);
      const tv = E.withPlayerScores(saved, all), phone = E.withPlayerScores(E.normalize(JSON.parse(frozen)), JSON.parse(JSON.stringify(all)));
      assert.equal(snap(tv), snap(phone), 'round ' + (n + 1) + ': the TV and a phone agree');
      assert.equal(E.currentRound(tv).n, n + 1, 'the next round is there');
      seen = tv;
    }
    assert.equal(JSON.stringify(saved), frozen, 'the saved night itself is not touched');
    // the organizer's device is opened again: it catches up to exactly the rounds everyone has been playing
    const out = E.applyAllPlayerScores(saved, all);
    assert.deepEqual([out.advanced, out.applied.length], [6, 18]);
    assert.equal(snap(saved), snap(seen));
    assert.deepEqual(E.leaderboard(saved).map(r => [r.key, r.points]), E.leaderboard(seen).map(r => [r.key, r.points]));
    assert.equal(E.applyAllPlayerScores(saved, all).applied.length, 0, 'nothing is applied twice');
  });
}

test('a round with a score missing stays; the last score moves it on', () => {
  const s = makeNight({ teams: 8, courts: [6, 7], seed: 5 });
  E.startNight(s);
  const one = { r1: { c0: phones(s, 10).c0 } };
  const part = E.withPlayerScores(s, one);
  assert.equal(E.currentRound(part).n, 1);
  assert.deepEqual(E.currentRound(part).courts.map(c => c.w), ['a', null]);
  one.r1.c1 = phones(s, 20).c1;
  assert.equal(E.currentRound(E.withPlayerScores(s, one)).n, 2);
});

test('a score sent for other players than the ones now on that court is ignored', () => {
  const s = makeNight({ teams: 8, courts: [6, 7], seed: 5 });
  E.startNight(s);
  const all = { r1: phones(s, 10) };
  all.r1.c0.k = 'someone+else|not+here';
  const eff = E.withPlayerScores(s, all);
  assert.equal(E.currentRound(eff).n, 1, 'the round is not complete');
  assert.deepEqual(E.currentRound(eff).courts.map(c => c.w), [null, 'a']);
  delete all.r1.c0.k;                              // (a phone still on the older page sends no k: accepted as before)
  assert.equal(E.currentRound(E.withPlayerScores(s, all)).n, 2);
  // scores sent for a later round count only once the rounds before it are complete, and only for the same players
  const t = makeNight({ teams: 8, courts: [6, 7], seed: 9 });
  E.startNight(t);
  const r1 = phones(t, 10), next = E.withPlayerScores(t, { r1 }), r2 = phones(next, 50);
  assert.equal(E.currentRound(E.withPlayerScores(t, { r2 })).n, 1, 'round 2 scores alone change nothing');
  assert.equal(E.currentRound(E.withPlayerScores(t, { r1, r2 })).n, 3);
  r1.c0 = { sa: 1, sb: 4, w: 'b', at: 99, by: 'p', k: r1.c0.k };      // round 1 corrected afterwards: round 2 is drawn differently
  const redo = E.withPlayerScores(t, { r1, r2 });
  assert.ok(E.currentRound(redo).n <= 3);
  E.currentRound(redo).courts.concat(redo.rounds[1].courts).forEach(c => { if (c.w) assert.ok(Object.values(r2).some(e => e.k === E.courtKey(c)) || redo.rounds[2], 'no score landed on a court it was not sent for'); });
  redo.rounds[1].courts.forEach((c, i) => { if (c.w) assert.equal(r2['c' + i].k, E.courtKey(c)); });
});

test('nothing happens to a night that is not live, or without scores', () => {
  const s = makeNight({ teams: 8, courts: [6, 7], seed: 5 });
  assert.equal(E.withPlayerScores(s, { r1: {} }), s);
  E.startNight(s);
  assert.equal(E.withPlayerScores(s, null), s);
  E.endNight(s);
  assert.equal(E.withPlayerScores(s, { r1: { c0: { sa: 4, sb: 0, at: 1 } } }), s);
});

test('Wheel of Fortune: phones carry a block to its end; the next spin still needs the organizer', () => {
  const s = E.newSession({ seriesId: 'w', date: '2026-11-21', courts: [7], seed: 3, format: 'wheel' });
  for (let i = 1; i <= 5; i++) E.addTeam(s, ['P' + i]);
  E.startNight(s);
  const all = {};
  const send = (ses, at) => { const r = E.currentRound(ses), o = {}; r.courts.forEach((c, i) => { o['c' + i] = { sa: 6, sb: 3, w: 'a', at: at + i, by: 'p', k: E.courtKey(c) }; }); return o; };
  all.r1 = send(s, 10);
  let eff = E.withPlayerScores(s, all);
  assert.equal(E.currentRound(eff).n, 2, 'the second set starts by itself');
  assert.equal(eff.wheel.hold, false, 'and the TV leaves the wheels');
  all.r2 = send(eff, 20);
  eff = E.withPlayerScores(s, all);
  assert.equal(E.wheelState(eff), 'spin', 'two sets played: time to spin, which is the organizer’s to do');
  assert.equal(eff.rounds.length, 2);
});

test('a match that was called off can be counted after all, and called off again', () => {
  const s = makeNight({ teams: 12, courts: [6, 7, 5], seed: 4, format: 'kings-individual' });
  E.startNight(s);
  const r = E.currentRound(s), c = r.courts[1], leaver = E.sideIds(c, 'b')[0], stay = E.sideIds(c, 'a');
  E.removeTeam(s, leaver);                                   // nobody is sitting out: the match is called off
  assert.ok(c.void && c.w === 'a');
  assert.equal(E.setScore(s, 1, 1, 4, 2).ok, false, 'a called-off court takes no score by itself');
  r.courts.forEach((x, i) => { if (!x.void) E.setScore(s, 1, i, 4, 1); });
  assert.equal(E.currentRound(s).n, 2, 'the night went on to round 2');
  E.setScore(s, 2, 0, 4, 0);
  const before = E.leaderboard(s, true).reduce((a, x) => a + x.points, 0);
  // it was played after all: 3-4 to the side with the player who had been removed
  const out = E.setScore(s, 1, 1, 3, 4, null, { revive: true });
  assert.ok(out.ok && out.tooLate, 'round 2 is already being played: the points count, the courts stay as they are');
  assert.deepEqual([c.void, c.sa, c.sb, c.w, c.revived], [false, 3, 4, 'b', 'a']);
  assert.equal(E.currentRound(s).n, 2);
  const board = E.leaderboard(s, true);                      // everyone whose points count, removed players too
  assert.equal(board.reduce((a, x) => a + x.points, 0), before + 2 * (3 + 4), 'both pairs get their games');
  assert.equal(board.find(x => x.key === E.keyOf(s.teams[leaver].name)).points, 4, 'the removed player too');
  // a player removed during the night is not on tonight's table, but the saved results keep the points for the month
  const gone = E.keyOf(s.teams[leaver].name);
  assert.equal(E.leaderboard(s).find(x => x.key === gone), undefined, 'not on tonight’s table');
  assert.equal(E.leaderboard(s).length, board.length - 1);
  assert.deepEqual([E.resultsDoc(s).entries[gone].points, E.resultsDoc(s).entries[gone].left], [4, true], 'saved for the month, marked as removed');
  assert.equal(E.monthlyBoard({ a: E.resultsDoc(s) }).find(x => x.key === gone).points, 4, 'on the month’s table');
  assert.equal(Object.values(E.resultsDoc(s).entries).filter(e => e.left).length, 1, 'nobody else is marked');
  stay.forEach(id => assert.ok(board.find(x => x.key === E.keyOf(s.teams[id].name)).points >= 3));
  const back = E.normalize(JSON.parse(JSON.stringify(s, (k, v) => v === false || v === null ? undefined : v)));
  assert.deepEqual([!!back.rounds[0].courts[1].void, back.rounds[0].courts[1].revived], [false, 'a'], 'it survives the database');
  // a mistake: clear it, and the court is called off again exactly as before
  assert.ok(E.setScore(s, 1, 1, null, null).ok);
  assert.deepEqual([c.void, c.sa, c.sb, c.w, c.revived], [true, null, null, 'a', undefined]);
  assert.equal(E.leaderboard(s).reduce((a, x) => a + x.points, 0), before);
});
