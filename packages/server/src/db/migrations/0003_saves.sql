-- 0003_saves: append-only snapshots, blobs, reviews, generations, erasures (§4.4, ADR-006).
CREATE TABLE generations (
  player_key    TEXT        NOT NULL,
  generation    INTEGER     NOT NULL CHECK (generation >= 0),
  kind          TEXT        NOT NULL CHECK (kind IN ('initial', 'restart', 'admin_restore', 'player_restore', 'reattach', 'erased')),
  restart_id    UUID,       -- business key; NULL for non-restart kinds
  seed_seq      BIGINT,     -- snapshot seq (previous generation) this generation was seeded from
  entitlement   INTEGER     NOT NULL DEFAULT 0 CHECK (entitlement >= 0),
  reason        TEXT,
  actor         TEXT        NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, generation)
);
-- the same restartId can never open two generations
CREATE UNIQUE INDEX generations_restart_id ON generations (player_key, restart_id) WHERE restart_id IS NOT NULL;

CREATE TABLE save_snapshots (
  id              BIGSERIAL   PRIMARY KEY,
  player_key      TEXT        NOT NULL,
  slot            TEXT        NOT NULL DEFAULT 'main',
  generation      INTEGER     NOT NULL,
  seq             BIGINT      NOT NULL,            -- server-assigned under the player lock
  client_seq      BIGINT      NOT NULL,            -- diagnostic only
  base_seq        BIGINT      NOT NULL,
  session_id      UUID        NOT NULL,
  command_id      UUID        NOT NULL,
  progress        BIGINT      NOT NULL CHECK (progress >= 0 AND progress <= 9007199254740991),
  client_progress BIGINT,
  saved_at        TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  bytes           INTEGER     NOT NULL CHECK (bytes >= 0),      -- canonical decoded UTF-8 length
  enc_bytes       INTEGER     NOT NULL CHECK (enc_bytes >= 0),
  blob_sha256     TEXT        NOT NULL,                          -- of canonical decoded JSON
  schema_version  INTEGER     NOT NULL,
  build_version   TEXT        NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'beacon', 'restore', 'admin', 'qa_import', 'reattach')),
  disposition     TEXT        NOT NULL CHECK (disposition IN ('anchored', 'stored_quarantined', 'stored_refused')),
  reject_reason   TEXT,
  flags           TEXT[]      NOT NULL DEFAULT '{}',
  rank_hint       NUMERIC[],
  summary         JSONB,
  enc             TEXT        NOT NULL CHECK (enc IN ('json', 'gzip+b64')),
  reason          TEXT        NOT NULL CHECK (reason IN ('autosave', 'timer', 'teardown', 'important', 'restore', 'boot-retry')),
  UNIQUE (player_key, seq),
  UNIQUE (player_key, command_id),
  FOREIGN KEY (player_key, generation) REFERENCES generations (player_key, generation)
);
CREATE INDEX save_snapshots_anchor ON save_snapshots (player_key, generation, progress DESC, seq DESC) WHERE disposition IN ('anchored', 'stored_quarantined');
CREATE INDEX save_snapshots_received ON save_snapshots (received_at);

CREATE TABLE save_blobs (
  save_id  BIGINT PRIMARY KEY REFERENCES save_snapshots (id),
  blob     BYTEA  NOT NULL
);

-- Terminal review: one per save, never revised (UNIQUE + BEFORE INSERT raise).
CREATE TABLE save_reviews (
  id                   BIGSERIAL   PRIMARY KEY,
  player_key           TEXT        NOT NULL,
  save_id              BIGINT      NOT NULL UNIQUE REFERENCES save_snapshots (id),
  action               TEXT        NOT NULL CHECK (action IN ('promote', 'reject')),
  actor                TEXT        NOT NULL,
  rule_version         TEXT        NOT NULL,
  reason               TEXT        NOT NULL,
  previous_anchor_seq  BIGINT,
  at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION save_reviews_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM save_reviews WHERE save_id = NEW.save_id) THEN
    RAISE EXCEPTION 'review_final: save % already reviewed', NEW.save_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER save_reviews_final_trg BEFORE INSERT ON save_reviews FOR EACH ROW EXECUTE FUNCTION save_reviews_final();

CREATE TABLE erasures (
  id           BIGSERIAL   PRIMARY KEY,
  player_key   TEXT        NOT NULL,
  generation   INTEGER     NOT NULL,
  reason       TEXT        NOT NULL,
  actor        TEXT        NOT NULL,
  ticket_ref   TEXT,
  erased_rows  INTEGER     NOT NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
