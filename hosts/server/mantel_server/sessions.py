"""Sessions and the identity of a request (PLAN §7 "Identity and sessions").

A sign-in creates a *session* (one refresh family) for one user and one door:

* an **access token** (15 minutes) in the ``mantel_session`` cookie, and
* a **refresh token** in ``mantel_refresh``, rotated on every use. The session ends at an absolute
  time: 30 days after sign-in on the LAN door, 12 hours on the tunnel door.
* Both cookies are ``HttpOnly; SameSite=Strict`` (and ``Secure`` whenever the Host is not a loopback
  name; see ``cookie_secure``). Only SHA-256 hashes of tokens are stored.
* A refresh token used a second time (later than a short grace for parallel requests) revokes the
  whole family: someone else holds a copy.
* Every state-changing ``/api/`` request needs ``X-CSRF-Token`` equal to the session's CSRF token
  (also given in the readable ``mantel_csrf`` cookie and by ``GET /api/session``).
* A session is bound to its door: a LAN session presented on the tunnel door is not accepted.

``identity(request)`` is what other slices use: it returns ``Identity(user, device, door,
fresh_factor_at, …)``. The effective identity for RBAC (P3.2) is the pair (user, device); a wall
tablet's requests carry ``user=None`` and its ``device``.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import sqlite3
from dataclasses import dataclass
from http.cookies import SimpleCookie
from ipaddress import ip_address

from aiohttp import hdrs, web

from .guards import guard
from .guards import ident as guarded

log = logging.getLogger("mantel.sessions")

ACCESS_COOKIE = "mantel_session"     # the Phase 0 cookie name; it now holds an access token
REFRESH_COOKIE = "mantel_refresh"
CSRF_COOKIE = "mantel_csrf"
CSRF_HEADER = "X-CSRF-Token"
ACCESS_TTL = 15 * 60
REFRESH_REUSE_GRACE = 30.0           # a refresh token seen again this soon is a parallel request, not theft
TOUCH_EVERY = 60.0
DOORS = ("lan", "tunnel")            # the doors a session row is stored with
# Doors a request can come by: the two above, plus 'ha' (through Home Assistant's sidebar, Ingress, HA
# App mode only; ingress.py). An 'ha' session is stored as door 'tunnel' with method 'ingress' (the
# stricter stored value; see docs/phase3/HA-APP.md) and only ever resolved through Ingress.
REQUEST_DOORS = DOORS + ("ha",)
INGRESS_METHOD = "ingress"
APP_METHOD = "app"                   # the iPhone/iPad/Mac apps' credential (app_auth.py): never a cookie
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "[::1]", "::1"})
COOKIE_QUEUE = "mantel_cookie_queue"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# -- identity -------------------------------------------------------------------------------------
@dataclass(frozen=True)
class User:
    id: str
    name: str | None
    role: str
    kind: str
    username: str | None = None
    ha_user_id: str | None = None


@dataclass(frozen=True)
class Device:
    id: str
    name: str
    role: str
    room: str | None = None
    # HA App mode: a wall tablet that is its own HA user, linked to this device (ingress.py, table
    # ha_tablet_links). Its HA user id and HA's name for it (HK's Tablet User is matched by that name).
    ha_user_id: str | None = None
    ha_name: str | None = None


@dataclass(frozen=True)
class Identity:
    """Who is asking. ``user`` and ``device`` may both be set (a person at a tablet), or one alone."""
    user: User | None
    device: Device | None
    door: str
    fresh_factor_at: float | None = None
    fresh_factor: str | None = None
    session_id: str | None = None
    csrf: str | None = None

    @property
    def authenticated(self) -> bool:
        return self.user is not None or self.device is not None

    def fresh_within(self, seconds: float, now: float) -> bool:
        return self.fresh_factor_at is not None and now - self.fresh_factor_at <= seconds


@dataclass(frozen=True)
class Issued:
    session_id: str
    access: str
    access_expires: float
    refresh: str | None
    csrf: str
    expires: float
    door: str


def door_of(request: web.Request) -> str:
    """'lan' or 'tunnel'. The reverse proxy (P3.6) sets ``X-Mantel-Door`` and overwrites any value a
    client sent; any Cloudflare header also means the tunnel. Unknown values fail closed to 'tunnel'.
    """
    resolver = request.app.get("door_resolver")
    if resolver is not None:
        door = resolver(request)
        return door if door in REQUEST_DOORS else "tunnel"
    h = request.headers
    if any(k in h for k in ("Cf-Connecting-Ip", "Cf-Access-Jwt-Assertion", "Cf-Ray")):
        return "tunnel"
    value = h.get("X-Mantel-Door")
    if value is None or value.strip().lower() == "lan":
        return "lan"
    return "tunnel"


def client_ip(request: web.Request) -> str | None:
    """The socket peer, or the last X-Forwarded-For hop when the peer is a configured trusted proxy."""
    if request.get("ingress_client_ip") is not None:   # set by ingress.py for Ingress requests only
        return request["ingress_client_ip"]
    remote = request.remote
    from . import proxy_trust
    if remote and proxy_trust.is_trusted(request):
        # every X-Forwarded-For line, not the first only: a proxy that adds a line of its own (HAProxy's
        # option forwardfor) left the browser's first, and the browser chose its address
        hops = [h.strip() for v in request.headers.getall("X-Forwarded-For", []) for h in v.split(",") if h.strip()]
        if hops:
            try:
                return str(ip_address(hops[-1]))
            except ValueError:
                pass
    return remote


def cookie_secure(request: web.Request) -> bool:
    """``Secure`` on every cookie unless the browser is talking to a loopback name.

    Production is always reached by a real hostname over TLS (Caddy), so its cookies are Secure
    whatever the proxy headers say. The loopback prototype is plain http on 127.0.0.1, where
    traffic never leaves the machine.
    """
    override = request.get("cookie_secure")       # ingress.py: the browser's scheme as HA saw it
    if override is not None:
        return bool(override)
    host = request.host or ""
    name = host if host.endswith("]") else host.rsplit(":", 1)[0]
    return name.lower() not in LOOPBACK_HOSTS


def cookie_path(request: web.Request | None) -> str:
    """'/' normally; under HA Ingress the page's prefix ('/api/hassio_ingress/<token>/', ingress.py), so
    Mantel's cookies are scoped to Mantel's own pages and never sent to the rest of HA's site."""
    return (request.get("cookie_path") if request is not None else None) or "/"


