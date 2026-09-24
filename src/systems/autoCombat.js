const STATIONS = ['helm', 'shields', 'weapons', 'engineering'];
const MAX_HULL = 30;
const MAX_SHIELD = 12;

function outputValue(outputs, station) {
  const value = outputs?.[station];
  const numeric = Number(typeof value === 'object' && value !== null ? value.total : value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 100;
}

function seededIndex(seed, beat, eventIndex, size) {
  let hash = (Math.trunc(seed) ^ Math.imul(beat + 1, 0x45d9f3b) ^ Math.imul(eventIndex + 1, 0x119de1f3)) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % size;
}

function finish(next, result, events, lossReason = null) {
  next.result = result;
  next.lossReason = lossReason;
  next.phase = 'complete';
  next.orderWindow = null;
  next.enemy.pattern = 'broken_contact';
  events.push({ type: 'result', result, reason: lossReason });
}

/** Create the JSON-safe, replayable snapshot for one crew-run encounter. */
export function startEncounter({ acceptanceId, encounterId, kind, seed, assignments = {}, outputs = {} }) {
  if (kind !== 'guided' && kind !== 'normal') throw new TypeError("kind must be 'guided' or 'normal'");
  const stationOutputs = Object.fromEntries(STATIONS.map(station => [station, outputValue(outputs, station)]));
  return {
    version: 1,
    acceptanceId: String(acceptanceId ?? ''),
    encounterId: String(encounterId ?? ''),
    kind,
    seed: Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : 0,
    revision: 0,
    beat: 0,
    eventIndex: 0,
    phase: 'combat',
    assignments: structuredClone(assignments || {}),
    outputs: stationOutputs,
    hull: MAX_HULL,
    shield: MAX_SHIELD,
    systems: { helm: 100, shields: 100, weapons: 100, engineering: 100 },
    enemy: {
      hull: kind === 'guided' ? 25 : 42,
      target: 'hull',
      pattern: 'charging_volley',
    },
    cooldowns: { brace: 0, repair: 0 },
    orders: { brace: { used: false, uses: 0 }, repair: { uses: 0 } },
    braceThroughBeat: 0,
    orderWindow: null,
    result: null,
    lossReason: null,
  };
}

/** Resolve one deterministic beat. Rejections preserve the exact input state. */
export function advanceEncounter(state, order = null) {
  if (state.result !== null) return { state, events: [] };

  if (order !== null) {
    if (!['brace', 'repair'].includes(order)) return { ok: false, reason: 'order_unavailable', state };
    if (!state.orderWindow || !state.orderWindow.availableOrders.includes(order)) {
      return { ok: false, reason: 'order_unavailable', state };
    }
    if (order === 'brace' && ((state.orders.brace.used && state.kind === 'guided') || state.cooldowns.brace > 0)) {
      return { ok: false, reason: 'order_unavailable', state };
    }
    if (order === 'repair' && state.cooldowns.repair > 0) {
      return { ok: false, reason: 'order_unavailable', state };
    }
    const cost = order === 'brace' ? 2 : 3;
    if (state.shield < cost) return { ok: false, reason: 'insufficient_resource', state };
  }

  const next = structuredClone(state);
  const events = [];
  next.revision += 1;
  next.beat += 1;
  next.eventIndex += 1;
  for (const name of Object.keys(next.cooldowns)) next.cooldowns[name] = Math.max(0, next.cooldowns[name] - 1);
  const selectedWindow = state.orderWindow;
  next.orderWindow = null;

  if (order === 'brace') {
    const cost = { shield: 2 };
    next.shield -= cost.shield;
    next.orders.brace.used = true;
    next.orders.brace.uses += 1;
    next.braceThroughBeat = next.beat + 1;
    next.cooldowns.brace = next.kind === 'normal' ? 3 : 0;
    events.push({ type: 'order', order: 'brace', cost, amount: 2, cooldownBeats: next.cooldowns.brace, target: 'incoming_damage' });
  } else if (order === 'repair') {
    const cost = { shield: 3 };
    next.shield -= cost.shield;
    const amount = Math.min(8, MAX_HULL - next.hull);
    next.hull += amount;
    next.cooldowns.repair = 4;
    next.orders.repair.uses += 1;
    events.push({ type: 'order', order: 'repair', cost, cooldownBeats: 4, target: 'hull', amount });
    if (amount > 0) events.push({ type: 'repair', target: 'hull', system: 'engineering', amount, source: 'emergency_order' });
  }

  const weaponOutput = Math.floor(next.outputs.weapons * next.systems.weapons / 100);
  const weaponDamage = Math.max(0, Math.floor((weaponOutput - 50) / 10));
  if (weaponDamage > 0 && next.enemy.hull > 0) {
    const amount = Math.min(weaponDamage, next.enemy.hull);
    next.enemy.hull -= amount;
    events.push({ type: 'weapon_damage', target: 'enemy', system: 'weapons', amount, output: weaponOutput });
  }

  const engineeringOutput = Math.floor(next.outputs.engineering * next.systems.engineering / 100);
  if (next.hull < MAX_HULL && engineeringOutput > 0) {
    const amount = Math.min(Math.max(0, 1 + Math.floor((engineeringOutput - 100) / 10)), MAX_HULL - next.hull);
    if (amount > 0) {
      next.hull += amount;
      events.push({ type: 'repair', target: 'hull', system: 'engineering', amount, output: next.outputs.engineering });
    }
  }

  if (next.outputs.engineering > 0) {
    const damagedSystem = STATIONS.find(station => next.systems[station] < 100);
    if (damagedSystem) {
      const amount = Math.max(1, Math.floor(next.outputs.engineering / 100));
      const restored = Math.min(amount, 100 - next.systems[damagedSystem]);
      next.systems[damagedSystem] += restored;
      events.push({ type: 'repair', target: 'system', system: damagedSystem, amount: restored, output: next.outputs.engineering });
    }
  }

  if (next.enemy.hull <= 0) {
    finish(next, 'win', events);
  } else if (next.beat % 3 === 0) {
    const target = selectedWindow?.target || next.enemy.target;
    const rawDamage = 12;
    const shieldOutput = Math.floor(next.outputs.shields * next.systems.shields / 100);
    const helmOutput = Math.floor(next.outputs.helm * next.systems.helm / 100);
    const mitigation = Math.max(0, Math.floor((shieldOutput - 50) / 10)) + Math.max(0, Math.floor((helmOutput - 100) / 10));
    let amount = Math.max(1, rawDamage - mitigation);
    if (next.braceThroughBeat >= next.beat) amount = Math.max(1, Math.floor(amount / 2));
    const shieldLoss = Math.min(next.shield, amount);
    next.shield -= shieldLoss;
    const hullAmount = amount - shieldLoss;
    if (hullAmount > 0) next.hull = Math.max(1, next.hull - hullAmount);
    const systemAmount = target === 'hull' ? 0 : Math.min(next.systems[target], amount);
    if (systemAmount > 0) next.systems[target] -= systemAmount;
    events.push({ type: 'enemy_impact', target, system: target === 'hull' ? 'shields' : target, amount, systemAmount, shieldLoss, hullAmount });
    next.enemy.pattern = 'reloading';
    if (next.hull <= 1) finish(next, 'loss', events, 'Hull breached; retreat with the ship barely holding together.');
  }

  if (next.result === null) {
    if (next.beat % 3 === 1) {
      const targets = ['hull', 'weapons', 'engineering', 'shields'];
      const target = next.beat === 1 ? 'hull' : targets[seededIndex(next.seed, next.beat, next.eventIndex, targets.length)];
      next.enemy.target = target;
      next.enemy.pattern = 'charging_volley';
      next.orderWindow = {
        target,
        beatsToImpact: 2,
        availableOrders: next.kind === 'guided' ? ['brace'] : ['brace', 'repair'],
      };
      events.push({ type: 'tell', target, system: target, beatsToImpact: 2, pattern: next.enemy.pattern });
    }
  }

  next.eventIndex += events.length;
  return { state: next, events };
}
