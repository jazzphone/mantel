"""LIVE TV SERVED BY MANTEL (docs/phase4/FEATURE-PARITY.md "Live TV served by Mantel"; PLAN §8, §10, Proof 4).

Where Mantel runs its own go2rtc (Docker / Proxmox LXC: the compose stack's ``go2rtc`` service, built
from the ``transcode`` image; ``--go2rtc-url``), Live TV is Mantel's end to end. HK's page is unchanged:
it reads the same things it reads from Home Assistant's Live TV feature, answered here.

* **The channels** (``hk_tv/channels`` -> ``{configured, channels: [{number, name, camera, now}]}``):
  from Mantel's Live TV piece (features.LiveTv: the tuner's lineup and the XMLTV guide, the imported
  Live TV settings). A channel is listed only for a subject with ``feature:live_tv`` who may ``view``
  its camera; its ``now`` sensor only if they may view that too (as the interim's filter does).
* **The entities the page reads** are Mantel's own, with Home Assistant's entity ids
  (``camera.tv_<name>``, ``sensor.tv_<name>_now``, ``sensor.tv_viewers``, from the same slug), put
  into the hub's state store as an overlay that always wins (``LocalEntities``) and into the
  registry with platform ``hk_frontend`` (so HK's Cameras page leaves them out, as it does HA's).
  In linked mode linked_house.py publishes hk_frontend's Live TV entities to Home Assistant (the
  unique ids it learned from HA's registry) with this module's viewer count and served channels, so a
  tablet's sleep template that reads ``sensor.tv_viewers`` keeps working.
* **The video**: the player is HK's camera card on the channel's camera, which signals with
  ``camera/webrtc/*`` as for any camera. For a channel camera those are answered HERE (they wrap the
  camera connector's routes; any other camera still goes to Home Assistant): RBAC first
  (``feature:live_tv`` and ``camera.live`` on the channel's camera), then the channel's stream is set
  up in go2rtc on demand (``PATCH /api/streams``: in memory, one ffmpeg source per channel, the
  templates in packaging/compose/go2rtc/go2rtc.yaml, VAAPI when ``--live-tv-hardware vaapi``), and the
  offer, answer and candidates are relayed over go2rtc's own WebSocket (``/api/ws?src=``). The page
  never learns the tuner's or go2rtc's API address, nor any credential: only the SDP answer (whose
  candidates name go2rtc's published WebRTC port, as HA's go2rtc's do today).
* **The GPU falls back to the CPU**: with ``--live-tv-hardware vaapi`` the first channel played after a start
  is probed first (go2rtc opens it: about 3 s on QuickSync, checked on the house's LXC 2026-11-02). If the GPU
  pipeline fails (a 500 with ffmpeg's reason: another vendor's GPU, an Intel too old for the iHD driver, a
  render node the container may not open) and the CPU pipeline opens the same channel, Live TV uses the CPU
  until the next start and the status says why (``gpu_failed``). If the CPU fails too, it was not the GPU (a
  busy tuner, a channel off the air): the GPU stays, and the next play checks again.
* **Stop when nobody watches**: go2rtc stops ffmpeg (and frees the tuner) when a stream's last
  WebRTC consumer leaves; Mantel removes the stream itself STOP_GRACE_S after its last session ends,
  and the tick removes any ``mantel_tv_*`` stream nobody is using (a restart, a crash).
* **Who is watching** (HK's ``hk_tv/watching`` heartbeat, every 60 s while a channel plays, null on
  close): NOT a command. The page sends it to Mantel (``tv_watching``, web/shim/mantel-client.js) on
  every server, commands on or off. Counted per screen (a wall tablet's device) or per person,
  expiring after VIEWER_TTL_S without a heartbeat, as HA's does; published as ``sensor.tv_viewers``
  (state = how many, ``users`` = their names, ``channels``, ``screens``) where Mantel runs Live TV.

THROUGH MANTEL LINK (the HA App with no HK Frontend: no ``--go2rtc-url``; ``mode() == "link"``). Once the house
is Mantel's (linked_owners ``house``), nothing in Home Assistant runs Live TV any more, so where Mantel Link says it
has Live TV's transcode (``live_tv`` in its link features; Mantel Link's tv.py, HK Frontend's stream.py ported) and
the piece applies (turned on, or imported from HA with a tuner: ``piece_on``), Mantel serves the channel list itself
from its own Live TV piece (it reads the tuner's lineup and the guide), and linked_house.py publishes each channel
camera with ``features.tv`` = the tuner's stream URL, the quality and the programme's artwork. Mantel Link's camera
streams from its own view on Home Assistant's port, which runs ffmpeg on that tuner URL alone; Home Assistant's
go2rtc plays it, so the page's ``camera/webrtc/*`` for a channel camera go to the camera connector (Home Assistant),
as before. The entities are Home Assistant's (Mantel Link's), not Mantel's overlay; the heartbeat is counted here and
published as ``sensor.tv_viewers``, and answered ``{viewers, ha: false}``.

WHERE MANTEL DOES NOT RUN IT (the HA App with HK Frontend's Live TV, or a Mantel Link without the transcode;
decision in FEATURE-PARITY.md), nothing here changes the interim: ``hk_tv/channels`` is the filtered read to HA, the video is HA's own
transcode through HA's go2rtc, and the heartbeat is counted here and answered ``{viewers, ha: true}``
so the page also sends it to HA when the operator turned commands on (HA keeps ``sensor.tv_viewers``).

Wiring (server.wire, after features.register)::

    live_tv.register(app, hub, hooks)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web

from .connectors import (Ctx, Forbidden, Hooks, Route, allowed_ids, may_feature, read_routes, resolve, split_quality,
                         ws_handlers)
from .guards import guard

log = logging.getLogger("mantel.live_tv")

FEATURE = "live_tv"                         # rbac.FEATURE_DOMAINS: the Live TV page and its streams
STREAM_PREFIX = "mantel_tv_"                # go2rtc stream names Mantel owns (and may remove)
VIEWER_TTL_S = 150.0                        # HA's: a screen that stops sending heartbeats stops counting
STOP_GRACE_S = 5.0                          # a stream outlives its last session this long (a quick re-tune)
TICK_S = 30.0
GUIDE_STALE_S = 1860.0                      # the guide is fetched again when older (features.LIVE_TV_REFRESH_S + 1 min)
GUIDE_RETRY_S = 300.0
MAX_SESSIONS = 32                           # WebRTC sessions at once, every screen together
MAX_SESSIONS_PER_SOCKET = 4
MAX_SDP = 65536
QUALITIES = ("720", "1080")
HARDWARE = ("", "vaapi")
HARDWARE_PROBE_S = 15.0                     # the GPU check's probe (QuickSync answered in ~3 s, a failure as fast)
# what a page is told to use for ICE: Home Assistant's own default STUN servers (camera/webrtc's
# get_client_config answers the same), so a screen away from home behaves as it does with HA's cameras
ICE_SERVERS = [{"urls": ["stun:stun.home-assistant.io:3478", "stun:stun.home-assistant.io:80"]}]
CONFIG, OFFER, CANDIDATE = "camera/webrtc/get_client_config", "camera/webrtc/offer", "camera/webrtc/candidate"
CHANNELS_TYPE = "hk_tv/channels"
VIEWERS_ID = "sensor.tv_viewers"
_CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
_HOSTNAME = re.compile(r"^[A-Za-z0-9.\-]{1,253}$")
_STREAM_URL = re.compile(r"^http://([A-Za-z0-9.\-]{1,253})(:\d{1,5})?/auto/v\d{1,4}(\.\d{1,4})?$")
_ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


# ------------------------------------------------------------------------------------- names
def slug(name: str) -> str:
    """HA's Live TV slug (features/live_tv/__init__.py ``slug``), so the entity ids are HA's."""
    return "".join(c if c.isalnum() else "_" for c in str(name or "").lower()).strip("_") or "channel"


def entity_ids(name: str) -> dict[str, str]:
    s = slug(name)
    return {"camera": f"camera.tv_{s}", "now": f"sensor.tv_{s}_now"}


def stream_name(number: str) -> str:
    return STREAM_PREFIX + number.replace(".", "_")


def tuner_host(tuner: str) -> str | None:
    """The tuner's host name from the setting (a host, host:port, or its lineup.json URL)."""
    if not tuner:
        return None
    host = urlsplit(tuner).hostname if tuner.startswith(("http://", "https://")) else tuner.rsplit(":", 1)[0]
    return host if host and _HOSTNAME.match(host) else None


