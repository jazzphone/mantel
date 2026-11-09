-- Timers people set (docs/phase21/TIMER-SLIDE.md): what Home Assistant has no place for, and Mantel's copy of each one's end
-- time, so an end is noticed across a restart of either (hk_core.timers.judge). One row while the timer runs. `made`: Mantel
-- made it as a helper and deletes it once it is over; a quick slot is only followed.
CREATE TABLE timers (
    entity_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    room        TEXT,
    rings_in    TEXT,
    set_by      TEXT,
    created     REAL NOT NULL,
    finishes_at REAL,
    made        INTEGER NOT NULL DEFAULT 0
);
