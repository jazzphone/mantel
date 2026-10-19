"""Device credentials: "Make this a wall tablet" (PLAN §5 subjects, §7 wall tablets).

A signed-in Owner or Admin (or a Wall Tablet account, for itself) turns the current browser into a
*device*: a record with its own role (``wall_tablet`` by default) and room, and a random secret in
the ``mantel_device`` cookie (``HttpOnly; SameSite=Strict``). The person's session on that browser
ends at the same moment, so the password is not kept on the tablet. From then on the browser's
requests carry ``user=None, device=<the device>``; a person can still sign in on top, and RBAC (P3.2)
uses the pair.

* Only the secret's SHA-256 is stored. It **rotates** every 24 hours: the server issues a new secret
  but keeps the old one valid until the new one comes back, so a lost response never strands a
  tablet. Once the new one is seen the old one is retired; if the retired secret is presented again
  (after a short grace for requests already in flight) somebody copied it, and the device is revoked.
* **Revocable** in one call (``DELETE /api/devices/{id}``); a revoked device is refused at once.
* **LAN only**: enrolment is refused on the tunnel door, and a device cookie presented on the tunnel
  door is ignored (logged), so a stolen tablet credential is useless off-site.
* A credential unused for 90 days stops working.
"""
from __future__ import annotations

import logging
import re
import secrets
import sqlite3

from aiohttp import web

from .accounts import read_json, require_manager, require_user
from .sessions import (CSRF_COOKIE, Device, client_ip, cookie_secure, device_json, end_session, error, identity, ok,
                       queue_cookie, token_hash)
from .store import ROLES

log = logging.getLogger("mantel.devices")

DEVICE_COOKIE = "mantel_device"
DEVICE_ROLES = tuple(r for r in ROLES if r not in ("owner", "admin"))
ROTATE_EVERY = 24 * 3600
REISSUE_AFTER = 60.0         # an issued-but-unseen secret is re-issued no sooner than this
RETIRED_GRACE = 60.0         # requests already in flight with the retired secret
IDLE_LIMIT = 90 * 86400
COOKIE_MAX_AGE = 400 * 86400  # browsers cap cookie lifetimes at 400 days
TOUCH_EVERY = 60.0


