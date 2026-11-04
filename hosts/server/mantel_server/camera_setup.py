"""RTSP CAMERAS: ADD, TEST, CHANGE AND REMOVE (docs/phase13/CAMERAS-DIRECT.md "RTSP cameras", phase 6).

Mantel Settings -> Cameras -> Add Camera. Where Mantel runs its own go2rtc (Docker, the Proxmox LXC), a camera that
speaks RTSP -- most IP cameras, a Frigate restream -- can be added without Home Assistant in the middle. This module
is that page's server side: it checks what the person typed, tries the stream, and hands the result to
``cameras_direct`` (phase 3: ``app["cameras_direct"].put`` / ``.remove``), which keeps the camera, seals its URLs,
makes it an entity (``camera.mantel_<slug>``) and plays it. Under the Home Assistant App there is no go2rtc, so there
is no Add Camera: the page says cameras come from Home Assistant (its Generic Camera integration, with a link) and the
routes below answer ``provided_by_app``.

Routes (``API`` = /api/cameras/rtsp). Every one is an Owner's or an Admin's; a wall tablet is refused (the guard).
The ones that change anything, or try an address from this server, also ask connections.edit_rule's question with
Admins let in: from the home network (or Home Assistant's trusted sidebar) nothing more; from anywhere else a fresh
sign-in within the step-up window (the guard's ``fresh="away"``), exactly what a change to a connection asks.

* ``GET    API``                the page: mode, who may change, Home Assistant's state, the areas, the direct cameras
* ``GET    API/sensors``        the sensors a camera can be linked to, and the suggestions for ``?name=``
* ``POST   API/test``           the stream tried (below), nothing kept; ``{slug}`` fills what is left blank from a saved camera
* ``POST   API``                a camera added
* ``PUT    API/{slug}``         a camera changed
* ``DELETE API/{slug}``         a camera removed

**What is typed.** ``{name, area_id, address, low_address, snapshot_address, username, password, clear_login,
sensors}``:

* ``address`` is ``rtsp://`` or ``rtsps://``, host[:port]/path, and NO user info: a user name and password typed into
  the address are refused (``login_in_address``) so the page's two fields are the only way they get in. ``low_address``
  is an optional sub-stream, the stills' (cameras_direct draws them from ``low`` when it has one); it takes the same
  login. The login goes into the URL only here, as the camera is handed to ``put``, and from there only inside the
  sealed file phase 3 keeps. Percent-encoded, so a password with ``@`` or ``/`` in it still works.
* WHICH STREAM WHERE (2026-11-02, the owner): ``address`` is the camera's high-quality stream, which pop-ups and full
  screen play; ``low_address`` its low-quality sub-stream, which tiles, the mosaic and the Cameras page play (without
  one they play the main stream). ``snapshot_address`` is the camera's own snapshot URL (``http(s)://``, a JPEG; the
  same login, sent as HTTP Basic): the stills come from it, else from a frame of the sub-stream, else of the main
  stream. Blank keeps the saved one; ``""`` sent on purpose clears it.
* ``username`` / ``password`` are SECRET. An answer, a log line, an audit row and an exception never hold them or
  the address's path (the path can carry a token on some cameras): a camera is shown by ``scheme://host[:port]`` and
  whether it has a login. On a change a blank user name or password KEEPS the saved one, and a blank address keeps the
  saved address; ``clear_login`` drops the login.
* ``sensors`` is ``{motion, person, doorbell}``: each a binary sensor or an event entity of Home Assistant's, or none
  (null clears it; a role left out keeps the saved one, as does leaving ``sensors`` out altogether).

**The id.** ``camera.mantel_<slug>``, the slug made from the name (``slug_of``), made unique among Mantel's own
cameras with a number. An id Home Assistant already has is NOT made unique: ``put`` refuses it and names HA's entity
(``CameraConflict``), and the answer says so plainly (``ha_has_that_id``, 409).

**Test** (``try_stream``), before a camera is saved: a temporary go2rtc stream is registered, go2rtc is asked to
open it (``Go2rtc.probe``), a picture is fetched (``frame.jpeg``, ~10 s in all) and the stream is removed again.
What go2rtc 1.9.9 does, from a real one in front of a test RTSP server (2026-11-02): ``frame.jpeg`` answers 200 with
NOTHING in it whatever went wrong and keeps the reason in its own log, so the reason is read from the PROBE, which
answers 500 with the reason as plain text ("streams: wrong user/pass", "dial tcp ...: connection refused"). ``classify``
turns that into one of four plain answers -- ``unreachable`` (cannot reach the address), ``auth`` (user name or
password refused), ``codec`` (the camera sends video a browser cannot play: not H.264), ``other`` -- and never repeats
go2rtc's own words, which can hold the address with its login. The picture comes back as a small JPEG data URL for
the page to show. The probe's JSON holds the producer's URL with its login: only the list of media is read.

**Linked sensors.** Stored on the source (``cameras_direct.DirectSource.sensors``; its ``detections`` mirrors the
roles: motion, person, ring). Each must be a sensor the person asking may see (``Authz.may_see``): one they may not is
refused in the same words as one that does not exist, so the answer is no oracle. A sensor is linked to one camera
only. They reach the notification rules through the House port, not a second mapping: ``MantelHouse.camera_links``
answers ``DirectCameras.sensor_links()``, and hk_core/notifications/accessories.py reads it where it would read the
camera on a sensor's Home Assistant device (``camera_for``, ``trigger_for``, ``kind``). The suggestions
(``accessories.suggest_links``) are the sensors whose name begins with the camera's. Without Home Assistant there is
no sensor to link, and the page says so.

2026-11-02: phase 6 built.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
import secrets
import time
from typing import Any, Mapping
from urllib.parse import quote, unquote, urlsplit

import aiohttp
from aiohttp import web

from hk_core.notifications import accessories as NA
from . import audit
from . import cameras_direct as D
from .accounts import read_json
from .connections import edit_rule, live_ha
from .guards import guard
from .guards import ident as guarded
from .house import MantelHouse
from .live_tv import Go2rtcError
from .sessions import error, ok

log = logging.getLogger("mantel.camera_setup")

API = "/api/cameras/rtsp"
HA_CAMERA_DOCS = "https://www.home-assistant.io/integrations/generic/"       # HA's Generic Camera
TEST_BUDGET_S = 10.0                    # a stream that has not shown a picture by then is not going to
STILL_WIDTH = "640"                     # the Test's picture is drawn small: it is for the person to look at
STILL_MAX = 400_000                     # ...and never more than this, as a data URL
SCHEMES = ("rtsp", "rtsps")
_CODEC = re.compile(r"^[A-Za-z0-9._-]{1,16}$")
ROLE_LABEL = {"motion": "Motion", "person": "Person", "doorbell": "Doorbell"}
ROLE_DETECTION = {"motion": "motion", "person": "person", "doorbell": "ring"}


class SetupError(ValueError):
    """What was typed was refused: ``field`` names the box, ``code`` is what the page keys on. The message is plain
    words and never holds the address, the user name or the password."""

    def __init__(self, field: str, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.field, self.code, self.status = field, code, status


# ------------------------------------------------------------------------------------- the address and its login
def check_address(text: Any, field: str = "address") -> str:
    """An RTSP address as typed, fit to keep: ``rtsp://`` or ``rtsps://``, a host, an optional port, a path and query,
    and NO user info. The login has its own boxes; one typed into the address is refused, not moved, so a password
    is never in a place the page might show it again."""
    if not isinstance(text, str) or not text.strip():
        raise SetupError(field, "address_required", "Type the camera’s RTSP address, such as rtsp://192.0.2.50:554/stream1.")
    url = text.strip()
    if len(url) > D.MAX_URL or any(ord(c) < 33 or ord(c) == 127 for c in url) or "#" in url:
        raise SetupError(field, "address_invalid", "That is not an RTSP address. It looks like rtsp://192.0.2.50:554/stream1.")
    parts = urlsplit(url)
    if parts.scheme.lower() not in SCHEMES:
        raise SetupError(field, "address_invalid", "The address starts with rtsp:// or rtsps://.")
    if "@" in parts.netloc:
        raise SetupError(field, "login_in_address", "Leave the user name and password out of the address: type them in their own boxes.")
    try:
        port = parts.port
    except ValueError:
        port = -1
    if not parts.hostname or port == -1:
        raise SetupError(field, "address_invalid", "That is not an RTSP address. It looks like rtsp://192.0.2.50:554/stream1.")
    return parts.scheme.lower() + url[len(parts.scheme):]


def check_snapshot(text: Any) -> str:
    """A snapshot URL as typed: ``http://`` or ``https://``, a host, a path, and NO user info (the login is the camera's)."""
    url = text.strip() if isinstance(text, str) else ""
    bad = "That is not a snapshot address. It looks like http://192.0.2.50/snapshot.jpg."
    if not url or len(url) > D.MAX_URL or any(ord(c) < 33 or ord(c) == 127 for c in url) or "#" in url:
        raise SetupError("snapshot_address", "snapshot_invalid", bad)
    parts = urlsplit(url)
    if parts.scheme.lower() not in ("http", "https"):
        raise SetupError("snapshot_address", "snapshot_invalid", "The snapshot address starts with http:// or https://.")
    if "@" in parts.netloc:
        raise SetupError("snapshot_address", "login_in_address", "Leave the user name and password out of the address: type them in their own boxes.")
    try:
        port = parts.port
    except ValueError:
        port = -1
    if not parts.hostname or port == -1:
        raise SetupError("snapshot_address", "snapshot_invalid", bad)
    return parts.scheme.lower() + url[len(parts.scheme):]


