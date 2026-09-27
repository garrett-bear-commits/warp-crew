-- Warp Crew save and purchase authority.
--
-- save_events is INSERT ONLY. Jest's player store and localStorage both
-- overwrite the only copy; a server that also overwrote would just move the
-- "your progress is gone" problem onto our machine. Every write is kept,
-- including the ones we refuse, so a wrong refusal is recoverable.
-- The server assigns seq (last + 1 under a per-player lock). What the client
-- claimed is kept only for diagnosis (Barrowdeep learned this the hard way).

CREATE TABLE IF NOT EXISTS save_events (
  id            BIGSERIAL   PRIMARY KEY,
  player_key    TEXT        NOT NULL,
  seq           BIGINT      NOT NULL,
  client_seq    BIGINT,
  base_seq      BIGINT,
  saved_at      BIGINT      NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  bytes         INTEGER     NOT NULL,
  accepted      BOOLEAN     NOT NULL,
  reject_reason TEXT,
  blob          TEXT,
  UNIQUE (player_key, seq)
);
CREATE INDEX IF NOT EXISTS save_events_current ON save_events (player_key, seq DESC) WHERE accepted;

-- Verified Jest purchases. The provider token is the idempotency authority.
-- Raw signed receipts are not stored: a stolen row must not be replayable.
CREATE TABLE IF NOT EXISTS purchase_transactions (
  id              BIGSERIAL   PRIMARY KEY,
  provider_token  TEXT        NOT NULL UNIQUE,
  player_key      TEXT        NOT NULL,
  sku             TEXT        NOT NULL,
  classification  TEXT        NOT NULL CHECK (classification IN ('paid', 'sandbox', 'unclassified', 'unsupported', 'duplicate_one_time')),
  granted         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  one_time        BOOLEAN     NOT NULL DEFAULT false,
  price           INTEGER,
  currency        TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_transactions_player ON purchase_transactions (player_key, created_at, id);
-- One-time packs: the database refuses a second granting row per player and SKU.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_one_time_once
  ON purchase_transactions (player_key, sku) WHERE one_time AND classification IN ('paid', 'sandbox', 'unclassified');
