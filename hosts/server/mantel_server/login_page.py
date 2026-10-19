"""Mantel Server's sign-in page: ``/login`` (docs/phase3/LOGIN-PAGE.md).

The page offers, in this order: a passkey (when the browser has WebAuthn), user name + password (then
the authenticator code when the server asks for it), and "Sign in with Home Assistant". It is static
(``static/login/``: HTML, one JS module, one stylesheet, plus the shared ``static/webauthn.js``) and
only drives sign-in APIs that already exist and do their own checks (accounts.py:
``/api/auth/password``, ``/api/auth/totp/verify``, ``/api/auth/passkey/options`` + ``/verify``; rate
limits, lockout, the tunnel's "a password alone is not enough"). Home Assistant sign-in starts at
``/login/ha`` (auth.py), which is what ``GET /login`` itself used to do.

* **Where to go afterwards**: ``?next=`` is honoured only as a same-origin relative path
  (:func:`safe_next`); anything else, and the sign-in routes themselves, become the default screen
  (``/home``). The server puts the cleaned value in ``<meta name="mantel-next">``; the page cleans it
  again with the same rules before it navigates. The HA sign-in carries it through HA in a cookie and
  cleans it once more at the callback.
* **Already signed in** (a person): sent straight on to ``next``. A wall tablet on its own is shown
  the page, so a person can sign in at it.
* **HA App mode**: through Ingress, Home Assistant signs the person in; every ``/login`` path is
  refused there by ingress.py (the page is never needed). The page still uses only relative URLs and
  reads ``<meta name="mantel-base">`` like web/shim/base.js, so nothing assumes it sits at the root.
* **CSP**: ``script-src 'self'; style-src 'self'``, no inline script, handler or style (as /admin).
"""
from __future__ import annotations

import html
import re
from importlib.resources import files
from urllib.parse import quote, urlsplit

from aiohttp import web

from . import security_headers
from .sessions import door_of, identity

PAGE = "/login"
HA_START = "/login/ha"
ASSET = PAGE + "/{name}"
ASSETS = {"login.js": ("static/login/login.js", "text/javascript"),
          "login.css": ("static/login/login.css", "text/css")}
# The passkey helpers both pages import as ../webauthn.js (from /login/login.js and /admin/admin.js);
# the URL mirrors the files' layout under static/, so the import also resolves on disk (the JS tests).
SHARED_JS = "/webauthn.js"
DEFAULT_NEXT = "/home"
NEXT_MAX = 1024

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
HEADERS = {"Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
           "Referrer-Policy": "same-origin"}

# Paths that are never a place to land after signing in: the sign-in routes (a loop), and the APIs.
_NO_LANDING_EXACT = ("/login", "/logout", "/ws")
_NO_LANDING_PREFIX = ("/login/", "/logout/", "/auth/", "/api/", "/ws/")
# RFC 3986's characters for a path, query and fragment (unreserved, sub-delims, ":@/?#", "%"); so no
# space or control character, no backslash, no quotes or angle brackets.
_URL_CHARS = re.compile(r"^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]+$")
_DOT_SEGMENT = re.compile(r"(?:^|/)(?:\.|%2e){1,2}(?:/|$)", re.IGNORECASE)
_BASE_RE = re.compile(r"^/api/hassio_ingress/[A-Za-z0-9_-]{1,128}$")


def safe_next(value: object, default: str = DEFAULT_NEXT) -> str:
    """``value`` if it is a same-origin relative path that is fine to land on, else ``default``.

    Accepted: only RFC 3986 URL characters (no space, control character, backslash, quote or angle
    bracket), starts with exactly one ``/`` (not ``//``), no scheme or host, no ``.``/``..`` segments,
    at most NEXT_MAX characters, and not a sign-in route or an API. login.js's ``safeNext`` applies the same rules (a test runs both on one table).
    """
    if not isinstance(value, str) or not value or len(value) > NEXT_MAX:
        return default
    if not _URL_CHARS.match(value):
        return default
    if value[0] != "/" or value[1:2] == "/":
        return default
    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return default
    path = parts.path
    if _DOT_SEGMENT.search(path):
        return default
    low = path.lower()
    if low in _NO_LANDING_EXACT or low.startswith(_NO_LANDING_PREFIX):
        return default
    return value


def login_url(next_path: str | None = None) -> str:
    """``/login``, with ``?next=`` when ``next_path`` is somewhere worth coming back to."""
    dest = safe_next(next_path, "")
    return PAGE + (f"?next={quote(dest, safe='/')}" if dest and dest != DEFAULT_NEXT else "")


def _static(rel: str) -> str:
    return files("mantel_server").joinpath(rel).read_text(encoding="utf-8")


def render(request: web.Request, next_path: str) -> str:
    base = request.get("mantel_base", "")
    base = base if _BASE_RE.match(base or "") else ""
    ha_href = "login/ha" + (f"?next={quote(next_path, safe='/')}" if next_path != DEFAULT_NEXT else "")
    door = door_of(request)
    return (_static("static/login/index.html")
            .replace("__BASE__", html.escape(base, quote=True))
            .replace("__NEXT__", html.escape(next_path, quote=True))
            .replace("__DOOR__", html.escape(door, quote=True))
            .replace("__HA_HREF__", html.escape(ha_href, quote=True)))


async def page(request: web.Request) -> web.StreamResponse:
    next_path = safe_next(request.query.get("next"))
    ident = identity(request)
    if ident.user is not None:                 # a person already: go on (a tablet alone gets the page)
        raise web.HTTPFound(next_path, headers={"Cache-Control": "no-store"})
    # a Webpage dashboard in HA's sidebar frames the direct address; signed out, that frame lands here
    csp = security_headers.own_page_csp(CSP, request.app.get("cfg"))
    return web.Response(text=render(request, next_path), content_type="text/html",
                        headers={**HEADERS, "Content-Security-Policy": csp})


async def asset(request: web.Request) -> web.StreamResponse:
    entry = ASSETS.get(request.match_info["name"])
    if entry is None:
        raise web.HTTPNotFound()
    rel, mime = entry
    return web.Response(text=_static(rel), content_type=mime, charset="utf-8", headers=HEADERS)


async def shared_js(request: web.Request) -> web.StreamResponse:
    return web.Response(text=_static("static/webauthn.js"), content_type="text/javascript", charset="utf-8",
                        headers=HEADERS)


def register(app: web.Application, hub=None) -> None:
    """Add ``/login``, its assets and ``/webauthn.js`` (all needed signed out, so public paths).
    auth.add_routes adds ``/login/ha``."""
    app.setdefault("public_paths", set()).update({PAGE, SHARED_JS, *(f"{PAGE}/{n}" for n in ASSETS)})
    app.router.add_get(PAGE, page)
    app.router.add_get(ASSET, asset)
    app.router.add_get(SHARED_JS, shared_js)
