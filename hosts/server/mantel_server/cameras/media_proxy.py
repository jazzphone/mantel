"""Music Assistant's web app and go2rtc, served under Mantel's own address (``/ma/…``, ``/go2rtc/…``).

WHY. An https Mantel cannot frame ``http://ma:8095`` (mixed content: the browser blanks the frame) nor
open ``ws://`` to go2rtc (docs/phase3/PACKAGING.md "mixed content"). Served by Mantel, both are
same-origin with HK's page, on whatever TLS Mantel's proxy (Caddy, the home's own, HA's Ingress) gives
it, and behind Mantel's sign-in.

RULES (docs/phase3/PACKAGING.md "Music Assistant and go2rtc through Mantel"):

* **Never an open proxy.** Each upstream is ONE configured base URL (``--ma-web-url`` / ``--go2rtc-url``);
  the page names only a path under it, checked against an allowlist of exactly what HK needs (``MA_*``,
  ``GO2RTC_*`` below). ``..``, empty segments, backslashes, control characters: refused. Anything else
  answers 404 without contacting the upstream.
* **Mantel's sign-in and RBAC first.** The session middleware has already refused anonymous requests.
  Music Assistant: ``control`` on the feature ``music`` (its web app plays and queues music). go2rtc: per
  stream (``Go2rtcStreams``): a stream registered as a camera's needs that camera's live view
  (authz.may_view, the same rule as the WebRTC signaling); a Live TV stream needs a signed-in person or
  device (as the Live TV guide does); an unknown stream is refused. Long-lived sockets are re-checked
  every ``RECHECK`` seconds and closed when the session, the device or the grant is gone; so is every answer
  that streams (a camera's MJPEG or MP4, HLS segments), cut off at its person's revocation (``live.py``) or
  at the next ``RECHECK``.
* **Nothing about the upstream reaches the page.** Requests go out with a short allowlist of headers
  (never Mantel's cookies, ``Authorization``, ``Origin`` or the forwarding headers); answers come back
  with a short allowlist (never ``Set-Cookie``, ``Server``, the upstream's own CSP); a redirect to the
  upstream's own address is moved under the prefix; Music Assistant's text answers and WebSocket frames
  have the upstream's address (the configured one, and the ``base_url`` MA announces in its
  ``server_info``) replaced by the page's own ``https://<host>[<ingress prefix>]/ma``. Errors name the
  service, never its address. No credential is added for the page: Music Assistant's own sign-in, if it
  has one, shows inside the frame (the person's MA account, not Mantel's MA token).
* **Prefix-aware.** Through HA's Ingress the page's prefix comes first (``<prefix>/ma/``); redirects
  are moved under it by ingress.py, and the rewritten addresses carry it.

go2rtc's paths are the viewing ones only (its WebRTC/MSE socket, the frame, MP4/HLS/MJPEG streams and its two
player modules; not the WHEP-style ``POST /api/webrtc``: its peer connection runs between go2rtc and the
viewer, past Mantel, so a revoked person's could not be ended; Mantel's own pages use the camera offers over
their socket, which are counted and re-checked); stream management (``/api/streams``),
configuration, restart, logs and its own web pages are never reachable. Stream SETUP is Live TV's job
(features.py, go2rtc's API from the server side); it tells this module which stream is what with
``app["go2rtc_streams"].allow(src, "live_tv")`` / ``.allow(src, "camera", entity_id)``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import quote, urlsplit

import aiohttp
from aiohttp import WSMsgType, web

from ..network import proxy_trust
from ..identity import sessions
from ..identity.guards import WHY_PROXY, guard, open_route
from ..connectors.kiosk import read_body     # the whole body, every piece (one read() is only the first)

log = logging.getLogger("mantel.media_proxy")

MA, GO2RTC = "/ma", "/go2rtc"
ALIAS_PATH = "hassio_ingress/mantel/"    # = ma_page.ALIAS
SERVICES_PATH = "/api/services"
RECHECK = 60.0
MAX_BODY = 1 << 20                  # a request body (MA's forms, a WebRTC offer)
MAX_REWRITE = 16 << 20              # a text answer of MA's that gets its upstream address replaced
MAX_WS_MSG = 16 << 20
CHUNK = 64 << 10

REQ_HEADERS = ("Accept", "Accept-Language", "Content-Type", "Range", "If-None-Match", "If-Modified-Since",
               "If-Range", "Cache-Control", "User-Agent")
RESP_HEADERS = ("Content-Type", "Cache-Control", "ETag", "Last-Modified", "Content-Range", "Accept-Ranges",
                "Expires", "Content-Disposition", "Content-Language")
WS_SUBPROTOCOL = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
REWRITE_TYPES = ("text/html", "text/css", "text/javascript", "application/javascript", "application/json",
                 "text/plain", "application/manifest+json")

# -- Music Assistant: its web app (a Vue app built to run under a prefix, as it does under HA's
# Ingress), its WebSocket API, its image proxy and its own sign-in pages. Never its JSON-RPC HTTP API.
MA_STATIC = re.compile(r"^(?:|index\.html|[A-Za-z0-9._-]+\.(?:js|mjs|css|png|svg|ico|webmanifest|json|woff2?|ttf|"
                       r"map|txt|webp|jpg|jpeg|gif)|(?:assets|img|images|icons|fonts|static)/[A-Za-z0-9._/@-]+)$")
# (imageproxy/<proxy_id> is Music Assistant 2.10's image proxy: a 64-hex id it hands out; the bare form is older MA's)
MA_GET_EXTRA = re.compile(r"^(?:imageproxy|imageproxy/[0-9a-f]{64}|info|login|auth/[A-Za-z0-9._/-]+)$")
MA_POST = re.compile(r"^(?:login|auth/[A-Za-z0-9._/-]+)$")
MA_WS = frozenset({"ws"})
MA_DENY = re.compile(r"^(?:api|api-docs|jsonrpc)(?:/|$)")

# -- go2rtc: viewing only.
SRC = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
HLS_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
HLS_ID_IN_PLAYLIST = re.compile(r"[?&]id=([A-Za-z0-9_-]{1,64})")
MAX_PLAYLIST = 256 << 10            # go2rtc's master playlist: a few lines
G_WS = {"api/ws": frozenset({"src", "media"})}
G_POST: dict[str, frozenset] = {}      # no WHEP: see the module doc
G_GET = {
    "api/frame.jpeg": frozenset({"src", "width", "height", "w", "h", "cache"}),
    "api/stream.mp4": frozenset({"src", "mp4", "duration", "media"}),
    "api/stream.m3u8": frozenset({"src", "mp4", "media"}),
    "api/stream.mjpeg": frozenset({"src"}),
    "api/hls/playlist.m3u8": frozenset({"id"}),
    "api/hls/segment.ts": frozenset({"id", "n"}),
    "api/hls/segment.m4s": frozenset({"id", "n"}),
    "api/hls/init.mp4": frozenset({"id"}),
    "video-rtc.js": frozenset(),
    "video-stream.js": frozenset(),
}


def _error(status: int, code: str, service: str | None = None) -> web.Response:
    body = {"error": code}
    if service:
        body["service"] = service
    return web.json_response(body, status=status, headers={"Cache-Control": "no-store"})


def safe_tail(tail: str) -> str | None:
    """The path under the prefix if it is plain (no '..', '.', empty inner segments, backslash or
    control characters), else None."""
    if not isinstance(tail, str) or len(tail) > 1024 or "\\" in tail or any(ord(c) < 32 or ord(c) == 127 for c in tail):
        return None
    parts = tail.split("/")
    for i, seg in enumerate(parts):
        if seg in (".", ".."):
            return None
        if seg == "" and i != len(parts) - 1:
            return None
    return tail


def is_ws_upgrade(request: web.Request) -> bool:
    return request.method == "GET" and request.headers.get("Upgrade", "").lower() == "websocket"


# -- go2rtc's streams: which is what -------------------------------------------------------------------
class Go2rtcStreams:
    """Which go2rtc stream is what, for the per-stream decision. Live TV (or whatever sets a stream up
    in go2rtc) registers it; a stream named like a camera entity (``camera.front_door``) is that
    camera's even unregistered; anything else is refused."""

    CAMERA_NAME = re.compile(r"^camera\.[a-z0-9_]+$")

    def __init__(self) -> None:
        self._kinds: dict[str, tuple[str, str | None]] = {}
        self._channels: frozenset[str] = frozenset()

    def set_channel_cameras(self, cameras) -> None:
        """Live TV's channel cameras (``camera.tv_*``, live_tv.py). They are not go2rtc streams of their
        own (a channel plays as ``mantel_tv_<n>``), so asking for one by name is refused rather than
        taken for an ordinary camera, which would skip the Live TV feature check."""
        self._channels = frozenset(c for c in cameras if isinstance(c, str))

    def allow(self, src: str, kind: str, entity_id: str | None = None) -> None:
        if not SRC.match(src or ""):
            raise ValueError(f"not a go2rtc stream name: {src!r}")
        if kind not in ("live_tv", "camera"):
            raise ValueError("kind must be 'live_tv' or 'camera'")
        if kind == "camera" and not (entity_id and self.CAMERA_NAME.match(entity_id)):
            raise ValueError("a camera stream names its camera entity")
        self._kinds[src] = (kind, entity_id)

    def forget(self, src: str) -> None:
        self._kinds.pop(src, None)

    def kind_of(self, src: str) -> tuple[str, str | None] | None:
        got = self._kinds.get(src)
        if got is not None:
            return got
        if src in self._channels:
            return None
        if self.CAMERA_NAME.match(src or ""):
            return ("camera", src)
        return None

    def may(self, authz: Any, principal: Any, src: str) -> bool:
        got = self.kind_of(src)
        if got is None or principal is None or not getattr(principal, "valid", False):
            return False
        kind, entity = got
        if kind == "camera":
            return authz is not None and authz.may_view(principal, entity) is True
        return self.may_live_tv(authz, principal, entity)

    @staticmethod
    def may_live_tv(authz: Any, principal: Any, camera: str | None) -> bool:
        """THE Live TV rule, for both of its doors: live_tv.py's signaling (offer, candidates, client
        config, and its re-check of open sessions) and a Live TV stream asked for under ``/go2rtc/``.
        The ``live_tv`` feature (``view``), then camera live view on the channel's camera (when named)."""
        if authz is None or principal is None or not getattr(principal, "valid", False):
            return False
        ident = getattr(principal, "identity", None)
        if ident is None or (ident.user is None and ident.device is None):
            return False
        if not authz.decide(principal.subject, "view", None, feature="live_tv").allowed:
            return False
        return camera is None or authz.may_view(principal, camera) is True


