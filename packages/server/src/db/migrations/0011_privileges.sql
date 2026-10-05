-- 0011_privileges: DB roles (§4.2). migrator owns DDL and SECURITY DEFINER functions; app has
-- narrowly enumerated authority. Ledger tables: INSERT/SELECT only for app; UPDATE/DELETE only via
-- scoped SECURITY DEFINER functions; raise-triggers are a second fence.

-- adjustments are acked by an append-only row, not an UPDATE on the ledger
CREATE TABLE purchase_adjustment_acks (
  adjustment_id  BIGINT      PRIMARY KEY REFERENCES purchase_adjustments (id),
  player_key     TEXT        NOT NULL,
  command_id     UUID        NOT NULL,
  acked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- leaderboard reviews are append-only facts; the entries projection resolves visibility
CREATE TABLE leaderboard_reviews (
  submission_id  BIGINT      PRIMARY KEY REFERENCES leaderboard_submissions (id),
  action         TEXT        NOT NULL CHECK (action IN ('approve', 'reject')),
  actor          TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  command_id     UUID        NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO foundation_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO foundation_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO foundation_app;

-- ── ledgers: INSERT + SELECT only ────────────────────────────────────────────
GRANT SELECT, INSERT ON
  save_snapshots, save_blobs, save_reviews, generations, erasures,
  purchase_transactions, purchase_adjustments, purchase_adjustment_acks,
  grants, grant_claims, code_redemptions, code_bad_guesses,
  leaderboard_runs, leaderboard_submissions, leaderboard_reviews,
  support_messages, feedback, integrity_events, journal_entries,
  admin_actions, player_strikes, achievement_unlocks, daily_claims,
  outbox, config_flag_history, content_versions
TO foundation_app;
REVOKE UPDATE, DELETE, TRUNCATE ON
  save_snapshots, save_blobs, save_reviews, generations, erasures,
  purchase_transactions, purchase_adjustments, purchase_adjustment_acks,
  grants, grant_claims, code_redemptions, code_bad_guesses,
  leaderboard_runs, leaderboard_submissions, leaderboard_reviews,
  support_messages, integrity_events, journal_entries,
  admin_actions, player_strikes, achievement_unlocks, daily_claims,
  outbox, config_flag_history, content_versions
FROM foundation_app;
-- feedback status is triage state, not money: column-level UPDATE
GRANT UPDATE (status) ON feedback TO foundation_app;

-- ── commands: finalise the reserved row only (column-level) ──────────────────
GRANT SELECT, INSERT ON commands, command_tombstones TO foundation_app;
GRANT UPDATE (status, result, error_code, duration_ms, trace_id, outcome_ref) ON commands TO foundation_app;

-- ── projections + operational tables: full DML except DELETE where noted ─────
GRANT SELECT, INSERT, UPDATE ON
  players, player_flags, outbox_deliveries, outbox_dead_letters, job_runs, ops_markers,
  config_flags, content_current, schedules, segments, kill_switches, liveops_settings,
  leaderboard_seasons, leaderboard_entries, leaderboard_placements, display_names,
  achievement_progress, announcements, announcement_reads, support_message_reads,
  integrity_budgets, journal_cursors, codes, code_campaigns, rate_limits
TO foundation_app;
GRANT DELETE ON rate_limits TO foundation_app;
-- rebuildable projections may be truncated by the rebuild command
GRANT DELETE ON leaderboard_entries, achievement_progress, journal_cursors, integrity_budgets TO foundation_app;
-- outbox_deliveries rows for delivered messages are pruned by apply_retention(); no app DELETE

-- ── SECURITY DEFINER functions (owned by the migrating role) ─────────────────
-- Each function carries `SET foundation.privileged = 'on'` (function-scoped, restored on exit) so
-- the raise-triggers allow the write only while the definer body runs.

CREATE FUNCTION fence_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('foundation.privileged', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ledger_fence: % on % is not allowed for the application role', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'save_snapshots', 'save_blobs', 'save_reviews', 'generations', 'erasures',
    'purchase_transactions', 'purchase_adjustments', 'purchase_adjustment_acks',
    'grants', 'grant_claims', 'code_redemptions',
    'leaderboard_runs', 'leaderboard_submissions', 'leaderboard_reviews',
    'support_messages', 'integrity_events', 'admin_actions', 'player_strikes',
    'achievement_unlocks', 'daily_claims', 'outbox', 'content_versions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fence_ledger()', t || '_fence', t);
  END LOOP;
END $$;

-- prune_save_blobs(): drop blob payloads that fall outside the retention plan for one player.
-- Keeps: newest K, one per day for D days, deepest anchored per generation for the last G
-- generations, purchase-bearing (never pruned), the current anchor and any pending quarantined row.
CREATE FUNCTION prune_save_blobs(p_player_key TEXT, keep_recent INT, keep_daily_days INT, keep_generations INT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE deleted INT;
BEGIN
  WITH active AS (
    SELECT max(generation) AS g FROM generations WHERE player_key = p_player_key
  ), keep AS (
    -- newest K rows
    (SELECT id FROM save_snapshots WHERE player_key = p_player_key ORDER BY seq DESC LIMIT keep_recent)
    UNION
    -- one per day for D days (the deepest of that day)
    (SELECT DISTINCT ON (date_trunc('day', received_at)) id FROM save_snapshots
      WHERE player_key = p_player_key AND received_at > now() - (keep_daily_days || ' days')::interval
      ORDER BY date_trunc('day', received_at), progress DESC, seq DESC)
    UNION
    -- deepest anchored per generation for the last G generations
    (SELECT DISTINCT ON (s.generation) s.id FROM save_snapshots s
      WHERE s.player_key = p_player_key AND s.disposition = 'anchored'
        AND s.generation > (SELECT g FROM active) - keep_generations
      ORDER BY s.generation, s.progress DESC, s.seq DESC)
    UNION
    -- purchase-bearing (a purchase recorded within 60s before the snapshot)
    (SELECT s.id FROM save_snapshots s
      WHERE s.player_key = p_player_key AND EXISTS (
        SELECT 1 FROM purchase_transactions t WHERE t.player_key = s.player_key
          AND t.recorded_at BETWEEN s.received_at - interval '60 seconds' AND s.received_at))
    UNION
    -- pending quarantined rows (never prune what is awaiting review)
    (SELECT s.id FROM save_snapshots s
      WHERE s.player_key = p_player_key AND s.disposition = 'stored_quarantined'
        AND NOT EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id))
    UNION
    -- the current anchor (deepest anchored-or-promoted in the active generation)
    (SELECT s.id FROM save_snapshots s
      WHERE s.player_key = p_player_key AND s.generation = (SELECT g FROM active)
        AND (s.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id AND r.action = 'promote'))
      ORDER BY s.progress DESC, s.seq DESC LIMIT 1)
  )
  DELETE FROM save_blobs b USING save_snapshots s
    WHERE b.save_id = s.id AND s.player_key = p_player_key AND s.id NOT IN (SELECT id FROM keep);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

-- apply_retention(): commands full rows → tombstones per retention class; journal 90 d;
-- integrity 30 d; delivered outbox rows older than 7 d; refused blobs beyond N/hour.
CREATE FUNCTION apply_retention() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE c_cmd INT; c_journal INT; c_integrity INT; c_outbox INT; c_jobs INT;
BEGIN
  WITH expired AS (
    DELETE FROM commands
      WHERE (retention = '7d'  AND received_at < now() - interval '7 days')
         OR (retention = '90d' AND received_at < now() - interval '90 days')
         OR (retention = '1y'  AND received_at < now() - interval '1 year')
      RETURNING scope_key, command_id, type, request_hash, outcome_ref
  )
  INSERT INTO command_tombstones (scope_key, command_id, type, request_hash, outcome_ref)
    SELECT scope_key, command_id, type, request_hash, outcome_ref
    FROM expired WHERE outcome_ref IS NOT NULL
    ON CONFLICT (scope_key, command_id) DO NOTHING;
  GET DIAGNOSTICS c_cmd = ROW_COUNT;
  -- tombstones outlive the fact they point at: drop save tombstones whose snapshot is gone
  DELETE FROM command_tombstones t
    WHERE t.type = 'saves.write' AND NOT EXISTS (
      SELECT 1 FROM save_snapshots s WHERE s.player_key = t.scope_key AND s.command_id = t.command_id);
  DELETE FROM journal_entries WHERE received_at < now() - interval '90 days';
  GET DIAGNOSTICS c_journal = ROW_COUNT;
  DELETE FROM integrity_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS c_integrity = ROW_COUNT;
  DELETE FROM outbox_deliveries d USING outbox o
    WHERE d.outbox_id = o.id AND d.state = 'delivered' AND d.delivered_at < now() - interval '7 days';
  GET DIAGNOSTICS c_outbox = ROW_COUNT;
  DELETE FROM outbox o WHERE o.created_at < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.outbox_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM outbox_dead_letters l WHERE l.outbox_id = o.id AND l.replayed_at IS NULL);
  DELETE FROM job_runs WHERE started_at < now() - interval '30 days';
  GET DIAGNOSTICS c_jobs = ROW_COUNT;
  DELETE FROM integrity_budgets WHERE day < (now() AT TIME ZONE 'UTC')::date - 2;
  DELETE FROM code_bad_guesses WHERE at < now() - interval '1 day';
  RETURN jsonb_build_object('commands', c_cmd, 'journal', c_journal, 'integrity', c_integrity, 'outbox_deliveries', c_outbox, 'job_runs', c_jobs);
