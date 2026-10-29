"""HA App mode: Home Assistant's sidebar (Ingress) as Mantel's way in (PLAN §7 Way 1, §8; docs/phase3/HA-APP.md).

When Mantel Server runs as an HA App, HA's Supervisor proxies the sidebar page to it and adds the
signed-in HA user to every request (``X-Remote-User-Id`` / ``-Name`` / ``-Display-Name``) and the page's
prefix (``X-Ingress-Path: /api/hassio_ingress/<token>``). This module turns that into Mantel's identity.

* **Unforgeable.** The headers are believed ONLY when ``cfg.ingress`` is on AND the socket peer is one
  of ``cfg.ingress_peers`` (default ``172.30.32.2``, the Supervisor on the hassio network) OR the request
  is a paired Mantel Connect App's (client certificate checked against the pairings, connect_pairing.py:
  Mantel running outside HA). Never a
  forwarded-for header, never anyone else: from any other peer they are ignored and logged, and with
  ``cfg.ingress_only`` (the App's setting) such a request is refused outright (health checks excepted).
* **Linked users only** (PLAN §5). The HA user id maps through P3.1's ``ha_links`` to a Mantel user and
  its role. An unlinked HA user gets a page saying to ask an Owner, and nothing else.
* **Wall tablets** (decision 21, PLAN §8 "HA App first"). Each wall tablet in the house is its own HA user
  (trusted_networks in Kiosk Satellite). An Owner links such an HA user to a Mantel *device* instead
  (``ha_tablet_links``: wall_tablet role, its room): its requests are then that device with no user, on
  door ``ha``, and with the home rules (``ha_door_rules`` trusted or lan) the device gets the LAN door's
  tablet rules -- its role's grants decide, with no PIN (decision 25), and no remote-access notice.
  The trust root is the HA user Ingress vouches for; a device *credential* is still never accepted on
  ``ha``. With ``tunnel`` rules such a tablet is refused (devices are never allowed remote rules). Its page
  opens on its own HK screen (``/home`` → ``/<screen>/home?hk_tablet=<id>``) and asks HA's frontend to hide
  its sidebar and header (``<meta name="mantel-kiosk">``, web/shim/base.js).
* **First Owner.** While no enabled Owner exists, an HA *administrator* (checked with HA itself over
  Mantel's own HA credential: ``config/auth/list``) arriving through Ingress may become the Owner,
  after pressing an explicit confirm button (a signed, expiring, single-user form). Afterwards the
  page answers "closed". An Owner or Admin links the rest of the household at ``<prefix>/ingress/people``.
* **The 'ha' door.** Requests through Ingress come by door ``ha``. RBAC applies the tunnel's rules to
  it (sensitive actions, cameras and locations follow the roles' tunnel switches) unless the Owner opts
  in to the LAN's (``cfg.ha_door_rules``); device credentials are never accepted on it; a sensitive
  action notifies the Owners as a remote one does. Decision and reasons: docs/phase3/HA-APP.md.
* **Sessions.** The first page load through Ingress starts a Mantel session for the linked user (method
  ``ingress``, stored as door ``tunnel``), with its cookies scoped to the prefix. It is *not* a fresh
  sign-in for account administration (house commands ask for none: decision 25). A cookie of an Ingress session is good
  only through Ingress, and only for the HA user whose headers come with it.
* **The prefix.** The page lives under ``/api/hassio_ingress/<token>/``. Every redirect Mantel sends is
  moved under it; the page's HTML gets ``<meta name="mantel-base">`` for Mantel's own code
  (web/shim/base.js: REST calls, the WebSocket, history writes); and HK's code (shared with the HA
  build, so its files never change) is served with its absolute ``/hk/``, ``/web/`` and ``/static/mdi/``
  references moved under the prefix and its reads of ``location.pathname`` seen without it.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import hmac
import html
import logging
import mimetypes
import re
import secrets
import time
from types import SimpleNamespace
from collections import OrderedDict
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import parse_qs

import aiohttp
from aiohttp import web

from . import audit, live, sessions
from .guards import guard
from .guards import ident as guarded
from .sessions import INGRESS_METHOD, Identity, User

log = logging.getLogger("mantel.ingress")

USER_ID = "X-Remote-User-Id"
USER_NAME = "X-Remote-User-Name"
USER_DISPLAY = "X-Remote-User-Display-Name"
IDENTITY_HEADERS = (USER_ID, USER_NAME, USER_DISPLAY)
INGRESS_PATH = "X-Ingress-Path"
PATH_RE = re.compile(r"^/api/hassio_ingress/[A-Za-z0-9_-]{1,128}$")
USER_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
HEALTH_PATHS = frozenset({"/healthz", "/api/version"})
OWN_PATHS = frozenset({"/ingress/bootstrap"})           # open to an unlinked HA user through Ingress
# Sign-in routes make no sense through Ingress (HA already signed the person in) and would start
# sessions on a door they do not know: refused there.
SIGN_IN_PATHS = frozenset({"/login", "/auth/callback", "/api/auth/password", "/api/auth/totp/verify",
                           "/api/auth/passkey/options", "/api/auth/passkey/verify", "/api/bootstrap"})
SIGN_IN_PREFIX = "/login/"          # the page's assets and /login/ha (login_page.py, auth.py)
BOOTSTRAP_TTL = 600
WARN_EVERY = 300.0
# A person's roles. A wall tablet is not a person: its HA user is linked to a device (link_tablet below).
LINK_ROLES = ("owner", "admin", "adult", "child", "guest")
DIRECTORY_TTL = 30.0
DEVICE_TOUCH_EVERY = 60.0
NAME_MAX = 64
# HA Core, seen from inside the App (the hassio network's gateway; HA Core runs on the host network). It
# may reach exactly one path when the App's ingress_only is on: linked mode's endpoint (linked.py), which
# wants its own Service credential besides (docs/phase3/HA-APP.md "Linked mode in the App").
CORE_PATHS = frozenset({"/linked/ws", "/linked/pair"})   # HA Core: the link, and Mantel Link pairing by code
KIOSK_META = '<meta name="mantel-kiosk" content="tablet">'

# The prefix rewrite of HK's files (see the module docstring). Absolute references to Mantel's own
# asset roots, right after a quote, backtick or "(" (CSS url(...)). Not /api/: those literals in HK's
# code are Home Assistant API paths that go to the action port, not URLs fetched from Mantel.
REWRITE_SUFFIXES = frozenset({".js", ".mjs", ".css", ".html"})
ASSET_LITERAL = re.compile(r"""(["'`(])/(hk|web|static/mdi)/""")
PATHNAME_READ = re.compile(r"\blocation\.pathname\b(?!\s*=(?!=))")
CONTENT_TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html"}
CACHE_LIMIT = 48 * 1024 * 1024
# HA stamps `Referrer-Policy: no-referrer` on every response it proxies, Ingress included; under that
# policy a browser sends `Origin: null` on a same-origin POST, which server.loopback_only must refuse.
# A document's own referrer meta overrides the header, so every page served through Ingress carries it.
REFERRER_META = '<meta name="referrer" content="same-origin">'


# -- who is asking ----------------------------------------------------------------------------------
def is_ingress(request: web.Request) -> bool:
    """True only in Ingress mode for a request whose socket peer is the Supervisor's Ingress proxy."""
    cached = request.get("ingress")
    if cached is not None:
        return cached
    cfg = request.app.get("cfg")
    from . import direct
    if direct.is_direct(request):         # the App's direct listener (direct.py): never Ingress, whoever the peer
        request["ingress"] = False
        return False
    # Two ways to be the Ingress proxy: the Supervisor's socket address (HA App mode), or a paired Mantel
    # Connect App that connect_pairing.py has just authenticated by client certificate on its own listener
    # (Mantel outside HA). Nothing else, ever.
    got = bool(getattr(cfg, "ingress", False)) and request.remote is not None \
        and (request.get("connect_peer") is not None or request.remote in tuple(getattr(cfg, "ingress_peers", ()) or ()))
    request["ingress"] = got
    return got


def prefix_of(request: web.Request) -> str:
    """The page's prefix from X-Ingress-Path ('' when absent or malformed). Ingress requests only."""
    if not is_ingress(request):
        return ""
    values = request.headers.getall(INGRESS_PATH, [])
    if len(values) == 1 and PATH_RE.match(values[0]):
        return values[0]
    if values:
        log.warning("ignored a malformed %s from the Ingress proxy", INGRESS_PATH)
    return ""


def origin_ok(request: web.Request, netloc: str) -> bool:
    """server.loopback_only's Origin rule through Ingress: the browser's host as HA forwarded it."""
    if not is_ingress(request):
        return False
    hosts = {h.strip().lower() for v in request.headers.getall("X-Forwarded-Host", []) for h in v.split(",")}
    return netloc.lower() in hosts


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.encode("utf-8", "surrogateescape").decode("utf-8", "replace").strip()
    return text[:120] or None


def ha_person(request: web.Request) -> dict | None:
    """{id, username, display} of the HA user Ingress vouches for, or None (Ingress requests only)."""
    if not is_ingress(request):
        return None
    ids = request.headers.getall(USER_ID, [])
    if len(ids) != 1 or not USER_RE.match(ids[0]):
        return None
    names = request.headers.getall(USER_NAME, [])
    displays = request.headers.getall(USER_DISPLAY, [])
    return {"id": ids[0], "username": _clean(names[0]) if len(names) == 1 else None,
            "display": _clean(displays[0]) if len(displays) == 1 else None}


def _client_ip(request: web.Request) -> str | None:
    """The browser as HA saw it: HA Core appends its peer to X-Forwarded-For and the Supervisor then
    appends HA Core's address, so the browser (or HA's own reverse proxy) is the second-to-last hop."""
    hops = [h.strip() for v in request.headers.getall("X-Forwarded-For", []) for h in v.split(",") if h.strip()]
    pick = hops[-2] if len(hops) >= 2 else (hops[-1] if hops else None)
    try:
        return str(ip_address(pick)) if pick else request.remote
    except ValueError:
        return request.remote


def _https(request: web.Request) -> bool:
    proto = request.headers.get("X-Forwarded-Proto", "")
    return proto.split(",")[0].strip().lower() == "https"


def linked_user(db, ha_user_id: str):
    return db.execute("SELECT u.id, u.name, u.role, u.kind, u.username, u.disabled, h.ha_user_id "
                      "FROM ha_links h JOIN users u ON u.id = h.user_id WHERE h.ha_user_id = ?",
                      (ha_user_id,)).fetchone()


def wants_page(request: web.Request) -> bool:
    if request.method != "GET":
        return False
    # A page load that HA's service worker fetches for the sidebar frame arrives as Sec-Fetch-Dest: empty,
    # Sec-Fetch-Mode: navigate; reading only the destination, no session (and no CSRF token) was ever
    # started in browsers where that worker runs (seen in Chrome and Safari).
    if request.headers.get("Sec-Fetch-Mode") == "navigate":
        return True
    dest = request.headers.get("Sec-Fetch-Dest")
    if dest is not None:
        return dest in ("document", "iframe")
    return "text/html" in request.headers.get("Accept", "")


def resolve(request: web.Request) -> Identity | None:
    """sessions.identity's hook: the identity of an Ingress request, None for any other request."""
    if not is_ingress(request):
        return None
    app = request.app
    person = ha_person(request)
    if person is None:
        log.warning("an Ingress request carried no valid %s", USER_ID)
        return Identity(None, None, "ha")
    db = app["store"].db
    tablet = tablet_link(db, person["id"])
    if tablet is not None:
        return _tablet_identity(request, person, tablet)
    row = linked_user(db, person["id"])
    if row is None or row["disabled"]:
        request["ingress_unlinked"] = person
        return Identity(None, None, "ha")
    user = User(id=row["id"], name=row["name"], role=row["role"], kind=row["kind"], username=row["username"],
                ha_user_id=row["ha_user_id"])
    mgr: sessions.SessionManager = app["sessions"]
    now = app["clock"]()
    srow = mgr.from_access(request.cookies.get(sessions.ACCESS_COOKIE), now, "tunnel")
    if not _ours(srow, user):
        srow = None
        refresh = request.cookies.get(sessions.REFRESH_COOKIE)
        if refresh and _refresh_is_ours(db, refresh, user):
            status, value = mgr.rotate(refresh, now, "tunnel")
            if status == "ok":
                issued, srow = value
                sessions._queue_issued(request, issued)
            elif status == "grace":
                srow = value
    if srow is None and wants_page(request):
        issued = mgr.create(user.id, "tunnel", INGRESS_METHOD, fresh=False, **sessions.sign_in_args(request))
        sessions._queue_issued(request, issued)
        srow = mgr.get(issued.session_id, now)
        log.info("Ingress: started a session for %s (HA user %s)", user.name or user.id, person["id"])
    if srow is None:
        # no session yet (a request before the page's first load set the cookies): the user, read-only
        # in effect (no CSRF token, so no state-changing REST)
        return Identity(user, None, "ha")
    mgr.touch(srow, now, sessions.client_ip(request))
    return Identity(user=user, device=None, door="ha", fresh_factor_at=srow["fresh_factor_at"],
                    fresh_factor=srow["fresh_factor"], session_id=srow["id"], csrf=srow["csrf"])


def tablet_link(db, ha_user_id: str):
    """The device an HA user is linked to as a wall tablet (with the device's row), or None."""
    return db.execute("SELECT t.ha_user_id, t.ha_name, t.own_device, t.created AS linked, d.id, d.name, d.role, "
                      "d.room, d.csrf, d.revoked, d.last_seen, d.source_ip FROM ha_tablet_links t "
                      "JOIN devices d ON d.id = t.device_id WHERE t.ha_user_id = ?", (ha_user_id,)).fetchone()


def tablets_allowed(app: web.Application) -> bool:
    """Wall tablets through Ingress only with the home rules on the 'ha' door (trusted or lan): a device
    is never given the tunnel's rules (rbac refuses devices there; PLAN §7: tablets are LAN-only)."""
    authz = app.get("authz")
    if authz is not None:
        return authz.rules_door("ha") == "lan"
    return getattr(app["cfg"], "ha_door_rules", "tunnel") in ("trusted", "lan")


def _tablet_identity(request: web.Request, person: dict, row) -> Identity:
    """An HA user linked to a wall-tablet device: the device, no user, door 'ha'. No session is made: the
    HA user Ingress names on every request is the credential; the device's own CSRF token guards writes."""
    app = request.app
    if row["revoked"] is not None:
        request["ingress_tablet_refused"] = ("revoked", person, row)
        return Identity(None, None, "ha")
    if not tablets_allowed(app):
        request["ingress_tablet_refused"] = ("tunnel_rules", person, row)
        return Identity(None, None, "ha")
    now = app["clock"]()
    ip = sessions.client_ip(request)
    if row["last_seen"] is None or now - row["last_seen"] >= DEVICE_TOUCH_EVERY or (ip and ip != row["source_ip"]):
        db = app["store"].db
        with db:
            db.execute("UPDATE devices SET last_seen = ?, source_ip = COALESCE(?, source_ip) WHERE id = ?",
                       (now, ip, row["id"]))
    device = sessions.Device(id=row["id"], name=row["name"], role=row["role"], room=row["room"],
                             ha_user_id=person["id"], ha_name=person.get("display") or row["ha_name"] or row["name"])
    if wants_page(request) and request.cookies.get(sessions.CSRF_COOKIE) != row["csrf"]:
        # the page's readable CSRF cookie (for its state-changing REST), scoped to the prefix like every Ingress cookie
        sessions.queue_cookie(request, sessions.CSRF_COOKIE, row["csrf"],
                              **sessions._cookie_opts(request, 400 * 86400, httponly=False))
    return Identity(user=None, device=device, door="ha", csrf=row["csrf"])


def is_ha_tablet(ident: Identity | None) -> bool:
    return ident is not None and ident.user is None and ident.device is not None and bool(ident.device.ha_user_id)


def _ours(row, user: User) -> bool:
    return row is not None and row["method"] == INGRESS_METHOD and row["user_id"] == user.id


def _refresh_is_ours(db, token: str, user: User) -> bool:
    got = db.execute("SELECT s.user_id, s.method FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id "
                     "WHERE r.hash = ?", (sessions.token_hash(token),)).fetchone()
    return got is not None and got["method"] == INGRESS_METHOD and got["user_id"] == user.id


# -- HA's user list (for the first-Owner check and the people page) -------------------------------------
class HaDirectory:
    """HA's users (``config/auth/list``, an admin read) over Mantel's own HA credential. One short
    connection per refresh, cached ``DIRECTORY_TTL`` seconds. Sends nothing else."""

    def __init__(self, ws_url: str, token: str | None, ttl: float = DIRECTORY_TTL) -> None:
        self.ws_url = ws_url
        self._token = token            # never logged
        self.ttl = ttl
        self._cache: tuple[float, list[dict]] | None = None
        self._lock = asyncio.Lock()

    def retarget(self, ws_url: str, token: str | None) -> None:
        """New address/credential (connections.py): the next read uses them; the cached list is dropped."""
        self.ws_url = ws_url
        self._token = token
        self._cache = None

    async def users(self) -> list[dict]:
        async with self._lock:
            if self._cache is not None and time.monotonic() - self._cache[0] < self.ttl:
                return self._cache[1]
            if not self._token:
                raise RuntimeError("no Home Assistant credential")
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as http:
                async with http.ws_connect(self.ws_url, max_msg_size=0) as ws:
                    await ws.receive_json()
                    await ws.send_json({"type": "auth", "access_token": self._token})
                    if (await ws.receive_json()).get("type") != "auth_ok":
                        raise RuntimeError("Home Assistant refused Mantel's credential")
                    await ws.send_json({"id": 1, "type": "config/auth/list"})
                    while True:
                        msg = await ws.receive_json()
                        if msg.get("id") == 1 and msg.get("type") == "result":
                            break
            if not msg.get("success") or not isinstance(msg.get("result"), list):
                raise RuntimeError("Home Assistant did not list its users: "
                                   + str((msg.get("error") or {}).get("code", "error")))
            got = [u for u in msg["result"] if isinstance(u, dict) and isinstance(u.get("id"), str)]
            self._cache = (time.monotonic(), got)
            return got

    async def user(self, ha_user_id: str) -> dict | None:
        return next((u for u in await self.users() if u.get("id") == ha_user_id), None)


def is_ha_admin(u: dict | None) -> bool:
    return bool(u) and "system-admin" in (u.get("group_ids") or []) and u.get("is_active", True) is not False \
        and not u.get("system_generated")


def household(users: list[dict]) -> list[dict]:
    """People only: no system users (Supervisor, the cloud), no deactivated accounts."""
    return [u for u in users if not u.get("system_generated") and u.get("is_active", True) is not False]


# -- first Owner ------------------------------------------------------------------------------------
def owner_exists(db) -> bool:
    return db.execute("SELECT 1 FROM users WHERE role = 'owner' AND disabled = 0 LIMIT 1").fetchone() is not None


def _sig(app: web.Application, text: str) -> str:
    return hmac.new(app["state_secret"], ("ingress-bootstrap|" + text).encode(), hashlib.sha256).hexdigest()


def bootstrap_nonce(app: web.Application, ha_user_id: str, now: float) -> str:
    body = f"{ha_user_id}.{int(now) + BOOTSTRAP_TTL}"
    return f"{body}.{_sig(app, body)}"


def check_nonce(app: web.Application, nonce: str, ha_user_id: str, now: float) -> bool:
    try:
        uid, expires, sig = nonce.rsplit(".", 2)
        return hmac.compare_digest(sig, _sig(app, f"{uid}.{expires}")) and uid == ha_user_id and int(expires) >= now
    except (ValueError, AttributeError):
        return False


async def bootstrap_state(request: web.Request, person: dict) -> tuple[str, dict | None]:
    """('closed' | 'admin' | 'not_admin' | 'unknown', HA's record of the person)."""
    if owner_exists(request.app["store"].db):
        return "closed", None
    directory: HaDirectory | None = request.app.get("ha_directory")
    try:
        record = await directory.user(person["id"]) if directory is not None else None
    except Exception as exc:  # noqa: BLE001 -- say so on the page; never guess
        log.warning("could not read Home Assistant's users (%s)", type(exc).__name__)
        return "unknown", None
    return ("admin" if is_ha_admin(record) else "not_admin"), record


def _page(title: str, body: str, status: int = 200) -> web.Response:
    text = ("<!doctype html><html lang=en><meta charset=utf-8>" + REFERRER_META +
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>body{{font:16px system-ui,sans-serif;max-width:36em;"
            "margin:3em auto;padding:0 1em;background:#05070e;color:#eee}a{color:#9cf}"
            "button,select,input{font:inherit;padding:.4em .8em}table{border-collapse:collapse;width:100%}"
            "td,th{text-align:left;padding:.4em;border-bottom:1px solid #333}.note{color:#aaa}</style>"
            f"<h1>{html.escape(title)}</h1>{body}</html>")
    return web.Response(text=text, status=status, content_type="text/html",
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def tablet_refused_page(reason: str, person: dict, row) -> web.Response:
    who = html.escape(person.get("display") or person.get("username") or "this account")
    dev = html.escape(row["name"] or "a wall tablet")
    if reason == "revoked":
        body = (f"<p>Home Assistant says you are <b>{who}</b>, linked in Mantel to the wall tablet <b>{dev}</b>, "
                "but that device has been revoked.</p><p>Ask a Mantel Owner to link this tablet again (in Mantel: "
                "<i>People</i>).</p>")
        return _page("This tablet is revoked", body, 403)
    body = (f"<p>Home Assistant says you are <b>{who}</b>, linked in Mantel to the wall tablet <b>{dev}</b>.</p>"
            "<p>Mantel's sidebar uses its remote rules (Coming Through Home Assistant: Away Rules), and under them "
            "wall tablets are refused. An Owner can set it to Trusted (the default) or Home Network Rules in Mantel "
            "Settings → Connections → Home Assistant.</p>")
    return _page("Wall tablets are off for the sidebar", body, 403)


async def unlinked_page(request: web.Request, person: dict | None) -> web.Response:
    base = request.get("mantel_base", "")
    refused = request.get("ingress_tablet_refused")
    if refused is not None:
        return tablet_refused_page(*refused)
    if person is None:
        return _page("Not signed in", "<p>Home Assistant did not say who you are. Reload the page from "
                     "Home Assistant's sidebar.</p>", 401)
    who = html.escape(person.get("display") or person.get("username") or "this account")
    state, _ = await bootstrap_state(request, person)
    if state == "admin":
        nonce = bootstrap_nonce(request.app, person["id"], request.app["clock"]())
        body = (f"<p>Home Assistant says you are <b>{who}</b>, an administrator.</p>"
                "<p>Mantel has no Owner yet. The Owner can do everything in Mantel: manage people, roles and "
                "devices, see the audit log, and (once house commands are on) control the whole house.</p>"
                f"<form method=post action='{html.escape(base)}/ingress/bootstrap'>"
                f"<input type=hidden name=nonce value='{html.escape(nonce)}'>"
                f"<p><button type=submit>Make me Mantel's Owner</button></p></form>"
                "<p class=note>Only the first Owner is made this way; afterwards an Owner links everyone else.</p>")
        return _page("Set up Mantel", body, 403)
    if state == "not_admin":
        body = (f"<p>Home Assistant says you are <b>{who}</b>.</p><p>Mantel has no Owner yet. A Home Assistant "
                "administrator needs to open Mantel first and become its Owner; then they can link your account.</p>")
        return _page("Mantel is not set up yet", body, 403)
    if state == "unknown":
        body = (f"<p>Home Assistant says you are <b>{who}</b>.</p><p>Mantel has no Owner yet, and it could not ask "
                "Home Assistant whether you are an administrator. Check the App's log, then reload.</p>")
        return _page("Mantel is not set up yet", body, 503)
    body = (f"<p>Home Assistant says you are <b>{who}</b>, but that account is not linked to a Mantel user yet.</p>"
            "<p>Ask a Mantel Owner to link it (in Mantel: <i>People</i>). Until then Mantel shows you nothing.</p>")
    return _page("Not linked yet", body, 403)


async def bootstrap_get(request: web.Request) -> web.Response:
    if not is_ingress(request):
        raise web.HTTPNotFound()
    person = ha_person(request)
    db = request.app["store"].db
    if person is not None and (linked_user(db, person["id"]) is not None or tablet_link(db, person["id"]) is not None):
        raise web.HTTPFound(request.get("mantel_base", "") + "/home")
    return await unlinked_page(request, person)


async def bootstrap_post(request: web.Request) -> web.Response:
    """The explicit confirm: becomes the first Owner (only while none exists, only an HA administrator)."""
    if not is_ingress(request):
        raise web.HTTPNotFound()
    base = request.get("mantel_base", "")
    if request.headers.get("Origin") is None:          # loopback_only has checked its value
        return _page("Refused", "<p>This form must be sent from Mantel's page.</p>", 403)
    person = ha_person(request)
    if person is None:
        return _page("Not signed in", "<p>Reload the page from Home Assistant's sidebar.</p>", 401)
    form = parse_qs((await request.text())[:4096])
    nonce = (form.get("nonce") or [""])[0]
    app = request.app
    if not check_nonce(app, nonce, person["id"], app["clock"]()):
        return _page("Please try again", f"<p>This confirmation is old or not yours. <a href='{html.escape(base)}/home'>"
                     "Start again</a>.</p>", 400)
    state, record = await bootstrap_state(request, person)
    if state != "admin":
        log.warning("Ingress bootstrap refused for HA user %s (%s)", person["id"], state)
        return await unlinked_page(request, person) if state != "closed" else \
            _page("Already set up", f"<p>Mantel already has an Owner. <a href='{html.escape(base)}/home'>Continue</a>.</p>", 410)
    db = app["store"].db
    name = person.get("display") or (record or {}).get("name") or person.get("username")
    now = app["clock"]()
    with db:  # one transaction, no await inside: only while no Owner exists, the link is made exactly once
        if owner_exists(db):
            return _page("Already set up", f"<p>Mantel already has an Owner. <a href='{html.escape(base)}/home'>"
                         "Continue</a>.</p>", 410)
        if tablet_link(db, person["id"]) is not None:
            return _page("Not changed", "<p>This Home Assistant account is a wall tablet in Mantel.</p>", 409)
        had = linked_user(db, person["id"])
        uid = had["id"] if had is not None else secrets.token_hex(16)
        # the row first (written and committed by the audit's own transaction on this database), then the Owner
        audit.config(request, SimpleNamespace(id=uid, role="owner"), "ingress.bootstrap_owner",
                     {"ha_user_id": person["id"], "name": name})
        if had is not None:
            db.execute("UPDATE users SET role = 'owner', updated = ? WHERE id = (SELECT user_id FROM ha_links "
                       "WHERE ha_user_id = ?)", (now, person["id"]))
        else:
            db.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES (?,?,?,?,?,?)",
                       (uid, name, "owner", "ha_linked", now, now))
            db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES (?,?,?)", (person["id"], uid, now))
    log.warning("Ingress bootstrap: HA administrator %s (HA user %s) is now Mantel's first Owner", name, person["id"])
    return _page("You are Mantel's Owner", f"<p>Welcome, <b>{html.escape(name or '')}</b>.</p>"
                 f"<p><a href='{html.escape(base)}/settings#/mantel/setup'>Set up Mantel</a> · "
                 f"<a href='{html.escape(base)}/home'>Open Mantel</a> · "
                 f"<a href='{html.escape(base)}/ingress/people'>Link the rest of the household</a></p>")


# -- wall tablets: an HA user that is a tablet, linked to a device --------------------------------------
ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class TabletLinkError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def rooms(app: web.Application) -> dict[str, str]:
    """HA's areas ({area id: name}): a wall tablet's room is an area (RBAC's device_areas)."""
    hub = app.get("hub")
    return dict(getattr(getattr(hub, "registry", None), "areas", None) or {})


def free_devices(db) -> list:
    """Wall-tablet devices an HA user could be linked to: live, and not linked to another HA user yet."""
    return db.execute("SELECT d.id, d.name, d.room FROM devices d LEFT JOIN ha_tablet_links t ON t.device_id = d.id "
                      "WHERE d.revoked IS NULL AND d.role = 'wall_tablet' AND t.device_id IS NULL "
                      "ORDER BY d.created").fetchall()


def tablet_links(db) -> list[dict]:
    rows = db.execute("SELECT t.ha_user_id, t.ha_name, t.own_device, t.created, d.id AS device_id, d.name, d.room, "
                      "d.role, d.revoked FROM ha_tablet_links t JOIN devices d ON d.id = t.device_id ORDER BY t.created")
    return [{"ha_user_id": r["ha_user_id"], "ha_name": r["ha_name"], "created": r["created"],
             "own_device": bool(r["own_device"]),
             "device": {"id": r["device_id"], "name": r["name"], "room": r["room"], "role": r["role"],
                        "revoked": r["revoked"]}} for r in rows]


def _revoke_in(db, device_id: str, reason: str, now: float) -> None:
    db.execute("UPDATE devices SET revoked = ?, revoked_reason = ? WHERE id = ? AND revoked IS NULL",
               (now, reason, device_id))


def link_tablet(app: web.Application, ha_user_id: str, actor: User, *, device_id: str | None = None,
                name: str | None = None, room: str | None = None, ha_name: str | None = None,
                moving_from: str | None = None, request: web.Request | None = None, ident: Identity | None = None) -> dict:
    """Make an HA user a wall tablet: linked to an existing wall-tablet device (``device_id``) or to a new
    one (``name``, ``room``). A person link of that HA user is removed (its sessions end), as is an earlier
    tablet link (a device made for it is revoked). ``moving_from``: the HA user ``device_id`` is linked to now,
    whose link this one replaces in the same transaction (the device kept, its own-device mark carried over).
    Audited before anything changes (``ingress.link_tablet``: ``audit.Unavailable`` and no change without its
    row); ``request`` and ``ident`` say where from. Owners only: the caller checks. Raises TabletLinkError."""
    db = app["store"].db
    if not isinstance(ha_user_id, str) or not USER_RE.match(ha_user_id):
        raise TabletLinkError("invalid", "ha_user_id: an HA user id")
    known = rooms(app)
    if room in ("", None):
        room = None
    elif not isinstance(room, str) or not ROOM_RE.match(room) or (known and room not in known):
        raise TabletLinkError("unknown_room", "room: one of Home Assistant's areas")
    if name is not None and (not isinstance(name, str) or not name.strip()):
        name = None
    if device_id is not None and not isinstance(device_id, str):
        raise TabletLinkError("unknown_device", "device_id: a live wall-tablet device", 404)
    person = linked_user(db, ha_user_id)
    if person is not None and person["role"] == "owner":
        others = db.execute("SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0 AND id != ?",
                            (person["id"],)).fetchone()[0]
        if not others:
            raise TabletLinkError("last_owner", "Mantel always keeps at least one Owner", 409)
    earlier = tablet_link(db, ha_user_id)
    now = app["clock"]()
    own = new_device = 0
    if device_id:
        dev = db.execute("SELECT d.*, t.ha_user_id AS linked_to, t.own_device AS linked_own FROM devices d "
                         "LEFT JOIN ha_tablet_links t ON t.device_id = d.id WHERE d.id = ?", (device_id,)).fetchone()
        if dev is None or dev["revoked"] is not None or dev["role"] != "wall_tablet":
            raise TabletLinkError("unknown_device", "device_id: a live wall-tablet device", 404)
        if dev["linked_to"] is not None and dev["linked_to"] not in (ha_user_id, moving_from):
            raise TabletLinkError("device_taken", "that device is already another HA user's tablet", 409)
        if moving_from is not None and dev["linked_to"] == moving_from:
            own = int(bool(dev["linked_own"]))
        else:
            moving_from = None
        final_room = room if room is not None else dev["room"]
    else:
        device_id, final_room = secrets.token_hex(16), room
        own = new_device = 1
    audit.config(request, ident if ident is not None else actor, "ingress.link_tablet",
                 {"ha_user_id": ha_user_id, "device_id": device_id, "room": final_room, "new_device": bool(new_device),
                  "was_person": person["role"] if person is not None else None, "moved_from": moving_from},
                 app=app)
    if new_device:
        label = (name or ha_name or "Wall tablet").strip()[:NAME_MAX]
        app["devices"].enroll(label, "wall_tablet", room, actor.id, device_id=device_id)   # its secret is never issued
    elif room is not None and room != dev["room"]:
        with db:
            db.execute("UPDATE devices SET room = ? WHERE id = ?", (room, device_id))
    with db:  # one transaction: never a person link and a tablet link at once
        if person is not None:
            db.execute("DELETE FROM ha_links WHERE ha_user_id = ?", (ha_user_id,))
            db.execute("DELETE FROM sessions WHERE user_id = ?", (person["id"],))
            if person["kind"] == "ha_linked":
                db.execute("DELETE FROM users WHERE id = ?", (person["id"],))
        if moving_from is not None:
            db.execute("DELETE FROM ha_tablet_links WHERE ha_user_id = ? AND device_id = ?", (moving_from, device_id))
        if earlier is not None:
            db.execute("DELETE FROM ha_tablet_links WHERE ha_user_id = ?", (ha_user_id,))
            if earlier["own_device"] and earlier["id"] != device_id:
                _revoke_in(db, earlier["id"], "tablet_relinked", now)
        db.execute("INSERT INTO ha_tablet_links (ha_user_id, device_id, ha_name, own_device, created, created_by) "
                   "VALUES (?,?,?,?,?,?)", (ha_user_id, device_id, (ha_name or "")[:120] or None, own, now, actor.id))
    row = tablet_link(db, ha_user_id)
    # live.py: what was open as that HA user (a person's sidebar, an earlier tablet) is checked now
    live.notify(app, f"ha:{ha_user_id}", *([f"user:{person['id']}"] if person is not None else []),
                *([f"device:{earlier['id']}"] if earlier is not None else []))
    log.info("Ingress people: %s linked HA user %s as the wall tablet %s (%s)", actor.name or actor.id, ha_user_id,
             row["name"], row["room"] or "no room")
    return {"ha_user_id": ha_user_id, "device": sessions.device_json(sessions.Device(
        row["id"], row["name"], row["role"], row["room"], ha_user_id=ha_user_id)), "new_device": bool(new_device)}


def unlink_tablet(app: web.Application, ha_user_id: str, actor: User, *, request: web.Request | None = None,
                  ident: Identity | None = None) -> bool:
    """Remove an HA user's tablet link (its open sockets lose it at once: live.py); a device that
    was made for the link is revoked. Audited first (``ingress.unlink_tablet``), as link_tablet."""
    db = app["store"].db
    row = tablet_link(db, ha_user_id) if isinstance(ha_user_id, str) else None
    if row is None:
        return False
    audit.config(request, ident if ident is not None else actor, "ingress.unlink_tablet",
                 {"ha_user_id": ha_user_id, "device_id": row["id"], "revoked": bool(row["own_device"])}, app=app)
    with db:
        db.execute("DELETE FROM ha_tablet_links WHERE ha_user_id = ?", (ha_user_id,))
        if row["own_device"]:
            _revoke_in(db, row["id"], "tablet_unlinked", app["clock"]())
    live.notify(app, f"ha:{ha_user_id}", f"device:{row['id']}")
    log.info("Ingress people: %s unlinked the wall tablet HA user %s", actor.name or actor.id, ha_user_id)
    return True


# REST: an Owner's own session (a person, not a device) on the LAN or a home-rules sidebar links tablets
@guard("manager")
async def api_tablets_get(request: web.Request) -> web.Response:
    db = request.app["store"].db
    return sessions.ok({"tablets": tablet_links(db), "rooms": rooms(request.app),
                        "free_devices": [dict(r) for r in free_devices(db)],
                        "allowed": tablets_allowed(request.app)})


@guard("owner", door="home", audit="ingress.link_tablet")
async def api_tablets_post(request: web.Request) -> web.Response:
    from .accounts import read_json
    ident = guarded(request)
    body = await read_json(request)
    if set(body) - {"ha_user_id", "device_id", "name", "room"}:
        return sessions.error(400, "invalid", message="{ha_user_id, device_id?, name?, room?}")
    target = body.get("ha_user_id")
    ha_name = None
    try:
        rec = await request.app["ha_directory"].user(target) if isinstance(target, str) else None
        ha_name = (rec or {}).get("name")
    except Exception:  # noqa: BLE001 -- the name is a convenience
        pass
    try:
        got = link_tablet(request.app, target, ident.user, device_id=body.get("device_id") or None,
                          name=body.get("name"), room=body.get("room"), ha_name=ha_name, request=request, ident=ident)
    except TabletLinkError as exc:
        return sessions.error(exc.status, exc.code, message=exc.message)
    return sessions.ok(got, status=201)


@guard("owner", door="home", audit="ingress.unlink_tablet")
async def api_tablets_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    if not unlink_tablet(request.app, request.match_info["ha_user_id"], ident.user, request=request, ident=ident):
        return sessions.error(404, "not_found")
    return sessions.ok()


def tablet_start(app: web.Application, device: sessions.Device) -> str | None:
    """Where a wall tablet's page opens: its HK tablet's screen (HK's settings: the tablet whose Tablet User
    is HA's name for this HA user, else the one in the device's room), naming the tablet for HK
    (``?hk_tablet=``, which HK remembers). None: Mantel's default screen."""
    host = app.get("features")
    tablets = dict(getattr(host, "tablets", None) or {})      # features.FeatureHost: HK's tablets, as settings say
    mine = [tid for tid, t in tablets.items() if device.ha_name and t.get("user") == device.ha_name]
    if not mine and device.room:
        mine = [tid for tid, t in tablets.items() if t.get("room") == device.room]
    for tid in sorted(mine):
        screen = str(tablets[tid].get("screen") or "")
        if re.fullmatch(r"[A-Za-z0-9_]+-[A-Za-z0-9_-]*", screen) and re.fullmatch(r"[a-z0-9_]+", tid):
            return f"/{screen}/home?hk_tablet={tid}"
    return None


# -- the people page: Owners and Admins link HA users to roles (never at a wall tablet) ---------------------------
@guard("manager")
async def people_get(request: web.Request) -> web.Response:
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = guarded(request)
    base = html.escape(request.get("mantel_base", ""))
    db = request.app["store"].db
    links = {r["ha_user_id"]: r for r in db.execute(
        "SELECT h.ha_user_id, u.role, u.name, u.disabled FROM ha_links h JOIN users u ON u.id = h.user_id")}
    error = ""
    try:
        people = household(await request.app["ha_directory"].users())
    except Exception as exc:  # noqa: BLE001
        log.warning("people page: could not read Home Assistant's users (%s)", type(exc).__name__)
        people, error = [], "<p>Mantel could not read Home Assistant's user list; link by HA user id below.</p>"
    tablets = {t["ha_user_id"]: t for t in tablet_links(db)}
    seen = {p["id"] for p in people}
    people += [{"id": k, "name": v["name"], "username": None} for k, v in links.items() if k not in seen]
    people += [{"id": k, "name": v["ha_name"] or v["device"]["name"], "username": None}
               for k, v in tablets.items() if k not in seen and k not in links]
    csrf = html.escape(ident.csrf or "")
    owner = ident.user.role == "owner"
    areas = rooms(request.app)
    free = free_devices(db)
    rows = []
    for p in people:
        link, tab = links.get(p["id"]), tablets.get(p["id"])
        current = link["role"] if link else ""
        if tab is not None:
            dev = tab["device"]
            where = areas.get(dev["room"] or "", dev["room"] or "no room")
            shown = f"wall tablet: {dev['name']} ({where}){' — revoked' if dev['revoked'] else ''}"
        else:
            shown = current or "not linked"
        options = "".join(f"<option value={r}{' selected' if r == current else ''}>{r}</option>" for r in LINK_ROLES)
        unlink = (f"<button name=action value=unlink>Unlink</button>" if link or (tab and owner) else "")
        tablet_form = ""
        if owner:
            # "Link as a wall tablet": this HA user is a tablet (Kiosk Satellite signed in as it), not a person
            devs = "<option value=''>a new device</option>" + "".join(
                f"<option value='{html.escape(d['id'])}'>{html.escape(d['name'])}"
                f"{' (' + html.escape(areas.get(d['room'] or '', d['room'] or '')) + ')' if d['room'] else ''}</option>"
                for d in free)
            cur_room = tab["device"]["room"] if tab else ""
            room_opts = "<option value=''>no room</option>" + "".join(
                f"<option value='{html.escape(a)}'{' selected' if a == cur_room else ''}>{html.escape(n)}</option>"
                for a, n in sorted(areas.items(), key=lambda kv: kv[1]))
            tablet_form = (f"<form method=post action='{base}/ingress/people'><input type=hidden name=csrf value='{csrf}'>"
                           f"<input type=hidden name=ha_user_id value='{html.escape(p['id'])}'>"
                           f"<select name=device_id>{devs}</select> in <select name=room>{room_opts}</select> "
                           "<button name=action value=tablet>Link as a wall tablet</button></form>")
        rows.append(
            f"<tr><td>{html.escape(p.get('name') or p.get('username') or p['id'])}"
            f"{' (admin in HA)' if is_ha_admin(p) else ''}</td><td>{html.escape(shown)}</td>"
            f"<td><form method=post action='{base}/ingress/people'><input type=hidden name=csrf value='{csrf}'>"
            f"<input type=hidden name=ha_user_id value='{html.escape(p['id'])}'><select name=role>{options}</select> "
            f"<button name=action value=link>Link</button> {unlink}</form>{tablet_form}</td></tr>")
    note = ""
    if owner:
        note = ("<p class=note>A wall tablet is its own Home Assistant user (Kiosk Satellite signed in by trusted_networks). "
                "<i>Link as a wall tablet</i> makes that account a Mantel device in its room: nobody is signed in on it, "
                "and what it may do is its role's (no PIN; the alarm takes the house Alarm PIN).</p>")
        if not tablets_allowed(request.app):
            note += ("<p class=note><b>Wall tablets are refused on the sidebar now</b> (<code>ha_door_rules: tunnel</code>); "
                     "set it to <code>trusted</code> or <code>lan</code> for linked tablets to open.</p>")
    body = (error + "<table><tr><th>Home Assistant user</th><th>In Mantel</th><th></th></tr>" + "".join(rows) + "</table>"
            + note +
            f"<h2>By HA user id</h2><form method=post action='{base}/ingress/people'><input type=hidden name=csrf "
            f"value='{csrf}'><input name=ha_user_id placeholder='HA user id' size=34> <select name=role>"
            + "".join(f"<option value={r}>{r}</option>" for r in LINK_ROLES)
            + "</select> <button name=action value=link>Link</button></form>"
            f"<p><a href='{base}/home'>Back to Mantel</a></p>")
    settings = request.app.get("settings")
    if settings is not None and ident.user.role == "owner":
        record = settings.store.import_record()
        state = (f"imported from {html.escape(str(record['source']))}" if record else
                 "not imported yet" + (" (Mantel's settings are empty)" if settings.store.empty() else ""))
        body += (f"<h2>HK's settings</h2><p>HK's settings in Mantel: {state}.</p>"
                 f"<form method=post action='{base}/ingress/import-settings'><input type=hidden name=csrf value='{csrf}'>"
                 "<button>Import HK's settings from Home Assistant (once)</button></form>"
                 "<p class=note>Reads HK Frontend's settings from Home Assistant one time; changes nothing there.</p>")
        host = request.app.get("features")
        if host is not None:
            told = ", ".join(host.client_added()) or "none"
            body += (f"<p>HK's features on Mantel's screens: {html.escape(told)}.</p>"
                     f"<form method=post action='{base}/ingress/import-features'><input type=hidden name=csrf value='{csrf}'>"
                     "<button>Import HK's features from Home Assistant again</button></form>"
                     "<p class=note>Reads which features HK Frontend has added (and the settings of Notifications, "
                     "Clean Areas, Energy and Live TV); changes nothing there.</p>")
    if ident.csrf is None:
        body = "<p>Reload this page once (Mantel is starting your session).</p>" + body
    return _page("People", body)


@guard("manager", audit=("ingress.link", "ingress.unlink", "ingress.link_tablet", "ingress.unlink_tablet"))
async def people_post(request: web.Request) -> web.Response:
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = guarded(request)
    base = request.get("mantel_base", "")
    if request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")
    form = parse_qs((await request.text())[:4096])
    get = lambda k: (form.get(k) or [""])[0].strip()  # noqa: E731
    if not ident.csrf or not hmac.compare_digest(get("csrf"), ident.csrf):
        raise web.HTTPForbidden(text="stale form: reload the page")
    target, role, action = get("ha_user_id"), get("role"), get("action")
    if not USER_RE.match(target) or action not in ("link", "unlink", "tablet") or (action == "link" and role not in LINK_ROLES):
        return _page("Not changed", f"<p>That form was incomplete. <a href='{html.escape(base)}/ingress/people'>Back</a></p>", 400)
    store = request.app["store"]
    db = store.db
    back = f"<p><a href='{html.escape(base)}/ingress/people'>Back</a></p>"
    tab = tablet_link(db, target)
    if action == "tablet" or (tab is not None and action == "unlink"):
        if ident.user.role != "owner":
            raise web.HTTPForbidden(text="only an Owner links or unlinks wall tablets")
        authz = request.app.get("authz")
        if authz is not None and not authz.home_door(ident):
            return _page("Not changed", "<p>Wall tablets are linked on the LAN or a trusted sidebar only.</p>" + back, 403)
        if action == "unlink":
            unlink_tablet(request.app, target, ident.user, request=request, ident=ident)
            raise web.HTTPSeeOther(base + "/ingress/people")
        ha_name = None
        try:
            ha_name = ((await request.app["ha_directory"].user(target)) or {}).get("name")
        except Exception:  # noqa: BLE001 -- the name is a convenience
            pass
        try:
            link_tablet(request.app, target, ident.user, device_id=get("device_id") or None, room=get("room") or None,
                        name=get("name") or None, ha_name=ha_name, request=request, ident=ident)
        except TabletLinkError as exc:
            return _page("Not changed", f"<p>{html.escape(exc.message)}.</p>" + back, exc.status)
        raise web.HTTPSeeOther(base + "/ingress/people")
    current = linked_user(db, target)
    if ident.user.role != "owner" and ("owner" in (role, current["role"] if current else None)):
        raise web.HTTPForbidden(text="only an Owner links or unlinks Owners")
    if current is not None and current["role"] == "owner" and (action == "unlink" or role != "owner"):
        others = db.execute("SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0 AND id != ?",
                            (current["id"],)).fetchone()[0]
        if not others:
            return _page("Not changed", "<p>Mantel always keeps at least one Owner.</p>"
                         f"<p><a href='{html.escape(base)}/ingress/people'>Back</a></p>", 409)
    if action == "link":
        name = None
        try:
            rec = await request.app["ha_directory"].user(target)
            name = (rec or {}).get("name")
        except Exception:  # noqa: BLE001 -- the name is a convenience
            pass
        if tab is not None and ident.user.role != "owner":   # was a wall tablet: now a person (an Owner's choice only)
            raise web.HTTPForbidden(text="only an Owner links or unlinks wall tablets")
        audit.config(request, ident, "ingress.link", {"ha_user_id": target, "role": role})
        if tab is not None:
            unlink_tablet(request.app, target, ident.user, request=request, ident=ident)
        store.link(target, role, name)
    else:
        audit.config(request, ident, "ingress.unlink", {"ha_user_id": target, "role": None})
        store.unlink(target)
    live.notify(request.app, f"ha:{target}", *([f"user:{current['id']}"] if current is not None else []))
    log.info("Ingress people: %s %s HA user %s%s", ident.user.name or ident.user.id, action, target,
             f" as {role}" if action == "link" else "")
    raise web.HTTPSeeOther(base + "/ingress/people")


@guard("owner", audit="ingress.import_settings")
async def import_settings_post(request: web.Request) -> web.Response:
    """The Owner's one-time import of HK's settings from HA (settings_store's import, as POST
    /api/settings/import does), from a plain form on the people page."""
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = guarded(request)
    base = request.get("mantel_base", "")
    if request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")
    form = parse_qs((await request.text())[:4096])
    if not ident.csrf or not hmac.compare_digest((form.get("csrf") or [""])[0], ident.csrf):
        raise web.HTTPForbidden(text="stale form: reload the page")
    from . import settings_store
    service = request.app.get("settings")
    hub = request.app.get("hub")
    proxy = getattr(hub, "readproxy", None)
    if service is None or proxy is None or not hasattr(proxy, "read_hk_settings"):
        return _page("Not imported", "<p>Mantel has no connection to Home Assistant to import from.</p>", 503)
    fetch = service.hooks.fetch_ha_settings or proxy.read_hk_settings
    audit.config(request, ident, "ingress.import_settings", {"source": "home_assistant"})
    try:
        got = await settings_store.import_settings(service.store, fetch, actor=settings_store.actor_of(ident),
                                                   model=service.model,
                                                   read_features=service.hooks.feature_reader(proxy))
    except Exception as exc:  # noqa: BLE001 -- say so; the store is unchanged
        log.warning("settings import failed: %s", type(exc).__name__)
        return _page("Not imported", f"<p>Home Assistant's HK settings could not be read ({html.escape(type(exc).__name__)})."
                     f" <a href='{html.escape(base)}/ingress/people'>Back</a></p>", 502)
    if got.get("imported"):
        service.publish()
    raise web.HTTPSeeOther(base + "/ingress/people")


@guard("owner", audit="ingress.import_features")
async def import_features_post(request: web.Request) -> web.Response:
    """The Owner's feature import, again and on its own (features.FeatureHost.import_from_ha, as POST
    /api/features/import does), from a plain form on the people page."""
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = guarded(request)
    base = request.get("mantel_base", "")
    if request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")
    form = parse_qs((await request.text())[:4096])
    if not ident.csrf or not hmac.compare_digest((form.get("csrf") or [""])[0], ident.csrf):
        raise web.HTTPForbidden(text="stale form: reload the page")
    host = request.app.get("features")
    if host is None:
        raise web.HTTPNotFound()
    audit.config(request, ident, "ingress.import_features", {"source": "home_assistant"})
    try:
        got = await host.import_from_ha(ident)
    except Exception as exc:  # noqa: BLE001 -- say so; the store is unchanged
        log.warning("feature import failed: %s", type(exc).__name__)
        return _page("Not imported", f"<p>Home Assistant's HK features could not be read ({html.escape(type(exc).__name__)})."
                     f" <a href='{html.escape(base)}/ingress/people'>Back</a></p>", 502)
    log.info("Ingress people: %s imported HK's features (%s)", ident.user.name or ident.user.id, got.get("added"))
    raise web.HTTPSeeOther(base + "/ingress/people")


# -- serving files under the prefix -----------------------------------------------------------------
# key -> (the rewritten body, its ETag, the same gzipped or None when gzip would not make it smaller). The
# gzipped body is made once, beside the plain one (2026-10-29: a rewritten file went through Ingress at its
# full size on a tablet's slow link); both count toward CACHE_LIMIT.
_CACHE: "OrderedDict[tuple, tuple[bytes, str, bytes | None]]" = OrderedDict()
_CACHE_SIZE = [0]


def accepts_gzip(request: web.Request) -> bool:
    """Whether the browser takes a gzipped body: gzip (or *) named in Accept-Encoding and not given q=0."""
    for part in request.headers.get("Accept-Encoding", "").lower().split(","):
        name, _, params = part.partition(";")
        if name.strip() in ("gzip", "x-gzip", "*"):
            q = params.replace(" ", "")
            return not (q.startswith("q=") and _q_is_zero(q[2:]))
    return False


def _q_is_zero(q: str) -> bool:
    try:
        return float(q) == 0
    except ValueError:
        return False


def rewrite(text: str, base: str) -> str:
    """HK's code under the Ingress prefix: absolute asset references moved under it, location.pathname
    read without it. A pure function of the text and the prefix (tests: tests/test_ingress_paths.py)."""
    if not base:
        return text
    text = ASSET_LITERAL.sub(lambda m: f"{m.group(1)}{base}/{m.group(2)}/", text)
    return PATHNAME_READ.sub(f"location.pathname.slice({len(base)})", text)


# Mantel's own static pages (admin, proxy-check) name their assets and the dashboard in href/src attributes;
# their JS reads the prefix itself (<meta name="mantel-base">), so only the HTML needs this.
OWN_ATTR = re.compile(r"""\b(href|src)=(["'])/(admin/|proxy-check/|hk-settings\2|settings\2|home\2)""")


def own_page(text: str, base: str) -> str:
    """One of Mantel's own pages under the Ingress prefix: the base meta, and its attributes moved under it.
    Outside Ingress (empty base) the text is returned untouched."""
    if not base:
        return text
    return inject_base(OWN_ATTR.sub(lambda m: f"{m.group(1)}={m.group(2)}{base}/{m.group(3)}", text), base)


HOME_SCREEN_BLOCK = re.compile(r"<!-- home-screen:.*?<!-- /home-screen -->\n?", re.S)


def inject_base(text: str, base: str, kiosk: bool = False) -> str:
    """The page's prefix for Mantel's own code (web/shim/base.js reads it); for a wall tablet that is its
    own HA user, also the kiosk mark (base.js then asks HA's frontend to hide its sidebar and header)."""
    # the Home Screen tags (app_shell.py) are Mantel's own address's: through Ingress the page is HA's
    text = HOME_SCREEN_BLOCK.sub("", text)
    meta = f'{REFERRER_META}\n<meta name="mantel-base" content="{html.escape(base)}">'
    if kiosk:
        meta += "\n" + KIOSK_META
    return text.replace("<head>", "<head>\n" + meta, 1) if "<head>" in text else meta + text


def file_response(request: web.Request, path: Path, headers: dict | None = None,
                  page: bool = False) -> web.StreamResponse:
    """A file as server.py serves it; through Ingress a JS/CSS/HTML file is rewritten for the prefix."""
    base = request.get("mantel_base", "")
    suffix = path.suffix.lower()
    if not base or suffix not in REWRITE_SUFFIXES:
        return web.FileResponse(path, headers=headers)
    st = path.stat()
    kiosk = page and is_ha_tablet(request.get("identity"))
    key = (str(path), st.st_mtime_ns, st.st_size, base, page, kiosk)
    hit = _CACHE.get(key)
    if hit is None:
        text = path.read_text(encoding="utf-8", errors="surrogateescape")
        if page:
            text = inject_base(text, base, kiosk)
        body = rewrite(text, base).encode("utf-8", "surrogateescape")
        packed = gzip.compress(body, compresslevel=6, mtime=0)
        hit = (body, '"' + hashlib.sha256(body).hexdigest()[:32] + '"', packed if len(packed) < len(body) else None)
        _CACHE[key] = hit
        _CACHE_SIZE[0] += len(body) + len(hit[2] or b"")
        while _CACHE_SIZE[0] > CACHE_LIMIT and _CACHE:
            _, (old, _, old_gz) = _CACHE.popitem(last=False)
            _CACHE_SIZE[0] -= len(old) + len(old_gz or b"")
    else:
        _CACHE.move_to_end(key)
    body, etag, packed = hit
    out = dict(headers or {})
    # the two encodings are two representations: each has its own ETag, and a cache is told they vary
    out["Vary"] = ", ".join(filter(None, [out.get("Vary"), "Accept-Encoding"]))
    zipped = packed is not None and accepts_gzip(request)
    if zipped:
        etag = etag[:-1] + '-gz"'
    out["ETag"] = etag
    if request.headers.get("If-None-Match") == etag:
        return web.Response(status=304, headers=out)
    ctype = CONTENT_TYPES.get(suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if zipped:
        out["Content-Encoding"] = "gzip"
        return web.Response(body=packed, headers=out, content_type=ctype, charset="utf-8")
    return web.Response(body=body, headers=out, content_type=ctype, charset="utf-8")


# -- the middleware ---------------------------------------------------------------------------------
_warned: dict[str, float] = {}


def _warn_forged(request: web.Request) -> None:
    peer = request.remote or "?"
    now = time.monotonic()
    if now - _warned.get(peer, -WARN_EVERY) >= WARN_EVERY:
        _warned[peer] = now
        log.warning("ignored HA identity headers (%s) from %s: only the Ingress proxy may send them",
                    ", ".join(h for h in IDENTITY_HEADERS if h in request.headers), peer)


def _moved(location: str, base: str) -> str:
    if base and location.startswith("/") and not location.startswith("//") and not location.startswith(base + "/"):
        return base + location
    return location


@web.middleware
async def middleware(request: web.Request, handler):
    cfg = request.app["cfg"]
    if not getattr(cfg, "ingress", False):
        return await handler(request)          # not HA App mode: the headers are never read
    if not is_ingress(request):
        if any(h in request.headers for h in IDENTITY_HEADERS + (INGRESS_PATH,)):
            _warn_forged(request)
        from . import direct
        if direct.is_direct(request):
            # the App's direct access (decision 26, direct.py): Mantel's own sign-in and doors decide; the
            # Ingress-only gate lets exactly this listener through (HA Core's exception stays on the Ingress port)
            if direct.certificate_pending(request) and request.path not in HEALTH_PATHS:
                return direct.pending_response()     # no sign-in over the self-signed placeholder
            return await handler(request)
        if request.path in CORE_PATHS and request.remote in tuple(getattr(cfg, "ha_core_peers", ()) or ()):
            # HA Core's linked-mode client (hk_frontend "Linked to Mantel Server"); linked.py still wants its
            # Service credential. authz.resolve_door treats this one request as the LAN door.
            request["ha_core"] = True
            return await handler(request)
        if getattr(cfg, "ingress_only", False) and request.path not in HEALTH_PATHS:
            raise web.HTTPForbidden(text="Mantel is reached through Home Assistant's sidebar only")
        return await handler(request)
    base = prefix_of(request)
    request["mantel_base"] = base
    request["cookie_path"] = base + "/"
    request["cookie_secure"] = _https(request)
    request["ingress_client_ip"] = _client_ip(request)
    if request.path in SIGN_IN_PATHS or request.path.startswith(SIGN_IN_PREFIX):
        if wants_page(request):
            return _page("Signed in by Home Assistant", "<p>Through Home Assistant's sidebar, Home Assistant "
                         f"signs you in. <a href='{html.escape(base)}/home'>Open Mantel</a>.</p>", 403)
        return web.json_response({"error": "ingress_sign_in", "message": "signed in by Home Assistant"}, status=403)
    if request.path not in HEALTH_PATHS and request.path not in OWN_PATHS:
        ident = sessions.identity(request)
        if not ident.authenticated:
            if wants_page(request):
                return await unlinked_page(request, request.get("ingress_unlinked") or ha_person(request))
            if request.get("ingress_tablet_refused") is not None:
                return web.json_response({"error": "tablet_refused", "message": "this wall tablet is not allowed "
                                          "through the sidebar now"}, status=401)
            return web.json_response({"error": "not_linked", "message": "ask a Mantel Owner to link your "
                                      "Home Assistant account"}, status=401)
        if request.path in ("/", "/home") and is_ha_tablet(ident):
            from . import default_screens                     # the tablet's own screen, else its HK tablet's
            start = default_screens.start_for(request.app, ident)
            if start is not None:
                raise web.HTTPFound(base + start)
        if request.path == "/":
            raise web.HTTPFound(base + "/home")
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        if 300 <= exc.status < 400 and "Location" in exc.headers:
            exc.headers["Location"] = _moved(exc.headers["Location"], base)
        raise
    if 300 <= resp.status < 400 and "Location" in resp.headers:
        resp.headers["Location"] = _moved(resp.headers["Location"], base)
    return resp


def register(app: web.Application, hub=None, token: str | None = None) -> None:
    """Install the identity hook, the bootstrap and people pages. Inert unless cfg.ingress."""
    cfg = app["cfg"]
    if not getattr(cfg, "ingress", False):
        return
    app["ingress_identity"] = resolve
    app.setdefault("ha_directory", HaDirectory(cfg.ws_url, token))
    app.setdefault("public_paths", set()).update(OWN_PATHS)
    app.router.add_get("/ingress/bootstrap", bootstrap_get)
    app.router.add_post("/ingress/bootstrap", bootstrap_post)
    app.router.add_get("/ingress/people", people_get)
    app.router.add_post("/ingress/people", people_post)
    app.router.add_post("/ingress/import-settings", import_settings_post)
    app.router.add_post("/ingress/import-features", import_features_post)
    app.router.add_get("/api/ingress/tablets", api_tablets_get)
    app.router.add_post("/api/ingress/tablets", api_tablets_post)
    app.router.add_delete("/api/ingress/tablets/{ha_user_id}", api_tablets_delete)
    who = ", ".join(cfg.ingress_peers)
    if getattr(cfg, "connect", False):
        who = (who + " and " if who else "") + "paired Mantel Connect Apps (client certificate)"
    log.info("HA App mode: identity from Ingress, believed only from %s%s; door 'ha' uses the %s rules",
             who, " (Ingress only)" if cfg.ingress_only else "", cfg.ha_door_rules)
    core = tuple(getattr(cfg, "ha_core_peers", ()) or ())
    if core:
        log.info("HA App mode: HA Core (%s) may reach linked mode's endpoint (with its Service credential)",
                 ", ".join(core))
