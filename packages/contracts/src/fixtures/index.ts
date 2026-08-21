// Hand-authored fixture examples, validated against the schemas in test. Shared by both sides:
// server route tests replay them, the client test-suite decodes them. Keep them boring and
// obviously valid; recordings from the real server are added under fixtures/recorded/.
import type { Static, TSchema } from '@sinclair/typebox';
import * as C from '../index.ts';

export const FIXTURE_UUIDS = {
  commandId: '018f4a2e-4b1c-7a2d-9c3e-1f2a3b4c5d6e',
  commandId2: '018f4a2e-4b1c-7a2d-9c3e-1f2a3b4c5d6f',
  sessionId: '2f5b7f6a-3c9d-4e1f-8a2b-0c1d2e3f4a5b',
  restartId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  runId: '9b2d5c1e-8f0a-4c7b-a1d2-3e4f5a6b7c8d',
} as const;

export const T0 = 1_786_924_800_000; // 2026-08-17T00:00:00Z
export const REQUEST_ID = 'req_fixture_0001';

export interface Fixture<B extends TSchema | undefined, R extends TSchema> {
  routeId: string;
  body?: B extends TSchema ? Static<B> : undefined;
  response: Static<R>;
}

const blob = JSON.stringify({ v: 1, counter: 42, gold: 10, upgrades: { auto: 1 } });

export const saveWriteBody: C.SaveWriteBody = {
  commandId: FIXTURE_UUIDS.commandId,
  generation: 0,
  clientSeq: 12,
  baseSeq: 11,
  sessionId: FIXTURE_UUIDS.sessionId,
  progress: 4200,
  savedAt: T0 + 60_000,
  schemaVersion: 1,
  buildVersion: '1.0.0+fixture',
  enc: 'json',
  reason: 'timer',
  blob,
  summary: { counter: 42, gold: 10 },
};

export const saveWriteResultAnchored: C.SaveWriteResult = {
  disposition: 'anchored',
  seq: 12,
  currentProgress: 4200,
  generation: 0,
  blobSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  requestId: REQUEST_ID,
  serverNow: T0 + 60_100,
};

export const saveWriteResultRefused: C.SaveWriteResult = {
  disposition: 'stored_refused',
  reason: 'progress_regression',
  seq: 13,
  currentProgress: 4200,
  generation: 0,
  blobSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  requestId: REQUEST_ID,
  serverNow: T0 + 60_200,
};

export const saveWriteResultQuarantined: C.SaveWriteResult = {
  disposition: 'stored_quarantined',
  flags: ['progress_jump'],
  seq: 14,
  currentProgress: 4200,
  generation: 0,
  blobSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  divergent: { headSeq: 12, headWriterAt: T0 + 60_000, headSummary: { counter: 42 } },
  requestId: REQUEST_ID,
  serverNow: T0 + 60_300,
};

export const saveBeaconBody: C.SaveBeaconBody = {
  ...saveWriteBody,
  commandId: FIXTURE_UUIDS.commandId2,
  reason: 'teardown',
  playerKey: 'player_fixture_1',
  token: 'eyJhbGciOiJIUzI1NiJ9.e30.fixture',
};

export const saveCurrentEmpty: C.SaveCurrentResponse = {
  empty: true,
  generation: 0,
  lineage: { generation: 0, kind: 'initial', openedAt: T0 },
  requestId: REQUEST_ID,
  serverNow: T0,
};

export const snapshotMeta: C.SnapshotMeta = {
  seq: 12,
  generation: 0,
  progress: 4200,
  clientSeq: 12,
  baseSeq: 11,
  sessionId: FIXTURE_UUIDS.sessionId,
  commandId: FIXTURE_UUIDS.commandId,
  savedAt: T0 + 60_000,
  receivedAt: T0 + 60_100,
  bytes: blob.length,
  encBytes: blob.length,
  blobSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  schemaVersion: 1,
  buildVersion: '1.0.0+fixture',
  reason: 'timer',
  disposition: 'anchored',
  flags: [],
  summary: { counter: 42, gold: 10 },
  hasBlob: true,
};

export const saveCurrentWithSnapshot: C.SaveCurrentResponse = {
  empty: false,
  generation: 0,
  lineage: { generation: 0, kind: 'initial', openedAt: T0 },
  snapshot: snapshotMeta,
  blob,
  enc: 'json',
  pendingQuarantine: { seq: 14, progress: 9000, flags: ['progress_jump'], receivedAt: T0 + 60_300 },
  requestId: REQUEST_ID,
  serverNow: T0 + 61_000,
};

export const lineageRestartBody: C.LineageRestartBody = {
  commandId: FIXTURE_UUIDS.commandId,
  restartId: FIXTURE_UUIDS.restartId,
  expectedGeneration: 0,
};

