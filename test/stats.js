'use strict';
// Measures how often each rule holds over many simulated nights. node test/stats.js [nights] [teams]
const { E, makeNight, playNight, history } = require('./helpers.js');
const NIGHTS = Number(process.argv[2] || 300), TEAMS = Number(process.argv[3] || 14), R = 8;
function run() {
  const c = { returns: 0, retLower: 0, retWin: 0, retWinNoUp: 0, retLoserLower: 0, moves: 0, exact: 0, winDown: 0, winStay: 0, winJump: 0, loseUp: 0, loseStay: 0, loseDrop2: 0, far: 0, topWinDown: 0, gap1: 0 };
  for (let seed = 1; seed <= NIGHTS; seed++) {
    const s = playNight(makeNight({ teams: TEAMS, seed }), R, seed * 31);
    const top = s.courts.length - 1;
    const low = top - Math.min(s.courts.length, Math.floor(TEAMS / 2)) + 1;
    const h = history(s);
    Object.keys(h).forEach(id => {
      let last = null, lastSit = -9;
      for (let i = 0; i < R; i++) {
        const now = h[id][i];
        if (now === 'sit') { if (i - lastSit === 2) c.gap1++; lastSit = i; continue; }
        if (last && i > 0) {
          const prevSat = h[id][i - 1] === 'sit';
          if (prevSat) {
            c.returns++;
            if (now.level < last.level) { c.retLower++; if (!last.won) c.retLoserLower++; }
            if (last.won) { c.retWin++; if (now.level < Math.min(top, last.level + 1)) c.retWinNoUp++; }
          } else {
            c.moves++;
            const exp = last.won ? Math.min(top, last.level + 1) : Math.max(low, last.level - 1);
            if (now.level === exp) c.exact++;
            if (Math.abs(now.level - exp) > 1) c.far++;
            if (last.won) {
              if (now.level < last.level) { c.winDown++; if (last.level === top) c.topWinDown++; }
              else if (now.level === last.level && last.level < top) c.winStay++;
              else if (now.level > exp) c.winJump++;
            } else {
              if (now.level > last.level) c.loseUp++;
              else if (now.level === last.level && last.level > low) c.loseStay++;
              else if (now.level < exp) c.loseDrop2++;
            }
          }
        }
        last = now;
      }
    });
  }
  return c;
}
const c = run();
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0') + '%';
console.log(`${NIGHTS} nights, ${TEAMS} teams, 5 courts, ${R} rounds`);
console.log(`returns from a sit-out: ${c.returns}`);
console.log(`  came back lower than the court they left: ${c.retLower} (${pct(c.retLower, c.returns)}), of which had lost: ${c.retLoserLower}`);
console.log(`  winners who did not get their move up:    ${c.retWinNoUp} of ${c.retWin} (${pct(c.retWinNoUp, c.retWin)})`);
console.log(`moves by teams that kept playing: ${c.moves}`);
console.log(`  normal one-court move: ${c.exact} (${pct(c.exact, c.moves)})`);
console.log(`  winner moved down: ${c.winDown} (from King's Court: ${c.topWinDown})   winner stayed: ${c.winStay}   winner jumped two: ${c.winJump}`);
console.log(`  loser moved up: ${c.loseUp}   loser stayed: ${c.loseStay}   loser dropped two: ${c.loseDrop2}   more than one court off: ${c.far}`);
console.log(`sat out again after only one round of play: ${c.gap1}`);
