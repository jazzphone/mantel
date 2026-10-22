"""Linked mode's per-tablet ownership during the cutover (docs/phase6/CUTOVER.md §1, Option A, the
recorded recommendation; docs/phase5/LINKED-MODE.md "Ownership").

While the house moves one wall tablet at a time, each tablet is OWNED by either Home Assistant's HK
(its own engines, entities and actions, as today) or Mantel Server. A *unit* is a tablet (its settings
id, the same in HA and in Mantel: P3.5's import) or ``house``: everything of the hk_frontend entry that
is not a tablet's (Seasonal decorations, the Alarm PIN panel, Live TV's entities; CUTOVER Step 7).

* **Default: Home Assistant.** A unit with no row is HA's, so nothing changes until an Owner moves one.
* **Set by an Owner** (``PUT /api/linked/owners``: an Owner's own session on the LAN door, or on HA's
  sidebar with the home rules in the HA App, ``authz.home_door``; CSRF through the session middleware),
  **audited first**: an ``action_audit`` row (kind ``config``, action
  ``linked.owner``, ``{unit, from, to}``) is written before the change is applied, as rbac_store does.
* **Safe on restart**: the rows are in Mantel's database (migration ``0010_linked_owners.sql``); HA
  keeps the last ownership it was told in its entry's data, so either side restarting alone keeps it.
* **Visible on both sides**: ``GET /api/linked/owners`` (Owner/Admin) here; the link's ``hello`` and an
  ``owners`` frame tell HA at once (linked.py), where Configure -> Linked to Mantel Server and the
  diagnostics show it.
* **Taken by Mantel when Home Assistant has no HK Frontend** (``take_house_alone``): once Mantel Link reports
  that its Home Assistant has none, and none is linked, nothing else could run the house, so Mantel records
  ``house`` as its own (audited, ``changed_by`` ``mantel:no_hk_frontend``). A Mantel that never had HK Frontend
  needs no step about moving from it; Live TV through Mantel Link needs the house's entities. Recorded, not
  inferred on each read: Mantel Link reconnecting doesn't take it away again.
* **Rules that keep it whole**: ``house`` moves to Mantel only when every tablet is already Mantel's
  (Step 7 comes after Step 4), and no tablet moves back to HA while ``house`` is Mantel's (move ``house``
  back first). Mantel publishes only the entities of the units it owns, and handles a forwarded action
  only for them; HA forwards only for them (hk_frontend's linked_mode.py).

Nothing here talks to Home Assistant or calls a house service.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Any, Callable

from aiohttp import web

log = logging.getLogger("mantel.linked_owners")

HOUSE = "house"
# who mirrors Mantel's entities in Home Assistant (docs/phase9/MANTEL-LINK.md "Hand over the bridge"):
# the row's owner 'ha' (or none) is HK Frontend, 'mantel' is Mantel Link. Not a tablet.
BRIDGE = "bridge"
UNITS_NOT_TABLETS = (HOUSE, BRIDGE)
BRIDGES = ("hk_frontend", "mantel")
OWNERS = ("ha", "mantel")
MIGRATION = Path(__file__).with_name("migrations") / "0010_linked_owners.sql"


def ensure_schema(conn: sqlite3.Connection) -> None:
    """This module's tables on a bare connection (tests, tools); the runner applies the same file."""
    conn.executescript(MIGRATION.read_text())


class OwnershipError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


