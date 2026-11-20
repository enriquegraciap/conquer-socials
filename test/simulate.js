'use strict';
// Prints one simulated night: where every team was each round and how often it sat out.
//   node test/simulate.js [teams] [rounds] [seed]
const { E, makeNight, playNight, history } = require('./helpers.js');

const teams = Number(process.argv[2] || 14);
const rounds = Number(process.argv[3] || 8);
const seed = Number(process.argv[4] || 2026);
const courts = [3, 4, 5, 6, 7];

const s = makeNight({ teams, courts, seed });
const champ = E.teamList(s)[4].id;                 // Team 05 wins every match it plays
playNight(s, rounds, seed + 1, champ);
const h = history(s);
const st = E.teamStats(s, rounds);

const pad = (x, n) => String(x).padEnd(n);
console.log(`${teams} teams, courts ${courts.join(', ')} (court ${courts[courts.length - 1]} = King's Court), ${rounds} rounds, sets to 4`);
console.log('Each cell: court number + W (won) or L (lost).  --- = sitting out.  Team 05 is set to win every match.\n');
console.log(pad('Team', 9) + Array.from({ length: rounds }, (_, i) => pad('R' + (i + 1), 6)).join('') + pad('Sat out', 9) + pad('Played', 8) + 'Points');
E.teamList(s).forEach(t => {
  const cells = h[t.id].slice(0, rounds).map(x => pad(x === 'sit' ? '---' : x ? x.court + (x.won ? 'W' : 'L') : '', 6)).join('');
  const sat = h[t.id].slice(0, rounds).filter(x => x === 'sit').length;
  console.log(pad(t.name, 9) + cells + pad(sat, 9) + pad(st[t.id].played, 8) + st[t.id].points);
});

console.log('\nSitting out each round:');
s.rounds.slice(0, rounds).forEach(r => console.log('  R' + r.n + ': ' + r.sitting.map(id => s.teams[id].name).join(', ')));

const sats = E.teamList(s).map(t => h[t.id].slice(0, rounds).filter(x => x === 'sit').length);
const tally = {};
sats.forEach(n => { tally[n] = (tally[n] || 0) + 1; });
console.log('\nSit-out spread: ' + Object.keys(tally).map(n => `${tally[n]} teams sat ${n} times`).join(', '));
