// First-slice station output units are provisional display indices. Combat and
// economy continue to use their existing selectors until separately balanced.
export const STATIONS = Object.freeze({
  helm: { label: 'Helm', roomId: 'bridge', role: 'pilot' },
  shields: { label: 'Shields', roomId: 'operations', role: 'engineer' },
  weapons: { label: 'Weapons', roomId: 'workshop', role: 'gunner' },
  engineering: { label: 'Engineering', roomId: 'engineering', role: 'engineer' },
});

const BASELINE = 100;
const ROLE_BONUS = 10;
const isStation = id => Object.hasOwn(STATIONS, id);

export function normalizeAssignments(player) {
  const source = player?.stationAssignments || {};
  const assignments = {};
  const occupied = new Set();
  for (const member of [...(player?.crew || []), ...(player?.reserve || [])]) {
    const station = source[member.instanceId];
    assignments[member.instanceId] = isStation(station) && !occupied.has(station) ? station : null;
    if (assignments[member.instanceId]) occupied.add(station);
  }
  return assignments;
}

export function assignStation(player, crewId, stationId, now = Date.now()) {
  const member = player?.crew?.find(c => c.instanceId === crewId);
  if (!member) return { ok: false, reason: 'unknown_crew' };
  if (member.status === 'expedition' || member.status === 'reserve' || (member.injuredUntil || 0) > now) {
    return { ok: false, reason: 'unavailable_crew' };
  }
  if (stationId !== null && !isStation(stationId)) return { ok: false, reason: 'unknown_station' };
  const stationAssignments = normalizeAssignments(player);
  if (stationId !== null) {
    for (const id of Object.keys(stationAssignments)) {
      if (stationAssignments[id] === stationId) stationAssignments[id] = null;
    }
  }
  stationAssignments[crewId] = stationId;
  return { ok: true, player: { ...player, stationAssignments } };
}

export function stationOutputs(player, now = Date.now()) {
  const assignments = normalizeAssignments(player);
  const output = {};
  for (const [stationId, station] of Object.entries(STATIONS)) {
    const crewId = Object.keys(assignments).find(id => assignments[id] === stationId);
    const member = player?.crew?.find(c => c.instanceId === crewId);
    const available = member?.status === 'ready' && (member.injuredUntil || 0) <= now;
    const bonus = available && member.role === station.role ? ROLE_BONUS : 0;
    output[stationId] = {
      staffedBy: available ? member.instanceId : null,
      baseline: BASELINE,
      bonus,
      total: BASELINE + bonus,
      label: station.label,
    };
  }
  return output;
}

export function previewStationAssignment(player, crewId, stationId, now = Date.now()) {
  if (!isStation(stationId)) return { ok: false, reason: 'unknown_station' };
  const proposal = assignStation(player, crewId, stationId, now);
  if (!proposal.ok) return { ok: false, reason: proposal.reason };
  const before = stationOutputs(player, now)[stationId].total;
  const after = stationOutputs(proposal.player, now)[stationId].total;
  return { ok: true, before, after, delta: after - before };
}
