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
  <- {"type": "command_result", "id": 7, "result": ..., "audit_id": 41}
  <- {"type": "command_result", "id": 7, "error": {"code": "forbidden", "reason": "no_grant"}, "audit_id": 42}
  <- {"type": "step_up_required", "id": 7, "reason": "step_up_required", "methods": ["totp"],
      "window": 300, "audit_id": 43}      -> the page proves a fresh factor (POST /api/auth/totp/step-up
                                             or a passkey verify) and sends the same command again

Each command, in order: resolve the subject from the session (re-read from the database, so a
step-up or a revocation counts at once) -> classify it (a service; a WebSocket write from
``hkClient.WRITES``, exported to ``hk_writes.json``; an HTTP write; an MA command) -> ``Policy.decide``
for every target -> step-up if needed -> the audit row FIRST (``action_audit``, migration 0004; if it
cannot be written the command is refused and nothing is sent) -> forward with a one-shot ticket bound
to that row -> the result back to the client and into the row. A remote (tunnel) unlock or disarm
also notifies the Owners (an HA persistent notification).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
from dataclasses import dataclass, field
from importlib.resources import files
from typing import Any, Awaitable, Callable, Iterable

from . import rbac
from .authz import ENTITY_ID, Authz, Principal
from .ha_client import (CommandBlocked, CommandTicket, HaCommandError, HaCommander, HTTP_METHODS, _API_PATH)

log = logging.getLogger("mantel.gateway")

KINDS = ("service", "ws", "http", "ma")
KEYS = {
    "service": frozenset({"type", "id", "kind", "domain", "service", "data", "target", "return_response"}),
    "ws": frozenset({"type", "id", "kind", "msg"}),
    "http": frozenset({"type", "id", "kind", "method", "path", "body"}),
    "ma": frozenset({"type", "id", "kind", "command", "args"}),
}
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
    return Command("service", action, checks, frame=frame, targets=ids or [c.target for c in checks])


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


def classify(msg: dict, writes: frozenset[str]) -> Command:
    """A client `command` message -> Command, or Refused. Pure: no I/O."""
    kind = msg.get("kind")
    if kind not in KINDS:
        raise Refused("invalid_command", f"kind is one of {KINDS}")
    if set(msg) - KEYS[kind]:
        raise Refused("invalid_command", f"a {kind} command carries {sorted(KEYS[kind])} only")
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
        if body is not None and not isinstance(body, (dict, list)):
            raise Refused("unsupported_body", "the body is JSON (an object or a list)")
        seg = path.split("?", 1)[0].split("/")
        if method == "POST" and len(seg) == 5 and seg[2] == "services":
            cmd = service_command(seg[3], seg[4], body if isinstance(body, dict) else {}, None)
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
        acc = self.app.get("accounts")
        if u is None or acc is None:
            return []                       # a device alone: a person's factor is needed (not offered yet)
        methods = []
        if acc.has_totp(u.id):
            methods.append("totp")
        if acc.has_passkey(u.id):
            methods.append("passkey")
        return methods

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

        subject = principal.subject
        ctx = self.authz.context()
        decisions = [(c, self.authz.decide(subject, c.action, c.entity_id, feature=c.feature, ctx=ctx))
                     for c in cmd.checks]
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
        self._finish(aid, "ok")
        log.info("%s on %s by %s (audit %d)", cmd.action, ",".join(cmd.targets), _who(principal), aid)
        await reply({"type": "command_result", "result": result, "audit_id": aid})
        if ident.door == "tunnel" and sensitive in NOTIFY_KINDS:
            await self.notify_owners(principal, cmd, aid)

    def _unavailable(self, cmd: Command) -> str | None:
        if cmd.kind == "ma":
            return None if self.app.get("ma") is not None else "music_assistant_off"
        return None if self.commander is not None else "commands_disabled"

    def _finish(self, aid: int, result: str) -> None:
        try:
            self.audit.finish(aid, result)
        except sqlite3.Error:
            log.exception("could not write the result of audit row %d (the command itself ran)", aid)

    async def _forward(self, principal: Principal, cmd: Command, aid: int) -> Any:
        if cmd.kind in ("service", "ws"):
            return await self.commander.call(dict(cmd.frame or {}), CommandTicket(aid, "ws"))  # type: ignore[union-attr]
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
        message = f"{who} used {cmd.action} on {', '.join(cmd.targets)} remotely (tunnel door) at {when}."
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
    return k if k in KINDS else "service"


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
    return None


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
