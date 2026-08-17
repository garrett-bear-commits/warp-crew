-- 0010_achievements: progress projection (rebuildable), daily claims (server_fact).
CREATE TABLE achievement_progress (
  player_key       TEXT        NOT NULL,
  achievement_id   TEXT        NOT NULL,
  content_version  INTEGER     NOT NULL,
  unlocked         BOOLEAN     NOT NULL DEFAULT false,
  unlocked_at      TIMESTAMPTZ,
  grant_key        TEXT,
  progress         JSONB       NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, achievement_id)
);

CREATE TABLE achievement_unlocks (
  player_key      TEXT        NOT NULL,
  achievement_id  TEXT        NOT NULL,
  content_version INTEGER     NOT NULL,
  grant_key       TEXT        NOT NULL,
  command_id      UUID        NOT NULL,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, achievement_id)
);

CREATE TABLE daily_claims (
  player_key  TEXT        NOT NULL,
  day         DATE        NOT NULL,          -- server UTC day
  ladder_day  INTEGER     NOT NULL,
  grant_key   TEXT        NOT NULL,
  command_id  UUID        NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, day)
);
