PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags_dict (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '',
  color TEXT,
  note  TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  time_offset INTEGER NOT NULL DEFAULT 0,
  event_at    INTEGER GENERATED ALWAYS AS (created_at + time_offset) STORED,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_event_at ON events (event_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_card_id ON events (card_id);

CREATE TABLE IF NOT EXISTS checkin_tags (
  id         INTEGER PRIMARY KEY,
  checkin_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags_dict(id) ON DELETE RESTRICT,
  UNIQUE (checkin_id, tag_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_checkin_tags_tag_id ON checkin_tags (tag_id);

CREATE TABLE IF NOT EXISTS unit_dict (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS tag_values (
  id      INTEGER PRIMARY KEY,
  link    INTEGER NOT NULL REFERENCES checkin_tags(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES unit_dict(id) ON DELETE RESTRICT,
  value   ANY NOT NULL CHECK (typeof(value) IN ('integer', 'real', 'text'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tag_values_link ON tag_values (link);
CREATE INDEX IF NOT EXISTS idx_tag_values_unit_id ON tag_values (unit_id);

-- Any file kept with an event; its bytes sit in the attachments folder under `id`, and a thumbnail the browser drew
-- under `id.thumb` when `thumb` is 1; `width`/`height` are a picture's or video's pixels when known. An upload belongs
-- to no event until the checkin or edit carrying it is saved.
CREATE TABLE IF NOT EXISTS checkin_attachments (
  id          TEXT    PRIMARY KEY,
  checkin_id  INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  thumb       INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkin_attachments_checkin_id ON checkin_attachments (checkin_id);

CREATE TABLE IF NOT EXISTS event_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  device     TEXT    NOT NULL,
  edited_at  INTEGER NOT NULL,
  shown      INTEGER NOT NULL DEFAULT 0 CHECK (shown IN (0, 1)),
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  event_at   INTEGER,
  note       TEXT,
  tags       TEXT    NOT NULL DEFAULT '[]',
  facts      TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_event_versions_event_id ON event_versions (event_id);

CREATE TABLE IF NOT EXISTS cards (
  id       TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  def      TEXT NOT NULL CHECK (json_valid(def))
) STRICT;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

PRAGMA user_version = 2;
