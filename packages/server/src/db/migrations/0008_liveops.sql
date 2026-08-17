-- 0008_liveops: flags, content versions, schedules, segments, switches (ADR-012).
CREATE TABLE config_flags (
  key                          TEXT        PRIMARY KEY,
  enabled                      BOOLEAN     NOT NULL,
  value                        JSONB       NOT NULL,
  fallback                     JSONB       NOT NULL,
  rollout_percent              INTEGER     NOT NULL CHECK (rollout_percent BETWEEN 0 AND 100),
  shadow                       BOOLEAN     NOT NULL DEFAULT false,
  activate_at_session_boundary BOOLEAN     NOT NULL DEFAULT false,
  activate_at                  TIMESTAMPTZ,
  segment_id                   TEXT,
  version                      INTEGER     NOT NULL DEFAULT 1,
  reason                       TEXT        NOT NULL,
  actor                        TEXT        NOT NULL,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE config_flag_history (
  id        BIGSERIAL PRIMARY KEY,
  key       TEXT NOT NULL,
  version   INTEGER NOT NULL,
  state     JSONB NOT NULL,
  actor     TEXT NOT NULL,
  reason    TEXT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE content_versions (
  kind              TEXT        NOT NULL CHECK (kind IN ('achievements', 'quests', 'daily_rewards', 'offers', 'announcements', 'notification_copy')),
  env               TEXT        NOT NULL CHECK (env IN ('lab', 'prod')),
  version           INTEGER     NOT NULL,
  document          JSONB       NOT NULL,
  sha256            TEXT        NOT NULL,
  min_build_version TEXT,
  actor             TEXT        NOT NULL,
  reason            TEXT        NOT NULL,
  command_id        UUID        NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_from     INTEGER,
  PRIMARY KEY (kind, env, version)
);

-- current pointer per kind/env (projection of content_versions)
CREATE TABLE content_current (
  kind      TEXT NOT NULL,
  env       TEXT NOT NULL,
  version   INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, env),
  FOREIGN KEY (kind, env, version) REFERENCES content_versions (kind, env, version)
);

CREATE TABLE schedules (
  schedule_id  TEXT        PRIMARY KEY,
  kind         TEXT        NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  payload      JSONB,
  segment_id   TEXT,
  active       BOOLEAN     NOT NULL DEFAULT true,
  version      INTEGER     NOT NULL DEFAULT 1,
  actor        TEXT        NOT NULL,
  reason       TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE segments (
  segment_id  TEXT        PRIMARY KEY,
  predicate   JSONB       NOT NULL,
  version     INTEGER     NOT NULL DEFAULT 1,
  actor       TEXT        NOT NULL,
  reason      TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kill_switches (
  target     TEXT NOT NULL CHECK (target IN ('sku', 'command')),
  id         TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL,
  reason     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target, id)
);

CREATE TABLE liveops_settings (
  key        TEXT PRIMARY KEY,   -- min_build_version, maintenance
  value      JSONB NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  actor      TEXT NOT NULL,
  reason     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
