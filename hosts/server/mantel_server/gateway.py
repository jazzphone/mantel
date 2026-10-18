"""The command gateway (PLAN §4 "Command gateway", §5, §7): the only way anything Mantel's clients
ask for reaches Home Assistant (or Music Assistant) as a change.

Off unless the server's operator sets ``cfg.commands_enabled`` (config / ``--commands-enabled``);
no client message can turn it on. While off, ``build_app`` does not create a Gateway, the command
path in ``ha_client`` cannot be constructed, and every command answers ``commands_disabled``.

Client protocol (on the hub socket, /ws):

  <- {"type": "capabilities", "commands": true, "step_up_window": 300, "door": "lan"}   (only when on)
  -> {"type": "command", "id": 7, "kind": "service", "domain": "light", "service": "turn_on",
      "target": {"entity_id": "light.kitchen"}, "data": {...}, "return_response": false}
  -> {"type": "command", "id": 8, "kind": "ws", "msg": {"type": "config/entity_registry/update", ...}}
  -> {"type": "command", "id": 9, "kind": "http", "method": "POST", "path": "/api/...", "body": {...}}
  -> {"type": "command", "id": 10, "kind": "ma", "command": "player_queues/play", "args": {...}}
  -> {"type": "command", "id": 11, "kind": "http", "method": "POST",
      "path": "/api/hk_frontend/talk?entity_id=media_player.door_speaker",
      "content_type": "audio/webm", "body_b64": "<the clip>"}     (the ONE binary upload: talk_command)
  -> {"type": "command", "id": 12, "kind": "talk_live", "speaker": "media_player.door_speaker"}
  <- {"type": "command_result", "id": 12, "result": {"ticket": "<one-time>", "expires_in": 10}, "audit_id": 44}
                                          (LIVE TALK: the ticket opens ONE stream on /ws/talk, talk_relay.py;
                                           the row's result is written when the stream ends)
  <- {"type": "command_result", "id": 7, "result": ..., "audit_id": 41}
  <- {"type": "command_result", "id": 7, "error": {"code": "forbidden", "reason": "no_grant"}, "audit_id": 42}
  <- {"type": "step_up_required", "id": 7, "reason": "step_up_required", "methods": ["totp"],
      "window": 300, "audit_id": 43}      -> the page proves a fresh factor (POST /api/auth/totp/step-up
                                             or a passkey verify) and sends the same command again
  <- {"type": "step_up_required", ..., "reason": "person_pin_required", "methods": ["pin"]}   (a wall tablet)
  -> the same command plus "step_up": {"method": "pin", "pin": "2580"}: the PIN names the person
     (pins.py) and the command is decided ONCE as person ∩ tablet; the audit row names that person.
     A wrong PIN answers step_up_required with "pin_error": "invalid_pin" | "locked" (+ retry_after)
     | "ambiguous". On a person's own session a PIN is their step-up factor (methods include "pin").
     The PIN is never forwarded, stored or logged.

The audit can be read by Owners/Admins (GET /api/audit, filtered and paginated) and keeps a
retention window (cfg.audit_retention_days, default 365): Audit.purge is the only path that deletes,
only rows older than the window, and it logs what it deleted (migration 0007).

Each command, in order: resolve the subject from the session (re-read from the database, so a
step-up or a revocation counts at once) -> classify it (a service; a WebSocket write from
``hkClient.WRITES``, exported to ``hk_writes.json``; an HTTP write; an MA command) -> ``Policy.decide``
for every target -> step-up if needed -> the audit row FIRST (``action_audit``, migration 0004; if it
cannot be written the command is refused and nothing is sent) -> forward with a one-shot ticket bound
to that row -> the result back to the client and into the row. A remote (tunnel) unlock or disarm
also notifies the Owners (an HA persistent notification).

THE ALARM KEYPAD (alarm_pin.py; docs/phase3/GATEWAY.md "The alarm"): an ``alarm_control_panel.alarm_*``
command's ``code`` is taken out in ``service_command``, checked by Mantel (``Gateway._alarm``: the house's
Alarm PIN or a person's PIN), and never audited, logged or forwarded; the alarm's own HA code, if its
panel asks for one, comes from Mantel's store.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field
from importlib.resources import files
from typing import Any, Awaitable, Callable, Iterable

from aiohttp import web

from . import alarm_pin, rbac
from .authz import ENTITY_ID, Authz, Principal
from .ha_client import (TALK_ENTITY, TALK_LIVE_TYPE, CommandBlocked, CommandTicket, HaCommandError, HaCommander,
                        HTTP_METHODS, UPLOAD_MAX_BYTES, UPLOAD_METHOD, UPLOAD_MIN_BYTES, UPLOAD_TYPES, _API_PATH,
                        talk_target, upload_type)

log = logging.getLogger("mantel.gateway")

KINDS = ("service", "ws", "http", "ma", "talk_live")
KEYS = {
    "service": frozenset({"type", "id", "kind", "domain", "service", "data", "target", "return_response"}),
    "ws": frozenset({"type", "id", "kind", "msg"}),
    "http": frozenset({"type", "id", "kind", "method", "path", "body", "content_type", "body_b64"}),
    "ma": frozenset({"type", "id", "kind", "command", "args"}),
    "talk_live": frozenset({"type", "id", "kind", "speaker"}),
}
# the audit's kind for each client kind (live talk is a Home Assistant WebSocket subscription)
AUDIT_KIND = {"talk_live": "ws"}
TARGET_KEYS = frozenset({"entity_id", "area_id", "device_id", "floor_id", "label_id"})
NON_ENTITY_TARGETS = TARGET_KEYS - {"entity_id"}
_NAME = re.compile(r"^[a-z0-9_]+$")
# Services that act on no entity, decided as a feature; any other entity-less service is
# `configure` on `settings` (Owner/Admin), so an Adult's "control everything" never reaches
# homeassistant.restart, recorder.purge and the like.
FEATURE_SERVICES = {"notify": "notifications", "persistent_notification": "notifications"}
SCRIPT_MANAGEMENT = frozenset({"turn_on", "turn_off", "toggle", "reload"})
# Remote (tunnel) actions that notify the Owners (PLAN §7: "an Owner notification on every remote
# unlock/disarm"): the sensitive kinds of locks and alarm panels.
NOTIFY_KINDS = frozenset({"lock", "alarm_control_panel"})
# Doors that may be remote: the tunnel, and HA's sidebar through Ingress ('ha', HA App mode), which
# may itself come through HA's own remote access (docs/phase3/HA-APP.md).
REMOTE_DOORS = frozenset({"tunnel", "ha"})
# The shortest audit retention window the server accepts (migration 0007's trigger refuses to delete
# anything younger, whatever the maintenance path is told).
MIN_RETENTION_DAYS = 30


def load_writes() -> frozenset[str]:
    """hkClient.WRITES, as tools/export_writes.py exported it (tests pin that it matches hk-client.js)."""
    data = json.loads(files("mantel_server").joinpath("hk_writes.json").read_text())
    return frozenset(data["writes"])


# -- classification ------------------------------------------------------------------------------
class Refused(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class Check:
    """One RBAC question: `action` on an entity, or on a feature."""
    action: str
    entity_id: str | None = None
    feature: str | None = None
    talk: bool = False                      # decided with the talk-back policy (authz.talk_policy)

    @property
    def target(self) -> str:
        return self.entity_id or f"feature:{self.feature}"


@dataclass
class Command:
    kind: str                               # service | ws | http | ma
    action: str                             # light.turn_on | ws type | "POST /api/x" | MA command
    checks: list[Check]
    frame: dict | None = None               # the WebSocket frame for HA (service / ws)
    http: tuple[str, str, Any] | None = None  # (method, path, body)
    ma: tuple[str, dict] | None = None      # (command, args)
    targets: list[str] = field(default_factory=list)
    upload: tuple[str, str, bytes] | None = None  # (path, bare content type, bytes): the talk-back clip only
    live: str | None = None                 # live talk: the speaker a /ws/talk ticket is issued for
    alarm: tuple[str, str] | None = None    # an alarm keypad command: (service, the panel it names)
    code: str | None = field(default=None, repr=False)  # the keypad's code: checked by Mantel, never sent


def _entity_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [v.strip() for v in value.split(",") if v.strip()]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise Refused("invalid_command", "entity_id must be a string or a list of strings")
    for v in value:
        if v == "all" or not ENTITY_ID.match(v):
            raise Refused("unsupported_target", f"not a single entity: {v!r}")
    return value


def service_command(domain: Any, service: Any, data: Any, target: Any, return_response: Any = False) -> Command:
    if not isinstance(domain, str) or not isinstance(service, str) or not _NAME.match(domain) or not _NAME.match(service):
        raise Refused("invalid_command", "domain and service are plain names")
    data = {} if data is None else data
    target = {} if target is None else target
    if not isinstance(data, dict) or not isinstance(target, dict):
        raise Refused("invalid_command", "data and target are objects")
    if set(target) - TARGET_KEYS:
        raise Refused("invalid_command", f"target carries {sorted(TARGET_KEYS)} only")
    if not isinstance(return_response, bool):
        raise Refused("invalid_command", "return_response is true or false")
    for src in (target, data):
        # fail closed: an area/device/floor/label target would expand inside HA to entities we never checked
        if any(src.get(k) not in (None, [], "") for k in NON_ENTITY_TARGETS):
            raise Refused("unsupported_target", "only entity targets are accepted (area/device/floor/label are not)")
    ids = list(dict.fromkeys(_entity_list(target.get("entity_id")) + _entity_list(data.get("entity_id"))))
    action = f"{domain}.{service}"
    alarm, code = None, None
    if alarm_pin.is_keypad(domain, service):
        # THE ALARM KEYPAD (alarm_pin.py, GATEWAY.md "The alarm"): the code the person typed is taken out
        # HERE, before anything is audited or sent; Mantel checks it and never forwards it.
        if set(data) - {"entity_id", "code"} or set(target) - {"entity_id"}:
            raise Refused("invalid_command", "an alarm command carries entity_id and code only")
        if len(ids) != 1 or not ids[0].startswith(alarm_pin.DOMAIN + "."):
            raise Refused("unsupported_target", "an alarm command names exactly one alarm panel")
        code = data.get("code")
        if code is not None and not isinstance(code, str):
            raise Refused("invalid_command", "the code is text")
        code = code or None
        data = {k: v for k, v in data.items() if k != "code"}
        alarm = (service, ids[0])
    if ids:
        checks = [Check(action, eid) for eid in ids]
    elif domain in FEATURE_SERVICES:
        checks = [Check(action, feature=FEATURE_SERVICES[domain])]
    elif domain == "script" and service not in SCRIPT_MANAGEMENT:
        ids = [f"script.{service}"]                       # script.<name>: running that script
        checks = [Check(action, ids[0])]
    else:
        checks = [Check("configure", feature="settings")]
    frame: dict = {"type": "call_service", "domain": domain, "service": service}
    if data:
        frame["service_data"] = data
    if target:
        frame["target"] = target
    if return_response:
        frame["return_response"] = True
    return Command("service", action, checks, frame=frame, targets=ids or [c.target for c in checks],
                   alarm=alarm, code=code)


def ws_rule(kind: str) -> tuple[str, str]:
    """(RBAC action, "entity:<key>" | "feature:<name>") for a WebSocket write from the catalog.

    Explicit for what acts on an entity or a non-settings feature; every other write (HK's settings,
    boards, dashboards, tablets, registries) is `configure` on `settings`, so only Owner/Admin by
    default. P3.5 moves HK's own settings into Mantel; until then they are forwarded to HA's hk_frontend.
    """
    if kind.startswith("calendar/event/"):
        return "control", "entity:entity_id"
    if kind == "config/entity_registry/update":
        return "configure", "entity:entity_id"
    if kind == "frontend/set_user_data":
        return "configure", "feature:profile"
    if kind.endswith("/settings/set"):
        return "configure", "feature:settings"
    if kind.startswith("hk_music/"):
        return "control", "feature:music"
    if kind.startswith("hk_notify/"):
        return "configure", "feature:notifications"
    if kind.startswith("hk_energy/"):
        return "configure", "feature:energy"
    return "configure", "feature:settings"


# DOORBELL TALK-BACK (docs/phase3/GATEWAY.md "Doorbell talk-back"). The one HTTP write that carries
# bytes: the recorded clip HK's doorbell sheet POSTs to hk_frontend's talk view, which has the
# speaker play it (media_player.play_media). Two checks, both must pass:
#   * `media_player.play_media` on the speaker: what HA will do with it (RBAC `control` on that entity);
#   * `camera.talk` on feature `cameras`: talking at the door is part of the doorbell, so it follows
#     the camera rules: sensitive kind `camera`, so on the LAN door no step-up (as live view,
#     authz.LAN_STEP_UP_EXEMPT) and wall tablets may (authz.HOUSE_GRANTS); on the tunnel (and the `ha`
#     door under tunnel rules) the role's `tunnel_sensitive` and `tunnel_cameras` switches plus a
#     fresh factor; a Child or Guest (cameras denied) never.
TALK_ACTION = "camera.talk"
_B64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")
_B64_MAX = 4 * ((UPLOAD_MAX_BYTES + 2) // 3)


def talk_checks(speaker: str) -> list[Check]:
    """The two talk-back checks (clip and live alike), decided with the talk-back policy, so a wall
    tablet may talk on the doorbell's speaker from HK's pop-up settings (authz.TALK_ROLES)."""
    return [Check("media_player.play_media", speaker, talk=True), Check(TALK_ACTION, feature="cameras", talk=True)]


def talk_live_command(msg: dict) -> Command:
    """LIVE TALK (docs/phase3/GATEWAY.md "Doorbell talk-back"): the same two checks as the clip; what
    is forwarded is a one-time ticket for ONE stream on /ws/talk (talk_relay.py), not a frame."""
    speaker = msg.get("speaker")
    if not isinstance(speaker, str) or not TALK_ENTITY.match(speaker):
        raise Refused("unsupported_target", "live talk is for one media_player entity (the doorbell's speaker)")
    checks = talk_checks(speaker)
    return Command("ws", TALK_LIVE_TYPE, checks, live=speaker, targets=[c.target for c in checks])


def talk_command(method: Any, path: str, msg: dict) -> Command:
    import base64
    speaker = talk_target(path)
    if method != UPLOAD_METHOD or speaker is None:
        raise Refused("unsupported_body", "a binary body goes only to POST /api/hk_frontend/talk?entity_id=media_player.<name>")
    if msg.get("body") is not None:
        raise Refused("invalid_command", "an upload carries body_b64, not body")
    ctype = upload_type(msg.get("content_type"))
    if ctype is None:
        raise Refused("unsupported_body", f"the clip is one of {sorted(UPLOAD_TYPES)}")
    raw = msg.get("body_b64")
    if not isinstance(raw, str) or not _B64.match(raw) or len(raw) % 4:
        raise Refused("unsupported_body", "body_b64 is the clip in base64")
    if len(raw) > _B64_MAX:
        raise Refused("body_too_large", f"the clip is at most {UPLOAD_MAX_BYTES} bytes")
    body = base64.b64decode(raw, validate=True)
    if len(body) > UPLOAD_MAX_BYTES:
        raise Refused("body_too_large", f"the clip is at most {UPLOAD_MAX_BYTES} bytes")
    if len(body) < UPLOAD_MIN_BYTES:
        raise Refused("unsupported_body", "the clip is empty")
    checks = talk_checks(speaker)
    return Command("http", f"{UPLOAD_METHOD} {path.split('?', 1)[0]}", checks, upload=(path, ctype, body),
                   targets=[c.target for c in checks])


def classify(msg: dict, writes: frozenset[str]) -> Command:
    """A client `command` message -> Command, or Refused. Pure: no I/O."""
    kind = msg.get("kind")
    if kind not in KINDS:
        raise Refused("invalid_command", f"kind is one of {KINDS}")
    if set(msg) - KEYS[kind]:
        raise Refused("invalid_command", f"a {kind} command carries {sorted(KEYS[kind])} only")
    if kind == "talk_live":
        return talk_live_command(msg)
    if kind == "service":
        return service_command(msg.get("domain"), msg.get("service"), msg.get("data"), msg.get("target"),
                               msg.get("return_response", False))
    if kind == "ws":
        inner = msg.get("msg")
        if not isinstance(inner, dict) or not isinstance(inner.get("type"), str):
            raise Refused("invalid_command", "msg is a WebSocket message with a type")
        t = inner["type"]
        if t not in writes:
            raise Refused("not_a_write", f"{t!r} is not a write (hkClient.WRITES); reads go through `read`")
        if t == TALK_LIVE_TYPE:
            raise Refused("unsupported_command", "live talk is the talk_live command and its own socket (/ws/talk)")
        if t == "call_service":
            extra = set(inner) - {"type", "id", "domain", "service", "service_data", "target", "return_response"}
            if extra:
                raise Refused("invalid_command", f"call_service may not carry {sorted(extra)}")
            return service_command(inner.get("domain"), inner.get("service"), inner.get("service_data"),
                                   inner.get("target"), inner.get("return_response", False))
        action, on = ws_rule(t)
        what, name = on.split(":", 1)
        if what == "entity":
            eid = inner.get(name)
            if not isinstance(eid, str) or not ENTITY_ID.match(eid):
                raise Refused("invalid_command", f"{t!r} needs a single entity in {name!r}")
            checks = [Check(action, eid)]
        else:
            checks = [Check(action, feature=name)]
        frame = {k: v for k, v in inner.items() if k != "id"}
        return Command("ws", t, checks, frame=frame, targets=[c.target for c in checks])
    if kind == "http":
        method = msg.get("method")
        method = method.upper() if isinstance(method, str) else method
        path, body = msg.get("path"), msg.get("body")
        if method == "GET":
            raise Refused("not_a_write", "GET is a read; use `read_api`")
        if method not in HTTP_METHODS:
            raise Refused("invalid_command", f"method is one of {sorted(HTTP_METHODS)}")
        if not isinstance(path, str) or not _API_PATH.match(path) or ".." in path or "//" in path:
            raise Refused("invalid_command", "path is a plain /api/... path")
        if "body_b64" in msg or "content_type" in msg:
            return talk_command(method, path, msg)
        if path.split("?", 1)[0].startswith("/api/hk_frontend/talk"):
            raise Refused("unsupported_body", "the talk-back clip is audio (body_b64 + content_type)")
        if body is not None and not isinstance(body, (dict, list)):
            raise Refused("unsupported_body", "the body is JSON (an object or a list)")
        seg = path.split("?", 1)[0].split("/")
        if method == "POST" and len(seg) == 5 and seg[2] == "services":
            cmd = service_command(seg[3], seg[4], body if isinstance(body, dict) else {}, None)
            if cmd.alarm is not None:     # its code already taken out; the keypad path is the service command
                raise Refused("unsupported_command", "an alarm is armed or disarmed with a service command")
            checks = cmd.checks
        else:
            checks = [Check("configure", feature="settings")]
        return Command("http", f"{method} {path.split('?', 1)[0]}", checks, http=(method, path, body),
                       targets=[c.target for c in checks])
    # kind == "ma"
    from .connectors.ma import MA_COMMANDS
    command, args = msg.get("command"), msg.get("args") or {}
    if command not in MA_COMMANDS:
        raise Refused("invalid_command", "not a Music Assistant command (connectors/ma.py MA_COMMANDS)")
    if not isinstance(args, dict) or set(args) - MA_COMMANDS[command]:
        raise Refused("invalid_command", f"{command} carries {sorted(MA_COMMANDS[command])} only")
    return Command("ma", command, [Check("control", feature="music")], ma=(command, args), targets=["feature:music"])


# -- the audit -----------------------------------------------------------------------------------
class Audit:
    """``action_audit`` (migration 0004): one row per command, written before anything is sent;
    afterwards only its `result` may be written, once. Errors propagate: no row, no command."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = conn
        self.clock = clock

    def record(self, *, principal: Principal | None, kind: str, action: str | None, targets: Iterable[str],
               decision: str, reason: str, sensitive: str | None = None, step_up: str | None = None,
               step_up_age: float | None = None, result: str | None = None, actor: str | None = None,
               actor_name: str | None = None) -> int:
        ident = principal.identity if principal is not None else None
        u = ident.user if ident is not None else None
        d = ident.device if ident is not None else None
        with self.db:
            cur = self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, actor_name, role, device, device_role, kind, action, target, "
                "decision, reason, sensitive, door, step_up, step_up_age, source_ip, result, result_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.clock(), actor or (u.id if u else None), actor_name or (u.name if u else None),
                 u.role if u else None, d.id if d else None, d.role if d else None, kind,
                 (action or "")[:200] or None, json.dumps(list(targets))[:2000], decision, reason, sensitive,
                 ident.door if ident is not None else None, step_up, step_up_age,
                 principal.source_ip if principal is not None else None,
                 result, self.clock() if result is not None else None))
        return int(cur.lastrowid)

    def finish(self, audit_id: int, result: str) -> None:
        with self.db:
            self.db.execute("UPDATE action_audit SET result = ?, result_at = ? WHERE id = ? AND result IS NULL",
                            (result[:200], self.clock(), audit_id))

    def config_event(self, event: dict) -> None:
        """rbac_store's audit hook: grant/role/scope changes (before they are applied)."""
        with self.db:
            self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, role, kind, action, target, decision, reason) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (event.get("timestamp") or self.clock(), event.get("actor"), event.get("role"), "config",
                 str(event.get("action"))[:200], json.dumps(event.get("detail"), default=str)[:2000],
                 "allowed", "owner"))

    def rows(self, **where) -> list[dict]:
        sql = "SELECT * FROM action_audit"
        if where:
            sql += " WHERE " + " AND ".join(f"{k} = ?" for k in where)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY id", tuple(where.values()))]

    # -- reading (GET /api/audit) -----------------------------------------------------------------
    def query(self, *, actor: str | None = None, device: str | None = None, decision: str | None = None,
              kind: str | None = None, since: float | None = None, until: float | None = None,
              before: int | None = None, limit: int = 100) -> tuple[list[dict], int | None]:
        """Rows newest first, filtered; `before` is the id cursor of the next page (None at the end)."""
        where, args = [], []
        for col, value in (("actor", actor), ("device", device), ("decision", decision), ("kind", kind)):
            if value is not None:
                where.append(f"{col} = ?")
                args.append(value)
        if since is not None:
            where.append("timestamp >= ?")
            args.append(since)
        if until is not None:
            where.append("timestamp < ?")
            args.append(until)
        if before is not None:
            where.append("id < ?")
            args.append(before)
        sql = "SELECT * FROM action_audit" + (" WHERE " + " AND ".join(where) if where else "")
        got = [dict(r) for r in self.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit + 1))]
        more = len(got) > limit
        got = got[:limit]
        for r in got:
            try:
                r["target"] = json.loads(r["target"]) if r["target"] else []
            except ValueError:
                pass
        return got, (got[-1]["id"] if more and got else None)

    # -- retention (PLAN §7: "append-only with a retention window") ------------------------------------
    PURGE_EVERY = 3600.0

    def purge(self, retention_days: float) -> int:
        """THE maintenance path (migration 0007): delete rows older than the window, in one transaction
        with the permit the DELETE trigger asks for, and log it (audit_maintenance + a 'system' row).
        Rows inside the window can never be deleted (the trigger refuses, and also refuses anything
        younger than 30 days by the database's own clock)."""
        if not isinstance(retention_days, (int, float)) or retention_days < MIN_RETENTION_DAYS:
            raise ValueError(f"the audit retention window is at least {MIN_RETENTION_DAYS} days")
        now = self.clock()
        cutoff = now - float(retention_days) * 86400.0
        with self.db:
            span = self.db.execute("SELECT COUNT(*) AS n, MIN(id) AS first, MAX(id) AS last FROM action_audit "
                                   "WHERE timestamp < ?", (cutoff,)).fetchone()
            if not span["n"]:
                return 0
            self.db.execute("INSERT INTO audit_purge (id, cutoff, started) VALUES (1, ?, ?)", (cutoff, now))
            deleted = self.db.execute("DELETE FROM action_audit WHERE timestamp < ?", (cutoff,)).rowcount
            self.db.execute("DELETE FROM audit_purge WHERE id = 1")
            self.db.execute("INSERT INTO audit_maintenance (timestamp, action, cutoff, retention_days, deleted, "
                            "first_id, last_id) VALUES (?, 'purge', ?, ?, ?, ?, ?)",
                            (now, cutoff, float(retention_days), deleted, span["first"], span["last"]))
            self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, actor_name, kind, action, target, decision, reason, "
                "result, result_at) VALUES (?, 'mantel', 'Mantel Server', 'system', 'audit.purge', ?, 'allowed', ?, 'ok', ?)",
                (now, json.dumps(["feature:audit"]), f"retention:{retention_days:g}d deleted:{deleted} "
                 f"ids:{span['first']}-{span['last']}", now))
        log.info("audit retention: deleted %d rows older than %g days (ids %s-%s)", deleted, retention_days,
                 span["first"], span["last"])
        return deleted

    def maybe_purge(self, retention_days: float) -> int:
        """The policy tick's call: at most once an hour."""
        now = self.clock()
        last = getattr(self, "_last_purge", None)
        if last is not None and now - last < self.PURGE_EVERY:
            return 0
        self._last_purge = now
        return self.purge(retention_days)