async def try_snapshot(app: web.Application, url: str) -> dict[str, Any]:
    """Fetch the snapshot URL once: {"ok": True, "still"} or {"ok": False, "code", "message"}. Never the URL in either."""
    http = app.get("http")
    own = http is None
    if own:
        http = aiohttp.ClientSession()
    try:
        async with http.get(url, timeout=aiohttp.ClientTimeout(total=TEST_BUDGET_S), allow_redirects=False) as r:
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if r.status in (401, 403):
                return {"ok": False, "code": "auth", "message": "The snapshot address refused the user name or password "
                        "(Mantel sends them as HTTP Basic; a camera that only takes Digest can't be used here)."}
            body = await r.content.read(4 * 1024 * 1024 + 1)
            if r.status != 200 or not ctype.startswith("image/") or not body or len(body) > 4 * 1024 * 1024:
                return {"ok": False, "code": "other", "message": "The snapshot address didn't answer with a picture."}
            return {"ok": True, "still": f"data:{ctype};base64,{base64.b64encode(body).decode()}"}
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
        return {"ok": False, "code": "unreachable", "message": "Mantel can't reach the snapshot address."}
    finally:
        if own:
            await http.close()


def with_login(url: str, username: str, password: str) -> str:
    """The address with the login in it, for the sealed file and nothing else. Percent-encoded."""
    if not username and not password:
        return url
    scheme, rest = url.split("://", 1)
    login = quote(username, safe="") + (":" + quote(password, safe="") if password else "")
    return f"{scheme}://{login}@{rest}"