class LinkedOwners:
    """The ownership rows and the rules. ``tablets()`` names the tablets Mantel knows ({id: name});
    ``audit`` is the gateway's ``Audit`` (its ``config_event``); listeners run after every change."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float],
                 tablets: Callable[[], dict[str, str]] | None = None, audit: Any = None) -> None:
        self.db, self.clock = conn, clock
        self.tablets = tablets or (lambda: {})
        self.audit = audit
        self.listeners: list[Callable[[dict], Any]] = []

    # -- reading -------------------------------------------------------------------------------------
    def owner(self, unit: str) -> str:
        row = self.db.execute("SELECT owner FROM linked_owners WHERE unit=?", (unit,)).fetchone()
        return row["owner"] if row is not None and row["owner"] in OWNERS else "ha"

    def house(self) -> bool:
        """Mantel owns the rest of the entry (Step 7)."""
        return self.owner(HOUSE) == "mantel"

    def owns(self, tid: str | None) -> bool:
        """Mantel owns this tablet (an explicit move, or the whole entry)."""
        if not tid:
            return False
        return self.house() or self.owner(tid) == "mantel"

    def mantel_tablets(self) -> list[str]:
        rows = self.db.execute("SELECT unit FROM linked_owners WHERE owner='mantel' AND unit NOT IN (?,?)",
                               UNITS_NOT_TABLETS)
        return sorted(r["unit"] for r in rows)

    def bridge(self) -> str:
        """Who mirrors Mantel's entities in HA: ``hk_frontend`` (the default) or ``mantel`` (Mantel Link)."""
        return "mantel" if self.owner(BRIDGE) == "mantel" else "hk_frontend"

    def snapshot(self) -> dict[str, Any]:
        """The wire form HA is told: ``{"house": "ha"|"mantel", "tablets": [tablet ids Mantel owns],
        "bridge": "hk_frontend"|"mantel"}``."""
        return {"house": self.owner(HOUSE), "tablets": self.mantel_tablets(), "bridge": self.bridge()}

    def instance_id(self) -> str:
        """This Mantel's instance id: random, made once, never a secret. Mantel Link's config entry's
        unique id (hello, the Supervisor discovery, zeroconf), so one Mantel is one entry in HA."""
        got = self.remembered("instance") or {}
        iid = got.get("id")
        if isinstance(iid, str) and len(iid) == 32:
            return iid
        import secrets
        iid = secrets.token_hex(16)
        self.remember("instance", {"id": iid})
        return iid

    def rows(self) -> dict[str, dict[str, Any]]:
        return {r["unit"]: dict(r) for r in self.db.execute("SELECT * FROM linked_owners ORDER BY unit")}

    def report(self) -> dict[str, Any]:
        """For the REST: every tablet Mantel knows with its owner, and the house."""
        rows = self.rows()
        known = self.tablets()

        def one(unit: str, name: str | None) -> dict[str, Any]:
            r = rows.get(unit) or {}
            return {"unit": unit, "name": name, "owner": self.owner(unit), "changed": r.get("changed"),
                    "changed_by": r.get("changed_by")}
        tablets = [one(tid, name) for tid, name in sorted(known.items())]
        # a moved tablet Mantel no longer knows (removed from its settings) is still listed
        tablets += [one(u, None) for u in sorted(rows) if u not in UNITS_NOT_TABLETS and u not in known]
        b = rows.get(BRIDGE) or {}
        return {"house": one(HOUSE, "The rest of the entry (Seasonal decorations, Alarm PIN, Live TV)"),
                "tablets": tablets, "wire": self.snapshot(),
                "bridge": {"holder": self.bridge(), "changed": b.get("changed"), "changed_by": b.get("changed_by")}}

    # -- changing ------------------------------------------------------------------------------------
    def set(self, unit: str, owner: str, *, by: str | None = None, role: str | None = None) -> bool:
        """Move one unit. True if it changed. OwnershipError for an unknown unit or a broken rule."""
        if owner not in OWNERS:
            raise OwnershipError("invalid", "owner: ha or mantel")
        if not isinstance(unit, str) or not unit or unit == BRIDGE:
            raise OwnershipError("invalid", "unit: a tablet id or 'house'")
        known = self.tablets()
        if unit != HOUSE and unit not in known and unit not in self.rows():
            raise OwnershipError("unknown_tablet", f"no wall tablet {unit!r} in Mantel's settings "
                                 f"(known: {', '.join(sorted(known)) or 'none'})")
        before = self.owner(unit)
        if before == owner:
            return False
        if unit == HOUSE and owner == "mantel":
            left = sorted(t for t in known if self.owner(t) != "mantel")
            if left:
                raise OwnershipError("tablets_first", "move every tablet to Mantel before the rest of the entry "
                                     f"(still Home Assistant's: {', '.join(left)})")
        if unit != HOUSE and owner == "ha" and self.house():
            raise OwnershipError("house_first", "the rest of the entry is Mantel's: move it back to Home "
                                 "Assistant first, then the tablet")
        now = self.clock()
        if self.audit is not None:           # the audit row first, as rbac_store's config changes
            self.audit.config_event({"timestamp": now, "actor": by, "role": role, "action": "linked.owner",
                                     "detail": {"unit": unit, "from": before, "to": owner}})
        with self.db:
            self.db.execute("INSERT INTO linked_owners (unit, owner, changed, changed_by) VALUES (?,?,?,?) "
                            "ON CONFLICT(unit) DO UPDATE SET owner=excluded.owner, changed=excluded.changed, "
                            "changed_by=excluded.changed_by", (unit, owner, now, by))
        log.warning("linked mode: %s is now %s's (by %s)", unit, "Mantel Server" if owner == "mantel"
                    else "Home Assistant", by or "?")
        return True

    def set_bridge(self, holder: str, *, by: str | None = None, role: str | None = None) -> bool:
        """Hand the bridge to Mantel Link (``mantel``) or give it back to HK Frontend (``hk_frontend``).
        Audited first (``linked.bridge``). True if it changed. Whether the HA side can take it is
        ``bridge_check``'s (the REST runs it first)."""
        if holder not in BRIDGES:
            raise OwnershipError("invalid", "bridge: hk_frontend or mantel")
        before = self.bridge()
        if before == holder:
            return False
        now = self.clock()
        if self.audit is not None:
            self.audit.config_event({"timestamp": now, "actor": by, "role": role, "action": "linked.bridge",
                                     "detail": {"from": before, "to": holder}})
        owner = "mantel" if holder == "mantel" else "ha"
        with self.db:
            self.db.execute("INSERT INTO linked_owners (unit, owner, changed, changed_by) VALUES (?,?,?,?) "
                            "ON CONFLICT(unit) DO UPDATE SET owner=excluded.owner, changed=excluded.changed, "
                            "changed_by=excluded.changed_by", (BRIDGE, owner, now, by))
        log.warning("linked mode: the bridge in Home Assistant is now %s's (by %s)",
                    "Mantel Link" if holder == "mantel" else "HK Frontend", by or "?")
        return True

    # -- the house-level entities Mantel learned (linked_house.py) ------------------------------------
    def remembered(self, key: str) -> dict | None:
        row = self.db.execute("SELECT body FROM linked_house WHERE key=?", (key,)).fetchone()
        try:
            got = json.loads(row["body"]) if row is not None else None
        except (TypeError, ValueError):
            return None
        return got if isinstance(got, dict) else None

    def remember(self, key: str, body: dict) -> None:
        text = json.dumps(body, sort_keys=True)
        row = self.db.execute("SELECT body FROM linked_house WHERE key=?", (key,)).fetchone()
        if row is not None and row["body"] == text:
            return
        with self.db:
            self.db.execute("INSERT INTO linked_house (key, body, updated) VALUES (?,?,?) ON CONFLICT(key) DO "
                            "UPDATE SET body=excluded.body, updated=excluded.updated", (key, text, self.clock()))