# -- the two upstreams -----------------------------------------------------------------------------------
@dataclass
class Plan:
    """What one request becomes: the upstream path + query, and whether it is a socket."""
    path: str
    query: str
    ws: bool
    rewrite: bool
    signed: bool = False      # Music Assistant under ma_page.ALIAS: signed in with the page token (ma_page.py)


class Upstream:
    name = ""
    prefix = ""
    service = ""

    def __init__(self, base: "str | Callable[[], str]") -> None:
        # the address is read at each request: Music Assistant's comes from the Connections page and
        # changes without a restart (connections.py hot apply)
        self._source = base if callable(base) else (lambda: base)

    @property
    def base(self) -> str:
        raw = (self._source() or "").strip()
        if not raw:
            return ""
        parts = urlsplit(raw)
        return f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"

    @property
    def origin(self) -> str:
        parts = urlsplit(self.base)
        return f"{parts.scheme}://{parts.netloc}" if parts.netloc else ""

    def plan(self, request: web.Request, tail: str) -> Plan | None:
        raise NotImplementedError

    def authorize(self, app: web.Application, principal: Any, plan: Plan, request: web.Request) -> bool:
        raise NotImplementedError

    def url(self, plan: Plan, ws: bool = False) -> str:
        u = f"{self.base}/{quote(plan.path, safe='/._-~@')}"
        if plan.query:
            u += "?" + plan.query
        if ws:
            u = "ws" + u[4:] if u.startswith("http:") else "wss" + u[5:]
        return u