def split_login(url: str) -> tuple[str, str, str]:
    """(the address without its login, the user name, the password) of a sealed URL."""
    scheme, rest = url.split("://", 1)
    netloc, sep, tail = rest.partition("/")
    userinfo, at, host = netloc.rpartition("@")
    if not at:
        return url, "", ""
    user, _, pw = userinfo.partition(":")
    return f"{scheme}://{host}{sep}{tail}", unquote(user), unquote(pw)


def address_of(url: str) -> str:
    """`scheme://host[:port]` of a sealed URL: what a camera is shown by. Never the login or the path (a path can
    carry a token on some cameras)."""
    bare = split_login(url)[0]
    parts = urlsplit(bare)
    return f"{parts.scheme}://{parts.netloc}"


def slug_of(name: str, taken: set[str]) -> str:
    """The slug for a camera's name (``[a-z0-9_]``, 40 at most), made unique among `taken` with a number."""
    base = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:36].strip("_") or "camera"
    slug, n = base, 1
    while slug in taken:
        n += 1
        slug = f"{base}_{n}"
    return slug


# ------------------------------------------------------------------------------------- the Test
def classify(detail: str) -> str:
    """go2rtc's reason (checked against 1.9.9, 2026-11-02) as one of our four words. Order matters: a refused login
    is auth even when the text also says "dial"."""
    t = (detail or "").lower()
    if any(w in t for w in ("user/pass", "unauthorized", "authenticat", "forbidden", "wrong password")):
        return "auth"
    if any(w in t for w in ("codecs not matched", "no supported", "unknown codec", "codec")):
        return "codec"
    if any(w in t for w in ("refused", "timeout", "timed out", "deadline", "no such host", "no route", "unreachable",
                            "lookup", "reset by peer", "eof", "host is down", "dial tcp", "read tcp", "network")):
        return "unreachable"
    # a bare status code last: a port or an address in the text can hold 401 (":401: connection refused" is above)
    if re.search(r"(?<![\d.:])40[13](?![\d.])", t):
        return "auth"
    return "other"


WORDS = {
    "unreachable": "Mantel could not reach the camera at that address. Check the address and port, and that the camera is "
                   "on and on a network Mantel can reach.",
    "auth": "The camera refused the user name or password. Check them. Some cameras have a separate RTSP login, set in "
            "the camera’s own settings.",
    "other": "Mantel reached something at that address but could not get a picture from it.",
}
PATH_WORDS = ("The camera answered, but has no stream at that address. Check the end of the address (the path), "
              "which the camera’s manual gives.")


