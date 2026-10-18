-- Mantel Connect pairing (connect_pairing.py; docs/phase3/CONNECT.md). Idempotent, so a bare connection
-- (tests, tools) can apply it too.
--
-- Numbered 0009: the next free number when written (the backup test wants numbers without gaps).

-- A pending pairing code. Only the key derived from the code is kept, and only until the code is spent,
-- burned or expired (the rows are deleted, not flagged). `id` is the code's public first group.
CREATE TABLE IF NOT EXISTS connect_codes (
    id         TEXT PRIMARY KEY,
    mac_key    TEXT NOT NULL,
    created    REAL NOT NULL,
    expires    REAL NOT NULL,
    created_by TEXT,
    attempts   INTEGER NOT NULL DEFAULT 0
);

-- A paired Mantel Connect App. Certificates are pinned by SHA-256 fingerprint: the listener accepts a
-- client certificate only if its fingerprint is here, live. `prev_fp` is the certificate the App replaced
-- when it renewed, good until `prev_until`.
CREATE TABLE IF NOT EXISTS connect_pairings (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    created        REAL NOT NULL,
    created_by     TEXT,
    cert_fp        TEXT NOT NULL,
    cert_expires   REAL NOT NULL,
    prev_fp        TEXT,
    prev_until     REAL,
    last_seen      REAL,
    last_ip        TEXT,
    revoked        REAL,
    revoked_by     TEXT,
    revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS connect_pairings_fp ON connect_pairings (cert_fp);
