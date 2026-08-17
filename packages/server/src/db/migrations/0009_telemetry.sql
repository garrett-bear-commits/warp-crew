-- 0009_telemetry: integrity events (30 d) and journal entries (monthly partitions, 90 d).
CREATE TABLE integrity_events (
  id           BIGSERIAL   PRIMARY KEY,
  player_key   TEXT        NOT NULL,
  kind         TEXT        NOT NULL,
  at           TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail       JSONB,
  message      TEXT,
  breadcrumbs  JSONB,
  build_version TEXT,
  request_id   TEXT,
  command_id   UUID
);
CREATE INDEX integrity_events_player_at ON integrity_events (player_key, at DESC);
CREATE INDEX integrity_events_received ON integrity_events (received_at);
CREATE INDEX integrity_events_kind_received ON integrity_events (kind, received_at);

CREATE TABLE integrity_budgets (
  player_key  TEXT NOT NULL,
  day         DATE NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_key, day)
);

CREATE TABLE journal_entries (
  id            BIGSERIAL,
  player_key    TEXT        NOT NULL,
  generation    INTEGER     NOT NULL,
  seq           BIGINT      NOT NULL,          -- fromSeq + index; monotonic per (player, generation)
  tick          BIGINT      NOT NULL,
  at            TIMESTAMPTZ NOT NULL,
  kind          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  args          JSONB,
  build_version TEXT        NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (received_at, id)
) PARTITION BY RANGE (received_at);
CREATE INDEX journal_entries_player_seq ON journal_entries (player_key, generation, seq);

CREATE TABLE journal_entries_default PARTITION OF journal_entries DEFAULT;

CREATE TABLE journal_cursors (
  player_key  TEXT NOT NULL,
  generation  INTEGER NOT NULL,
  next_seq    BIGINT NOT NULL,
  day         DATE NOT NULL,
  used_today  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_key, generation)
);

-- Monthly partition management: create the partition for a given month if missing (called by a job
-- and at boot). Kept as SQL so it runs under the migrator role via SECURITY DEFINER later.
CREATE FUNCTION ensure_journal_partition(month_start DATE) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  part TEXT := 'journal_entries_' || to_char(month_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF journal_entries FOR VALUES FROM (%L) TO (%L)',
      part, month_start, (month_start + INTERVAL '1 month')::date);
  END IF;
  RETURN part;
END $$;
