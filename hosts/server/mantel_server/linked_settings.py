"""HK's settings for a linked HK Frontend (decision 29, docs/phase9/TWO-PRODUCTS.md "one copy of the settings").

A linked HK Frontend whose house is Mantel's runs nothing of its own, yet its dashboards in Home Assistant still
draw: they read HK's settings feed. This sends them Mantel's, so there is one copy. HK Frontend keeps the last one
it was sent (its mirror) and answers its dashboards from it, also while Mantel can't be reached.

    Mantel -> HK Frontend   settings {version, payload}

* Only to a client that asked (``features=settings`` in its ``X-Mantel-Link`` header): an HK Frontend from before
  this never gets a frame it doesn't know.
* ``payload`` is the house's feed (``SettingsService.house_feed``): no person's own look or sky, as HA's feed never
  had one. ``version`` is a digest of it, so the same settings sent again are recognised and ignored.
* Sent right after the client's hello, and again whenever the settings feed is published (a save, a restore, the
  import, a feature's change). Changes close together go out once (``DEBOUNCE_S``).

    HK Frontend -> Mantel   settings_write {id, ha_user, msg}   -> result

* One save from HK Frontend's dashboards in Home Assistant (a favorite, a calendar's color, an accessory's
  settings, ...), exactly as the page sends it (``msg``), made AS THE PERSON linked to the Home Assistant user who
  made it (``ha_user``; the ``ha_links`` table, as Ingress and "Sign in with Home Assistant" use). Mantel's RBAC
  decides (``configure``), and the settings history says the person, from Home Assistant.
* Only with the Service account's ``linked_saves`` scope (Mantel Settings -> Mantel in Home Assistant -> HK Frontend -> Changes
  from Home Assistant): it lets the credential say which Home Assistant user is acting, as the Supervisor does for Ingress.
* Refused in words: the scope off, an unlinked or disabled user, or the save itself (RBAC, a bad value).

SETUP (Mantel Settings -> Connections -> Mantel in Home Assistant), Owner and Admin read, Owner changes, each audited:

    GET /api/linked/ha-saves     whether saves are on (Changes from Home Assistant), and Home Assistant's people
    PUT /api/linked/ha-saves     {"on": bool}                    the linked HK Frontends' linked_saves scope
    (an HA user is linked to a person on People: people_ha.py)

Each ``settings`` frame also carries ``setup``: ``{"saves": bool, "unlinked_admins": n}``, so HK Frontend raises a
Repairs issue while Home Assistant admins can't save. Home Assistant's users are read by Mantel's own connection to
it (ingress.HaDirectory), never sent by HK Frontend.

Mantel never asks Home Assistant to do anything through the link.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from typing import Any

from aiohttp import web

log = logging.getLogger("mantel.linked_settings")

FEATURE = "settings"
SAVES = "linked_saves"                  # the Service account's scope for settings_write
LABEL = "Home Assistant"                # where a forwarded save came from, in the settings history
DEBOUNCE_S = 0.25
_HA_USER = re.compile(r"^[0-9a-f]{32}$")
OFF = ("Changes made in Home Assistant aren't saved. An Owner turns them on in Mantel Settings: Connections, "
       "Mantel in Home Assistant, HK Frontend, Changes from Home Assistant.")
UNLINKED = ("Link your Home Assistant user to your person in Mantel to save settings (Mantel Settings, People, "
            "Home Assistant Users).")


def version_of(payload: Any) -> str:
    """A digest of the payload: the same settings give the same version."""
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


def frame_of(service: Any, setup: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = service.house_feed()
    return {"type": "settings", "version": version_of(payload), "payload": payload,
            "setup": dict(setup or {"saves": False, "unlinked_admins": 0})}


def wants(client: Any) -> bool:
    return client.domain == "hk_frontend" and FEATURE in client.features and not client.ws.closed


class LinkedSettings:
    """Sends the settings to every linked HK Frontend that asked for them."""

    def __init__(self, linked: Any, service: Any, db: Any = None, debounce: float = DEBOUNCE_S) -> None:
        self.linked, self.service, self.db, self.debounce = linked, service, db, debounce
        self._task: asyncio.Task | None = None
        self.sent = 0                       # frames sent (the tests read it)
        self.directory: Any = None          # ingress.HaDirectory: Home Assistant's users (register sets it)
        self.unlinked_admins = 0            # the last count (refresh)

    async def write(self, client: Any, msg: dict[str, Any]) -> Any:
        """One ``settings_write``: the save, as the linked person. Raises LinkedError to refuse."""
        from .ingress import linked_user
        from .linked import LinkedError
        from .sessions import Identity, User
        from .settings_store import SettingsError
        if not wants(client):
            raise LinkedError("not_set_up", "only a linked HK Frontend that keeps Mantel's settings saves them")
        if SAVES not in getattr(client.account, "scopes", ()):
            raise LinkedError("saves_off", OFF)
        ha_user, save = msg.get("ha_user"), msg.get("msg")
        if not isinstance(ha_user, str) or not _HA_USER.match(ha_user):
            raise LinkedError("invalid", "ha_user: a Home Assistant user id")
        if not isinstance(save, dict):
            raise LinkedError("invalid", "msg: the save, an object")
        row = linked_user(self.db, ha_user)
        if row is None or row["disabled"]:
            log.warning("linked settings: refused a save from an unlinked Home Assistant user")
            raise LinkedError("not_linked", UNLINKED)
        user = User(id=row["id"], name=row["name"], role=row["role"], kind=row["kind"], username=row["username"],
                    ha_user_id=row["ha_user_id"])
        try:
            return await self.service.save(Identity(user=user, device=None, door="ha"), save, LABEL)
        except SettingsError as exc:
            raise LinkedError(exc.code, str(exc) or exc.code) from None

    def clients(self) -> list[Any]:
        return [c for c in list(self.linked.registry.clients) if wants(c)]

    def saves_on(self) -> bool:
        return any(SAVES in getattr(c.account, "scopes", ()) for c in self.clients())

    def setup(self, client: Any) -> dict[str, Any]:
        return {"saves": SAVES in getattr(client.account, "scopes", ()), "unlinked_admins": self.unlinked_admins}

    async def people(self) -> list[dict[str, Any]]:
        """Home Assistant's people (no system users, no deactivated ones), each with who it is in Mantel."""
        from .ingress import household, is_ha_admin, linked_user, tablet_link
        directory = self._directory()
        if directory is None:
            return []
        out = []
        for u in household(await directory.users()):
            row = linked_user(self.db, u["id"]) if self.db is not None else None
            tab = tablet_link(self.db, u["id"]) if self.db is not None else None
            out.append({"id": u["id"], "name": u.get("name") or u.get("username") or "?", "admin": is_ha_admin(u),
                        "tablet": tab is not None,
                        "person": None if row is None else {"name": row["name"], "role": row["role"],
                                                            "disabled": bool(row["disabled"])}})
        return sorted(out, key=lambda p: (not p["admin"], str(p["name"]).lower()))

    def _directory(self) -> Any:
        return self.directory() if callable(self.directory) else self.directory

    async def refresh(self) -> None:
        """Count the Home Assistant admins who can't save (not linked, or linked to a disabled person)."""
        try:
            people = await self.people()
        except Exception as exc:  # noqa: BLE001 -- HA unreachable: keep the last count
            log.info("linked settings: Home Assistant's users were not read (%s)", type(exc).__name__)
            return
        self.unlinked_admins = sum(1 for p in people if p["admin"] and not p["tablet"]
                                   and (p["person"] is None or p["person"]["disabled"]))

    async def on_connect(self, client: Any) -> None:
        if wants(client):
            await self.refresh()
            await self._send([client], frame_of(self.service, self.setup(client)))

    async def resend(self) -> None:
        """The setup changed (saves on or off, a person linked): every HK Frontend told now."""
        await self.refresh()
        for client in self.clients():
            await self._send([client], frame_of(self.service, self.setup(client)))

    def changed(self) -> None:
        """The feed was published: send it again soon, once for a burst of changes."""
        if not self.clients() or (self._task is not None and not self._task.done()):
            return
        try:
            self._task = asyncio.get_running_loop().create_task(self._later())
        except RuntimeError:                # no loop (a save outside the server): nothing linked to tell
            self._task = None

    async def _later(self) -> None:
        await asyncio.sleep(self.debounce)
        for client in self.clients():
            await self._send([client], frame_of(self.service, self.setup(client)))

    async def _send(self, clients: list[Any], frame: dict[str, Any]) -> None:
        text = json.dumps(frame)
        for client in clients:
            if await client.send_text(text):
                self.sent += 1
            else:
                log.info("linked settings: a client went away before its settings were sent")


