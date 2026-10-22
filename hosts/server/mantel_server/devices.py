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
* **Revocable** in one call (``DELETE /api/devices/{id}``); a revoked device is refused at once. It stays listed
  (Revoked) for 30 days, or until an Owner or Admin clears the list (``DELETE /api/devices/revoked``); its audit
  rows stay for the log's own retention.
* **Audited**: enrolling (``device.enroll``) and revoking (``device.revoke``, by a manager or by the tablet itself)
  each write their ``config`` row before the change (``accounts.audit_change``), as moving one does
  (``device.room``). A revocation the server makes itself (idle, a copied credential) is in its log.
* **Its room is one of the house's**: HK's wall tablets (``tablet`` names one, and the device takes its room) or
  HA's areas, never a room typed by hand. ``features.may_speak_for`` lets a wall tablet device report a touch or
  its black screen only for the HK tablet in its own room, so a room that matches none (three tablets enrolled as
  "Livingroom", "Masterbathroom", "Masterbedroom": the house, 2026-10-19) silently cut them off. An Owner or Admin
  moves a device to another room or tablet in place (``PATCH /api/devices/{id}``, audited), keeping its cookie.
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

from . import default_screens
from .accounts import audit_change, read_json, require_manager, require_user
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
FORGET_REVOKED_AFTER = 30 * 86400   # a revoked device leaves the list after this; its audit rows stay


class DeviceManager:
    def __init__(self, conn: sqlite3.Connection, clock, rotate_every: float = ROTATE_EVERY) -> None:
        self.db = conn
        self.clock = clock
        self.rotate_every = rotate_every

    def enroll(self, name: str, role: str, room: str | None, enrolled_by: str | None,
               source_ip: str | None = None, device_id: str | None = None) -> tuple[str, str, str]:
        """Returns (device id, secret, csrf token). ``device_id`` when the caller chose it first (its audit row)."""
        if role not in DEVICE_ROLES:
            raise ValueError(f"device roles are {', '.join(DEVICE_ROLES)}")
        now = self.clock()
        device_id = device_id or secrets.token_hex(16)
        secret, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
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

    def forget_revoked(self, older_than: float | None = None) -> list[dict]:
        """Remove revoked devices (all of them, or those revoked ``older_than`` seconds ago or more), with what
        was theirs alone (a Default Screen, saved data, rooms); their audit rows stay. Returns the ones removed."""
        cut = self.clock() - older_than if older_than is not None else None
        rows = [dict(r) for r in self.db.execute(
            "SELECT id, name, room, revoked FROM devices WHERE revoked IS NOT NULL" + (" AND revoked <= ?" if cut is not None else ""),
            (cut,) if cut is not None else ())]
        with self.db:
            for r in rows:
                self.db.execute("DELETE FROM default_screens WHERE subject = ?", (f"d:{r['id']}",))
                self.db.execute("DELETE FROM user_data WHERE subject = ?", (f"d:{r['id']}",))
                self.db.execute("DELETE FROM rbac_scopes WHERE subject_kind = 'device' AND subject_id = ?", (r["id"],))
                self.db.execute("DELETE FROM devices WHERE id = ?", (r["id"],))
        if rows:
            log.info("forgot %d revoked device(s)", len(rows))
        return rows

    def set_room(self, device_id: str, room: str | None) -> bool:
        with self.db:
            return self.db.execute("UPDATE devices SET room = ? WHERE id = ? AND revoked IS NULL",
                                   (room, device_id)).rowcount > 0

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


def hk_tablets(app: web.Application) -> dict[str, dict]:
    """HK's wall tablets as Mantel's settings have them (features.FeatureHost.tablets, the ones ``may_speak_for``
    compares a device's room with): {tid: {name, room, screen}}."""
    host = app.get("features")
    tablets = getattr(host, "tablets", None) or {}
    return {tid: {"name": t.get("name") or tid, "room": t.get("room") or None, "screen": t.get("screen") or None}
            for tid, t in tablets.items() if isinstance(t, dict)}


def ha_areas(app: web.Application) -> dict[str, str]:
    hub = app.get("hub")
    reg = getattr(hub, "registry", None)
    return dict(getattr(reg, "areas", None) or {})


class RoomError(ValueError):
    pass


