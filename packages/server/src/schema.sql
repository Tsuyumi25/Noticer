PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags_dict (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  color TEXT
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
  checkin_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags_dict(id) ON DELETE RESTRICT,
  PRIMARY KEY (checkin_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_checkin_tags_tag_id ON checkin_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_checkin_tags_checkin_id ON checkin_tags (checkin_id);

CREATE TABLE IF NOT EXISTS checkin_facts (
  checkin_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  k          TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('text','integer','real','boolean')),
  value      ANY     NOT NULL,
  PRIMARY KEY (checkin_id, k),
  CHECK (
    (type = 'text'    AND typeof(value) = 'text') OR
    (type = 'integer' AND typeof(value) = 'integer') OR
    (type = 'real'    AND typeof(value) IN ('real','integer')) OR
    (type = 'boolean' AND typeof(value) = 'integer' AND value IN (0,1))
  )
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_checkin_facts_k ON checkin_facts (k);
CREATE INDEX IF NOT EXISTS idx_checkin_facts_k_type ON checkin_facts (k, type);

CREATE TABLE IF NOT EXISTS checkin_images (
  checkin_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename    TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (checkin_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_checkin_images_checkin_id ON checkin_images (checkin_id);