# -- setup: REST ------------------------------------------------------------------------------------
async def api_get(request: web.Request) -> web.Response:
    from .linked_owners import _who
    _who(request, owner_only=False)
    ls: LinkedSettings = request.app["linked_settings"]
    try:
        people, error = await ls.people(), None
    except Exception as exc:  # noqa: BLE001 -- the page says HA's users could not be read
        people, error = [], "Home Assistant's users could not be read (" + type(exc).__name__ + ")"
    return web.json_response({"saves": ls.saves_on(), "hk_frontends": len(ls.clients()), "people": people,
                              "error": error, "roles": list(_link_roles())})


def _link_roles() -> tuple[str, ...]:
    from .ingress import LINK_ROLES
    return LINK_ROLES


async def api_put(request: web.Request) -> web.Response:
    from .ingress import _audit, linked_user, tablet_link
    from .linked_owners import _who
    ident = _who(request, owner_only=True)
    app, ls = request.app, request.app["linked_settings"]
    try:
        body = await request.json()
    except ValueError:
        body = None

    def bad(code: str, message: str, status: int = 400) -> web.Response:
        return web.json_response({"error": {"code": code, "message": message}}, status=status)

    if isinstance(body, dict) and set(body) == {"on"} and isinstance(body["on"], bool):
        clients = ls.clients()
        if not clients:
            return bad("no_hk_frontend", "No HK Frontend is linked to Mantel right now.", 409)
        changed = [c.account.id for c in clients
                   if app["service_accounts"].set_scope(c.account.id, SAVES, body["on"])]
        for c in clients:                       # the open links see it at once (the credential is rechecked)
            c.account = type(c.account)(c.account.id, c.account.name,
                                        frozenset(c.account.scopes | {SAVES}) if body["on"]
                                        else frozenset(c.account.scopes - {SAVES}))
        _audit(app, ident.user.id, ident.user.role, "linked.saves", {"on": body["on"], "accounts": changed})
        await ls.resend()
        return web.json_response({"saves": ls.saves_on()})
    return bad("invalid", '{"on": bool} (a Home Assistant user is linked to a person on People: /api/people/ha)')