def codec_words(codecs: list[str]) -> str:
    what = ", ".join(codecs) if codecs else "something else"
    return (f"The camera’s video is {what}, which a browser cannot play. Set the camera’s video to H.264 in its own "
            "settings (some also offer a second stream in H.264).")


def video_codecs(medias: list[str]) -> list[str]:
    """The video codecs a probe's media lines carry ("video, recvonly, H264" -> "H264"), safe words only."""
    out = []
    for m in medias:
        bits = [b.strip() for b in m.split(",")]
        if len(bits) >= 2 and bits[0].lower() == "video" and _CODEC.match(bits[-1]):
            out.append(bits[-1])
    return out


def audio_codecs(medias: list[str]) -> list[str]:
    out = []
    for m in medias:
        bits = [b.strip() for b in m.split(",")]
        if len(bits) >= 2 and bits[0].lower() == "audio" and _CODEC.match(bits[-1]):
            out.append(bits[-1])
    return out


async def try_stream(cams: D.DirectCameras, url: str, *, budget: float | None = None, picture: bool = True) -> dict[str, Any]:
    """Try one sealed-shape URL in Mantel's go2rtc: {"ok": True, "video", "audio", "still"?} or {"ok": False, "code",
    "message"}. The stream is temporary (``cams.testing`` keeps the tick from reaping it) and removed in the end.
    Nothing in the answer, and nothing logged, holds `url` or go2rtc's own words."""
    budget = TEST_BUDGET_S if budget is None else budget
    name = f"{D.STREAM_PREFIX}test_{secrets.token_hex(4)}"
    started = time.monotonic()
    cams.testing.add(name)
    g = cams.go2rtc
    try:
        try:
            await g.put_stream(name, url)
            medias = await g.probe(name, timeout=budget)
        except Go2rtcError as exc:
            if exc.status is not None and exc.status >= 500 and exc.detail:
                code = classify(exc.detail)
                log.info("cameras: a test stream failed (%s)", code)
                if code == "other" and "describe" in exc.detail.lower():
                    return {"ok": False, "code": "other", "message": PATH_WORDS}
                return {"ok": False, "code": code, "message": WORDS[code]}
            log.info("cameras: go2rtc refused a test stream (%s)", exc.status)
            return {"ok": False, "code": "other", "message": "Mantel’s video relay (go2rtc) would not take the stream."}
        except (aiohttp.ClientConnectorError, aiohttp.ServerDisconnectedError):
            return {"ok": False, "code": "other", "message": "Mantel could not reach its video relay (go2rtc), so it cannot "
                    "try the camera."}
        except (asyncio.TimeoutError, aiohttp.ClientError):
            # go2rtc itself answered nothing within the budget: it was waiting for the camera
            return {"ok": False, "code": "unreachable", "message": WORDS["unreachable"]}
        video, audio = video_codecs(medias), audio_codecs(medias)
        if not any(c.upper() == "H264" for c in video):
            return {"ok": False, "code": "codec", "message": codec_words(video)}
        out: dict[str, Any] = {"ok": True, "video": "H264", "audio": audio[0] if audio else None}
        if not picture:
            return out
        left = max(2.0, budget - (time.monotonic() - started))
        try:
            body, ctype = await g.frame(name, {"width": STILL_WIDTH}, timeout=left)
        except (Go2rtcError, asyncio.TimeoutError, aiohttp.ClientError):
            return {"ok": False, "code": "other", "message": "The camera connected, but no picture came from it in time."}
        if not body or len(body) > STILL_MAX:
            return {"ok": False, "code": "other", "message": "The camera connected, but no picture came from it in time."}
        out["still"] = f"data:{ctype};base64,{base64.b64encode(body).decode()}"
        return out
    finally:
        cams.testing.discard(name)
        try:
            await g.drop_stream(name)
        except Exception:  # noqa: BLE001 -- the tick reaps any left
            pass


# ------------------------------------------------------------------------------------- what the page is told
def mode_of(app: web.Application) -> str:
    """`direct` where Mantel has go2rtc (cameras can be added), `ha_app` under the Home Assistant App (cameras come
    from Home Assistant), `no_go2rtc` on Docker or the LXC started without --go2rtc-url."""
    if app.get("cameras_direct") is not None:
        return "direct"
    conns = app.get("connections")
    return "ha_app" if conns is not None and conns.app_mode else "no_go2rtc"


