"""The phone as a speaker: the app's own Music Assistant player ("This Device"), for CarPlay and Apple HomeView.

The iPhone app plays the house's music itself as a Sendspin player (Music Assistant's own playback protocol, the one
its web player and phone apps use): the sound comes out of the phone, so CarPlay's Now Playing and Apple HomeView show
the app as an audio app. Music Assistant listens for Sendspin players on its port 8927 (``ws://<ma>:8927/sendspin``),
on the house's network only; a phone in the car is not there. So the app's player connects through this door, with the
app's own credential, and Mantel passes its frames to Music Assistant as they are (Sendspin 1.0 encrypts them end to
end between the phone and Music Assistant with Noise; Mantel reads only the first, cleartext ``client/init``, for the
player's id). The phone's player is an ordinary Music Assistant player while it is connected ("Mantel on <phone>").

  GET  /api/app/music/device/socket   the player's socket (WebSocket): Music Assistant's Sendspin server, for as long
                                      as this credential may hear the music (``feature:music``); live.py ends it on a
                                      revocation. One per credential: a second one ends the first.
  POST /api/app/music/device/play     {media_content_id, media_content_type?} or {playlist: key}: Music Assistant plays
                                      that library item, or one of the house's playlists that this person sees (shuffled,
                                      as the rooms play it), on this credential's own player (``player_queues/*``), only
                                      while its socket is open and house commands are on, audited first
                                      (``music.device_play``) as the Music page's requests are; Music Assistant's gate
                                      allows that one player only (music.MusicRun).

Play, pause, next and the rest of the phone's own player are the Sendspin controller role's, on the socket; the
rooms stay the Music page's (app_music.py). Nothing here reaches any speaker of the house.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from urllib.parse import urlsplit

import aiohttp
from aiohttp import WSMsgType, web

from .app_auth import app_route
from ..connectors import may_feature
from ..identity.guards import WHY_APP, open_route
from ..identity.sessions import error, ok

log = logging.getLogger("mantel.app_music_device")

SENDSPIN_PORT = 8927                    # Music Assistant's Sendspin server (aiosendspin's default)
SENDSPIN_PATH = "/sendspin"
CLIENT_ID = re.compile(r"^[A-Za-z0-9_-]{43}$")    # Sendspin 1.0: the player's Curve25519 key, base64url, no padding
MEDIA_ID = re.compile(r"^[a-z][a-z0-9_+.-]{0,40}://\S{1,400}$")
MEDIA_TYPES = ("playlist", "album", "artist", "track", "radio", "podcast", "audiobook", "folder", "")
MAX_MSG = 4 << 20                       # an artwork frame is the biggest a player gets
FIRST_FRAME = 10.0                      # seconds for the app's client/init
RECHECK = 30.0
QUEUE_WAIT, QUEUE_WAITS = 0.25, 16      # up to 4 s for Music Assistant's universal player to appear
DEVICES = "music_devices"               # app[DEVICES]: {credential: its connected player's id}


def upstream_url(app: web.Application) -> str:
    """Music Assistant's Sendspin server: the host of Mantel's Music Assistant address, port 8927."""
    from ..cameras.media_proxy import ma_web_url
    base = ma_web_url(app["cfg"], app.get("connections"))
    host = urlsplit(base).hostname if base else None
    if not host:
        return ""
    return f"ws://{'[' + host + ']' if ':' in host else host}:{SENDSPIN_PORT}{SENDSPIN_PATH}"


def _principal(request: web.Request):
    authz = request.app.get("authz")
    return authz.principal(request) if authz is not None else None


def _hooks(request: web.Request):
    from ..connectors import Hooks
    authz = request.app.get("authz")
    return Hooks(may_read=authz.may_read) if authz is not None else Hooks()


def _credential(request: web.Request) -> str:
    ident = request.get("app_identity")
    return str(getattr(ident, "session_id", "") or "")


def client_id_of(text: str) -> str | None:
    """The player's id from its first frame, Sendspin 1.0's cleartext ``client/init``; anything else is refused."""
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    payload = msg.get("payload") if isinstance(msg, dict) and msg.get("type") == "client/init" else None
    cid = payload.get("client_id") if isinstance(payload, dict) else None
    return cid if isinstance(cid, str) and CLIENT_ID.match(cid) else None


async def queue_of(ma: Any, cid: str) -> str:
    """Music Assistant's queue for an app's player. Music Assistant 2.10 wraps a Sendspin player in a "universal
    player" of its own (``up`` and eight hex digits) that owns the queue, with the Sendspin player as its output; a
    Music Assistant that lists the Sendspin player itself plays on it."""
    try:
        players = await ma.players()
    except Exception:  # noqa: BLE001 -- unreadable: the player's own id, which Music Assistant answers for itself
        return cid
    for p in players if isinstance(players, list) else []:
        if not isinstance(p, dict) or not isinstance(p.get("player_id"), str):
            continue
        if p["player_id"] == cid:
            parent = p.get("protocol_parent_id")
            return parent if isinstance(parent, str) and parent else cid
        if any(isinstance(o, dict) and o.get("output_protocol_id") == cid for o in p.get("output_protocols") or []):
            return p["player_id"]
    return cid


def _host(request: web.Request):
    host = request.app.get("music")
    return host if host is not None and host.active else None


# ---------------------------------------------------------------------------------------- the routes
@open_route("app_dpop", reads="feature:music", why=WHY_APP, stream="live:music_device")
@app_route
async def socket(request: web.Request) -> web.StreamResponse:
    from .. import live
    principal = _principal(request)
    if _host(request) is None or not await may_feature(_hooks(request), principal, "music"):
        return error(403, "forbidden")
    url = upstream_url(request.app)
    if not url:
        return error(503, "unavailable", message="Music Assistant is not connected to Mantel.")
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    try:
        first = await ws.receive(timeout=FIRST_FRAME)
    except asyncio.TimeoutError:
        await ws.close(code=1008, message=b"client/init expected")
        return ws
    cid = client_id_of(first.data) if first.type == WSMsgType.TEXT else None
    if cid is None:
        await ws.close(code=1008, message=b"client/init expected")
        return ws
    http: aiohttp.ClientSession | None = request.app.get("http")
    own = http is None
    session = http or aiohttp.ClientSession()
    try:
        upstream = await session.ws_connect(url, max_msg_size=MAX_MSG, heartbeat=30, autoping=True)
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
        log.warning("Music Assistant's Sendspin server refused the app's player (%s)", type(exc).__name__)
        if own:
            await session.close()
        await ws.close(code=1011, message=b"music assistant unavailable")
        return ws
    cred = _credential(request)
    devices: dict[str, dict[str, Any]] = request.app[DEVICES]
    old = devices.get(cred)
    if old is not None:                                  # one player per credential: the newer socket wins
        await old["ws"].close(code=1000, message=b"replaced")
    mine = {"client_id": cid, "ws": ws}
    devices[cred] = mine

    async def down() -> None:            # Music Assistant -> phone
        async for m in upstream:
            if m.type == WSMsgType.TEXT:
                await ws.send_str(m.data)
            elif m.type == WSMsgType.BINARY:
                await ws.send_bytes(m.data)
            else:
                break

    async def up() -> None:              # phone -> Music Assistant
        async for m in ws:
            if m.type == WSMsgType.TEXT:
                await upstream.send_str(m.data)
            elif m.type == WSMsgType.BINARY:
                await upstream.send_bytes(m.data)
            else:
                break

    registry = live.of(request.app)

    async def close(why: str) -> None:
        log.info("closing an app's music player socket (%s)", why)
        await ws.close(code=1001 if why == live.SHUTDOWN else 1000)

    async def allowed() -> bool:
        return await may_feature(_hooks(request), principal, "music")

    entry = registry.add("music_device", principal, close, recheck=allowed) if registry is not None else None

    async def watch() -> None:
        authz = request.app.get("authz")
        while True:
            await asyncio.sleep(RECHECK)
            if authz is None or principal is None or not authz.refresh(principal) or not await allowed():
                log.info("closing an app's music player socket: its session or grant ended")
                return

    tasks = []
    try:
        await upstream.send_str(first.data)
        tasks = [asyncio.create_task(down()), asyncio.create_task(up()), asyncio.create_task(watch())]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except (aiohttp.ClientError, ConnectionError) as exc:
        log.info("an app's music player socket ended (%s)", type(exc).__name__)
    finally:
        for t in tasks:
            t.cancel()
        if devices.get(cred) is mine:
            devices.pop(cred, None)
        if entry is not None:
            entry.forget()
        await upstream.close()
        if own:
            await session.close()
        await ws.close()
    return ws


async def _body(request: web.Request) -> dict | None:
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


@open_route("app_dpop", why=WHY_APP)
@app_route
async def play(request: web.Request) -> web.Response:
    from ..music import RUN, MusicRun
    body = await _body(request)
    if body is None or set(body) - {"media_content_id", "media_content_type", "playlist"} \
            or ("playlist" in body) == ("media_content_id" in body):
        return error(400, "invalid_command")
    media, kind, key = body.get("media_content_id"), body.get("media_content_type", ""), body.get("playlist")
    if key is None and not (isinstance(media, str) and MEDIA_ID.match(media) and kind in MEDIA_TYPES):
        return error(400, "invalid_command")
    if key is not None and not (isinstance(key, str) and 0 < len(key) <= 200):
        return error(400, "invalid_command")
    gw, host = request.app.get("gateway"), _host(request)
    if gw is None:
        return error(503, "commands_disabled", message="Commands are off on this Mantel.")
    if host is None or host.ma is None:
        return error(503, "unavailable", message="Music Assistant is not connected to Mantel.")
    principal = _principal(request)
    if not await may_feature(_hooks(request), principal, "music"):
        return error(403, "forbidden")
    mine = request.app.get(DEVICES, {}).get(_credential(request))
    if mine is None:
        return error(409, "no_device_player", message="This device's player is not connected.")
    pid = mine["client_id"]
    items = [media]
    if key is not None:                  # one of the house's playlists, only one this person sees (MusicHost.payload)
        seen = await host.payload(principal)
        keys = {p.get("key") for p in seen.get("playlists") or []} | \
            {o.get("key") for p in seen.get("playlists") or [] for o in p.get("options") or []}
        pl = host.config().playlist(key) if key in keys else None
        if pl is None or not pl.items:
            return error(404, "not_found")
        items = list(pl.items)
    queue = await queue_of(host.ma, pid)
    for _ in range(QUEUE_WAITS):         # a player that just connected: Music Assistant wraps it a moment later
        if queue != pid:
            break
        await asyncio.sleep(QUEUE_WAIT)
        queue = await queue_of(host.ma, pid)
    aid = gw.audit.record(principal=principal, kind="service", action="music.device_play", targets=[f"sendspin:{pid}"],
                          decision="allowed", reason="own_device")
    run = MusicRun(principal, aid, {queue})
    token = RUN.set(run)
    try:
        if key is not None:
            await host.ma.command(run, "player_queues/shuffle", queue_id=queue, shuffle_enabled=True)
            await host.ma.command(run, "player_queues/play_media", queue_id=queue, media=items, option="replace")
        else:
            await host.ma.command(run, "player_queues/play_media", queue_id=queue, media=items, option="play")
    except Exception as exc:  # noqa: BLE001 -- Music Assistant's refusal is the answer, recorded on the row
        gw.audit.finish(aid, "failed")
        log.warning("Music Assistant did not play on an app's player (%s: %s)", type(exc).__name__, exc)
        return error(502, "failed", message=str(exc) or "Music Assistant didn’t play that.", audit_id=aid)
    finally:
        run.open = False
        RUN.reset(token)
    gw.audit.finish(aid, "ok")
    return ok({"response": {"ok": True, "leader": queue}, "audit_id": aid})


PATHS = ("/api/app/music/device/socket", "/api/app/music/device/play")


def register(app: web.Application, hub: Any = None) -> None:
    # (open to the browser-session check: app_route checks the app's own credential on every one)
    app.setdefault("public_paths", set()).update(PATHS)
    app[DEVICES] = {}
    app.router.add_get("/api/app/music/device/socket", socket)
    app.router.add_post("/api/app/music/device/play", play)
