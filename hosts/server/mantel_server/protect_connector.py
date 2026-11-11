"""THE UNIFI PROTECT CONNECTOR (docs/phase13/CAMERAS-DIRECT.md, phase 4, and phase 5's wiring of direct talk).

Where Mantel runs on Docker or an LXC with its own go2rtc (cameras_direct.py is installed), Mantel Settings ->
Connections -> UniFi Protect connects Mantel to the console itself, with one API key, and from then on the console's
cameras, their stills, their detections and the doorbell's speaker come straight from it. Under the HA App nothing
is installed but the status route, which says that cameras come from Home Assistant's UniFi Protect integration
(the plan's "Where it runs", decision 1).

This module is the glue between three things that already exist: protect_api.py (the console's public API, the
pin, the errors), cameras_direct.py (camera sources, go2rtc, stills, RBAC by entity id) and the notifications engine
(hk_core/notifications, features/notify.py). Nothing here decides who may see a camera: every camera surface asks
authz by the camera's entity id, as before.

* **Signing in** (decision 7). The console's address and an API key, required; under Advanced, off by default, a
  LOCAL UniFi OS user and password, kept sealed and used by nothing yet (cloud accounts and MFA can't be used). One
  sealed file, ``<data_dir>/connections/protect.connection`` (connections.SealedFiles, AES-GCM with the at-rest key,
  associated data ``connection:protect``, in every encrypted backup), beside Home Assistant's and Music Assistant's.
  The key is only ever *used*: never in a response, a status, a log line, an audit row or an exception message.
  Only an Owner connects, replaces, trusts or disconnects (connections.edit_rule's door and fresh-factor rules); each
  is audited before it applies.
* **Connect's checks**, in order, each failure saying what to fix (protect_api's errors, by ``kind``): the address
  answers as a UniFi OS console running Protect (asked WITHOUT the key), the certificate is pinned (learned on the
  first connect; held to afterwards, in the TLS handshake), the key works, Protect is 7.2.105 or later.
* **Trust.** The SHA-256 fingerprint is shown. A changed certificate stops the connection (requests and the events
  socket alike) and says so; an Owner may trust the new one, by its fingerprint, explicitly (``POST
  /api/protect/trust``, audited ``connection.protect.certificate_trusted``), and only if it is the one the console
  presents now.
* **Cameras.** ``GET /api/protect/cameras`` lists the console's cameras with their stills (``.../still``, through
  Mantel: Owner and Admin, like the list). Picking one (``PUT /api/protect/cameras/<id>`` ``{use: true}``) asks
  Protect for its RTSPS streams (high and low; Protect makes the ones missing) and puts the source in
  cameras_direct (``slug`` from its name, its area, its speaker, its detections); un-picking removes it. Every
  REFRESH_S and on Connect the console's list is read again: a camera renamed follows, one gone is removed, a stream
  token that changed is taken (and asked again at once when go2rtc fails to play a source, at most every
  TOKEN_RETRY_S). The refresh only READS (``rtsps_streams(create=False)``).
* **Stills** of a Protect source come from Protect's own snapshot (``set_still_provider("protect")``),
  ``highQuality`` when the page asks for one wider than LARGE; one fetch per camera and quality is shared for
  STILL_SHARE_S between every tablet, and the client paces under the console's 10 a second.
* **The same camera twice** (decision 2). Home Assistant's unifiprotect devices carry the camera's MAC as a
  ``connections`` pair (the house's console, 2026-11-02: ``[["mac", "f4:e2:..."]]``, and no identifiers); a picked
  camera whose MAC (or id) a device carries is MATCHED to that device's camera entity (the best channel). It shows
  ONCE, as Home Assistant's entity, with HA's name and area (cameras_direct.set_matches: no ``camera.mantel_*``).
  Its **Video From** (house document ``protect``) is Direct by default: HA's entity id then plays and stills from
  the direct source (cameras_direct.serves), decided by HA's entity's own RBAC, unchanged; Home Assistant puts it
  back on HA's path. An unmatched camera is ``camera.mantel_<slug>``.
* **Events** (one EventStream per connector, with its own reconnect and backoff) become Mantel's notifications by
  the rules HA's entities have:

  - an UNMATCHED camera gets Mantel's own detection sensors on its device (``mantel_cam_<slug>``, in an overlay of
    its own: ``binary_sensor.mantel_<slug>_person_detected``, ``..._vehicle_detected``, ``..._animal_detected``,
    ``..._package_detected``, ``binary_sensor.mantel_<slug>_motion`` and, for a doorbell,
    ``event.mantel_<slug>_doorbell``), whose names and device classes are what rules.kind_of already reads. They
    change in the hub like any entity, so the Notifications settings' categories (Doorbells' pop-up, Packages,
    Cameras), Live Camera Follows' motion and the room's sensors work as for Home Assistant's;
  - a MATCHED camera's events stand for HA's own entities of the same kind on that device (``Notifier.inject``),
    while the direct source is preferred: Video From Direct AND the events socket up. HA's own change of those
    entities is then held back (``takes``), so one ring is one notification; otherwise HA's entities speak, as
    before. A detection that never ends is turned off after ACTIVE_MAX_S.
* **Notify For** (each camera's page): the camera's own types (``Camera.kinds``: the ring, its smart types) or
  Motion for a camera without smart detection; the ones left out never notify, whichever source they came from.
  A supported type that is off in Protect offers **Turn On in Protect** (decision 4: ``set_smart_types(merge=True)``,
  that camera only, Owner or Admin, audited ``protect.camera.smart_types_on``). Zones, sensitivity and masks stay
  in Protect's app.
* **Direct talk** (phase 5's wiring): ``app["direct_talk"]`` (talk_direct.DirectTalk) is created here, and its
  speakers kept current: a picked doorbell with a speaker is Home Assistant's speaker entity of the matched device,
  else Mantel's own ``media_player.mantel_<slug>_speaker`` (in the overlay, on the camera's device and area). HK's
  doorbell pop-up names it as any speaker (authz.talk_speakers reads the pop-up), and ``camera.talk`` decides as
  before; the session is the console's talkback session.

2026-11-02: built from the plan with the house's console's real answers (protect_api.py's notes). Two choices of
detail: matching is by MAC (what HA's device registry really carries), and the events of a matched camera are
injected under HA's own entity ids rather than mirrored into new ones, so a notification an Owner set up on HA's
entity keeps working with no change.

Wiring (server.wire, after cameras_direct.register and features.register)::

    protect_connector.register(app, hub)
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Mapping

import aiohttp
from aiohttp import web

from hk_core.house import State
from hk_core.notifications import rules as NR
from hk_core.talk.core import Target

from . import audit
from . import cameras_direct as D
from . import connections as C
from . import protect_api as pa
from .identity.accounts import read_json
from .identity.guards import guard
from .identity.guards import ident as guarded
from .live_tv import LocalEntities
from .identity.sessions import error, ok
from .talk_direct import DirectTalk, Speaker

log = logging.getLogger("mantel.protect")

KIND = "protect"                     # connections/protect.connection
DOC = "protect"                      # house/protect: each camera's Video From and Notify For
FLAG = "mantel_protect"              # this overlay's registry entries (LocalEntities' flag)
PLATFORM = "mantel_protect"
API = "/api/protect"
REFRESH_S = 300.0                    # the console's camera list read again (the plan: at least five minutes)
TOKEN_RETRY_S = 60.0                 # a failing stream's token asked again at most this often, per camera
ACTIVE_MAX_S = 120.0                 # a detection whose end never came is off after this
STILL_SHARE_S = 2.0
LARGE = 960                          # a still wider than this asks Protect for its full-resolution one
NOTIFY_KINDS = ("ring", "person", "vehicle", "animal", "package", "motion")
SMART = ("person", "vehicle", "animal", "package")
VIDEO_FROM = ("direct", "ha")
MAX_HOST = 255
LOG_KEEP = 50
SUFFIX = {"person": "person_detected", "vehicle": "vehicle_detected", "animal": "animal_detected",
          "package": "package_detected", "motion": "motion"}
WORDS = {"person": "Person detected", "vehicle": "Vehicle detected", "animal": "Animal detected",
         "package": "Package detected", "motion": "Motion", "ring": "Doorbell"}


# ------------------------------------------------------------------------------------- what is kept
@dataclass
class ProtectRecord:
    """The sealed connection (connections.SealedFiles' record). ``repr`` shows neither the key nor the password."""
    kind: str
    host: str
    api_key: str = field(repr=False)
    pin: str | None
    since: float
    by: str | None = None
    by_name: str | None = None
    console_name: str | None = None
    version: str | None = None
    username: str | None = None                       # Advanced: a local UniFi OS user, used by nothing yet
    password: str | None = field(default=None, repr=False)

    def public(self) -> dict[str, Any]:
        return {"host": self.host, "fingerprint": self.pin, "since": self.since, "by_name": self.by_name,
                "console_name": self.console_name, "version": self.version, "local_user": self.username,
                "signin": "api_key_and_local_user" if self.username else "api_key"}


def det_entity(slug: str, kind: str) -> str:
    """Mantel's own detection entity of a direct camera, named so rules.kind_of reads its kind."""
    if kind == "ring":
        return f"event.mantel_{slug}_doorbell"
    return f"binary_sensor.mantel_{slug}_{SUFFIX[kind]}"


def speaker_entity(slug: str) -> str:
    return f"media_player.mantel_{slug}_speaker"


def slug_from(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:40].strip("_")
    return s or "camera"


def norm_mac(value: Any) -> str:
    return re.sub(r"[^0-9a-f]", "", str(value or "").lower())


def iso_ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds")


def kinds_of(cam: pa.Camera) -> tuple[str, ...]:
    """What Notify For lists for a camera: its own kinds (the ring, its smart types, or motion), Mantel's words."""
    return tuple(k for k in cam.kinds if k in NOTIFY_KINDS)


def kinds_on(cam: pa.Camera) -> tuple[str, ...]:
    return tuple(k for k in cam.kinds_on if k in NOTIFY_KINDS)


def detection_kind(entity_id: str, device_class: Any) -> str | None:
    """Which direct kind one of Home Assistant's entities stands for (None: none). The same reading of names and
    device classes the notifications engine makes (rules.kind_of), plus Protect's motion event entity."""
    domain, _, oid = entity_id.partition(".")
    if domain not in ("binary_sensor", "event"):
        return None
    k = NR.kind_of(domain, device_class if isinstance(device_class, str) else None, oid)
    if k == "doorbell":
        return "ring"
    if k in SMART:
        return k
    if k == "motion" or (domain == "event" and "motion" in oid):
        return "motion"
    return None


# ------------------------------------------------------------------------------------- the match (decision 2)
@dataclass(frozen=True)
class Match:
    """A Protect camera that Home Assistant has too: its device, its camera entity (the best channel), its speaker,
    and its entities of each direct kind; ``cameras``, every camera entity of the device (each channel), best first."""
    device_id: str
    camera: str
    speaker: str | None
    kinds: Mapping[str, tuple[str, ...]]
    cameras: tuple[str, ...] = ()


def _rank(e: Mapping[str, Any]) -> tuple:
    eid = e["entity_id"]
    return (e.get("platform") != "unifiprotect", bool(e.get("hidden_by")),
            0 if "high" in eid else 3 if "package" in eid else 2 if "low" in eid else 1, eid)


def match_cameras(cams: Iterable[pa.Camera], registry: Any, states: Mapping[str, Any]) -> dict[str, Match]:
    """{protect id: Match} for each camera a device in Home Assistant's registry carries (its MAC in the device's
    ``connections`` or ``identifiers``, or its Protect id there) and that has a camera entity."""
    devices = [d for d in (getattr(registry, "device_entries", None) or []) if isinstance(d, Mapping)
               and d.get("id") and not d.get("disabled_by")]
    by_dev: dict[str, list[Mapping[str, Any]]] = {}
    for e in getattr(registry, "entity_entries", None) or []:
        if isinstance(e, Mapping) and e.get("device_id") and not e.get("disabled_by"):
            by_dev.setdefault(e["device_id"], []).append(e)
    out: dict[str, Match] = {}
    for cam in cams:
        mac = norm_mac(cam.mac)
        for d in devices:
            pairs = [p for p in list(d.get("connections") or []) + list(d.get("identifiers") or [])
                     if isinstance(p, (list, tuple)) and len(p) == 2]
            if not any((mac and len(mac) == 12 and norm_mac(p[1]) == mac) or str(p[1]) == cam.id for p in pairs):
                continue
            ents = by_dev.get(d["id"], [])
            camera_ents = sorted((e for e in ents if e["entity_id"].startswith("camera.")), key=_rank)
            if not camera_ents:
                continue
            speakers = sorted((e["entity_id"] for e in ents if e["entity_id"].startswith("media_player.")),
                              key=lambda x: ("speaker" not in x, x))
            out[cam.id] = Match(d["id"], camera_ents[0]["entity_id"], speakers[0] if speakers else None,
                                _kinds(ents, states), tuple(e["entity_id"] for e in camera_ents))
            break
    return out


def _kinds(ents: Iterable[Mapping[str, Any]], states: Mapping[str, Any]) -> dict[str, tuple[str, ...]]:
    kinds: dict[str, list[str]] = {}
    for e in ents:
        eid = e["entity_id"]
        st = states.get(eid) or {}
        dc = (st.get("a") or {}).get("device_class") or e.get("device_class") or e.get("original_device_class")
        k = detection_kind(eid, dc)
        if k is not None:
            kinds.setdefault(k, []).append(eid)
    return {k: tuple(sorted(v)) for k, v in kinds.items()}


def camera_less_detections(cams: Iterable[pa.Camera], registry: Any, states: Mapping[str, Any],
                           matched: Mapping[str, Match]) -> dict[str, dict[str, tuple[str, ...]]]:
    """{protect id: {kind: Home Assistant's entities}} for a camera whose device Home Assistant has but whose camera
    entities are all turned off there (the house's indoor cameras, 2026-11-02: Loft, Office, Living Room, Crawl Space
    and Kitchen), while its detection sensors are still on. Picked in Mantel such a camera is Mantel's own
    (``camera.mantel_*``, with Mantel's detection entities), so without this both its sensors and Home Assistant's
    would notify each event: Home Assistant's are held back while Mantel's events socket is up (``takes``)."""
    devices = [d for d in (getattr(registry, "device_entries", None) or []) if isinstance(d, Mapping)
               and d.get("id") and not d.get("disabled_by")]
    by_dev: dict[str, list[Mapping[str, Any]]] = {}
    for e in getattr(registry, "entity_entries", None) or []:
        if isinstance(e, Mapping) and e.get("device_id") and not e.get("disabled_by"):
            by_dev.setdefault(e["device_id"], []).append(e)
    out: dict[str, dict[str, tuple[str, ...]]] = {}
    for cam in cams:
        if cam.id in matched:
            continue
        mac = norm_mac(cam.mac)
        for d in devices:
            pairs = [p for p in list(d.get("connections") or []) + list(d.get("identifiers") or [])
                     if isinstance(p, (list, tuple)) and len(p) == 2]
            if not any((mac and len(mac) == 12 and norm_mac(p[1]) == mac) or str(p[1]) == cam.id for p in pairs):
                continue
            kinds = _kinds(by_dev.get(d["id"], []), states)
            if kinds:
                out[cam.id] = kinds
                break
    return out


# ------------------------------------------------------------------------------------- the connector
class ProtectConnector:
    """``app["protect"]``: see the module docstring."""

    def __init__(self, app: web.Application, hub: Any, cams: D.DirectCameras,
                 clock: Callable[[], float] = time.time) -> None:
        self.app, self.hub, self.cams, self.clock = app, hub, cams, clock
        self.files = C.SealedFiles(app["cfg"].connections_dir, cams._files().box, ProtectRecord)
        self.record: ProtectRecord | None = None
        self.unreadable: str | None = None
        try:
            self.record = self.files.load(KIND)
        except Exception as exc:  # noqa: BLE001 -- another at-rest key, a damaged file: say so, never the contents
            self.unreadable = type(exc).__name__
            log.error("protect: the saved UniFi Protect connection does not open (%s); connect it again", self.unreadable)
        self.client: pa.ProtectClient | None = None
        self.stream: pa.EventStream | None = None
        self.cameras: dict[str, pa.Camera] = {}
        self.matches: dict[str, Match] = {}
        self.error: str | None = None
        self.error_kind: str | None = None
        self.seen_fingerprint: str | None = None             # a changed certificate's, for the Owner to compare
        self.last_refresh: float | None = None
        self.local = LocalEntities(hub, clock, flag=FLAG)
        self._det: dict[str, str] = {}                        # Mantel's detection entity -> its state now
        self._active: dict[str, dict[str, float]] = {}        # its open events -> when they lapse (monotonic)
        self._takes: dict[str, tuple[str, str, bool]] = {}    # entity -> (protect id, kind, Mantel's own)
        self._token_asked: dict[str, float] = {}
        self._stills: dict[tuple[str, bool], tuple[float, tuple[bytes, str]]] = {}
        self._still_wait: dict[tuple[str, bool], asyncio.Future] = {}
        self._tasks: set[asyncio.Task] = set()
        self._run: asyncio.Task | None = None
        self.events_log: deque = deque(maxlen=LOG_KEEP)
        self.talk = DirectTalk()
        # every event of a picked camera, before what notifies is decided (the House Timeline records what happened,
        # not what was notified)
        self.listeners: list[Callable[[pa.ProtectEvent], None]] = []

    # -- small reads ----------------------------------------------------------------------------------------
    def _store(self) -> Any:
        return self.app["settings"].store

    def settings(self) -> dict[str, dict[str, Any]]:
        body = self._store().body("house", DOC) or {}
        cams = body.get("cameras")
        return {k: dict(v) for k, v in cams.items() if isinstance(v, dict)} if isinstance(cams, dict) else {}

    def _write_settings(self, cams: Mapping[str, Any], actor: Any, message: str) -> None:
        self._store().write([("house", DOC, {"cameras": dict(cams)})], actor=actor, action="set", message=message)

    def picked(self) -> dict[str, D.DirectSource]:
        return {s.protect_id: s for s in self.cams.sources() if s.source == "protect" and s.protect_id}

    def video_from(self, pid: str) -> str:
        v = self.settings().get(pid, {}).get("video_from")
        return v if v in VIDEO_FROM else "direct"

    def available(self, pid: str) -> tuple[str, ...]:
        cam = self.cameras.get(pid)
        if cam is not None:
            return kinds_of(cam)
        src = self.picked().get(pid)
        return tuple(k for k in NOTIFY_KINDS if src is not None and k in src.detections and k != "motion") or ("motion",)

    def notify_for(self, pid: str) -> tuple[str, ...]:
        have = self.available(pid)
        chosen = self.settings().get(pid, {}).get("notify")
        if not isinstance(chosen, list):
            return have
        return tuple(k for k in have if k in chosen)

    @property
    def connected(self) -> bool:
        return self.stream is not None and self.stream.connected

    def direct_preferred(self, pid: str) -> bool:
        return self.video_from(pid) == "direct" and self.connected

    def _actor(self, ident: Any = None) -> Any:
        from .settings_store import Actor
        user = getattr(ident, "user", None)
        return Actor(user_id=user.id, role=user.role, label="protect") if user is not None else Actor(label="protect")

    # -- the notifications engine's question --------------------------------------------------------------------
    def takes(self, entity_id: str) -> bool:
        """Should the Notifier hold back this entity's own change? Mantel's detection entities: when Notify For
        leaves their kind out. Home Assistant's entities of a matched camera: the same, and also while the direct
        source is preferred (then the direct event speaks for them: ``Notifier.inject``)."""
        t = self._takes.get(entity_id)
        if t is None:
            return False
        pid, kind, mine = t
        if mine is None:
            # Home Assistant's sensor of a camera Mantel has as its own (camera_less_detections): Mantel's own
            # detection entity speaks for it while the events socket is up; if it is down, Home Assistant's does
            return kind in self.available(pid) and self.connected
        if kind not in self.available(pid):
            # not one Notify For offers (the motion of a camera with smart detection): left as it was, so a
            # notification someone set up on Home Assistant's motion sensor keeps working, and nothing is injected
            return False
        if kind not in self.notify_for(pid):
            return True
        return not mine and self.direct_preferred(pid)

    # -- the match, the overlay, the speakers: worked out again whenever any input changes ------------------------
    def recompute(self) -> None:
        picked = self.picked()
        reg = getattr(self.hub, "registry", None)
        self.matches = match_cameras(list(self.cameras.values()), reg, self.hub.store.states) if reg is not None else {}
        matched = {src.slug: self.matches[pid].camera for pid, src in picked.items() if pid in self.matches}
        # EVERY CHANNEL (2026-11-07, the owner: the camera feeds went away with a Home Assistant restart): the tiles
        # name HA's low-resolution channel, so only the best one direct left them on Home Assistant's video
        aliases = {eid: src.slug for pid, src in picked.items() if pid in self.matches and self.video_from(pid) == "direct"
                   for eid in (self.matches[pid].cameras or (self.matches[pid].camera,))}
        self.cams.set_matches(matched, aliases)
        takes: dict[str, tuple[str, str, bool | None]] = {}
        for pid, m in self.matches.items():
            if pid in picked:
                for kind, eids in m.kinds.items():
                    for eid in eids:
                        takes[eid] = (pid, kind, False)
        if reg is not None:
            # Home Assistant's sensors of a picked camera whose HA camera is turned off (None: see takes)
            for pid, kinds in camera_less_detections(list(self.cameras.values()), reg, self.hub.store.states,
                                                     self.matches).items():
                if pid in picked:
                    for kind, eids in kinds.items():
                        for eid in eids:
                            takes[eid] = (pid, kind, None)
        changed = self._sync_overlay(picked, takes)
        self._takes = takes
        self._sync_speakers(picked)
        if changed:
            self._changed(changed)

    def _ha_has(self, entity_id: str) -> bool:
        reg = getattr(self.hub, "registry", None)
        entry = (getattr(reg, "entries", None) or {}).get(entity_id)
        st = self.hub.store.states.get(entity_id)
        return (entry is not None and not entry.get(FLAG)) or (st is not None and st is not self.local.mine.get(entity_id))

    def _sync_overlay(self, picked: Mapping[str, D.DirectSource], takes: dict[str, tuple[str, str, bool]]) -> set[str]:
        want: dict[str, tuple[Any, dict[str, Any]]] = {}
        entries: dict[str, dict[str, Any]] = {}
        for pid, src in picked.items():
            if src.slug in self.cams.matched:
                continue
            dev = D.device_of(src.slug)
            kinds = [k for k in NOTIFY_KINDS if k in src.detections and k != "motion"] + ["motion"]
            for kind in kinds:
                eid = det_entity(src.slug, kind)
                if eid in self.local.mine or not self._ha_has(eid):
                    if kind == "ring":
                        attrs = {"friendly_name": f"{src.name} {WORDS[kind]}", "device_class": "doorbell",
                                 "event_types": ["ring"], "event_type": "ring" if eid in self._det else None}
                        state = self._det.get(eid, "unknown")
                    else:
                        attrs = {"friendly_name": f"{src.name} {WORDS[kind]}",
                                 "device_class": "motion" if kind == "motion" else "occupancy"}
                        state = self._det.get(eid, "off")
                    want[eid] = (state, attrs)
                    entries[eid] = self._entry(eid, src, dev)
                    takes[eid] = (pid, kind, True)
            if src.speaker:
                eid = speaker_entity(src.slug)
                if eid in self.local.mine or not self._ha_has(eid):
                    want[eid] = ("idle", {"friendly_name": f"{src.name} Speaker", "device_class": "speaker",
                                          "supported_features": 0, "mantel_source": "protect"})
                    entries[eid] = self._entry(eid, src, dev)
        for eid in list(self._det):
            if eid not in want:
                self._det.pop(eid, None)
                self._active.pop(eid, None)
        changed = self.local.put_all(want)
        self.local.registry = entries
        registry = getattr(self.hub, "registry", None)
        if registry is not None:
            merged = self.local.merged_entities(list(registry.entity_entries))
            if merged is not None:
                registry.update(entities=merged)
                self.hub.on_registry()
        return changed

    @staticmethod
    def _entry(eid: str, src: D.DirectSource, dev: str) -> dict[str, Any]:
        return {"entity_id": eid, "platform": PLATFORM, "device_id": dev, "area_id": src.area_id, "name": None,
                "original_name": None, FLAG: True}

    def _changed(self, changed: set[str]) -> None:
        """Mantel's own entities changed: through the same chain Home Assistant's changes take (the pages, the
        features' notifications and Sleep Screen, the overlays), not only to the pages."""
        ha = getattr(self.hub, "ha", None)
        (ha.on_change if ha is not None and getattr(ha, "on_change", None) else self.hub.on_change)(set(changed))

    def _sync_speakers(self, picked: Mapping[str, D.DirectSource]) -> None:
        speakers = {}
        for pid, src in picked.items():
            cam = self.cameras.get(pid)
            if not src.speaker or (cam is not None and not cam.has_speaker):
                continue
            m = self.matches.get(pid) if src.slug in self.cams.matched else None
            sid = m.speaker if m is not None else (speaker_entity(src.slug) if speaker_entity(src.slug) in self.local.mine else None)
            if sid:
                speakers[sid] = Speaker(pid, self._talk_session)
        self.talk.set_speakers(speakers)

    async def _talk_session(self, camera_id: str) -> Target:
        client = self.client
        if client is None:
            raise ConnectionError("UniFi Protect is not connected")
        t = await client.talkback_session(camera_id)
        return Target(t.url, t.codec, t.sampling_rate)

    # -- hub callbacks -------------------------------------------------------------------------------------------
    def on_change(self, changed: set[str]) -> None:
        back = self.local.reassert(set(changed))
        if back:
            self.hub.on_change(back)

    def on_registry(self) -> None:
        if self.local.registry or self.picked():
            self.recompute()

    # -- events -------------------------------------------------------------------------------------------------
    def speaks_for(self, entity_id: str) -> bool:
        """Is this one of Home Assistant's detection entities of a camera whose events Mantel takes from Protect
        itself now (Video From Direct and the events socket up)? Then Protect's event is the record and Home
        Assistant's own change of the entity isn't (the House Timeline: one detection is one row, never two). Unlike
        ``takes`` it doesn't depend on Notify For."""
        t = self._takes.get(entity_id)
        if t is None:
            return False
        pid, _kind, mine = t
        if mine:
            return True
        if mine is None:
            return self.connected
        return self.direct_preferred(pid)

    def on_event(self, ev: pa.ProtectEvent) -> None:
        if ev.kind not in NOTIFY_KINDS:
            return
        src = self.picked().get(ev.camera_id)
        if src is None:
            return
        for cb in self.listeners:
            try:
                cb(ev)
            except Exception:  # noqa: BLE001 -- a listener never stops the notifications
                log.exception("protect: an event listener failed (%s)", ev.kind)
        self.events_log.append({"at": round(self.clock(), 1), "camera": src.slug, "kind": ev.kind, "active": ev.active})
        m = self.matches.get(ev.camera_id) if src.slug in self.cams.matched else None
        if m is not None:
            if self.direct_preferred(ev.camera_id) and ev.kind in self.notify_for(ev.camera_id):
                for eid in m.kinds.get(ev.kind, ()):
                    self._inject(eid, ev)
            return
        eid = det_entity(src.slug, ev.kind)
        if eid not in self.local.mine:
            return
        if ev.kind == "ring":
            self._det[eid] = iso_ms(ev.start)
        else:
            opened = self._active.setdefault(eid, {})
            if ev.active:
                opened[ev.event_id] = time.monotonic() + ACTIVE_MAX_S
                self._later(ACTIVE_MAX_S + 0.5, self._lapse)
            else:
                opened.pop(ev.event_id, None)
            self._det[eid] = "on" if opened else "off"
        self._refresh_overlay()

    def _lapse(self) -> None:
        now, moved = time.monotonic(), False
        for eid, opened in self._active.items():
            for key in [k for k, t in opened.items() if t <= now]:
                del opened[key]
                moved = True
            if not opened and self._det.get(eid) == "on":
                self._det[eid] = "off"
        if moved:
            self._refresh_overlay()

    def _refresh_overlay(self) -> None:
        """Only Mantel's own entities' states (an event): the match and the speakers are as they were."""
        takes = {k: v for k, v in self._takes.items() if not v[2]}
        changed = self._sync_overlay(self.picked(), takes)
        self._takes = takes
        if changed:
            self._changed(changed)

    def _later(self, delay: float, fn: Callable[[], None]) -> None:
        try:
            asyncio.get_running_loop().call_later(delay, fn)
        except RuntimeError:
            pass

    def _inject(self, eid: str, ev: pa.ProtectEvent) -> None:
        """A matched camera's event as the change of Home Assistant's own entity ``eid`` (features/notify.py)."""
        host = self.app.get("features")
        notifier = getattr(host, "notifier", None)
        if notifier is None:
            return
        cur = host.house.state(eid)
        attrs = dict(cur.attributes) if cur is not None else {}
        now = datetime.now(timezone.utc)
        if eid.startswith("event."):
            if not ev.active:
                return
            old = cur if cur is not None else State(eid, "unknown", attrs, None)
            new = State(eid, iso_ms(ev.start), {**attrs, "event_type": "ring" if ev.kind == "ring" else ev.kind}, now)
        elif ev.active:
            old, new = State(eid, "off", attrs, None), State(eid, "on", attrs, now)
        elif ev.kind == "ring":
            return
        else:
            old, new = State(eid, "on", attrs, None), State(eid, "off", attrs, now)
        try:
            notifier.inject(eid, old, new)
        except Exception:  # noqa: BLE001 -- a notification's bug never stops the events
            log.exception("protect: notifying %s failed", eid)

    async def _events(self, client: pa.ProtectClient) -> None:
        stream = self.stream = pa.EventStream(client)
        try:
            async for ev in stream.events():
                self.on_event(ev)
        except (pa.CertificateChanged, pa.KeyRefused) as err:
            self.error, self.error_kind = str(err), err.kind
            if isinstance(err, pa.CertificateChanged):
                self.seen_fingerprint = err.seen or None
            log.warning("protect: the events socket stopped: %s", err.kind)

    # -- the console's list, kept in sync --------------------------------------------------------------------
    async def refresh(self) -> None:
        client = self.client
        if client is None:
            return
        try:
            cams = await client.cameras()
        except pa.ProtectError as err:
            self.error, self.error_kind = str(err), err.kind
            if isinstance(err, pa.CertificateChanged):
                self.seen_fingerprint = err.seen or None
            return
        self.cameras = {c.id: c for c in cams}
        self.last_refresh = self.clock()
        if self.error_kind not in ("certificate_changed", "key_refused"):
            self.error = self.error_kind = None
        for pid, src in self.picked().items():
            cam = self.cameras.get(pid)
            if cam is None:
                log.info("protect: camera %s is gone from the console; removed", src.slug)
                await self.cams.remove(src.slug)
                continue
            await self._follow(src, cam, client)
        self.recompute()

    def _source(self, src: D.DirectSource, cam: pa.Camera, streams: Mapping[str, str] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"slug": src.slug, "name": cam.name or src.name, "area_id": src.area_id, "source": "protect",
                                "protect_id": cam.id, "speaker": cam.has_speaker,
                                "detections": [k for k in D.DETECTIONS if k in kinds_of(cam) or k == "motion"]}
        if streams is not None:
            body["streams"] = {q: (str(streams[q]) if streams.get(q) else None) for q in ("low", "medium")}
            body["streams"]["high"] = str(streams["high"])   # tiles play low (or medium), pop-ups high (2026-11-02)
        return body

    async def _follow(self, src: D.DirectSource, cam: pa.Camera, client: pa.ProtectClient) -> None:
        """A picked camera as the console has it now: its name, its speaker, its detections and its stream token."""
        streams = None
        try:
            got = await client.rtsps_streams(cam.id, create=False)
            have = self.cams.secret(src.slug)
            now = tuple(str(got[q]) if got.get(q) else None for q in ("high", "medium", "low"))
            if got.get("high") and (have is None or now != (have.high, have.medium, have.low)):
                streams = got
        except pa.ProtectError as err:
            log.info("protect: the streams of %s were not read (%s)", src.slug, err.kind)
        body = self._source(src, cam, streams)
        same = (body["name"], body["speaker"], tuple(body["detections"])) == (src.name, src.speaker, src.detections)
        if streams is None and same:
            return
        try:
            await self.cams.put(body)
        except D.SourceError as err:
            log.warning("protect: %s was not updated (%s)", src.slug, err.field)

    def on_stream_failed(self, src: D.DirectSource) -> None:
        if src.source != "protect" or not src.protect_id or self.client is None:
            return
        now = time.monotonic()
        if now - self._token_asked.get(src.slug, -1e9) < TOKEN_RETRY_S:
            return
        self._token_asked[src.slug] = now
        cam = self.cameras.get(src.protect_id)
        if cam is not None:
            self.spawn(self._follow(src, cam, self.client))

    # -- picking ------------------------------------------------------------------------------------------------
    async def pick(self, pid: str, area_id: str | None, actor: Any) -> D.DirectSource:
        client = self._need()
        cam = await client.camera(pid)
        streams = await client.rtsps_streams(pid, create=True, qualities=("high", "medium", "low"))
        if not streams.get("high"):
            raise pa.ProtectApiError(200, "the camera has no high-quality stream")
        taken = {s.slug for s in self.cams.sources()}
        base = slug_from(cam.name)
        for n in range(1, 50):
            slug = base if n == 1 else f"{base[:37]}_{n}"
            if slug in taken:
                continue
            body = self._source(D.DirectSource(slug=slug, name=cam.name or slug, source="protect", area_id=area_id),
                                cam, streams)
            try:
                src = await self.cams.put(body, actor=actor)
            except D.CameraConflict:
                continue
            self.cameras[pid] = cam
            self.recompute()
            return src
        raise D.SourceError("slug", "no free name for this camera")

    async def unpick(self, pid: str, actor: Any) -> bool:
        src = self.picked().get(pid)
        if src is None:
            return False
        await self.cams.remove(src.slug, actor=actor)
        self.recompute()
        return True

    def _need(self) -> pa.ProtectClient:
        if self.client is None:
            raise pa.Unreachable("UniFi Protect is not connected.")
        return self.client

    # -- stills ------------------------------------------------------------------------------------------------
    async def snapshot(self, pid: str, high: bool = False) -> tuple[bytes, str]:
        """Protect's still, one fetch per camera and quality shared for STILL_SHARE_S (the console allows 10 a
        second, and a wall of tablets asks at once)."""
        key = (pid, high)
        hit = self._stills.get(key)
        if hit is not None and time.monotonic() - hit[0] < STILL_SHARE_S:
            return hit[1]
        wait = self._still_wait.get(key)
        if wait is not None:
            return await asyncio.shield(wait)
        fut = asyncio.get_running_loop().create_future()
        self._still_wait[key] = fut
        try:
            body = await self._need().snapshot(pid, high)
            got = (body, "image/jpeg")
            self._stills[key] = (time.monotonic(), got)
            fut.set_result(got)
            return got
        except BaseException as exc:
            fut.set_exception(exc)
            fut.exception()                                  # (read: nobody else may be waiting)
            raise
        finally:
            self._still_wait.pop(key, None)

    async def still_provider(self, src: D.DirectSource, width: int | None, height: int | None):
        """cameras_direct's hook for a Protect source; None falls back to go2rtc's frame."""
        if self.client is None or not src.protect_id:
            return None
        try:
            return await self.snapshot(src.protect_id, bool(width and width > LARGE))
        except pa.ProtectError as err:
            log.info("protect: no snapshot of %s (%s); go2rtc's frame instead", src.slug, err.kind)
            return None

    # -- connecting --------------------------------------------------------------------------------------------
    def _client(self, host: str, key: str, pin: str | None) -> pa.ProtectClient:
        return pa.ProtectClient(host, key, lambda: aiohttp.ClientSession(), pin)

    async def check(self, host: str, key: str, pin: str | None) -> tuple[dict[str, Any], pa.ProtectClient]:
        """Connect's checks with a client of its own; the caller keeps the client (it holds the learned pin) or
        closes it."""
        client = self._client(host, key, pin)
        try:
            return await client.check(), client
        except BaseException:
            await client.close()
            raise

    async def apply(self, record: ProtectRecord | None, client: pa.ProtectClient | None) -> None:
        """A saved, re-trusted or removed connection takes effect now: the old client and socket go, the new ones
        start (the list read, then the events socket)."""
        await self._stop_running()
        self.record, self.client = record, client
        self.error = self.error_kind = self.seen_fingerprint = None
        self._stills.clear()
        if client is not None:
            self._run = asyncio.get_running_loop().create_task(self._running(client))
        else:
            self.cameras = {}
            self.recompute()

    async def _running(self, client: pa.ProtectClient) -> None:
        events = asyncio.get_running_loop().create_task(self._events(client))
        self._tasks.add(events)
        events.add_done_callback(self._tasks.discard)
        while True:
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- the next round tries again
                log.exception("protect: refreshing the cameras failed")
            await asyncio.sleep(REFRESH_S)

    async def _stop_running(self) -> None:
        for t in [self._run, *self._tasks]:
            if t is not None:
                t.cancel()
        for t in [self._run, *self._tasks]:
            if t is not None:
                await asyncio.gather(t, return_exceptions=True)
        self._run = None
        if self.stream is not None:
            await self.stream.close()
        self.stream = None
        if self.client is not None:
            await self.client.close()
        self.client = None

    def spawn(self, coro: Any) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def start(self) -> None:
        self.recompute()
        rec = self.record
        if rec is not None:
            await self.apply(rec, self._client(rec.host, rec.api_key, rec.pin))

    async def stop(self) -> None:
        await self._stop_running()

    # -- what the pages see --------------------------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        """Never the key, the password or a stream token."""
        s = self.stream
        return {"runs": True, "set": self.record is not None, "unreadable": self.unreadable is not None,
                "saved": self.record.public() if self.record is not None else None,
                "connected": bool(self.client is not None and self.connected),
                "events": {"connected": bool(s and s.connected), "last_message_at": s.last_message_at if s else None,
                           "last_error": s.last_error if s else None, "reconnects": s.reconnects if s else 0},
                "error": self.error, "error_kind": self.error_kind, "seen_fingerprint": self.seen_fingerprint,
                "last_refresh": self.last_refresh,
                "cameras": len(self.cameras), "picked": len(self.picked()),
                "events_log": list(self.events_log)[-10:]}

    def row(self, cam: pa.Camera) -> dict[str, Any]:
        src = self.picked().get(cam.id)
        m = self.matches.get(cam.id)
        notify = self.notify_for(cam.id)
        entity = (m.camera if m is not None and src is not None and src.slug in self.cams.matched
                  else src.entity_id if src is not None else None)
        return {"id": cam.id, "name": cam.name, "model": cam.model, "online": cam.online, "doorbell": cam.is_doorbell,
                "speaker": cam.has_speaker, "motion_only": cam.motion_only, "kinds": list(kinds_of(cam)),
                "kinds_on": list(kinds_on(cam)),
                "off_in_protect": [k for k in kinds_of(cam) if k in SMART and k not in kinds_on(cam)],
                "picked": src is not None, "slug": src.slug if src else None, "entity_id": entity,
                "area_id": src.area_id if src else None,
                "matched": m.camera if m is not None else None, "matched_speaker": m.speaker if m is not None else None,
                "video_from": self.video_from(cam.id),
                "notify": list(notify), "talk_speaker": next((sid for sid, sp in self.talk.speakers.items()
                                                            if sp.camera_id == cam.id), None)}


# ------------------------------------------------------------------------------------- REST
def _conn(request: web.Request) -> ProtectConnector:
    got = request.app.get("protect")
    if got is None:
        raise web.HTTPConflict(text='{"error":"not_here","message":"UniFi Protect connects directly only on Docker '
                               'and the LXC. Under the Home Assistant App, cameras come from Home Assistant\'s UniFi '
                               'Protect integration."}', content_type="application/json")
    return got


def _failed(err: pa.ProtectError) -> web.Response:
    extra: dict[str, Any] = {}
    if isinstance(err, pa.CertificateChanged):
        extra = {"fingerprint": err.seen, "pinned": err.expected}
    return error(422, err.kind, message=str(err), **extra)


def _clean_host(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > MAX_HOST or any(c.isspace() for c in raw.strip()):
        raise pa.NotAConsole("Enter the console's address, such as unifi.local.")
    host = raw.strip().rstrip("/")
    if "://" in host:
        scheme, _, rest = host.partition("://")
        if scheme.lower() != "https":
            raise pa.NotAConsole("The console speaks HTTPS: enter its address, such as unifi.local.")
        host = rest
    if "/" in host or "@" in host or "?" in host or "#" in host:
        raise pa.NotAConsole("Enter only the console's address (and a port, if it is not 443), such as unifi.local.")
    pa.split_host(host)
    return host


def _clean_key(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise pa.KeyRefused("Paste the API key made in UniFi OS (Settings, Control Plane, Integrations).")
    key = raw.strip()
    if len(key) > C.MAX_TOKEN or not C.PRINTABLE.match(key):
        raise pa.KeyRefused("That does not look like an API key (it has spaces or odd characters). Copy it again.")
    return key


def _local_user(body: Mapping[str, Any]) -> tuple[str | None, str | None]:
    user, pw = body.get("username"), body.get("password")
    if not user and not pw:
        return None, None
    if not isinstance(user, str) or not user.strip() or not isinstance(pw, str) or not pw:
        raise C.ConnectionFailed("local_user_missing", "Give the local user's name and password, or leave both empty.")
    user = user.strip()
    if "@" in user or len(user) > 128:
        raise C.ConnectionFailed("local_user_only", "Only a local UniFi OS user works here: a UI.com cloud account "
                                 "(an email address) and accounts with MFA can't be used.")
    return user, pw[:1024]


@guard("manager", reads="admin")
async def api_status(request: web.Request) -> web.Response:
    ident = guarded(request)
    rule = C.edit_rule(request, ident)
    conn = request.app.get("protect")
    base = {"can_edit": rule != "owner_only", "needs_fresh": rule == "fresh",
            "app_mode": bool(getattr(request.app["cfg"], "ha_managed_by_app", False))}
    if conn is None:
        return ok({"protect": {"runs": False}, **base})
    return ok({"protect": conn.status(), **base})


@guard("owner", fresh="away", no_audit="tests an address and an API key; saves nothing")
async def api_test(request: web.Request) -> web.Response:
    conn = _conn(request)
    body = await read_json(request)
    try:
        host, key = _clean_host(body.get("host")), _clean_key(body.get("api_key"))
        pin = conn.record.pin if conn.record is not None and conn.record.host == host else None
        result, client = await conn.check(host, key, pin)
    except pa.ProtectError as err:
        return _failed(err)
    await client.close()
    return ok({"result": {**result, "first": pin is None}})


@guard("owner", fresh="away", audit="connection.protect.saved")
async def api_save(request: web.Request) -> web.Response:
    conn = _conn(request)
    ident = guarded(request)
    body = await read_json(request)
    try:
        host, key = _clean_host(body.get("host")), _clean_key(body.get("api_key"))
        user, pw = _local_user(body)
        pin = conn.record.pin if conn.record is not None and conn.record.host == host else None
        result, client = await conn.check(host, key, pin)
    except pa.ProtectError as err:
        return _failed(err)
    except C.ConnectionFailed as exc:
        return C.failed(exc)
    rec = ProtectRecord(kind=KIND, host=host, api_key=key, pin=client.pinned_sha256, since=request.app["clock"](),
                        by=ident.user.id, by_name=ident.user.name or ident.user.username,
                        console_name=result.get("console_name"), version=result.get("version"), username=user, password=pw)
    del key, pw
    try:
        audit.config(request, ident, "connection.protect.saved",
                     {"host": host, "fingerprint": rec.pin, "first_pin": pin is None, "local_user": bool(user),
                      "replaces": conn.record is not None})
        conn.files.save(rec)
    except BaseException:
        await client.close()
        raise
    conn.unreadable = None
    await conn.apply(rec, client)
    log.info("protect: connected to %s (Protect %s) by %s", host, rec.version, rec.by_name)
    return ok({"protect": conn.status()})


@guard("owner", fresh="away", audit="connection.protect.certificate_trusted")
async def api_trust(request: web.Request) -> web.Response:
    conn = _conn(request)
    ident = guarded(request)
    body = await read_json(request)
    rec = conn.record
    if rec is None:
        return error(404, "not_found", message="Connect to UniFi Protect first.")
    try:
        want = pa.normalize_fingerprint(str(body.get("fingerprint") or ""))
    except ValueError:
        return error(400, "bad_fingerprint", message="That is not a certificate fingerprint.")
    try:
        seen = await pa.fetch_certificate(rec.host)
    except pa.ProtectError as err:
        return _failed(err)
    if seen != want:
        return error(409, "fingerprint_mismatch", fingerprint=seen,
                     message="The console now presents a different certificate from the one shown. Look again.")
    try:
        result, client = await conn.check(rec.host, rec.api_key, want)
    except pa.ProtectError as err:
        return _failed(err)
    audit.config(request, ident, "connection.protect.certificate_trusted",
                 {"host": rec.host, "old": rec.pin, "new": want})
    new = ProtectRecord(**{**rec.__dict__, "pin": want, "version": result.get("version"),
                           "console_name": result.get("console_name") or rec.console_name})
    conn.files.save(new)
    await conn.apply(new, client)
    log.warning("protect: %s trusted a new certificate for %s (%s)", ident.user.name or ident.user.id, rec.host, want)
    return ok({"protect": conn.status()})


@guard("owner", fresh="away", audit="connection.protect.disconnected")
async def api_disconnect(request: web.Request) -> web.Response:
    conn = _conn(request)
    ident = guarded(request)
    if conn.record is None and conn.unreadable is None:
        return error(404, "not_found")
    picked = conn.picked()
    audit.config(request, ident, "connection.protect.disconnected",
                 {"host": conn.record.host if conn.record else None, "cameras_removed": sorted(s.slug for s in picked.values())})
    actor = conn._actor(ident)
    await conn.apply(None, None)
    for src in picked.values():
        await conn.cams.remove(src.slug, actor=actor)
    conn.files.delete(KIND)
    conn.record, conn.unreadable = None, None
    conn.recompute()
    return ok({"protect": conn.status()})


@guard("manager", reads="admin")
async def api_cameras(request: web.Request) -> web.Response:
    conn = _conn(request)
    if conn.client is not None and not conn.cameras:
        await conn.refresh()
    reg = getattr(conn.hub, "registry", None)
    areas = sorted(((k, v) for k, v in (getattr(reg, "areas", None) or {}).items()), key=lambda a: a[1].lower())
    return ok({"cameras": [conn.row(c) for c in sorted(conn.cameras.values(), key=lambda c: c.name.lower())],
               "areas": [list(a) for a in areas], "connected": conn.client is not None, "error": conn.error})


def _pid(request: web.Request) -> str:
    pid = request.match_info.get("pid", "")
    if not D.PROTECT_ID.match(pid):
        raise web.HTTPNotFound(text='{"error":"not_found"}', content_type="application/json")
    return pid


@guard("manager", reads="admin")
async def api_camera_still(request: web.Request) -> web.StreamResponse:
    conn = _conn(request)
    pid = _pid(request)
    if pid not in conn.cameras:
        return error(404, "not_found")
    try:
        body, ctype = await conn.snapshot(pid, False)
    except pa.ProtectError as err:
        return error(502, "camera_unavailable", message=str(err))
    return web.Response(body=body, headers={"Content-Type": ctype, "Cache-Control": "no-store",
                                            "X-Content-Type-Options": "nosniff"})


@guard("manager", audit="protect.camera.set")
async def api_camera_set(request: web.Request) -> web.Response:
    conn = _conn(request)
    ident = guarded(request)
    pid = _pid(request)
    body = await read_json(request)
    cam = conn.cameras.get(pid)
    if cam is None:
        return error(404, "not_found")
    if set(body) - {"use", "area_id", "video_from", "notify"}:
        return error(400, "bad_request", message="use, area_id, video_from and notify only")
    use, area, video, notify = body.get("use"), body.get("area_id", ...), body.get("video_from"), body.get("notify")
    if use is not None and not isinstance(use, bool):
        return error(400, "bad_request", message="use: true or false")
    if area is not ... and area is not None and (not isinstance(area, str) or not D.AREA.match(area)):
        return error(400, "bad_request", message="area_id: an area, or null")
    if video is not None and video not in VIDEO_FROM:
        return error(400, "bad_request", message="video_from: direct or ha")
    if notify is not None and (not isinstance(notify, list) or any(k not in kinds_of(cam) for k in notify)):
        return error(400, "bad_request", message=f"notify: any of {', '.join(kinds_of(cam))}")
    audit.config(request, ident, "protect.camera.set",
                 {"camera": pid, "name": cam.name, **{k: v for k, v in body.items() if v is not ...}})
    actor = conn._actor(ident)
    try:
        src = conn.picked().get(pid)
        if use is True and src is None:
            src = await conn.pick(pid, None if area is ... else area, actor)
        elif use is False and src is not None:
            await conn.unpick(pid, actor)
            src = None
        if src is not None and area is not ... and area != src.area_id:
            await conn.cams.put({**conn._source(src, cam), "area_id": area}, actor=actor)
    except pa.ProtectError as err:
        return _failed(err)
    except D.SourceError as err:
        return error(422, "camera_refused", field=err.field, message=str(err))
    if video is not None or notify is not None:
        settings = conn.settings()
        mine = settings.setdefault(pid, {})
        if video is not None:
            mine["video_from"] = video
        if notify is not None:
            mine["notify"] = [k for k in NOTIFY_KINDS if k in notify]
        conn._write_settings(settings, actor, f"protect camera {pid} set")
    conn.recompute()
    return ok({"camera": conn.row(cam)})


@guard("manager", audit="protect.camera.smart_types_on")
async def api_turn_on(request: web.Request) -> web.Response:
    conn = _conn(request)
    ident = guarded(request)
    pid = _pid(request)
    body = await read_json(request)
    cam = conn.cameras.get(pid)
    types = body.get("types")
    if cam is None:
        return error(404, "not_found")
    if not isinstance(types, list) or not types or any(t not in SMART for t in types):
        return error(400, "bad_request", message=f"types: any of {', '.join(SMART)}")
    audit.config(request, ident, "protect.camera.smart_types_on", {"camera": pid, "name": cam.name, "types": types})
    try:
        after = await conn._need().set_smart_types(pid, types, merge=True)
    except pa.ProtectError as err:
        return _failed(err)
    conn.cameras[pid] = after
    conn.recompute()
    return ok({"camera": conn.row(after)})


def register(app: web.Application, hub: Any) -> ProtectConnector | None:
    """``GET /api/protect`` everywhere (under the HA App it says there is nothing to set up); the connector, its
    routes, its hooks into cameras_direct, the notifications engine and the talk relay where cameras_direct runs."""
    r = app.router
    r.add_get(API, api_status)
    cams: D.DirectCameras | None = app.get("cameras_direct")
    if cams is None:
        return None
    conn = ProtectConnector(app, hub, cams, lambda: app["clock"]())
    app["protect"] = conn
    app["direct_talk"] = conn.talk
    cams.set_still_provider("protect", conn.still_provider)
    cams.on_stream_failed = conn.on_stream_failed
    host = app.get("features")
    if host is not None and getattr(host, "notifier", None) is not None:
        host.notifier.direct = conn
    r.add_post(API + "/test", api_test)
    r.add_post(API, api_save)
    r.add_post(API + "/trust", api_trust)
    r.add_delete(API, api_disconnect)
    r.add_get(API + "/cameras", api_cameras)
    r.add_get(API + "/cameras/{pid}/still", api_camera_still)
    r.add_put(API + "/cameras/{pid}", api_camera_set)
    r.add_post(API + "/cameras/{pid}/turn-on", api_turn_on)

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            try:
                conn.on_change(set(changed))
            except Exception:  # noqa: BLE001 -- never break the hub's own callback
                log.exception("protect: a state change failed")

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            try:
                conn.on_registry()
            except Exception:  # noqa: BLE001
                log.exception("protect: a registry reload failed")
        ha.on_change, ha.on_registry = on_change, on_registry

    async def start(_app: web.Application) -> None:
        try:
            await conn.start()
        except Exception:  # noqa: BLE001 -- Connections says what is wrong
            log.exception("protect: starting failed")

    async def stop(_app: web.Application) -> None:
        await conn.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return conn