def ha_state(app: web.Application) -> dict[str, Any]:
    """Whether Home Assistant is there to be a motion source: set up, and connected."""
    conns = app.get("connections")
    set_up = bool(conns is not None and conns.current("ha") is not None)
    return {"set_up": set_up, "connected": bool(set_up and live_ha(app)["connected"])}


def _house(app: web.Application) -> MantelHouse:
    hub = app["hub"]
    feats = app.get("features")
    if feats is not None:
        return feats.house
    return MantelHouse(hub.store, hub.registry, links=lambda: app["cameras_direct"].sensor_links())


def _may_see(request: web.Request, entity_id: str) -> bool:
    authz = request.app.get("authz")
    return authz is not None and authz.may_see(authz.principal(request), entity_id) is True


def _sensor_name(app: web.Application, entity_id: str) -> str:
    st = app["hub"].store.states.get(entity_id)
    return str(((st or {}).get("a") or {}).get("friendly_name") or entity_id.split(".", 1)[1].replace("_", " ").title())


def camera_json(request: web.Request, cams: D.DirectCameras, s: Mapping[str, Any]) -> dict[str, Any]:
    """One direct camera as the page is told: its status (no URL), what it can be changed with, and its address by
    host only."""
    app = request.app
    src = next((x for x in cams.sources() if x.slug == s["slug"]), None)
    out = {k: s[k] for k in ("slug", "entity_id", "name", "source", "area_id", "state", "conflict", "sessions", "low")}
    area = app["hub"].registry.areas.get(s["area_id"]) if s["area_id"] else None
    out.update({"area_name": area, "editable": s["source"] == "rtsp", "address": None, "low_address": None,
                "snapshot_address": None,
                "has_login": False, "sensors": {}})
    if s["source"] == "rtsp":
        sec = cams.secret(s["slug"])
        if sec is not None:
            out["address"] = address_of(sec.high)
            out["low_address"] = address_of(sec.low) if sec.low else None
            out["snapshot_address"] = address_of(sec.still) if sec.still else None
            out["has_login"] = bool(split_login(sec.high)[1] or split_login(sec.high)[2])
    for role, eid in (src.sensors if src is not None else ()):
        seen = _may_see(request, eid)
        out["sensors"][role] = {"entity_id": eid if seen else None, "name": _sensor_name(app, eid) if seen else "A sensor you cannot see",
                                "missing": eid not in app["hub"].store.states and eid not in app["hub"].registry.entries}
    return out


def page_state(request: web.Request, ident: Any) -> dict[str, Any]:
    app = request.app
    rule = edit_rule(request, ident, admins=True)
    mode = mode_of(app)
    out: dict[str, Any] = {"mode": mode, "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh", "door": ident.door,
                           "ha": ha_state(app), "ha_docs": HA_CAMERA_DOCS, "cameras": [], "areas": []}
    cams = app.get("cameras_direct")
    if cams is None:
        return out
    out["areas"] = sorted(({"id": i, "name": n} for i, n in app["hub"].registry.areas.items()), key=lambda a: a["name"].lower())
    out["cameras"] = [camera_json(request, cams, s) for s in cams.status()["cameras"]]
    out["error"] = cams.error
    return out


def _cams(request: web.Request) -> D.DirectCameras:
    """The direct cameras, or the answer that there are none here (Home Assistant's App, or no go2rtc)."""
    cams = request.app.get("cameras_direct")
    if cams is not None:
        return cams
    if mode_of(request.app) == "ha_app":
        raise web.HTTPConflict(text='{"error":"provided_by_app","message":"Mantel runs as a Home Assistant App, so its '
                               'cameras come from Home Assistant. Add an RTSP camera there with Home Assistant’s Generic Camera."}',
                               content_type="application/json")
    raise web.HTTPConflict(text='{"error":"no_go2rtc","message":"Mantel was started without its video relay (go2rtc), '
                           'which direct cameras need. Set --go2rtc-url."}', content_type="application/json")


# ------------------------------------------------------------------------------------- reading what was typed
def _text(body: Mapping[str, Any], key: str, limit: int) -> str:
    v = body.get(key)
    if v is None:
        return ""
    if not isinstance(v, str) or len(v) > limit:
        raise SetupError(key, "invalid", f"{key.replace('_', ' ').capitalize()}: up to {limit} characters.")
    return v