# -- storage --------------------------------------------------------------------------------------
class SessionManager:
    def __init__(self, conn: sqlite3.Connection, clock, lan_ttl: float = 30 * 86400,
                 tunnel_ttl: float = 12 * 3600, access_ttl: float = ACCESS_TTL) -> None:
        self.db = conn
        self.clock = clock
        self.ttl = {"lan": float(lan_ttl), "tunnel": float(tunnel_ttl)}
        self.access_ttl = float(access_ttl)
        self.on_revoke = None    # live.Live.notify (server.build_app): what is open as it ends at once

    def _now(self, now: float | None) -> float:
        return self.clock() if now is None else now

    def create(self, user_id: str, door: str, method: str, *, now: float | None = None,
               ttl: float | None = None, refresh: bool = True, fresh: bool = True,
               user_agent: str | None = None, source_ip: str | None = None, parent: str | None = None) -> Issued:
        """Start a session. ``ttl`` overrides the door's lifetime (the CLI's fixed-length cookies). ``parent``: the
        session this one was handed out by (the Mantel app's web view, app_auth.web_session); it ends with it."""
        if door not in DOORS:
            raise ValueError(f"unknown door {door!r}")
        now = self._now(now)
        lifetime = self.ttl[door] if ttl is None else float(ttl)
        expires = now + lifetime
        if parent is not None:      # never longer than the session that handed it out (an expiring app takes it)
            row = self.db.execute("SELECT expires FROM sessions WHERE id = ?", (parent,)).fetchone()
            if row is not None:
                expires = min(expires, float(row["expires"]))
        sid = secrets.token_hex(16)
        csrf = secrets.token_urlsafe(32)
        access = secrets.token_urlsafe(32)
        access_expires = min(now + self.access_ttl, expires) if refresh else expires
        refresh_token = secrets.token_urlsafe(32) if refresh else None
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE expires < ?", (now - 86400,))
            self.db.execute("DELETE FROM access_tokens WHERE expires < ?", (now,))
            self.db.execute(
                "INSERT INTO sessions (id, user_id, door, method, csrf, created, expires, last_seen, "
                "fresh_factor_at, fresh_factor, user_agent, source_ip, parent_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, user_id, door, method, csrf, now, expires, now, now if fresh else None,
                 method if fresh else None, (user_agent or "")[:200] or None, source_ip, parent))
            self.db.execute("INSERT INTO access_tokens VALUES (?,?,?)", (token_hash(access), sid, access_expires))
            if refresh_token:
                self.db.execute("INSERT INTO refresh_tokens (hash, session_id, created) VALUES (?,?,?)",
                                (token_hash(refresh_token), sid, now))
        return Issued(sid, access, access_expires, refresh_token, csrf, expires, door)

    _ROW = ("SELECT s.*, u.name AS user_name, u.role AS user_role, u.kind AS user_kind, u.username, "
            "u.disabled AS user_disabled, h.ha_user_id FROM sessions s JOIN users u ON u.id = s.user_id "
            "LEFT JOIN ha_links h ON h.user_id = u.id ")

    def _live(self, row, now: float, door: str | None) -> bool:
        return (row is not None and row["revoked"] is None and row["expires"] > now
                and not row["user_disabled"] and (door is None or row["door"] == door))

    def from_access(self, token: str | None, now: float | None = None, door: str | None = None):
        """The live session row for an access token, or None."""
        if not token:
            return None
        now = self._now(now)
        row = self.db.execute(self._ROW + "JOIN access_tokens a ON a.session_id = s.id "
                              "WHERE a.hash = ? AND a.expires > ?", (token_hash(token), now)).fetchone()
        return row if self._live(row, now, door) else None

    def get(self, session_id: str, now: float | None = None):
        row = self.db.execute(self._ROW + "WHERE s.id = ?", (session_id,)).fetchone()
        return row if self._live(row, self._now(now), None) else None

    def rotate(self, refresh_token: str | None, now: float | None = None, door: str | None = None,
               allow_app: bool = False):
        """Use a refresh token. Returns (status, value):

        ``("ok", (Issued, row))`` new tokens; ``("grace", row)`` a parallel request just after a
        rotation (accepted, no new tokens); ``("reuse", None)`` a used token came back: the family is
        revoked; ``("invalid", None)`` unknown, expired, revoked or wrong door.
        """
        if not refresh_token:
            return "invalid", None
        now = self._now(now)
        h = token_hash(refresh_token)
        rt = self.db.execute("SELECT * FROM refresh_tokens WHERE hash = ?", (h,)).fetchone()
        if rt is None:
            return "invalid", None
        row = self.db.execute(self._ROW + "WHERE s.id = ?", (rt["session_id"],)).fetchone()
        if not self._live(row, now, door):
            return "invalid", None
        if row["method"] == APP_METHOD and not allow_app:
            return "invalid", None            # an app's family rotates only with its device key (app_auth.py)
        if rt["used"] is not None:
            if now - rt["used"] <= REFRESH_REUSE_GRACE:
                return "grace", row
            self.revoke(row["id"], "refresh_reuse", now)
            log.warning("refresh token reuse: revoked session %s of user %s", row["id"], row["user_id"])
            return "reuse", None
        access = secrets.token_urlsafe(32)
        new_refresh = secrets.token_urlsafe(32)
        access_expires = min(now + self.access_ttl, row["expires"])
        with self.db:
            cur = self.db.execute("UPDATE refresh_tokens SET used = ? WHERE hash = ? AND used IS NULL", (now, h))
            if cur.rowcount != 1:  # lost a race with another rotation of the same token
                return "grace", row
            self.db.execute("INSERT INTO refresh_tokens (hash, session_id, created) VALUES (?,?,?)",
                            (token_hash(new_refresh), row["id"], now))
            self.db.execute("INSERT INTO access_tokens VALUES (?,?,?)", (token_hash(access), row["id"], access_expires))
            self.db.execute("DELETE FROM access_tokens WHERE session_id = ? AND expires < ?", (row["id"], now))
            self.db.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (now, row["id"]))
        issued = Issued(row["id"], access, access_expires, new_refresh, row["csrf"], row["expires"], row["door"])
        return "ok", (issued, row)

    def touch(self, row, now: float, source_ip: str | None = None) -> None:
        if row["last_seen"] is None or now - row["last_seen"] >= TOUCH_EVERY:
            with self.db:
                self.db.execute("UPDATE sessions SET last_seen = ?, source_ip = COALESCE(?, source_ip) WHERE id = ?",
                                (now, source_ip, row["id"]))

    def mark_fresh(self, session_id: str, factor: str, now: float | None = None) -> None:
        with self.db:
            self.db.execute("UPDATE sessions SET fresh_factor_at = ?, fresh_factor = ? WHERE id = ?",
                            (self._now(now), factor, session_id))

    def revoke(self, session_id: str, reason: str, now: float | None = None) -> bool:
        """End a session, and the sessions it handed out (``parent``): an app signed out takes its web view's.
        What is open as it (a page's socket, a live talk) ends on the next turn of the loop (``on_revoke``)."""
        now = self._now(now)
        with self.db:
            cur = self.db.execute("UPDATE sessions SET revoked = ?, revoked_reason = ? WHERE id = ? AND revoked IS NULL",
                                  (now, reason, session_id))
            self.db.execute("DELETE FROM access_tokens WHERE session_id = ?", (session_id,))
        if cur.rowcount and self.on_revoke is not None:
            self.on_revoke(f"session:{session_id}")
        for r in self.db.execute("SELECT id FROM sessions WHERE parent_id = ? AND revoked IS NULL", (session_id,)).fetchall():
            self.revoke(r["id"], reason, now)
        return cur.rowcount > 0

    def children(self, parent: str, method: str) -> list[str]:
        """The live sessions ``parent`` handed out with ``method``."""
        return [r["id"] for r in self.db.execute(
            "SELECT id FROM sessions WHERE parent_id = ? AND method = ? AND revoked IS NULL", (parent, method))]

    def revoke_user(self, user_id: str, reason: str, now: float | None = None, keep: str | None = None) -> int:
        ids = [r["id"] for r in self.db.execute(
            "SELECT id FROM sessions WHERE user_id = ? AND revoked IS NULL", (user_id,)) if r["id"] != keep]
        return sum(self.revoke(i, reason, now) for i in ids)

    def list(self, user_id: str, now: float | None = None) -> list[dict]:
        now = self._now(now)
        rows = self.db.execute(
            "SELECT id, user_id, door, method, created, expires, last_seen, fresh_factor_at, user_agent, source_ip, "
            "parent_id FROM sessions WHERE user_id = ? AND revoked IS NULL AND expires > ? ORDER BY created", (user_id, now))
        return [dict(r) for r in rows]


