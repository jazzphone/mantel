-- A vacuum's water tank that ran dry (hk_core/vacuum_water.py): the latch, one row per vacuum, kept across a restart of Mantel.
-- The Roborocks report it for under a second, so Mantel holds it until Clear, or Clear After hours.
CREATE TABLE vacuum_water (
    vacuum_id TEXT PRIMARY KEY,
    since     REAL NOT NULL,
    words     TEXT NOT NULL DEFAULT 'Water tank empty'
);