def _sensors(request: web.Request, body: Mapping[str, Any], slug: str | None, old: Mapping[str, str]) -> dict[str, str] | None:
    """The `sensors` of a body, checked, or None when it has none (a change keeps the camera's). A sensor changed or
    added must be one this person may see, that Home Assistant has, and that no other camera has."""
    if "sensors" not in body:
        return None
    given = body["sensors"]
    if given is None:
        given = {}
    if not isinstance(given, Mapping) or set(given) - set(D.SENSOR_ROLES):
        raise SetupError("sensors", "invalid", "Sensors: Motion, Person and Doorbell.")
    app = request.app
    cams = app["cameras_direct"]
    out: dict[str, str] = {}
    taken = {eid: (cam, role) for eid, (cam, role) in cams.sensor_links().items() if cam != D.entity_id_of(slug or "")}
    for role in D.SENSOR_ROLES:
        if role not in given:
            # a role left out is left as it is: the page leaves out one linked to a sensor this person cannot see
            # (it was never told which, so it cannot send it back), and a change must not drop it
            if old.get(role):
                out[role] = old[role]
            continue
        eid = given[role]
        if eid in (None, ""):
            continue
        field = f"sensors.{role}"
        pick = f"Pick a {ROLE_LABEL[role]} sensor from the list."
        if not isinstance(eid, str) or not D.SENSOR_ID.match(eid):
            raise SetupError(field, "sensor_invalid", pick)
        if old.get(role) != eid:
            hub = app["hub"]
            known = eid in hub.store.states or eid in hub.registry.entries
            if not ha_state(app)["set_up"]:
                raise SetupError(field, "no_ha", "Without Home Assistant there is no sensor to link. Set up Home Assistant in Connections first.")
            if not known or not _may_see(request, eid):
                raise SetupError(field, "sensor_unknown", pick)         # one in these words whether it is missing or not theirs
        if eid in taken:
            other = next((s.name for s in cams.sources() if s.entity_id == taken[eid][0]), "another camera")
            raise SetupError(field, "sensor_taken", f"That sensor is already linked to {other}.")
        if eid in out.values():
            raise SetupError(field, "sensor_twice", "One sensor cannot be two of a camera’s.")
        out[role] = eid
    return out


def read_camera(request: web.Request, body: Mapping[str, Any], cams: D.DirectCameras, slug: str | None) -> dict[str, Any]:
    """A create's or a change's body as the source ``put`` takes (the full camera), or SetupError. `slug`: the saved
    camera being changed, whose blank boxes are kept; None for a new one."""
    old = next((s for s in cams.sources() if s.slug == slug), None) if slug else None
    sec = cams.secret(slug) if old is not None else None
    if slug and (old is None or old.source != "rtsp"):
        raise SetupError("slug", "not_found", "That camera no longer exists.", 404)
    name = _text(body, "name", D.NAME_MAX).strip()
    if not name:
        raise SetupError("name", "name_required", "Give the camera a name.")
    area = body.get("area_id", old.area_id if old else None)
    if area in ("",):
        area = None
    if area is not None:
        if not isinstance(area, str) or not D.AREA.match(area) or (app_areas(request) and area not in app_areas(request)):
            raise SetupError("area_id", "area_unknown", "Pick an area from the list, or none.")
    # the saved address and login, to keep what is left blank
    keep_bare, keep_user, keep_pw = (split_login(sec.high) if sec is not None else ("", "", ""))
    keep_low = split_login(sec.low)[0] if sec is not None and sec.low else ""
    keep_snap = split_login(sec.still)[0] if sec is not None and sec.still else ""
    address = _text(body, "address", D.MAX_URL).strip()
    address = check_address(address) if address or not keep_bare else keep_bare
    if "low_address" in body:
        low = _text(body, "low_address", D.MAX_URL).strip()
        low = check_address(low, "low_address") if low else ""
    else:
        low = keep_low
    if "snapshot_address" in body:
        snap = _text(body, "snapshot_address", D.MAX_URL).strip()
        snap = check_snapshot(snap) if snap else ""
    else:
        snap = keep_snap
    username, password = _text(body, "username", 200), _text(body, "password", 400)
    if body.get("clear_login") is True:
        user, pw = "", ""
    else:
        user, pw = username or keep_user, password or keep_pw
    if pw and not user:
        raise SetupError("username", "username_required", "Type the user name that goes with the password.")
    streams = {"high": with_login(address, user, pw), "low": with_login(low, user, pw) if low else None}
    src: dict[str, Any] = {"slug": slug or "", "name": name, "area_id": area, "source": "rtsp", "streams": streams}
    if snap:
        src["still"] = with_login(snap, user, pw)
    sensors = _sensors(request, body, slug, old.links if old else {})
    if sensors is None:
        sensors = old.links if old else {}
    src["sensors"] = sensors
    src["detections"] = [ROLE_DETECTION[r] for r in D.SENSOR_ROLES if r in sensors]
    return src


