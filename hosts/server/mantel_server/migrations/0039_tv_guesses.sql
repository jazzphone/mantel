-- TVs (hk_core/tv.py, mantel_server/tv.py): an icon guessed by an app's name, for the apps a player lists that nobody has opened
-- yet (no bundle id until then). Dropped when the app opens as another bundle id; the real one is looked up then.
CREATE TABLE tv_guesses (
    name       TEXT PRIMARY KEY,
    bundle     TEXT,
    tried      REAL NOT NULL DEFAULT 0,
    icon       BLOB,
    icon_type  TEXT
);
