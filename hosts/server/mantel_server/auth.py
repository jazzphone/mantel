"""Sign in with Home Assistant, and the middleware that puts /dev, /api and /ws behind a sign-in.

The sign-in page itself is login_page.py (``/login``); Home Assistant sign-in starts at ``/login/ha``
here (it was ``GET /login`` before the page existed) and comes back to ``/auth/callback`` as before.

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
from urllib.parse import quote, unquote, urlparse

from aiohttp import web

from . import sessions
from .ha_oauth import HaOAuth, OAuthError
from .login_page import DEFAULT_NEXT, HA_START, login_url, safe_next
from .store import Store

log = logging.getLogger("mantel.auth")

SESSION_COOKIE = sessions.ACCESS_COOKIE  # "mantel_session": now an access token
STATE_COOKIE = "mantel_oauth_state"
NEXT_COOKIE = "mantel_login_next"        # where to land after HA sign-in; cleaned again at the callback
STATE_TTL = 600
PUBLIC_PATHS = {HA_START, "/auth/callback", "/logout"}
# Signed out, these pages (and any GET that asks for a document) are sent to /login, with ?next= to
# come back to; everything else signed out gets a plain 401.
PAGE_PATHS = ("/", "/dev", "/home")
STATES_MAX = 512                          # sign-ins started and not yet back (single use, below)
CALLBACKS_PER_WINDOW = 20                 # /auth/callback per client address per window
CALLBACK_WINDOW = 300.0


def _issued_states(app) -> dict:
    """Server-side record of each started sign-in's state: a state counts once, then never again."""
    return app.setdefault("oauth_states", {})


def _remember_state(app, state: str, now: float) -> None:
    states = _issued_states(app)
    for s, exp in list(states.items()):
        if exp < now:
            del states[s]
    while len(states) >= STATES_MAX:
        del states[next(iter(states))]
    states[state] = now + STATE_TTL


def _use_state(app, state: str, now: float) -> bool:
    exp = _issued_states(app).pop(state, None)
    return exp is not None and exp >= now


def _callback_allowed(request: web.Request, now: float) -> bool:
    hits = request.app.setdefault("oauth_callback_hits", {})
    who = sessions.client_ip(request) or "?"
    recent = [t for t in hits.get(who, ()) if now - t < CALLBACK_WINDOW]
    if len(hits) > 4096:
        hits.clear()
    if len(recent) >= CALLBACKS_PER_WINDOW:
        hits[who] = recent
        return False
    hits[who] = recent + [now]
    return True


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
    if request.path in PUBLIC_PATHS or request.path in request.app.get("public_paths", ()):
        return await handler(request)
    ident = sessions.identity(request)
    if not ident.authenticated:
        if request.method == "GET" and (request.path in PAGE_PATHS or _wants_document(request)):
            raise web.HTTPFound(login_url(request.path_qs if request.path != "/" else None))
        raise web.HTTPUnauthorized(text="sign in at /login")
    if request.path in ("/ws", "/ws/talk") and request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")  # browsers always send it; the loopback middleware checks its value
    if request.method not in sessions.SAFE_METHODS and request.path.startswith("/api/"):
        sessions.check_csrf(request, ident)
    request["user"] = sessions.legacy_user(ident)
    return await handler(request)


def _wants_document(request: web.Request) -> bool:
    """A browser navigation (not an API call, a script or an image): worth a redirect to /login. A frame's
    navigation counts too: a Webpage dashboard in HA's sidebar showing a screen signed out (Sec-Fetch-Dest
    iframe) gets the sign-in page in the frame, not a bare 401."""
    if request.path.startswith(("/api/", "/ws")):
        return False
    dest = request.headers.get("Sec-Fetch-Dest")
    if dest is not None:
        return dest in ("document", "iframe")
    return "text/html" in request.headers.get("Accept", "")