def app_areas(request: web.Request) -> dict[str, str]:
    return request.app["hub"].registry.areas


def refused(exc: SetupError) -> web.Response:
    return error(exc.status, exc.code, message=str(exc), field=exc.field)


# ------------------------------------------------------------------------------------- the routes
@guard("manager", reads="admin")
async def api_page(request: web.Request) -> web.Response:
    return ok(page_state(request, guarded(request)))


@guard("manager", reads="admin")
async def api_sensors(request: web.Request) -> web.Response:
    """The sensors a camera can be linked to, as this person may see them, and the suggestions for `name`."""
    cams = _cams(request)
    app = request.app
    ha = ha_state(app)
    slug = request.query.get("slug", "")
    mine = D.entity_id_of(slug) if D.SLUG.match(slug) else ""
    taken = {eid: cam for eid, (cam, _role) in cams.sensor_links().items() if cam != mine}
    out: list[dict[str, Any]] = []
    suggested: dict[str, str | None] = {r: None for r in D.SENSOR_ROLES}
    if ha["set_up"]:
        house = _house(app)
        reg = {e.entity_id: e for e in house.entities()}
        for st in house.states():
            if st.domain not in ("binary_sensor", "event"):
                continue
            e = reg.get(st.entity_id)
            if (e is not None and not NA.usable(e)) or not _may_see(request, st.entity_id):
                continue
            area = app["hub"].registry.entity_area.get(st.entity_id)
            out.append({"entity_id": st.entity_id, "name": st.name, "kind": NA.kind(house, st.entity_id, e),
                        "area": app["hub"].registry.areas.get(area) if area else None,
                        "linked_to": next((s.name for s in cams.sources() if s.entity_id == taken.get(st.entity_id)), None)})
        out.sort(key=lambda x: (x["name"].lower(), x["entity_id"]))
        got = NA.suggest_links(house, request.query.get("name", ""), taken)
        suggested = {r: (v if v and _may_see(request, v) else None) for r, v in got.items()}
    return ok({"ha": ha, "sensors": out, "suggested": suggested})


async def _test_body(request: web.Request, cams: D.DirectCameras, body: Mapping[str, Any]) -> dict[str, Any]:
    """The test of what is typed: the main stream (with its picture), and the sub-stream when there is one."""
    slug = body.get("slug") if isinstance(body.get("slug"), str) and D.SLUG.match(body.get("slug") or "") else None
    src = read_camera(request, {**body, "name": body.get("name") or "Camera", "sensors": {}}, cams, slug)
    if cams.testing_lock.locked():
        raise SetupError("address", "busy", "Another camera is being tried. Wait a moment.", 409)
    async with cams.testing_lock:
        snap = asyncio.create_task(try_snapshot(request.app, src["still"])) if src.get("still") else None
        first = asyncio.create_task(try_stream(cams, src["streams"]["high"], picture=snap is None))
        second = asyncio.create_task(try_stream(cams, src["streams"]["low"], picture=False)) if src["streams"]["low"] else None
        got = await first
        low = await second if second is not None else None
        shot = await snap if snap is not None else None
    if not got["ok"]:
        return got
    if low is not None and not low["ok"]:
        return {**low, "message": "The sub-stream: " + low["message"][0].lower() + low["message"][1:]}
    if shot is not None and not shot["ok"]:
        return shot
    return {**got, "low": low is not None, "snapshot": shot is not None, **({"still": shot["still"]} if shot else {})}


@guard("manager", fresh="away", no_audit="tries an address from this server and keeps nothing")
async def api_test(request: web.Request) -> web.Response:
    cams = _cams(request)
    body = await read_json(request)
    try:
        got = await _test_body(request, cams, body)
    except SetupError as exc:
        return refused(exc)
    if not got["ok"]:
        return error(422, got["code"], message=got["message"])
    return ok({"result": got})


def _detail(request: web.Request, src: Mapping[str, Any], cams: D.DirectCameras) -> dict[str, Any]:
    """What an audit row says of a camera: never the login, the path or the sealed URL."""
    return {"slug": src["slug"], "name": src["name"], "area_id": src["area_id"],
            "address": address_of(src["streams"]["high"]), "sub_stream": bool(src["streams"]["low"]),
            "snapshot": bool(src.get("still")),
            "login": bool(split_login(src["streams"]["high"])[1]), "sensors": dict(src["sensors"])}