def chosen_room(app: web.Application, body: dict, *, strict: bool) -> str | None:
    """The room a request asks for: ``tablet`` (an HK tablet's id: its room) or ``room`` (an HK tablet's room or an
    HA area, by id; a name is taken as its id). Anything else is a RoomError. With nothing known yet (no HK
    settings, HA not read), ``strict=False`` takes the room as given (enrolment on a first run)."""
    tablets = hk_tablets(app)
    if body.get("tablet") is not None:
        t = tablets.get(body["tablet"]) if isinstance(body["tablet"], str) else None
        if t is None or not t["room"]:
            raise RoomError("unknown_tablet")
        return t["room"]
    room = body.get("room")
    if room is None:
        return None
    if not isinstance(room, str):
        raise RoomError("invalid")
    rid = room_id(room)
    known = {t["room"] for t in tablets.values() if t["room"]} | set(ha_areas(app))
    if rid is None or (rid not in known and (strict or known)):
        raise RoomError("unknown_room")
    return rid


def tablets_in(app: web.Application, room: str | None) -> list[str]:
    """The HK tablets a device in ``room`` speaks for (``features.may_speak_for``'s room rule)."""
    return sorted(tid for tid, t in hk_tablets(app).items() if room and t["room"] == room)


ROOM_MESSAGES = {"unknown_tablet": "That isn’t one of HK’s wall tablets.",
                 "unknown_room": "That isn’t a room in this house: pick one of HK’s wall tablets or a Home Assistant area."}


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
    if role not in DEVICE_ROLES or not isinstance(name, str):
        return error(400, "invalid", roles=list(DEVICE_ROLES))
    try:
        room = chosen_room(request.app, body, strict=False)
    except RoomError as exc:
        return error(400, str(exc), message=ROOM_MESSAGES.get(str(exc)))
    # ONE STEP FOR A NEW TABLET: an Owner or Admin enrolling into a room no HK tablet has may ask for that HK tablet
    # to be made too (``new_tablet``), so its touches, idle return and black screen reach it without a visit to
    # All Screens first. Only for a Home Assistant area; a room an HK tablet already has keeps that tablet.
    service = request.app.get("settings")
    make_tablet = (bool(body.get("new_tablet")) and body.get("tablet") is None and room is not None
                   and user.role in ("owner", "admin") and service is not None
                   and room in ha_areas(request.app) and not tablets_in(request.app, room))
    mgr: DeviceManager = request.app["devices"]
    device_id = secrets.token_hex(16)
    refused = audit_change(request, ident, "device.enroll", {"device": device_id, "name": name[:64], "role": role,
                                                             "room": room, "tablet": body.get("tablet"),
                                                             **({"new_tablet": True} if make_tablet else {})})
    if refused:
        return refused
    if make_tablet:
        from .settings_store import SettingsError, actor_of
        try:
            service.add_tablet({"name": name[:40], "room": room}, actor_of(ident), "device.enroll")
        except SettingsError as exc:
            return error(400, "tablet_not_made", message=f"The HK tablet could not be made ({exc.code}).")
    device_id, secret, csrf = mgr.enroll(name[:64], role, room, user.id, client_ip(request), device_id=device_id)
    if user.role == "wall_tablet":
        # "A Wall Tablet account can only make its own tablet" (Wall-Tablets.md): one at a time. Enrolling again
        # (a tablet reset, its cookie gone) replaces the account's earlier one rather than adding another.
        for old in request.app["store"].db.execute(
                "SELECT id, name, room FROM devices WHERE enrolled_by = ? AND revoked IS NULL AND id != ?",
                (user.id, device_id)).fetchall():
            if audit_change(request, ident, "device.revoke", {"device": old["id"], "name": old["name"],
                                                             "room": old["room"], "replaced_by": device_id}) is None:
                mgr.revoke(old["id"], "replaced")          # (no audit row, no revocation)
    row = mgr.get(device_id)
    resp = ok({"device": device_json(Device(row["id"], row["name"], row["role"], row["room"])), "csrf": csrf},
              status=201)
    end_session(request, resp, "became_device")  # swap the person's session for the device credential
    resp.set_cookie(DEVICE_COOKIE, secret, **device_cookie_opts(request))
    resp.set_cookie(CSRF_COOKIE, csrf, **{**device_cookie_opts(request), "httponly": False})
    return resp


async def list_devices(request: web.Request) -> web.Response:
    require_manager(request)
    app = request.app
    app["devices"].forget_revoked(FORGET_REVOKED_AFTER)
    devices = [{**d, "hk_tablets": tablets_in(app, d["room"])} for d in app["devices"].list()]
    return ok({"devices": devices, "tablets": hk_tablets(app)})