class MusicAssistant(Upstream):
    name, prefix, service = "music_assistant", MA, "Music Assistant"

    def __init__(self, base: "str | Callable[[], str]") -> None:
        super().__init__(base)
        self.announced: set[str] = set()   # base_url values MA announced in server_info (also replaced)

    def plan(self, request: web.Request, tail: str) -> Plan | None:
        from ..ma_page import ALIAS
        signed = tail.startswith(ALIAS) or tail == ALIAS.rstrip("/")
        if signed:
            tail = tail[len(ALIAS):]
        got = self._plan(request, tail)
        if got is not None and signed:
            got.signed = True
        return got

    def _plan(self, request: web.Request, tail: str) -> Plan | None:
        if MA_DENY.match(tail):
            return None
        query = request.query_string
        if len(query) > 4096:
            return None
        if is_ws_upgrade(request):
            return Plan(tail, query, True, False) if tail in MA_WS else None
        if request.method in ("GET", "HEAD"):
            if MA_STATIC.match(tail) or MA_GET_EXTRA.match(tail):
                return Plan(tail, query, False, True)
            return None
        if request.method == "POST" and MA_POST.match(tail):
            return Plan(tail, query, False, True)
        return None

    def authorize(self, app, principal, plan, request) -> bool:
        authz = app.get("authz")
        if authz is None or principal is None or not principal.valid:
            return False
        return authz.decide(principal.subject, "control", None, feature="music").allowed is True

    # what a signed-in page can do: everything the page token's MA user can, on every player, straight to MA
    SIGNED_ACTIONS = ("media_player.play_media", "media_player.join", "media_player.volume_set")

    def may_sign(self, app, principal) -> bool:
        """Whether this socket may be signed in with the page token (ma_page.py). A signed page sends Music
        Assistant's own commands past the gateway, so it is given only to someone the gateway would let do
        all of it: house commands on, and every speaker Mantel knows (Music Assistant's players in Home
        Assistant) theirs to play, group and turn up. Anyone else (a Child kept to their rooms, a wall
        tablet) gets the page unsigned: Music Assistant's own sign-in, its own accounts."""
        from ..music import ma_players
        authz, hub = app.get("authz"), app.get("hub")
        if app.get("gateway") is None or authz is None or hub is None or principal is None or not principal.valid:
            return False
        speakers = ma_players(hub.registry)
        if not speakers:
            return False
        ctx = authz.context()
        return all(authz.decide(principal.subject, action, eid, ctx=ctx).allowed
                   for eid in speakers for action in self.SIGNED_ACTIONS)

    def rewriter(self, public_base: str) -> Callable[[str], str]:
        olds = sorted({self.origin, self.base, *self.announced}, key=len, reverse=True)
        olds = [o.rstrip("/") for o in olds if o]

        def rewrite(text: str) -> str:
            for old in olds:
                if old in text:
                    text = text.replace(old, public_base)
            return text
        return rewrite

    def learn(self, text: str) -> None:
        """MA's first frame (server_info) names its own base_url: replace that address too."""
        m = re.search(r'"base_url"\s*:\s*"(https?://[^"\s]{1,200})"', text)
        if m:
            got = m.group(1).rstrip("/")
            if got not in self.announced and len(self.announced) < 8:
                self.announced.add(got)


