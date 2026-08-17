-- 0001_core: roles, commands (idempotency), tombstones, outbox, jobs, admin actions.
-- One database = one game + one environment (ADR-003): there is no game column anywhere.

-- Roles are cluster-global; create them NOLOGIN if absent. Ops assigns LOGIN + password
-- (`foundation db-roles`); tests do the same on a throwaway database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundation_app') THEN
    CREATE ROLE foundation_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foundation_migrator') THEN
    CREATE ROLE foundation_migrator NOLOGIN;
  END IF;
END $$;

-- ─── commands: transport idempotency + ops truth (duration/result) ───────────
CREATE TABLE commands (
  id            BIGSERIAL    PRIMARY KEY,
  scope_key     TEXT         NOT NULL,           -- player key, or the literal 'game'
  command_id    UUID         NOT NULL,
  type          TEXT         NOT NULL,
  actor         TEXT         NOT NULL,           -- player|admin:<keyId>|ops|job:<name>|system
  request_hash  TEXT         NOT NULL,           -- sha256 over {commandType, canonicalPayload}
  status        TEXT         NOT NULL CHECK (status IN ('reserved', 'done', 'failed')),
  result        JSONB,
  error_code    TEXT,
  trace_id      TEXT,
  received_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  duration_ms   INTEGER,
  retention     TEXT         NOT NULL CHECK (retention IN ('7d', '90d', '1y')),
  UNIQUE (scope_key, command_id)
);
CREATE INDEX commands_received ON commands (received_at);
CREATE INDEX commands_type_received ON commands (type, received_at);

-- Minimal idempotency memory kept as long as the ledger fact the command produced exists.
CREATE TABLE command_tombstones (
  scope_key     TEXT  NOT NULL,
  command_id    UUID  NOT NULL,
  type          TEXT  NOT NULL,
  request_hash  TEXT  NOT NULL,
  outcome_ref   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command_id)
);

-- ─── outbox: the only fan-out (ADR-004) ─────────────────────────────────────
CREATE TABLE outbox (
  id          BIGSERIAL   PRIMARY KEY,
  kind        TEXT        NOT NULL,
  player_key  TEXT,
  payload     JSONB       NOT NULL,
  command_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_created ON outbox (created_at);

CREATE TABLE outbox_deliveries (
  outbox_id     BIGINT      NOT NULL REFERENCES outbox (id),
  consumer      TEXT        NOT NULL,
  state         TEXT        NOT NULL CHECK (state IN ('pending', 'leased', 'delivered', 'dead')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  lease_until   TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT,
  delivered_at  TIMESTAMPTZ,
  PRIMARY KEY (outbox_id, consumer)
);
CREATE INDEX outbox_deliveries_pending ON outbox_deliveries (next_attempt_at) WHERE state IN ('pending', 'leased');

CREATE TABLE outbox_dead_letters (
  id           BIGSERIAL   PRIMARY KEY,
  outbox_id    BIGINT      NOT NULL REFERENCES outbox (id),
  consumer     TEXT        NOT NULL,
  attempts     INTEGER     NOT NULL,
  last_error   TEXT        NOT NULL,
  dead_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at  TIMESTAMPTZ,
  replayed_by  TEXT
);

-- ─── jobs: heartbeats ────────────────────────────────────────────────────────
CREATE TABLE job_runs (
  id           BIGSERIAL   PRIMARY KEY,
  name         TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,
  error        TEXT,
  duration_ms  INTEGER,
  detail       JSONB
);
CREATE INDEX job_runs_name_started ON job_runs (name, started_at DESC);

-- ─── admin actions: every admin call audited; negative adjustments reference a row here ──
CREATE TABLE admin_actions (
  id            BIGSERIAL   PRIMARY KEY,
  admin_key_id  TEXT        NOT NULL,
  scope         TEXT        NOT NULL,
  command_type  TEXT        NOT NULL,
  command_id    UUID        NOT NULL,
  target        TEXT,
  reason        TEXT,
  outcome       TEXT        NOT NULL,
  request_id    TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (command_id, command_type)
);
CREATE INDEX admin_actions_at ON admin_actions (at DESC);

-- ops: restore verification marker + misc key/values written by jobs
CREATE TABLE ops_markers (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rate limit windows (PG store; required in prod, memory store is dev/lab only)
CREATE TABLE rate_limits (
  key           TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);
