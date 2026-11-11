"""DIRECT CAMERA SOURCES (docs/phase13/CAMERAS-DIRECT.md "The design -> Camera sources", phase 3).

Where Mantel runs its own go2rtc (Docker / Proxmox LXC: ``--go2rtc-url``, live_tv.go2rtc_api_url), a camera can
come straight from its source -- a UniFi Protect console (phase 4) or an RTSP stream (phase 6) -- without Home
Assistant in the middle. This module is what both of those phases stand on: the registry of direct sources, the
camera entities they become, their video through Mantel's go2rtc, and their stills. It is Live TV's machinery
(live_tv.py) pointed at cameras: the same go2rtc client, the same entity overlay, the same signaling relay. HK's
page is unchanged: a direct camera is an ordinary camera entity to it.

* **The source registry** (``DirectCameras.put`` / ``.remove`` / ``.sources``: the Python API phase 4's Protect
  connector and phase 6's Add Camera call). A source is ``{slug, name, area_id, source: "protect"|"rtsp",
  streams: {"high": url, "low": url|None}, still: url|None, protect_id, speaker, detections}``. What is not secret
  is the house document ``cameras_direct`` in Mantel's settings store (versioned, in every backup; not one of the
  documents a page may read or write: settings_store.HOUSE_DOCS leaves it out). **The stream URLs never go in that
  document**: Protect's RTSPS URLs carry a token and an RTSP URL its user name and password. They are sealed, one
  file per camera, beside the Connections page's own credentials (``<data_dir>/connections/camera-<slug>.connection``,
  connections.SealedFiles: AES-GCM with the at-rest key, associated data ``connection:camera-<slug>``, folder 0700,
  file 0600, inside every encrypted backup, as tablet_links.py keeps a wall tablet's). From then on a URL is only
  ever *used*: never in a response, a status, a log line or an exception message, and never sent to a page.
* **Ids.** A direct camera is ``camera.mantel_<slug>`` (slug ``[a-z0-9_]{1,40}``), entity-shaped, so the camera
  strip, the Cameras page, room snapshots, the Side Pane, Home Grid and the doorbell sheet need no new kind. An id
  Home Assistant already has (its registry, or a state of its own) is **refused at setup and named**
  (``CameraConflict``), never shadowed. If Home Assistant gains that id later, Home Assistant's wins: the direct
  camera leaves the overlay (Home Assistant's state and entry are left exactly as they are) and the status says
  ``conflict``, naming the entity, until one of the two is renamed.
* **The entities** are an overlay (live_tv.LocalEntities, with this module's own registry flag, so Live TV's
  overlay and this one never drop each other's entries): state ``idle``; ``friendly_name``, ``supported_features:
  2`` (a camera that streams), ``frontend_stream_type: "web_rtc"``, ``mantel_source`` and an ``entity_picture``
  that camera_still.shape turns into Mantel's own still route, as for Home Assistant's cameras. The registry entry
  carries the source's ``area_id``, so area-based grants apply exactly as they do to Home Assistant's cameras.
* **RBAC: nothing new to decide.** The camera rules key on the entity id and its area (the registry), so
  ``Authz.may_view`` / ``may_still`` decide a direct camera exactly as an HA camera: ``view`` on the camera, then
  ``camera.live`` through doorbell_policy, and the door's camera rules (the tunnel's ``tunnel_cameras``). A deny on
  the entity wins; a Child or Guest is refused (their roles deny the cameras feature). Signaling asks
  ``hooks.may_view`` first, as connectors/camera.py does, and nothing reaches go2rtc otherwise; an open session is
  asked again on every policy tick (``recheck``).
* **The video.** ``camera/webrtc/{get_client_config,offer,candidate}`` for a direct camera are answered HERE (they
  wrap Live TV's wrapper of the camera connector's routes; every other camera goes on as before). An offer puts the
  camera's stream in go2rtc (``PATCH /api/streams``, in memory) as ``mantel_cam_<slug>_high`` -- for Protect
  ``rtspx://host:7441/<token>``: RTSPS without SRTP, which go2rtc relays to WebRTC untouched (the spike: H.264 and
  Opus) -- and relays the offer, answer and candidates over go2rtc's socket exactly as Live TV does
  (live_tv.relay_go2rtc). Full screen and tiles both play ``high`` (2026-11-02): the page's offer does not say
  which it shows, and ``low`` is the stills' when the source has one. A stream is removed STOP_GRACE_S after its
  last viewer; the tick removes any ``mantel_cam_*`` stream nobody uses (a restart, a crash). Each stream Mantel
  sets up is registered with media_proxy's ``/go2rtc/`` gate as its camera's (``go2rtc_streams.allow(name,
  "camera", entity_id)``), so a viewing path there is decided by that camera's own ``may_view``.
* **Caps**: the camera connector's numbers (16 sessions a socket, 64 in all), counted from the offer's check on
  (offers sent together are all counted), as Live TV counts.
* **Stills** (``/api/camera/<id>/still``, connectors/camera_still.py): the route's policy check is unchanged and
  comes first; then a direct camera's still is ``DirectCameras.still``: a still provider for its source when one is
  set (``set_still_provider``: phase 4 gives Protect's own snapshot here, ``highQuality`` for full screen), else the
  source's own still URL (sealed like its streams), else go2rtc's ``GET /api/frame.jpeg?src=`` of its ``low``
  stream (``high`` when it has none). Shared between tablets for STILL_SHARE seconds, as Home Assistant's are.
* **Where it runs.** Only where Mantel has its own go2rtc. Under the HA App (no ``--go2rtc-url``) ``register``
  installs nothing at all: ``app["cameras_direct"]`` is absent, no route is wrapped, and every camera is Home
  Assistant's as before (the plan's "Where it runs": the HA App's cameras come from HA's integrations).

2026-11-02: phase 3 built from the spike (one Protect camera via ``rtspx://`` in the stack's own go2rtc played over
WebRTC on the owner's iPad and a wall tablet). The design matches the plan's "Camera sources" with two choices of
detail recorded here: the URLs are sealed files beside the Connections page's credentials rather than in the
settings document, and an id Home Assistant gains later is HA's (reported as ``conflict``) rather than shadowed.

2026-11-02, phase 4 (protect_connector.py): **a camera Home Assistant has too** (decision 2). The connector matches a
picked Protect camera to Home Assistant's camera of the same device (its MAC) and tells this module
(``set_matches``): a matched source never becomes ``camera.mantel_<slug>`` (the camera shows once, as Home
Assistant's entity, with HA's name and area), and where its **Video From** is Direct, Home Assistant's entity id is
an *alias* of the source: its signaling and its still are answered HERE, from Mantel's go2rtc and the source's
still provider, exactly as a ``camera.mantel_*`` one is. RBAC does not move: the route's policy check and the
signaling's ``may_view`` are asked about Home Assistant's entity id, its area and its denies, as before; only where
the picture comes from changes (``serves``). Each unmatched source's registry entry names a device of its own
(``mantel_cam_<slug>``), so the connector's detection sensors sit on the same device as the camera and the
notifications' camera association (``accessories.camera_for``) finds it. A go2rtc failure on a source's stream is
told to ``on_stream_failed`` (the connector fetches Protect's stream token again).

2026-11-02: phase 6 (RTSP cameras, camera_setup.py) is this registry's first writer. It added ``sensors`` to the
source ({motion, person, doorbell}: the Home Assistant binary sensors or events a person linked to the camera, which
has no HA device to carry them), ``sensor_links()`` for the House port's ``camera_links`` (the notification rules read
it in place of a device: hk_core/notifications/accessories.py), ``on_links`` (the notifications look again when they
change) and ``testing`` (the Add Camera page's temporary streams, which ``reap`` leaves alone while a test runs).

Wiring (server.wire, after live_tv.register)::

    cameras_direct.register(app, hub, hooks)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass, field, replace
from typing import Any, Awaitable, Callable, Iterable, Mapping
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from aiohttp import web

from ..storage import atrest
from .. import connections as C
from ..connectors import Ctx, Forbidden, Hooks, Route, read_routes, resolve, split_quality
from ..identity.guards import guard
from .live_tv import (
    CANDIDATE, CONFIG, ICE_SERVERS, MAX_SDP, OFFER, Go2rtc, Go2rtcError, LocalEntities, go2rtc_api_url, relay_go2rtc,
)

log = logging.getLogger("mantel.cameras_direct")

DOC = "cameras_direct"                      # house/<this> in the settings store: the sources, never their URLs
ENTITY_PREFIX = "camera.mantel_"
STREAM_PREFIX = "mantel_cam_"               # go2rtc stream names this module owns (and may remove)
FLAG = "mantel_direct_camera"               # this overlay's registry entries (LocalEntities' flag)
PLATFORM = "mantel_camera"
SECRET_PREFIX = "camera-"                   # connections/<this><slug>.connection: the sealed URLs
SOURCES = ("protect", "rtsp")
DETECTIONS = ("motion", "person", "vehicle", "animal", "package", "ring")
SENSOR_ROLES = ("motion", "person", "doorbell")     # the HA sensors a camera can be LINKED to (phase 6)
SENSOR_ID = re.compile(r"^(binary_sensor|event)\.[a-z0-9_]{1,200}$")
QUALITIES = ("high", "medium", "low")
# WHICH STREAM PLAYS (2026-11-02, the owner): the page says what it draws (connectors.split_quality); a camera without
# that stream plays the nearest one it has. No hint (an older page) is a pop-up's: high.
PREFER = {"high": ("high", "medium", "low"), "medium": ("medium", "high", "low"), "low": ("low", "medium", "high")}
STOP_GRACE_S = 5.0
TICK_S = 30.0
MAX_SESSIONS = 64                           # connectors/camera.py's MAX_OFFERS
MAX_SESSIONS_PER_SOCKET = 16                # ...and its MAX_OFFERS_PER_SOCKET
MAX_URL = 2048
NAME_MAX = 80
SLUG = re.compile(r"^[a-z0-9_]{1,40}$")
AREA = re.compile(r"^[a-z0-9_]{1,80}$")
PROTECT_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_STREAM_URL = re.compile(r"^(rtsp|rtsps|rtspx)://[^\s#]+$")
_STILL_URL = re.compile(r"^https?://[^\s#]+$")


# ------------------------------------------------------------------------------------- the shapes
class SourceError(ValueError):
    """A source refused by ``put``: ``field`` names what was wrong. The message never holds a URL."""

    def __init__(self, field_: str, message: str) -> None:
        super().__init__(message)
        self.field = field_


class CameraConflict(SourceError):
    """The camera's id is already Home Assistant's: refused at setup, and named."""

    def __init__(self, entity_id: str, what: str) -> None:
        super().__init__("slug", f"{entity_id} is already a Home Assistant entity ({what}); give this camera another name")
        self.entity_id, self.what = entity_id, what


def entity_id_of(slug: str) -> str:
    return ENTITY_PREFIX + slug


def device_of(slug: str) -> str:
    """The device a direct camera's entities share (its camera, and phase 4's detection sensors and speaker)."""
    return f"mantel_cam_{slug}"


def stream_name(slug: str, quality: str = "high") -> str:
    return f"{STREAM_PREFIX}{slug}_{quality}"


def protect_source(url: str) -> str:
    """Protect's RTSPS URL as go2rtc should play it: ``rtspx://`` (RTSPS without SRTP: go2rtc relays it to WebRTC
    untouched, the phase 3 spike), and without Protect's ``?enableSrtp``. Any other URL is returned as it is."""
    parts = urlsplit(url)
    if parts.scheme != "rtsps":
        return url
    return urlunsplit(("rtspx", parts.netloc, parts.path, "", ""))


