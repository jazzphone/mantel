-- P3.2 roles and grants (PLAN §5). Applied once by db.py's numbered-migration runner (P3.1);
-- rbac_store.ensure_schema() applies it to a bare connection in tests. Idempotent on purpose.

-- Stored grants, on top of the roles' default grants (rbac.DEFAULT_ROLES).
-- List columns hold JSON arrays of strings; `schedule` a JSON object or NULL.
CREATE TABLE IF NOT EXISTS rbac_grants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    effect        TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
    actions       TEXT NOT NULL,
    resource_kind TEXT NOT NULL CHECK (resource_kind IN ('entity', 'domain', 'area', 'floor', 'feature', 'all')),
    resource      TEXT NOT NULL DEFAULT '',
    domains       TEXT NOT NULL DEFAULT '[]',
    roles         TEXT NOT NULL DEFAULT '[]',
    users         TEXT NOT NULL DEFAULT '[]',
    devices       TEXT NOT NULL DEFAULT '[]',
    schedule      TEXT,
    note          TEXT NOT NULL DEFAULT '',
    created_at    REAL NOT NULL,
    created_by    TEXT
);

-- A role's override: JSON {"grants": [...], "tunnel_sensitive": bool, ...}; `grants` replaces the
-- role's defaults, switches merge. Deleting the row restores the defaults.
CREATE TABLE IF NOT EXISTS rbac_role_overrides (
    role       TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    updated_at REAL NOT NULL,
    updated_by TEXT
);

-- The areas `@subject` grants mean for a user (a Child's allowed areas, a Guest's rooms) or a
-- device (a wall tablet's room).
CREATE TABLE IF NOT EXISTS rbac_scopes (
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'device')),
    subject_id   TEXT NOT NULL,
    area         TEXT NOT NULL,
    PRIMARY KEY (subject_kind, subject_id, area)
);
