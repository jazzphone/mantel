-- Phase 5: Service accounts (PLAN §5 "Service": machine accounts scoped to the endpoints they need).
-- The first user is HA's hk_frontend integration in linked mode (scope "linked"). A service account is
-- not a person: it has no password, no session, no role grants; only a bearer credential and the list
-- of endpoints it may open. Only the SHA-256 of the credential is stored (it is 256 random bits, so a
-- fast hash is enough, as for session tokens). No BEGIN/COMMIT: the runner owns the transaction.
CREATE TABLE IF NOT EXISTS service_accounts (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    scopes         TEXT NOT NULL,          -- JSON list of endpoint names, e.g. ["linked"]
    secret_hash    TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the whole credential
    created        REAL NOT NULL,
    created_by     TEXT,                   -- users.id of the Owner who made it, NULL from the CLI
    last_used      REAL,
    last_ip        TEXT,
    revoked        REAL,
    revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS service_accounts_live ON service_accounts (revoked);
