-- Where a person's notifications go besides the screens (push.py, docs/phase10/APPLE-APPS.md §5, slice 10.0
-- and 10.5): a browser's Web Push subscription (a Home Screen web app on an iPhone, or any browser), or an app's
-- APNs device token. Each belongs to one person; signing out of the app or revoking it removes its row.
--
--   kind      'web' (Web Push, RFC 8030/8291) or 'apns' (the iPhone/iPad/Mac app)
--   endpoint  web: the push service's URL for this browser (checked against known push services);
--             apns: the device token (hex)
--   p256dh    web: the browser's P-256 key; apns: the app's notification key (x963), base64url. Messages are
--             encrypted to it, so the push service (Apple, Google, Mozilla) sees ciphertext only
--   auth      web: the subscription's auth secret, base64url (unused for apns)
--   app_id    apns: the app credential (sessions.id of method 'app') it was registered with; NULL for web
--   env       apns: 'sandbox' or 'production' (which APNs host); NULL for web
CREATE TABLE push_targets (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('web', 'apns')),
    endpoint  TEXT NOT NULL UNIQUE,
    p256dh    TEXT NOT NULL,
    auth      TEXT,
    app_id    TEXT,
    env       TEXT,
    name      TEXT,
    created   REAL NOT NULL,
    last_ok   REAL,
    failures  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_targets_user ON push_targets(user_id);
