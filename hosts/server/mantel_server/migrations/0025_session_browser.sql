-- One row per browser in Me → My Sessions (2026-10-28). Every sign-in started a new 30-day session, and a browser
-- that lost its cookies, or signed in again through Home Assistant, left the old one behind: "Safari on Mac" a
-- dozen times over. Now each browser carries a random id of its own (the mantel_browser cookie, sessions.py
-- browser_of), and a new session there ends the ones before it. The sessions made before this have none.
ALTER TABLE sessions ADD COLUMN browser TEXT;
CREATE INDEX sessions_browser ON sessions(user_id, browser) WHERE browser IS NOT NULL;
