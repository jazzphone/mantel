"""Sign in with Home Assistant, and the middleware that puts /dev, /api and /ws behind a sign-in.

The middleware resolves ``sessions.identity`` (a user session and/or a device credential), refuses
anonymous requests, requires an Origin on the WebSocket and a CSRF token on state-changing /api/
requests. Paths in PUBLIC_PATHS and ``app["public_paths"]`` (each slice's sign-in routes) are open.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import logging
import secrets
import time
from urllib.parse import urlparse

from aiohttp import web

from . import sessions
from .config import Config
from .ha_oauth import HaOAuth, OAuthError
from .store import Store

log = logging.getLogger("mantel.auth")

SESSION_COOKIE = sessions.ACCESS_COOKIE  # "mantel_session": now an access token
STATE_COOKIE = "mantel_oauth_state"
STATE_TTL = 600
PUBLIC_PATHS = {"/login", "/auth/callback", "/logout"}


# -- signed state cookie --------------------------------------------------------------------------
def _sig(secret: bytes, text: str) -> str:
    return hmac.new(secret, text.encode(), hashlib.sha256).hexdigest()


def make_state_cookie(secret: bytes, state: str, now: float) -> str:
    body = f"{state}.{int(now) + STATE_TTL}"
    return f"{body}.{_sig(secret, body)}"


def read_state_cookie(secret: bytes, value: str | None, now: float) -> str | None:
    """The state value if the cookie is untampered and fresh, else None."""
    if not value:
        return None
    try:
        state, expires, sig = value.rsplit(".", 2)
        body = f"{state}.{expires}"
        if not hmac.compare_digest(sig, _sig(secret, body)) or int(expires) < now:
            return None
    except ValueError:
        return None
    return state


# -- pages ------------------------------------------------------------------------------------------
def page(title: str, body: str, status: int = 200) -> web.Response:
    text = (f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>body{{font:16px system-ui;max-width:34em;margin:4em auto;padding:0 1em}}"
            f"code{{background:#8881;padding:2px 5px;border-radius:4px}}</style><h1>{html.escape(title)}</h1>{body}")
    return web.Response(text=text, status=status, content_type="text/html", headers={"Cache-Control": "no-store"})


# -- middleware -------------------------------------------------------------------------------------
@web.middleware
async def require_session(request: web.Request, handler):
    # This isolated proof resolves its own session so it can audit authentication denials.
    if request.path == "/api/proof2/command" and request.method == "POST":
        return await handler(request)
    if request.path in PUBLIC_PATHS or request.path in request.app.get("public_paths", ()):
        return await handler(request)
    ident = sessions.identity(request)
    if not ident.authenticated:
        if request.path in ("/", "/dev"):
            raise web.HTTPFound("/login")
        raise web.HTTPUnauthorized(text="sign in at /login")
    if request.path == "/ws" and request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")  # browsers always send it; the loopback middleware checks its value
    if request.method not in sessions.SAFE_METHODS and request.path.startswith("/api/"):
        sessions.check_csrf(request, ident)
    request["user"] = sessions.legacy_user(ident)
    return await handler(request)


# -- handlers ---------------------------------------------------------------------------------------
async def login(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    oauth: HaOAuth = request.app["oauth"]
    canonical = urlparse(oauth.client_id).netloc
    if request.host != canonical:  # the state cookie must be set on the host HA will send the browser back to
        raise web.HTTPFound(f"{oauth.client_id.rstrip('/')}/login")
    state = secrets.token_urlsafe(24)
    resp = web.HTTPFound(oauth.authorize_url(state))
    resp.set_cookie(STATE_COOKIE, make_state_cookie(request.app["state_secret"], state, request.app["clock"]()),
                    max_age=STATE_TTL, httponly=True, samesite="Lax", path="/auth")
    raise resp


async def callback(request: web.Request) -> web.StreamResponse:
    app = request.app
    oauth: HaOAuth = app["oauth"]
    store: Store = app["store"]
    expected = read_state_cookie(app["state_secret"], request.cookies.get(STATE_COOKIE), app["clock"]())
    got = request.query.get("state", "")

    def done(resp: web.Response) -> web.Response:
        resp.del_cookie(STATE_COOKIE, path="/auth")
        return resp

    if expected is None or not got or not hmac.compare_digest(expected, got):
        return done(page("Sign-in failed", "<p>This sign-in did not start here, or took too long. "
                         "<a href='/login'>Try again</a>.</p>", 400))
    code = request.query.get("code")
    if request.query.get("error") or not code:
        return done(page("Sign-in cancelled", "<p><a href='/login'>Try again</a>.</p>", 400))
    http = app["http"]
    refresh = None
    try:
        tokens = await oauth.exchange_code(http, code)
        refresh = tokens["refresh_token"]
        try:
            user = await oauth.current_user(http, tokens["access_token"])
        finally:
            # Mantel never keeps a user's HA token: revoke it as soon as we know who they are.
            try:
                await oauth.revoke(http, refresh)
            except Exception as exc:
                log.warning("could not revoke the user's refresh token: %s", exc)
    except (OAuthError, Exception) as exc:
        log.warning("sign-in failed: %s", exc)
        return done(page("Sign-in failed", "<p>Home Assistant could not confirm who you are. "
                         "<a href='/login'>Try again</a>.</p>", 502))
    link = store.get_link(user["id"])
    if link is None:
        log.info("sign-in refused: HA user %s is not linked", user["id"])
        return done(page("Not linked yet",
                         f"<p>Home Assistant says you are <b>{html.escape(user.get('name') or '?')}</b>, "
                         f"but that account is not linked to a Mantel role yet. Ask an Owner to link it.</p>"
                         f"<p>HA user id: <code>{html.escape(user['id'])}</code></p>", 403))
    if link["disabled"]:
        log.info("sign-in refused: the user linked to HA user %s is disabled", user["id"])
        return done(page("Account disabled", "<p>Ask an Owner.</p>", 403))
    if user.get("name"):
        store.set_name(user["id"], user["name"])
    issued = app["sessions"].create(link["user_id"], sessions.door_of(request), "ha",
                                    user_agent=request.headers.get("User-Agent"), source_ip=sessions.client_ip(request))
    # A page, not a redirect: SameSite=Strict cookies set during a navigation that started on HA's
    # site are not sent on a redirect in the same chain, so the next hop must start here.
    resp = page("Signed in", "<meta http-equiv='refresh' content='0;url=/dev'>"
                "<p>Signed in. <a href='/dev'>Continue</a>.</p>")
    sessions.set_session_cookies(request, resp, issued)
    return done(resp)


async def logout(request: web.Request) -> web.StreamResponse:
    if request.method != "POST":
        raise web.HTTPMethodNotAllowed(request.method, ["POST"])
    resp = web.json_response({"ok": True})
    sessions.end_session(request, resp)
    return resp


async def me(request: web.Request) -> web.Response:
    u = request["user"]
    return web.json_response({"ha_user_id": u["ha_user_id"], "name": u["name"], "role": u["role"]})


def add_routes(app: web.Application) -> None:
    app.router.add_get("/login", login)
    app.router.add_get("/auth/callback", callback)
    app.router.add_route("*", "/logout", logout)
    app.router.add_get("/api/me", me)
