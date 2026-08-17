-- 0004_purchases: verified receipts + adjustments (ADR-007). Provider tokens are the idempotency
-- authority. Raw signed receipts are not stored: a stolen row must not be a replayable credential.
CREATE TABLE purchase_transactions (
  id              BIGSERIAL   PRIMARY KEY,
  provider_token  TEXT        NOT NULL UNIQUE,
  player_key      TEXT        NOT NULL,
  sku             TEXT        NOT NULL,
  pack_key        TEXT,
  base_amount     INTEGER     NOT NULL CHECK (base_amount >= 0),
  granted         INTEGER     NOT NULL CHECK (granted >= 0),
  price           NUMERIC(12,2),
  currency        TEXT,
  classification  TEXT        NOT NULL CHECK (classification IN ('paid', 'sandbox', 'unclassified', 'unsupported')),
  created_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  source          TEXT        NOT NULL CHECK (source IN ('live_receipt', 'financials_import')),
  command_id      UUID,
  grant_key       TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- sandbox never mints (schema CHECK)
  CHECK (classification = 'paid' OR granted = 0)
);
CREATE INDEX purchase_transactions_player ON purchase_transactions (player_key, created_at, id);
CREATE INDEX purchase_transactions_pack ON purchase_transactions (player_key, pack_key) WHERE classification = 'paid';

CREATE TABLE purchase_adjustments (
  id               BIGSERIAL   PRIMARY KEY,
  player_key       TEXT        NOT NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('refund', 'make_good', 'correction')),
  delta            INTEGER     NOT NULL,
  reason           TEXT        NOT NULL,
  admin_action_id  BIGINT      REFERENCES admin_actions (id),
  transaction_id   BIGINT      REFERENCES purchase_transactions (id),
  command_id       UUID        NOT NULL UNIQUE,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at         TIMESTAMPTZ,
  -- negative adjustments always reference an admin action
  CHECK (delta >= 0 OR admin_action_id IS NOT NULL)
);
CREATE INDEX purchase_adjustments_player ON purchase_adjustments (player_key, recorded_at);
