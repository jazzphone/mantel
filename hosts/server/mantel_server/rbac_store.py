"""Storage for roles and grants (P3.2), over a plain `sqlite3.Connection`, and the Owner-only REST.

The schema is `migrations/0002_rbac.sql`; P3.1's `db.py` runner applies it in production, and
`ensure_schema` applies it to a bare connection (tests, tools). The engine itself is `rbac.py`;
this module only turns rows into `Grant`s / role overrides and back, and builds the `Policy`.

REST (all Owner-only; the caller's identity comes from the `identity(request)` resolver the
orchestrator passes in, which returns None or a mapping with `user_id` and `role`):
  GET    /api/rbac/grants                 -> {"grants": [...]}
  POST   /api/rbac/grants                 <- a grant object         -> 201 {"grant": {...}}
  DELETE /api/rbac/grants/{id}            -> {"removed": id}
  GET    /api/rbac/roles                  -> {"roles": {name: {..., "overridden": bool}}}
  PUT    /api/rbac/roles/{role}           <- override body          -> {"role": {...}}
  DELETE /api/rbac/roles/{role}           -> back to the defaults
  GET    /api/rbac/scopes/{user|device}/{id}  -> {"areas": [...]}
  PUT    /api/rbac/scopes/{user|device}/{id}  <- {"areas": [...]}
After every change, each client session's view re-checks what it may see (`policy_changed`).
"""
from __future__ import annotations

import inspect
import json
import logging
import sqlite3
import time
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Mapping

from aiohttp import web

from .rbac import DEFAULT_ROLES, OWNER, Grant, Policy, Role, Schedule, Subject

log = logging.getLogger("mantel.rbac")

MIGRATION = Path(__file__).resolve().parent / "migrations" / "0002_rbac.sql"
SUBJECT_KINDS = ("user", "device")
PREFIX = "/api/rbac"


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Apply 0002_rbac.sql (idempotent). Production uses db.py's runner instead."""
    conn.executescript(MIGRATION.read_text())


def _list(raw: str | None) -> list[str]:
    return json.loads(raw) if raw else []