# -- handlers ---------------------------------------------------------------------------------------
async def login_ha(request: web.Request) -> web.StreamResponse:
    """Start Sign in with Home Assistant (OAuth): HA's authorize page, with a signed state cookie."""
    oauth: HaOAuth = request.app["oauth"]
    if getattr(request.app.get("cfg"), "ha_managed_by_app", False) and (not oauth.ha_url or not oauth.browser_address()):
        # the HA App's direct access with no address for browsers yet (server.oauth_url, server_settings.sign_in_address)
        return page("Sign in with Home Assistant is not set up", "<p>Mantel doesn't know Home Assistant's address for "
                    "browsers yet. Set Home Assistant's own address in Home Assistant (Settings, System, Network, "
                    "Home Assistant URL), or an Owner sets one in Mantel Settings (Connections, Home Assistant, "
                    "Sign-In Address). Until then, sign in from Home Assistant's sidebar or with a passkey or "
                    "password. <a href='/login'>Back</a>.</p>", 409)
    if not oauth.ha_url:          # first run: the Owner has not connected Home Assistant yet (connections.py)
        return page("Home Assistant is not connected yet", "<p>Mantel does not know Home Assistant's address yet. "
                    "An Owner signs in with a password and connects it on the admin page (Connections). "
                    "<a href='/login'>Back</a>.</p>", 409)
    next_path = safe_next(request.query.get("next"))
    canonical = urlparse(oauth.client_id).netloc
    if request.host != canonical:  # the state cookie must be set on the host HA will send the browser back to
        query = f"?next={quote(next_path, safe='/')}" if next_path != DEFAULT_NEXT else ""
        if _ha_via(request):
            query += ("&" if query else "?") + f"via={quote(_ha_via(request), safe='')}"
        raise web.HTTPFound(f"{oauth.client_id.rstrip('/')}{HA_START}{query}")
    state = secrets.token_urlsafe(24)
    now = request.app["clock"]()
    _remember_state(request.app, state, now)
    from . import proxy_trust
    secure = proxy_trust.is_https(request)
    resp = web.HTTPFound(oauth.authorize_url(state, _ha_via(request)))
    resp.set_cookie(STATE_COOKIE, make_state_cookie(request.app["state_secret"], state, now),
                    max_age=STATE_TTL, httponly=True, samesite="Lax", path="/auth", secure=secure)
    if next_path != DEFAULT_NEXT:
        resp.set_cookie(NEXT_COOKIE, quote(next_path, safe=""), max_age=STATE_TTL, httponly=True,
                        samesite="Lax", path="/auth", secure=secure)
    else:
        resp.del_cookie(NEXT_COOKIE, path="/auth")
    raise resp


def _ha_via(request: web.Request) -> str:
    """The Home Assistant address framing this sign-in (login.js sends the frame's top origin as `via`), when it
    is one the operator named as HA's (frame-ancestors): a Webpage dashboard opened at HA's home address while
    ha_sign_in_url names the away one. HA's sign-in page sends X-Frame-Options: SAMEORIGIN, so in a frame it
    loads only from the address the dashboard is on. Anything else: the configured sign-in address."""
    via = request.query.get("via", "").rstrip("/")
    from . import frame_origins
    allowed = frame_origins.ancestors(request.app)
    return via if via and via in allowed and via.startswith(("https://", "http://")) else ""


async def callback(request: web.Request) -> web.StreamResponse:
    app = request.app
    oauth: HaOAuth = app["oauth"]
    store: Store = app["store"]
    expected = read_state_cookie(app["state_secret"], request.cookies.get(STATE_COOKIE), app["clock"]())
    got = request.query.get("state", "")

    next_path = safe_next(unquote(request.cookies.get(NEXT_COOKIE, "")))

    def done(resp: web.Response) -> web.Response:
        resp.del_cookie(STATE_COOKIE, path="/auth")
        resp.del_cookie(NEXT_COOKIE, path="/auth")
        return resp

    if not _callback_allowed(request, app["clock"]()):
        log.warning("sign-in callbacks from %s are being refused for a while (too many)", sessions.client_ip(request))
        return done(page("Too many attempts", "<p>Wait a few minutes, then <a href='/login'>try again</a>.</p>", 429))
    if expected is None or not got or not hmac.compare_digest(expected, got) \
            or not _use_state(app, expected, app["clock"]()):
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
    dest = html.escape(next_path, quote=True)          # safe_next: a same-origin path, never a URL
    resp = page("Signed in", f"<meta http-equiv='refresh' content='0;url={dest}'>"
                f"<p>Signed in. <a href='{dest}'>Continue</a>.</p>")
    sessions.set_session_cookies(request, resp, issued)
    return done(resp)


async def logout(request: web.Request) -> web.StreamResponse:
    if request.method != "POST":
        raise web.HTTPMethodNotAllowed(request.method, ["POST"])
    resp = web.json_response({"ok": True})
    sessions.end_session(request, resp)
    return resp


async def me(request: web.Request) -> web.Response:
    from .frame_origins import ha_address
    u = request["user"]
    # Home Assistant's address for the dashboard's "Open Home Assistant" row: a person's, never a wall tablet's
    # (nothing to get stuck in)
    ha = None if u.get("device_id") else ha_address(request.app)
    return web.json_response({"ha_user_id": u["ha_user_id"], "name": u["name"], "role": u["role"], "ha_address": ha})


def add_routes(app: web.Application) -> None:
    app.router.add_get(HA_START, login_ha)
    app.router.add_get("/auth/callback", callback)
    app.router.add_route("*", "/logout", logout)
    app.router.add_get("/api/me", me)