# -- cookies --------------------------------------------------------------------------------------
def _cookie_opts(request: web.Request, max_age: float, httponly: bool = True) -> dict:
    return dict(max_age=max(0, int(max_age)), httponly=httponly, samesite="Strict", path=cookie_path(request),
                secure=cookie_secure(request))


def set_session_cookies(request: web.Request, resp: web.StreamResponse, issued: Issued) -> None:
    now = request.app["clock"]()
    resp.set_cookie(ACCESS_COOKIE, issued.access, **_cookie_opts(request, issued.access_expires - now))
    if issued.refresh:
        resp.set_cookie(REFRESH_COOKIE, issued.refresh, **_cookie_opts(request, issued.expires - now))
    resp.set_cookie(CSRF_COOKIE, issued.csrf, **_cookie_opts(request, issued.expires - now, httponly=False))


def clear_session_cookies(resp: web.StreamResponse, request: web.Request | None = None) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
        resp.del_cookie(name, path=cookie_path(request))


def queue_cookie(request: web.Request, name: str, value: str | None, **opts) -> None:
    """Set (or with value None, delete) a cookie on whatever response this request ends with."""
    request.setdefault(COOKIE_QUEUE, []).append((name, value, opts))


def _morsel(name: str, value: str | None, opts: dict) -> str:
    jar = SimpleCookie()
    jar[name] = value or ""
    m = jar[name]
    m["path"] = opts.get("path", "/")
    if value is None:
        m["max-age"] = 0
        m["expires"] = "Thu, 01 Jan 1970 00:00:00 GMT"
    else:
        m["max-age"] = str(opts.get("max_age", 0))
        m["httponly"] = bool(opts.get("httponly"))
        m["secure"] = bool(opts.get("secure"))
    m["samesite"] = opts.get("samesite", "Strict")
    return m.OutputString()


