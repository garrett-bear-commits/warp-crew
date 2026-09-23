/** Deterministic observations of the production contract combat path. */
import { ENCOUNTERS_V1, COMBAT_ORDERS } from '../systems/combat.js';
import { previewContractAction } from '../systems/contracts.js';
import { normalizeCurrencyReward, resolveContractCombatPayout } from '../systems/contractRewards.js';
import { createNewPlayer } from '../systems/player.js';

const RATIOS = [0.75, 1, 1.25, 1.5];
const ORDER_IDS = ['brace', 'burn', 'board'];
const CURRENCIES = ['credits', 'medals', 'reputation', 'gems', 'fuel'];

function fixtureFor(encounter, ratio, fuel, now) {
  const base = createNewPlayer({ now, rng: () => 0.5 });
  const contract = {
    id: `balance_${encounter.id}`,
    acceptanceId: `balance_${encounter.id}:1`,
    revision: 0,
    stage: 'confrontation',
    profile: 'risky',
    destinationId: 'lane_a',
    encounterId: encounter.id,
  };
  return {
    ...base,
    wallet: { ...base.wallet, fuel },
    crewSlots: 1,
    crew: [{ instanceId: 'balance_crew', power: encounter.power * ratio, status: 'ready', passive: {} }],
    activeContract: contract,
  };
}

function weightedCurrency(success, failure, chance) {
  return Object.fromEntries(CURRENCIES.map(key => [
    key, Number((success[key] * chance + failure[key] * (1 - chance)).toFixed(4)),
  ]));
}

export function buildCombatBalanceMatrix({ now = Date.UTC(2026, 8, 22, 12), fuel = 1 } = {}) {
  const rows = [];
  for (const encounter of ENCOUNTERS_V1) {
    for (const ratio of RATIOS) {
      const player = fixtureFor(encounter, ratio, fuel, now);
      for (const orderId of ORDER_IDS) {
        const preview = previewContractAction(player, { id: 'order', orderId }, now);
        // A funded production preview supplies the gate for disabled rows.
        const funded = preview.ok ? preview : previewContractAction({
          ...player,
          wallet: { ...player.wallet, fuel: Math.max(fuel, 1) },
        }, { id: 'order', orderId }, now);
        const consequence = preview.ok ? preview.consequence : null;
        const successRewards = preview.ok
          ? normalizeCurrencyReward(resolveContractCombatPayout(player, player.activeContract, orderId, { rng: () => 0, now }).result.rewards)
          : null;
        const failureRewards = preview.ok
          ? normalizeCurrencyReward(resolveContractCombatPayout(player, player.activeContract, orderId, { rng: () => 1, now }).result.rewards)
          : null;
        rows.push({
          encounterId: encounter.id,
          ratio,
          orderId,
          enabled: preview.ok,
          reason: preview.ok ? null : preview.reason,
          crewPower: encounter.power * ratio,
          effectivePower: consequence?.effectivePower ?? null,
          rubberBandedEnemyPower: consequence?.enemyPower ?? null,
          winChance: consequence?.chance ?? null,
          fuel: funded.cost.fuel,
          successRewards,
          failureRewards,
          expectedRewards: preview.ok ? weightedCurrency(successRewards, failureRewards, consequence.chance) : null,
          failureHullMultiplier: consequence?.failureHullScale ?? COMBAT_ORDERS[orderId].failureHullScale ?? 1,
          failureInjuryPolicy: COMBAT_ORDERS[orderId].preventsInjury ? 'prevented'
            : COMBAT_ORDERS[orderId].forcesFailureInjury ? 'forced' : 'normal',
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: now,
    fixtureFuel: fuel,
    ratios: [...RATIOS],
    encounters: ENCOUNTERS_V1.map(({ id, name, power }) => ({ id, name, power })),
    rows,
  };
}

function currencyText(value) {
  return CURRENCIES.filter(key => value[key]).map(key => `${value[key]} ${key}`).join(' · ') || '0';
}

export function renderCombatBalanceMarkdown(matrix) {
  const lines = [
    '# Contract combat balance evidence',
    '',
    `Generated from production contract previews at ${new Date(matrix.generatedAt).toISOString()}. Fixture fuel: ${matrix.fixtureFuel}.`,
    '',
    'Ratios refer to ready crew power before combat bonuses and order modifiers. All rows use non-tutorial risky contracts; the tutorial guarantee is separate. Expected currency is chance-weighted from post-floor production payouts. Disabled rows have no executable expected payout. No balance target or approval verdict is implied.',
    '',
  ];
  for (const encounter of matrix.encounters) {
    lines.push(`## ${encounter.name} (${encounter.id}, power ${encounter.power})`, '');
    lines.push('| Crew ratio | Order | State | Power / enemy | Win chance | Fuel | Success | Failure | Expected | Failure hull × | Injury |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of matrix.rows.filter(item => item.encounterId === encounter.id)) {
      lines.push(`| ${row.ratio.toFixed(2)} | ${COMBAT_ORDERS[row.orderId].name} | ${row.enabled ? 'Enabled' : `Disabled (${row.reason})`} | ${row.enabled ? `${row.effectivePower} / ${row.rubberBandedEnemyPower}` : '—'} | ${row.enabled ? `${(row.winChance * 100).toFixed(1)}%` : '—'} | ${row.fuel} | ${row.enabled ? currencyText(row.successRewards) : '—'} | ${row.enabled ? currencyText(row.failureRewards) : '—'} | ${row.enabled ? currencyText(row.expectedRewards) : '—'} | ${row.failureHullMultiplier} | ${row.failureInjuryPolicy} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