# -- the gateway ---------------------------------------------------------------------------------
class Gateway:
    def __init__(self, app, authz: Authz, audit: Audit, commander: HaCommander | None,
                 writes: frozenset[str], clock: Callable[[], float] = time.time) -> None:
        self.app = app
        self.authz = authz
        self.audit = audit
        self.commander = commander
        self.writes = writes
        self.clock = clock
        self._ma_tickets: dict[int, list[tuple[str, str, CommandTicket]]] = {}

    def capabilities(self, principal: Principal | None) -> dict:
        return {"type": "capabilities", "commands": bool(principal is not None and principal.valid),
                "step_up_window": rbac.STEP_UP_WINDOW,
                "door": principal.identity.door if principal is not None else None}

    # The Music Assistant command gate (connectors.Hooks.ma_gate): an MA command is allowed only
    # with the one-shot ticket this gateway minted for exactly that principal, command and args.
    def allow(self, identity: Any, command: str, args: dict) -> bool:
        queue = self._ma_tickets.get(id(identity)) or []
        key = json.dumps(args, sort_keys=True, default=str)
        for i, (c, a, ticket) in enumerate(queue):
            if c == command and a == key and not ticket.used and ticket.audit_id > 0:
                ticket.used = True
                del queue[i]
                return True
        return False

    def _methods(self, principal: Principal) -> list[str]:
        u = principal.user
        acc, pins = self.app.get("accounts"), self.app.get("pins")
        if u is None:
            # a device alone: a person's PIN typed at it (if anyone has one; else nobody here can answer)
            return ["pin"] if principal.device is not None and pins is not None and pins.any_pin() else []
        methods = []
        if acc is not None and acc.has_totp(u.id):
            methods.append("totp")
        if acc is not None and acc.has_passkey(u.id):
            methods.append("passkey")
        if pins is not None and pins.has_pin(u.id):
            methods.append("pin")
        return methods

    async def _step_up(self, principal: Principal, step: Any, cmd: Command, reply, fail) -> Principal | None:
        """A PIN sent with the command (``"step_up": {"method": "pin", "pin": "..."}``). At a wall tablet
        (a device alone) the PIN names the person and the command is decided as person ∩ tablet; on a
        person's own session it is their step-up factor. None (already answered) when refused."""
        pins = self.app.get("pins")
        if (not isinstance(step, dict) or set(step) != {"method", "pin"} or step.get("method") != "pin"
                or not isinstance(step.get("pin"), str) or pins is None):
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason="invalid_step_up", result="not_sent")
            await reply(fail("invalid_command", 'step_up is {"method": "pin", "pin": "<digits>"}', aid))
            return None
        pin = step["pin"]
        if principal.user is None and principal.device is not None:
            status, value = await pins.identify(pin, device_id=principal.device.id, ip=principal.source_ip)
            if status == "ok":
                person = self.authz.with_person(principal, value)  # type: ignore[arg-type]
                log.info("%s confirmed %s by PIN", _who(person), cmd.action)
                return person
            reason = "person_pin_required"
        elif principal.user is not None:
            status, value = await pins.verify_user(principal.user.id, pin, ip=principal.source_ip)
            if status == "ok":
                mgr = self.app.get("sessions")
                if mgr is not None and principal.identity.session_id is not None:
                    mgr.mark_fresh(principal.identity.session_id, "pin")
                    self.authz.refresh(principal)
                return principal
            reason = "step_up_required"
        else:
            status, value, reason = "invalid", 0.0, "no_subject"
        code = {"invalid": "invalid_pin", "no_pin": "invalid_pin"}.get(status, status)
        aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                decision="denied", reason="pin_invalid" if code == "invalid_pin" else f"pin_{code}",
                                result="not_sent")
        await reply({"type": "step_up_required", "reason": reason, "pin_error": code,
                     "retry_after": int(value) + 1 if code == "locked" else 0,  # type: ignore[arg-type]
                     "action": cmd.action, "targets": cmd.targets, "methods": self._methods(principal),
                     "window": self.authz.policy_for(principal.subject).step_up_window, "audit_id": aid})
        return None

    async def handle(self, principal: Principal, msg: dict, send: Callable[[dict], Awaitable[None]]) -> None:
        """One `command` message, answered through `send`. Never raises for the client's mistakes."""
        rid = msg.get("id")

        async def reply(body: dict) -> None:
            await send({"id": rid, **body})

        def fail(code: str, message: str = "", audit_id: int | None = None, **extra) -> dict:
            err = {"code": code, **({"message": message} if message else {}), **extra}
            return {"type": "command_result", "error": err, **({"audit_id": audit_id} if audit_id else {})}

        try:
            await self._handle(principal, msg, reply, fail)
        except sqlite3.Error:
            log.exception("audit write failed; command refused, nothing sent")
            await reply(fail("audit_unavailable", "the audit log could not be written; nothing was sent"))

    async def _handle(self, principal: Principal, msg: dict, reply, fail) -> None:
        msg = dict(msg)
        step = msg.pop("step_up", None)          # a PIN for this one command; never forwarded or stored
        if not self.authz.refresh(principal):
            self.audit.record(principal=principal, kind=_kind(msg), action=None, targets=[], decision="denied",
                              reason="unauthenticated", result="not_sent")
            return await reply(fail("unauthenticated", "the session or device is no longer valid"))
        try:
            cmd = classify(msg, self.writes)
        except Refused as exc:
            aid = self.audit.record(principal=principal, kind=_kind(msg), action=_action(msg), targets=[],
                                    decision="denied", reason=exc.code, result="not_sent")
            return await reply(fail(exc.code, str(exc), aid))
        if step is not None and cmd.live is not None:
            # a ticket is bound to this connection's own identity; a PIN-named person is not it
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason="invalid_step_up", result="not_sent")
            return await reply(fail("invalid_command", "live talk takes no step_up; the clip asks for one", aid))
        if step is not None:
            stepped = await self._step_up(principal, step, cmd, reply, fail)
            if stepped is None:
                return
            principal = stepped
        if cmd.alarm is not None:
            keypad = self.app.get("alarm_pin")
            if keypad is not None and (cmd.code is not None or keypad.entry(cmd.alarm[1]) is not None):
                return await self._alarm(principal, cmd, keypad, reply, fail)
            if cmd.code is not None:
                # no keypad engine to check it: a page's code is never forwarded to Home Assistant
                aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                        decision="denied", reason="alarm_pin_unavailable", result="not_sent")
                return await reply(fail("unavailable", "alarm_pin_unavailable", aid))
            # an alarm Mantel guards no keypad for, and no code: the ordinary path below

        subject = principal.subject
        ctx = self.authz.context()
        decisions = [(c, (self.authz.decide_talk if c.talk else self.authz.decide)(
                          subject, c.action, c.entity_id, feature=c.feature, ctx=ctx)) for c in cmd.checks]
        denied = next(((c, d) for c, d in decisions if not d.allowed and not d.needs_step_up), None)
        sensitive = next((d.sensitive for _, d in decisions if d.sensitive), None)
        if denied is not None:
            c, d = denied
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason=d.reason, sensitive=sensitive, result="not_sent")
            log.info("denied %s on %s for %s (%s)", cmd.action, c.target, _who(principal), d.reason)
            return await reply(fail("forbidden", f"not allowed: {cmd.action} on {c.target}", aid,
                                    reason=d.reason, target=c.target))
        step = next((d for _, d in decisions if d.needs_step_up), None)
        if step is not None:
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="step_up", reason=step.reason, sensitive=sensitive, result="not_sent")
            return await reply({"type": "step_up_required", "reason": step.reason, "action": cmd.action,
                                "targets": cmd.targets, "methods": self._methods(principal),
                                "window": self.authz.policy_for(subject).step_up_window, "audit_id": aid})

        ident = principal.identity
        fresh_age = (self.clock() - ident.fresh_factor_at) if (sensitive and ident.fresh_factor_at) else None
        unavailable = self._unavailable(cmd)
        if unavailable:
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason=unavailable, sensitive=sensitive, result="not_sent")
            return await reply(fail("unavailable", unavailable, aid))
        # THE AUDIT ROW FIRST: if this raises, nothing below runs and nothing is sent.
        aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                decision="allowed", reason="granted", sensitive=sensitive,
                                step_up=ident.fresh_factor if sensitive else None, step_up_age=fresh_age)
        try:
            result = await self._forward(principal, cmd, aid)
        except Exception as exc:  # noqa: BLE001 -- HA's error is the client's answer, and the row's result
            code = _error_code(exc)
            self._finish(aid, f"error:{code}")
            log.warning("%s for %s failed: %s", cmd.action, _who(principal), code)
            return await reply(fail(code, str(exc)[:300], aid))
        if cmd.live is None:
            self._finish(aid, "ok")        # live talk: the relay writes the result when the stream ends
        log.info("%s on %s by %s (audit %d)", cmd.action, ",".join(cmd.targets), _who(principal), aid)
        await reply({"type": "command_result", "result": result, "audit_id": aid})
        authz = self.app.get("authz")
        trusted = authz is not None and hasattr(authz, "ha_trusted") and authz.ha_trusted(ident)
        if ident.door in REMOTE_DOORS and sensitive in NOTIFY_KINDS and not trusted:
            await self.notify_owners(principal, cmd, aid)

    async def _alarm(self, principal: Principal, cmd: Command, keypad: Any, reply, fail) -> None:
        """THE ALARM KEYPAD (alarm_pin.py; GATEWAY.md "The alarm"). HK's Alarm PIN, decided by Mantel:
        the code (already out of the command) is checked by alarm_pin/pins, RBAC decides with
        ``control.sensitive`` on the keypad panel and the alarm it forwards to whenever a code is needed,
        the audit row is written FIRST, and only then does the command go to Home Assistant -- to the
        alarm itself, with the alarm's own HA code from Mantel's store when the panel asks for one."""
        service, named = cmd.alarm  # type: ignore[misc]
        entry = keypad.entry_or_default(named)
        code, action, targets = cmd.code, cmd.action, entry.targets()
        needed = entry.needs_code(service, code)
        sensitive = alarm_pin.SENSITIVE if needed else None

        def record(decision: str, reason: str, who: Principal = principal, **kw) -> int:
            return self.audit.record(principal=who, kind="service", action=action, targets=targets,
                                     decision=decision, reason=reason, sensitive=sensitive, **kw)

        if needed and code is None:
            aid = record("denied", "alarm_code_required", result="not_sent")
            return await reply(fail("code_required", "Enter the alarm code", aid))
        verdict = alarm_pin.Verdict("none")
        if code is not None:
            verdict = await keypad.check(principal, entry, code, self.app.get("pins"))
            if not verdict.ok:
                aid = record("denied", f"alarm_code_{verdict.status}", result="not_sent")
                log.info("alarm keypad %s refused a code from %s (%s)", named, _who(principal), verdict.status)
                if verdict.status == "locked":
                    wait = int(verdict.retry_after) + 1
                    return await reply(fail("code_locked", f"Wrong code too many times; the keypad is locked for "
                                            f"{(wait + 59) // 60} min", aid, retry_after=wait))
                return await reply(fail("invalid_code", "Wrong code", aid))
        # a person's PIN names them: decided as that person (∩ the tablet), for this one command
        acting = self.authz.with_person(principal, verdict.person) if verdict.status == "person" else principal
        subject = acting.subject
        ctx = self.authz.context()
        policy = keypad.keypad_policy(self.authz, subject)
        checks = [Check(action, eid) for eid in targets]
        if needed:
            checks += [Check("control.sensitive", eid) for eid in targets]
        decisions = [(c, policy.decide(subject, c.action, c.entity_id, ctx)) for c in checks]
        denied = next(((c, d) for c, d in decisions if not d.allowed and not d.needs_step_up), None)
        if denied is not None:
            c, d = denied
            aid = record("denied", d.reason, acting, result="not_sent")
            log.info("denied %s on %s for %s (%s)", action, c.target, _who(acting), d.reason)
            return await reply(fail("forbidden", f"not allowed: {action} on {c.target}", aid,
                                    reason=d.reason, target=c.target))
        step = next((d for _, d in decisions if d.needs_step_up), None)
        # the house code is the factor on the LAN rules door only (the tunnel still wants the person's own)
        if step is not None and not (verdict.status == "house" and subject.door == "lan"):
            aid = record("step_up", step.reason, acting, result="not_sent")
            return await reply({"type": "step_up_required", "reason": step.reason, "action": action,
                                "targets": targets, "methods": self._methods(principal),
                                "window": self.authz.policy_for(subject).step_up_window, "audit_id": aid})
        # the alarm's OWN code, for a panel that asks for one: Mantel's, never the page's
        attrs = _attrs(self.app, entry.forward_to)
        ha_code = None
        if attrs.get("code_format"):
            ha_code = keypad.ha_code(entry.entity) if entry.configured else None
            if not ha_code:
                aid = record("denied", "alarm_ha_code_missing", acting, result="not_sent")
                return await reply(fail("unavailable", "alarm_ha_code_missing", aid))
        if self.commander is None:
            aid = record("denied", "commands_disabled", acting, result="not_sent")
            return await reply(fail("unavailable", "commands_disabled", aid))
        ident = acting.identity
        factor = {"house": "alarm_pin", "person": "pin"}.get(verdict.status, ident.fresh_factor if needed else None)
        age = 0.0 if verdict.status in ("house", "person") else (
            (self.clock() - ident.fresh_factor_at) if (needed and ident.fresh_factor_at) else None)
        # THE AUDIT ROW FIRST: if this raises, nothing below runs and nothing is sent.
        aid = record("allowed", "granted", acting, step_up=factor, step_up_age=age)
        data: dict = {"entity_id": entry.forward_to}
        if ha_code:
            data["code"] = ha_code
        frame = {"type": "call_service", "domain": alarm_pin.DOMAIN, "service": service, "service_data": data}
        try:
            result = await self.commander.call(frame, CommandTicket(aid, "ws"))
        except Exception as exc:  # noqa: BLE001 -- HA's error is the client's answer, and the row's result
            code_ = _error_code(exc)
            self._finish(aid, f"error:{code_}")
            log.warning("%s for %s failed: %s", action, _who(acting), code_)
            return await reply(fail(code_, str(exc)[:300], aid))
        self._finish(aid, "ok")
        log.info("%s on %s by %s (audit %d)", action, ",".join(targets), _who(acting), aid)
        await reply({"type": "command_result", "result": result, "audit_id": aid})
        authz = self.app.get("authz")
        trusted = authz is not None and hasattr(authz, "ha_trusted") and authz.ha_trusted(principal.identity)
        if service == alarm_pin.DISARM and principal.identity.door in REMOTE_DOORS and not trusted:
            cmd.targets = targets
            await self.notify_owners(acting, cmd, aid)

    def _unavailable(self, cmd: Command) -> str | None:
        if cmd.live is not None and (self.commander is None or self.app.get("talk") is None):
            return "commands_disabled"
        if cmd.kind == "ma":
            return None if self.app.get("ma") is not None else "music_assistant_off"
        return None if self.commander is not None else "commands_disabled"

    def _finish(self, aid: int, result: str) -> None:
        try:
            self.audit.finish(aid, result)
        except sqlite3.Error:
            log.exception("could not write the result of audit row %d (the command itself ran)", aid)

    async def _forward(self, principal: Principal, cmd: Command, aid: int) -> Any:
        if cmd.live is not None:
            return self.app["talk"].issue(principal, cmd.live, aid)
        if cmd.kind in ("service", "ws"):
            return await self.commander.call(dict(cmd.frame or {}), CommandTicket(aid, "ws"))  # type: ignore[union-attr]
        if cmd.upload is not None:
            path, ctype, data = cmd.upload
            return await self.commander.upload(path, ctype, data, CommandTicket(aid, "upload"))  # type: ignore[union-attr]
        if cmd.kind == "http":
            method, path, body = cmd.http  # type: ignore[misc]
            return await self.commander.http(method, path, body, CommandTicket(aid, "http"))  # type: ignore[union-attr]
        command, args = cmd.ma  # type: ignore[misc]
        queue = self._ma_tickets.setdefault(id(principal), [])
        queue.append((command, json.dumps(args, sort_keys=True, default=str), CommandTicket(aid, "ma")))
        try:
            return await self.app["ma"].command(principal, command, **args)
        finally:
            if not queue:
                self._ma_tickets.pop(id(principal), None)

    async def notify_owners(self, principal: Principal, cmd: Command, aid: int) -> None:
        """PLAN §7: every remote (tunnel) unlock/disarm notifies the Owners. Through HA's persistent
        notifications when commands are on (audited as the server's own action); logged otherwise."""
        who = _who(principal)
        when = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.clock()))
        door = principal.identity.door if principal is not None else "tunnel"
        how = "through Home Assistant's sidebar" if door == "ha" else "remotely (tunnel door)"
        message = f"{who} used {cmd.action} on {', '.join(cmd.targets)} {how} at {when}."
        if self.commander is None:
            log.warning("OWNER NOTICE (not sent: commands are off): %s", message)
            return
        frame = {"type": "call_service", "domain": "persistent_notification", "service": "create",
                 "service_data": {"title": "Mantel: remote access", "message": message,
                                  "notification_id": f"mantel_remote_{aid}"}}
        try:
            nid = self.audit.record(principal=None, kind="system", action="persistent_notification.create",
                                    targets=["feature:notifications"], decision="allowed",
                                    reason=f"owner_notification:{aid}", actor="mantel", actor_name="Mantel Server")
            await self.commander.call(frame, CommandTicket(nid, "ws"))
            self._finish(nid, "ok")
        except Exception as exc:  # noqa: BLE001 -- the command ran; the notice is best effort, and logged
            log.error("could not notify the Owners of a remote %s (audit %d): %s", cmd.action, aid, exc)