class RbacStore:
    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.conn = conn
        self.clock = clock
        self._policy: Policy | None = None

    # -- grants ----------------------------------------------------------------------------------
    def grants(self) -> list[Grant]:
        rows = self.conn.execute(
            "SELECT id, effect, actions, resource_kind, resource, domains, roles, users, devices, schedule, note "
            "FROM rbac_grants ORDER BY id").fetchall()
        out = []
        for (gid, effect, actions, kind, resource, domains, roles, users, devices, schedule, note) in rows:
            try:
                out.append(Grant(effect=effect, actions=_list(actions), resource_kind=kind, resource=resource,
                                 domains=_list(domains), roles=_list(roles), users=_list(users),
                                 devices=_list(devices),
                                 schedule=Schedule.from_dict(json.loads(schedule)) if schedule else None,
                                 id=gid, note=note))
            except (ValueError, TypeError) as exc:
                # A row the engine cannot read must not silently widen access. An unreadable allow
                # is dropped; an unreadable deny becomes a deny of everything for its targets.
                log.error("rbac grant %s is unreadable (%s)", gid, exc)
                if effect != "allow":
                    out.append(Grant(effect="deny", actions="*", resource_kind="all",
                                     roles=_safe_list(roles), users=_safe_list(users),
                                     devices=_safe_list(devices), id=gid, note="unreadable deny"))
        return out

    def owner_ids(self) -> frozenset[str]:
        """The people whose role is Owner now (accounts' ``users`` table; none on a bare RBAC database)."""
        try:
            return frozenset(r[0] for r in self.conn.execute("SELECT id FROM users WHERE role = 'owner'"))
        except sqlite3.OperationalError:     # tests and tools that keep only the RBAC tables
            return frozenset()

    def check_grant(self, grant: Grant) -> Grant:
        """A grant fit to store, or ValueError. Owners always keep every permission, so a deny that names the
        Owner role or a person who is an Owner is refused here, before it is saved (the engine ignores one that
        got in anyway: rbac.Policy._side)."""
        if not grant.targets_anyone:
            raise ValueError("a grant must name at least one role, user or device")
        if grant.effect == "deny":
            if OWNER in grant.roles:
                raise ValueError("Owners always keep every permission: a deny cannot name the owner role")
            if grant.users & self.owner_ids():
                raise ValueError("Owners always keep every permission: a deny cannot name a person who is an Owner")
        return grant

    def add_grant(self, grant: Grant, by: str | None = None) -> Grant:
        self.check_grant(grant)
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO rbac_grants (effect, actions, resource_kind, resource, domains, roles, users, devices, "
                "schedule, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (grant.effect, json.dumps(sorted(grant.actions)), grant.resource_kind, grant.resource,
                 json.dumps(sorted(grant.domains)), json.dumps(sorted(grant.roles)),
                 json.dumps(sorted(grant.users)), json.dumps(sorted(grant.devices)),
                 json.dumps(grant.schedule.to_dict()) if grant.schedule else None, grant.note,
                 self.clock(), by))
        self._policy = None
        return replace(grant, id=cur.lastrowid)

    def remove_grant(self, grant_id: int) -> bool:
        with self.conn:
            n = self.conn.execute("DELETE FROM rbac_grants WHERE id = ?", (grant_id,)).rowcount
        self._policy = None
        return n > 0

    # -- role overrides --------------------------------------------------------------------------
    def overrides(self) -> dict[str, dict]:
        out = {}
        for role, body in self.conn.execute("SELECT role, body FROM rbac_role_overrides ORDER BY role"):
            out[role] = json.loads(body)
        return out

    @staticmethod
    def check_override(role: str, body: Any) -> Role:
        """The role an override would produce; ValueError if it is not acceptable."""
        if role == "owner":
            raise ValueError("the owner role is fixed: Owners can always do everything")
        if not isinstance(role, str) or not role.isidentifier() or role != role.lower():
            raise ValueError("a role name is lower_case letters, digits and underscores")
        if not isinstance(body, Mapping):
            raise ValueError("an override is an object")
        return (DEFAULT_ROLES.get(role) or Role(role)).overridden(body)

    def set_override(self, role: str, body: Mapping, by: str | None = None) -> Role:
        result = self.check_override(role, body)
        with self.conn:
            self.conn.execute(
                "INSERT INTO rbac_role_overrides (role, body, updated_at, updated_by) VALUES (?,?,?,?) "
                "ON CONFLICT(role) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at, "
                "updated_by=excluded.updated_by",
                (role, json.dumps(dict(body), sort_keys=True), self.clock(), by))
        self._policy = None
        return result

    def clear_override(self, role: str) -> bool:
        with self.conn:
            n = self.conn.execute("DELETE FROM rbac_role_overrides WHERE role = ?", (role,)).rowcount
        self._policy = None
        return n > 0

    # -- scopes (what `@subject` means per user / device) ------------------------------------------
    def scopes(self, kind: str, subject_id: str) -> frozenset[str]:
        if kind not in SUBJECT_KINDS:
            raise ValueError("kind is 'user' or 'device'")
        return frozenset(a for (a,) in self.conn.execute(
            "SELECT area FROM rbac_scopes WHERE subject_kind = ? AND subject_id = ?", (kind, subject_id)))

    def set_scopes(self, kind: str, subject_id: str, areas) -> frozenset[str]:
        if kind not in SUBJECT_KINDS:
            raise ValueError("kind is 'user' or 'device'")
        if not isinstance(areas, (list, tuple, set, frozenset)) or not all(isinstance(a, str) and a for a in areas):
            raise ValueError("areas must be a list of area ids or names")
        with self.conn:
            self.conn.execute("DELETE FROM rbac_scopes WHERE subject_kind = ? AND subject_id = ?", (kind, subject_id))
            self.conn.executemany("INSERT INTO rbac_scopes (subject_kind, subject_id, area) VALUES (?,?,?)",
                                  [(kind, subject_id, a) for a in sorted(set(areas))])
        return frozenset(areas)

    # -- the policy --------------------------------------------------------------------------------
    def policy(self) -> Policy:
        """Defaults + overrides + stored grants, cached until the next write through this store."""
        if self._policy is None:
            overrides = {}
            for role, body in self.overrides().items():
                if role == "owner":
                    continue
                try:
                    (DEFAULT_ROLES.get(role) or Role(role)).overridden(body)
                    overrides[role] = body
                except ValueError as exc:
                    # Unreadable override: the role loses its grants rather than keeping stale ones.
                    log.error("rbac override for %s is unreadable (%s)", role, exc)
                    overrides[role] = {"grants": []}
            self._policy = Policy.build(self.grants(), overrides)
        return self._policy

    def invalidate(self) -> None:
        self._policy = None

    def subject(self, *, user_role: str | None = None, user_id: str | None = None,
                device_role: str | None = None, device_id: str | None = None, door: str = "lan",
                fresh_factor_at: float | None = None) -> Subject:
        """A Subject with its `@subject` areas filled in from the stored scopes."""
        return Subject(user_role=user_role, user_id=user_id, device_role=device_role, device_id=device_id,
                       door=door, fresh_factor_at=fresh_factor_at,
                       user_areas=self.scopes("user", user_id) if user_id else frozenset(),
                       device_areas=self.scopes("device", device_id) if device_id else frozenset())


