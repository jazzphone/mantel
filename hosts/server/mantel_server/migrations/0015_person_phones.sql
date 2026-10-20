-- Each person's phones for Mantel's notifications (phones.py; docs/phase9/MANTEL-LINK.md 9.7): the Home Assistant
-- Companion app's notify services (notify.mobile_app_<phone>) Mantel Link reported, picked in Mantel Settings ->
-- People, and what to send there.
--
--   user_id   the Mantel person
--   services  JSON list of notify service names ("mobile_app_sams_iphone")
--   send      'important' (the default: only Important notifications), 'all', or 'off'
CREATE TABLE IF NOT EXISTS person_phones (
    user_id    TEXT PRIMARY KEY,
    services   TEXT NOT NULL,
    send       TEXT NOT NULL DEFAULT 'important' CHECK (send IN ('important', 'all', 'off')),
    changed    REAL NOT NULL,
    changed_by TEXT
);
