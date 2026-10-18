"""HA App mode: Home Assistant's sidebar (Ingress) as Mantel's way in (PLAN §7 Way 1, §8; docs/phase3/HA-APP.md).

When Mantel Server runs as an HA App, HA's Supervisor proxies the sidebar page to it and adds the
signed-in HA user to every request (``X-Remote-User-Id`` / ``-Name`` / ``-Display-Name``) and the page's
prefix (``X-Ingress-Path: /api/hassio_ingress/<token>``). This module turns that into Mantel's identity.

* **Unforgeable.** The headers are believed ONLY when ``cfg.ingress`` is on AND the socket peer is one
  of ``cfg.ingress_peers`` (default ``172.30.32.2``, the Supervisor on the hassio network). Never a
  forwarded-for header, never anyone else: from any other peer they are ignored and logged, and with
  ``cfg.ingress_only`` (the App's setting) such a request is refused outright (health checks excepted).
* **Linked users only** (PLAN §5). The HA user id maps through P3.1's ``ha_links`` to a Mantel user and
  its role. An unlinked HA user gets a page saying to ask an Owner, and nothing else.
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
  factor: sensitive actions still need a step-up (PIN or TOTP). A cookie of an Ingress session is good
  only through Ingress, and only for the HA user whose headers come with it.
* **The prefix.** The page lives under ``/api/hassio_ingress/<token>/``. Every redirect Mantel sends is
  moved under it; the page's HTML gets ``<meta name="mantel-base">`` for Mantel's own code
  (web/shim/base.js: REST calls, the WebSocket, history writes); and HK's code (shared with the HA
  build, so its files never change) is served with its absolute ``/hk/``, ``/web/`` and ``/static/mdi/``
  references moved under the prefix and its reads of ``location.pathname`` seen without it.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import html
import logging
import mimetypes
import re
import secrets
import time
from collections import OrderedDict
from ipaddress import ip_address
from pathlib import Path
from urllib.parse import parse_qs

import aiohttp
from aiohttp import web

from . import sessions
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
LINK_ROLES = ("owner", "admin", "adult", "child", "guest")   # wall tablets never come through Ingress
DIRECTORY_TTL = 30.0

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
    got = bool(getattr(cfg, "ingress", False)) and request.remote is not None \
        and request.remote in tuple(getattr(cfg, "ingress_peers", ()) or ())
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
        issued = mgr.create(user.id, "tunnel", INGRESS_METHOD, fresh=False,
                            user_agent=request.headers.get("User-Agent"), source_ip=sessions.client_ip(request))
        sessions._queue_issued(request, issued)
        srow = mgr.get(issued.session_id, now)
        log.info("Ingress: started a session for %s (HA user %s)", user.name or user.id, person["id"])
    if srow is None:
        # no session yet (a request before the page's first load set the cookies): the user, read-only
        # in effect (no CSRF token, so no state-changing REST; no step-up can be stored)
        return Identity(user, None, "ha")
    mgr.touch(srow, now, sessions.client_ip(request))
    return Identity(user=user, device=None, door="ha", fresh_factor_at=srow["fresh_factor_at"],
                    fresh_factor=srow["fresh_factor"], session_id=srow["id"], csrf=srow["csrf"])


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


async def unlinked_page(request: web.Request, person: dict | None) -> web.Response:
    base = request.get("mantel_base", "")
    if person is None:
        return _page("Not signed in", "<p>Home Assistant did not say who you are. Reload the page from "
                     "Home Assistant's sidebar.</p>", 401)
    who = html.escape(person.get("display") or person.get("username") or "this account")
    state, _ = await bootstrap_state(request, person)
    if state == "admin":
        nonce = bootstrap_nonce(request.app, person["id"], request.app["clock"]())
        body = (f"<p>Home Assistant says you are <b>{who}</b>, an administrator.</p>"
                "<p>Mantel has no Owner yet. The Owner can do everything in Mantel: manage people, roles and "
                "devices, see the audit log, and (when the App's commands are on) control the whole house.</p>"
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
    if person is not None and linked_user(request.app["store"].db, person["id"]) is not None:
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
        if linked_user(db, person["id"]) is not None:
            db.execute("UPDATE users SET role = 'owner', updated = ? WHERE id = (SELECT user_id FROM ha_links "
                       "WHERE ha_user_id = ?)", (now, person["id"]))
        else:
            uid = secrets.token_hex(16)
            db.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES (?,?,?,?,?,?)",
                       (uid, name, "owner", "ha_linked", now, now))
            db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES (?,?,?)", (person["id"], uid, now))
    row = linked_user(db, person["id"])
    _audit(app, row["id"], "owner", "ingress.bootstrap_owner", {"ha_user_id": person["id"], "name": name})
    log.warning("Ingress bootstrap: HA administrator %s (HA user %s) is now Mantel's first Owner", name, person["id"])
    return _page("You are Mantel's Owner", f"<p>Welcome, <b>{html.escape(name or '')}</b>.</p>"
                 f"<p><a href='{html.escape(base)}/home'>Open Mantel</a> · "
                 f"<a href='{html.escape(base)}/ingress/people'>Link the rest of the household</a></p>")


def _audit(app: web.Application, actor: str | None, role: str | None, action: str, detail: dict) -> None:
    audit = app.get("audit")
    if audit is not None:
        audit.config_event({"timestamp": app["clock"](), "actor": actor, "role": role, "action": action,
                            "detail": detail})


# -- the people page: Owners and Admins link HA users to roles ----------------------------------------
def _manager(request: web.Request) -> Identity:
    ident = sessions.identity(request)
    if ident.user is None or ident.user.role not in ("owner", "admin"):
        raise web.HTTPForbidden(text="Owners and Admins only")
    return ident


async def people_get(request: web.Request) -> web.Response:
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = _manager(request)
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
    seen = {p["id"] for p in people}
    people += [{"id": k, "name": v["name"], "username": None} for k, v in links.items() if k not in seen]
    csrf = html.escape(ident.csrf or "")
    rows = []
    for p in people:
        link = links.get(p["id"])
        current = link["role"] if link else ""
        options = "".join(f"<option value={r}{' selected' if r == current else ''}>{r}</option>" for r in LINK_ROLES)
        unlink = (f"<button name=action value=unlink>Unlink</button>" if link else "")
        rows.append(
            f"<tr><td>{html.escape(p.get('name') or p.get('username') or p['id'])}"
            f"{' (admin in HA)' if is_ha_admin(p) else ''}</td><td>{html.escape(current or 'not linked')}</td>"
            f"<td><form method=post action='{base}/ingress/people'><input type=hidden name=csrf value='{csrf}'>"
            f"<input type=hidden name=ha_user_id value='{html.escape(p['id'])}'><select name=role>{options}</select> "
            f"<button name=action value=link>Link</button> {unlink}</form></td></tr>")
    body = (error + "<table><tr><th>Home Assistant user</th><th>Mantel role</th><th></th></tr>" + "".join(rows) + "</table>"
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
    if ident.csrf is None:
        body = "<p>Reload this page once (Mantel is starting your session).</p>" + body
    return _page("People", body)


async def people_post(request: web.Request) -> web.Response:
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = _manager(request)
    base = request.get("mantel_base", "")
    if request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")
    form = parse_qs((await request.text())[:4096])
    get = lambda k: (form.get(k) or [""])[0].strip()  # noqa: E731
    if not ident.csrf or not hmac.compare_digest(get("csrf"), ident.csrf):
        raise web.HTTPForbidden(text="stale form: reload the page")
    target, role, action = get("ha_user_id"), get("role"), get("action")
    if not USER_RE.match(target) or action not in ("link", "unlink") or (action == "link" and role not in LINK_ROLES):
        return _page("Not changed", f"<p>That form was incomplete. <a href='{html.escape(base)}/ingress/people'>Back</a></p>", 400)
    store = request.app["store"]
    db = store.db
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
        store.link(target, role, name)
    else:
        store.unlink(target)
    _audit(request.app, ident.user.id, ident.user.role, f"ingress.{action}",
           {"ha_user_id": target, "role": role if action == "link" else None})
    log.info("Ingress people: %s %s HA user %s%s", ident.user.name or ident.user.id, action, target,
             f" as {role}" if action == "link" else "")
    raise web.HTTPSeeOther(base + "/ingress/people")


async def import_settings_post(request: web.Request) -> web.Response:
    """The Owner's one-time import of HK's settings from HA (settings_store's import, as POST
    /api/settings/import does), from a plain form on the people page."""
    if not is_ingress(request):
        raise web.HTTPNotFound()
    ident = _manager(request)
    base = request.get("mantel_base", "")
    if ident.user.role != "owner":
        raise web.HTTPForbidden(text="Owners only")
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
    try:
        got = await settings_store.import_settings(service.store, fetch, actor=settings_store.actor_of(ident),
                                                   model=service.model)
    except Exception as exc:  # noqa: BLE001 -- say so; the store is unchanged
        log.warning("settings import failed: %s", type(exc).__name__)
        return _page("Not imported", f"<p>Home Assistant's HK settings could not be read ({html.escape(type(exc).__name__)})."
                     f" <a href='{html.escape(base)}/ingress/people'>Back</a></p>", 502)
    if got.get("imported"):
        service.publish()
    _audit(request.app, ident.user.id, "owner", "ingress.import_settings", {"source": got.get("source"),
                                                                            "imported": bool(got.get("imported"))})
    raise web.HTTPSeeOther(base + "/ingress/people")


# -- serving files under the prefix -----------------------------------------------------------------
_CACHE: "OrderedDict[tuple, tuple[bytes, str]]" = OrderedDict()
_CACHE_SIZE = [0]


def rewrite(text: str, base: str) -> str:
    """HK's code under the Ingress prefix: absolute asset references moved under it, location.pathname
    read without it. A pure function of the text and the prefix (tests: tests/test_ingress_paths.py)."""
    if not base:
        return text
    text = ASSET_LITERAL.sub(lambda m: f"{m.group(1)}{base}/{m.group(2)}/", text)
    return PATHNAME_READ.sub(f"location.pathname.slice({len(base)})", text)


def inject_base(text: str, base: str) -> str:
    """The page's prefix for Mantel's own code (web/shim/base.js reads it)."""
    meta = f'{REFERRER_META}\n<meta name="mantel-base" content="{html.escape(base)}">'
    return text.replace("<head>", "<head>\n" + meta, 1) if "<head>" in text else meta + text


def file_response(request: web.Request, path: Path, headers: dict | None = None,
                  page: bool = False) -> web.StreamResponse:
    """A file as server.py serves it; through Ingress a JS/CSS/HTML file is rewritten for the prefix."""
    base = request.get("mantel_base", "")
    suffix = path.suffix.lower()
    if not base or suffix not in REWRITE_SUFFIXES:
        return web.FileResponse(path, headers=headers)
    st = path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size, base, page)
    hit = _CACHE.get(key)
    if hit is None:
        text = path.read_text(encoding="utf-8", errors="surrogateescape")
        if page:
            text = inject_base(text, base)
        body = rewrite(text, base).encode("utf-8", "surrogateescape")
        hit = (body, '"' + hashlib.sha256(body).hexdigest()[:32] + '"')
        _CACHE[key] = hit
        _CACHE_SIZE[0] += len(body)
        while _CACHE_SIZE[0] > CACHE_LIMIT and _CACHE:
            _, (old, _) = _CACHE.popitem(last=False)
            _CACHE_SIZE[0] -= len(old)
    else:
        _CACHE.move_to_end(key)
    body, etag = hit
    out = dict(headers or {})
    out["ETag"] = etag
    if request.headers.get("If-None-Match") == etag:
        return web.Response(status=304, headers=out)
    ctype = CONTENT_TYPES.get(suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
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
            return web.json_response({"error": "not_linked", "message": "ask a Mantel Owner to link your "
                                      "Home Assistant account"}, status=401)
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
    log.info("HA App mode: identity from Ingress, believed only from %s%s; door 'ha' uses the %s rules",
             ", ".join(cfg.ingress_peers), " (Ingress only)" if cfg.ingress_only else "", cfg.ha_door_rules)
