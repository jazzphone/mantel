"""Mantel Settings → Advanced → Assistants (MCP): the REST behind the page (web/shim/settings/assistants.js).

* ``GET /api/mcp``: the house's switches, this Mantel's MCP address, and the assistants: an Owner sees everyone's,
  an Admin their own. Owners and Admins, on the home network (or HA's sidebar with the home rules).
* ``PUT /api/mcp/settings`` ``{key: value}``: one switch (config.py). An Owner only; audited first
  (``mcp.settings``). Turning assistants off refuses every credential at once (they are kept); turning
  ``mcp_commands`` off takes the commands scope away at once.
* ``POST /api/mcp/keys`` ``{name, scopes}``: a personal key, shown once (grants.create_key). An Owner or Admin for
  themselves, on the home network, with a fresh sign-in (adding a credential is adding a way in:
  accounts.require_fresh_to_add_factor). Audited first (``mcp.key.create``).
* ``DELETE /api/mcp/grants/{id}``: Revoke: one's own, or anyone's for an Owner. Audited first (``mcp.revoke``).
"""
from __future__ import annotations

from aiohttp import web

from .. import audit
from ..accounts import read_json
from ..guards import guard
from ..guards import ident as guarded
from ..sessions import error, ok
from .config import DEFAULTS, Invalid
from .grants import DEFAULT_SCOPES, KEY_SCOPES, SCOPES, GrantError


def _endpoint(request: web.Request) -> str:
    from .protocol import resource_url
    return resource_url(request)


@guard("manager", door="home", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    ident = guarded(request)
    app = request.app
    owner = ident.user.role == "owner"
    grants = app["mcp_grants"].list(None if owner else ident.user.id)
    return web.json_response({
        "settings": app["mcp_settings"].all(), "may_configure": owner, "endpoint": _endpoint(request),
        "scopes": list(SCOPES), "key_scopes": list(KEY_SCOPES), "default_scopes": list(DEFAULT_SCOPES),
        "commands_on": app.get("gateway") is not None, "me": ident.user.id,
        "assistants": grants}, headers={"Cache-Control": "no-store"})


@guard("owner", door="home", audit="mcp.settings")
async def api_settings(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    if len(body) != 1 or next(iter(body)) not in DEFAULTS:
        return error(400, "invalid", message="one of " + ", ".join(DEFAULTS))
    key, value = next(iter(body.items()))
    s = request.app["mcp_settings"]
    try:
        from .config import clean
        value = clean(key, value)
    except Invalid as exc:
        return error(400, "invalid", message=str(exc))
    try:
        audit.config(request, ident, "mcp.settings", {"key": key, "from": s.get(key), "to": value})
    except audit.Unavailable:
        return error(503, "audit_unavailable")
    s.put(key, value, ident.user.id)
    return ok({"settings": s.all()})


@guard("manager", door="lan", fresh="add_factor", audit="mcp.key.create")
async def api_make_key(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    app = request.app
    from ..sessions import client_ip
    try:
        grant, token = app["mcp_grants"].create_key(
            ident.user, body.get("name"), body.get("scopes") if body.get("scopes") is not None else list(DEFAULT_SCOPES),
            int(app["mcp_settings"].get("mcp_key_days")), source_ip=client_ip(request),
            before=lambda gid, name, scopes: audit.config(request, ident, "mcp.key.create",
                                                          {"grant": gid, "name": name, "scopes": scopes}))
    except GrantError as exc:
        return error(400, "invalid", message=str(exc))
    except audit.Unavailable:
        return error(503, "audit_unavailable")
    return web.json_response({"assistant": {"id": grant.id, "name": grant.name, "scopes": sorted(grant.scopes),
                                            "expires": grant.expires},
                              "token": token, "endpoint": _endpoint(request)},
                             status=201, headers={"Cache-Control": "no-store"})


@guard("manager", door="home", audit="mcp.revoke")
async def api_revoke(request: web.Request) -> web.Response:
    ident = guarded(request)
    grants = request.app["mcp_grants"]
    g = grants.get(request.match_info["id"])
    if g is None or (g.user_id != ident.user.id and ident.user.role != "owner"):
        return error(404, "not_found")
    try:
        audit.config(request, ident, "mcp.revoke", {"grant": g.id, "name": g.name, "person": g.user_id})
    except audit.Unavailable:
        return error(503, "audit_unavailable")
    if not grants.revoke(g.id, "revoked in Mantel Settings"):
        return error(404, "not_found")
    return ok()


def register(app: web.Application) -> None:
    app.router.add_get("/api/mcp", api_get)
    app.router.add_put("/api/mcp/settings", api_settings)
    app.router.add_post("/api/mcp/keys", api_make_key)
    app.router.add_delete("/api/mcp/grants/{id}", api_revoke)
