-- The screen a person or a wall tablet opens on (default_screens.py): where / and /home go.
--
--   subject   "u:<user id>" for a person, "d:<device id>" for an enrolled wall tablet
--   screen    a screen's address (an HK board key, e.g. dashboard-kitchen)
--   set_by    the Mantel user id who chose it
-- Landing only: which screens anyone may open, and what they see on them, stays with roles and grants.
CREATE TABLE default_screens (
    subject TEXT PRIMARY KEY,
    screen  TEXT NOT NULL,
    set_by  TEXT,
    updated REAL NOT NULL
);