class Go2rtc(Upstream):
    name, prefix, service = "go2rtc", GO2RTC, "go2rtc"
    HLS_KEEP = 1024                          # HLS session ids remembered with the stream each was issued for

    def __init__(self, base: "str | Callable[[], str]") -> None:
        super().__init__(base)
        self.hls: OrderedDict[str, str] = OrderedDict()

    def learn_hls(self, src: str, playlist: str) -> None:
        """go2rtc's master playlist (``api/stream.m3u8?src=``) names the HLS session it made for this
        person; remember which stream it is for, so the session id is only good for that one."""
        for m in HLS_ID_IN_PLAYLIST.finditer(playlist):
            self.hls[m.group(1)] = src
            self.hls.move_to_end(m.group(1))
        while len(self.hls) > self.HLS_KEEP:
            self.hls.popitem(last=False)

    def plan(self, request: web.Request, tail: str) -> Plan | None:
        if is_ws_upgrade(request):
            table = G_WS
        elif request.method in ("GET", "HEAD"):
            table = G_GET
        elif request.method == "POST":
            table = G_POST
        else:
            return None
        allowed = table.get(tail)
        if allowed is None:
            return None
        q = request.query
        if set(q) - allowed or any(len(q.getall(k)) != 1 for k in q):
            return None
        if "src" in allowed and tail not in ("video-rtc.js", "video-stream.js"):
            if not SRC.match(q.get("src", "")):
                return None
        if "id" in allowed and not HLS_ID.match(q.get("id", "")):
            return None
        for k in set(q) - {"src", "id"}:
            if not re.fullmatch(r"[A-Za-z0-9_,.=-]{0,64}", q[k]):
                return None
        query = "&".join(f"{quote(k)}={quote(q[k], safe=':.-_,')}" for k in sorted(q))
        return Plan(tail, query, table is G_WS, False)

    def authorize(self, app, principal, plan, request) -> bool:
        if principal is None or not principal.valid:
            return False
        if plan.path in ("video-rtc.js", "video-stream.js"):
            return True                       # go2rtc's player modules: static code, nothing of the house
        if plan.path.startswith("api/hls/"):
            # an HLS id is go2rtc's own random session id, handed out in the answer to a stream.m3u8 (that was
            # authorized for its src); it is good for that src's viewers only, so each request asks the same
            # question the playlist did. An id Mantel did not see issued (or forgot) is refused.
            src = self.hls.get(request.query.get("id", ""))
            if src is None:
                return False
            self.hls.move_to_end(request.query["id"])
        else:
            src = request.query.get("src", "")
        return app["go2rtc_streams"].may(app.get("authz"), principal, src)


# -- the handler ----------------------------------------------------------------------------------------
def public_base(request: web.Request, prefix: str) -> str:
    """https://<host>[<ingress prefix>]/ma : what the page uses for the upstream."""
    return proxy_trust.public_origin(request) + request.get("mantel_base", "") + prefix


def _req_headers(request: web.Request) -> dict[str, str]:
    return {k: request.headers[k] for k in REQ_HEADERS if k in request.headers}


def _resp_headers(up_headers, extra: dict | None = None) -> dict[str, str]:
    out = {k: up_headers[k] for k in RESP_HEADERS if k in up_headers}
    out.update(extra or {})
    return out