def _kind(msg: dict) -> str:
    k = msg.get("kind")
    return AUDIT_KIND.get(k, k) if k in KINDS else "service"


def _action(msg: dict) -> str | None:
    k = msg.get("kind")
    if k == "service" and isinstance(msg.get("domain"), str) and isinstance(msg.get("service"), str):
        return f"{msg['domain']}.{msg['service']}"[:200]
    if k == "ws" and isinstance(msg.get("msg"), dict):
        t = msg["msg"].get("type")
        return t[:200] if isinstance(t, str) else None
    if k == "http":
        return f"{msg.get('method')} {str(msg.get('path')).split('?', 1)[0]}"[:200]
    if k == "ma" and isinstance(msg.get("command"), str):
        return msg["command"][:200]
    if k == "talk_live":
        return TALK_LIVE_TYPE
    return None


def _attrs(app: Any, entity_id: str) -> dict:
    """The entity's attributes from the hub's state copy ({} when unknown)."""
    hub = app.get("hub") if hasattr(app, "get") else None
    st = getattr(getattr(hub, "store", None), "states", {}).get(entity_id) if hub is not None else None
    a = st.get("a") if isinstance(st, dict) else None
    return a if isinstance(a, dict) else {}


def _who(principal: Principal) -> str:
    u, d = principal.user, principal.device
    parts = [f"{u.name or u.username or u.id} ({u.role})"] if u else []
    if d:
        parts.append(f"at {d.name}")
    return " ".join(parts) or "someone"