async def _apply_cookie_queue(request: web.Request, response: web.StreamResponse) -> None:
    """on_response_prepare: add queued cookies (rotations made while resolving the identity).

    Written as Set-Cookie headers because the response's own cookie jar may already be serialised
    by the time this signal runs (it works for redirects, errors and the WebSocket handshake too).
    """
    queued = request.get(COOKIE_QUEUE)
    if not queued:
        return
    taken = {h.split("=", 1)[0].strip() for h in response.headers.getall(hdrs.SET_COOKIE, ())}
    taken.update(response.cookies.keys())
    for name, value, opts in queued:
        if name in taken:  # the handler set it itself (a sign-in or sign-out): that wins
            continue
        response.headers.add(hdrs.SET_COOKIE, _morsel(name, value, opts))


def _queue_issued(request: web.Request, issued: Issued) -> None:
    now = request.app["clock"]()
    queue_cookie(request, ACCESS_COOKIE, issued.access, **_cookie_opts(request, issued.access_expires - now))
    queue_cookie(request, REFRESH_COOKIE, issued.refresh, **_cookie_opts(request, issued.expires - now))
    queue_cookie(request, CSRF_COOKIE, issued.csrf, **_cookie_opts(request, issued.expires - now, httponly=False))


# -- resolving a request --------------------------------------------------------------------------
def user_from_row(row) -> User:
    return User(id=row["user_id"], name=row["user_name"], role=row["user_role"], kind=row["user_kind"],
                username=row["username"], ha_user_id=row["ha_user_id"])


