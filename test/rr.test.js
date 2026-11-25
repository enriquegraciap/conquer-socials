'use strict';
// Round robin (no King's Court): fair sit-outs, a fresh mix every round, double points, and a social's own table.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../docs/engine.js');

function night(format, n, courts, opts) {
  const s = E.newSession(Object.assign({ format: format, courts: courts, seed: 4242 }, opts || {}));
  for (let i = 0; i < n; i++) E.addTeam(s, format === 'rr-fixed' ? ['A' + i, 'B' + i] : ['P' + i]);
  E.startNight(s);
  return s;
}
function playRound(s, score) {
  const cur = E.currentRound(s);
  cur.courts.forEach((c, i) => { const sc = score ? score(c, i) : [4, i % 4]; E.setScore(s, cur.n, i, sc[0], sc[1]); });
}
function spread(s, key) { const st = E.teamStats(s), v = Object.keys(st).map(k => st[k][key]); return Math.max.apply(null, v) - Math.min.apply(null, v); }

test('round robin, individual: four to a court, no King\'s Court, everyone placed once', () => {
  const s = night('rr-individual', 22, [1, 2, 3, 4, 5]);
  const r = E.currentRound(s);
  assert.strictEqual(r.courts.length, 5);
  assert.strictEqual(r.sitting.length, 2);
  assert.deepStrictEqual(r.courts.map(c => c.court), [1, 2, 3, 4, 5]);
  r.courts.forEach(c => { assert.strictEqual(E.isKingsCourt(s, r, c), false); assert.strictEqual(E.sideIds(c, 'a').length, 2); assert.strictEqual(E.sideIds(c, 'b').length, 2); });
  const seen = {};
  r.courts.forEach(c => E.courtIds(c).forEach(id => { assert.ok(!seen[id]); seen[id] = 1; }));
  r.sitting.forEach(id => { assert.ok(!seen[id]); seen[id] = 1; });
  assert.strictEqual(Object.keys(seen).length, 22);
  assert.strictEqual(E.isRR(s), true);
  assert.strictEqual(E.isLadder(s), false);
});

[[21, 5], [22, 5], [25, 5], [28, 5], [15, 3], [9, 2]].forEach(([n, c]) => {
  test('round robin: ' + n + ' players on ' + c + ' courts sit out equally, never twice running, with new partners', () => {
    const courts = []; for (let i = 1; i <= c; i++) courts.push(i);
    const s = night('rr-individual', n, courts);
    const partners = {};
    for (let r = 0; r < 9; r++) {
      const cur = E.currentRound(s), prev = s.rounds[s.rounds.length - 2];
      if (prev) cur.sitting.forEach(id => assert.ok(prev.sitting.indexOf(id) < 0, 'sat twice running in round ' + cur.n));
      cur.courts.forEach(co => ['a', 'b'].forEach(side => { const k = E.sideIds(co, side).slice().sort().join('+'); partners[k] = (partners[k] || 0) + 1; }));
      playRound(s);
      assert.ok(spread(s, 'satOut') <= 1, 'sit-outs differ by more than one after round ' + cur.n);
    }
    assert.ok(spread(s, 'played') <= 1);
    const most = Math.max.apply(null, Object.keys(partners).map(k => partners[k]));
    assert.ok(most <= (n >= 15 ? 1 : 2), 'the same two were partners ' + most + ' times');
  });
});

test('round robin, fixed partners: a different opponent every round', () => {
  const s = night('rr-fixed', 10, [1, 2, 3, 4, 5]);
  const met = {};
  for (let r = 0; r < 7; r++) {
    E.currentRound(s).courts.forEach(c => { const k = [c.a, c.b].sort().join('v'); met[k] = (met[k] || 0) + 1; });
    playRound(s);
  }
  assert.strictEqual(Math.max.apply(null, Object.keys(met).map(k => met[k])), 1);
  assert.strictEqual(E.leaderboard(s).length, 10);
});

test('round robin: every screen works out the same next round, and correcting an old score never re-draws', () => {
  const s = night('rr-individual', 17, [1, 2, 3, 4]);
  playRound(s); playRound(s);
  const copy = E.normalize(E.clone(s));
  playRound(s); playRound(copy);
  assert.deepStrictEqual(E.currentRound(copy), E.currentRound(s));
  const before = JSON.stringify(E.currentRound(s));
  const out = E.setScore(s, 1, 0, 1, 4);                 // round 1, the other side won after all
  assert.strictEqual(out.ok, true); assert.strictEqual(out.tooLate, false); assert.strictEqual(out.regenerated, false);
  assert.strictEqual(JSON.stringify(E.currentRound(s)), before);
});

test('round robin: a late arrival plays before sitting; someone who leaves is replaced by a sitter', () => {
  const s = night('rr-individual', 9, [1, 2]);
  playRound(s);
  const late = E.addTeam(s, ['Late Lucy']);
  playRound(s);                                           // round 2 was already drawn without her
  const r3 = E.currentRound(s);
  assert.ok(E.courtIds(r3.courts[0]).concat(E.courtIds(r3.courts[1])).indexOf(late.id) >= 0, 'the newcomer plays her first round');
  const gone = E.courtIds(r3.courts[0])[0], sitter = r3.sitting.slice();
  const out = E.removeTeam(s, gone);
  assert.ok(sitter.indexOf(out.substitute) >= 0);
  assert.ok(E.courtIds(E.currentRound(s).courts[0]).indexOf(out.substitute) >= 0);
});

