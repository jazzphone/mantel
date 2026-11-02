-- On This Day (docs/phase13/GLANCE-SPEC.md, "Media"): a screensaver piece says "3 years ago today" over a photo taken on
-- this day in an earlier year, so a photo carries the DAY it was taken, not only the year (`taken`, migration 0027).
--
--   taken_on   "YYYY-MM-DD", read from the photo's EXIF on upload before the EXIF is dropped -- the day alone, never
--              the time or anything else of the EXIF. NULL: not looked for yet (every photo stored before this; the
--              server fills what it can at startup, photos.py `fill_days`, from camera-style file names whose year
--              is the year the EXIF gave), or '' : looked for and not known. A photo sent again fills it in.
ALTER TABLE photos ADD COLUMN taken_on TEXT;

-- the day fill's next photos (newest first) among those with a year and no day looked for yet
CREATE INDEX photos_unday ON photos(created) WHERE taken IS NOT NULL AND taken_on IS NULL;