def identity(request: web.Request) -> Identity:
    """Resolve (once per request) the user session and device credential the request carries.

    An expired access token with a valid refresh token is refreshed on the spot; the new cookies
    ride on the response. Never raises for a bad credential: it just is not part of the identity.
    """
    cached = request.get("identity")
    if cached is not None:
        return cached
    app = request.app
    hook = app.get("ingress_identity")       # HA App mode (ingress.py): Ingress requests resolve there
    if hook is not None:
        got = hook(request)
        if got is not None:
            request["identity"] = got
            return got
    mgr: SessionManager | None = app.get("sessions")
    door = door_of(request)
    if mgr is None:
        return Identity(None, None, door)
    now = app["clock"]()
    device = device_csrf = None
    devices = app.get("devices")
    if devices is not None:
        found = devices.authenticate(request, door, now)
        if found is not None:
            device, device_csrf = found
    row = mgr.from_access(request.cookies.get(ACCESS_COOKIE), now, door)
    if row is None and request.cookies.get(REFRESH_COOKIE):
        status, value = mgr.rotate(request.cookies.get(REFRESH_COOKIE), now, door)
        if status == "ok":
            issued, row = value
            _queue_issued(request, issued)
            request["refreshed"] = True
        elif status == "grace":
            row = value
            request["refreshed"] = True
        else:
            for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
                queue_cookie(request, name, None)
    if row is not None and row["method"] == APP_METHOD:
        # an app's credential is DPoP-bound (app_auth.py) and only good with its device key: never as a cookie
        log.warning("ignored an app credential presented as a cookie (from %s)", request.remote)
        row = None
    if row is not None and row["method"] == INGRESS_METHOD:
        # an Ingress session is only good through Ingress (ingress.py resolves those): a copied cookie
        # presented anywhere else is no one
        log.warning("ignored an Ingress session presented outside Ingress (from %s)", request.remote)
        row = None
    user = None
    if row is not None:
        user = user_from_row(row)
        mgr.touch(row, now, client_ip(request))
    ident = Identity(user=user, device=device, door=door,
                     fresh_factor_at=row["fresh_factor_at"] if row is not None else None,
                     fresh_factor=row["fresh_factor"] if row is not None else None,
                     session_id=row["id"] if row is not None else None,
                     csrf=row["csrf"] if row is not None else device_csrf)
    request["identity"] = ident
    return ident