def _url(value: Any, pattern: re.Pattern, field_: str) -> str:
    if not isinstance(value, str) or len(value) > MAX_URL or not pattern.match(value) \
            or any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise SourceError(field_, f"{field_}: not a URL this camera can use")
    return value


@dataclass(frozen=True)
class DirectSource:
    """One direct camera, as the settings document keeps it: everything but its URLs (``low`` and ``still`` only
    say whether it has them)."""
    slug: str
    name: str
    source: str
    area_id: str | None = None
    protect_id: str | None = None
    speaker: bool = False
    detections: tuple[str, ...] = ()
    low: bool = False
    still: bool = False
    # LINKED HA SENSORS (phase 6, 2026-11-02): ((role, entity id), ...) in SENSOR_ROLES' order. A direct camera has
    # no Home Assistant device to carry its motion, person and doorbell sensors, so the person who set it up says
    # which ones they are; the notification rules read them as `camera_links` (house.MantelHouse). Entity ids, not
    # secrets, so they live in the document with the rest.
    sensors: tuple[tuple[str, str], ...] = ()

    @property
    def entity_id(self) -> str:
        return entity_id_of(self.slug)

    @property
    def links(self) -> dict[str, str]:
        return dict(self.sensors)

    def public(self) -> dict[str, Any]:
        return {"slug": self.slug, "name": self.name, "source": self.source, "area_id": self.area_id,
                "protect_id": self.protect_id, "speaker": self.speaker, "detections": list(self.detections),
                "low": self.low, "still": self.still, "sensors": dict(self.sensors)}

    @classmethod
    def from_doc(cls, d: Mapping[str, Any]) -> "DirectSource | None":
        try:
            src, _ = check_source({k: v for k, v in d.items() if k not in ("low", "still")})
        except (SourceError, TypeError):
            return None
        return replace(src, low=d.get("low") is True, still=d.get("still") is True)


