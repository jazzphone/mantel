-- Mantel Photos' focus points (photos.py, faces.py, docs/phase4/PHOTOS.md): where a photo's faces are, so the
-- screensavers crop and zoom around them instead of the middle. Only WHERE faces are is found, never who.
--
--   faces     JSON [[x, y, w, h, score], ...]: the kept faces (at most 12, largest first), as fractions of the
--             upright picture. NULL: not checked yet (the backfill does it); '[]': checked, no faces.
--   faces_at  when it was checked;  faces_by  by which detector ('yunet-2023mar'), so a later model may check again
--   focus_x/focus_y  a point an Owner or Admin set by hand (fractions; NULL = automatic). Going back to automatic
--             clears only these: the detected faces stay.
--
-- The focus a screen uses is worked out when read: by hand, else the centre of the kept faces, else none.
ALTER TABLE photos ADD COLUMN faces TEXT;
ALTER TABLE photos ADD COLUMN faces_at REAL;
ALTER TABLE photos ADD COLUMN faces_by TEXT;
ALTER TABLE photos ADD COLUMN focus_x REAL;
ALTER TABLE photos ADD COLUMN focus_y REAL;

-- the backfill's next photo (newest first) among those not checked yet
CREATE INDEX photos_unchecked ON photos(created) WHERE faces_at IS NULL;