def check_csrf(request: web.Request, ident: Identity) -> None:
    sent = request.headers.get(CSRF_HEADER, "")
    if not ident.csrf or not sent or not hmac.compare_digest(sent, ident.csrf):
        raise web.HTTPForbidden(text='{"error":"csrf"}', content_type="application/json")


def legacy_user(ident: Identity) -> dict:
    """The request["user"] dict Phase 0 handlers read (``/api/me``). `room`: the device's room as an area id (a Home
    Grid's ``tablet_room``), None without a device."""
    from .devices import room_id                 # devices.py imports this module
    room = room_id(ident.device.room) if ident.device else None
    if ident.user is not None:
        u = ident.user
        return {"ha_user_id": u.ha_user_id, "name": u.name, "role": u.role, "user_id": u.id,
                "device_id": ident.device.id if ident.device else None, "room": room}
    d = ident.device
    # a tablet that is its own HA user (HA App mode) reads as that HA user, as HK in HA saw it: HK finds
    # "which tablet am I" by its Tablet User's name (web/hk/modules/hk-settings.js tablet())
    return {"ha_user_id": d.ha_user_id, "name": d.ha_name or d.name, "role": d.role, "user_id": None,
            "device_id": d.id, "room": room}


def end_session(request: web.Request, resp: web.StreamResponse, reason: str = "logout") -> None:
    """Revoke the request's session family (found by access or refresh cookie) and clear its cookies."""
    mgr: SessionManager | None = request.app.get("sessions")
    if mgr is not None:
        now = request.app["clock"]()
        row = mgr.from_access(request.cookies.get(ACCESS_COOKIE), now)
        sid = row["id"] if row is not None else None
        if sid is None and request.cookies.get(REFRESH_COOKIE):
            rt = mgr.db.execute("SELECT session_id FROM refresh_tokens WHERE hash = ?",
                                (token_hash(request.cookies[REFRESH_COOKIE]),)).fetchone()
            sid = rt["session_id"] if rt else None
        if sid is None and request.get("identity") is not None:
            sid = request["identity"].session_id
        if sid is not None:
            mgr.revoke(sid, reason, now)
    clear_session_cookies(resp, request)


# -- REST -----------------------------------------------------------------------------------------
def error(status: int, code: str, **extra) -> web.Response:
    return web.json_response({"error": code, **extra}, status=status, headers={"Cache-Control": "no-store"})


def ok(data: dict | None = None, status: int = 200) -> web.Response:
    return web.json_response({"ok": True, **(data or {})}, status=status, headers={"Cache-Control": "no-store"})


def user_json(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"id": u.id, "username": u.username, "name": u.name, "role": u.role, "kind": u.kind,
            "ha_user_id": u.ha_user_id}


def device_json(d: Device | None) -> dict | None:
    if d is None:
        return None
    out = {"id": d.id, "name": d.name, "role": d.role, "room": d.room}
    if d.ha_user_id:
        out["ha_user_id"] = d.ha_user_id
    return out


@guard("signed_in")
async def get_session(request: web.Request) -> web.Response:
    ident = guarded(request)
    resp = ok({"user": user_json(ident.user), "device": device_json(ident.device), "door": ident.door,
               "fresh_factor_at": ident.fresh_factor_at, "csrf": ident.csrf, "session_id": ident.session_id})
    if ident.csrf:  # re-deliver the token to the page's readable cookie
        resp.set_cookie(CSRF_COOKIE, ident.csrf, **_cookie_opts(request, 400 * 86400, httponly=False))
    return resp