@dataclass
class CameraSecret:
    """One camera's sealed URLs (connections.SealedFiles' record: ``kind`` names the file). ``repr`` shows none."""
    kind: str
    high: str = field(repr=False)
    low: str | None = field(default=None, repr=False)
    still: str | None = field(default=None, repr=False)
    medium: str | None = field(default=None, repr=False)      # Protect's medium channel (2026-11-02)

    def url(self, quality: str) -> tuple[str, str]:
        """(quality, url) of the stream to play for ``quality``: that one, else the nearest the camera has."""
        for q in PREFER.get(quality, PREFER["high"]):
            u = getattr(self, q)
            if u:
                return q, u
        return "high", self.high


def check_source(source: Mapping[str, Any]) -> tuple[DirectSource, CameraSecret | None]:
    """A source fit to keep, and its secret (None when ``streams`` is left out: an update keeps the camera's own),
    or SourceError naming the field."""
    if not isinstance(source, Mapping):
        raise SourceError("source", "a camera source is an object")
    extra = set(source) - {"slug", "name", "area_id", "source", "streams", "still", "protect_id", "speaker",
                           "detections", "sensors"}
    if extra:
        raise SourceError(sorted(extra)[0], f"unknown fields: {', '.join(sorted(extra))}")
    slug = source.get("slug")
    if not isinstance(slug, str) or not SLUG.match(slug):
        raise SourceError("slug", "slug: 1 to 40 of a-z, 0-9 and _")
    name = source.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > NAME_MAX:
        raise SourceError("name", f"name: 1 to {NAME_MAX} characters")
    kind = source.get("source")
    if kind not in SOURCES:
        raise SourceError("source", f"source: one of {', '.join(SOURCES)}")
    area = source.get("area_id")
    if area is not None and (not isinstance(area, str) or not AREA.match(area)):
        raise SourceError("area_id", "area_id: an area id, or null")
    pid = source.get("protect_id")
    if pid is not None and (kind != "protect" or not isinstance(pid, str) or not PROTECT_ID.match(pid)):
        raise SourceError("protect_id", "protect_id: a Protect camera id, for a Protect source only")
    speaker = source.get("speaker", False)
    if not isinstance(speaker, bool):
        raise SourceError("speaker", "speaker: true or false")
    det = source.get("detections") or []
    if not isinstance(det, (list, tuple)) or any(d not in DETECTIONS for d in det):
        raise SourceError("detections", f"detections: any of {', '.join(DETECTIONS)}")
    detections = tuple(d for d in DETECTIONS if d in det)
    linked = source.get("sensors") or {}
    if not isinstance(linked, Mapping) or set(linked) - set(SENSOR_ROLES) \
            or any(not isinstance(v, str) or not SENSOR_ID.match(v) for v in linked.values() if v is not None):
        raise SourceError("sensors", f"sensors: {{{', '.join(SENSOR_ROLES)}}}, each a binary_sensor or event entity id")
    sensors = tuple((r, linked[r]) for r in SENSOR_ROLES if linked.get(r))
    if len({v for _, v in sensors}) != len(sensors):
        raise SourceError("sensors", "sensors: one sensor cannot be two of a camera's")
    src = DirectSource(slug=slug, name=name.strip(), source=kind, area_id=area, protect_id=pid, speaker=speaker,
                       detections=detections, sensors=sensors)
    streams = source.get("streams")
    if streams is None:
        if source.get("still") is not None:
            raise SourceError("still", "still: give it with the streams")
        return src, None
    if not isinstance(streams, Mapping) or set(streams) - set(QUALITIES):
        raise SourceError("streams", "streams: {high, medium, low}")
    high = _url(streams.get("high"), _STREAM_URL, "streams.high")
    low, medium = streams.get("low"), streams.get("medium")
    low = None if low is None else _url(low, _STREAM_URL, "streams.low")
    medium = None if medium is None else _url(medium, _STREAM_URL, "streams.medium")
    if kind == "protect":
        high, low = protect_source(high), (protect_source(low) if low else None)
        medium = protect_source(medium) if medium else None
    still = source.get("still")
    still = None if still is None else _url(still, _STILL_URL, "still")
    secret = CameraSecret(SECRET_PREFIX + slug, high, low, still, medium)
    return replace(src, low=low is not None, still=still is not None), secret


