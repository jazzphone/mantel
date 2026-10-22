-- Mantel's own settings that were start-up options (the HA App's Configuration pane, Docker's environment): they
-- live here now, set in Mantel Settings, the same on every installation (server_settings.py). Each row's value is
-- JSON; `source` says where it came from: 'start-up' (copied once from the option it replaced) or 'settings'.
-- Marker rows (`moved:<what>`) say a one-time move into another store (the approved frame origins, Music
-- Assistant's connection) is done.
CREATE TABLE server_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    source  TEXT NOT NULL,
    set_by  TEXT,
    updated REAL NOT NULL
);
