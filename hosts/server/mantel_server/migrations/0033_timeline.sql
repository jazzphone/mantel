-- The House Timeline (docs/phase19/HOUSE-TIMELINE.md "Storage"): what happened at the house, 30 days by default.
--
--   timeline_events    one row per thing that happened. `src` makes every write idempotent ('ha:<entity>:<lc>',
--                      'pt:<event id>:<kind>', 'au:<audit id>', 'al:<alert log id>'): a reconnect never doubles a row.
--                      `title` is kept as written (a lock renamed later doesn't rewrite history). `search` is the
--                      lowercase words of the title, the area and the device, never a person's name. `person` is the
--                      Mantel person an arrival is about; `actor`/`actor_name`/`device`/`device_name`/`how`/`audit_id`
--                      who did it, from the audit. No append-only triggers: the audit stays the record of who did what.
--   timeline_pics      the pictures of a camera's row (files under <data_dir>/timeline/<yyyy-mm>/<id>.jpg); deleting an
--                      event deletes its picture rows (foreign_keys is on in db.connect).
--   timeline_settings  the timeline's settings by key (families, overrides, retention, pictures, wall view, digest).
--   timeline_digests   the morning digest of each of the house's days, sent once.
CREATE TABLE timeline_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    src         TEXT NOT NULL UNIQUE,
    at          REAL NOT NULL,
    ended       REAL,
    family      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    level       TEXT NOT NULL DEFAULT 'info',
    entity      TEXT,
    area        TEXT,
    title       TEXT NOT NULL,
    search      TEXT NOT NULL DEFAULT '',
    detail      TEXT NOT NULL DEFAULT '{}',
    person      TEXT,
    actor       TEXT,
    actor_name  TEXT,
    device      TEXT,
    device_name TEXT,
    how         TEXT,
    audit_id    INTEGER
);
CREATE INDEX timeline_at ON timeline_events(at);
CREATE INDEX timeline_family_at ON timeline_events(family, at);
CREATE INDEX timeline_entity_at ON timeline_events(entity, at);
CREATE INDEX timeline_person_at ON timeline_events(person, at) WHERE person IS NOT NULL;
CREATE INDEX timeline_actor_at ON timeline_events(actor, at) WHERE actor IS NOT NULL;

CREATE TABLE timeline_pics (
    id      TEXT PRIMARY KEY,
    event   INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    camera  TEXT NOT NULL,
    at      REAL NOT NULL,
    size    INTEGER NOT NULL
);
CREATE INDEX timeline_pics_event ON timeline_pics(event);
CREATE INDEX timeline_pics_at ON timeline_pics(at);

CREATE TABLE timeline_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated REAL NOT NULL
);

CREATE TABLE timeline_digests (
    day   TEXT PRIMARY KEY,
    sent  REAL,
    body  TEXT NOT NULL
);

-- Forgetting a person (decision 18): whichever way a person is removed (People, a merge, an unlinked Home Assistant
-- user), the rows they did lose the link and the name, and their arrivals and departures are deleted.
CREATE TRIGGER timeline_forget_person AFTER DELETE ON users
BEGIN
    DELETE FROM timeline_events WHERE person = OLD.id AND family = 'arrival';
    UPDATE timeline_events SET person = NULL WHERE person = OLD.id;
    UPDATE timeline_events SET actor = NULL, actor_name = 'A former member', device = NULL, device_name = NULL
        WHERE actor = OLD.id;
END;
