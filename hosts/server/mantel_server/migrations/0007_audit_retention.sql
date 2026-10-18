-- The audit's retention window (PLAN §7 "audit log append-only with a retention window").
--
-- action_audit stays append-only for every row inside the window. The only way a row ever leaves is
-- the maintenance path in gateway.Audit.purge: inside ONE transaction it writes the permit below
-- (audit_purge, at most one row, holding the cutoff), deletes rows older than the cutoff, removes the
-- permit, and records what it did (audit_maintenance, itself append-only, plus a 'system' row in
-- action_audit). The DELETE trigger allows exactly that:
--   * a permit must exist and the row must be older than its cutoff, AND
--   * the row must be older than 30 days by the database's own clock, whatever the permit says
--     (the shortest window the server accepts), so a wrong cutoff can never reach recent rows.
-- The UPDATE rule (only `result`, once, from NULL) is unchanged.

CREATE TABLE audit_purge (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    cutoff  REAL NOT NULL,
    started REAL NOT NULL
);

CREATE TABLE audit_maintenance (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      REAL NOT NULL,
    action         TEXT NOT NULL CHECK (action IN ('purge')),
    cutoff         REAL NOT NULL,
    retention_days REAL NOT NULL,
    deleted        INTEGER NOT NULL,
    first_id       INTEGER,
    last_id        INTEGER
);
CREATE TRIGGER audit_maintenance_no_update BEFORE UPDATE ON audit_maintenance
BEGIN SELECT RAISE(ABORT, 'audit maintenance log is append-only'); END;
CREATE TRIGGER audit_maintenance_no_delete BEFORE DELETE ON audit_maintenance
BEGIN SELECT RAISE(ABORT, 'audit maintenance log is append-only'); END;

DROP TRIGGER IF EXISTS action_audit_no_delete;
CREATE TRIGGER action_audit_no_delete BEFORE DELETE ON action_audit
WHEN NOT EXISTS (SELECT 1 FROM audit_purge WHERE id = 1 AND OLD.timestamp < audit_purge.cutoff)
  OR OLD.timestamp >= (julianday('now') - 2440587.5) * 86400.0 - 30 * 86400.0
BEGIN SELECT RAISE(ABORT, 'audit is append-only (only rows older than the retention window, by the maintenance path)'); END;