# ------------------------------------------------------------------------------------- sessions
@dataclass
class CamSession:
    id: str
    camera: str
    stream: str
    ws: Any = None
    reader: asyncio.Task | None = None
    ended: bool = False
    candidates: int = 0
    started: float = field(default_factory=time.monotonic)


@dataclass
class DirectHooks:
    """Tests replace the tick and the stop grace."""
    tick: float = TICK_S
    stop_grace: float = STOP_GRACE_S


StillProvider = Callable[[DirectSource, "int | None", "int | None"], Awaitable["tuple[bytes, str] | None"]]


class DirectCameras:
    """``app["cameras_direct"]``: see the module docstring."""

    def __init__(self, app: web.Application, hub: Any, hooks: Hooks, cam_hooks: DirectHooks | None = None) -> None:
        self.app, self.hub, self.hooks = app, hub, hooks
        self.cam_hooks = cam_hooks or DirectHooks()
        self.go2rtc = Go2rtc(go2rtc_api_url(app.get("cfg")), lambda: app.get("http"))
        self.local = LocalEntities(hub, lambda: app["clock"]() if "clock" in app else time.time(), flag=FLAG)
        self.conflicts: dict[str, str] = {}                  # entity id -> the HA entity that has it (status)
        self._links: dict[str, tuple[str, str]] = {}         # linked sensor -> (camera, role): sensor_links()
        self.on_links: Callable[[], None] | None = None      # the notifications look again when these change
        # the Add Camera page's Test (camera_setup.try_stream): its temporary streams, which the tick's reap must not
        # take mid-test (but does take after a crash left one), and the one test allowed at a time
        self.testing: set[str] = set()
        self.testing_lock = asyncio.Lock()
        self._secrets: dict[str, CameraSecret] = {}
        self.unreadable: dict[str, str] = {}                 # slug -> why its sealed file did not open
        self.sessions: dict[str, CamSession] = {}
        self.starting = 0
        self.streams: dict[str, str] = {}                    # go2rtc stream name -> slug, set up there
        self._stop_timers: dict[str, asyncio.TimerHandle] = {}
        self._stills_busy: dict[str, int] = {}               # stream -> stills being drawn from it
        self.still_providers: dict[str, StillProvider] = {}
        self.matched: dict[str, str] = {}                    # slug -> Home Assistant's camera it is (no overlay entity)
        self.aliases: dict[str, str] = {}                    # HA's camera entity -> slug: Video From Direct
        self.on_stream_failed: Callable[[DirectSource], None] | None = None
        self._tasks: set[asyncio.Task] = set()
        self.error: str | None = None
        self.log: list[dict[str, Any]] = []

    # -- the registry (phase 4's and phase 6's API) -----------------------------------------------------
    def _store(self) -> Any:
        return self.app["settings"].store

    def sources(self) -> list[DirectSource]:
        """Every direct camera, by slug. No URLs: ``low`` and ``still`` only say whether it has them."""
        body = self._store().body("house", DOC) or {}
        out = {}
        for d in body.get("cameras") or []:
            s = DirectSource.from_doc(d) if isinstance(d, Mapping) else None
            if s is not None:
                out[s.slug] = s
        return [out[k] for k in sorted(out)]

    def source(self, entity_id: str) -> DirectSource | None:
        return next((s for s in self.sources() if s.entity_id == entity_id), None)

    async def put(self, source: Mapping[str, Any], *, actor: Any = None) -> DirectSource:
        """Add or change one camera. ``streams`` (and ``still``) may be left out of a change to keep the camera's
        own. Refused (SourceError, or CameraConflict naming Home Assistant's entity) before anything is kept. The
        sealed URLs are written before the document, so the document never names a camera without them."""
        from ..settings_store import Actor
        src, secret = check_source(source)
        who = self.ha_has(src.entity_id)
        if who is not None:
            raise CameraConflict(src.entity_id, who)
        current = {s.slug: s for s in self.sources()}
        old = current.get(src.slug)
        if secret is None:
            if old is None:
                raise SourceError("streams", "streams: a new camera needs its high stream")
            src = replace(src, low=old.low, still=old.still)
        else:
            changed = self.secret(src.slug)
            self._files().save(secret)
            self._secrets[src.slug] = secret
            self.unreadable.pop(src.slug, None)
            if changed is not None and (changed.high, changed.medium, changed.low) != (secret.high, secret.medium, secret.low):
                await self.end_camera(src.entity_id)      # its streams play the old URLs: set up again on the next offer
        current[src.slug] = src
        self._write(current.values(), actor or Actor(label="cameras"), f"camera {src.slug} set")
        self.sync_states()
        return src

    async def remove(self, slug: str, *, actor: Any = None) -> bool:
        """Remove one camera: its sessions end, its streams go, its sealed URLs are deleted."""
        from ..settings_store import Actor
        current = {s.slug: s for s in self.sources()}
        if slug not in current:
            return False
        await self.end_camera(entity_id_of(slug))
        del current[slug]
        self._write(current.values(), actor or Actor(label="cameras"), f"camera {slug} removed")
        self._secrets.pop(slug, None)
        self.unreadable.pop(slug, None)
        self._files().delete(SECRET_PREFIX + slug)
        self.sync_states()
        return True

    def set_matches(self, matched: Mapping[str, str], aliases: Mapping[str, str]) -> None:
        """PHASE 4'S MATCH (decision 2): ``matched`` {slug: Home Assistant's camera entity} are sources Home Assistant
        has as well (they leave the overlay: one camera, Home Assistant's); ``aliases`` {HA's entity: slug} are the
        ones whose Video From is Direct (their video and stills come from here, under HA's entity id: each of the
        matched device's channels). A session on an alias that went away ends (the page's card retries, and plays from
        Home Assistant)."""
        self.matched = {k: v for k, v in matched.items() if isinstance(k, str) and isinstance(v, str)}
        self.aliases = {k: v for k, v in aliases.items() if isinstance(k, str) and v in self.matched}
        self.sync_states()
        for eid in {s.camera for s in self.sessions.values()} - set(self.local.mine) - set(self.aliases):
            self.spawn(self.end_camera(eid))

    def serves(self, entity_id: Any) -> DirectSource | None:
        """The source whose picture this camera entity is, now: a ``camera.mantel_*`` this overlay has, or Home
        Assistant's camera whose Video From is Direct (an alias). None for every other camera."""
        if not isinstance(entity_id, str):
            return None
        if self.owns(entity_id):
            return self.source(entity_id)
        slug = self.aliases.get(entity_id)
        if slug is None:
            return None
        return next((s for s in self.sources() if s.slug == slug), None)

    def _slug_of(self, entity_id: str) -> str | None:
        if entity_id.startswith(ENTITY_PREFIX):
            return entity_id[len(ENTITY_PREFIX):]
        return self.aliases.get(entity_id) or next((s for s, e in self.matched.items() if e == entity_id), None)

    def set_still_provider(self, source: str, provider: StillProvider | None) -> None:
        """PHASE 4'S HOOK: where a source's stills come from instead of go2rtc's frame (Protect's own snapshot,
        ``highQuality`` when the page asks a large one). ``provider(source, width, height)`` returns (body, content
        type), or None to fall back to go2rtc; camera_still.StillRefused refuses."""
        if source not in SOURCES:
            raise ValueError(f"source: one of {', '.join(SOURCES)}")
        if provider is None:
            self.still_providers.pop(source, None)
        else:
            self.still_providers[source] = provider

    def _write(self, srcs: Iterable[DirectSource], actor: Any, message: str) -> None:
        body = {"cameras": [s.public() for s in sorted(srcs, key=lambda s: s.slug)]}
        self._store().write([("house", DOC, body)], actor=actor, action="set", message=message)

    def _files(self) -> C.SealedFiles:
        cfg = self.app["cfg"]
        conns = self.app.get("connections")
        box = conns.files.box if conns is not None else atrest.SecretBox(cfg.secrets_dir / atrest.KEY_FILE)
        return C.SealedFiles(cfg.connections_dir, box, CameraSecret)

    def secret(self, slug: str) -> CameraSecret | None:
        """The camera's sealed URLs (kept in memory once read), or None (none kept, or the file does not open)."""
        got = self._secrets.get(slug)
        if got is not None:
            return got
        try:
            got = self._files().load(SECRET_PREFIX + slug)
        except Exception as exc:  # noqa: BLE001 -- another at-rest key, a damaged file: say so, never the contents
            self.unreadable[slug] = type(exc).__name__
            log.warning("cameras: the sealed stream of %s does not open (%s)", slug, type(exc).__name__)
            return None
        if got is not None:
            self._secrets[slug] = got
        return got

    # -- the entities -------------------------------------------------------------------------------------
    def ha_has(self, entity_id: str) -> str | None:
        """What Home Assistant has at this id (its registry entry, or a state that is not this overlay's), named
        for a person; None when the id is free for a direct camera."""
        reg = getattr(self.hub, "registry", None)
        entry = (getattr(reg, "entries", None) or {}).get(entity_id)
        st = self.hub.store.states.get(entity_id)
        foreign_state = st is not None and st is not self.local.mine.get(entity_id)
        if entry is not None and not entry.get(FLAG):
            name = entry.get("name") or entry.get("original_name")
            plat = entry.get("platform")
            return ", ".join(x for x in (name, f"from {plat}" if plat else None) if x) or entity_id
        if foreign_state:
            return (st.get("a") or {}).get("friendly_name") or entity_id
        return None

    def wanted(self, srcs: list[DirectSource]) -> dict[str, tuple[Any, dict[str, Any]]]:
        out = {}
        for s in srcs:
            out[s.entity_id] = ("idle", {
                "friendly_name": s.name, "supported_features": 2, "frontend_stream_type": "web_rtc",
                "mantel_source": s.source,
                # camera_still.shape puts Mantel's still route (the page's prefix, a version) in its place
                "entity_picture": f"/api/camera/{s.entity_id}/still"})
        return out

    def registry_entries(self, srcs: list[DirectSource]) -> dict[str, dict[str, Any]]:
        return {s.entity_id: {"entity_id": s.entity_id, "platform": PLATFORM, "device_id": device_of(s.slug), "area_id": s.area_id,
                              "name": None, "original_name": s.name, FLAG: True} for s in srcs}

    def sync_states(self) -> set[str]:
        """The overlay and the registry made exactly the sources Home Assistant does not have."""
        srcs, mine, conflicts = self.sources(), [], {}
        for s in srcs:
            if s.slug in self.matched:
                continue                                     # Home Assistant's camera (phase 4): shown once, as HA's
            who = self.ha_has(s.entity_id)
            if who is not None:
                conflicts[s.entity_id] = who
            else:
                mine.append(s)
        for eid in set(conflicts) - set(self.conflicts):
            log.warning("cameras: %s is now Home Assistant's (%s); the direct camera is set aside", eid, conflicts[eid])
        self.conflicts = conflicts
        changed = self.local.put_all(self.wanted(mine))
        self.local.registry = self.registry_entries(mine)
        self._sync_registry()
        if changed:
            self.hub.on_change(changed)
        self._sync_links(mine)
        return changed

    def _sync_links(self, mine: list[DirectSource]) -> None:
        """The linked sensors of the cameras this overlay serves (not one set aside for Home Assistant's). The
        notifications are told when they change: what a category watches, and which camera a sensor's
        notification takes its snapshot from, depend on them."""
        links = {eid: (s.entity_id, role) for s in mine for role, eid in s.sensors}
        if links == self._links:
            return
        self._links = links
        if self.on_links is not None:
            try:
                self.on_links()
            except Exception:  # noqa: BLE001 -- the notifications' bug never breaks a camera change
                log.exception("cameras: the notifications could not take the linked sensors")

    def sensor_links(self) -> dict[str, tuple[str, str]]:
        """{sensor entity id: (camera entity id, "motion" | "person" | "doorbell")} for the cameras served now:
        the House port's ``camera_links`` (house.MantelHouse), which hk_core's notification rules read in place of
        a Home Assistant device (hk_core/notifications/accessories.py)."""
        return dict(self._links)

    def _sync_registry(self) -> None:
        registry = getattr(self.hub, "registry", None)
        if registry is None:
            return
        merged = self.local.merged_entities(list(registry.entity_entries))
        if merged is not None:
            registry.update(entities=merged)
            self.hub.on_registry()

    def on_change(self, changed: set[str]) -> None:
        st = self.hub.store.states
        mine = set(self.local.mine)
        # Home Assistant put a state of its own at one of our ids (it has that entity now: its wins), or one it
        # had at an id set aside went away: decide every source again
        if any(eid in self.conflicts or (eid in mine and st.get(eid) is not None and st[eid] is not self.local.mine[eid])
               for eid in changed):
            self.sync_states()
            return
        back = self.local.reassert(set(changed))
        if back:
            self.hub.on_change(back)
            entries = getattr(getattr(self.hub, "registry", None), "entries", {})
            if any(eid not in entries for eid in self.local.registry):
                self._sync_registry()

    def on_registry(self) -> None:
        if self.local.registry or self.conflicts:
            self.sync_states()

    def owns(self, entity_id: Any) -> bool:
        """A direct camera this overlay serves now (not one set aside for Home Assistant's)."""
        return isinstance(entity_id, str) and entity_id.startswith(ENTITY_PREFIX) and entity_id in self.local.mine

    # -- signaling ------------------------------------------------------------------------------------------
    def ours(self, msg: dict) -> bool:
        return self.serves(msg.get("entity_id")) is not None

    async def _gate(self, ctx: Ctx, entity_id: str) -> DirectSource:
        # the camera's own may_view, asked about the entity id the page named (an alias: Home Assistant's), always
        src = self.serves(entity_id)
        if src is None:
            raise Forbidden("not a direct camera")
        if await resolve(self.hooks.may_view(ctx.identity, entity_id)) is not True:
            raise Forbidden(f"may not view {entity_id}")
        return src

    async def client_config(self, ctx: Ctx, msg: dict) -> dict[str, Any]:
        from ..ha.readproxy import ReadBlocked
        if set(msg) - {"type", "id", "entity_id"}:
            raise ReadBlocked("get_client_config carries entity_id only")
        await self._gate(ctx, msg["entity_id"])
        return {"configuration": {"iceServers": json.loads(json.dumps(ICE_SERVERS))}, "getCandidatesUpfront": False}

    async def offer(self, ctx: Ctx, msg: dict, on_event: Callable[[dict], None], quality: str | None = None):
        from ..ha.readproxy import ReadBlocked
        msg, hint = split_quality(msg)
        quality = quality or hint or "high"
        if set(msg) - {"type", "id", "entity_id", "offer"}:
            raise ReadBlocked("an offer carries entity_id and offer only")
        sdp = msg.get("offer")
        if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > MAX_SDP:
            raise ReadBlocked("offer must be an SDP string")
        src = await self._gate(ctx, msg["entity_id"])
        mine: dict[str, CamSession] = ctx.state.setdefault("direct_cam_sessions", {})
        # the caps count the offers still starting too (checked and taken with no await between), as Live TV's
        if len(mine) + ctx.state.get("direct_cam_starting", 0) >= MAX_SESSIONS_PER_SOCKET \
                or len(self.sessions) + self.starting >= MAX_SESSIONS:
            raise Forbidden("too many camera streams at once")
        ctx.state["direct_cam_starting"] = ctx.state.get("direct_cam_starting", 0) + 1
        self.starting += 1
        try:
            return await self._start(ctx, src, sdp, mine, on_event, msg["entity_id"], quality)
        finally:
            ctx.state["direct_cam_starting"] -= 1
            self.starting -= 1

    async def _ensure(self, src: DirectSource, quality: str, camera: str | None = None) -> str:
        """The camera's stream set up in go2rtc (PATCH: memory only) and registered with the /go2rtc/ gate as
        ``camera``'s (the entity the page asked for: an alias is Home Assistant's, decided by its own may_view)."""
        secret = self.secret(src.slug)
        if secret is None or not secret.high:
            raise ConnectionError("this camera's stream is not set up")
        quality, url = secret.url(quality)
        name = stream_name(src.slug, quality)
        self._cancel_stop(name)
        await self.go2rtc.put_stream(name, url)
        self.streams[name] = src.slug
        self._proxy_gate(name, True, camera or src.entity_id)
        return name

    async def _start(self, ctx: Ctx, src: DirectSource, sdp: str, mine: dict[str, CamSession],
                     on_event: Callable[[dict], None], camera: str | None = None, quality: str = "high"):
        camera = camera or src.entity_id
        name = stream_name(src.slug, quality)
        try:
            name = await self._ensure(src, quality, camera)
            ws = await self.go2rtc.connect(name)
        except (aiohttp.ClientError, asyncio.TimeoutError, Go2rtcError) as exc:
            self.error = f"{type(exc).__name__}: {exc}"[:200]
            log.warning("cameras: go2rtc unavailable for %s (%s)", src.slug, self.error)
            self._schedule_stop(name)
            self._stream_failed(src)
            raise ConnectionError("the camera's stream is unavailable") from exc
        sess = CamSession(secrets.token_hex(16), camera, name, ws)
        self.sessions[sess.id] = mine[sess.id] = sess
        try:
            await ws.send_json({"type": "webrtc/offer", "value": sdp})
        except (aiohttp.ClientError, ConnectionError, RuntimeError) as exc:
            mine.pop(sess.id, None)
            await self._end(sess)
            raise ConnectionError("the camera's stream is unavailable") from exc
        on_event({"type": "session", "session_id": sess.id})
        sess.reader = asyncio.get_running_loop().create_task(relay_go2rtc(sess, on_event))
        self._log("start", sess)

        async def unsubscribe() -> None:
            mine.pop(sess.id, None)
            await self._end(sess)

        async def recheck() -> bool:
            """The policy tick's question (server.tick_once): may this connection still watch this camera?"""
            try:
                await self._gate(ctx, sess.camera)
                return True
            except Forbidden:
                on_event({"type": "error", "code": "forbidden", "message": f"may no longer view {sess.camera}"})
                return False
        unsubscribe.recheck = recheck              # type: ignore[attr-defined]
        return unsubscribe

    async def candidate(self, ctx: Ctx, msg: dict) -> None:
        from ..ha.readproxy import ReadBlocked
        if set(msg) - {"type", "id", "entity_id", "session_id", "candidate"}:
            raise ReadBlocked("a candidate carries entity_id, session_id and candidate only")
        await self._gate(ctx, msg["entity_id"])
        sess = (ctx.state.get("direct_cam_sessions") or {}).get(msg.get("session_id"))
        if sess is None or sess.camera != msg["entity_id"]:
            raise Forbidden("not a WebRTC session of this connection")
        c = msg.get("candidate")
        text = c.get("candidate") if isinstance(c, dict) else c
        if not isinstance(text, str) or len(text) > 1024:
            raise ReadBlocked("candidate must be an ICE candidate")
        if text and not sess.ended:
            sess.candidates += 1
            await sess.ws.send_json({"type": "webrtc/candidate", "value": text})
        return None

    async def _end(self, sess: CamSession) -> None:
        """Synchronous first (a socket's close may be cancelled midway), as Live TV's."""
        if sess.ended:
            return
        sess.ended = True
        self.sessions.pop(sess.id, None)
        if sess.reader is not None:
            sess.reader.cancel()
        self._log("end", sess)
        if not self._busy(sess.stream):
            self._schedule_stop(sess.stream)
        if sess.ws is not None:
            self.spawn(self._close_ws(sess.ws))

    @staticmethod
    async def _close_ws(ws: Any) -> None:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001 -- already closed
            pass

    async def end_camera(self, entity_id: str) -> None:
        """Every session of one camera ended (the page's card retries, and finds what is there now) and its
        streams removed."""
        for sess in [s for s in self.sessions.values() if s.camera == entity_id]:
            await self._end(sess)
        slug = self._slug_of(entity_id)
        for name in [n for n, s in self.streams.items() if s == slug]:
            await self._drop(name)

    # -- stills -----------------------------------------------------------------------------------------------
    async def still(self, entity_id: str, width: int | None = None, height: int | None = None) -> tuple[bytes, str]:
        """A direct camera's still, after the route's own policy check (camera_still.py): its source's still
        provider, else its own still URL, else go2rtc's frame of its low stream (its high one when it has none).
        camera_still.StillRefused when there is none."""
        from ..connectors.camera_still import StillRefused, read_image
        src = self.serves(entity_id)
        if src is None:
            raise StillRefused(404, "unknown_camera")
        provider = self.still_providers.get(src.source)
        if provider is not None:
            got = await provider(src, width, height)
            if got is not None:
                return got
        secret = self.secret(src.slug)
        if secret is None:
            raise StillRefused(502, "camera_unavailable")
        if secret.still:
            # the camera's own snapshot URL (a login in it is sent as HTTP Basic; never logged)
            return await read_image(self.app, secret.still, {}, None, f"camera still for {entity_id}")
        quality, _ = secret.url("low")             # no snapshot URL: a frame of the sub-stream, else the main one
        name = stream_name(src.slug, quality)
        self._stills_busy[name] = self._stills_busy.get(name, 0) + 1
        try:
            name = await self._ensure(src, quality, entity_id)
            params = {"width": str(width), "height": str(height)} if width and height else {}
            return await self.go2rtc.frame(name, params)
        except (aiohttp.ClientError, asyncio.TimeoutError, Go2rtcError, ConnectionError) as exc:
            log.info("cameras: no still for %s (%s)", src.slug, type(exc).__name__)
            if not isinstance(exc, ConnectionError):
                self._stream_failed(src)
            raise StillRefused(502, "camera_unavailable") from exc
        finally:
            self._stills_busy[name] -= 1
            if not self._stills_busy[name]:
                del self._stills_busy[name]
            if name in self.streams and not self._busy(name):
                self._schedule_stop(name)

    def _stream_failed(self, src: DirectSource) -> None:
        """go2rtc could not play the source: its URL may be stale (Protect's token changes): phase 4 asks again."""
        hook = self.on_stream_failed
        if hook is not None:
            try:
                hook(src)
            except Exception:  # noqa: BLE001 -- the page's error is the same either way
                log.exception("cameras: the stream-failure hook failed")

    # -- streams' lifetime -------------------------------------------------------------------------------------
    def _busy(self, name: str) -> bool:
        return any(s.stream == name for s in self.sessions.values()) or bool(self._stills_busy.get(name))

    def _cancel_stop(self, name: str) -> None:
        h = self._stop_timers.pop(name, None)
        if h is not None:
            h.cancel()

    def _schedule_stop(self, name: str) -> None:
        self._cancel_stop(name)
        loop = asyncio.get_running_loop()
        self._stop_timers[name] = loop.call_later(self.cam_hooks.stop_grace, lambda: self.spawn(self._drop_if_idle(name)))

    async def _drop_if_idle(self, name: str) -> None:
        self._stop_timers.pop(name, None)
        if not self._busy(name):
            await self._drop(name)

    def _proxy_gate(self, name: str, on: bool, camera: str | None = None) -> None:
        """media_proxy's /go2rtc/ gate: a stream Mantel set up is its camera's, decided by that camera's may_view."""
        streams = self.app.get("go2rtc_streams")
        if streams is None:
            return
        if on:
            streams.allow(name, "camera", camera)
        else:
            streams.forget(name)

    async def _drop(self, name: str) -> None:
        self._cancel_stop(name)
        self.streams.pop(name, None)
        self._proxy_gate(name, False)
        await self.go2rtc.drop_stream(name)

    async def reap(self) -> None:
        """Any mantel_cam_* stream in go2rtc that nothing uses (left by a restart or a crash) goes."""
        try:
            got = await self.go2rtc.streams()
        except (aiohttp.ClientError, asyncio.TimeoutError, Go2rtcError) as exc:
            self.error = f"{type(exc).__name__}: {exc}"[:200]
            return
        busy = {n for n in got if self._busy(n)} | set(self._stop_timers) | self.testing
        for name in got:
            if name.startswith(STREAM_PREFIX) and name not in busy:
                await self._drop(name)

    # -- running ----------------------------------------------------------------------------------------------
    def spawn(self, coro: Awaitable[Any]) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def tick(self) -> None:
        self.sync_states()
        # a camera removed, or set aside for Home Assistant's: its sessions end
        for eid in {s.camera for s in self.sessions.values()} - set(self.local.mine) - set(self.aliases):
            await self.end_camera(eid)
        # go2rtc is asked only where there are direct cameras (or streams of theirs): a house without them never
        # touches it from here, as Live TV reaps only while it runs
        if self.sources() or self.streams:
            await self.reap()

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- the next tick tries again
                log.exception("cameras tick failed")
            await asyncio.sleep(self.cam_hooks.tick)

    async def start(self) -> None:
        self.spawn(self._loop())

    async def stop(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        for sess in list(self.sessions.values()):
            sess.ended = True
            if sess.reader is not None:
                sess.reader.cancel()
            if sess.ws is not None:
                await self._close_ws(sess.ws)
        self.sessions.clear()
        for h in self._stop_timers.values():
            h.cancel()
        for name in list(self.streams):
            self._proxy_gate(name, False)
            await self.go2rtc.drop_stream(name)
        await self.go2rtc.close()

    def _log(self, what: str, sess: CamSession) -> None:
        self.log.append({"event": what, "camera": sess.camera, "session": sess.id[:8], "at": round(time.time(), 1)})
        del self.log[:-50]

    def status(self) -> dict[str, Any]:
        """For GET /api/cameras/direct (Owner/Admin): never a URL, a token or go2rtc's address."""
        out = []
        for s in self.sources():
            state = "matched" if s.slug in self.matched else \
                "conflict" if s.entity_id in self.conflicts else \
                "unreadable" if s.slug in self.unreadable else \
                "ok" if s.entity_id in self.local.mine else "off"
            out.append({**s.public(), "entity_id": s.entity_id, "state": state,
                        "conflict": self.conflicts.get(s.entity_id), "matched": self.matched.get(s.slug),
                        "video_direct": s.slug in self.aliases.values(),
                        "sessions": sum(1 for x in self.sessions.values() if self._slug_of(x.camera) == s.slug)})
        return {"runs": True, "cameras": out, "streams": sorted(self.streams), "error": self.error,
                "log": list(self.log[-20:])}


# ------------------------------------------------------------------------------------- registration
ROUTE_RULES: dict[str, str] = {
    CONFIG: "a direct camera (camera.mantel_*): may_view, as for any camera; any other camera: Live TV's, then the camera connector",
    OFFER: "a direct camera: may_view, then Mantel's go2rtc; any other camera: Live TV's, then the camera connector",
    CANDIDATE: "a direct camera: only into a session of this connection; any other: Live TV's, then the camera connector",
}


def register(app: web.Application, hub: Any, hooks: Any = None, cam_hooks: DirectHooks | None = None) -> DirectCameras | None:
    """Install ``app["cameras_direct"]`` where Mantel has its own go2rtc: the direct cameras' signaling (wrapping
    the routes already there: Live TV's wrapper of the camera connector's), the status route and the hub callbacks.
    Without go2rtc (the HA App) nothing is installed and None is returned."""
    if "cameras_direct" in app:
        return app["cameras_direct"]
    if not go2rtc_api_url(app.get("cfg")):
        return None
    hooks = Hooks.coerce(hooks)
    cams = DirectCameras(app, hub, hooks, cam_hooks)
    app["cameras_direct"] = cams

    def links_changed() -> None:
        """The linked sensors changed (phase 6): the notifications work out what they watch again (they read the
        links through the House port, features/host.py ``_camera_links``)."""
        feats = app.get("features")
        if feats is not None:
            feats.notifier.refresh()
    cams.on_links = links_changed
    routes = read_routes(app)
    base = {t: routes.get(t) for t in (CONFIG, OFFER, CANDIDATE)}

    def request_route(t: str, ours: Callable[[Ctx, dict], Awaitable[Any]]):
        async def handler(ctx: Ctx, msg: dict):
            if cams.ours(msg):
                return await ours(ctx, msg)
            b = base.get(t)
            if b is None or b.request is None:
                raise ConnectionError("unavailable")
            return await b.request(ctx, msg)
        return handler

    async def offer(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        msg, quality = split_quality(msg)          # the page's stream hint: ours to use, nobody else's to see
        if cams.ours(msg):
            return await cams.offer(ctx, msg, on_event, quality)
        b = base.get(OFFER)
        if b is None or b.subscribe is None:
            raise ConnectionError("unavailable")
        return await b.subscribe(ctx, msg, on_event)

    routes.update({
        CONFIG: Route(request=request_route(CONFIG, cams.client_config)),
        CANDIDATE: Route(request=request_route(CANDIDATE, cams.candidate)),
        OFFER: Route(subscribe=offer),
    })

    @guard("manager", reads="admin")
    async def api_status(request: web.Request) -> web.Response:
        return web.json_response(cams.status())

    app.router.add_get("/api/cameras/direct", api_status)

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            try:
                cams.on_change(set(changed))
            except Exception:  # noqa: BLE001 -- never break the hub's own callback
                log.exception("cameras: a state change failed")

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            try:
                cams.on_registry()
            except Exception:  # noqa: BLE001
                log.exception("cameras: a registry reload failed")
        ha.on_change, ha.on_registry = on_change, on_registry

    async def start(_app: web.Application) -> None:
        try:
            cams.sync_states()
        except Exception:  # noqa: BLE001 -- the tick tries again
            log.exception("cameras: the first sync failed")
        await cams.start()

    async def stop(_app: web.Application) -> None:
        await cams.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return cams