def bridge_check(app: web.Application, holder: str) -> None:
    """Can Home Assistant's side take the bridge this way right now? OwnershipError if not.

    * To Mantel Link: Mantel Link is connected (protocol 2); and HK Frontend, if its Home Assistant
      has it (Mantel Link's report) or it is connected, is connected with the hand-over hooks
      (feature ``bridge``, its 9.10 release), so it stops mirroring before Mantel Link takes over.
    * Back to HK Frontend: HK Frontend is connected with those hooks (it takes the entries back)."""
    lk = app.get("linked")
    reg = lk.registry if lk is not None else None
    links = reg.clients_of("mantel") if reg is not None else []
    hks = reg.clients_of("hk_frontend") if reg is not None else []
    ready = [c for c in hks if "bridge" in c.features]
    if holder == "mantel":
        if not any(c.protocol >= 2 for c in links):
            raise OwnershipError("mantel_link_not_connected",
                                 "Mantel Link isn't connected. Add it in Home Assistant (Settings, Devices & "
                                 "Services) and wait until it says it is linked, then try again.")
        if any("bridge" not in c.features for c in hks):
            raise OwnershipError("hk_frontend_too_old",
                                 "HK Frontend in Home Assistant is linked but can't hand over yet: update it to "
                                 "its last release first (HACS), then try again.")
        has_hk = any((c.report.get("hk_frontend") or {}).get("installed") for c in links)
        if has_hk and not ready:
            raise OwnershipError("hk_frontend_not_linked",
                                 "Home Assistant still has HK Frontend, and it isn't linked to Mantel, so it can't "
                                 "let go of the bridge. Turn on HK Frontend, Configure, Linked to Mantel, or remove "
                                 "HK Frontend, then try again.")
    elif holder == "hk_frontend":
        if not ready:
            raise OwnershipError("hk_frontend_not_linked",
                                 "HK Frontend isn't linked to Mantel with its last release, so it can't take the "
                                 "bridge back. Install HK Frontend's last release and link it first.")
    else:
        raise OwnershipError("invalid", "bridge: hk_frontend or mantel")


