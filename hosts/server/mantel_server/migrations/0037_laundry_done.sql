-- Laundry: Done, held until someone unloads (hk_core/laundry.py, mantel_server/laundry.py): one row per machine, kept across a restart.
-- Most machines say they finished for a moment, a plug never does, so Mantel holds it until Clear, the door, the next run or Clear After.
CREATE TABLE laundry_done (
    machine_id TEXT PRIMARY KEY,
    since      REAL NOT NULL,
    words      TEXT NOT NULL DEFAULT 'Done'
);
