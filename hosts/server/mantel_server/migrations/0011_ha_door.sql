-- The 'ha' door (HA App mode, docs/phase3/HA-APP.md): requests through Home Assistant's sidebar
-- (Ingress) are recorded in the audit as door 'ha'. action_audit's CHECK allowed only lan/tunnel and
-- SQLite cannot change a CHECK in place, so the table is rebuilt with the same columns, the same rows
-- and ids, the same AUTOINCREMENT position, the same indexes and the same two triggers (the 0007
-- retention rule and the 0004 write-once rule). Nothing references action_audit by foreign key.
--
-- Sessions keep their CHECK (lan/tunnel): an Ingress session is stored as door 'tunnel' with method
-- 'ingress' (rebuilding `sessions` would cascade-delete its tokens), and auth_pending is never written
-- for the 'ha' door (password and passkey sign-in are refused through Ingress).

DROP TRIGGER IF EXISTS action_audit_no_delete;
DROP TRIGGER IF EXISTS action_audit_write_once;

CREATE TABLE action_audit_v11 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   REAL NOT NULL,
    actor       TEXT,
    actor_name  TEXT,
    role        TEXT,
    device      TEXT,
    device_role TEXT,
    kind        TEXT NOT NULL CHECK (kind IN ('service', 'ws', 'http', 'ma', 'config', 'system')),
    action      TEXT,
    target      TEXT,
    decision    TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'step_up')),
    reason      TEXT NOT NULL,
    sensitive   TEXT,
    door        TEXT CHECK (door IS NULL OR door IN ('lan', 'tunnel', 'ha')),
    step_up     TEXT,
    step_up_age REAL,
    source_ip   TEXT,
    result      TEXT,
    result_at   REAL
);

INSERT INTO action_audit_v11 (id, timestamp, actor, actor_name, role, device, device_role, kind, action, target,
                              decision, reason, sensitive, door, step_up, step_up_age, source_ip, result, result_at)
SELECT id, timestamp, actor, actor_name, role, device, device_role, kind, action, target,
       decision, reason, sensitive, door, step_up, step_up_age, source_ip, result, result_at
FROM action_audit;

-- keep the AUTOINCREMENT position (ids are never reused, even of purged rows)
INSERT INTO sqlite_sequence (name, seq)
SELECT 'action_audit_v11', seq FROM sqlite_sequence WHERE name = 'action_audit'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'action_audit_v11');
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = 'action_audit')
WHERE name = 'action_audit_v11' AND (SELECT seq FROM sqlite_sequence WHERE name = 'action_audit') > seq;

DROP TABLE action_audit;
ALTER TABLE action_audit_v11 RENAME TO action_audit;

CREATE INDEX action_audit_time ON action_audit (timestamp);
CREATE INDEX action_audit_actor ON action_audit (actor, timestamp);

CREATE TRIGGER action_audit_no_delete BEFORE DELETE ON action_audit
WHEN NOT EXISTS (SELECT 1 FROM audit_purge WHERE id = 1 AND OLD.timestamp < audit_purge.cutoff)
  OR OLD.timestamp >= (julianday('now') - 2440587.5) * 86400.0 - 30 * 86400.0
BEGIN SELECT RAISE(ABORT, 'audit is append-only (only rows older than the retention window, by the maintenance path)'); END;

CREATE TRIGGER action_audit_write_once BEFORE UPDATE ON action_audit
WHEN OLD.result IS NOT NULL OR NEW.result IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.timestamp IS NOT OLD.timestamp OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.role IS NOT OLD.role OR NEW.device IS NOT OLD.device
  OR NEW.device_role IS NOT OLD.device_role OR NEW.kind IS NOT OLD.kind OR NEW.action IS NOT OLD.action
  OR NEW.target IS NOT OLD.target OR NEW.decision IS NOT OLD.decision OR NEW.reason IS NOT OLD.reason
  OR NEW.sensitive IS NOT OLD.sensitive OR NEW.door IS NOT OLD.door OR NEW.step_up IS NOT OLD.step_up
  OR NEW.step_up_age IS NOT OLD.step_up_age OR NEW.source_ip IS NOT OLD.source_ip
BEGIN SELECT RAISE(ABORT, 'audit is append-only (only the result is written, once)'); END;
