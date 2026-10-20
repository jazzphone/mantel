-- Mantel Photos (photos.py, docs/phase4/PHOTOS.md): the house's own photo library for the screensavers.
--
-- The pictures are files in <data_dir>/photos (originals/, screen/, thumbs/; 0700 folders, 0600 files), named by
-- the photo's id. These tables hold what is known about them.
--
-- photo_albums: an album is a named set of photos; a screen's screensaver shows one (mantel-photos://<id>).
--   id       16 hex characters
--   name     what people call it (1..60 characters)
--   position its place in the list
CREATE TABLE photo_albums (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created  REAL NOT NULL,
    updated  REAL NOT NULL
);

-- photos: one picture, in exactly one album.
--   id          32 hex characters (the files' name)
--   sha256      of the bytes as they came in (an upload, or the file read from Home Assistant): the same picture
--               twice in one album is skipped
--   name        the file name it came with, for people (never a path on this server)
--   width/height of the stored original, upright (the orientation applied)
--   bytes       the three stored files together (what counts against the cap)
--   source      'upload' or 'ha' (imported from a Home Assistant media folder)
--   created_by  the Mantel user who added it
CREATE TABLE photos (
    id          TEXT PRIMARY KEY,
    album_id    TEXT NOT NULL REFERENCES photo_albums(id),
    sha256      TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    source      TEXT NOT NULL DEFAULT 'upload',
    created     REAL NOT NULL,
    created_by  TEXT
);
CREATE UNIQUE INDEX photos_album_sha ON photos(album_id, sha256);
CREATE INDEX photos_album ON photos(album_id, created);

-- photo_screens: a screen whose screensaver shows an album instead of the house's Screensaver Photos.
--   screen  the screen's address (its dashboard path, e.g. dashboard-kitchen)
CREATE TABLE photo_screens (
    screen   TEXT PRIMARY KEY,
    album_id TEXT NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
    updated  REAL NOT NULL
);

-- photo_settings: the library's limits (an Owner's to change): quota_mb (all photos together), file_mb (one upload).
CREATE TABLE photo_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated REAL NOT NULL
);