def no_hk_frontend(app: web.Application) -> bool:
    """Home Assistant has no HK Frontend: Mantel Link is connected and says so, and no HK Frontend is linked."""
    lk = app.get("linked")
    reg = lk.registry if lk is not None else None
    if reg is None or reg.clients_of("hk_frontend"):
        return False
    links = [c for c in reg.clients_of("mantel") if c.protocol >= 2 and "hk_frontend" in c.report]
    return bool(links) and not any((c.report.get("hk_frontend") or {}).get("installed") for c in links)


def back_to_ha_check(app: web.Application) -> None:
    """Can a unit (a tablet, or ``house``) go back to Home Assistant? Only while HK Frontend is there to run it:
    once Mantel Link is connected and reports no HK Frontend in its Home Assistant (and no HK Frontend is linked),
    nothing would run the unit's engines or publish its entities, so the move is refused (install HK Frontend's
    last release again first). OwnershipError if not."""
    if no_hk_frontend(app):
        raise OwnershipError("no_hk_frontend",
                             "Home Assistant has no HK Frontend any more, so nothing there would run it. Mantel keeps "
                             "it. (To go back, install HK Frontend's last release and link it first.)")


AUTO_BY = "mantel:no_hk_frontend"


def take_house_alone(app: web.Application) -> bool:
    """Home Assistant has no HK Frontend (Mantel Link's report): the house is Mantel's, recorded once and
    audited (the rule that tablets move first is moot: with the house Mantel's, every tablet is). True if it
    changed now."""
    owners: LinkedOwners | None = app.get("linked_owners")
    if owners is None or owners.house() or not no_hk_frontend(app):
        return False
    now = owners.clock()
    if owners.audit is not None:
        owners.audit.config_event({"timestamp": now, "actor": AUTO_BY, "role": "service", "action": "linked.owner",
                                   "detail": {"unit": HOUSE, "from": "ha", "to": "mantel",
                                              "why": "Home Assistant has no HK Frontend"}})
    with owners.db:
        owners.db.execute("INSERT INTO linked_owners (unit, owner, changed, changed_by) VALUES (?,?,?,?) "
                          "ON CONFLICT(unit) DO UPDATE SET owner=excluded.owner, changed=excluded.changed, "
                          "changed_by=excluded.changed_by", (HOUSE, "mantel", now, AUTO_BY))
    log.warning("linked mode: the house is Mantel Server's (Home Assistant has no HK Frontend)")
    return True


async def changed(app: web.Application) -> None:
    """After a move: tell linked HA at once (an ``owners`` frame, BEFORE any entity changes, so HA
    never reads an entity going away as the tablet being deleted), then bring Mantel's published
    entities and engines in line."""
    owners: LinkedOwners = app["linked_owners"]
    lk = app.get("linked")
    if lk is not None:
        await lk.registry.set_owners(owners.snapshot())
    host = app.get("features")
    if host is not None:
        await host.reload()
    house = app.get("linked_house")
    if house is not None:
        await house.refresh()


