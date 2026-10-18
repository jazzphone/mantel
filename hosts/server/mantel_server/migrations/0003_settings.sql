-- P3.5 HK settings in Mantel (PLAN §2 "Settings live in a config entry", §4, §10 "HK Settings").
-- Applied once by db.py's numbered-migration runner. Idempotent on purpose (IF NOT EXISTS).
--
-- A settings DOCUMENT is one JSON object, addressed by (scope, key):
--   house  / settings | setup | popups | custom_pages | custom_chips | accessories | catalog
--   board  / <dashboard url path>        (one screen's settings)
--   tablet / <tablet id>                 (one wall tablet's settings)
--   user   / <users.id>                  (one person's own settings, PLAN §5 "their own")
-- `version` starts at 1 and goes up by one with every change that changes something.

CREATE TABLE IF NOT EXISTS settings_docs (
    scope      TEXT NOT NULL CHECK (scope IN ('house', 'board', 'tablet', 'user')),
    key        TEXT NOT NULL,
    version    INTEGER NOT NULL CHECK (version >= 1),
    body       TEXT NOT NULL,              -- JSON object
    updated    REAL NOT NULL,
    updated_by TEXT,                       -- users.id, "device:<id>", or a label ("import", "cli")
    PRIMARY KEY (scope, key)
);

-- Every version of every document, with who made it, when, and what changed. Append-only:
-- a restore is a NEW version whose body is an older one's.
CREATE TABLE IF NOT EXISTS settings_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope      TEXT NOT NULL,
    key        TEXT NOT NULL,
    version    INTEGER NOT NULL,
    body       TEXT NOT NULL,              -- the document as it is AT this version
    diff       TEXT NOT NULL,              -- JSON {"added": {path: new}, "removed": {path: old}, "changed": {path: [old, new]}}
    action     TEXT NOT NULL CHECK (action IN ('set', 'restore', 'import')),
    message    TEXT,                       -- the client message type that made it (hk_frontend/settings/set, ...)
    actor      TEXT,                       -- users.id, "device:<id>", or a label
    actor_role TEXT,
    device     TEXT,                       -- devices.id when the change came from an enrolled device
    source     TEXT,                       -- import: "ha:<entry id>"; restore: "v<N>"
    created    REAL NOT NULL,
    UNIQUE (scope, key, version)
);
CREATE INDEX IF NOT EXISTS settings_history_doc ON settings_history (scope, key, version DESC);

CREATE TRIGGER IF NOT EXISTS settings_history_no_update BEFORE UPDATE ON settings_history
BEGIN
    SELECT RAISE(ABORT, 'settings_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS settings_history_no_delete BEFORE DELETE ON settings_history
BEGIN
    SELECT RAISE(ABORT, 'settings_history is append-only');
END;

-- The one-time import from Home Assistant's config entry: at most one row, ever.
CREATE TABLE IF NOT EXISTS settings_import (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    source   TEXT NOT NULL,                -- "ha:<entry id>"
    read     TEXT NOT NULL,                -- the HA read it came from: "hk_frontend/panel/get"
    checksum TEXT NOT NULL,                -- SHA-256 of the canonical JSON of what HA answered
    written  TEXT NOT NULL,                -- JSON list of "scope/key" written as version 1
    skipped  TEXT NOT NULL,                -- JSON list of "scope/key" that already existed (left alone)
    actor    TEXT,
    created  REAL NOT NULL
);