def _changed(old: Any, src: Mapping[str, Any], body: Mapping[str, Any]) -> list[str]:
    """Which parts of a camera a change touched (names only)."""
    out = []
    if old.name != src["name"]:
        out.append("name")
    if old.area_id != src["area_id"]:
        out.append("area")
    if body.get("address"):
        out.append("address")
    if "low_address" in body:
        out.append("sub_stream")
    if "snapshot_address" in body:
        out.append("snapshot")
    if body.get("username") or body.get("clear_login") is True:
        out.append("user_name")
    if body.get("password") or body.get("clear_login") is True:
        out.append("password")
    if old.links != src["sensors"]:
        out.append("sensors")
    return out


def _actor(ident: Any):
    from .settings_store import Actor
    return Actor(user_id=ident.user.id, role=ident.user.role)


async def _keep(request: web.Request, cams: D.DirectCameras, src: dict[str, Any], ident: Any, action: str,
                detail: Mapping[str, Any]) -> web.Response:
    """Audit (before the change), keep, and answer with the camera as the page is told it."""
    audit.config(request, ident, action, detail)
    try:
        saved = await cams.put(src, actor=_actor(ident))
    except D.CameraConflict as exc:
        return error(409, "ha_has_that_id", message=str(exc), field="name", entity_id=exc.entity_id)
    except D.SourceError as exc:
        field = {"streams.high": "address", "streams.low": "low_address"}.get(exc.field, exc.field)
        return error(422, "invalid", message=f"{field.replace('_', ' ').capitalize()} is not something this camera can use.",
                     field=field)
    status = next(s for s in cams.status()["cameras"] if s["slug"] == saved.slug)
    return ok({"camera": camera_json(request, cams, status)}, 201 if action.endswith(".add") else 200)


@guard("manager", fresh="away", audit="camera.rtsp.add")
async def api_add(request: web.Request) -> web.Response:
    ident = guarded(request)
    cams = _cams(request)
    body = await read_json(request)
    try:
        taken = {s.slug for s in cams.sources()}
        src = read_camera(request, body, cams, None)
        src["slug"] = slug_of(src["name"], taken)
        # the sensors were checked against no slug: a new camera has none of its own
    except SetupError as exc:
        return refused(exc)
    log.info("cameras: %s adds the RTSP camera %s", ident.user.id, src["slug"])
    return await _keep(request, cams, src, ident, "camera.rtsp.add", _detail(request, src, cams))


def _slug(request: web.Request) -> str:
    slug = request.match_info.get("slug", "")
    if not D.SLUG.match(slug):
        raise web.HTTPNotFound(text='{"error":"not_found"}', content_type="application/json")
    return slug


@guard("manager", fresh="away", audit="camera.rtsp.edit")
async def api_change(request: web.Request) -> web.Response:
    ident = guarded(request)
    cams = _cams(request)
    slug = _slug(request)
    body = await read_json(request)
    try:
        src = read_camera(request, body, cams, slug)
        src["slug"] = slug
    except SetupError as exc:
        return refused(exc)
    old = next(s for s in cams.sources() if s.slug == slug)
    detail = {**_detail(request, src, cams), "changed": _changed(old, src, body)}
    log.info("cameras: %s changes the RTSP camera %s", ident.user.id, slug)
    return await _keep(request, cams, src, ident, "camera.rtsp.edit", detail)


@guard("manager", fresh="away", audit="camera.rtsp.remove")
async def api_remove(request: web.Request) -> web.Response:
    ident = guarded(request)
    cams = _cams(request)
    slug = _slug(request)
    old = next((s for s in cams.sources() if s.slug == slug), None)
    if old is None:
        return error(404, "not_found", message="That camera no longer exists.")
    if old.source != "rtsp":
        return error(409, "not_rtsp", message="That camera comes from UniFi Protect: remove it there.")
    audit.config(request, ident, "camera.rtsp.remove", {"slug": slug, "name": old.name})
    log.info("cameras: %s removes the RTSP camera %s", ident.user.id, slug)
    await cams.remove(slug, actor=_actor(ident))
    return ok({"removed": slug})


def register(app: web.Application) -> None:
    """The routes, on every Mantel (Home Assistant's App answers the page that says its cameras come from Home
    Assistant). After cameras_direct.register, whose ``app["cameras_direct"]`` the changing routes use."""
    r = app.router
    r.add_get(API, api_page)
    r.add_get(API + "/sensors", api_sensors)
    r.add_post(API + "/test", api_test)
    r.add_post(API, api_add)
    r.add_put(API + "/{slug}", api_change)
    r.add_delete(API + "/{slug}", api_remove)