@guard("signed_in", no_audit="renews the caller's own session: a sign-in, not audited (audit.py)")
async def refresh(request: web.Request) -> web.Response:
    """Explicit refresh (the page can call it before the access token runs out)."""
    ident = guarded(request)
    if ident.user is None:
        return error(401, "no_session")
    if request.get("refreshed"):
        return ok({"session_id": ident.session_id})
    mgr: SessionManager = request.app["sessions"]
    stored = ident.door if ident.door in DOORS else "tunnel"     # an 'ha' (Ingress) session is stored as tunnel
    status, value = mgr.rotate(request.cookies.get(REFRESH_COOKIE), request.app["clock"](), stored)
    if status == "ok":
        resp = ok({"session_id": ident.session_id, "csrf": value[0].csrf})
        set_session_cookies(request, resp, value[0])
        return resp
    if status == "grace":
        return ok({"session_id": ident.session_id})
    resp = error(401, "refresh_" + status)
    if status == "reuse":
        clear_session_cookies(resp, request)
    return resp


@guard("signed_in", no_audit="ends the caller's own session (a sign-out), as sign-ins are not audited")
async def logout(request: web.Request) -> web.Response:
    resp = ok()
    end_session(request, resp)
    return resp


def _may_manage(actor: User, target_role: str) -> bool:
    """Owners manage everyone; Admins everyone but Owners (PLAN §5). P3.2 replaces this with grants."""
    return actor.role == "owner" or (actor.role == "admin" and target_role != "owner")


@guard("person", device_ok=True)
async def list_sessions(request: web.Request) -> web.Response:
    ident = guarded(request)
    target = request.query.get("user_id") or ident.user.id
    if target != ident.user.id:
        row = request.app["store"].db.execute("SELECT role FROM users WHERE id = ?", (target,)).fetchone()
        if row is None or not _may_manage(ident.user, row["role"]):
            return error(403, "forbidden")
    rows = request.app["sessions"].list(target, request.app["clock"]())
    for r in rows:
        r["current"] = r["id"] == ident.session_id
    # the Mantel apps and their web views are Me → Mantel App's (app_auth.py), one row per app, not here
    rows = [r for r in rows if r["current"] or (r["method"] != APP_METHOD and r["parent_id"] is None)]
    return ok({"sessions": [{k: v for k, v in r.items() if k != "parent_id"} for r in rows]})


@guard("person", device_ok=True, audit="session.revoke")
async def revoke_session(request: web.Request) -> web.Response:
    """Me → My Sessions (yours), or People → a person (an Owner's or Admin's): the audit row first."""
    from . import audit
    ident = guarded(request)
    mgr: SessionManager = request.app["sessions"]
    row = mgr.get(request.match_info["id"])
    if row is None:
        return error(404, "not_found")
    if row["user_id"] != ident.user.id and not _may_manage(ident.user, row["user_role"]):
        return error(403, "forbidden")
    audit.config(request, ident, "session.revoke", {"session": row["id"], "user": row["user_id"],
                                                    "own": row["user_id"] == ident.user.id})
    mgr.revoke(row["id"], "revoked_by_user")
    resp = ok()
    if row["id"] == ident.session_id:
        clear_session_cookies(resp, request)
    return resp


def register(app: web.Application, hub=None) -> None:
    cfg = app["cfg"]
    app["sessions"] = SessionManager(app["store"].db, lambda: app["clock"](),
                                     lan_ttl=cfg.lan_session_days * 86400, tunnel_ttl=cfg.session_hours * 3600,
                                     access_ttl=cfg.access_minutes * 60)
    app.setdefault("public_paths", set())
    app.on_response_prepare.append(_apply_cookie_queue)
    app.router.add_get("/api/session", get_session)
    app.router.add_post("/api/session/refresh", refresh)
    app.router.add_post("/api/session/logout", logout)
    app.router.add_get("/api/sessions", list_sessions)
    app.router.add_delete("/api/sessions/{id}", revoke_session)
