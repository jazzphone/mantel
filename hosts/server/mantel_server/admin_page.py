"""Mantel Server's admin page: ``/admin``, a UI over the management APIs that already exist.

The page is static (HTML, one JS module, one stylesheet in ``static/admin/``) and holds no secret. It
is served only to a signed-in person: a signed-out browser is sent to ``/login``, a wall tablet on its
own gets a short refusal. Every number and every action goes through the REST routes the other
modules already guard (``/api/users``, ``/api/devices``, ``/api/rbac/…``, ``/api/service-accounts``,
``/api/audit``, ``/api/account/pin`` …), so the server stays the one place that decides.

The one thing added here is a read the UI was missing, ``GET /api/admin/overview``: who I am (with the
sign-in factors I have, which no existing read tells me), the door, my CSRF token, the lists the
forms offer (roles, actions, features, …) and **which sections this identity may use**. The section
list uses the same checks as the routes behind them (Owner/Admin for people and devices, Owner for
roles and service accounts, the ``configure`` grant on the ``audit`` feature for the audit), so a
section is hidden exactly when its API would refuse; the API still refuses on its own.

CSP (docs/phase3/PACKAGING.md): the page needs ``script-src 'self'`` and, being all external files with
no ``style`` attributes, also ``style-src 'self'``. No inline script, handler or style.
"""
from __future__ import annotations

from importlib.resources import files

from aiohttp import web

from . import rbac
from .accounts import MANAGERS
from .devices import DEVICE_ROLES
from .login_page import login_url
from .service_accounts import SCOPES as SERVICE_SCOPES
from .sessions import Identity, identity
from .store import ROLES

PAGE = "/admin"
ASSET = PAGE + "/{name}"
OVERVIEW = "/api/admin/overview"
ASSETS = {"admin.js": "text/javascript", "admin.css": "text/css"}
# admin.js imports ../webauthn.js (the passkey helpers shared with /login), served by login_page.py
SECTIONS = ("me", "people", "devices", "files", "roles", "service", "audit")

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
HEADERS = {"Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
           "Referrer-Policy": "same-origin"}


def _static(name: str) -> str:
    return files("mantel_server").joinpath("static/admin/" + name).read_text(encoding="utf-8")


def sections_for(request: web.Request, ident: Identity) -> list[str]:
    """The sections this identity may use: the checks of the routes behind them, read once."""
    if ident.user is None:
        return []
    out = ["me"]
    if ident.device is not None:           # a person at a wall tablet gets the tablet's share: none of these
        return out
    role = ident.user.role
    if role in MANAGERS:                   # accounts.require_manager guards /api/users and /api/devices
        out += ["people", "devices", "files"]   # files: user_files' REST, also require_manager
    if role == "owner":                    # rbac_store's REST is Owner-only
        out.append("roles")
        if ident.door == "lan":            # service_accounts' REST: an Owner's own session, LAN door only
            out.append("service")
    authz = request.app.get("authz")
    if authz is not None:                  # GET /api/audit: `configure` on the feature `audit`
        if authz.decide(authz.principal(request).subject, "configure", None, feature="audit").allowed:
            out.append("audit")
    elif role in MANAGERS:
        out.append("audit")
    return sorted(out, key=SECTIONS.index)


async def page(request: web.Request) -> web.StreamResponse:
    ident = identity(request)
    if ident.user is None and ident.device is None:
        raise web.HTTPFound(login_url(PAGE))   # "/admin" is a public path so that this can be a redirect, not a 401
    if ident.user is None:
        body = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport "
                "content='width=device-width,initial-scale=1'><title>Mantel admin</title>"
                "<link rel=stylesheet href='/admin/admin.css'><main class=plain><h1>Mantel admin</h1>"
                "<p>This browser is a wall tablet. Sign in as a person to manage the house.</p></main>")
        return web.Response(text=body, status=403, content_type="text/html", headers=HEADERS)
    return web.Response(text=_static("index.html"), content_type="text/html", headers=HEADERS)


async def asset(request: web.Request) -> web.StreamResponse:
    name = request.match_info["name"]
    if name not in ASSETS:
        raise web.HTTPNotFound()
    return web.Response(text=_static(name), content_type=ASSETS[name], charset="utf-8", headers=HEADERS)


async def overview(request: web.Request) -> web.Response:
    ident = identity(request)
    if ident.user is None:
        return web.json_response({"error": "user_required"}, status=403, headers=HEADERS)
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
    }, headers=HEADERS)


def register(app: web.Application, hub=None) -> None:
    """Add ``/admin``, its two assets and ``GET /api/admin/overview``. Call after ``accounts.register``
    and (for the audit section) after ``wire`` has put ``app["authz"]`` in place."""
    app.setdefault("public_paths", set()).add(PAGE)    # the handler redirects a signed-out browser itself
    app.router.add_get(PAGE, page)
    app.router.add_get(ASSET, asset)
    app.router.add_get(OVERVIEW, overview)
