-- TVs: icons kept before 2026-11-10's fix were cut at the first 16 kB chunk of their download (mantel_server/tv.py read_all).
-- Dropped, to be fetched whole: an opened app's at the server's start, a guessed one's as the names are searched again.
UPDATE tv_apps SET icon = NULL, icon_type = NULL, tried = 0;
DELETE FROM tv_guesses;