# -- REST -------------------------------------------------------------------------------------------
def _who(request: web.Request, owner_only: bool) -> Any:
    from .sessions import identity
    ident = identity(request)
    role = getattr(ident.user, "role", None)
    if ident.user is None or ident.device is not None:
        raise web.HTTPForbidden(text="a person's own session only")
    if role not in (("owner",) if owner_only else ("owner", "admin")):
        raise web.HTTPForbidden(text="Owner only" if owner_only else "Owner or Admin only")
    authz = request.app.get("authz")
    home = ident.door == "lan" or (authz is not None and authz.home_door(ident))
    if owner_only and not home:
        # the LAN door, or HA's sidebar with the home rules (the HA App has no LAN door; HA-APP.md)
        raise web.HTTPForbidden(text="ownership is changed on the LAN (or a trusted HA sidebar) only")
    return ident


def _state(app: web.Application) -> dict[str, Any]:
    lk = app.get("linked")
    clients = [c for c in lk.registry.clients if not c.ws.closed] if lk is not None else []
    return {**app["linked_owners"].report(),
            "linked_clients": len(clients),
            "links": sorted((c.describe() for c in clients), key=lambda d: (d["domain"], d["since"] or 0))}


async def api_get(request: web.Request) -> web.Response:
    _who(request, owner_only=False)
    return web.json_response(_state(request.app))


async def api_put(request: web.Request) -> web.Response:
    ident = _who(request, owner_only=True)
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"error": {"code": "invalid", "message": "a JSON body"}}, status=400)
    if not isinstance(body, dict) or set(body) - {"unit", "owner"}:
        return web.json_response({"error": {"code": "invalid", "message": "{unit, owner}"}}, status=400)
    owners: LinkedOwners = request.app["linked_owners"]
    try:
        if body.get("unit") == BRIDGE:
            # the bridge (Mantel Link or HK Frontend): {"unit": "bridge", "owner": "mantel"|"hk_frontend"}
            holder = body.get("owner")
            if holder != owners.bridge():
                bridge_check(request.app, holder)
            moved = owners.set_bridge(holder, by=ident.user.id, role=ident.user.role)
        else:
            if body.get("owner") == "ha" and owners.owner(str(body.get("unit"))) != "ha":
                back_to_ha_check(request.app)
            moved = owners.set(body.get("unit"), body.get("owner"), by=ident.user.id, role=ident.user.role)
    except OwnershipError as exc:
        return web.json_response({"error": {"code": exc.code, "message": exc.message}}, status=400)
    if moved:
        await changed(request.app)
    return web.json_response({"changed": moved, **_state(request.app)})


def _tablets_of(app: web.Application) -> Callable[[], dict[str, str]]:
    def tablets() -> dict[str, str]:
        host = app.get("features")
        if host is not None and host.tablets:
            return {tid: str(t.get("name") or tid) for tid, t in host.tablets.items()}
        svc = app.get("settings")
        if svc is None:
            return {}
        return {tid: str((d.body or {}).get("name") or tid) for tid, d in svc.store.docs("tablet").items()}
    return tablets


def register(app: web.Application, hub: Any = None) -> LinkedOwners:
    """``app["linked_owners"]`` over the app's database, its REST, and the link told the ownership
    (before ``linked.register``'s registry is used, or after: both read the same rows)."""
    if "linked_owners" in app:
        return app["linked_owners"]
    conn = app["store"].db
    ensure_schema(conn)                         # the runner has applied 0009 already; idempotent
    owners = LinkedOwners(conn, lambda: app["clock"](), _tablets_of(app), app.get("audit"))
    app["linked_owners"] = owners
    lk = app.get("linked")
    if lk is not None:
        lk.registry.owners = owners.snapshot()
        lk.instance = owners.instance_id()

        def on_report(_client: Any) -> None:           # Mantel Link said what its Home Assistant has
            if take_house_alone(app):
                import asyncio
                asyncio.get_running_loop().create_task(changed(app))
        lk.listeners.append(on_report)
    app.router.add_get("/api/linked/owners", api_get)
    app.router.add_put("/api/linked/owners", api_put)
    return owners