export const generationReceipt: C.GenerationReceipt = {
  generation: 1,
  kind: 'restart',
  entitlement: 0,
  duplicate: false,
  requestId: REQUEST_ID,
  serverNow: T0,
};

export const purchaseVerifyBody: C.PurchaseVerifyBody = {
  commandId: FIXTURE_UUIDS.commandId,
  purchaseSigned: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZW1wbGF0ZSJ9.fixture',
};

export const purchaseVerifyResult: C.PurchaseVerifyResult = {
  purchaseToken: 'provider-token-fixture',
  outcome: 'recorded',
  completion: 'withhold',
  purchase: {
    id: 1,
    sku: 'gems_200',
    packKey: 'handful',
    classification: 'sandbox',
    granted: 0,
    price: 0,
    currency: 'USD',
    sandbox: true,
    createdAt: T0,
    completedAt: T0 + 1000,
    recordedAt: T0 + 2000,
  },
  requestId: REQUEST_ID,
  serverNow: T0 + 2000,
};

export const purchaseBatchVerifyBody: C.PurchaseBatchVerifyBody = {
  commandId: FIXTURE_UUIDS.commandId2,
  purchasesSigned: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZW1wbGF0ZSIsInB1cmNoYXNlcyI6W119.fixture',
};

export const purchaseBatchVerifyResult: C.PurchaseBatchVerifyResult = {
  outcome: 'processed',
  results: [
    {
      purchaseToken: 'provider-token-fixture',
      outcome: 'recorded',
      completion: 'withhold',
      purchase: purchaseVerifyResult.purchase!,
    },
  ],
  requestId: REQUEST_ID,
  serverNow: T0 + 2000,
};

export const grantClaimBody: C.GrantClaimBody = {
  commandId: FIXTURE_UUIDS.commandId,
  grantKey: 'admin:ticket-123:make-good',
};

export const grantClaimResult: C.GrantClaimResult = {
  outcome: 'claimed',
  duplicate: false,
  grant: {
    grantKey: 'admin:ticket-123:make-good',
    source: 'admin',
    rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 500 }],
    reason: 'make-good for outage',
    ticketRef: 'ticket-123',
    createdAt: T0,
    claimedAt: T0 + 5000,
  },
  requestId: REQUEST_ID,
  serverNow: T0 + 5000,
};

export const codeRedeemBody: C.CodeRedeemBody = {
  commandId: FIXTURE_UUIDS.commandId,
  code: 'WELCOME-2026-ABCD',
};

export const configResponse: C.ConfigResponse = {
  gameId: 'template',
  env: 'dev',
  contractVersion: C.CONTRACT_VERSION,
  minBuildVersion: '0.0.0',
  maintenance: false,
  killSwitches: { skus: [], commands: [] },
  contentVersions: [{ kind: 'achievements', version: 1, publishedAt: T0, sha256: '0'.repeat(64) }],
  flags: { 'sale.summer': true, 'idle.rate': 1.5 },
  shadowFlags: {},
  schedules: [
    {
      id: 'summer-sale',
      kind: 'sale',
      startsAt: T0,
      endsAt: T0 + 86_400_000,
      active: true,
      payload: { discount: 50 },
    },
  ],
  requestId: REQUEST_ID,
  serverNow: T0,
};

export const inboxResponse: C.InboxResponse = {
  letters: [
    {
      id: 1,
      kind: 'support',
      title: 'Sorry about that',
      body: 'Here is 500 gold.',
      grantKey: 'admin:ticket-123:make-good',
      createdAt: T0,
    },
    {
      id: 2,
      kind: 'announcement',
      title: 'Summer sale',
      body: '50% off gems today.',
      createdAt: T0,
      readAt: T0 + 100,
    },
  ],
  unread: 1,
  requestId: REQUEST_ID,
  serverNow: T0,
};

export const runStartBody: C.RunStartBody = {
  commandId: FIXTURE_UUIDS.commandId,
  runId: FIXTURE_UUIDS.runId,
};
export const runSubmitBody: C.RunSubmitBody = {
  commandId: FIXTURE_UUIDS.commandId2,
  runId: FIXTURE_UUIDS.runId,
  score: 1234,
  summary: { counter: 1234 },
};
export const runSubmitResult: C.RunSubmitResult = {
  outcome: 'accepted_quarantined',
  visibility: 'quarantined',
  rank: 1,
  verificationLevel: 2,
  requestId: REQUEST_ID,
  serverNow: T0,
};

export const integrityBatchBody: C.IntegrityBatchBody = {
  commandId: FIXTURE_UUIDS.commandId,
  events: [
    { kind: 'storage_blocked', at: T0, detail: { mode: 'memory' } },
    {
      kind: 'game_error',
      at: T0 + 10,
      message: 'TypeError: x is undefined',
      breadcrumbs: [{ name: 'tap', tick: 40 }],
    },
  ],
};