test('double points: a 4-1 set gives 8 and 2, on the night and in what is saved for the table', () => {
  const s = night('rr-individual', 4, [1], { mult: 2 });
  E.setScore(s, 1, 0, 4, 1);
  const c = s.rounds[0].courts[0], rows = E.leaderboard(s), by = {};
  rows.forEach(r => { by[r.key] = r; });
  E.sideIds(c, 'a').forEach(id => assert.strictEqual(by[E.keyOf(s.teams[id].name)].points, 8));
  E.sideIds(c, 'b').forEach(id => assert.strictEqual(by[E.keyOf(s.teams[id].name)].points, 2));
  assert.strictEqual(c.sa, 4); assert.strictEqual(c.sb, 1);            // the score itself stays as played
  const doc = E.resultsDoc(s);
  assert.strictEqual(doc.mult, 2);
  assert.deepStrictEqual(Object.keys(doc.entries).map(k => doc.entries[k].points).sort(), [2, 2, 8, 8]);
  const normal = night('kings-fixed', 2, [1]);
  E.setScore(normal, 1, 0, 4, 1);
  assert.strictEqual(E.leaderboard(normal)[0].points, 4);
  assert.strictEqual(E.resultsDoc(normal).mult, undefined);
  assert.strictEqual(E.normalize({ mult: 2 }).mult, 2);
  assert.strictEqual(E.normalize({}).mult, 1);
});

test('a social with its own table: starting points plus every night, under the table\'s name', () => {
  const series = { name: 'Taco Tuesday', table: { name: 'Fall Series', start: {} } };
  series.table.start[E.keyOf('Dani Marquez')] = { name: 'Dani Marquez', points: 24 };
  series.table.start[E.keyOf('Harrison Smedley')] = { name: 'Harrison Smedley', points: 66 };
  const s = E.newSession({ format: 'rr-individual', courts: [1], mult: 2 });
  ['Dani Marquez', 'New Nora', 'Third Theo', 'Fourth Fay'].forEach(n => E.addTeam(s, [n]));
  E.startNight(s);
  const c = s.rounds[0].courts[0], dani = Object.keys(s.teams).filter(id => s.teams[id].name === 'Dani Marquez')[0];
  const side = E.sideOf(c, dani);
  E.setScore(s, 1, 0, side === 'a' ? 4 : 1, side === 'a' ? 1 : 4);     // Dani wins 4-1
  const res = { '2026-11': {} }; res['2026-11'][s.id] = E.resultsDoc(s);
  const rows = E.monthlyBoard(E.tableDocs(series, res)), by = {};
  rows.forEach(r => { by[r.name] = r; });
  assert.strictEqual(by['Dani Marquez'].points, 32);                   // 24 brought along + 8
  assert.strictEqual(by['Dani Marquez'].nights, 1);
  assert.strictEqual(by['Harrison Smedley'].points, 66);               // has not played here: keeps what she brought
  assert.strictEqual(by['Harrison Smedley'].nights, 0);
  assert.strictEqual(rows[0].name, 'Harrison Smedley');
  assert.strictEqual(rows.length, 5);
  // table.present: only whoever is on tonight's list, with what they brought plus tonight
  const here = E.tableHere(rows, E.sessionKeys(s));
  assert.deepStrictEqual(here.map(r => r.name).sort(), ['Dani Marquez', 'Fourth Fay', 'New Nora', 'Third Theo']);
  assert.strictEqual(here[0].name, 'Dani Marquez'); assert.strictEqual(here[0].rank, 1); assert.strictEqual(here[0].points, 32);
  const before = E.newSession({ format: 'rr-individual', courts: [1] });
  ['Dani Marquez', 'Harrison Smedley', 'Brand New'].forEach(n => E.addTeam(before, [n]));
  const full = () => E.monthlyBoard(E.tableDocs(series, {}));
  assert.deepStrictEqual(E.tableHere(full(), E.sessionKeys(before)).map(r => r.rank + ' ' + r.name + ' ' + r.points), ['1 Harrison Smedley 66', '2 Dani Marquez 24', '3 Brand New 0']);
  // table.others: tonight's players, plus that many of the best placed who are not here tonight
  ['Away Ann', 'Away Bob', 'Away Cy'].forEach((n, i) => { series.table.start[E.keyOf(n)] = { name: n, points: 50 - 20 * i }; });
  const few = E.newSession({ format: 'rr-individual', courts: [1] });
  ['Dani Marquez', 'Brand New'].forEach(n => E.addTeam(few, [n]));
  assert.deepStrictEqual(E.tableHere(full(), E.sessionKeys(few), 2).map(r => r.rank + ' ' + r.name + ' ' + r.points), ['1 Harrison Smedley 66', '2 Away Ann 50', '3 Dani Marquez 24', '4 Brand New 0']);
  assert.deepStrictEqual(E.tableHere(full(), E.sessionKeys(few), 0).map(r => r.name), ['Dani Marquez', 'Brand New']);
  assert.strictEqual(E.tableHere(full(), E.sessionKeys(few), 99).length, 6);
  ['Away Ann', 'Away Bob', 'Away Cy'].forEach(n => { delete series.table.start[E.keyOf(n)]; });
  assert.strictEqual(E.tableOf({ name: 'x' }), null);
  assert.deepStrictEqual(E.tableDocs({ name: 'x' }, res), {});
});