def place_of(app: web.Application) -> Any:
    """Where each screen is drawn, for HK Settings' list of screens (decision 29: each screen in one place). A
    screen is Mantel's or Home Assistant's (its ``where``); a Mantel screen whose address HK Frontend also has a
    dashboard at is flagged (``conflict``), and its page offers to keep it Mantel's, make it Home Assistant's, or
    split it (screens.py)."""
    def place(path: str) -> dict[str, Any] | None:
        svc = app.get("settings")
        doc = svc.store.get("board", path) if svc is not None else None
        where = "ha" if doc is not None and (doc.body or {}).get("where") == "ha" else "mantel"
        lk = app.get("linked")
        hk = any(b.get("path") == path for c in (lk.registry.clients if lk is not None else ())
                 if c.domain == "hk_frontend" and not c.ws.closed for b in c.report.get("hk_dashboards") or [])
        sidebar = path in (app.get("ha_sidebar_screens") or {})
        if where == "ha":
            return {"text": "Home Assistant" + (" · HK Frontend" if hk else " · no dashboard there yet"),
                    "icon": "mdi:home-assistant", "also": True, "where": "ha"}
        if hk:
            return {"text": "Mantel, and Home Assistant has a dashboard at the same address",
                    "icon": "mdi:alert-circle-outline", "conflict": True, "where": "mantel"}
        if sidebar:
            return {"text": "Mantel · in Home Assistant’s sidebar", "icon": "mdi:fireplace", "where": "mantel"}
        return {"text": "Mantel", "icon": "mdi:fireplace", "where": "mantel"}
    return place


def register(app: web.Application) -> LinkedSettings:
    """After settings_store.register and linked.register."""
    ls = LinkedSettings(app["linked"], app["settings"], app["store"].db)
    ls.directory = lambda: app.get("ha_directory")      # made by ingress.register (the App, Mantel Connect)
    app.router.add_get("/api/linked/ha-saves", api_get)
    app.router.add_put("/api/linked/ha-saves", api_put)
    app["linked"].on_connect.append(ls.on_connect)
    app["linked"].settings_write = ls.write
    app["settings"].watchers.append(ls.changed)
    app["settings"].place = place_of(app)
    app["linked_settings"] = ls
    return ls
