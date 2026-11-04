"""Mantel Server's admin page: ``/admin``, a UI over the management APIs that already exist.

Since Mantel Settings (``/settings``: HK Settings' page with Mantel's own pages in it, web/shim/
mantel-settings.js) ``/admin`` sends browsers there, keeping the query (``?connection=`` from Home
Assistant's sign-in) and, in the browser, the fragment (``#connections``, which Mantel Settings maps to
its own page). ``/admin?plain=1`` still serves this page as it was: the fallback when Mantel Settings
can't load (its error links here), until Phase 7 retires it.

The page is static (HTML, one JS module, one stylesheet in ``static/admin/``) and holds no secret. It
is served only to a signed-in person: a signed-out browser is sent to ``/login``, a wall tablet on its
own gets a short refusal. Every number and every action goes through the REST routes the other
modules already guard (``/api/users``, ``/api/devices``, ``/api/rbac/…``, ``/api/service-accounts``,
``/api/audit``, ``/api/account/pin`` …), so the server stays the one place that decides.

The one thing added here is a read the UI was missing, ``GET /api/admin/overview``: who I am (with the
sign-in factors I have, which no existing read tells me), the door, my CSRF token, the lists the
forms offer (roles, actions, features, …) and **which sections this identity may use**. The section
list uses the same checks as the routes behind them (Owner/Admin for people and devices, Owner for
roles and service accounts, Owner/Admin for Connections, the ``configure`` grant on the ``audit`` feature for the audit), so a
section is hidden exactly when its API would refuse; the API still refuses on its own.

CSP (docs/phase3/PACKAGING.md): the page needs ``script-src 'self'`` and, being all external files with
no ``style`` attributes, also ``style-src 'self'``. No inline script, handler or style.
"""
from __future__ import annotations

import re
from importlib.resources import files

from aiohttp import web

from . import frame_origins, ingress, rbac, security_headers, setup_guide
from .accounts import MANAGERS
from .devices import DEVICE_ROLES
from .guards import WHY_STATIC, guard, open_route
from .guards import ident as guarded
from .login_page import login_url
from .service_accounts import SCOPES as SERVICE_SCOPES
from .sessions import Identity, identity
from .store import ROLES

PAGE = "/admin"
_PENDING_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")    # a pending connection's id (connections.py), carried over
ASSET = PAGE + "/{name}"
OVERVIEW = "/api/admin/overview"
ASSETS = {"admin.js": "text/javascript", "admin.css": "text/css"}
# admin.js imports ../webauthn.js (the passkey helpers shared with /login), served by login_page.py
SECTIONS = ("me", "connections", "cameras", "general", "people", "devices", "files", "photos", "backups", "alerts", "timeline", "roles", "service", "connect",
            "assistants", "audit", "about", "performance")

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
HEADERS = {"Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
           "Referrer-Policy": "same-origin"}


def _static(name: str) -> str:
    return files("mantel_server").joinpath("static/admin/" + name).read_text(encoding="utf-8")


def _headers(request: web.Request) -> dict:
    """The page's headers. Through Home Assistant's Ingress the page is framed by HA's own page (same
    origin), so frame-ancestors is 'self' there; the operator's frame-ancestors (HA's Webpage dashboards
    showing the direct address) may frame it too; everywhere else it stays 'none'."""
    csp = security_headers.own_page_csp(CSP, request.app.get("cfg"), ingress=bool(request.get("mantel_base")),
                                       ancestors=frame_origins.ancestors(request.app))
    return HEADERS if csp == CSP else {**HEADERS, "Content-Security-Policy": csp}


