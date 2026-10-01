col achievement_progress.player_key text NO 
col achievement_progress.achievement_id text NO 
col achievement_progress.content_version integer NO 
col achievement_progress.unlocked boolean NO false
col achievement_progress.unlocked_at timestamp with time zone YES 
col achievement_progress.grant_key text YES 
col achievement_progress.progress jsonb NO 
col achievement_progress.updated_at timestamp with time zone NO now()
col achievement_unlocks.player_key text NO 
col achievement_unlocks.achievement_id text NO 
col achievement_unlocks.content_version integer NO 
col achievement_unlocks.grant_key text NO 
col achievement_unlocks.command_id uuid NO 
col achievement_unlocks.at timestamp with time zone NO now()
col admin_actions.id bigint NO nextval('admin_actions_id_seq'::regclass)
col admin_actions.admin_key_id text NO 
col admin_actions.scope text NO 
col admin_actions.command_type text NO 
col admin_actions.command_id uuid NO 
col admin_actions.target text YES 
col admin_actions.reason text YES 
col admin_actions.outcome text NO 
col admin_actions.request_id text YES 
col admin_actions.at timestamp with time zone NO now()
col announcement_reads.player_key text NO 
col announcement_reads.announcement_id text NO 
col announcement_reads.read_at timestamp with time zone NO now()
col announcements.announcement_id text NO 
col announcements.title text NO 
col announcements.body text NO 
col announcements.starts_at timestamp with time zone NO 
col announcements.ends_at timestamp with time zone YES 
col announcements.segment_id text YES 
col announcements.grant_key text YES 
col announcements.version integer NO 1
col announcements.actor text NO 
col announcements.reason text NO 
col announcements.updated_at timestamp with time zone NO now()
col code_bad_guesses.id bigint NO nextval('code_bad_guesses_id_seq'::regclass)
col code_bad_guesses.player_key text NO 
col code_bad_guesses.campaign_id text YES 
col code_bad_guesses.at timestamp with time zone NO now()
col code_campaigns.campaign_id text NO 
col code_campaigns.rewards jsonb NO 
col code_campaigns.max_redemptions_per_code integer NO 
col code_campaigns.registered_only boolean NO false
col code_campaigns.expires_at timestamp with time zone YES 
col code_campaigns.reason text NO 
col code_campaigns.actor text NO 
col code_campaigns.created_at timestamp with time zone NO now()
col code_campaigns.locked_at timestamp with time zone YES 
col code_redemptions.code_hash text NO 
col code_redemptions.player_key text NO 
col code_redemptions.grant_id bigint NO 
col code_redemptions.at timestamp with time zone NO now()
col codes.code_hash text NO 
col codes.campaign_id text NO 
col codes.redemptions integer NO 0
col command_tombstones.scope_key text NO 
col command_tombstones.command_id uuid NO 
col command_tombstones.type text NO 
col command_tombstones.request_hash text NO 
col command_tombstones.outcome_ref text YES 
col command_tombstones.created_at timestamp with time zone NO now()
col commands.id bigint NO nextval('commands_id_seq'::regclass)
col commands.scope_key text NO 
col commands.command_id uuid NO 
col commands.type text NO 
col commands.actor text NO 
col commands.request_hash text NO 
col commands.status text NO 
col commands.result jsonb YES 
col commands.error_code text YES 
col commands.trace_id text YES 
col commands.received_at timestamp with time zone NO now()
col commands.duration_ms integer YES 
col commands.retention text NO 
col commands.outcome_ref text YES 
col config_flag_history.id bigint NO nextval('config_flag_history_id_seq'::regclass)
col config_flag_history.key text NO 
col config_flag_history.version integer NO 
col config_flag_history.state jsonb NO 
col config_flag_history.actor text NO 
col config_flag_history.reason text NO 
col config_flag_history.at timestamp with time zone NO now()
col config_flags.key text NO 
col config_flags.enabled boolean NO 
col config_flags.value jsonb NO 
col config_flags.fallback jsonb NO 
col config_flags.rollout_percent integer NO 
col config_flags.shadow boolean NO false
col config_flags.activate_at_session_boundary boolean NO false
col config_flags.activate_at timestamp with time zone YES 
col config_flags.segment_id text YES 
col config_flags.version integer NO 1
col config_flags.reason text NO 
col config_flags.actor text NO 
col config_flags.updated_at timestamp with time zone NO now()
col content_current.kind text NO 
col content_current.env text NO 
col content_current.version integer NO 
col content_current.updated_at timestamp with time zone NO now()
col content_versions.kind text NO 
col content_versions.env text NO 
col content_versions.version integer NO 
col content_versions.document jsonb NO 
col content_versions.sha256 text NO 
col content_versions.min_build_version text YES 
col content_versions.actor text NO 
col content_versions.reason text NO 
col content_versions.command_id uuid NO 
col content_versions.published_at timestamp with time zone NO now()
col content_versions.reverted_from integer YES 
col daily_claims.player_key text NO 
col daily_claims.day date NO 
col daily_claims.ladder_day integer NO 
col daily_claims.grant_key text NO 
col daily_claims.command_id uuid NO 
col daily_claims.at timestamp with time zone NO now()
col display_names.player_key text NO 
col display_names.display_name text NO 
col display_names.raw_name text YES 
col display_names.moderated boolean NO false
col display_names.updated_at timestamp with time zone NO now()
col erasures.id bigint NO nextval('erasures_id_seq'::regclass)
col erasures.player_key text NO 
col erasures.generation integer NO 
col erasures.reason text NO 
col erasures.actor text NO 
col erasures.ticket_ref text YES 
col erasures.erased_rows integer NO 
col erasures.at timestamp with time zone NO now()
col feedback.id bigint NO nextval('feedback_id_seq'::regclass)
col feedback.player_key text NO 
col feedback.category text NO 
col feedback.body text NO 
col feedback.build_version text YES 
col feedback.status text NO 'new'::text
col feedback.command_id uuid NO 
col feedback.created_at timestamp with time zone NO now()
col generations.player_key text NO 
col generations.generation integer NO 
col generations.kind text NO 
col generations.restart_id uuid YES 
col generations.seed_seq bigint YES 
col generations.entitlement integer NO 0
col generations.reason text YES 
col generations.actor text NO 
col generations.opened_at timestamp with time zone NO now()
col grant_claims.grant_id bigint NO 
col grant_claims.player_key text NO 
col grant_claims.command_id uuid NO 
col grant_claims.claimed_at timestamp with time zone NO now()
col grant_key_aliases.player_key text NO
col grant_key_aliases.alias_key text NO
col grant_key_aliases.grant_id bigint NO
col grant_key_aliases.reason text NO
col grant_key_aliases.created_at timestamp with time zone NO now()
col grants.id bigint NO nextval('grants_id_seq'::regclass)
col grants.player_key text NO 
col grants.grant_key text NO 
col grants.source text NO 
col grants.rewards jsonb NO 
col grants.premium_amount integer NO 0
col grants.reason text NO 
col grants.ticket_ref text YES 
col grants.title text YES 
col grants.body text YES 
col grants.actor text NO 
col grants.command_id uuid YES 
col grants.claim_sourced boolean NO false
col grants.created_at timestamp with time zone NO now()
col grants.expires_at timestamp with time zone YES 
col integrity_budgets.player_key text NO 
col integrity_budgets.day date NO 
col integrity_budgets.used integer NO 0
col integrity_events.id bigint NO nextval('integrity_events_id_seq'::regclass)
col integrity_events.player_key text NO 
col integrity_events.kind text NO 
col integrity_events.at timestamp with time zone NO 
col integrity_events.received_at timestamp with time zone NO now()
col integrity_events.detail jsonb YES 
col integrity_events.message text YES 
col integrity_events.breadcrumbs jsonb YES 
col integrity_events.build_version text YES 
col integrity_events.request_id text YES 
col integrity_events.command_id uuid YES 
col job_runs.id bigint NO nextval('job_runs_id_seq'::regclass)
col job_runs.name text NO 
col job_runs.started_at timestamp with time zone NO now()
col job_runs.finished_at timestamp with time zone YES 
col job_runs.ok boolean YES 
col job_runs.error text YES 
col job_runs.duration_ms integer YES 
col job_runs.detail jsonb YES 
col journal_cursors.player_key text NO 
col journal_cursors.generation integer NO 
col journal_cursors.next_seq bigint NO 
col journal_cursors.day date NO 
col journal_cursors.used_today integer NO 0
col journal_entries.id bigint NO nextval('journal_entries_id_seq'::regclass)
col journal_entries.player_key text NO 
col journal_entries.generation integer NO 
col journal_entries.seq bigint NO 
col journal_entries.tick bigint NO 
col journal_entries.at timestamp with time zone NO 
col journal_entries.kind text NO 
col journal_entries.name text NO 
col journal_entries.args jsonb YES 
col journal_entries.build_version text NO 
col journal_entries.received_at timestamp with time zone NO now()
col journal_entries_default.id bigint NO nextval('journal_entries_id_seq'::regclass)
col journal_entries_default.player_key text NO 
col journal_entries_default.generation integer NO 
col journal_entries_default.seq bigint NO 
col journal_entries_default.tick bigint NO 
col journal_entries_default.at timestamp with time zone NO 
col journal_entries_default.kind text NO 
col journal_entries_default.name text NO 
col journal_entries_default.args jsonb YES 
col journal_entries_default.build_version text NO 
col journal_entries_default.received_at timestamp with time zone NO now()
col kill_switches.target text NO 
col kill_switches.id text NO 
col kill_switches.enabled boolean NO 
col kill_switches.reason text NO 
col kill_switches.actor text NO 
col kill_switches.updated_at timestamp with time zone NO now()
col leaderboard_entries.board_key text NO 
col leaderboard_entries.season_key text NO 
col leaderboard_entries.player_key text NO 
col leaderboard_entries.best_submission_id bigint NO 
col leaderboard_entries.score bigint NO 
col leaderboard_entries.elapsed_ms bigint NO 
col leaderboard_entries.updated_at timestamp with time zone NO now()
col leaderboard_placements.receipt_id text NO 
col leaderboard_placements.board_key text NO 
col leaderboard_placements.season_key text NO 
col leaderboard_placements.player_key text NO 
col leaderboard_placements.rank integer NO 
col leaderboard_placements.score bigint NO 
col leaderboard_placements.state text NO 
col leaderboard_placements.grant_key text YES 
col leaderboard_placements.minted_at timestamp with time zone NO now()
col leaderboard_placements.confirmed_at timestamp with time zone YES 
col leaderboard_reviews.submission_id bigint NO 
col leaderboard_reviews.action text NO 
col leaderboard_reviews.actor text NO 
col leaderboard_reviews.reason text NO 
col leaderboard_reviews.command_id uuid NO 
col leaderboard_reviews.at timestamp with time zone NO now()
col leaderboard_runs.run_id uuid NO 
col leaderboard_runs.board_key text NO 
col leaderboard_runs.season_key text NO 
col leaderboard_runs.player_key text NO 
col leaderboard_runs.seed text NO 
col leaderboard_runs.rules_version text NO 
col leaderboard_runs.started_at timestamp with time zone NO now()
col leaderboard_runs.command_id uuid NO 
col leaderboard_seasons.board_key text NO 
col leaderboard_seasons.season_key text NO 
col leaderboard_seasons.rules_version text NO 
col leaderboard_seasons.status text NO 
col leaderboard_seasons.starts_at timestamp with time zone YES 
col leaderboard_seasons.ends_at timestamp with time zone YES 
col leaderboard_seasons.score_min bigint NO 0
col leaderboard_seasons.score_max bigint NO 
col leaderboard_seasons.max_elapsed_ms bigint NO 
col leaderboard_seasons.quarantine_top_n integer NO 10
col leaderboard_seasons.rewards jsonb YES 
col leaderboard_seasons.closed_at timestamp with time zone YES 
col leaderboard_seasons.version integer NO 1
col leaderboard_submissions.id bigint NO nextval('leaderboard_submissions_id_seq'::regclass)
col leaderboard_submissions.run_id uuid NO 
col leaderboard_submissions.board_key text NO 
col leaderboard_submissions.season_key text NO 
col leaderboard_submissions.player_key text NO 
col leaderboard_submissions.score bigint NO 
col leaderboard_submissions.elapsed_ms bigint NO 
col leaderboard_submissions.summary jsonb YES 
col leaderboard_submissions.proof jsonb YES 
col leaderboard_submissions.verification_level integer NO 
col leaderboard_submissions.visibility text NO 
col leaderboard_submissions.review_reason text YES 
col leaderboard_submissions.reviewed_by text YES 
col leaderboard_submissions.reviewed_at timestamp with time zone YES 
col leaderboard_submissions.command_id uuid NO 
col leaderboard_submissions.submitted_at timestamp with time zone NO now()
col liveops_settings.key text NO 
col liveops_settings.value jsonb NO 
col liveops_settings.version integer NO 1
col liveops_settings.actor text NO 
col liveops_settings.reason text NO 
col liveops_settings.updated_at timestamp with time zone NO now()
col ops_markers.key text NO 
col ops_markers.value jsonb NO 
col ops_markers.updated_at timestamp with time zone NO now()
col outbox.id bigint NO nextval('outbox_id_seq'::regclass)
col outbox.kind text NO 
col outbox.player_key text YES 
col outbox.payload jsonb NO 
col outbox.command_id uuid YES 
col outbox.created_at timestamp with time zone NO now()
col outbox_dead_letters.id bigint NO nextval('outbox_dead_letters_id_seq'::regclass)
col outbox_dead_letters.outbox_id bigint NO 
col outbox_dead_letters.consumer text NO 
col outbox_dead_letters.attempts integer NO 
col outbox_dead_letters.last_error text NO 
col outbox_dead_letters.dead_at timestamp with time zone NO now()
col outbox_dead_letters.replayed_at timestamp with time zone YES 
col outbox_dead_letters.replayed_by text YES 
col outbox_deliveries.outbox_id bigint NO 
col outbox_deliveries.consumer text NO 
col outbox_deliveries.state text NO 
col outbox_deliveries.attempts integer NO 0
col outbox_deliveries.lease_until timestamp with time zone YES 
col outbox_deliveries.next_attempt_at timestamp with time zone NO now()
col outbox_deliveries.last_error text YES 
col outbox_deliveries.delivered_at timestamp with time zone YES 
col outbox_deliveries.lease_token uuid YES 
col player_flags.player_key text NO 
col player_flags.flag text NO 
col player_flags.enabled boolean NO 
col player_flags.until timestamp with time zone YES 
col player_flags.reason text NO 
col player_flags.admin_key_id text NO 
col player_flags.updated_at timestamp with time zone NO now()
col player_strikes.player_key text NO 
col player_strikes.id bigint NO nextval('player_strikes_id_seq'::regclass)
col player_strikes.reason text NO 
col player_strikes.ref text YES 
col player_strikes.at timestamp with time zone NO now()
col player_timeline.player_key text YES 
col player_timeline.at timestamp with time zone YES 
col player_timeline.kind text YES 
col player_timeline.ref text YES 
col player_timeline.summary text YES 
col player_timeline.detail jsonb YES 
col players.player_key text NO 
col players.first_seen_at timestamp with time zone NO now()
col players.last_seen_at timestamp with time zone NO now()
col players.registered boolean NO false
col players.last_build text YES 
col players.entry_payload jsonb YES 
col players.seen_days integer NO 1
col players.last_seen_day date NO ((now() AT TIME ZONE 'UTC'::text))::date
col players.erased_at timestamp with time zone YES 
col players.first_build text YES 
col purchase_adjustment_acks.adjustment_id bigint NO 
col purchase_adjustment_acks.player_key text NO 
col purchase_adjustment_acks.command_id uuid NO 
col purchase_adjustment_acks.acked_at timestamp with time zone NO now()
col purchase_adjustments.id bigint NO nextval('purchase_adjustments_id_seq'::regclass)
col purchase_adjustments.player_key text NO 
col purchase_adjustments.kind text NO 
col purchase_adjustments.delta integer NO 
col purchase_adjustments.reason text NO 
col purchase_adjustments.admin_action_id bigint YES 
col purchase_adjustments.transaction_id bigint YES 
col purchase_adjustments.command_id uuid NO 
col purchase_adjustments.recorded_at timestamp with time zone NO now()
col purchase_adjustments.acked_at timestamp with time zone YES 
col purchase_transactions.id bigint NO nextval('purchase_transactions_id_seq'::regclass)
col purchase_transactions.provider_token text NO 
col purchase_transactions.player_key text NO 
col purchase_transactions.sku text NO 
col purchase_transactions.pack_key text YES 
col purchase_transactions.base_amount integer NO 
col purchase_transactions.granted integer NO 
col purchase_transactions.price numeric YES 
col purchase_transactions.currency text YES 
col purchase_transactions.classification text NO 
col purchase_transactions.created_at timestamp with time zone NO 
col purchase_transactions.completed_at timestamp with time zone YES 
col purchase_transactions.source text NO 
col purchase_transactions.command_id uuid YES 
col purchase_transactions.grant_key text YES 
col purchase_transactions.recorded_at timestamp with time zone NO now()
col purchase_transactions.sandbox boolean YES NULLIF(true, true)
col rate_limits.key text NO 
col rate_limits.window_start timestamp with time zone NO 
col rate_limits.count integer NO 0
col save_blobs.save_id bigint NO 
col save_blobs.blob bytea NO 
col save_reviews.id bigint NO nextval('save_reviews_id_seq'::regclass)
col save_reviews.player_key text NO 
col save_reviews.save_id bigint NO 
col save_reviews.action text NO 
col save_reviews.actor text NO 
col save_reviews.rule_version text NO 
col save_reviews.reason text NO 
col save_reviews.previous_anchor_seq bigint YES 
col save_reviews.at timestamp with time zone NO now()
col save_snapshots.id bigint NO nextval('save_snapshots_id_seq'::regclass)
col save_snapshots.player_key text NO 
col save_snapshots.slot text NO 'main'::text
col save_snapshots.generation integer NO 
col save_snapshots.seq bigint NO 
col save_snapshots.client_seq bigint NO 
col save_snapshots.base_seq bigint NO 
col save_snapshots.session_id uuid NO 
col save_snapshots.command_id uuid NO 
col save_snapshots.progress bigint NO 
col save_snapshots.client_progress bigint YES 
col save_snapshots.saved_at timestamp with time zone NO 
col save_snapshots.received_at timestamp with time zone NO now()
col save_snapshots.bytes integer NO 
col save_snapshots.enc_bytes integer NO 
col save_snapshots.blob_sha256 text NO 
col save_snapshots.schema_version integer NO 
col save_snapshots.build_version text NO 
col save_snapshots.source text NO 'client'::text
col save_snapshots.disposition text NO 
col save_snapshots.reject_reason text YES 
col save_snapshots.flags ARRAY NO '{}'::text[]
col save_snapshots.rank_hint ARRAY YES 
col save_snapshots.summary jsonb YES 
col save_snapshots.enc text NO 
col save_snapshots.reason text NO 
col schedules.schedule_id text NO 
col schedules.kind text NO 
col schedules.starts_at timestamp with time zone NO 
col schedules.ends_at timestamp with time zone YES 
col schedules.payload jsonb YES 
col schedules.segment_id text YES 
col schedules.active boolean NO true
col schedules.version integer NO 1
col schedules.actor text NO 
col schedules.reason text NO 
col schedules.updated_at timestamp with time zone NO now()
col segments.segment_id text NO 
col segments.predicate jsonb NO 
col segments.version integer NO 1
col segments.actor text NO 
col segments.reason text NO 
col segments.updated_at timestamp with time zone NO now()
col support_message_reads.player_key text NO 
col support_message_reads.message_id bigint NO 
col support_message_reads.read_at timestamp with time zone NO now()
col support_messages.id bigint NO nextval('support_messages_id_seq'::regclass)
col support_messages.player_key text NO 
col support_messages.title text NO 
col support_messages.body text NO 
col support_messages.grant_key text YES 
col support_messages.reason text NO 
col support_messages.ticket_ref text YES 
col support_messages.actor text NO 
col support_messages.command_id uuid NO 
col support_messages.created_at timestamp with time zone NO now()
col support_messages.expires_at timestamp with time zone YES 
con achievement_progress.achievement_progress_pkey PRIMARY KEY (player_key, achievement_id)
con achievement_unlocks.achievement_unlocks_pkey PRIMARY KEY (player_key, achievement_id)
con admin_actions.admin_actions_command_id_command_type_key UNIQUE (command_id, command_type)
con admin_actions.admin_actions_pkey PRIMARY KEY (id)
con announcement_reads.announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(announcement_id)
con announcement_reads.announcement_reads_pkey PRIMARY KEY (player_key, announcement_id)
con announcements.announcements_pkey PRIMARY KEY (announcement_id)
con code_bad_guesses.code_bad_guesses_pkey PRIMARY KEY (id)
con code_campaigns.code_campaigns_max_redemptions_per_code_check CHECK ((max_redemptions_per_code >= 1))
con code_campaigns.code_campaigns_pkey PRIMARY KEY (campaign_id)
con code_redemptions.code_redemptions_code_hash_fkey FOREIGN KEY (code_hash) REFERENCES codes(code_hash)
con code_redemptions.code_redemptions_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id)
con code_redemptions.code_redemptions_pkey PRIMARY KEY (code_hash, player_key)
con codes.codes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES code_campaigns(campaign_id)
con codes.codes_pkey PRIMARY KEY (code_hash)
con command_tombstones.command_tombstones_pkey PRIMARY KEY (scope_key, command_id)
con commands.commands_pkey PRIMARY KEY (id)
con commands.commands_retention_check CHECK ((retention = ANY (ARRAY['7d'::text, '90d'::text, '1y'::text])))
con commands.commands_scope_key_command_id_key UNIQUE (scope_key, command_id)
con commands.commands_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'done'::text, 'failed'::text])))
con config_flag_history.config_flag_history_pkey PRIMARY KEY (id)
con config_flags.config_flags_pkey PRIMARY KEY (key)
con config_flags.config_flags_rollout_percent_check CHECK (((rollout_percent >= 0) AND (rollout_percent <= 100)))
con content_current.content_current_kind_env_version_fkey FOREIGN KEY (kind, env, version) REFERENCES content_versions(kind, env, version)
con content_current.content_current_pkey PRIMARY KEY (kind, env)
con content_versions.content_versions_env_check CHECK ((env = ANY (ARRAY['lab'::text, 'prod'::text])))
con content_versions.content_versions_kind_check CHECK ((kind = ANY (ARRAY['achievements'::text, 'quests'::text, 'daily_rewards'::text, 'offers'::text, 'announcements'::text, 'notification_copy'::text])))
con content_versions.content_versions_pkey PRIMARY KEY (kind, env, version)
con daily_claims.daily_claims_pkey PRIMARY KEY (player_key, day)
con display_names.display_names_pkey PRIMARY KEY (player_key)
con erasures.erasures_pkey PRIMARY KEY (id)
con feedback.feedback_command_id_key UNIQUE (command_id)
con feedback.feedback_pkey PRIMARY KEY (id)
con feedback.feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'resolved'::text])))
con generations.generations_entitlement_check CHECK ((entitlement >= 0))
con generations.generations_generation_check CHECK ((generation >= 0))
con generations.generations_kind_check CHECK ((kind = ANY (ARRAY['initial'::text, 'restart'::text, 'admin_restore'::text, 'player_restore'::text, 'reattach'::text, 'erased'::text])))
con generations.generations_pkey PRIMARY KEY (player_key, generation)
con grant_claims.grant_claims_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id)
con grant_claims.grant_claims_pkey PRIMARY KEY (grant_id)
con grant_key_aliases.grant_key_aliases_alias_key_check CHECK (((char_length(alias_key) > 200) AND (alias_key ~~ 'purchase:%'::text)))
con grant_key_aliases.grant_key_aliases_grant_id_alias_key_key UNIQUE (grant_id, alias_key)
con grant_key_aliases.grant_key_aliases_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES grants(id)
con grant_key_aliases.grant_key_aliases_pkey PRIMARY KEY (player_key, alias_key)
con grant_key_aliases.grant_key_aliases_reason_check CHECK ((reason = 'legacy_purchase_provider_token'::text))
con grants.grants_grant_key_length CHECK ((char_length(grant_key) <= 200))
con grants.grants_pkey PRIMARY KEY (id)
con grants.grants_player_key_grant_key_key UNIQUE (player_key, grant_key)
con grants.grants_premium_amount_check CHECK ((premium_amount >= 0))
con grants.grants_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'cohort'::text, 'purchase'::text, 'achievement'::text, 'code'::text, 'placement'::text, 'daily_reward'::text, 'system'::text])))
con integrity_budgets.integrity_budgets_pkey PRIMARY KEY (player_key, day)
con integrity_events.integrity_events_pkey PRIMARY KEY (id)
con job_runs.job_runs_pkey PRIMARY KEY (id)
con journal_cursors.journal_cursors_pkey PRIMARY KEY (player_key, generation)
con journal_entries.journal_entries_pkey PRIMARY KEY (received_at, id)
con journal_entries_default.journal_entries_default_pkey PRIMARY KEY (received_at, id)
con kill_switches.kill_switches_pkey PRIMARY KEY (target, id)
con kill_switches.kill_switches_target_check CHECK ((target = ANY (ARRAY['sku'::text, 'command'::text])))
con leaderboard_entries.leaderboard_entries_best_submission_id_fkey FOREIGN KEY (best_submission_id) REFERENCES leaderboard_submissions(id)
con leaderboard_entries.leaderboard_entries_pkey PRIMARY KEY (board_key, season_key, player_key)
con leaderboard_placements.leaderboard_placements_board_key_season_key_player_key_key UNIQUE (board_key, season_key, player_key)
con leaderboard_placements.leaderboard_placements_pkey PRIMARY KEY (receipt_id)
con leaderboard_placements.leaderboard_placements_state_check CHECK ((state = ANY (ARRAY['provisional'::text, 'confirmed'::text, 'voided'::text])))
con leaderboard_reviews.leaderboard_reviews_action_check CHECK ((action = ANY (ARRAY['approve'::text, 'reject'::text])))
con leaderboard_reviews.leaderboard_reviews_pkey PRIMARY KEY (submission_id)
con leaderboard_reviews.leaderboard_reviews_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES leaderboard_submissions(id)
con leaderboard_runs.leaderboard_runs_pkey PRIMARY KEY (run_id)
con leaderboard_seasons.leaderboard_seasons_pkey PRIMARY KEY (board_key, season_key)
con leaderboard_seasons.leaderboard_seasons_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text])))
con leaderboard_submissions.leaderboard_submissions_pkey PRIMARY KEY (id)
con leaderboard_submissions.leaderboard_submissions_run_id_fkey FOREIGN KEY (run_id) REFERENCES leaderboard_runs(run_id)
con leaderboard_submissions.leaderboard_submissions_run_id_key UNIQUE (run_id)
con leaderboard_submissions.leaderboard_submissions_verification_level_check CHECK (((verification_level >= 1) AND (verification_level <= 3)))
con leaderboard_submissions.leaderboard_submissions_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'quarantined'::text, 'hidden'::text, 'rejected'::text])))
con liveops_settings.liveops_settings_pkey PRIMARY KEY (key)
con ops_markers.ops_markers_pkey PRIMARY KEY (key)
con outbox.outbox_pkey PRIMARY KEY (id)
con outbox_dead_letters.outbox_dead_letters_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES outbox(id)
con outbox_dead_letters.outbox_dead_letters_pkey PRIMARY KEY (id)
con outbox_deliveries.outbox_deliveries_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES outbox(id)
con outbox_deliveries.outbox_deliveries_pkey PRIMARY KEY (outbox_id, consumer)
con outbox_deliveries.outbox_deliveries_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'leased'::text, 'delivered'::text, 'dead'::text])))
con player_flags.player_flags_flag_check CHECK ((flag = ANY (ARRAY['purchases_disabled'::text, 'boards_hidden'::text, 'grants_frozen'::text])))
con player_flags.player_flags_pkey PRIMARY KEY (player_key, flag)
con player_strikes.player_strikes_pkey PRIMARY KEY (id)
con players.players_pkey PRIMARY KEY (player_key)
con purchase_adjustment_acks.purchase_adjustment_acks_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES purchase_adjustments(id)
con purchase_adjustment_acks.purchase_adjustment_acks_pkey PRIMARY KEY (adjustment_id)
con purchase_adjustments.purchase_adjustments_admin_action_id_fkey FOREIGN KEY (admin_action_id) REFERENCES admin_actions(id)
con purchase_adjustments.purchase_adjustments_check CHECK (((delta >= 0) OR (admin_action_id IS NOT NULL)))
con purchase_adjustments.purchase_adjustments_command_id_key UNIQUE (command_id)
con purchase_adjustments.purchase_adjustments_kind_check CHECK ((kind = ANY (ARRAY['refund'::text, 'make_good'::text, 'correction'::text])))
con purchase_adjustments.purchase_adjustments_pkey PRIMARY KEY (id)
con purchase_adjustments.purchase_adjustments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES purchase_transactions(id)
con purchase_transactions.purchase_transactions_base_amount_check CHECK ((base_amount >= 0))
con purchase_transactions.purchase_transactions_classification_check CHECK ((classification = ANY (ARRAY['paid'::text, 'sandbox'::text, 'unclassified'::text, 'unsupported'::text])))
con purchase_transactions.purchase_transactions_grant_key_length CHECK (((grant_key IS NULL) OR (char_length(grant_key) <= 200)))
con purchase_transactions.purchase_transactions_granted_check CHECK ((granted >= 0))
con purchase_transactions.purchase_transactions_granted_classification CHECK (((classification = ANY (ARRAY['paid'::text, 'sandbox'::text])) OR (granted = 0)))
con purchase_transactions.purchase_transactions_pkey PRIMARY KEY (id)
con purchase_transactions.purchase_transactions_provider_token_key UNIQUE (provider_token)
con purchase_transactions.purchase_transactions_sandbox_not_paid CHECK (((sandbox IS DISTINCT FROM true) OR (classification <> 'paid'::text)))
con purchase_transactions.purchase_transactions_source_check CHECK ((source = ANY (ARRAY['live_receipt'::text, 'financials_import'::text])))
con rate_limits.rate_limits_pkey PRIMARY KEY (key, window_start)
con save_blobs.save_blobs_pkey PRIMARY KEY (save_id)
con save_blobs.save_blobs_save_id_fkey FOREIGN KEY (save_id) REFERENCES save_snapshots(id)
con save_reviews.save_reviews_action_check CHECK ((action = ANY (ARRAY['promote'::text, 'reject'::text])))
con save_reviews.save_reviews_pkey PRIMARY KEY (id)
con save_reviews.save_reviews_save_id_fkey FOREIGN KEY (save_id) REFERENCES save_snapshots(id)
con save_reviews.save_reviews_save_id_key UNIQUE (save_id)
con save_snapshots.save_snapshots_bytes_check CHECK ((bytes >= 0))
con save_snapshots.save_snapshots_disposition_check CHECK ((disposition = ANY (ARRAY['anchored'::text, 'stored_quarantined'::text, 'stored_refused'::text])))
con save_snapshots.save_snapshots_enc_bytes_check CHECK ((enc_bytes >= 0))
con save_snapshots.save_snapshots_enc_check CHECK ((enc = ANY (ARRAY['json'::text, 'gzip+b64'::text])))
con save_snapshots.save_snapshots_pkey PRIMARY KEY (id)
con save_snapshots.save_snapshots_player_key_command_id_key UNIQUE (player_key, command_id)
con save_snapshots.save_snapshots_player_key_generation_fkey FOREIGN KEY (player_key, generation) REFERENCES generations(player_key, generation)
con save_snapshots.save_snapshots_player_key_seq_key UNIQUE (player_key, seq)
con save_snapshots.save_snapshots_progress_check CHECK (((progress >= 0) AND (progress <= '9007199254740991'::bigint)))
con save_snapshots.save_snapshots_reason_check CHECK ((reason = ANY (ARRAY['autosave'::text, 'timer'::text, 'teardown'::text, 'important'::text, 'restore'::text, 'boot-retry'::text])))
con save_snapshots.save_snapshots_source_check CHECK ((source = ANY (ARRAY['client'::text, 'beacon'::text, 'restore'::text, 'admin'::text, 'qa_import'::text, 'reattach'::text])))
con schedules.schedules_pkey PRIMARY KEY (schedule_id)
con schema_migrations.schema_migrations_pkey PRIMARY KEY (name)
con segments.segments_pkey PRIMARY KEY (segment_id)
con support_message_reads.support_message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES support_messages(id)
con support_message_reads.support_message_reads_pkey PRIMARY KEY (player_key, message_id)
con support_messages.support_messages_command_id_key UNIQUE (command_id)
con support_messages.support_messages_pkey PRIMARY KEY (id)
idx achievement_progress_pkey CREATE UNIQUE INDEX achievement_progress_pkey ON public.achievement_progress USING btree (player_key, achievement_id)
idx achievement_unlocks_pkey CREATE UNIQUE INDEX achievement_unlocks_pkey ON public.achievement_unlocks USING btree (player_key, achievement_id)
idx admin_actions_at CREATE INDEX admin_actions_at ON public.admin_actions USING btree (at DESC)
idx admin_actions_command_id_command_type_key CREATE UNIQUE INDEX admin_actions_command_id_command_type_key ON public.admin_actions USING btree (command_id, command_type)
idx admin_actions_pkey CREATE UNIQUE INDEX admin_actions_pkey ON public.admin_actions USING btree (id)
idx announcement_reads_pkey CREATE UNIQUE INDEX announcement_reads_pkey ON public.announcement_reads USING btree (player_key, announcement_id)
idx announcements_pkey CREATE UNIQUE INDEX announcements_pkey ON public.announcements USING btree (announcement_id)
idx code_bad_guesses_pkey CREATE UNIQUE INDEX code_bad_guesses_pkey ON public.code_bad_guesses USING btree (id)
idx code_bad_guesses_player_at CREATE INDEX code_bad_guesses_player_at ON public.code_bad_guesses USING btree (player_key, at)
idx code_campaigns_pkey CREATE UNIQUE INDEX code_campaigns_pkey ON public.code_campaigns USING btree (campaign_id)
idx code_redemptions_pkey CREATE UNIQUE INDEX code_redemptions_pkey ON public.code_redemptions USING btree (code_hash, player_key)
idx codes_campaign CREATE INDEX codes_campaign ON public.codes USING btree (campaign_id)
idx codes_pkey CREATE UNIQUE INDEX codes_pkey ON public.codes USING btree (code_hash)
idx command_tombstones_pkey CREATE UNIQUE INDEX command_tombstones_pkey ON public.command_tombstones USING btree (scope_key, command_id)
idx commands_pkey CREATE UNIQUE INDEX commands_pkey ON public.commands USING btree (id)
idx commands_received CREATE INDEX commands_received ON public.commands USING btree (received_at)
idx commands_scope_key_command_id_key CREATE UNIQUE INDEX commands_scope_key_command_id_key ON public.commands USING btree (scope_key, command_id)
idx commands_type_received CREATE INDEX commands_type_received ON public.commands USING btree (type, received_at)
idx config_flag_history_pkey CREATE UNIQUE INDEX config_flag_history_pkey ON public.config_flag_history USING btree (id)
idx config_flags_pkey CREATE UNIQUE INDEX config_flags_pkey ON public.config_flags USING btree (key)
idx content_current_pkey CREATE UNIQUE INDEX content_current_pkey ON public.content_current USING btree (kind, env)
idx content_versions_pkey CREATE UNIQUE INDEX content_versions_pkey ON public.content_versions USING btree (kind, env, version)
idx daily_claims_pkey CREATE UNIQUE INDEX daily_claims_pkey ON public.daily_claims USING btree (player_key, day)
idx display_names_pkey CREATE UNIQUE INDEX display_names_pkey ON public.display_names USING btree (player_key)
idx erasures_pkey CREATE UNIQUE INDEX erasures_pkey ON public.erasures USING btree (id)
idx feedback_command_id_key CREATE UNIQUE INDEX feedback_command_id_key ON public.feedback USING btree (command_id)
idx feedback_pkey CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id)
idx generations_pkey CREATE UNIQUE INDEX generations_pkey ON public.generations USING btree (player_key, generation)
idx generations_restart_id CREATE UNIQUE INDEX generations_restart_id ON public.generations USING btree (player_key, restart_id) WHERE (restart_id IS NOT NULL)
idx grant_claims_pkey CREATE UNIQUE INDEX grant_claims_pkey ON public.grant_claims USING btree (grant_id)
idx grant_key_aliases_grant CREATE INDEX grant_key_aliases_grant ON public.grant_key_aliases USING btree (grant_id)
idx grant_key_aliases_grant_id_alias_key_key CREATE UNIQUE INDEX grant_key_aliases_grant_id_alias_key_key ON public.grant_key_aliases USING btree (grant_id, alias_key)
idx grant_key_aliases_pkey CREATE UNIQUE INDEX grant_key_aliases_pkey ON public.grant_key_aliases USING btree (player_key, alias_key)
idx grants_pkey CREATE UNIQUE INDEX grants_pkey ON public.grants USING btree (id)
idx grants_player_created CREATE INDEX grants_player_created ON public.grants USING btree (player_key, created_at)
idx grants_player_key_grant_key_key CREATE UNIQUE INDEX grants_player_key_grant_key_key ON public.grants USING btree (player_key, grant_key)
idx integrity_budgets_pkey CREATE UNIQUE INDEX integrity_budgets_pkey ON public.integrity_budgets USING btree (player_key, day)
idx integrity_events_kind_received CREATE INDEX integrity_events_kind_received ON public.integrity_events USING btree (kind, received_at)
idx integrity_events_pkey CREATE UNIQUE INDEX integrity_events_pkey ON public.integrity_events USING btree (id)
idx integrity_events_player_at CREATE INDEX integrity_events_player_at ON public.integrity_events USING btree (player_key, at DESC)
idx integrity_events_received CREATE INDEX integrity_events_received ON public.integrity_events USING btree (received_at)
idx job_runs_name_started CREATE INDEX job_runs_name_started ON public.job_runs USING btree (name, started_at DESC)
idx job_runs_pkey CREATE UNIQUE INDEX job_runs_pkey ON public.job_runs USING btree (id)
idx journal_cursors_pkey CREATE UNIQUE INDEX journal_cursors_pkey ON public.journal_cursors USING btree (player_key, generation)
idx journal_entries_default_pkey CREATE UNIQUE INDEX journal_entries_default_pkey ON public.journal_entries_default USING btree (received_at, id)
idx journal_entries_default_player_key_generation_seq_idx CREATE INDEX journal_entries_default_player_key_generation_seq_idx ON public.journal_entries_default USING btree (player_key, generation, seq)
idx journal_entries_pkey CREATE UNIQUE INDEX journal_entries_pkey ON ONLY public.journal_entries USING btree (received_at, id)
idx journal_entries_player_seq CREATE INDEX journal_entries_player_seq ON ONLY public.journal_entries USING btree (player_key, generation, seq)
idx kill_switches_pkey CREATE UNIQUE INDEX kill_switches_pkey ON public.kill_switches USING btree (target, id)
idx leaderboard_entries_pkey CREATE UNIQUE INDEX leaderboard_entries_pkey ON public.leaderboard_entries USING btree (board_key, season_key, player_key)
idx leaderboard_entries_rank CREATE INDEX leaderboard_entries_rank ON public.leaderboard_entries USING btree (board_key, season_key, score DESC, elapsed_ms)
idx leaderboard_placements_board_key_season_key_player_key_key CREATE UNIQUE INDEX leaderboard_placements_board_key_season_key_player_key_key ON public.leaderboard_placements USING btree (board_key, season_key, player_key)
idx leaderboard_placements_pkey CREATE UNIQUE INDEX leaderboard_placements_pkey ON public.leaderboard_placements USING btree (receipt_id)
idx leaderboard_reviews_pkey CREATE UNIQUE INDEX leaderboard_reviews_pkey ON public.leaderboard_reviews USING btree (submission_id)
idx leaderboard_runs_pkey CREATE UNIQUE INDEX leaderboard_runs_pkey ON public.leaderboard_runs USING btree (run_id)
idx leaderboard_runs_player CREATE INDEX leaderboard_runs_player ON public.leaderboard_runs USING btree (player_key, started_at)
idx leaderboard_seasons_pkey CREATE UNIQUE INDEX leaderboard_seasons_pkey ON public.leaderboard_seasons USING btree (board_key, season_key)
idx leaderboard_submissions_board CREATE INDEX leaderboard_submissions_board ON public.leaderboard_submissions USING btree (board_key, season_key, score DESC, elapsed_ms) WHERE (visibility = 'visible'::text)
idx leaderboard_submissions_pkey CREATE UNIQUE INDEX leaderboard_submissions_pkey ON public.leaderboard_submissions USING btree (id)
idx leaderboard_submissions_player CREATE INDEX leaderboard_submissions_player ON public.leaderboard_submissions USING btree (player_key, board_key, season_key)
idx leaderboard_submissions_run_id_key CREATE UNIQUE INDEX leaderboard_submissions_run_id_key ON public.leaderboard_submissions USING btree (run_id)
idx liveops_settings_pkey CREATE UNIQUE INDEX liveops_settings_pkey ON public.liveops_settings USING btree (key)
idx ops_markers_pkey CREATE UNIQUE INDEX ops_markers_pkey ON public.ops_markers USING btree (key)
idx outbox_created CREATE INDEX outbox_created ON public.outbox USING btree (created_at)
idx outbox_dead_letters_pkey CREATE UNIQUE INDEX outbox_dead_letters_pkey ON public.outbox_dead_letters USING btree (id)
idx outbox_deliveries_pending CREATE INDEX outbox_deliveries_pending ON public.outbox_deliveries USING btree (next_attempt_at) WHERE (state = ANY (ARRAY['pending'::text, 'leased'::text]))
idx outbox_deliveries_pkey CREATE UNIQUE INDEX outbox_deliveries_pkey ON public.outbox_deliveries USING btree (outbox_id, consumer)
idx outbox_pkey CREATE UNIQUE INDEX outbox_pkey ON public.outbox USING btree (id)
idx player_flags_pkey CREATE UNIQUE INDEX player_flags_pkey ON public.player_flags USING btree (player_key, flag)
idx player_strikes_pkey CREATE UNIQUE INDEX player_strikes_pkey ON public.player_strikes USING btree (id)
idx player_strikes_player CREATE INDEX player_strikes_player ON public.player_strikes USING btree (player_key)
idx players_pkey CREATE UNIQUE INDEX players_pkey ON public.players USING btree (player_key)
idx purchase_adjustment_acks_pkey CREATE UNIQUE INDEX purchase_adjustment_acks_pkey ON public.purchase_adjustment_acks USING btree (adjustment_id)
idx purchase_adjustments_command_id_key CREATE UNIQUE INDEX purchase_adjustments_command_id_key ON public.purchase_adjustments USING btree (command_id)
idx purchase_adjustments_pkey CREATE UNIQUE INDEX purchase_adjustments_pkey ON public.purchase_adjustments USING btree (id)
idx purchase_adjustments_player CREATE INDEX purchase_adjustments_player ON public.purchase_adjustments USING btree (player_key, recorded_at)
idx purchase_transactions_pack CREATE INDEX purchase_transactions_pack ON public.purchase_transactions USING btree (player_key, pack_key) WHERE (classification = 'paid'::text)
idx purchase_transactions_pkey CREATE UNIQUE INDEX purchase_transactions_pkey ON public.purchase_transactions USING btree (id)
idx purchase_transactions_player CREATE INDEX purchase_transactions_player ON public.purchase_transactions USING btree (player_key, created_at, id)
idx purchase_transactions_provider_token_key CREATE UNIQUE INDEX purchase_transactions_provider_token_key ON public.purchase_transactions USING btree (provider_token)
idx rate_limits_pkey CREATE UNIQUE INDEX rate_limits_pkey ON public.rate_limits USING btree (key, window_start)
idx rate_limits_window CREATE INDEX rate_limits_window ON public.rate_limits USING btree (window_start)
idx save_blobs_pkey CREATE UNIQUE INDEX save_blobs_pkey ON public.save_blobs USING btree (save_id)
idx save_reviews_pkey CREATE UNIQUE INDEX save_reviews_pkey ON public.save_reviews USING btree (id)
idx save_reviews_save_id_key CREATE UNIQUE INDEX save_reviews_save_id_key ON public.save_reviews USING btree (save_id)
idx save_snapshots_anchor CREATE INDEX save_snapshots_anchor ON public.save_snapshots USING btree (player_key, generation, progress DESC, seq DESC) WHERE (disposition = ANY (ARRAY['anchored'::text, 'stored_quarantined'::text]))
idx save_snapshots_pkey CREATE UNIQUE INDEX save_snapshots_pkey ON public.save_snapshots USING btree (id)
idx save_snapshots_player_key_command_id_key CREATE UNIQUE INDEX save_snapshots_player_key_command_id_key ON public.save_snapshots USING btree (player_key, command_id)
idx save_snapshots_player_key_seq_key CREATE UNIQUE INDEX save_snapshots_player_key_seq_key ON public.save_snapshots USING btree (player_key, seq)
idx save_snapshots_received CREATE INDEX save_snapshots_received ON public.save_snapshots USING btree (received_at)
idx schedules_pkey CREATE UNIQUE INDEX schedules_pkey ON public.schedules USING btree (schedule_id)
idx schema_migrations_pkey CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (name)
idx segments_pkey CREATE UNIQUE INDEX segments_pkey ON public.segments USING btree (segment_id)
idx support_message_reads_pkey CREATE UNIQUE INDEX support_message_reads_pkey ON public.support_message_reads USING btree (player_key, message_id)
idx support_messages_command_id_key CREATE UNIQUE INDEX support_messages_command_id_key ON public.support_messages USING btree (command_id)
idx support_messages_pkey CREATE UNIQUE INDEX support_messages_pkey ON public.support_messages USING btree (id)
idx support_messages_player CREATE INDEX support_messages_player ON public.support_messages USING btree (player_key, created_at DESC)
fn apply_retention secdef=true
fn ensure_journal_partition secdef=true
fn erase_player secdef=true
fn fence_ledger secdef=false
fn players_first_build secdef=false
fn promote_snapshot secdef=true
fn prune_refused_blobs secdef=true
fn prune_save_blobs secdef=true
fn save_reviews_final secdef=false
trg achievement_unlocks.achievement_unlocks_fence
trg admin_actions.admin_actions_fence
trg code_redemptions.code_redemptions_fence
trg content_versions.content_versions_fence
trg daily_claims.daily_claims_fence
trg erasures.erasures_fence
trg generations.generations_fence
trg grant_claims.grant_claims_fence
trg grants.grants_fence
trg integrity_events.integrity_events_fence
trg leaderboard_reviews.leaderboard_reviews_fence
trg leaderboard_runs.leaderboard_runs_fence
trg leaderboard_submissions.leaderboard_submissions_fence
trg outbox.outbox_fence
trg players.players_first_build
trg player_strikes.player_strikes_fence
trg purchase_adjustment_acks.purchase_adjustment_acks_fence
trg purchase_adjustments.purchase_adjustments_fence
trg purchase_transactions.purchase_transactions_fence
trg save_blobs.save_blobs_fence
trg save_reviews.save_reviews_fence
trg save_reviews.save_reviews_final_trg
trg save_snapshots.save_snapshots_fence
trg support_messages.support_messages_fence