export const journalShipBody: C.JournalShipBody = {
  commandId: FIXTURE_UUIDS.commandId,
  generation: 0,
  fromSeq: 0,
  buildVersion: '1.0.0+fixture',
  entries: [
    { tick: 1, now: T0, kind: 'action', name: 'tap' },
    { tick: 20, now: T0 + 2000, kind: 'settle', name: 'settle' },
    {
      tick: 21,
      now: T0 + 90_000,
      kind: 'gap',
      name: 'gap',
      args: { deviceSec: 88, serverSec: 88 },
    },
  ],
};

export const achievementsDocument: C.AchievementsDocument = {
  version: 1,
  clientClaimPremiumBudget: 50,
  achievements: [
    {
      id: 'first-hundred',
      title: 'First hundred',
      criteria: [{ source: 'client_claim', fact: 'progress', op: 'gte', value: 100 }],
      rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }],
    },
    {
      id: 'patron',
      title: 'Patron',
      criteria: [{ source: 'server_fact', fact: 'purchases_paid_count', op: 'gte', value: 1 }],
      rewards: [{ kind: 'premium_currency', amount: 25 }],
    },
    {
      id: 'summer-visitor',
      title: 'Summer visitor',
      criteria: [{ source: 'server_fact', fact: 'seen_days', op: 'gte', value: 1 }],
      rewards: [{ kind: 'cosmetic', cosmeticId: 'hat-summer' }],
      window: { startsAt: T0, endsAt: T0 + 30 * 86_400_000 },
    },
  ],
};

export const dailyRewardsDocument: C.DailyRewardsDocument = {
  version: 1,
  ladder: [
    { day: 1, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 50 }] },
    { day: 2, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 75 }] },
    { day: 3, rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 100 }] },
  ],
};

export const adminGrantBody: C.AdminGrantBody = {
  commandId: FIXTURE_UUIDS.commandId,
  playerKey: 'player_fixture_1',
  grantKey: 'admin:ticket-123:make-good',
  rewards: [{ kind: 'soft_currency', currency: 'gold', amount: 500 }],
  reason: 'make-good for outage',
  ticketRef: 'ticket-123',
};

export const errorEnvelope: C.ErrorEnvelope = {
  error: 'idempotency_mismatch',
  message: 'commandId reused with a different payload',
  correlationId: REQUEST_ID,
};

/** Every fixture keyed by route id → {body?, response} for contract tests on both sides. */
export const ROUTE_FIXTURES: Record<string, { body?: unknown; response: unknown }[]> = {
  'saves.write': [
    { body: saveWriteBody, response: saveWriteResultAnchored },
    { body: saveWriteBody, response: saveWriteResultRefused },
    { body: saveWriteBody, response: saveWriteResultQuarantined },
  ],
  'saves.beacon': [{ body: saveBeaconBody, response: saveWriteResultAnchored }],
  'saves.current': [{ response: saveCurrentEmpty }, { response: saveCurrentWithSnapshot }],
  'lineage.restart': [{ body: lineageRestartBody, response: generationReceipt }],
  'purchases.verify': [{ body: purchaseVerifyBody, response: purchaseVerifyResult }],
  'purchases.verifyBatch': [{ body: purchaseBatchVerifyBody, response: purchaseBatchVerifyResult }],
  'grants.claim': [{ body: grantClaimBody, response: grantClaimResult }],
  'codes.redeem': [
    { body: codeRedeemBody, response: { ...grantClaimResult, outcome: 'redeemed' } },
  ],
  'liveops.config': [{ response: configResponse }],
  'inbox.list': [{ response: inboxResponse }],
  'boards.start': [
    {
      body: runStartBody,
      response: {
        runId: FIXTURE_UUIDS.runId,
        seasonKey: 's1',
        rulesVersion: 'v1',
        startedAt: T0,
        seed: 'abc',
        duplicate: false,
        requestId: REQUEST_ID,
        serverNow: T0,
      },
    },
  ],
  'boards.submit': [{ body: runSubmitBody, response: runSubmitResult }],
  'telemetry.integrity': [
    {
      body: integrityBatchBody,
      response: {
        accepted: 2,
        dropped: 0,
        budgetRemaining: 98,
        requestId: REQUEST_ID,
        serverNow: T0,
      },
    },
  ],
  'journal.ship': [
    {
      body: journalShipBody,
      response: {
        accepted: 3,
        dropped: 0,
        nextSeq: 3,
        outcome: 'stored',
        requestId: REQUEST_ID,
        serverNow: T0,
      },
    },
  ],
  'admin.grant': [
    {
      body: adminGrantBody,
      response: {
        grantKey: adminGrantBody.grantKey,
        duplicate: false,
        requestId: REQUEST_ID,
        serverNow: T0,
      },
    },
  ],
};

export const CONTENT_FIXTURES = { achievementsDocument, dailyRewardsDocument };
