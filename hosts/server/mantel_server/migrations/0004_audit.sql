-- P3.3 the command gateway's audit (PLAN §5 "Every control and every denied request goes to the
-- audit log: who, which device, what, result, source IP"). Extends proof 2's dry-run command_audit
-- (kept unchanged for /api/proof2/command) to real actions.
--
-- One row per command, written BEFORE anything is sent (a failed insert refuses the command). The
-- row is append-only: it can never be deleted, and the only change ever allowed is writing `result`
-- (with `result_at`) once, from NULL, after Home Assistant answered. A denied or step-up row is
-- written with result 'not_sent' and so is immutable from the start.
-- Service data is never stored (it can carry an alarm code); only the action and its targets.
CREATE TABLE IF NOT EXISTS action_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   REAL NOT NULL,
    actor       TEXT,                 -- user id; 'mantel' for the server's own notifications; NULL: a device alone
    actor_name  TEXT,
    role        TEXT,                 -- the user's role at the time
    device      TEXT,                 -- device id (wall tablet), or NULL
    device_role TEXT,
    kind        TEXT NOT NULL CHECK (kind IN ('service', 'ws', 'http', 'ma', 'config', 'system')),
    action      TEXT,                 -- light.turn_on | a WS write type | "POST /api/..." | an MA command | rbac.grant.add
    target      TEXT,                 -- JSON list of entity ids / "feature:<name>"
    decision    TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'step_up')),
    reason      TEXT NOT NULL,        -- rbac reason (granted, no_grant, explicit_deny, step_up_required, ...) or gateway reason
    sensitive   TEXT,                 -- the sensitive kind (lock, alarm_control_panel, ...) or NULL
    door        TEXT CHECK (door IS NULL OR door IN ('lan', 'tunnel')),
    step_up     TEXT,                 -- the fresh factor a sensitive action was allowed on (totp, passkey, ...)
    step_up_age REAL,                 -- seconds since that factor
    source_ip   TEXT,
    result      TEXT,                 -- NULL until known; 'ok' | 'error:<code>' | 'not_sent'
    result_at   REAL
);
CREATE INDEX IF NOT EXISTS action_audit_time ON action_audit (timestamp);
CREATE INDEX IF NOT EXISTS action_audit_actor ON action_audit (actor, timestamp);

CREATE TRIGGER IF NOT EXISTS action_audit_no_delete BEFORE DELETE ON action_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

CREATE TRIGGER IF NOT EXISTS action_audit_write_once BEFORE UPDATE ON action_audit
WHEN OLD.result IS NOT NULL OR NEW.result IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.timestamp IS NOT OLD.timestamp OR NEW.actor IS NOT OLD.actor
  OR NEW.actor_name IS NOT OLD.actor_name OR NEW.role IS NOT OLD.role OR NEW.device IS NOT OLD.device
  OR NEW.device_role IS NOT OLD.device_role OR NEW.kind IS NOT OLD.kind OR NEW.action IS NOT OLD.action
  OR NEW.target IS NOT OLD.target OR NEW.decision IS NOT OLD.decision OR NEW.reason IS NOT OLD.reason
  OR NEW.sensitive IS NOT OLD.sensitive OR NEW.door IS NOT OLD.door OR NEW.step_up IS NOT OLD.step_up
  OR NEW.step_up_age IS NOT OLD.step_up_age OR NEW.source_ip IS NOT OLD.source_ip
BEGIN SELECT RAISE(ABORT, 'audit is append-only (only the result is written, once)'); END;
