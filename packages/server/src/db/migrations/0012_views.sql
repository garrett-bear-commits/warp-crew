-- 0012_views: inspector timeline = UNION over ledgers; anchor view.
CREATE VIEW player_timeline AS
  SELECT player_key, received_at AS at, 'save' AS kind, seq::text AS ref,
         disposition || COALESCE(' ' || reject_reason, '') || ' progress=' || progress AS summary,
         jsonb_build_object('generation', generation, 'flags', flags, 'reason', reason, 'bytes', bytes, 'commandId', command_id) AS detail
    FROM save_snapshots
  UNION ALL
  SELECT player_key, opened_at, 'generation', generation::text, kind || COALESCE(' seed=' || seed_seq, ''),
         jsonb_build_object('entitlement', entitlement, 'actor', actor, 'reason', reason)
    FROM generations
  UNION ALL
  SELECT r.player_key, r.at, 'save_review', s.seq::text, r.action || ' by ' || r.actor,
         jsonb_build_object('reason', r.reason, 'ruleVersion', r.rule_version, 'previousAnchorSeq', r.previous_anchor_seq)
    FROM save_reviews r JOIN save_snapshots s ON s.id = r.save_id
  UNION ALL
  SELECT player_key, recorded_at, 'purchase', id::text, classification || ' ' || sku || ' granted=' || granted,
         jsonb_build_object('price', price, 'currency', currency, 'source', source, 'grantKey', grant_key)
    FROM purchase_transactions
  UNION ALL
  SELECT player_key, recorded_at, 'adjustment', id::text, kind || ' ' || delta,
         jsonb_build_object('reason', reason, 'adminActionId', admin_action_id, 'transactionId', transaction_id)
    FROM purchase_adjustments
  UNION ALL
  SELECT player_key, created_at, 'grant', grant_key, source || ' ' || reason,
         jsonb_build_object('rewards', rewards, 'ticketRef', ticket_ref, 'actor', actor)
    FROM grants
  UNION ALL
  SELECT c.player_key, c.claimed_at, 'grant_claim', g.grant_key, 'claimed', jsonb_build_object('commandId', c.command_id)
    FROM grant_claims c JOIN grants g ON g.id = c.grant_id
  UNION ALL
  SELECT player_key, submitted_at, 'leaderboard', run_id::text, board_key || '/' || season_key || ' score=' || score || ' ' || visibility,
         jsonb_build_object('elapsedMs', elapsed_ms, 'level', verification_level)
    FROM leaderboard_submissions
  UNION ALL
  SELECT player_key, at, 'integrity', kind, COALESCE(message, kind), jsonb_build_object('detail', detail, 'build', build_version)
    FROM integrity_events
  UNION ALL
  SELECT scope_key, received_at, 'command', command_id::text, type || ' ' || status || COALESCE(' ' || error_code, ''),
         jsonb_build_object('durationMs', duration_ms, 'actor', actor, 'traceId', trace_id)
    FROM commands
  UNION ALL
  SELECT player_key, created_at, 'letter', id::text, title, jsonb_build_object('grantKey', grant_key, 'ticketRef', ticket_ref, 'actor', actor)
    FROM support_messages
  UNION ALL
  SELECT player_key, at, 'erasure', id::text, reason, jsonb_build_object('generation', generation, 'actor', actor, 'erasedRows', erased_rows)
    FROM erasures
  UNION ALL
  SELECT player_key, at, 'strike', id::text, reason, jsonb_build_object('ref', ref)
    FROM player_strikes;

GRANT SELECT ON player_timeline TO foundation_app;
