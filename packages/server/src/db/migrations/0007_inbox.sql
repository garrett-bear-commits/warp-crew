-- 0007_inbox: support letters (append-only), announcements, read state, feedback.
CREATE TABLE support_messages (
  id           BIGSERIAL   PRIMARY KEY,
  player_key   TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  grant_key    TEXT,
  reason       TEXT        NOT NULL,
  ticket_ref   TEXT,
  actor        TEXT        NOT NULL,
  command_id   UUID        NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ
);
CREATE INDEX support_messages_player ON support_messages (player_key, created_at DESC);

CREATE TABLE announcements (
  announcement_id TEXT       PRIMARY KEY,
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  segment_id   TEXT,
  grant_key    TEXT,
  version      INTEGER     NOT NULL DEFAULT 1,
  actor        TEXT        NOT NULL,
  reason       TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE announcement_reads (
  player_key       TEXT        NOT NULL,
  announcement_id  TEXT        NOT NULL REFERENCES announcements (announcement_id),
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, announcement_id)
);

CREATE TABLE support_message_reads (
  player_key   TEXT        NOT NULL,
  message_id   BIGINT      NOT NULL REFERENCES support_messages (id),
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, message_id)
);

CREATE TABLE feedback (
  id            BIGSERIAL   PRIMARY KEY,
  player_key    TEXT        NOT NULL,
  category      TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  build_version TEXT,
  status        TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'resolved')),
  command_id    UUID        NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
