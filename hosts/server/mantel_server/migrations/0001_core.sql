-- 0001_core (P3.1): users, HA links, passwords, TOTP, passkeys, sessions, devices, bootstrap.
--
-- Works on a new database and on the Phase 0 schema (links, sessions, command_audit with no
-- schema_version table). The Phase 0 tables are first created empty if missing, so the copy
-- below is the same statement either way; their rows move into the new tables and the old
-- tables are dropped. command_audit is kept exactly as it was (append-only, proof 2).
-- Roles are checked in Python (store.ROLES), not by CHECK, so P3.2 can make roles editable.

-- Phase 0 tables, as Phase 0 created them ----------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
    ha_user_id TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','adult','child','guest','wall_tablet')),
    name       TEXT,
    created    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id_hash    TEXT PRIMARY KEY,
    ha_user_id TEXT NOT NULL,
    created    REAL NOT NULL,
    expires    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS command_audit (
    id INTEGER PRIMARY KEY,
    timestamp REAL NOT NULL,
    actor TEXT,
    role TEXT,
    device TEXT NOT NULL CHECK (device = 'unknown'),
    action TEXT,
    target TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
    reason TEXT NOT NULL,
    dry_run INTEGER NOT NULL CHECK (dry_run = 1),
    source_ip TEXT
);
CREATE TRIGGER IF NOT EXISTS command_audit_no_update BEFORE UPDATE ON command_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS command_audit_no_delete BEFORE DELETE ON command_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

ALTER TABLE sessions RENAME TO legacy_sessions;

-- People --------------------------------------------------------------------------------------
CREATE TABLE users (
    id               TEXT PRIMARY KEY,                     -- random hex, never reused
    username         TEXT UNIQUE COLLATE NOCASE,           -- HK sign-in name; NULL for HA-only users
    name             TEXT,                                 -- display name
    role             TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('hk', 'ha_linked')),
    disabled         INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
    password_hash    TEXT,                                 -- Argon2id (PHC string)
    password_changed REAL,
    failed_logins    INTEGER NOT NULL DEFAULT 0,
    locked_until     REAL,
    webauthn_handle  BLOB UNIQUE,                          -- random user handle for passkeys
    created          REAL NOT NULL,
    updated          REAL NOT NULL
);

-- An HA account linked to a Mantel user (Sign in with HA lands in this user).
CREATE TABLE ha_links (
    ha_user_id TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created    REAL NOT NULL
);

-- TOTP (RFC 6238). The seed is AES-GCM encrypted with the at-rest key; never stored in clear.
CREATE TABLE totp_credentials (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    seed_enc     BLOB NOT NULL,
    confirmed    REAL,                                     -- NULL until the first code is verified
    last_counter INTEGER NOT NULL DEFAULT -1,              -- replay guard: a time step is usable once
    created      REAL NOT NULL
);

CREATE TABLE passkeys (
    id          TEXT PRIMARY KEY,                          -- credential id, base64url
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key  BLOB NOT NULL,                             -- COSE public key
    sign_count  INTEGER NOT NULL DEFAULT 0,
    transports  TEXT,                                      -- JSON list
    name        TEXT,
    backed_up   INTEGER NOT NULL DEFAULT 0,
    created     REAL NOT NULL,
    last_used   REAL
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- WebAuthn challenges live on the server, single use, with an expiry.
CREATE TABLE webauthn_challenges (
    id        TEXT PRIMARY KEY,
    user_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
    purpose   TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate')),
    challenge BLOB NOT NULL,
    expires   REAL NOT NULL
);

-- Password accepted, second factor still owed (hash of a short-lived, single-use token).
CREATE TABLE auth_pending (
    hash     TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    door     TEXT NOT NULL CHECK (door IN ('lan', 'tunnel')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires  REAL NOT NULL
);

-- First-Owner setup token from `mantel-server bootstrap` (hash only; at most one row).
CREATE TABLE bootstrap_tokens (
    hash    TEXT PRIMARY KEY,
    created REAL NOT NULL,
    expires REAL NOT NULL
);

-- Sessions: one row per sign-in (a refresh family). Tokens are stored as SHA-256 only.
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,                      -- random, not a secret (for listing/revoking)
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    door            TEXT NOT NULL CHECK (door IN ('lan', 'tunnel')),
    method          TEXT NOT NULL,                         -- password, password+totp, passkey, ha, bootstrap, legacy
    csrf            TEXT NOT NULL,                         -- echoed in X-CSRF-Token; useless without the cookies
    created         REAL NOT NULL,
    expires         REAL NOT NULL,                         -- absolute: 30 days on the LAN, 12 h on the tunnel
    last_seen       REAL,
    fresh_factor_at REAL,                                  -- last interactive factor (sign-in or step-up)
    fresh_factor    TEXT,
    revoked         REAL,
    revoked_reason  TEXT,
    user_agent      TEXT,
    source_ip       TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE access_tokens (
    hash       TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    expires    REAL NOT NULL
);
CREATE INDEX access_tokens_session ON access_tokens(session_id);

CREATE TABLE refresh_tokens (
    hash       TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created    REAL NOT NULL,
    used       REAL                                         -- set on rotation; a later reuse revokes the family
);
CREATE INDEX refresh_tokens_session ON refresh_tokens(session_id);

-- Devices ("Make this a wall tablet"): their own role and room, a rotating secret (hashes only).
CREATE TABLE devices (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL,
    room           TEXT,
    enrolled_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    secret_hash    TEXT NOT NULL UNIQUE,                   -- the confirmed current secret
    next_hash      TEXT UNIQUE,                            -- issued by a rotation, not yet seen back
    next_issued    REAL,
    retired_hash   TEXT,                                   -- replaced secret; seen again later = theft
    retired_at     REAL,
    rotated_at     REAL NOT NULL,
    csrf           TEXT NOT NULL,
    created        REAL NOT NULL,
    last_seen      REAL,
    source_ip      TEXT,
    revoked        REAL,
    revoked_reason TEXT
);

-- Move the Phase 0 rows in ---------------------------------------------------------------------
CREATE TEMP TABLE _link_ids AS SELECT ha_user_id, lower(hex(randomblob(16))) AS user_id FROM links;
INSERT INTO users (id, username, name, role, kind, created, updated)
    SELECT m.user_id, NULL, l.name, l.role, 'ha_linked', l.created, l.created
    FROM links l JOIN _link_ids m USING (ha_user_id);
INSERT INTO ha_links (ha_user_id, user_id, created)
    SELECT l.ha_user_id, m.user_id, l.created FROM links l JOIN _link_ids m USING (ha_user_id);

-- A Phase 0 session cookie stays valid until it expires: its SHA-256 becomes an access token.
CREATE TEMP TABLE _session_ids AS
    SELECT s.id_hash, s.created, s.expires, h.user_id, lower(hex(randomblob(16))) AS session_id
    FROM legacy_sessions s JOIN ha_links h ON h.ha_user_id = s.ha_user_id;
INSERT INTO sessions (id, user_id, door, method, csrf, created, expires, last_seen)
    SELECT session_id, user_id, 'lan', 'legacy', lower(hex(randomblob(32))), created, expires, created
    FROM _session_ids;
INSERT INTO access_tokens (hash, session_id, expires) SELECT id_hash, session_id, expires FROM _session_ids;

DROP TABLE _session_ids;
DROP TABLE _link_ids;
DROP TABLE legacy_sessions;
DROP TABLE links;