async def rooms(request: web.Request) -> web.Response:
    """``GET /api/devices/rooms``: what "Make This Browser a Wall Tablet" offers, for whoever may enrol (an Owner, an
    Admin, a Wall Tablet account): HK's wall tablets (Mantel's copy of the settings the feed's ``tablet_items`` come
    from; a Wall Tablet account's settings page has no house connection to read the feed) with the active devices
    already in each one's room, and HA's areas for a device that is none of them."""
    ident = require_user(request)
    if ident.user.role not in ("owner", "admin", "wall_tablet"):
        return error(403, "forbidden")
    app = request.app
    titles = {x["path"]: x["title"] for x in default_screens.screens(app)}
    live = [d for d in app["devices"].list() if d["revoked"] is None]
    tablets = {tid: {**t, "screen_title": titles.get(t["screen"]),
                     "served_by": [{"id": d["id"], "name": d["name"]} for d in live if t["room"] and d["room"] == t["room"]]}
               for tid, t in hk_tablets(app).items()}
    areas = [{"id": a, "name": n} for a, n in sorted(ha_areas(app).items(), key=lambda kv: kv[1].lower())]
    return ok({"tablets": tablets, "areas": areas})


async def update(request: web.Request) -> web.Response:
    """``PATCH /api/devices/{id}`` ``{tablet}`` or ``{room}`` (Owner/Admin): the device's room, in place. Its
    credential is untouched; its open screens take the new room at the next policy tick (a minute at most)."""
    ident = require_manager(request)
    app = request.app
    mgr: DeviceManager = app["devices"]
    row = mgr.get(request.match_info["id"])
    if row is None or row["revoked"] is not None:
        return error(404, "not_found")
    body = await read_json(request)
    if not isinstance(body, dict) or not ({"tablet", "room"} & set(body)):
        return error(400, "invalid")
    try:
        room = chosen_room(app, body, strict=True)
    except RoomError as exc:
        return error(400, str(exc), message=ROOM_MESSAGES.get(str(exc)))
    audit = app.get("audit")
    if audit is not None:                   # the audit row first, as every config change
        audit.config_event({"timestamp": app["clock"](), "actor": ident.user.id, "role": ident.user.role,
                            "action": "device.room", "detail": {"device": row["id"], "name": row["name"],
                                                                "from": row["room"], "to": room,
                                                                "tablet": body.get("tablet")}})
    if not mgr.set_room(row["id"], room):
        return error(404, "not_found")
    log.info("device %s moved from %s to %s by %s", row["id"], row["room"] or "no room", room or "no room",
             ident.user.id)
    out = mgr.get(row["id"])
    return ok({"device": {**device_json(Device(out["id"], out["name"], out["role"], out["room"])),
                          "hk_tablets": tablets_in(app, out["room"])}})


async def revoke(request: web.Request) -> web.Response:
    ident = identity(request)
    mgr: DeviceManager = request.app["devices"]
    device_id = request.match_info["id"]
    is_self = ident.device is not None and ident.device.id == device_id
    if not is_self:
        require_manager(request)
    row = mgr.get(device_id)
    if row is None or row["revoked"] is not None:
        return error(404, "not_found")
    # the audit row first: by a manager (who), or by the tablet itself (the row's device, no person)
    refused = audit_change(request, ident, "device.revoke", {"device": row["id"], "name": row["name"],
                                                             "role": row["role"], "room": row["room"],
                                                             "by_self": is_self})
    if refused:
        return refused
    if not mgr.revoke(device_id, "revoked_by_self" if is_self else "revoked"):
        return error(404, "not_found")
    resp = ok()
    if is_self:
        resp.del_cookie(DEVICE_COOKIE, path="/")
    return resp


async def forget_revoked(request: web.Request) -> web.Response:
    """``DELETE /api/devices/revoked`` (Owner/Admin): Clear Revoked. The list only: each device's audit rows stay."""
    ident = require_manager(request)
    mgr: DeviceManager = request.app["devices"]
    gone = [r["id"] for r in mgr.db.execute("SELECT id FROM devices WHERE revoked IS NOT NULL")]
    if not gone:
        return ok({"removed": 0})
    refused = audit_change(request, ident, "device.forget_revoked", {"devices": gone})
    if refused:
        return refused
    return ok({"removed": len(mgr.forget_revoked())})


def register(app: web.Application, hub=None) -> None:
    cfg = app["cfg"]
    app["devices"] = DeviceManager(app["store"].db, lambda: app["clock"](),
                                   rotate_every=getattr(cfg, "device_rotate_hours", 24) * 3600)
    app.router.add_post("/api/devices/enroll", enroll)
    app.router.add_get("/api/devices", list_devices)
    app.router.add_get("/api/devices/rooms", rooms)
    app.router.add_delete("/api/devices/revoked", forget_revoked)     # before /{id}
    app.router.add_patch("/api/devices/{id}", update)
    app.router.add_delete("/api/devices/{id}", revoke)
