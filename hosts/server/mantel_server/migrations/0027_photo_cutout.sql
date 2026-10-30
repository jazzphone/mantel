-- Time Behind (cutout.py, photos.py, docs/phase4/PHOTOS.md; docs/phase11/HOMEVIEW-LOOK.md decision 14): each photo's
-- subject cut out once, so a screensaver can draw the time behind it. Only what is the subject is found, never who.
--
--   cutout_at    when it was checked; NULL: not yet (the backfill does it)
--   cutout_by    by which model ('u2netp'), so a later, better one may check them all again
--   cutout_ok    1: usable -- its mask is masks/<id>.png, counted in `bytes`; 0: checked, not usable (or unreadable)
--   cutout_conf  the mask's confidence, 0..1 (NULL: the file couldn't be read)
--   depth_box    JSON [x, y, w, h], fractions of the upright photo: where the time goes (usable photos only)
--   taken        the year the photo was taken, read from its EXIF before the EXIF is dropped (Photo Titles); NULL:
--                not known (every photo stored before this)
-- and an album's Only Photos That Qualify: its screensavers show only its usable photos.
ALTER TABLE photos ADD COLUMN cutout_at REAL;
ALTER TABLE photos ADD COLUMN cutout_by TEXT;
ALTER TABLE photos ADD COLUMN cutout_ok INTEGER;
ALTER TABLE photos ADD COLUMN cutout_conf REAL;
ALTER TABLE photos ADD COLUMN depth_box TEXT;
ALTER TABLE photos ADD COLUMN taken INTEGER;
ALTER TABLE photo_albums ADD COLUMN depth_only INTEGER NOT NULL DEFAULT 0;

-- the cut-out backfill's next photo (newest first) among those not checked yet
CREATE INDEX photos_uncut ON photos(created) WHERE cutout_at IS NULL;
