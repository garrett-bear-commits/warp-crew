-- 0002_identity: players projection + player_flags.
CREATE TABLE players (
  player_key      TEXT        PRIMARY KEY,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered      BOOLEAN     NOT NULL DEFAULT false,
  last_build      TEXT,
  entry_payload   JSONB,      -- allow-listed keys only
  seen_days       INTEGER     NOT NULL DEFAULT 1,
  last_seen_day   DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  erased_at       TIMESTAMPTZ
);

CREATE TABLE player_flags (
  player_key    TEXT        NOT NULL,
  flag          TEXT        NOT NULL CHECK (flag IN ('purchases_disabled', 'boards_hidden', 'grants_frozen')),
  enabled       BOOLEAN     NOT NULL,
  until         TIMESTAMPTZ,
  reason        TEXT        NOT NULL,
  admin_key_id  TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, flag)
);

CREATE TABLE player_strikes (
  player_key   TEXT        NOT NULL,
  id           BIGSERIAL   PRIMARY KEY,
  reason       TEXT        NOT NULL,
  ref          TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX player_strikes_player ON player_strikes (player_key);
