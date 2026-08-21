-- Older builds used purchase:<providerToken> as the grant key. Provider tokens can be 2048
-- characters, while current writes and public minting inputs cap grant keys at 200. Canonicalise
-- only the validated legacy shape, retain an alias to the same grant row, and update every
-- relational grant-key reference. Historical JSON in commands/outbox is deliberately immutable;
-- the alias keeps those audit keys resolvable and response contracts accept legacy replays.

CREATE TABLE grant_key_aliases (
  player_key  TEXT        NOT NULL,
  alias_key   TEXT        NOT NULL,
  grant_id    BIGINT      NOT NULL REFERENCES grants (id),
  reason      TEXT        NOT NULL CHECK (reason IN ('legacy_purchase_provider_token')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, alias_key),
  UNIQUE (grant_id, alias_key),
  CHECK (char_length(alias_key) > 200 AND alias_key LIKE 'purchase:%')
);
CREATE INDEX grant_key_aliases_grant ON grant_key_aliases (grant_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM purchase_transactions
    WHERE char_length(grant_key) > 200
      AND grant_key IS DISTINCT FROM 'purchase:' || provider_token
  ) THEN
    RAISE EXCEPTION 'legacy purchase grant migration refused: long transaction key does not match provider token';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM purchase_transactions p
    LEFT JOIN grants g
      ON g.player_key = p.player_key AND g.grant_key = p.grant_key AND g.source = 'purchase'
    WHERE char_length(p.grant_key) > 200 AND g.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy purchase grant migration refused: transaction has no matching purchase grant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM grants g
    LEFT JOIN purchase_transactions p
      ON p.player_key = g.player_key AND p.grant_key = g.grant_key
    WHERE g.source = 'purchase' AND char_length(g.grant_key) > 200 AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy purchase grant migration refused: purchase grant has no matching transaction';
  END IF;
END $$;

CREATE TEMP TABLE legacy_purchase_grant_key_map ON COMMIT DROP AS
SELECT
  p.id AS transaction_id,
  p.player_key,
  p.grant_key AS legacy_key,
  'purchase:' || encode(sha256(convert_to(p.provider_token, 'UTF8')), 'hex') AS canonical_key,
  g.id AS grant_id
FROM purchase_transactions p
JOIN grants g
  ON g.player_key = p.player_key AND g.grant_key = p.grant_key AND g.source = 'purchase'
WHERE char_length(p.grant_key) > 200;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM legacy_purchase_grant_key_map m
    JOIN grants g
      ON g.player_key = m.player_key
     AND g.grant_key = m.canonical_key
     AND g.id <> m.grant_id
  ) THEN
    RAISE EXCEPTION 'legacy purchase grant migration refused: canonical grant key collision';
  END IF;
END $$;

INSERT INTO grant_key_aliases (player_key, alias_key, grant_id, reason)
SELECT player_key, legacy_key, grant_id, 'legacy_purchase_provider_token'
FROM legacy_purchase_grant_key_map;

-- Ledger fences permit reviewed migrator rewrites only under this transaction-local setting.
SET LOCAL foundation.privileged = 'on';

UPDATE purchase_transactions p
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE p.id = m.transaction_id;

UPDATE grants g
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE g.id = m.grant_id;

UPDATE support_messages r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.player_key = m.player_key AND r.grant_key = m.legacy_key;

UPDATE achievement_progress r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.player_key = m.player_key AND r.grant_key = m.legacy_key;

UPDATE achievement_unlocks r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.player_key = m.player_key AND r.grant_key = m.legacy_key;

UPDATE daily_claims r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.player_key = m.player_key AND r.grant_key = m.legacy_key;

UPDATE leaderboard_placements r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.player_key = m.player_key AND r.grant_key = m.legacy_key;

-- Announcements are game-scoped. Provider tokens are globally unique in this database, so a
-- legacy key maps to at most one canonical key even without a player_key column.
UPDATE announcements r
SET grant_key = m.canonical_key
FROM legacy_purchase_grant_key_map m
WHERE r.grant_key = m.legacy_key;

ALTER TABLE grants
  ADD CONSTRAINT grants_grant_key_length CHECK (char_length(grant_key) <= 200);
ALTER TABLE purchase_transactions
  ADD CONSTRAINT purchase_transactions_grant_key_length
  CHECK (grant_key IS NULL OR char_length(grant_key) <= 200);

-- Aliases are migration-owned compatibility facts. The application resolves but never mutates
-- them; current minting remains idempotent on the canonical (player_key, grant_key) key.
GRANT SELECT ON grant_key_aliases TO foundation_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON grant_key_aliases FROM foundation_app;