def _error_code(exc: BaseException) -> str:
    if isinstance(exc, HaCommandError):
        return exc.code
    if isinstance(exc, CommandBlocked):
        return "not_allowed"
    if isinstance(exc, (ConnectionError, asyncio.TimeoutError, OSError)):
        return "unavailable"
    name = type(exc).__name__
    return "refused" if name == "CommandRefused" else "failed"


# -- the audit read API (PLAN §5: the Owner's "audit log"; Admins too) ----------------------------------
AUDIT_DECISIONS = ("allowed", "denied", "step_up")
AUDIT_KINDS = ("service", "ws", "http", "ma", "config", "system")
AUDIT_PAGE, AUDIT_PAGE_MAX = 100, 500


def _bad(param: str) -> web.Response:
    return web.json_response({"error": "invalid_query", "param": param}, status=400,
                             headers={"Cache-Control": "no-store"})


async def audit_list(request: web.Request) -> web.Response:
    """``GET /api/audit?actor=&device=&decision=&kind=&since=&until=&before=&limit=``: newest first;
    ``next`` is the ``before`` of the next page. Reading the audit is ``configure`` on feature ``audit``
    (default roles: Owner and Admin; a person at a wall tablet gets the tablet's share: none)."""
    authz: Authz = request.app["authz"]
    p = authz.principal(request)
    if p.user is None or not authz.decide(p.subject, "configure", None, feature="audit").allowed:
        return web.json_response({"error": "forbidden"}, status=403, headers={"Cache-Control": "no-store"})
    q = request.query
    kw: dict[str, Any] = {}
    for name in ("actor", "device"):
        if name in q:
            if not q[name] or len(q[name]) > 64:
                return _bad(name)
            kw[name] = q[name]
    for name, allowed in (("decision", AUDIT_DECISIONS), ("kind", AUDIT_KINDS)):
        if name in q:
            if q[name] not in allowed:
                return _bad(name)
            kw[name] = q[name]
    for name in ("since", "until"):
        if name in q:
            try:
                value = float(q[name])
            except ValueError:
                return _bad(name)
            if not math.isfinite(value):
                return _bad(name)
            kw[name] = value
    for name, default in (("before", None), ("limit", AUDIT_PAGE)):
        raw = q.get(name)
        if raw is None:
            if default is not None:
                kw[name] = default
            continue
        try:
            kw[name] = int(raw)
        except ValueError:
            return _bad(name)
    if not 1 <= kw["limit"] <= AUDIT_PAGE_MAX:
        return _bad("limit")
    rows, nxt = request.app["audit"].query(**kw)
    cfg = request.app.get("cfg")
    return web.json_response({"ok": True, "rows": rows, "next": nxt,
                              "retention_days": getattr(cfg, "audit_retention_days", None)},
                             headers={"Cache-Control": "no-store"})


def register_audit(app: web.Application) -> None:
    app.router.add_get("/api/audit", audit_list)
