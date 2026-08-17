-- 0006_leaderboards: seasons on the schedule primitive, submissions, entries, placements, names.
CREATE TABLE leaderboard_seasons (
  board_key         TEXT        NOT NULL,
  season_key        TEXT        NOT NULL,
  rules_version     TEXT        NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('draft', 'active', 'closed')),
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  score_min         BIGINT      NOT NULL DEFAULT 0,
  score_max         BIGINT      NOT NULL,
  max_elapsed_ms    BIGINT      NOT NULL,
  quarantine_top_n  INTEGER     NOT NULL DEFAULT 10,
  rewards           JSONB,
  closed_at         TIMESTAMPTZ,
  version           INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (board_key, season_key)
);

CREATE TABLE leaderboard_runs (
  run_id       UUID        PRIMARY KEY,
  board_key    TEXT        NOT NULL,
  season_key   TEXT        NOT NULL,
  player_key   TEXT        NOT NULL,
  seed         TEXT        NOT NULL,
  rules_version TEXT       NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  command_id   UUID        NOT NULL
);
CREATE INDEX leaderboard_runs_player ON leaderboard_runs (player_key, started_at);

CREATE TABLE leaderboard_submissions (
  id                 BIGSERIAL   PRIMARY KEY,
  run_id             UUID        NOT NULL UNIQUE REFERENCES leaderboard_runs (run_id),
  board_key          TEXT        NOT NULL,
  season_key         TEXT        NOT NULL,
  player_key         TEXT        NOT NULL,
  score              BIGINT      NOT NULL,
  elapsed_ms         BIGINT      NOT NULL,     -- server-observed
  summary            JSONB,
  proof              JSONB,
  verification_level INTEGER     NOT NULL CHECK (verification_level BETWEEN 1 AND 3),
  visibility         TEXT        NOT NULL CHECK (visibility IN ('visible', 'quarantined', 'hidden', 'rejected')),
  review_reason      TEXT,
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  command_id         UUID        NOT NULL,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leaderboard_submissions_board ON leaderboard_submissions (board_key, season_key, score DESC, elapsed_ms ASC) WHERE visibility = 'visible';
CREATE INDEX leaderboard_submissions_player ON leaderboard_submissions (player_key, board_key, season_key);

-- projection: best visible per player per season (rebuildable)
CREATE TABLE leaderboard_entries (
  board_key    TEXT   NOT NULL,
  season_key   TEXT   NOT NULL,
  player_key   TEXT   NOT NULL,
  best_submission_id BIGINT NOT NULL REFERENCES leaderboard_submissions (id),
  score        BIGINT NOT NULL,
  elapsed_ms   BIGINT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_key, season_key, player_key)
);
CREATE INDEX leaderboard_entries_rank ON leaderboard_entries (board_key, season_key, score DESC, elapsed_ms ASC);

CREATE TABLE leaderboard_placements (
  receipt_id   TEXT        PRIMARY KEY,   -- <board>:<season>:<player>
  board_key    TEXT        NOT NULL,
  season_key   TEXT        NOT NULL,
  player_key   TEXT        NOT NULL,
  rank         INTEGER     NOT NULL,
  score        BIGINT      NOT NULL,
  state        TEXT        NOT NULL CHECK (state IN ('provisional', 'confirmed', 'voided')),
  grant_key    TEXT,
  minted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (board_key, season_key, player_key)
);

CREATE TABLE display_names (
  player_key    TEXT        PRIMARY KEY,
  display_name  TEXT        NOT NULL,
  raw_name      TEXT,
  moderated     BOOLEAN     NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
