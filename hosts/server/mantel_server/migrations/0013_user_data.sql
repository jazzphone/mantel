-- HK's per-person frontend user data (user_data.py): what Home Assistant keeps with
-- frontend/set_user_data, kept by Mantel for each Mantel identity. Only the few keys HK uses
-- (user_data.KEYS; today hk_music_focus, the speaker a person picked on the Music page).
--
--   subject   "u:<user id>" for a signed-in person, "d:<device id>" for a wall tablet alone
--   key       one of user_data.KEYS
--   value     JSON text, size-limited by the module
CREATE TABLE user_data (
    subject TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    updated REAL NOT NULL,
    PRIMARY KEY (subject, key)
);
