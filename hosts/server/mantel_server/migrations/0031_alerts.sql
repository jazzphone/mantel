-- System alerts (docs/phase14/SYSTEM-ALERTS.md): the channels an Owner set up, what was raised and cleared, and the
-- alert center's own settings.
--
--   alert_channels   one row per channel (Discord, Notifiarr, Telegram, email, Apprise). `events` is the JSON list of
--                    kinds the channel takes, `quiet` its quiet hours {on, from, to, critical}, `config` what may be
--                    shown (a chat id, a server's name), `sealed` the secrets (atrest.SecretBox, associated data
--                    "alert-channel:<id>"), `hint` the secret's last four characters for the page. `fails` counts
--                    the deliveries given up on in a row.
--   alert_log        30 days of raises and clears (`up` 1 or 0) and the channels each went to (`sent_to`, JSON).
--   alert_settings   the center's settings by key (holds per group, the heartbeat, the update check), JSON values.
CREATE TABLE alert_channels (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    events      TEXT NOT NULL DEFAULT '[]',
    min_level   TEXT NOT NULL DEFAULT 'info',
    quiet       TEXT NOT NULL DEFAULT '{}',
    config      TEXT NOT NULL DEFAULT '{}',
    sealed      BLOB,
    hint        TEXT,
    created     REAL NOT NULL,
    last_ok     REAL,
    last_error  TEXT,
    last_error_at REAL,
    fails       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE alert_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       REAL NOT NULL,
    kind     TEXT NOT NULL,
    key      TEXT NOT NULL DEFAULT '',
    level    TEXT NOT NULL,
    up       INTEGER NOT NULL,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL DEFAULT '',
    sent_to  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX alert_log_at ON alert_log(at);

CREATE TABLE alert_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated REAL NOT NULL
);