class DeviceManager:
    def __init__(self, conn: sqlite3.Connection, clock, rotate_every: float = ROTATE_EVERY) -> None:
        self.db = conn
        self.clock = clock
        self.rotate_every = rotate_every

    def enroll(self, name: str, role: str, room: str | None, enrolled_by: str | None,
               source_ip: str | None = None) -> tuple[str, str, str]:
        """Returns (device id, secret, csrf token)."""
        if role not in DEVICE_ROLES:
            raise ValueError(f"device roles are {', '.join(DEVICE_ROLES)}")
        now = self.clock()
        device_id, secret, csrf = secrets.token_hex(16), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.db:
            self.db.execute("INSERT INTO devices (id, name, role, room, enrolled_by, secret_hash, rotated_at, csrf, "
                            "created, last_seen, source_ip) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (device_id, name, role, room, enrolled_by, token_hash(secret), now, csrf, now, now, source_ip))
        log.info("enrolled device %s (%s, %s)", device_id, role, room or "no room")
        return device_id, secret, csrf

    def revoke(self, device_id: str, reason: str) -> bool:
        with self.db:
            return self.db.execute("UPDATE devices SET revoked = ?, revoked_reason = ? WHERE id = ? AND revoked IS NULL",
                                   (self.clock(), reason, device_id)).rowcount > 0

    def get(self, device_id: str):
        return self.db.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()

    def list(self) -> list[dict]:
        cols = "id, name, role, room, enrolled_by, created, last_seen, rotated_at, source_ip, revoked, revoked_reason"
        return [dict(r) for r in self.db.execute(f"SELECT {cols} FROM devices ORDER BY created")]

    def check(self, secret: str | None, door: str, now: float | None = None):
        """Validate a presented secret. Returns (row, new_secret_or_None) or None.

        new_secret is a freshly issued rotation the caller must hand to the browser.
        """
        if not secret:
            return None
        if door != "lan":
            log.warning("a device credential was presented on the %s door; refused", door)
            return None
        now = self.clock() if now is None else now
        h = token_hash(secret)
        row = self.db.execute("SELECT * FROM devices WHERE secret_hash = ? OR next_hash = ? OR retired_hash = ?",
                              (h, h, h)).fetchone()
        if row is None or row["revoked"] is not None:
            return None
        if row["last_seen"] is not None and now - row["last_seen"] > IDLE_LIMIT:
            self.revoke(row["id"], "idle")
            return None
        new_secret = None
        if h == row["retired_hash"] and h not in (row["secret_hash"], row["next_hash"]):
            if row["retired_at"] is None or now - row["retired_at"] > RETIRED_GRACE:
                self.revoke(row["id"], "credential_reuse")
                log.warning("device %s presented a retired secret: revoked (credential copied?)", row["id"])
                return None
        elif h == row["next_hash"]:
            with self.db:  # the browser has the new secret: promote it, retire the old one
                self.db.execute("UPDATE devices SET retired_hash = secret_hash, retired_at = ?, secret_hash = next_hash, "
                                "next_hash = NULL, next_issued = NULL, rotated_at = ? WHERE id = ? AND next_hash = ?",
                                (now, now, row["id"], h))
        elif now - row["rotated_at"] >= self.rotate_every and (
                row["next_hash"] is None or row["next_issued"] is None or now - row["next_issued"] > REISSUE_AFTER):
            new_secret = secrets.token_urlsafe(32)
            with self.db:
                self.db.execute("UPDATE devices SET next_hash = ?, next_issued = ? WHERE id = ?",
                                (token_hash(new_secret), now, row["id"]))
        if row["last_seen"] is None or now - row["last_seen"] >= TOUCH_EVERY:
            with self.db:
                self.db.execute("UPDATE devices SET last_seen = ? WHERE id = ?", (now, row["id"]))
        return self.get(row["id"]), new_secret

    def authenticate(self, request: web.Request, door: str, now: float):
        """For ``sessions.identity``: (Device, csrf) or None; queues a rotated cookie if one is due."""
        secret = request.cookies.get(DEVICE_COOKIE)
        found = self.check(secret, door, now)
        if found is None:
            if secret and door == "lan":
                queue_cookie(request, DEVICE_COOKIE, None)
            return None
        row, new_secret = found
        if new_secret:
            queue_cookie(request, DEVICE_COOKIE, new_secret, **device_cookie_opts(request))
        ip = client_ip(request)
        if ip and ip != row["source_ip"]:
            with self.db:
                self.db.execute("UPDATE devices SET source_ip = ? WHERE id = ?", (ip, row["id"]))
        return Device(id=row["id"], name=row["name"], role=row["role"], room=row["room"]), row["csrf"]


def device_cookie_opts(request: web.Request) -> dict:
    return dict(max_age=COOKIE_MAX_AGE, httponly=True, samesite="Strict", path="/", secure=cookie_secure(request))


# -- REST -----------------------------------------------------------------------------------------
def room_id(room: str | None) -> str | None:
    """A room as typed on the tablet ("Loft", "Master Bedroom") as the id HK's tablets and HA's areas use ("loft",
    "master_bedroom"): every comparison with a device's room (its HK tablet, its screen, linked mode's tablet, its
    RBAC area) is by id, so a typed name found none of them (the house, 2026-10-19)."""
    if room is None:
        return None
    rid = re.sub(r"[^a-z0-9]+", "_", room.strip().lower()).strip("_")
    return rid[:64] or None


async def enroll(request: web.Request) -> web.Response:
    ident = require_user(request)
    if ident.door != "lan":
        return error(403, "lan_only", message="Devices can only be enrolled on the LAN.")
    if ident.device is not None:
        return error(409, "already_a_device")
    body = await read_json(request)
    user = ident.user
    role = body.get("role", "wall_tablet")
    if user.role == "wall_tablet":
        role = "wall_tablet"  # a Wall Tablet account may only make its own tablet
    elif user.role not in ("owner", "admin"):
        return error(403, "forbidden")
    name = body.get("name") or user.name or "Wall tablet"
    room = body.get("room")
    if role not in DEVICE_ROLES or not isinstance(name, str) or not (room is None or isinstance(room, str)):
        return error(400, "invalid", roles=list(DEVICE_ROLES))
    mgr: DeviceManager = request.app["devices"]
    device_id, secret, csrf = mgr.enroll(name[:64], role, room_id(room), user.id, client_ip(request))
    row = mgr.get(device_id)
    resp = ok({"device": device_json(Device(row["id"], row["name"], row["role"], row["room"])), "csrf": csrf},
              status=201)
    end_session(request, resp, "became_device")  # swap the person's session for the device credential
    resp.set_cookie(DEVICE_COOKIE, secret, **device_cookie_opts(request))
    resp.set_cookie(CSRF_COOKIE, csrf, **{**device_cookie_opts(request), "httponly": False})
    return resp


async def list_devices(request: web.Request) -> web.Response:
    require_manager(request)
    return ok({"devices": request.app["devices"].list()})


async def revoke(request: web.Request) -> web.Response:
    ident = identity(request)
    mgr: DeviceManager = request.app["devices"]
    device_id = request.match_info["id"]
    is_self = ident.device is not None and ident.device.id == device_id
    if not is_self:
        require_manager(request)
    if not mgr.revoke(device_id, "revoked_by_self" if is_self else "revoked"):
        return error(404, "not_found")
    resp = ok()
    if is_self:
        resp.del_cookie(DEVICE_COOKIE, path="/")
    return resp


def register(app: web.Application, hub=None) -> None:
    cfg = app["cfg"]
    app["devices"] = DeviceManager(app["store"].db, lambda: app["clock"](),
                                   rotate_every=getattr(cfg, "device_rotate_hours", 24) * 3600)
    app.router.add_post("/api/devices/enroll", enroll)
    app.router.add_get("/api/devices", list_devices)
    app.router.add_delete("/api/devices/{id}", revoke)
