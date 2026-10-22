-- The Mantel app's web view (app_auth.web_session): its browser session now names the app credential that asked
-- for it. The app keeps the web view's cookies only while it runs, so every launch left a 30-day session behind
-- in Me → My Sessions ("Browser on iPhone", over and over), and signing the app out left them all working. Now a
-- new web view session ends the app's previous one, and the app's credential takes its web sessions with it.
-- The ones made before this can't be told apart, so they end here: an open web view is handed a new one at once.
ALTER TABLE sessions ADD COLUMN parent_id TEXT;
CREATE INDEX sessions_parent ON sessions(parent_id);
DELETE FROM access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE method = 'app-web' AND revoked IS NULL);
UPDATE sessions SET revoked = CAST(strftime('%s', 'now') AS REAL), revoked_reason = 'app_web_replaced'
    WHERE method = 'app-web' AND revoked IS NULL;
