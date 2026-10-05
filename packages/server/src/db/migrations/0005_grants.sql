-- 0005_grants: the one reward primitive (ADR-008) + codes/campaigns.
CREATE TABLE grants (
  id           BIGSERIAL   PRIMARY KEY,
  player_key   TEXT        NOT NULL,
  grant_key    TEXT        NOT NULL,
  source       TEXT        NOT NULL CHECK (source IN ('admin', 'cohort', 'purchase', 'achievement', 'code', 'placement', 'daily_reward', 'system')),
  rewards      JSONB       NOT NULL,
  premium_amount INTEGER   NOT NULL DEFAULT 0 CHECK (premium_amount >= 0),
  reason       TEXT        NOT NULL,
  ticket_ref   TEXT,
  title        TEXT,
  body         TEXT,
  actor        TEXT        NOT NULL,
  command_id   UUID,
  -- budget bookkeeping: client-claim-sourced premium counts against the per-player lifetime budget
  claim_sourced BOOLEAN    NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  UNIQUE (player_key, grant_key)
);
CREATE INDEX grants_player_created ON grants (player_key, created_at);

CREATE TABLE grant_claims (
  grant_id     BIGINT      PRIMARY KEY REFERENCES grants (id),
  player_key   TEXT        NOT NULL,
  command_id   UUID        NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE code_campaigns (
  campaign_id              TEXT        PRIMARY KEY,
  rewards                  JSONB       NOT NULL,
  max_redemptions_per_code INTEGER     NOT NULL CHECK (max_redemptions_per_code >= 1),
  registered_only          BOOLEAN     NOT NULL DEFAULT false,
  expires_at               TIMESTAMPTZ,
  reason                   TEXT        NOT NULL,
  actor                    TEXT        NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at                TIMESTAMPTZ  -- per-campaign lock after K bad guesses
);

CREATE TABLE codes (
  code_hash     TEXT        PRIMARY KEY,   -- sha256 of the normalised code (≥ 40 bits after normalisation)
  campaign_id   TEXT        NOT NULL REFERENCES code_campaigns (campaign_id),
  redemptions   INTEGER     NOT NULL DEFAULT 0
);
CREATE INDEX codes_campaign ON codes (campaign_id);

CREATE TABLE code_redemptions (
  code_hash    TEXT        NOT NULL REFERENCES codes (code_hash),
  player_key   TEXT        NOT NULL,
  grant_id     BIGINT      NOT NULL REFERENCES grants (id),
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code_hash, player_key)
);

CREATE TABLE code_bad_guesses (
  id          BIGSERIAL   PRIMARY KEY,
  player_key  TEXT        NOT NULL,
  campaign_id TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX code_bad_guesses_player_at ON code_bad_guesses (player_key, at);
