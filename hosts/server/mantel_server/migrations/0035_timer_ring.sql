-- A timer ringing (docs/phase21/TIMER-SLIDE.md): until when, so a ring carries on across a restart of Mantel and never starts over.
ALTER TABLE timers ADD COLUMN ring_until REAL;
-- Its length, for Restart: an idle helper's own `duration` is 0 (measured), since every start passes the time it runs for.
ALTER TABLE timers ADD COLUMN total INTEGER NOT NULL DEFAULT 0;
