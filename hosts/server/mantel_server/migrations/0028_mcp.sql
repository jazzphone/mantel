-- Phase 12: Mantel's MCP server (docs/phase12/MCP-SERVER.md). An assistant acts FOR A PERSON, never as a role of
-- its own: each credential is a `sessions` row of method 'mcp' (so Me → Sessions lists it, Revoke and "sign out
-- everywhere" end it, and a disabled person's assistant stops at once) plus a grant here with the credential's
-- ceiling (its MCP scopes). A personal key (`mmcp_<id>_<secret>`) keeps only its SHA-256, as service accounts do;
-- an assistant that signed in (OAuth 2.1 + PKCE) holds the session's own access and refresh tokens.
CREATE TABLE IF NOT EXISTS mcp_grants (
    id             TEXT PRIMARY KEY,                 -- 16 hex
    kind           TEXT NOT NULL CHECK (kind IN ('key', 'oauth')),
    user_id        TEXT NOT NULL,
    session_id     TEXT NOT NULL UNIQUE,             -- sessions.id (method 'mcp')
    client_id      TEXT,                             -- mcp_clients.client_id (oauth)
    name           TEXT NOT NULL,                    -- the key's name, or the client's
    scopes         TEXT NOT NULL,                    -- JSON list of MCP scopes (the ceiling)
    away           INTEGER NOT NULL DEFAULT 0 CHECK (away IN (0, 1)),   -- may it be used from away (oauth only)
    secret_hash    TEXT UNIQUE,                      -- keys: SHA-256 hex of the whole credential
    created        REAL NOT NULL,
    expires        REAL NOT NULL,
    last_used      REAL,
    last_ip        TEXT,
    revoked        REAL,
    revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS mcp_grants_user ON mcp_grants (user_id, revoked);

-- OAuth clients that registered themselves (RFC 7591): a name and the redirect URIs they may use, nothing secret
-- (public clients, PKCE). A client no grant uses and nobody signed in with for 30 days is forgotten.
CREATE TABLE IF NOT EXISTS mcp_clients (
    client_id      TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    redirect_uris  TEXT NOT NULL,                    -- JSON list
    created        REAL NOT NULL,
    created_ip     TEXT,
    last_used      REAL
);

-- Authorization codes: single use, 60 seconds, bound to the client, the redirect URI, the PKCE challenge and the
-- scopes the person allowed. Only the code's SHA-256 is kept.
CREATE TABLE IF NOT EXISTS mcp_codes (
    code_hash      TEXT PRIMARY KEY,
    client_id      TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,
    challenge      TEXT NOT NULL,
    scopes         TEXT NOT NULL,
    away           INTEGER NOT NULL DEFAULT 0,
    door           TEXT NOT NULL,
    expires        REAL NOT NULL,
    used           REAL
);

-- Who did it THROUGH what: `via` is `mcp:<client name>` when an assistant made the change for the person in
-- `actor` (NULL for everything else). The audit's write-once rule is rebuilt to cover it.
ALTER TABLE action_audit ADD COLUMN via TEXT;
ALTER TABLE settings_history ADD COLUMN via TEXT;

DROP TRIGGER IF EXISTS action_audit_write_once;
CREATE TRIGGER action_audit_write_once BEFORE UPDATE ON action_audit
WHEN OLD.result IS NOT NULL OR NEW.result IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.timestamp IS NOT OLD.timestamp OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.role IS NOT OLD.role OR NEW.device IS NOT OLD.device
  OR NEW.device_role IS NOT OLD.device_role OR NEW.kind IS NOT OLD.kind OR NEW.action IS NOT OLD.action
  OR NEW.target IS NOT OLD.target OR NEW.decision IS NOT OLD.decision OR NEW.reason IS NOT OLD.reason
  OR NEW.sensitive IS NOT OLD.sensitive OR NEW.door IS NOT OLD.door OR NEW.step_up IS NOT OLD.step_up
  OR NEW.step_up_age IS NOT OLD.step_up_age OR NEW.source_ip IS NOT OLD.source_ip OR NEW.via IS NOT OLD.via
BEGIN SELECT RAISE(ABORT, 'audit is append-only (only the result is written, once)'); END;