END $$;

-- erase_player(): drop blobs, summaries and journal for a player; the ledger rows stay (with the
-- payload removed) so seq/history/audit remain intact; the erasure ledger row is written by the
-- caller in the same transaction. Returns the number of rows touched.
CREATE FUNCTION erase_player(p_player_key TEXT) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE n INT := 0; k INT;
BEGIN
  DELETE FROM save_blobs b USING save_snapshots s WHERE b.save_id = s.id AND s.player_key = p_player_key;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE save_snapshots SET summary = NULL WHERE player_key = p_player_key AND summary IS NOT NULL;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM journal_entries WHERE player_key = p_player_key;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  DELETE FROM integrity_events WHERE player_key = p_player_key;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  UPDATE players SET entry_payload = NULL, erased_at = now() WHERE player_key = p_player_key;
  DELETE FROM display_names WHERE player_key = p_player_key;
  UPDATE leaderboard_submissions SET summary = NULL, proof = NULL WHERE player_key = p_player_key;
  DELETE FROM feedback WHERE player_key = p_player_key;
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
  RETURN n;
END $$;

-- promote_snapshot(): append a terminal review after re-validation under the player lock:
-- the row exists with a blob, is in the active generation, is quarantined, and is ≥ the current
-- anchor's progress. Returns 'promoted' | 'rejected' | 'review_final' | 'not_found' | 'not_eligible'.
CREATE FUNCTION promote_snapshot(p_player_key TEXT, p_seq BIGINT, p_action TEXT, p_actor TEXT, p_rule_version TEXT, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE s RECORD; g INT; anchor_seq BIGINT; anchor_progress BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(1, hashtext(p_player_key));
  SELECT * INTO s FROM save_snapshots WHERE player_key = p_player_key AND seq = p_seq;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = s.id) THEN RETURN 'review_final'; END IF;
  IF s.disposition <> 'stored_quarantined' THEN RETURN 'not_eligible'; END IF;
  SELECT max(generation) INTO g FROM generations WHERE player_key = p_player_key;
  IF s.generation <> g THEN RETURN 'not_eligible'; END IF;
  SELECT a.seq, a.progress INTO anchor_seq, anchor_progress FROM save_snapshots a
    WHERE a.player_key = p_player_key AND a.generation = g
      AND (a.disposition = 'anchored' OR EXISTS (SELECT 1 FROM save_reviews r WHERE r.save_id = a.id AND r.action = 'promote'))
    ORDER BY a.progress DESC, a.seq DESC LIMIT 1;
  IF p_action = 'promote' THEN
    IF NOT EXISTS (SELECT 1 FROM save_blobs b WHERE b.save_id = s.id) THEN RETURN 'not_eligible'; END IF;
    IF anchor_progress IS NOT NULL AND s.progress < anchor_progress THEN RETURN 'not_eligible'; END IF;
  END IF;
  INSERT INTO save_reviews (player_key, save_id, action, actor, rule_version, reason, previous_anchor_seq)
    VALUES (p_player_key, s.id, p_action, p_actor, p_rule_version, p_reason, anchor_seq);
  RETURN CASE WHEN p_action = 'promote' THEN 'promoted' ELSE 'rejected' END;
