-- HomePod timers (docs/phase28/HOMEPOD-TIMERS.md): each timer the HomePod timer reader reads, as Mantel follows it from one
-- read to the next (hk_core.timers.homepod.match), and the number of its Home Assistant helper (timer.hk_homepod_<n>), so a
-- restart keeps the same helpers. `over`: gone from its HomePod ('ended' or 'canceled'), its helper still to finish or go.
CREATE TABLE homepod_timers (
    n       INTEGER PRIMARY KEY,
    tile    TEXT NOT NULL,
    label   TEXT NOT NULL,
    room    TEXT NOT NULL DEFAULT '',
    homepod TEXT NOT NULL DEFAULT '',
    ends    REAL,
    left_s  REAL NOT NULL DEFAULT 0,
    paused  INTEGER NOT NULL DEFAULT 0,
    seen    REAL NOT NULL DEFAULT 0,
    first   REAL NOT NULL DEFAULT 0,
    total   INTEGER NOT NULL DEFAULT 0,
    over    TEXT
);
