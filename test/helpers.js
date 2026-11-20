'use strict';
const E = require('../docs/engine.js');

// Deterministic random numbers for the simulated match results.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNight(opts) {
  const s = E.newSession({
    seriesId: 'test', date: opts.date || '2026-11-20', courts: opts.courts || [3, 4, 5, 6, 7],
    seed: opts.seed || 1, round1: opts.round1 || 'random', scoring: opts.scoring || 'team'
  });
  for (let i = 1; i <= opts.teams; i++) E.addTeam(s, ['Team ' + String(i).padStart(2, '0')]);
  return s;
}

// Play the current round: sets to 4, random winner unless `alwaysWins` (a team id) is on the court.
function playRound(s, rand, alwaysWins) {
  const r = E.currentRound(s);
  r.courts.forEach((c, i) => {
    if (c.void || c.w) return;
    let aWins = rand() < 0.5;
    if (alwaysWins && c.a === alwaysWins) aWins = true;
    if (alwaysWins && c.b === alwaysWins) aWins = false;
    const loser = Math.floor(rand() * 4); // 0..3
    E.setScore(s, r.n, i, aWins ? 4 : loser, aWins ? loser : 4);
  });
}

function playNight(s, rounds, seed, alwaysWins) {
  const rand = rng(seed || 99);
  E.startNight(s);
  for (let n = 1; n <= rounds; n++) playRound(s, rand, alwaysWins);
  return s;
}

// Where was each team in each round?  -> { teamId: [ {level, court, won} | 'sit' | null ] }
function history(s) {
  const h = {};
  Object.keys(s.teams).forEach(id => { h[id] = []; });
  s.rounds.forEach((r, idx) => {
    Object.keys(h).forEach(id => { h[id][idx] = null; });
    r.sitting.forEach(id => { h[id][idx] = 'sit'; });
    r.courts.forEach(c => {
      ['a', 'b'].forEach(side => {
        const id = c[side];
        if (id && h[id]) h[id][idx] = { level: c.level, court: c.court, won: c.w ? c.w === side : null };
      });
    });
  });
  return h;
}

module.exports = { E, rng, makeNight, playRound, playNight, history };
