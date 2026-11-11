"""A screen's preview, opened by the assistant's own browser (docs/phase12/MCP-SERVER.md "Previews": on the client
side, no browser in Mantel's image).

``screen_preview`` answers a one-time link, ``/mcp/preview/<code>``: single use, five minutes, for the person the
assistant acts for, kept in memory only (a restart forgets it). Opening it starts a **read-only** browser session
(method ``mcp_preview``, ten minutes, no refresh) and lands on the screen: the page draws as that person sees it,
and nothing it could send changes anything (sessions.Identity.read_only: the session middleware and every guard
refuse a change, the socket takes reads only, the gateway refuses every command).

A browser already signed in as that person is not signed in again (its own session draws the screen); one signed
in as someone else is refused, rather than signing them out. Off-site only as the grant itself may be used.
"""
from __future__ import annotations

import hashlib
import secrets
from urllib.parse import quote

from aiohttp import web

from ..identity import sessions
from ..identity.guards import open_route

PATH = "/mcp/preview/{code}"
CODE_TTL = 300.0
SESSION_TTL = 600.0
MAX_OPEN = 50


def _codes(app) -> dict:
    return app["mcp_preview_codes"]


def make_link(caller, screen: str, width: int, height: int) -> dict:
    app = caller.app
    now = app["clock"]()
    codes = _codes(app)
    for k in [k for k, v in codes.items() if v["expires"] <= now]:
        del codes[k]
    if len(codes) >= MAX_OPEN:
        from .dispatch import ToolError
        raise ToolError("rate_limited", "too many open previews: use one, or wait five minutes")
    code = secrets.token_urlsafe(24)
    codes[hashlib.sha256(code.encode()).hexdigest()] = {
        "user": caller.user.id, "grant": caller.grant.id, "name": caller.grant.name, "screen": screen,
        "expires": now + CODE_TTL}
    from .tools.deploy import base_url
    return {"url": f"{base_url(caller)}/mcp/preview/{code}", "expires_in_s": int(CODE_TTL),
            "open_at": {"width": width, "height": height},
            "note": "single use; read-only; open it in your own browser at that size"}


def _page(title: str, text: str, status: int) -> web.Response:
    from ..identity.auth import page
    return page(title, f"<p>{text}</p>", status)


@open_route("one_time_code", reads="none",
            why="a screen preview: its one-time code (mcp/preview.py) starts a read-only session; it redirects "
                "to the screen and answers no house data itself")
async def open_preview(request: web.Request) -> web.StreamResponse:
    app = request.app
    now = app["clock"]()
    got = _codes(app).pop(hashlib.sha256(request.match_info["code"].encode()).hexdigest(), None)
    if got is None or got["expires"] <= now:
        return _page("Preview Expired", "This preview link was used already or is more than five minutes old. Ask "
                     "the assistant for a new one.", 410)
    grants = app.get("mcp_grants")
    grant = grants.get(got["grant"]) if grants is not None else None
    if grant is None or not grants.live(grant) or not app["mcp_settings"].enabled:
        return _page("Preview Unavailable", "The assistant that made this link can no longer connect.", 403)
    door = sessions.door_of(request)
    if door != "lan" and not (grant.kind == "oauth" and grant.away and app["mcp_settings"].get("mcp_away")):
        return _page("Home Network Only", "This preview opens on the home network only.", 403)
    to = f"/{quote(got['screen'], safe='')}/home"
    here = sessions.identity(request)
    if here.user is not None:
        if here.user.id == got["user"]:
            raise web.HTTPFound(to)           # already signed in as them: their own session draws it
        return _page("Signed In as Someone Else", "This browser is signed in to Mantel as someone else. Open the "
                     "preview in a private window.", 409)
    issued = app["sessions"].create(got["user"], door if door in sessions.DOORS else "tunnel",
                                    sessions.PREVIEW_METHOD, ttl=SESSION_TTL, refresh=False, fresh=False,
                                    user_agent=got["name"], source_ip=sessions.client_ip(request), now=now)
    resp = web.HTTPFound(to)
    sessions.set_session_cookies(request, resp, issued)
    raise resp


def register(app: web.Application) -> None:
    app["mcp_preview_codes"] = {}
    app.router.add_get(PATH, open_preview)
    # its own check (the one-time code), as the sign-in pages have theirs
    app.setdefault("public_prefixes", set()).add("/mcp/preview/")
