// Engine and codec conformance for Warp Crew on the core (docs/using-the-core/add-a-game.md §3,
// testing-and-release.md): progressOf never decreases across a scripted session played through
// the engine, offline time never raises it, the codec reads every save schema 1..9 (fixtures from
// each version's own createNewPlayer, test/fixtures/saves/README.md) and round-trips the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warpcrewCodec, SAVE_VERSION, decodePlayer } from '../src/core/codec.js';
import { warpcrewEngine } from '../src/core/engine.js';
import { progressOf, summaryOf, isWarpcrewPlayer } from '../src/core/progress.js';
import { nodeWarpcrew } from './helpers/coreClient.mjs';

const fixture = (v) => JSON.parse(readFileSync(new URL(`./fixtures/saves/v${v}.json`, import.meta.url), 'utf8'));

test('the codec schema is the player version the server policy reads', () => {
  assert.equal(SAVE_VERSION, 9);
  assert.equal(warpcrewCodec.schemaVersion, SAVE_VERSION);
});

test('every saved schema 1..9 reads, keeps its progress, and round-trips', () => {
  for (let v = 1; v <= 9; v++) {
    const raw = fixture(v);
    assert.equal(raw.version, v, `fixture v${v}`);
    const read = warpcrewCodec.trialDeserialize(JSON.stringify({ schemaVersion: v, state: raw }));
    assert.ok(read.ok, `v${v}: ${read.reason} ${read.message ?? ''}`);
    assert.equal(read.state.version, SAVE_VERSION);
    assert.equal(read.migrated, v !== SAVE_VERSION);
    assert.ok(isWarpcrewPlayer(read.state), `v${v} passes the server's shape check`);
    assert.equal(progressOf(read.state), progressOf(raw), `v${v} progress survives migration`);
    assert.equal(read.state.wallet.gems, 40, `v${v} wallet survives`);
    // Encode → decode is stable from then on.
    const once = warpcrewCodec.encode(read.state);
    const again = warpcrewCodec.decode(once);
    assert.equal(warpcrewCodec.encode(again), once, `v${v} round-trips`);
  }
});

test('legacy fields and garbage', () => {
  const legacy = { ...fixture(9), cloudSeq: 4, cloudDirty: true, lastSavedAt: 1, pendingReceipts: ['r'], purchaseSkus: { t: 'wc_gems_s' } };
  const read = decodePlayer(legacy);
  for (const key of ['cloudSeq', 'cloudDirty', 'lastSavedAt', 'pendingReceipts', 'purchaseSkus']) assert.ok(!(key in read), key);
  for (const bad of ['null', '[]', '{"schemaVersion":9,"state":null}', '{"schemaVersion":9,"state":{"version":9}}', '{"schemaVersion":10,"state":{}}', 'nope']) {
    assert.equal(warpcrewCodec.trialDeserialize(bad).ok, false, bad);
  }
  assert.equal(warpcrewCodec.trialDeserialize('{"schemaVersion":10,"state":{}}').reason, 'newer_schema');
});

test('the engine refuses a malformed or shallower player and never touches progress offline', () => {
  const ctx = { now: 1, rng: { next: () => 0.5, int: () => 0, state: () => 0, restore() {} }, tick: 0, catchUp: false };
  const deep = { ...fixture(9), stats: { ...fixture(9).stats, jumps: 9 } };
  const shallow = { ...deep, stats: { ...deep.stats, jumps: 0 } };
  assert.equal(warpcrewEngine.apply(deep, { type: 'set', player: shallow }, ctx).state, deep);
  assert.equal(warpcrewEngine.apply(deep, { type: 'set', player: { wallet: 'x' } }, ctx).state, deep);
  assert.equal(warpcrewEngine.apply(deep, { type: 'set', player: { ...deep, crew: [null] } }, ctx).state, deep, 'a crew entry the server would refuse');
  assert.equal(warpcrewEngine.step, undefined, 'no fixed step: Warp Crew keeps its own real-time scheduling');
  assert.equal(warpcrewEngine.onGap, undefined, 'offline time is computed from timestamps when read, never stepped');
  const prepared = warpcrewEngine.apply(deep, { type: 'prepare' }, { ...ctx, now: Date.UTC(2031, 0, 1) }).state;
  assert.equal(progressOf(prepared), progressOf(deep), 'a day later, prepare never adds progress');
  assert.deepEqual(warpcrewEngine.summary(deep), summaryOf(deep));
});

test('progressOf never decreases across a scripted session through the core client', async () => {
  const now = Date.UTC(2030, 8, 23, 12);
  const { wc } = nodeWarpcrew({ playerId: 'conformance', now: () => now });
  await wc.boot();
  let last = wc.progress();
  const seen = [last];
  wc.client.subscribe(({ state }) => {
    const p = progressOf(state);
    assert.ok(p >= last, `progress fell from ${last} to ${p}`);
    last = p;
    seen.push(p);
  });
  const play = (act, data = {}) => {
    const { result, committed } = wc.session(act, data, {});
    assert.ok(result?.ok && committed, `${act}: ${result?.reason}`);
    return wc.state();
  };
  const enc = () => ({ acceptanceId: wc.state().activeEncounter.acceptanceId, revision: wc.state().activeEncounter.revision });
  play('splash-dismiss');
  play('captain-choose', { templateId: 'captain_cyborg', name: 'Rook' });
  play('tutorial-first-hire');
  play('station-assign', { id: wc.state().tutorial.firstHireInstanceId, station: 'weapons' });
  play('tutorial-fight-start');
  play('encounter-command', { ...enc(), command: { type: 'target', room: 'weapons' } });
  for (let i = 0; i < 80 && wc.state().tutorial.phase === 'fight'; i++) play('encounter-advance', enc());
  assert.equal(wc.state().tutorial.phase, 'claim');
  const c = wc.state().activeContract;
  play('contract-claim', { acceptanceId: c.acceptanceId, revision: c.revision });
  play('tutorial-name', { name: 'The Sparrow' });
  play('tutorial-welcome-pull');
  play('tutorial-register-skip');
  assert.equal(wc.state().tutorial.completed, true);
  assert.ok(wc.progress() > 0, 'the session made progress');
  // A refused session action changes nothing and never lowers progress.
  assert.equal(wc.session('tutorial-register-skip', {}, {}).committed, false);
  wc.prepare();
  assert.ok(Math.min(...seen.slice(1).map((p, i) => p - seen[i])) >= 0);
  // The device slot holds exactly what the engine has, at the current schema.
  await wc.save('immediate');
  const slot = JSON.parse(wc.client.storage.get(wc.slotKey('conformance')));
  assert.equal(slot.schemaVersion, SAVE_VERSION);
  assert.equal(slot.progress, wc.progress());
  wc.client.destroy();
});
