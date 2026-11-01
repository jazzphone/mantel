-- Time Behind's presets (cutout.py PRESETS, photos.py; docs/phase4/PHOTOS.md): Strict, Standard or Relaxed decide
-- which cut-outs qualify, from what each photo's check found, so a change of preset applies at once.
--
--   cutout_cover  the subject's share of the frame, 0..1 (NULL: checked before this, or the file couldn't be read;
--                 the backfill checks every photo judged by older rules again)
-- The library's preset is photo_settings' `cutout_preset` (no row: Standard).
ALTER TABLE photos ADD COLUMN cutout_cover REAL;