def _safe_list(raw: str | None) -> list[str]:
    try:
        v = json.loads(raw) if raw else []
        return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []
    except ValueError:
        return []


# -- REST ------------------------------------------------------------------------------------------
def notify_sessions(hub: Any) -> None:
    """Every connected session re-checks what it may see now that the policy changed. Its principal is read again
    first: a room scope is part of the subject (Authz.subject_of), so re-filtering with the old one showed a room
    edit only at the next minute's tick."""
    for s in list(getattr(hub, "sessions", ()) or ()):
        app, principal = getattr(s, "app", None), getattr(s, "principal", None)
        authz = app.get("authz") if app is not None else None
        if authz is not None and principal is not None:
            authz.refresh(principal)              # (one that ended is closed by the tick, as before)
        view = getattr(s, "view", None)
        if view is not None and hasattr(view, "policy_changed"):
            view.policy_changed()
        wake = getattr(s, "wake", None)
        if wake is not None:
            wake.set()
    feed = getattr(hub, "registry_feed", None)
    if feed is not None:      # what a page's registry holds may have changed too (registry_feed.py)
        feed.changed()


def register(app: web.Application, hub: Any, *, identity: Callable[[web.Request], Any],
             store: RbacStore | None = None, conn: sqlite3.Connection | None = None,
             csrf: Callable[[web.Request], bool] | None = None,
             audit: Callable[[dict], Any] | None = None, prefix: str = PREFIX,
             guard: Callable[..., Callable] | None = None) -> RbacStore:
    """Add the Owner-only grant/role/scope routes. `identity(request)` (sync or async) returns None
    or {"user_id", "role"}; `csrf(request)` (P3.1's check) must pass for every change; `audit(event)`
    runs before a change is made, and if it raises the change is refused (503). ``guard`` is guards.guard in
    the server (Rules.md rule 7): an Owner's own session, never at a wall tablet; a bare app (the tests) has
    only the checks here."""
    if store is None:
        if conn is None:
            raise ValueError("register needs a store or a connection")
        store = RbacStore(conn)
    app["rbac"] = store

    async def owner(request: web.Request, change: bool) -> dict:
        who = identity(request)
        if inspect.isawaitable(who):
            who = await who
        if not who:
            raise web.HTTPUnauthorized(text=json.dumps({"error": "unauthenticated"}), content_type="application/json")
        if who.get("role") != "owner":
            raise web.HTTPForbidden(text=json.dumps({"error": "owner_only"}), content_type="application/json")
        if change and csrf is not None and not csrf(request):
            raise web.HTTPForbidden(text=json.dumps({"error": "csrf"}), content_type="application/json")
        return who

    async def body(request: web.Request) -> Any:
        try:
            return await request.json()
        except (ValueError, UnicodeError):
            raise web.HTTPBadRequest(text=json.dumps({"error": "invalid_json"}), content_type="application/json")

    def bad(exc: Exception) -> web.Response:
        return web.json_response({"error": "invalid", "message": str(exc)}, status=400)

    def record(who: dict, action: str, detail: dict) -> web.Response | None:
        if audit is None:
            return None
        try:
            audit({"timestamp": store.clock(), "actor": who.get("user_id"), "role": who.get("role"),
                   "action": action, "detail": detail})
        except Exception:  # noqa: BLE001 -- no audit, no change
            log.exception("rbac audit failed; change refused")
            return web.json_response({"error": "audit_unavailable"}, status=503)
        return None

    async def list_grants(request: web.Request) -> web.Response:
        await owner(request, False)
        return web.json_response({"grants": [g.to_dict() for g in store.grants()]})

    async def add_grant(request: web.Request) -> web.Response:
        who = await owner(request, True)
        data = await body(request)
        try:
            if isinstance(data, dict) and data.get("id") is not None:
                raise ValueError("a new grant has no id")
            grant = store.check_grant(Grant.from_dict(data))
        except (ValueError, TypeError) as exc:
            return bad(exc)
        refused = record(who, "rbac.grant.add", grant.to_dict())
        if refused:
            return refused
        saved = store.add_grant(grant, by=who.get("user_id"))
        notify_sessions(hub)
        return web.json_response({"grant": saved.to_dict()}, status=201)

    async def remove_grant(request: web.Request) -> web.Response:
        who = await owner(request, True)
        try:
            gid = int(request.match_info["id"])
        except ValueError:
            return bad(ValueError("id must be a number"))
        if not any(g.id == gid for g in store.grants()):
            return web.json_response({"error": "not_found"}, status=404)
        refused = record(who, "rbac.grant.remove", {"id": gid})
        if refused:
            return refused
        store.remove_grant(gid)
        notify_sessions(hub)
        return web.json_response({"removed": gid})

    async def list_roles(request: web.Request) -> web.Response:
        await owner(request, False)
        policy = store.policy()
        overridden = set(store.overrides())
        return web.json_response({"roles": {name: {**r.to_dict(), "overridden": name in overridden}
                                            for name, r in policy.roles.items()}})

    async def set_role(request: web.Request) -> web.Response:
        who = await owner(request, True)
        role = request.match_info["role"]
        data = await body(request)
        try:
            store.check_override(role, data)
        except (ValueError, TypeError) as exc:
            return bad(exc)
        refused = record(who, "rbac.role.set", {"role": role, "body": data})
        if refused:
            return refused
        result = store.set_override(role, data, by=who.get("user_id"))
        notify_sessions(hub)
        return web.json_response({"role": result.to_dict()})

    async def clear_role(request: web.Request) -> web.Response:
        who = await owner(request, True)
        role = request.match_info["role"]
        if role not in store.overrides():
            return web.json_response({"error": "not_found"}, status=404)
        refused = record(who, "rbac.role.clear", {"role": role})
        if refused:
            return refused
        store.clear_override(role)
        notify_sessions(hub)
        return web.json_response({"cleared": role})

    async def get_scopes(request: web.Request) -> web.Response:
        await owner(request, False)
        try:
            areas = store.scopes(request.match_info["kind"], request.match_info["id"])
        except ValueError as exc:
            return bad(exc)
        return web.json_response({"areas": sorted(areas)})

    async def set_scopes(request: web.Request) -> web.Response:
        who = await owner(request, True)
        kind, sid = request.match_info["kind"], request.match_info["id"]
        data = await body(request)
        areas = data.get("areas") if isinstance(data, dict) else None
        if kind not in SUBJECT_KINDS or not isinstance(areas, list) or \
                not all(isinstance(a, str) and a for a in areas):
            return bad(ValueError("PUT {\"areas\": [area ids or names]} to /scopes/user|device/<id>"))
        refused = record(who, "rbac.scopes.set", {"kind": kind, "id": sid, "areas": sorted(set(areas))})
        if refused:
            return refused
        saved = store.set_scopes(kind, sid, areas)
        notify_sessions(hub)
        return web.json_response({"areas": sorted(saved)})

    def g(audit_action: str | None = None):
        if guard is None:
            return lambda handler: handler
        if audit_action is None:                      # a read: the roles and grants, an Owner's settings
            return guard("owner", reads="admin")
        return guard("owner", audit=audit_action)

    app.router.add_get(f"{prefix}/grants", g()(list_grants))
    app.router.add_post(f"{prefix}/grants", g("rbac.grant.add")(add_grant))
    app.router.add_delete(f"{prefix}/grants/{{id}}", g("rbac.grant.remove")(remove_grant))
    app.router.add_get(f"{prefix}/roles", g()(list_roles))
    app.router.add_put(f"{prefix}/roles/{{role}}", g("rbac.role.set")(set_role))
    app.router.add_delete(f"{prefix}/roles/{{role}}", g("rbac.role.clear")(clear_role))
    app.router.add_get(f"{prefix}/scopes/{{kind}}/{{id}}", g()(get_scopes))
    app.router.add_put(f"{prefix}/scopes/{{kind}}/{{id}}", g("rbac.scopes.set")(set_scopes))
    return store