def stream_url(tuner: str, number: str, lineup_url: str | None = None) -> str | None:
    """Where the tuner serves a channel: the lineup's own URL when it is a plain HDHomeRun stream URL on
    the configured tuner (a fake tuner on one port, a real one by IP), else HA's ``http://<tuner>:5004/
    auto/v<n>``. Nothing else can reach go2rtc's ffmpeg: no '#' (go2rtc's parameters), no other host."""
    host = tuner_host(tuner)
    if host is None or not _CHANNEL.match(number):
        return None
    if isinstance(lineup_url, str):
        m = _STREAM_URL.match(lineup_url)
        if m and m.group(1).lower() == host.lower() and lineup_url.endswith(f"/auto/v{number}"):
            return lineup_url
    return f"http://{host}:5004/auto/v{number}"


def go2rtc_source(url: str, quality: str = "720", hardware: str = "") -> str:
    """go2rtc's ffmpeg source with Mantel's templates (packaging/compose/go2rtc/go2rtc.yaml)."""
    q = quality if quality in QUALITIES else "720"
    hw = "_vaapi" if hardware == "vaapi" else ""
    return f"ffmpeg:{url}#input=mantel_tv_in{hw}#video=mantel_tv_{q}{hw}#audio=opus"


def gpu_reason(detail: str) -> str:
    """ffmpeg's words for a failed GPU pipeline, as go2rtc's probe gave them ("streams: exec/rtsp[mpeg2video @ 0x5a..]
    Invalid frame dimensions 0x0. ..."), for the status: no address (a URL, an IP), no pointer, one short line."""
    text = re.sub(r"^streams:\s*(exec/rtsp)?", "", detail or "").strip()
    text = re.sub(r"\S+://\S+", "<url>", text)
    text = re.sub(r"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b", "<address>", text)
    text = re.sub(r"\s*@ 0x[0-9a-f]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:200] or "the GPU pipeline did not start"


# ------------------------------------------------------------------------------------- go2rtc
def go2rtc_api_url(cfg: Any) -> str:
    """THE ONE PLACE Mantel reads go2rtc's API address (``--go2rtc-url``, the backend network). Server-side
    only, never sent to a page. A later HTTPS front for go2rtc's media (e.g. under Mantel's own address)
    plugs in beside it; every go2rtc call goes through ``Go2rtc`` built from this."""
    return (getattr(cfg, "go2rtc_url", "") or "").rstrip("/")


class Go2rtcError(Exception):
    """go2rtc refused or could not do something. ``status`` is its HTTP status and ``detail`` the text it gave, when
    there was one: ``detail`` is go2rtc's own words and can hold a stream's address, so it is never put in the
    message, a log line or an answer (camera_setup.classify only reads it)."""

    def __init__(self, message: str = "", *, status: int | None = None, detail: str = "") -> None:
        super().__init__(message)
        self.status, self.detail = status, detail


class Go2rtc:
    """go2rtc's HTTP and WebSocket API on the backend network (no login: compose publishes no port)."""

    def __init__(self, base_url: str, session: Callable[[], aiohttp.ClientSession | None]) -> None:
        self.base = base_url.rstrip("/")
        self._session = session
        self._own: aiohttp.ClientSession | None = None
        self.calls: list[tuple[str, str]] = []                # (method, stream) for status and tests

    def session(self) -> aiohttp.ClientSession:
        s = self._session()
        if s is not None and not s.closed:
            return s
        if self._own is None or self._own.closed:
            self._own = aiohttp.ClientSession()
        return self._own

    async def close(self) -> None:
        if self._own is not None:
            await self._own.close()

    async def put_stream(self, name: str, src: str) -> None:
        """PATCH: the stream in go2rtc's memory only (PUT would also write go2rtc.yaml, which is read-only)."""
        self.calls.append(("PATCH", name))
        async with self.session().patch(f"{self.base}/api/streams", params={"name": name, "src": src},
                                        timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status >= 300:
                raise Go2rtcError(f"go2rtc refused the stream ({r.status})")

    async def drop_stream(self, name: str) -> None:
        """DELETE answers 400 after removing it (go2rtc then fails to write its read-only file): the
        stream is gone either way; a failure to reach go2rtc is only logged (the tick tries again)."""
        self.calls.append(("DELETE", name))
        try:
            async with self.session().delete(f"{self.base}/api/streams", params={"src": name},
                                             timeout=aiohttp.ClientTimeout(total=10)) as r:
                await r.read()
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            log.info("go2rtc: %s not removed yet (%s)", name, type(exc).__name__)

    async def streams(self) -> dict[str, Any]:
        async with self.session().get(f"{self.base}/api/streams", timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status >= 300:
                raise Go2rtcError(f"go2rtc streams ({r.status})")
            got = await r.json(content_type=None)
        return got if isinstance(got, dict) else {}

    async def probe(self, name: str, timeout: float = 10.0) -> list[str]:
        """Ask go2rtc to open a stream and say what it carries (``GET /api/streams?src=<name>&video=all&audio=all``,
        checked against go2rtc 1.9.9 on 2026-11-02). Answers the medias of its producers ("video, recvonly, H264",
        "audio, recvonly, PCMA"); a stream that cannot be opened is 500 with go2rtc's reason as plain text
        ("streams: wrong user/pass", "dial tcp ...: connection refused"), raised as Go2rtcError with that text as its
        ``detail``. NOT ``frame.jpeg``: go2rtc answers that 200 with an empty body whatever went wrong, and keeps the
        reason in its log. The answer's JSON also holds each producer's url, with its user name and password: only the
        ``medias`` are read, the rest dropped here."""
        self.calls.append(("PROBE", name))
        async with self.session().get(f"{self.base}/api/streams", params={"src": name, "video": "all", "audio": "all"},
                                      timeout=aiohttp.ClientTimeout(total=timeout), allow_redirects=False) as r:
            if r.status != 200:
                raise Go2rtcError(f"go2rtc could not open the stream ({r.status})", status=r.status,
                                  detail=(await r.text())[:500])
            got = await r.json(content_type=None)
        out: list[str] = []
        for p in (got.get("producers") if isinstance(got, dict) else None) or []:
            if isinstance(p, dict):
                out += [m for m in (p.get("medias") or []) if isinstance(m, str)]
        return out

    async def frame(self, name: str, params: Mapping[str, str] | None = None,
                    max_bytes: int = 20 * 1024 * 1024, timeout: float = 15.0) -> tuple[bytes, str]:
        """One JPEG of a stream (``GET /api/frame.jpeg?src=``: go2rtc's ffmpeg decodes a keyframe, scaled by
        ``width``/``height`` when given). For cameras_direct.py's stills. (body, content type)."""
        self.calls.append(("FRAME", name))
        async with self.session().get(f"{self.base}/api/frame.jpeg", params={"src": name, **dict(params or {})},
                                      timeout=aiohttp.ClientTimeout(total=timeout), allow_redirects=False) as r:
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if r.status != 200 or not ctype.startswith("image/"):
                raise Go2rtcError(f"go2rtc gave no frame ({r.status})", status=r.status)
            body = bytearray()
            async for chunk in r.content.iter_chunked(64 * 1024):
                body += chunk
                if len(body) > max_bytes:
                    raise Go2rtcError("go2rtc's frame is too large")
            return bytes(body), ctype

    async def connect(self, name: str) -> aiohttp.ClientWebSocketResponse:
        url = self.base.replace("http", "ws", 1) + "/api/ws"
        return await self.session().ws_connect(url, params={"src": name}, heartbeat=30,
                                               timeout=aiohttp.ClientWSTimeout(ws_close=5))


# ------------------------------------------------------------------------------------- viewers
def features_may_speak_for(host: Any, identity: Any, tablet: str) -> bool:
    from .features import may_speak_for         # (features imports this module)
    return isinstance(tablet, str) and may_speak_for(host, identity, tablet)


class Viewers:
    """Who is watching: {key: {name, person, screen, channel, at}}, heartbeat-expired (HA's Viewers, keyed
    per screen: a wall tablet's device, else the person)."""

    def __init__(self, ttl: float = VIEWER_TTL_S) -> None:
        self.ttl = ttl
        self._v: dict[str, dict[str, Any]] = {}

    def set(self, key: str, who: Mapping[str, Any], channel: str | None, now: float) -> bool:
        before = self.snapshot(now)
        if channel:
            self._v[key] = {**who, "channel": channel, "at": now}
        else:
            self._v.pop(key, None)
        return self.snapshot(now) != before

    def prune(self, now: float) -> bool:
        gone = [k for k, v in self._v.items() if now - v["at"] > self.ttl]
        for k in gone:
            del self._v[k]
        return bool(gone)

    def snapshot(self, now: float) -> list[dict[str, Any]]:
        return sorted(({k: v[k] for k in ("name", "person", "screen", "channel")}
                       for v in self._v.values() if now - v["at"] <= self.ttl),
                      key=lambda v: (v["name"], v["channel"], v["screen"] or ""))

    def names(self, now: float) -> list[str]:
        return [v["name"] for v in self.snapshot(now)]

    def tablets(self, now: float) -> set[str]:
        """The wall tablets Live TV plays on (the heartbeat's ``tablet``, when the page may speak for it): each
        one's Sleep Screen keeps it awake while it does (features.MantelSleep.awake_also)."""
        return {v["tablet"] for v in self._v.values() if v.get("tablet") and now - v["at"] <= self.ttl}


def viewer_of(identity: Any) -> tuple[str, dict[str, Any]] | None:
    """(key, {name, person, screen}): one viewer per screen (a wall tablet device), else per person."""
    user, device = getattr(identity, "user", None), getattr(identity, "device", None)
    if user is None and device is None:
        return None
    person = (getattr(user, "name", None) or getattr(user, "username", None) or getattr(user, "id", None)) if user else None
    screen = getattr(device, "name", None) if device else None
    key = f"device:{device.id}" if device is not None else f"user:{user.id}"
    return key, {"name": person or screen or key, "person": person, "screen": screen}


# ------------------------------------------------------------------------------------- local entities
class LocalEntities:
    """Mantel's own states in the hub's StateStore, under ids it owns. An overlay that always wins: when
    Home Assistant's copy of the same id changes or vanishes (a linked mirror, a reconnect's replace_all)
    ours is put back in the same callback, before any page's view is flushed."""

    def __init__(self, hub: Any, clock: Callable[[], float] = time.time, flag: str = "mantel_live_tv") -> None:
        # ``flag`` marks this overlay's registry entries (2026-11-02, cameras_direct.py's overlay beside Live TV's):
        # each overlay drops only its own entries when it merges, so the two never drop each other's
        self.hub, self.clock, self.flag = hub, clock, flag
        self.mine: dict[str, dict[str, Any]] = {}
        self.registry: dict[str, dict[str, Any]] = {}

    def _store(self) -> dict[str, dict]:
        return self.hub.store.states

    def put_all(self, want: Mapping[str, tuple[Any, Mapping[str, Any]]]) -> set[str]:
        """Make the overlay exactly ``want`` ({entity_id: (state, attributes)}); returns the ids changed."""
        st, changed = self._store(), set()
        for eid in list(self.mine):
            if eid not in want:
                ours = self.mine.pop(eid)
                if st.get(eid) is ours:          # only our own copy: a state Home Assistant put there stays
                    del st[eid]
                changed.add(eid)
        for eid, (state, attrs) in want.items():
            old = self.mine.get(eid)
            if old is not None and old["s"] == state and old["a"] == dict(attrs):
                if st.get(eid) is not old:
                    st[eid] = old
                    changed.add(eid)
                continue
            t = self.clock()
            lc = t if old is None or old["s"] != state else old["lc"]
            new = {"s": state, "a": json.loads(json.dumps(dict(attrs), default=str)), "lc": lc, "lu": t}
            self.mine[eid] = st[eid] = new
            changed.add(eid)
        return changed

    def reassert(self, changed: set[str]) -> set[str]:
        st, back = self._store(), set()
        for eid in changed & set(self.mine):
            if st.get(eid) is not self.mine[eid]:
                st[eid] = self.mine[eid]
                back.add(eid)
        return back

    def merged_entities(self, ha_entities: list[dict]) -> list[dict] | None:
        """HA's entity registry plus ours (HA's own entry wins for an id it has); None if unchanged."""
        base = [e for e in ha_entities if not e.get(self.flag)]
        have = {e.get("entity_id") for e in base}
        extra = [dict(e) for eid, e in sorted(self.registry.items()) if eid not in have]
        merged = base + extra
        return None if merged == ha_entities else merged


async def relay_go2rtc(sess: Any, on_event: Callable[[dict], None]) -> None:
    """go2rtc's answer and candidates, as HA's camera/webrtc/offer events. ``sess`` has go2rtc's socket (``ws``)
    and ``ended``; Live TV's sessions and cameras_direct.py's relay with it alike."""
    try:
        async for m in sess.ws:
            if m.type != aiohttp.WSMsgType.TEXT:
                break
            try:
                d = json.loads(m.data)
            except ValueError:
                continue
            t, v = d.get("type"), d.get("value")
            if t == "webrtc/answer" and isinstance(v, str):
                on_event({"type": "answer", "answer": v})
            elif t == "webrtc/candidate" and isinstance(v, str):
                on_event({"type": "candidate", "candidate": {"candidate": v, "sdpMLineIndex": 0}})
            elif t == "error":
                on_event({"type": "error", "code": "webrtc_offer_failed", "message": str(v)[:200]})
    except (aiohttp.ClientError, asyncio.TimeoutError):
        pass
    except asyncio.CancelledError:
        return
    if not sess.ended:                       # go2rtc ended it (the tuner or camera went away): the card retries
        on_event({"type": "error", "code": "webrtc_offer_failed", "message": "the stream ended"})


# ------------------------------------------------------------------------------------- sessions
@dataclass
class TvSession:
    id: str
    channel: str
    camera: str
    stream: str
    ws: Any = None
    reader: asyncio.Task | None = None
    ended: bool = False
    candidates: int = 0
    started: float = field(default_factory=time.monotonic)


@dataclass
class LiveTvHooks:
    """Tests replace the clock and the tick; ``session`` gives the go2rtc client its HTTP session."""
    monotonic: Callable[[], float] | None = None
    tick: float = TICK_S
    stop_grace: float = STOP_GRACE_S


class MantelLiveTv:
    """``app["live_tv"]``: see the module docstring."""

    def __init__(self, app: web.Application, hub: Any, hooks: Hooks, tv_hooks: LiveTvHooks | None = None) -> None:
        self.app, self.hub, self.hooks = app, hub, hooks
        self.tv_hooks = tv_hooks or LiveTvHooks()
        cfg = app.get("cfg")
        url = go2rtc_api_url(cfg)
        self.go2rtc: Go2rtc | None = Go2rtc(url, lambda: app.get("http")) if url else None
        self.hardware = getattr(cfg, "live_tv_hardware", "") or ""
        self.hardware_checked = self.hardware != "vaapi"     # the GPU is probed once, on the first play
        self.gpu_failed: str | None = None                    # why Live TV left the GPU for the CPU
        self._hardware_lock = asyncio.Lock()
        self.viewers = Viewers()
        self._playing_on: set[str] = set()      # the tablets last told they play Live TV (tablets_changed)
        self.local = LocalEntities(hub, lambda: app["clock"]() if "clock" in app else time.time())
        self.sessions: dict[str, TvSession] = {}
        self.starting = 0                          # offers past the caps' check, not yet sessions (offer)
        self.streams: dict[str, str] = {}                     # stream name -> channel, set up in go2rtc
        self._stop_timers: dict[str, asyncio.TimerHandle] = {}
        self._linked_sig: tuple | None = None
        self._guide_tried = float("-inf")
        self._tasks: set[asyncio.Task] = set()
        self.heartbeats = 0
        self.error: str | None = None
        self.log: list[dict[str, Any]] = []                   # the last sessions (status)

    # -- what runs where ------------------------------------------------------------------------------
    @property
    def host(self) -> Any:
        return self.app.get("features")

    def monotonic(self) -> float:
        return self.tv_hooks.monotonic() if self.tv_hooks.monotonic else time.monotonic()

    def settings(self) -> dict[str, Any]:
        h = self.host
        return h.settings["live_tv"] if h is not None else {}

    def runs(self) -> bool:
        """Mantel serves Live TV: its own go2rtc is configured and the Live TV piece is on with a tuner."""
        h = self.host
        return self.go2rtc is not None and h is not None and h.on("live_tv") and bool(self.settings().get("tuner"))

    def piece_on(self) -> bool:
        """The Live TV piece applies: turned on, or the house's own Live TV (HA had it added and a tuner was
        imported) moved to Mantel with the house (linked_owners ``house``), so nothing in HA runs it."""
        h = self.host
        if h is None or not self.settings().get("tuner"):
            return False
        if h.on("live_tv"):
            return True
        owners = self.app.get("linked_owners")
        return "live_tv" in h.settings["ha"]["added"] and owners is not None and bool(owners.house())

    def link(self) -> Any:
        """A connected Mantel Link that has Live TV's transcode (``live_tv`` in its link features), or None."""
        lk = self.app.get("linked")
        reg = getattr(lk, "registry", None)
        for c in (reg.clients_of("mantel") if reg is not None else []):
            if c.protocol >= 2 and "live_tv" in c.features:
                return c
        return None

    def links(self) -> bool:
        """LIVE TV THROUGH MANTEL LINK (the HA App: no go2rtc of Mantel's own). Mantel holds the house's
        entities (linked_house), the piece applies, and Mantel Link can transcode: Mantel answers the
        channel list from its own Live TV piece and publishes each channel camera with the tuner's
        stream for Mantel Link's transcode, and Home Assistant's go2rtc plays it, as it did HK Frontend's."""
        if self.go2rtc is not None or not self.piece_on():
            return False
        lh = self.app.get("linked_house")
        return lh is not None and lh.wanted() is not None and self.link() is not None

    def serves(self) -> bool:
        """Mantel answers the channel list itself: its own go2rtc, or through Mantel Link."""
        return self.runs() or self.links()

    def mode(self) -> str:
        """``mantel`` (served here), ``link`` (through Mantel Link), ``ha`` (the interim: Home Assistant's
        Live TV), or ``off``."""
        if self.runs():
            return "mantel"
        if self.links():
            return "link"
        h = self.host
        return "ha" if h is not None and "live_tv" in h.settings["ha"]["added"] else "off"

    def channels(self) -> list[dict[str, Any]]:
        """Every channel Mantel serves, in order: number, name, entity ids, guide (now/next), stream URL."""
        h = self.host
        if h is None or not self.serves():
            return []
        cfg = self.settings()
        lineup = {c.get("number"): c for c in h.tv.lineup}
        out, seen = [], set()
        for ch in h.tv.channels()["channels"]:
            n = ch.get("number")
            if not isinstance(n, str) or not _CHANNEL.match(n) or n in seen:
                continue
            seen.add(n)
            name = ch.get("name") or n
            url = stream_url(cfg["tuner"], n, (lineup.get(n) or {}).get("url"))
            if url is None:
                continue
            out.append({"number": n, "name": name, **entity_ids(name), "network": ch.get("network"),
                        "logo": ch.get("logo"), "programme": ch.get("now"), "next": ch.get("next"), "url": url})
        # a name used twice gets its number added (HA's build_channels), so each has its own entities
        names = [c["name"] for c in out]
        for c in out:
            if names.count(c["name"]) > 1:
                c["name"] = f"{c['name']} {c['number']}"
                c.update(entity_ids(c["name"]))
        if not self.runs():
            # through Mantel Link the entities are Home Assistant's: the ids it already has for a channel win
            learned = self.learned()
            for c in out:
                for kind in ("camera", "now"):
                    eid = ((learned.get("cameras" if kind == "camera" else "now") or {}).get(c["number"]) or {}).get("entity_id")
                    if isinstance(eid, str) and _ENTITY.match(eid):
                        c[kind] = eid
        return out

    def learned(self) -> dict[str, Any]:
        """The house's Live TV entities linked_house learned from HA's registry ({viewers, now, cameras})."""
        owners = self.app.get("linked_owners")
        got = owners.remembered("live_tv") if owners is not None else None
        return got if isinstance(got, dict) else {}

    def by_camera(self) -> dict[str, dict[str, Any]]:
        return {c["camera"]: c for c in self.channels()}

    # -- the entities the page reads ------------------------------------------------------------------
    def wanted(self) -> dict[str, tuple[Any, dict[str, Any]]]:
        """{entity_id: (state, attributes)}: each channel's camera and "now playing" sensor (HA's
        ChannelCamera / NowPlaying attributes) and the viewers sensor. Empty unless Mantel runs Live TV."""
        if not self.runs():
            return {}
        out: dict[str, tuple[Any, dict[str, Any]]] = {}
        for c in self.channels():
            cur, nxt = c.get("programme") or None, c.get("next") or None
            attrs = {"channel": c["number"], "network": c.get("network") or c["name"], "name": c["name"],
                     "logo": c.get("logo"), "camera": c["camera"], "icon": "mdi:television-classic",
                     "friendly_name": f"TV {c['name']} now"}
            if cur:
                attrs.update(subtitle=cur.get("subtitle"), description=cur.get("description"),
                             start=cur.get("start"), end=cur.get("end"), image=cur.get("image"))
            if nxt:
                attrs.update(next_title=nxt.get("title"), next_start=nxt.get("start"), next_image=nxt.get("image"))
            title = (str(cur.get("title") or "")[:250] if cur else "") or "Live"
            out[c["now"]] = (title, attrs)
            # a camera that streams (HA: CameraEntityFeature.STREAM = 2), with no still of its own and
            # nothing about where it streams from
            out[c["camera"]] = ("idle", {"channel": c["number"], "friendly_name": f"TV {c['name']}",
                                         "supported_features": 2, "frontend_stream_type": "web_rtc"})
        count, vattrs = self.viewers_state()
        out[VIEWERS_ID] = (count, {**vattrs, "friendly_name": "TV viewers", "icon": "mdi:account-eye"})
        return out

    def registry_entries(self, want: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
        return {eid: {"entity_id": eid, "platform": "hk_frontend", "device_id": None, "area_id": None,
                      "name": None, "mantel_live_tv": True} for eid in want}

    def sync_states(self) -> set[str]:
        want = self.wanted()
        gate = self.app.get("go2rtc_streams")
        if gate is not None:       # a channel camera asked for by name under /go2rtc/ is not an ordinary camera
            gate.set_channel_cameras([c["camera"] for c in self.channels()] if self.runs() else [])
        changed = self.local.put_all(want)
        self.local.registry = self.registry_entries(want)
        self._sync_registry()            # HaClient's first registry load replaces it without a callback
        if changed:
            self.hub.on_change(changed)
        return changed

    def _sync_registry(self) -> None:
        registry = getattr(self.hub, "registry", None)
        if registry is None:
            return
        merged = self.local.merged_entities(list(registry.entity_entries))
        if merged is not None:
            registry.update(entities=merged)
            self.hub.on_registry()

    def on_change(self, changed: set[str]) -> None:
        back = self.local.reassert(set(changed))
        if back:
            self.hub.on_change(back)
            # a reconnect: HaClient loaded the registries again (no callback) before replacing the states
            entries = getattr(getattr(self.hub, "registry", None), "entries", {})
            if any(eid not in entries for eid in self.local.registry):
                self._sync_registry()

    def on_registry(self) -> None:
        if self.local.registry:
            self._sync_registry()

    def viewers_state(self) -> tuple[int, dict[str, Any]]:
        """sensor.tv_viewers' state and attributes (HA's ViewersSensor, plus the screens)."""
        snap = self.viewers.snapshot(self.monotonic())
        return len(snap), {"users": [v["name"] for v in snap], "channels": sorted({v["channel"] for v in snap}),
                           "screens": sorted({v["screen"] for v in snap if v["screen"]})}

    # -- linked mode: linked_house.py publishes hk_frontend's Live TV entities (the ids it learned from HA's
    # registry) and reads the viewers and the served channels from here; this only asks it to refresh
    async def sync_linked(self) -> None:
        lh = self.app.get("linked_house")
        if lh is None:
            return
        sig = (self.mode(), repr(self.linked_channels()), repr(self.viewers_state()))
        if sig == self._linked_sig:
            return
        self._linked_sig = sig
        try:
            await lh.refresh()
        except Exception:  # noqa: BLE001 -- linked HA's trouble never breaks Live TV
            log.exception("Live TV: the linked entities were not refreshed")

    def linked_channels(self) -> list[dict[str, Any]]:
        """What linked_house publishes for each channel served (the camera's stream through Mantel Link
        when it plays them, and the artwork its still shows)."""
        q = self.settings().get("quality") if self.settings().get("quality") in QUALITIES else "720"
        out = []
        for c in self.channels():
            image = (c.get("programme") or {}).get("image") or c.get("logo")
            out.append({"number": c["number"], "name": c["name"], "camera": c["camera"], "now": c["now"],
                        "tv": {"channel": c["number"], "source": c["url"], "quality": q,
                               "image": image if isinstance(image, str) else None} if self.links() else None})
        return out

    async def sync(self) -> None:
        """Bring the overlay, the registry and the linked entities in line with the settings and guide."""
        self.sync_states()
        await self.sync_linked()
        if not self.runs():
            await self.end_all()

    # -- the heartbeat ----------------------------------------------------------------------------------
    def tablets_changed(self) -> None:
        """A tablet started or stopped playing Live TV (a heartbeat, a close, one gone quiet): its Sleep Screen
        decides again. Against the tablets last told, not a count taken just before: a viewer gone quiet has
        already aged out of ``tablets()`` by the time the tick prunes it."""
        now = self.viewers.tablets(self.monotonic())
        before, self._playing_on = self._playing_on, now
        host = self.host
        if now == before or host is None:
            return
        for tid in now ^ before:
            eng = getattr(host, "engines", {}).get(tid)
            if eng is not None:
                eng.evaluate()

    async def watching(self, identity: Any, channel: str | None, tablet: str | None = None) -> dict[str, Any]:
        who = viewer_of(identity)
        if who is None:
            raise Forbidden("sign in to watch")
        # THE TABLET IT PLAYS ON (2026-10-21): its Sleep Screen keeps it awake while it does. Taken only from a
        # page that may speak for that tablet (features.may_speak_for, the rule its black's reports meet);
        # otherwise the heartbeat still counts, for no tablet
        host = self.host
        if tablet is not None and not (host is not None and features_may_speak_for(host, identity, tablet)):
            tablet = None
        mode = self.mode()
        if channel is not None and mode in ("mantel", "link"):
            ch = next((c for c in self.channels() if c["number"] == channel), None)
            if ch is None:
                raise LookupError("not a channel Mantel serves")
            if not await may_feature(self.hooks, identity, FEATURE) or \
                    ch["camera"] not in await allowed_ids(self.hooks, identity, "view", [ch["camera"]]):
                raise Forbidden("not allowed: this channel")
        self.heartbeats += 1
        now = self.monotonic()
        changed = self.viewers.set(who[0], {**who[1], "tablet": tablet}, channel, now)
        self.tablets_changed()
        if changed and mode in ("mantel", "link"):
            want = self.wanted()
            hit = self.local.put_all(want)
            if hit:
                self.hub.on_change(hit)
            await self.sync_linked()
        # ha: the page also tells Home Assistant's own Live TV (served here or through Mantel Link, there is none)
        return {"viewers": self.viewers.names(now), "ha": mode not in ("mantel", "link")}

    # -- the channel list -------------------------------------------------------------------------------
    async def channel_list(self, ctx: Ctx, msg: dict) -> dict[str, Any]:
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id"}:
            raise ReadBlocked("hk_tv/channels carries nothing")
        if not self.serves():
            from .linked_reads import FROM_LINK
            if FROM_LINK.get():
                return {"configured": False, "channels": []}     # HK Frontend's dashboard: Live TV is off in Mantel
            reads = self.app.get("filtered_reads")
            if reads is None:
                raise ConnectionError("unavailable")
            return await reads.request(ctx.identity, {"type": CHANNELS_TYPE})      # the interim, as before
        if not await may_feature(self.hooks, ctx.identity, FEATURE):
            return {"configured": True, "channels": []}
        chans = self.channels()
        ok = await allowed_ids(self.hooks, ctx.identity, "view", [i for c in chans for i in (c["camera"], c["now"])])
        return {"configured": True, "channels": [
            {"number": c["number"], "name": c["name"], "camera": c["camera"], "now": c["now"] if c["now"] in ok else None}
            for c in chans if c["camera"] in ok]}

    # -- signaling ----------------------------------------------------------------------------------------
    async def _gate(self, ctx: Ctx, entity_id: str) -> dict[str, Any]:
        ch = self.by_camera().get(entity_id)
        if ch is None:
            raise Forbidden("not a channel")
        if not await may_feature(self.hooks, ctx.identity, FEATURE):
            raise Forbidden("not allowed: Live TV")
        if await resolve(self.hooks.may_view(ctx.identity, entity_id)) is not True:
            raise Forbidden(f"may not view {entity_id}")
        return ch

    def ours(self, msg: dict) -> bool:
        eid = msg.get("entity_id")
        return isinstance(eid, str) and self.runs() and eid in self.by_camera()

    async def client_config(self, ctx: Ctx, msg: dict) -> dict[str, Any]:
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id", "entity_id"}:
            raise ReadBlocked("get_client_config carries entity_id only")
        await self._gate(ctx, msg["entity_id"])
        return {"configuration": {"iceServers": json.loads(json.dumps(ICE_SERVERS))}, "getCandidatesUpfront": False}

    async def offer(self, ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id", "entity_id", "offer"}:
            raise ReadBlocked("an offer carries entity_id and offer only")
        sdp = msg.get("offer")
        if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > MAX_SDP:
            raise ReadBlocked("offer must be an SDP string")
        ch = await self._gate(ctx, msg["entity_id"])
        mine: dict[str, TvSession] = ctx.state.setdefault("tv_sessions", {})
        # the caps count the offers still starting too (checked and taken with no await between): counted
        # only once made, offers sent together all passed, and one socket could hold every tuner
        if len(mine) + ctx.state.get("tv_starting", 0) >= MAX_SESSIONS_PER_SOCKET \
                or len(self.sessions) + self.starting >= MAX_SESSIONS:
            raise Forbidden("too many Live TV streams at once")
        ctx.state["tv_starting"] = ctx.state.get("tv_starting", 0) + 1
        self.starting += 1
        try:
            return await self._start(ctx, ch, sdp, mine, on_event)
        finally:
            ctx.state["tv_starting"] -= 1
            self.starting -= 1

    async def _start(self, ctx: Ctx, ch: dict[str, Any], sdp: str, mine: dict[str, "TvSession"],
                     on_event: Callable[[dict], None]):
        assert self.go2rtc is not None
        name = stream_name(ch["number"])
        self._cancel_stop(name)
        try:
            await self._put_checked(name, ch)
            self.streams[name] = ch["number"]
            self._proxy_gate(name, True, ch["camera"])
            ws = await self.go2rtc.connect(name)
        except (aiohttp.ClientError, asyncio.TimeoutError, Go2rtcError) as exc:
            self.error = f"{type(exc).__name__}: {exc}"[:200]
            log.warning("Live TV: go2rtc unavailable for %s (%s)", ch["number"], self.error)
            self._schedule_stop(name)
            raise ConnectionError("Live TV's transcoder is unavailable") from exc
        sess = TvSession(secrets.token_hex(16), ch["number"], ch["camera"], name, ws)
        self.sessions[sess.id] = mine[sess.id] = sess
        try:
            await ws.send_json({"type": "webrtc/offer", "value": sdp})
        except (aiohttp.ClientError, ConnectionError, RuntimeError) as exc:
            mine.pop(sess.id, None)
            await self._end(sess)
            raise ConnectionError("Live TV's transcoder is unavailable") from exc
        on_event({"type": "session", "session_id": sess.id})
        sess.reader = asyncio.get_running_loop().create_task(self._relay(sess, on_event))
        self._log("start", sess, ctx.identity)

        async def unsubscribe() -> None:
            mine.pop(sess.id, None)
            await self._end(sess)

        async def recheck() -> bool:
            """The policy tick's question (server.tick_once): may this connection still watch this channel?"""
            try:
                await self._gate(ctx, sess.camera)
                return True
            except Forbidden:
                on_event({"type": "error", "code": "forbidden", "message": "Live TV is no longer allowed here"})
                return False
        unsubscribe.recheck = recheck              # type: ignore[attr-defined]
        return unsubscribe

    async def _put_checked(self, name: str, ch: dict[str, Any]) -> None:
        """The channel's stream in go2rtc, on the GPU or the CPU (see "The GPU falls back to the CPU" above)."""
        assert self.go2rtc is not None
        quality = self.settings().get("quality") or "720"
        if self.hardware_checked:
            await self.go2rtc.put_stream(name, go2rtc_source(ch["url"], quality, self.hardware))
            return
        async with self._hardware_lock:
            hw = self.hardware if self.hardware_checked else "vaapi"
            await self.go2rtc.put_stream(name, go2rtc_source(ch["url"], quality, hw))
            if self.hardware_checked:
                return
            try:
                await self.go2rtc.probe(name, timeout=HARDWARE_PROBE_S)
            except asyncio.TimeoutError:
                return                                        # no answer either way: the next play asks again
            except Go2rtcError as exc:
                gpu = gpu_reason(exc.detail)
                await self.go2rtc.put_stream(name, go2rtc_source(ch["url"], quality, ""))
                try:
                    await self.go2rtc.probe(name, timeout=HARDWARE_PROBE_S)
                except (Go2rtcError, asyncio.TimeoutError):
                    # the CPU could not open it either: not the GPU's fault, so the GPU stays
                    await self.go2rtc.put_stream(name, go2rtc_source(ch["url"], quality, "vaapi"))
                    return
                self.hardware, self.gpu_failed = "", gpu
                log.warning("Live TV: the GPU (VAAPI) transcode failed, so Live TV uses the CPU until Mantel "
                            "restarts: %s", self.gpu_failed)
            self.hardware_checked = True

    async def _relay(self, sess: TvSession, on_event: Callable[[dict], None]) -> None:
        await relay_go2rtc(sess, on_event)

    async def candidate(self, ctx: Ctx, msg: dict) -> None:
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id", "entity_id", "session_id", "candidate"}:
            raise ReadBlocked("a candidate carries entity_id, session_id and candidate only")
        await self._gate(ctx, msg["entity_id"])
        sess = (ctx.state.get("tv_sessions") or {}).get(msg.get("session_id"))
        if sess is None or sess.camera != msg["entity_id"]:
            raise Forbidden("not a WebRTC session of this connection")
        c = msg.get("candidate")
        text = c.get("candidate") if isinstance(c, dict) else c
        if not isinstance(text, str) or len(text) > 1024:
            raise ReadBlocked("candidate must be an ICE candidate")
        if text and not sess.ended:              # an empty one is "end of candidates": go2rtc needs nothing
            sess.candidates += 1
            await sess.ws.send_json({"type": "webrtc/candidate", "value": text})
        return None

    async def _end(self, sess: TvSession) -> None:
        """Synchronous first (a socket's close may be cancelled midway): the session is gone and the
        stream's stop is scheduled before go2rtc's socket is closed, in a task of its own."""
        if sess.ended:
            return
        sess.ended = True
        self.sessions.pop(sess.id, None)
        if sess.reader is not None:
            sess.reader.cancel()
        self._log("end", sess)
        if not any(s.stream == sess.stream for s in self.sessions.values()):
            self._schedule_stop(sess.stream)
        if sess.ws is not None:
            self.spawn(self._close_ws(sess.ws))

    @staticmethod
    async def _close_ws(ws: Any) -> None:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001 -- already closed
            pass

    async def end_all(self) -> None:
        for sess in list(self.sessions.values()):
            await self._end(sess)
        for name in list(self.streams):
            await self._drop(name)

    # -- streams' lifetime ----------------------------------------------------------------------------
    def _cancel_stop(self, name: str) -> None:
        h = self._stop_timers.pop(name, None)
        if h is not None:
            h.cancel()

    def _schedule_stop(self, name: str) -> None:
        self._cancel_stop(name)
        loop = asyncio.get_running_loop()
        self._stop_timers[name] = loop.call_later(self.tv_hooks.stop_grace, lambda: self.spawn(self._drop_if_idle(name)))

    async def _drop_if_idle(self, name: str) -> None:
        self._stop_timers.pop(name, None)
        if not any(s.stream == name for s in self.sessions.values()):
            await self._drop(name)

    def _proxy_gate(self, name: str, on: bool, camera: str | None = None) -> None:
        """media_proxy's per-stream gate for /go2rtc/ (a page may view a Live TV stream there only while
        Mantel has it set up): registered with each on-demand stream, removed when it is dropped."""
        streams = self.app.get("go2rtc_streams")
        if streams is None:
            return
        if on:
            streams.allow(name, "live_tv", camera)
        else:
            streams.forget(name)

    async def _drop(self, name: str) -> None:
        self._cancel_stop(name)
        self.streams.pop(name, None)
        self._proxy_gate(name, False)
        if self.go2rtc is not None:
            await self.go2rtc.drop_stream(name)

    async def reap(self) -> None:
        """Any mantel_tv_* stream in go2rtc that no session uses (left by a restart or a crash) goes."""
        if self.go2rtc is None:
            return
        try:
            got = await self.go2rtc.streams()
        except (aiohttp.ClientError, asyncio.TimeoutError, Go2rtcError) as exc:
            self.error = f"{type(exc).__name__}: {exc}"[:200]
            return
        busy = {s.stream for s in self.sessions.values()} | set(self._stop_timers)
        for name in got:
            if name.startswith(STREAM_PREFIX) and name not in busy:
                await self._drop(name)

    # -- running ----------------------------------------------------------------------------------------
    def spawn(self, coro: Awaitable[Any]) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def guide_age(self) -> float:
        """Seconds since features.LiveTv last fetched the guide (inf before the first)."""
        h = self.host
        try:
            return (h.now() - datetime.fromisoformat(h.tv.fetched_at)).total_seconds()
        except (AttributeError, TypeError, ValueError):
            return float("inf")

    async def tick(self) -> None:
        now = self.monotonic()
        self.viewers.prune(now)
        self.tablets_changed()
        h = self.host
        if self.serves() and h is not None:
            # the guide: features' own loop fetches it when Live TV was on at start; otherwise here
            if self.guide_age() >= GUIDE_STALE_S and now - self._guide_tried >= GUIDE_RETRY_S:
                self._guide_tried = now
                await h.tv.refresh()
        await self.sync()
        if self.runs():
            await self.reap()

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- the next tick tries again
                log.exception("Live TV tick failed")
            await asyncio.sleep(self.tv_hooks.tick)

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
                try:
                    await sess.ws.close()
                except Exception:  # noqa: BLE001
                    pass
        self.sessions.clear()
        for h in self._stop_timers.values():
            h.cancel()
        for name in list(self.streams):
            self._proxy_gate(name, False)
        if self.go2rtc is not None:
            for name in list(self.streams):
                await self.go2rtc.drop_stream(name)
            await self.go2rtc.close()

    def _log(self, what: str, sess: TvSession, identity: Any = None) -> None:
        who = viewer_of(identity) if identity is not None else None
        self.log.append({"event": what, "channel": sess.channel, "session": sess.id[:8],
                         "who": who[1]["name"] if who else None, "at": round(time.time(), 1)})
        del self.log[:-50]

    def status(self) -> dict[str, Any]:
        """For GET /api/live_tv/status (Owner/Admin): never the tuner's or go2rtc's address."""
        now = self.monotonic()
        return {"mode": self.mode(), "go2rtc": self.go2rtc is not None, "hardware": self.hardware or "cpu",
                "gpu_failed": self.gpu_failed,
                "channels": [{"number": c["number"], "name": c["name"], "camera": c["camera"]} for c in self.channels()],
                "viewers": self.viewers.snapshot(now), "heartbeats": self.heartbeats,
                "sessions": [{"channel": s.channel, "session": s.id[:8], "candidates": s.candidates}
                             for s in self.sessions.values()],
                "streams": sorted(self.streams.values()), "error": self.error,
                "log": list(self.log[-20:])}


# ------------------------------------------------------------------------------------- registration
ROUTE_RULES: dict[str, str] = {
    CHANNELS_TYPE: "Mantel runs Live TV: feature:live_tv, then each channel only if the subject may view its camera "
                   "(its now sensor only if viewable); otherwise the interim filtered read to HA (readproxy)",
    CONFIG: "a channel camera Mantel serves: feature:live_tv + camera.live; any other camera: the camera connector",
    OFFER: "a channel camera Mantel serves: feature:live_tv + camera.live, then go2rtc; any other camera: the camera connector",
    CANDIDATE: "a channel camera Mantel serves: only into a session of this connection; any other: the camera connector",
}


def register(app: web.Application, hub: Any, hooks: Any = None, tv_hooks: LiveTvHooks | None = None) -> MantelLiveTv:
    """Install ``app["live_tv"]``: the channel list route, the channel cameras' signaling (wrapping the
    camera connector's routes), the ``tv_watching`` message, the status route and the hub callbacks."""
    if "live_tv" in app:
        return app["live_tv"]
    hooks = Hooks.coerce(hooks)
    tv = MantelLiveTv(app, hub, hooks, tv_hooks)
    app["live_tv"] = tv
    routes = read_routes(app)
    camera = {t: routes.get(t) for t in (CONFIG, OFFER, CANDIDATE)}

    def request_route(t: str, ours: Callable[[Ctx, dict], Awaitable[Any]]):
        async def handler(ctx: Ctx, msg: dict):
            if tv.ours(msg):
                return await ours(ctx, msg)
            base = camera.get(t)
            if base is None or base.request is None:
                raise ConnectionError("unavailable")
            return await base.request(ctx, msg)
        return handler

    async def offer(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        msg, _ = split_quality(msg)                # a channel has one transcode; the camera connector drops it too
        if tv.ours(msg):
            return await tv.offer(ctx, msg, on_event)
        base = camera.get(OFFER)
        if base is None or base.subscribe is None:
            raise ConnectionError("unavailable")
        return await base.subscribe(ctx, msg, on_event)

    routes.update({
        CHANNELS_TYPE: Route(request=tv.channel_list),
        CONFIG: Route(request=request_route(CONFIG, tv.client_config)),
        CANDIDATE: Route(request=request_route(CANDIDATE, tv.candidate)),
        OFFER: Route(subscribe=offer),
    })

    async def tv_watching(ctx: Ctx, msg: dict) -> None:
        rid, ch, tb = msg.get("id"), msg.get("channel"), msg.get("tablet")
        if set(msg) - {"type", "id", "channel", "tablet"} or not (ch is None or (isinstance(ch, str) and _CHANNEL.match(ch))) \
                or not (tb is None or (isinstance(tb, str) and 0 < len(tb) <= 64)):
            return await ctx.send({"type": "tv_watching_result", "id": rid, "error": {"code": "invalid"}})
        try:
            result = await tv.watching(ctx.identity, ch, tb)
        except Forbidden:
            return await ctx.send({"type": "tv_watching_result", "id": rid, "error": {"code": "forbidden"}})
        except LookupError:
            return await ctx.send({"type": "tv_watching_result", "id": rid, "error": {"code": "not_found"}})
        await ctx.send({"type": "tv_watching_result", "id": rid, "result": result})

    ws_handlers(app)["tv_watching"] = tv_watching

    @guard("manager")
    async def api_status(request: web.Request) -> web.Response:
        return web.json_response(tv.status())

    app.router.add_get("/api/live_tv/status", api_status)

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            try:
                tv.on_change(set(changed))
            except Exception:  # noqa: BLE001 -- never break the hub's own callback
                log.exception("Live TV: a state change failed")

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            try:
                tv.on_registry()
            except Exception:  # noqa: BLE001
                log.exception("Live TV: a registry reload failed")
        ha.on_change, ha.on_registry = on_change, on_registry

    async def start(_app: web.Application) -> None:
        await tv.start()

    async def stop(_app: web.Application) -> None:
        await tv.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return tv
