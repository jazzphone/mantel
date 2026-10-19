-- The iPhone, iPad and Mac apps (app_auth.py, docs/phase10/APPLE-APPS.md §2-§3, slice 10.2).
--
-- app_credentials: one row per signed-in app, beside its refresh family in `sessions` (same id, method 'app').
-- The app's tokens are bound to a P-256 key made in the device's Secure Enclave: every request carries a proof
-- signed with it (DPoP, RFC 9449), so a copied token is useless without the device. Only the public key is kept.
--
--   id         = sessions.id of the app's refresh family (revoking either ends both)
--   client_id  'mantel-ios' or 'mantel-mac'
--   name/model/platform  what the app says it is ("Avery's iPhone", "iPhone17,1", "iOS 27.0"), for Me → Devices
--   jkt        the device key's JWK thumbprint (RFC 7638); jwk its public JWK
--   last_door  'lan' or 'tunnel', where it was last seen
CREATE TABLE app_credentials (
    id         TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  TEXT NOT NULL,
    name       TEXT,
    model      TEXT,
    platform   TEXT,
    jkt        TEXT NOT NULL,
    jwk        TEXT NOT NULL,
    created    REAL NOT NULL,
    last_seen  REAL,
    last_door  TEXT
);
CREATE INDEX app_credentials_user ON app_credentials(user_id);

-- Sign in with Apple, by linking only (§3): a signed-in person links their Apple ID; Apple's stable `sub` for this
-- app is kept. Apple never creates a Mantel account.
CREATE TABLE apple_links (
    sub      TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created  REAL NOT NULL
);

-- The house's two addresses as the apps are told them (an Owner may change them), and its name.
CREATE TABLE app_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated REAL NOT NULL
);
