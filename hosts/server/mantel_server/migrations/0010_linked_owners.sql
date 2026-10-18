-- Phase 5/6: linked mode's per-tablet ownership during the cutover (docs/phase6/CUTOVER.md §1, Option A;
-- docs/phase5/LINKED-MODE.md "Ownership"). linked_owners.py owns these tables.
--
-- A unit is a wall tablet (its settings id) or 'house' (everything of the hk_frontend entry that is not
-- a tablet's: Seasonal decorations, the Alarm PIN panel, Live TV's entities). A unit with no row is
-- Home Assistant's: nothing changes until an Owner moves one (and every move is in action_audit first).
--
-- linked_house holds what Mantel learned about the house-level entities from HA's own registry and
-- states (the Alarm PIN panel's protected alarm, ...), so it survives a restart while HA mirrors them.
-- No BEGIN/COMMIT: the runner owns the transaction. Idempotent (ensure_schema applies it to bare
-- connections too).
CREATE TABLE IF NOT EXISTS linked_owners (
    unit        TEXT PRIMARY KEY,
    owner       TEXT NOT NULL CHECK (owner IN ('ha', 'mantel')),
    changed     REAL NOT NULL,
    changed_by  TEXT
);

CREATE TABLE IF NOT EXISTS linked_house (
    key      TEXT PRIMARY KEY,
    body     TEXT NOT NULL,
    updated  REAL NOT NULL
);