END $$;

-- retention for refused blobs: keep the first N refused blobs per hour per player
CREATE FUNCTION prune_refused_blobs(keep_per_hour INT) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE deleted INT;
BEGIN
  WITH ranked AS (
    SELECT s.id, row_number() OVER (PARTITION BY s.player_key, date_trunc('hour', s.received_at) ORDER BY s.seq) AS rn
    FROM save_snapshots s WHERE s.disposition = 'stored_refused'
  )
  DELETE FROM save_blobs b USING ranked r WHERE b.save_id = r.id AND r.rn > keep_per_hour;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

-- partition management for the journal
CREATE OR REPLACE FUNCTION ensure_journal_partition(month_start DATE) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET foundation.privileged = 'on' AS $$
DECLARE part TEXT := 'journal_entries_' || to_char(month_start, 'YYYYMM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF journal_entries FOR VALUES FROM (%L) TO (%L)', part, month_start, (month_start + INTERVAL '1 month')::date);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO foundation_app', part);
  END IF;
  RETURN part;
END $$;

REVOKE ALL ON FUNCTION prune_save_blobs(TEXT, INT, INT, INT), apply_retention(), erase_player(TEXT), promote_snapshot(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT), prune_refused_blobs(INT), ensure_journal_partition(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_save_blobs(TEXT, INT, INT, INT), apply_retention(), erase_player(TEXT), promote_snapshot(TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT), prune_refused_blobs(INT), ensure_journal_partition(DATE) TO foundation_app;
GRANT SELECT, INSERT ON journal_entries_default TO foundation_app;
