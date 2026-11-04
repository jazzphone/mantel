"""The token for the Music Assistant page: signs HK's ``/ma/`` frame in to MA, server-side.

Separate from the MA connection Mantel's music engine uses (connections.py, usually an MA administrator): an
optional, **non-administrator** MA user's long-lived token, entered on the Connections page's Music Assistant
panel, kept sealed like the connections (``<data_dir>/connections/ma_page.connection``, 0600, in every encrypted
backup), never sent to a page, a log or an audit row. Without it the frame shows MA's own sign-in (as before).

**How the frame is signed in** (MA's frontend, checked against its source 2026-10-18: ``src/helpers/ingress.ts``,
``src/App.vue``, ``src/views/Login.vue``): MA's web app treats a connection as Home Assistant Ingress when its
address contains ``/hassio_ingress/`` AND the server's ``server_info`` says ``homeassistant_addon: true``; it then
sends no ``auth`` of its own and asks ``auth/me``, because MA's server has already authenticated that socket from
HA's proxy headers. Mantel does the same, as the proxy: HK's frame opens ``/ma/hassio_ingress/mantel/`` (the app
is the same; media_proxy strips that alias), and on that socket media_proxy authenticates to MA itself with this
token right after ``server_info``, then hands the page ``server_info`` with ``homeassistant_addon: true``. The
page never holds the token (MA's own sign-in would put one in the page's localStorage). Commands that would end
or change that sign-in (``auth/logout``, ``auth/token/*``, ``auth/user/update``) are refused on such a socket.
If MA refuses the token, the socket goes on unsigned (MA's own sign-in shows). This leans on MA's frontend
internals; if a later MA changes them, the frame falls back to MA's own sign-in.
"""
from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from . import audit
from . import connections as C
from .guards import guard
from .guards import ident as guarded
from .sessions import error, ok

log = logging.getLogger("mantel.ma_page")

KIND = "ma_page"
PATH = C.API + "/ma/page"
ALIAS = "hassio_ingress/mantel/"         # media_proxy: /ma/hassio_ingress/mantel/... is /ma/... signed in
BLOCKED = frozenset({"auth/logout", "auth/token/create", "auth/token/revoke", "auth/user/update",
                     "auth/user/delete", "auth/user/disable"})


class MaPage:
    def __init__(self, conns: Any) -> None:
        self.conns = conns
        self.unreadable: str | None = None

    def record(self) -> C.Record | None:
        try:
            got = self.conns.files.load(KIND)
            self.unreadable = None
            return got
        except Exception as exc:  # noqa: BLE001 -- another at-rest key: say so, the frame stays on MA's sign-in
            self.unreadable = type(exc).__name__
            return None

    def token(self) -> str:
        rec = self.record()
        return rec.token if rec is not None else ""

    def public(self) -> dict:
        rec = self.record()
        return {"set": rec is not None, "saved": rec.public() if rec is not None else None,
                "unreadable": bool(self.unreadable)}


def of(app: Any) -> MaPage | None:
    return app.get("ma_page")


@guard("manager", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    page = of(request.app)
    return ok({"page": page.public() if page is not None else {"set": False}})


@guard("owner", fresh="away", audit="connection.ma_page.saved")
async def api_save(request: web.Request) -> web.Response:
    """{token} (an MA user's long-lived token) or {username, password} (MA's sign-in once; a token is made for
    that user and the password kept nowhere). Tested against the MA Mantel is connected to; an administrator's
    token is refused (the frame must not carry MA's admin rights to everyone with music)."""
    ident = guarded(request)
    conns: C.Connections = request.app["connections"]
    url = conns.effective_url("ma")
    if not url:
        return error(409, "ma_not_set_up", message="Set up Music Assistant first (above).")
    body = await C.read_json(request)
    http = request.app["http"]
    now = request.app["clock"]()
    name = "Mantel Server page (" + C.stamp(now) + ")"
    try:
        if body.get("username") or body.get("password"):
            username, password = body.get("username"), body.get("password")
            if not isinstance(username, str) or not isinstance(password, str) or not username or not password:
                return error(400, "missing", message="Type the Music Assistant user name and password.")
            got = await C.ma_login_token(http, url, username, password, name, create=True)
            token, method = got["token"], "login"
        else:
            token = C.clean_token(body.get("token"))
            got = await C.test_ma(http, url, token)
            method = "token"
    except C.ConnectionFailed as exc:
        return C.failed(exc)
    user = got.get("user") or {}
    if user.get("is_admin"):
        return error(422, "admin_token", message="That is a Music Assistant administrator. Use an ordinary MA user "
                     "for the page (MA: Settings, Users, add a user with the User role).")
    rec = C.Record(kind=KIND, url=url, token=token, method=method, since=now, user=user, by=ident.user.id,
                   by_name=ident.user.name, version=got.get("version"),
                   expires=now + C.MA_TOKEN_DAYS * 86400 if method == "login" else None)
    audit.config(request, ident, "connection.ma_page.saved", {"url": url, "method": method, "as": user.get("name")})
    conns.files.save(rec)
    log.info("the Music Assistant page now signs in as %s", user.get("name") or "an MA user")
    return ok({"page": of(request.app).public()})


@guard("owner", fresh="away", audit="connection.ma_page.removed")
async def api_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    audit.config(request, ident, "connection.ma_page.removed", {})
    had = request.app["connections"].files.delete(KIND)
    return ok({"removed": had, "page": of(request.app).public()})


def register(app: web.Application, hub: Any = None) -> MaPage | None:
    conns = app.get("connections")
    if conns is None:
        return None
    page = MaPage(conns)
    app["ma_page"] = page
    app.router.add_get(PATH, api_get)
    app.router.add_post(PATH, api_save)
    app.router.add_delete(PATH, api_delete)
    return page
