// Plays many seeded v3 fights per threat level and prints win rate, length and
// hull lost, for a hands-off captain and a captain who holds volleys and picks
// targets. Usage: node scripts/ftl-balance.mjs [fightsPerRow]
import { startFtlEncounter, advanceFtlEncounter, applyFtlCommand } from '../src/systems/ftlCombat.js';

const N = Number(process.argv[2]) || 400;
const THREATS = [0.7, 0.9, 1.0, 1.15, 1.3, 1.5];
const CREW = [
  { id: 'captain', role: 'pilot', station: 'helm' },
  { id: 'gunner', role: 'gunner', station: 'weapons' },
  { id: 'engineer', role: 'engineer', station: 'shields' },
];

function smart(state) {
  let s = applyFtlCommand(state, { type: 'hold', hold: true }).state;
  const e = s.enemy;
  // Break shields, then silence their guns, finishing on weapons.
  const room = e.shields.max > 0 && e.rooms.shields.integrity > 0 ? 'shields' : 'weapons';
  if (s.intent.target !== room) s = applyFtlCommand(s, { type: 'target', room }).state;
  return s;
}

export function playFight({ threat, seed, policy = 'idle', hull = 100, boarders = false, crew = CREW }) {
  let state = startFtlEncounter({ acceptanceId: 'sim', encounterId: 'sim', seed, threat, crew, hull, tactics: [], boarders });
  let guard = 0;
  while (state.result === null && guard < 600) {
    if (state.phase === 'downed') { state = advanceFtlEncounter(state, 'concede').state; break; }
    if (policy === 'smart') state = smart(state);
    state = advanceFtlEncounter(state).state;
    guard += 1;
  }
  return { result: state.result, beats: state.beat, hullLost: state.startHull - state.hull, downed: state.lossReason };
}

const pct = (n, d) => `${Math.round((n / d) * 100)}%`.padStart(5);
const avg = list => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
const median = list => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : 0);

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const boarders of [false, true]) {
    console.log(`\n${boarders ? 'Boarding enemies' : 'Standard enemies'} · ${N} fights per row · start hull 100`);
    console.log('threat | idle win  med s  hull lost(win) | smart win  med s  hull lost(win)');
    for (const threat of THREATS) {
      const row = { idle: [], smart: [] };
      for (let i = 0; i < N; i += 1) {
        const seed = 1000 + i * 7919 + Math.round(threat * 100);
        row.idle.push(playFight({ threat, seed, boarders }));
        row.smart.push(playFight({ threat, seed, policy: 'smart', boarders }));
      }
      const cols = ['idle', 'smart'].map(p => {
        const wins = row[p].filter(f => f.result === 'win');
        return `${pct(wins.length, N)}  ${String(median(row[p].map(f => f.beats))).padStart(5)}  ${String(avg(wins.map(f => f.hullLost))).padStart(6)}`;
      });
      console.log(`${String(threat).padEnd(6)} | ${cols[0]}          | ${cols[1]}`);
    }
  }
}