def _location(up: Upstream, location: str) -> str | None:
    """An upstream redirect, moved under the prefix (ingress.py adds the Ingress prefix); None when it
    leaves the upstream (refused: Mantel never redirects a page to the upstream's own address)."""
    parts = urlsplit(location)
    if parts.scheme or parts.netloc:
        if f"{parts.scheme}://{parts.netloc}" != up.origin:
            return None
        path = parts.path
        base_path = urlsplit(up.base).path
        if base_path and path.startswith(base_path):
            path = path[len(base_path):]
    else:
        path = parts.path
        if not path.startswith("/"):
            return location     # relative to the current page: already under the prefix
    out = up.prefix + (path if path.startswith("/") else "/" + path)
    if parts.query:
        out += "?" + parts.query
    if parts.fragment:
        out += "#" + parts.fragment
    return out


class MediaProxy:
    def __init__(self, app: web.Application, upstreams: list[Upstream]) -> None:
        self.app = app
        self.upstreams = {u.prefix: u for u in upstreams}
        self.http: aiohttp.ClientSession | None = None
        self.sockets: set[web.WebSocketResponse] = set()
        self.stats = {u.name: {"served": 0, "refused": 0, "not_allowed": 0, "upstream_errors": 0} for u in upstreams}

    async def start(self, app: web.Application) -> None:
        # its own session: no cookie jar (an upstream's cookies must never be shared between people)
        self.http = aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar(), auto_decompress=True,
                                          timeout=aiohttp.ClientTimeout(total=None, connect=10, sock_read=120))

    async def stop(self, app: web.Application) -> None:
        for ws in list(self.sockets):
            await ws.close(code=1001, message=b"server shutting down")
        if self.http is not None:
            await self.http.close()

    def handler(self, up: Upstream):
        # what the service's grant decides: Music Assistant is the music feature's, go2rtc's streams are each camera's
        # (Go2rtcStreams.may: the same ``view`` as the camera's own routes)
        reads = "feature:music" if up.name == MusicAssistant.name else "view"

        @open_route("proxy", why=WHY_PROXY, reads=reads, stream="live:media_proxy")
        async def handle(request: web.Request) -> web.StreamResponse:
            stats = self.stats[up.name]
            if not up.base:
                return _error(404, "not_configured", up.service)
            tail = safe_tail(request.match_info.get("tail", ""))
            if tail is None:
                stats["not_allowed"] += 1
                return _error(404, "not_found", up.service)
            plan = up.plan(request, tail)
            if plan is None:
                stats["not_allowed"] += 1
                return _error(404, "not_found", up.service)
            authz = request.app.get("authz")
            principal = authz.principal(request) if authz is not None else None
            # a screen preview an assistant opened (mcp/preview.py) looks only: Music Assistant's own app and
            # go2rtc's API would let it act, so neither is reached from one
            if principal is not None and principal.identity.read_only or \
                    not up.authorize(request.app, principal, plan, request):
                stats["refused"] += 1
                return _error(403, "forbidden", up.service)
            if plan.ws:
                if request.headers.get("Origin") is None:
                    return _error(403, "origin_required", up.service)   # loopback_only checked its value
                return await self.relay(request, up, plan, principal)
            return await self.forward(request, up, plan, principal)
        return handle

    async def forward(self, request: web.Request, up: Upstream, plan: Plan, principal: Any = None) -> web.StreamResponse:
        stats = self.stats[up.name]
        body = None
        if request.method == "POST":
            if request.content_length is not None and request.content_length > MAX_BODY:
                return _error(413, "too_large", up.service)
            try:
                body = await request.read()          # the app's client_max_size (1 MiB) bounds it too
            except web.HTTPRequestEntityTooLarge:
                return _error(413, "too_large", up.service)
            if len(body) > MAX_BODY:
                return _error(413, "too_large", up.service)
        try:
            async with self.http.request(request.method, up.url(plan), headers=_req_headers(request), data=body,
                                         allow_redirects=False) as r:
                if 300 <= r.status < 400 and "Location" in r.headers:
                    moved = _location(up, r.headers["Location"])
                    if moved is None:
                        stats["upstream_errors"] += 1
                        return _error(502, "upstream_redirect_refused", up.service)
                    return web.Response(status=r.status, headers=_resp_headers(r.headers, {"Location": moved}))
                ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if isinstance(up, MusicAssistant) and plan.rewrite and ctype in REWRITE_TYPES \
                        and request.method != "HEAD":
                    raw = await read_body(r.content, MAX_REWRITE)
                    if len(raw) > MAX_REWRITE:
                        stats["upstream_errors"] += 1
                        return _error(502, "upstream_answer_too_large", up.service)
                    charset = r.charset or "utf-8"
                    text = raw.decode(charset, errors="surrogateescape")
                    up.learn(text)
                    text = up.rewriter(public_base(request, up.prefix))(text)
                    stats["served"] += 1
                    return web.Response(status=r.status, body=text.encode(charset, errors="surrogateescape"),
                                        headers=_resp_headers(r.headers))
                if isinstance(up, Go2rtc) and plan.path == "api/stream.m3u8" and r.status == 200 \
                        and request.method == "GET":
                    raw = await read_body(r.content, MAX_PLAYLIST)
                    if len(raw) > MAX_PLAYLIST:
                        stats["upstream_errors"] += 1
                        return _error(502, "upstream_answer_too_large", up.service)
                    up.learn_hls(request.query.get("src", ""), raw.decode("utf-8", errors="replace"))
                    stats["served"] += 1
                    return web.Response(status=r.status, body=raw, headers=_resp_headers(r.headers))
                resp = web.StreamResponse(status=r.status, headers=_resp_headers(r.headers))
                if r.content_length is not None and "Content-Encoding" not in r.headers:
                    resp.content_length = r.content_length
                await resp.prepare(request)
                if request.method == "HEAD":
                    await resp.write_eof()
                    stats["served"] += 1
                    return resp
                return await self.pump(request, up, plan, principal, r, resp)
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            stats["upstream_errors"] += 1
            log.warning("%s did not answer %s (%s)", up.service, plan.path or "/", type(exc).__name__)
            return _error(502, "upstream_unavailable", up.service)

    async def pump(self, request: web.Request, up: Upstream, plan: Plan, principal: Any, r: aiohttp.ClientResponse,
                   resp: web.StreamResponse) -> web.StreamResponse:
        """The upstream's answer to the person, chunk by chunk (a camera's MJPEG or MP4 may never end). Like a
        relayed socket it is one of live.py's long-lived connections: a revocation, the policy tick or its own
        ``RECHECK`` cuts it off (the upstream's side too) when the session, the device or the grant is gone."""
        from .. import live
        stats = self.stats[up.name]
        registry = live.of(request.app)
        authz = request.app.get("authz")
        cut = False

        async def close(why: str) -> None:
            nonlocal cut
            cut = True
            if why != live.SHUTDOWN:
                log.info("closing a %s stream (%s)", up.service, why)
            r.close()                                  # go2rtc's side
            if request.transport is not None:
                request.transport.close()              # the person's

        def recheck() -> bool:
            return up.authorize(request.app, principal, plan, request)
        entry = registry.add(f"media_proxy:{up.name}", principal, close, recheck=recheck) \
            if registry is not None else None

        async def watch() -> None:                     # the session, the device and the grant, again and again
            while True:
                await asyncio.sleep(RECHECK)
                if authz is None or principal is None or not authz.refresh(principal) \
                        or not up.authorize(request.app, principal, plan, request):
                    await close("no_longer_allowed")
                    return
        watcher = asyncio.create_task(watch())
        try:
            async for chunk in r.content.iter_chunked(CHUNK):
                await resp.write(chunk)
            await resp.write_eof()
            stats["served"] += 1
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
            # the headers are out: the person left, the upstream dropped, or it was cut off here. There is no
            # answer left to give; the connection ends.
            if not cut:
                log.debug("a %s stream ended early", up.service, exc_info=True)
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
            if entry is not None:
                entry.forget()
        return resp

    async def sign_in(self, request: web.Request, up: "MusicAssistant", upstream, ws, rewrite) -> bool:
        """ma_page.py: authenticate this socket to MA with the page token, then give the page MA's
        server_info saying `homeassistant_addon: true`, so MA's app asks `auth/me` instead of signing in.
        False (and server_info passed on as it came) without a token or when MA refuses it."""
        from ..ma_page import of
        page = of(request.app)
        token = page.token() if page is not None else ""
        first = await upstream.receive(timeout=15)
        if first.type != WSMsgType.TEXT:
            return False
        text = first.data
        up.learn(text)
        ok_ = False
        if token:
            try:
                await upstream.send_str(json.dumps({"message_id": "mantel-page-auth", "command": "auth",
                                                    "args": {"token": token, "device_name": "Mantel"}}))
                while True:
                    m = await upstream.receive(timeout=15)
                    if m.type != WSMsgType.TEXT:
                        break
                    got = json.loads(m.data)
                    if isinstance(got, dict) and got.get("message_id") == "mantel-page-auth":
                        res = got.get("result")
                        ok_ = isinstance(res, dict) and res.get("authenticated") is True
                        break
            except (asyncio.TimeoutError, ValueError, aiohttp.ClientError) as exc:
                log.warning("Music Assistant page sign-in failed (%s)", type(exc).__name__)
            if not ok_:
                log.warning("Music Assistant refused the page token; the frame shows MA's own sign-in")
        if ok_:
            try:
                info = json.loads(text)
                if isinstance(info, dict):
                    info["homeassistant_addon"] = True
                    text = json.dumps(info)
            except ValueError:
                ok_ = False
        await ws.send_str(up.rewriter(public_base(request, up.prefix))(text) if rewrite is not None else text)
        return ok_

    async def relay(self, request: web.Request, up: Upstream, plan: Plan, principal: Any) -> web.StreamResponse:
        stats = self.stats[up.name]
        protocols = [p.strip() for p in request.headers.get("Sec-WebSocket-Protocol", "").split(",")
                     if WS_SUBPROTOCOL.match(p.strip())]
        try:
            upstream = await self.http.ws_connect(up.url(plan, ws=True), headers=_req_headers(request),
                                                  protocols=protocols, max_msg_size=MAX_WS_MSG, heartbeat=30,
                                                  autoping=True)
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            stats["upstream_errors"] += 1
            log.warning("%s refused its socket (%s)", up.service, type(exc).__name__)
            return _error(502, "upstream_unavailable", up.service)
        ws = web.WebSocketResponse(heartbeat=30, max_msg_size=MAX_WS_MSG,
                                   protocols=[upstream.protocol] if upstream.protocol else ())
        try:
            await ws.prepare(request)
        except Exception:
            await upstream.close()
            raise
        self.sockets.add(ws)
        stats["served"] += 1
        base = public_base(request, up.prefix)
        rewrite = up.rewriter(base) if isinstance(up, MusicAssistant) else None
        signed_in = False
        if plan.signed and isinstance(up, MusicAssistant) and up.may_sign(request.app, principal):
            signed_in = await self.sign_in(request, up, upstream, ws, rewrite)
            if signed_in:
                _audit_signed_page(request.app, principal)

        async def down() -> None:            # upstream -> page
            nonlocal rewrite
            async for m in upstream:
                if m.type == WSMsgType.TEXT:
                    text = m.data
                    if rewrite is not None:
                        before = len(up.announced)
                        up.learn(text)
                        if len(up.announced) != before:
                            rewrite = up.rewriter(base)
                        text = rewrite(text)
                    await ws.send_str(text)
                elif m.type == WSMsgType.BINARY:
                    await ws.send_bytes(m.data)
                else:
                    break

        async def upward() -> None:          # page -> upstream
            from ..ma_page import BLOCKED
            async for m in ws:
                if m.type == WSMsgType.TEXT:
                    if signed_in:
                        refused = _blocked_command(m.data, BLOCKED)
                        if refused is not None:
                            await ws.send_str(refused)
                            continue
                    await upstream.send_str(m.data)
                elif m.type == WSMsgType.BINARY:
                    await upstream.send_bytes(m.data)
                else:
                    break

        # live.py: a revocation ends it at once, the policy tick when the grant is gone; a page signed in past the
        # gateway needs house commands on (and every speaker still theirs), so turning them off ends it
        from .. import live
        registry = live.of(request.app)

        async def close(why: str) -> None:
            if why == live.SHUTDOWN:
                await ws.close(code=1001, message=b"server shutting down")
            else:
                log.info("closing a %s socket (%s)", up.service, why)
                await ws.close()

        def recheck() -> bool:
            return up.authorize(request.app, principal, plan, request) and \
                (not signed_in or up.may_sign(request.app, principal))   # type: ignore[union-attr]
        entry = registry.add(f"media_proxy:{up.name}", principal, close, recheck=recheck, needs_commands=signed_in) \
            if registry is not None else None

        async def watch() -> None:           # the session, the device and the grant, again and again
            authz = request.app.get("authz")
            while True:
                await asyncio.sleep(RECHECK)
                if authz is None or principal is None or not authz.refresh(principal) \
                        or not up.authorize(request.app, principal, plan, request):
                    log.info("closing a %s socket: its session or grant ended", up.service)
                    return

        tasks = [asyncio.create_task(down()), asyncio.create_task(upward()), asyncio.create_task(watch())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await upstream.close()
            await ws.close()
            self.sockets.discard(ws)
            if entry is not None:
                entry.forget()
        return ws


def _audit_signed_page(app, principal) -> None:
    """A signed Music Assistant page is written down when it opens: what it sends after that goes to Music
    Assistant directly (MusicAssistant.may_sign says who may have one)."""
    audit = app.get("audit")
    if audit is None:
        return
    ident = principal.identity
    user, device = ident.user, ident.device
    audit.config_event({"actor": user.id if user else None, "role": user.role if user else None,
                        "device": device.id if device else None, "device_role": device.role if device else None,
                        "action": "music.page_signed_in", "detail": {"page": "music_assistant"},
                        "reason": "every_speaker", "door": ident.door, "source_ip": principal.source_ip})


def _blocked_command(text: str, blocked: frozenset) -> str | None:
    """On a socket Mantel signed in (ma_page.py): MA's answer refusing a command that would end or change
    that sign-in, or None to pass the frame on."""
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    if isinstance(msg, dict) and msg.get("command") in blocked:
        return json.dumps({"message_id": msg.get("message_id"), "error_code": 403,
                           "details": "Not through Mantel: this page is signed in to Music Assistant by Mantel."})
    return None


def ma_web_url(cfg, conns: Any = None) -> str:
    """Music Assistant's web app: ``--ma-web-url`` if set, else the host of MA's address (the Connections
    page's, else the installation's ``--ma-url``): ws://ma:8095/ws -> http://ma:8095."""
    explicit = getattr(cfg, "ma_web_url", "") or ""
    if explicit:
        return explicit
    url = ""
    if conns is not None:
        try:
            url = conns.effective_url("ma") or ""
        except Exception:  # noqa: BLE001 -- no MA connection readable: off
            url = ""
    url = url or getattr(cfg, "ma_url", "") or ""
    p = urlsplit(url)
    if not p.netloc:
        return ""
    scheme = {"ws": "http", "wss": "https"}.get(p.scheme, p.scheme)
    if scheme not in ("http", "https"):
        return ""
    path = p.path.rstrip("/")
    path = path[:-3] if path.endswith("/ws") else path
    return f"{scheme}://{p.netloc}{path}"


def upstreams_for(app: web.Application) -> list[Upstream]:
    """Both upstreams, always (each answers ``not_configured`` while it has no address). go2rtc's address
    is Live TV's (live_tv.go2rtc_api_url: the one place it is read)."""
    from ..live_tv import go2rtc_api_url
    cfg = app["cfg"]
    return [MusicAssistant(lambda: ma_web_url(cfg, app.get("connections"))),
            Go2rtc(lambda: go2rtc_api_url(cfg))]


def services_for(app: web.Application, principal: Any) -> dict[str, str | None]:
    """Which of the two this identity may use, as paths under the page's prefix (None: off or refused)."""
    proxy: MediaProxy | None = app.get("media_proxy")
    out: dict[str, str | None] = {"music_assistant": None, "go2rtc": None}
    if proxy is None:
        return out
    ma = proxy.upstreams.get(MA)
    if ma is not None and ma.base and ma.authorize(app, principal, Plan("", "", False, False), None):
        page = app.get("ma_page")
        # with the page token: the address under which Mantel signs the frame in (ma_page.py)
        out["music_assistant"] = MA + "/" + (ALIAS_PATH if page is not None and page.token() else "")
    g2 = proxy.upstreams.get(GO2RTC)
    if g2 is not None and g2.base and principal is not None and principal.valid and \
            (principal.identity.user is not None or principal.identity.device is not None):
        out["go2rtc"] = GO2RTC + "/"
    return out


def register(app: web.Application, hub: Any = None) -> MediaProxy | None:
    """``/ma/…`` and ``/go2rtc/…`` (each ``not_configured`` until it has an address) and ``GET /api/services``.
    Call after ``app["authz"]`` (and ``app["connections"]``) exist (server.wire)."""
    app.setdefault("go2rtc_streams", Go2rtcStreams())
    ups = upstreams_for(app)
    proxy = MediaProxy(app, ups)
    app["media_proxy"] = proxy

    @guard("signed_in", reads="self", preview=True)          # any session: the services its grants open (services_for)
    async def services(request: web.Request) -> web.Response:
        authz = request.app.get("authz")
        principal = authz.principal(request) if authz is not None else None
        if not sessions.identity(request).authenticated:
            raise web.HTTPUnauthorized()
        return web.json_response(services_for(request.app, principal), headers={"Cache-Control": "no-store"})

    app.router.add_get(SERVICES_PATH, services)
    for up in ups:
        @open_route("static", why="the proxy's bare address: a redirect to its tail route (MediaProxy.handler), which "
                                  "authorizes; it answers no house data")
        async def bare(request: web.Request, _p=up.prefix) -> web.StreamResponse:
            raise web.HTTPFound(_p + "/" + (f"?{request.query_string}" if request.query_string else ""))
        app.router.add_route("*", up.prefix, bare)
        app.router.add_route("*", up.prefix + "/{tail:.*}", proxy.handler(up))
    app.on_startup.append(proxy.start)
    app.on_cleanup.append(proxy.stop)
    return proxy