def sections_for(request: web.Request, ident: Identity) -> list[str]:
    """The sections this identity may use: the checks of the routes behind them, read once."""
    if ident.user is None:
        return []
    out = ["me"]
    if ident.device is not None:           # a person at a wall tablet gets the tablet's share: none of these
        return out
    out.append("about")                    # about.py: anyone signed in, away from a wall tablet
    role = ident.user.role
    if role in MANAGERS:                   # accounts.require_manager guards /api/users and /api/devices
        out += ["people", "devices", "files", "photos"]   # files, photos: their REST is also require_manager
        out.append("backups")              # backup.py: Owner/Admin read; only an Owner backs up, saves keys, restores
        out.append("alerts")               # alerts/api.py: Owner/Admin read; only an Owner changes a channel
        out.append("timeline")             # timeline/api.py: Owner/Admin read; only an Owner changes it (a fresh sign-in away)
        out.append("connections")          # connections.py: Owner/Admin read; only an Owner changes
        out.append("cameras")              # camera_setup.py: Owner/Admin read and change (an Admin from away asks a fresh sign-in)
        out.append("general")              # server_settings.py: the same rule
        out.append("performance")          # performance.py: GET /api/performance, managers; shown in About
    authz = request.app.get("authz")
    # Assistants (MCP): mcp/admin.py's GET, an Owner or Admin on the home network (or HA's sidebar with the home rules)
    if role in MANAGERS and (ident.door == "lan" or (authz is not None and hasattr(authz, "home_door")
                                                     and authz.home_door(ident))):
        out.append("assistants")
    if role == "owner":                    # rbac_store's REST is Owner-only
        out.append("roles")
        # service_accounts' REST: an Owner's own session on the LAN door, or HA's sidebar with the home
        # rules (service_accounts._owner; the HA App has no LAN door, so the section was never shown there:
        # the house, 2026-10-18, needed for linked mode's credential)
        if ident.door == "lan" or (authz is not None and hasattr(authz, "home_door") and authz.home_door(ident)):
            out.append("service")
            if getattr(request.app["cfg"], "connect", False):    # Mantel Connect pairing (connect_pairing.py): same rule
                out.append("connect")
    authz = request.app.get("authz")
    if authz is not None:                  # GET /api/audit: `configure` on the feature `audit`
        if authz.decide(authz.principal(request).subject, "configure", None, feature="audit").allowed:
            out.append("audit")
    elif role in MANAGERS:
        out.append("audit")
    return sorted(out, key=SECTIONS.index)


@open_route("static", why="the admin page shell: signed out it sends the browser to /login, a person goes on to Settings; the data behind it is guarded")
async def page(request: web.Request) -> web.StreamResponse:
    ident = identity(request)
    if ident.user is None and ident.device is None:
        raise web.HTTPFound(login_url(PAGE))   # "/admin" is a public path so that this can be a redirect, not a 401
    if request.query.get("plain") != "1" and ident.user is not None and ident.device is None:
        pid = request.query.get("connection", "")
        raise web.HTTPFound("/settings" + (f"?connection={pid}" if _PENDING_ID.fullmatch(pid) else ""))
    if ident.user is None:
        body = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport "
                "content='width=device-width,initial-scale=1'><title>Mantel admin</title>"
                "<link rel=stylesheet href='/admin/admin.css'><main class=plain><h1>Mantel admin</h1>"
                "<p>This browser is a wall tablet. Sign in as a person to manage the house.</p></main>")
        return web.Response(text=ingress.own_page(body, request.get("mantel_base", "")), status=403,
                            content_type="text/html", headers=_headers(request))
    return web.Response(text=ingress.own_page(_static("index.html"), request.get("mantel_base", "")),
                        content_type="text/html", headers=_headers(request))


@open_route("static", why=WHY_STATIC)
async def asset(request: web.Request) -> web.StreamResponse:
    name = request.match_info["name"]
    if name not in ASSETS:
        raise web.HTTPNotFound()
    return web.Response(text=_static(name), content_type=ASSETS[name], charset="utf-8", headers=HEADERS)


@guard("person", device_ok=True, reads="self")      # a person, at a wall tablet too: sections_for gives them Me only
async def overview(request: web.Request) -> web.Response:
    ident = guarded(request)
    accounts = request.app["accounts"]
    row = accounts.get_user(ident.user.id)
    return web.json_response({
        "user": accounts.describe(row) if row is not None else None,
        "door": ident.door,
        "csrf": ident.csrf,
        "fresh_factor_at": ident.fresh_factor_at,
        "now": request.app["clock"](),
        "at_tablet": ident.device is not None,
        "sections": sections_for(request, ident),
        "roles": list(ROLES),
        "device_roles": list(DEVICE_ROLES),
        "actions": list(rbac.ACTIONS),
        "resource_kinds": list(rbac.RESOURCE_KINDS),
        "features": list(rbac.FEATURES),
        "service_scopes": sorted(SERVICE_SCOPES),
        "connect_port": getattr(request.app["cfg"], "connect_port", None),
        # first run: the page opens Connections while Home Assistant is not set up (connections.py)
        "ha_set_up": (request.app["connections"].current("ha") is not None) if "connections" in request.app else True,
        # Set Up Mantel (setup_guide.py): whether it opens first, for the people who manage the house
        "setup": setup_guide.summary(request.app) if ident.device is None and ident.user.role in MANAGERS
        and "accounts" in request.app and "store" in request.app else None,
    }, headers=HEADERS)


def register(app: web.Application, hub=None) -> None:
    """Add ``/admin``, its two assets and ``GET /api/admin/overview``. Call after ``accounts.register``
    and (for the audit section) after ``wire`` has put ``app["authz"]`` in place."""
    app.setdefault("public_paths", set()).add(PAGE)    # the handler redirects a signed-out browser itself
    app.router.add_get(PAGE, page)
    app.router.add_get(ASSET, asset)
    app.router.add_get(OVERVIEW, overview)
