-- TVs (hk_core/tv.py, mantel_server/tv.py): the apps each Apple TV opens, counted, each with its App Store icon once found,
-- and the TV input each room's player is on, learned when the player wakes its TV. Kept across a restart.
CREATE TABLE tv_apps (
    app_id     TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    last       REAL NOT NULL DEFAULT 0,
    tried      REAL NOT NULL DEFAULT 0,
    icon       BLOB,
    icon_type  TEXT
);
CREATE TABLE tv_inputs (
    tv         TEXT PRIMARY KEY,
    input      TEXT NOT NULL,
    player     TEXT,
    at         REAL NOT NULL
);
