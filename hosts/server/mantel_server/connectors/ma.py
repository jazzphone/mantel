"""Music Assistant, through its own WebSocket API (PLAN §3, §4, §10 "Music").

Today HK reaches MA through HA's `music_assistant` integration. MA (2.10.6 here) has its own
WebSocket API at ``ws://<host>:8095/ws`` with long-lived tokens; Mantel talks to it directly.

What this relies on (MA server ``music_assistant/controllers/webserver/websocket_client.py`` and the
message models in ``music_assistant_models/api.py``; command names as the official client library
``music_assistant_client/{players,player_queues,music}.py`` sends them, which is also what HA's
``music_assistant`` integration calls through):

* On connect the server sends a ServerInfoMessage (server_id, server_version, schema_version, …).
* The client authenticates with a command ``{"message_id", "command": "auth", "args": {"token"}}``;
  success is a result ``{"authenticated": true, "user": {…}}``; a bad token an error result.
  Events reach a client only after it has authenticated (the server then subscribes it).
* Commands: ``{"message_id": str, "command": str, "args": {…}}``. Results:
  ``{"message_id", "result", "partial"}`` (a long list streams as several ``partial: true`` frames,
  500 items each, then a final one) or ``{"message_id", "error_code", "details"}``.
* Events: ``{"event": "<EventType>", "object_id": …, "data": …}`` (player_updated, queue_updated,
  queue_items_updated, queue_time_updated, media_item_added, …).

SAFETY. Reads are an explicit allowlist (MA_READS: command -> the args it may carry). Commands
(MA_COMMANDS, playback and grouping) go through ``command(identity, …)`` only, and only when the gate
passed in at construction allows that identity that command; the default gate (connectors.REFUSE_ALL)
refuses everything, so until P3.3's gateway is wired nothing but reads can reach MA. Every frame
passes ``check_outgoing``; a command frame needs a one-shot ticket only ``command()`` mints after the
gate said yes. tests/test_connectors_ma.py pins all of it against a fake MA server.

Phase 4 (music.py, Mantel's music engine): the gate is the gateway, which lets a music request's ``MusicRun``
through for the engine's own commands on the house's speakers; and two SERVER-ONLY reads (MA_SERVER_READS, Keep
Playlists Ready's forced refresh) are sent only by ``server_read`` / ``send_command``, never by ``ma/read``.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

import aiohttp

from . import REFUSE_ALL, Ctx, Hooks, may_feature, resolve, ws_handlers

log = logging.getLogger("mantel.ma")

_LIB = frozenset({"favorite", "search", "limit", "offset", "order_by", "provider"})
_ITEM = frozenset({"item_id", "provider_instance_id_or_domain"})

# Reads HK needs: players, queues, library, search, browse. command -> the args it may carry.
MA_READS: dict[str, frozenset[str]] = {
    "players/all": frozenset(),
    "player_queues/all": frozenset(),
    "player_queues/get_active_queue": frozenset({"player_id"}),
    "player_queues/items": frozenset({"queue_id", "limit", "offset"}),
    "music/artists/library_items": _LIB | {"album_artists_only"},
    "music/albums/library_items": _LIB | {"album_types"},
    "music/tracks/library_items": _LIB,
    "music/playlists/library_items": _LIB,
    "music/radios/library_items": _LIB,
    "music/audiobooks/library_items": _LIB,
    "music/podcasts/library_items": _LIB,
    "music/artists/artist_albums": _ITEM | {"in_library_only"},
    "music/artists/artist_tracks": _ITEM | {"in_library_only"},
    "music/albums/album_tracks": _ITEM | {"in_library_only"},
    "music/playlists/playlist_tracks": _ITEM,                 # never force_refresh
    "music/podcasts/podcast_episodes": _ITEM,
    "music/item": _ITEM | {"media_type"},
    "music/item_by_uri": frozenset({"uri"}),
    "music/search": frozenset({"search_query", "media_types", "limit", "library_only"}),
    "music/browse": frozenset({"path"}),
    "music/recently_played_items": frozenset({"limit", "media_types"}),
}
LIBRARY_TYPES = ("artists", "albums", "tracks", "playlists", "radios", "audiobooks", "podcasts")

# The command catalog: sent ONLY through command(), ONLY when the gate allows. (P3.3 audits them.)
MA_COMMANDS: dict[str, frozenset[str]] = {
    "player_queues/play_media": frozenset({"queue_id", "media", "option", "radio_mode", "start_item"}),
    "player_queues/transfer": frozenset({"source_queue_id", "target_queue_id", "auto_play"}),
    "player_queues/play": frozenset({"queue_id"}),
    "player_queues/pause": frozenset({"queue_id"}),
    "player_queues/play_pause": frozenset({"queue_id"}),
    "player_queues/stop": frozenset({"queue_id"}),
    "player_queues/next": frozenset({"queue_id"}),
    "player_queues/previous": frozenset({"queue_id"}),
    "player_queues/play_index": frozenset({"queue_id", "index"}),
    "player_queues/seek": frozenset({"queue_id", "position"}),
    "player_queues/shuffle": frozenset({"queue_id", "shuffle_enabled"}),
    "player_queues/repeat": frozenset({"queue_id", "repeat_mode"}),
    "players/cmd/volume_set": frozenset({"player_id", "volume_level"}),
    "players/cmd/volume_mute": frozenset({"player_id", "muted"}),
    "players/cmd/power": frozenset({"player_id", "powered"}),
    "players/cmd/group_many": frozenset({"target_player", "child_player_ids"}),
    "players/cmd/ungroup_many": frozenset({"player_ids"}),
    "players/cmd/play_announcement": frozenset({"player_id", "url", "pre_announce", "volume_level"}),
    # Phase 4 (music.py, Mantel's music engine): what HA's music_assistant integration sends for
    # media_player.media_play / media_pause / media_play_pause / media_stop / next / previous / unjoin
    "players/cmd/play": frozenset({"player_id"}),
    "players/cmd/pause": frozenset({"player_id"}),
    "players/cmd/play_pause": frozenset({"player_id"}),
    "players/cmd/stop": frozenset({"player_id"}),
    "players/cmd/next": frozenset({"player_id"}),
    "players/cmd/previous": frozenset({"player_id"}),
    "players/cmd/ungroup": frozenset({"player_id"}),
}

# SERVER-ONLY READS (Phase 4: music.py's Keep Playlists Ready, hk_core/music/warm.py). Reads Mantel itself
# makes and a page never can (``ma/read`` goes through ``read``, which knows MA_READS only): a forced
# refresh of a library playlist's songs (Music Assistant asks the streaming service again and re-caches
# them; nothing in the library or on a player changes) and the playlists played in the last week.
MA_SERVER_READS: dict[str, frozenset[str]] = {
    "music/playlists/playlist_tracks": _ITEM | {"force_refresh"},
    "music/recently_played_items": frozenset({"limit", "media_types", "played_after_timestamp"}),
}


class MaBlocked(Exception):
    """Something tried to send MA a frame outside the allowlists."""


class CommandRefused(Exception):
    """The gate did not allow this MA command. Nothing was sent."""


class MaTokenMissing(Exception):
    pass


class MaUnavailable(ConnectionError):
    pass


def read_secret(path: Path) -> str:
    """The long-lived token, from a secret file (Docker secret). Its value is never logged."""
    try:
        token = Path(path).expanduser().read_text().strip()
    except FileNotFoundError as exc:
        raise MaTokenMissing(f"Music Assistant token file not found: {path}") from exc
    if not token:
        raise MaTokenMissing(f"Music Assistant token file is empty: {path}")
    return token


class _Ticket:
    """Minted by command() after the gate allowed it; good for exactly that one frame."""
    __slots__ = ("command", "used")

    def __init__(self, command: str) -> None:
        self.command, self.used = command, False


def check_read(command: object, args: Mapping[str, Any]) -> None:
    allowed = MA_READS.get(command)  # type: ignore[arg-type]
    if allowed is None:
        raise MaBlocked(f"{command!r} is not an allowed Music Assistant read")
    extra = set(args) - allowed
    if extra:
        raise MaBlocked(f"{command!r} may not carry {sorted(extra)}")


def check_server_read(command: object, args: Mapping[str, Any]) -> None:
    allowed = MA_SERVER_READS.get(command)  # type: ignore[arg-type]
    if allowed is None:
        raise MaBlocked(f"{command!r} is not a server-only Music Assistant read")
    extra = set(args) - allowed
    if extra:
        raise MaBlocked(f"{command!r} may not carry {sorted(extra)}")


def check_outgoing(frame: dict, ticket: _Ticket | None = None, *, server: bool = False) -> None:
    """Every frame to MA: auth, an allowed read, or a command with its fresh ticket. ``server``: one of
    Mantel's own server-only reads (MA_SERVER_READS), never a page's."""
    command, args = frame.get("command"), frame.get("args") or {}
    if set(frame) - {"message_id", "command", "args"}:
        raise MaBlocked("unexpected keys in an MA frame")
    if command == "auth":
        if set(args) != {"token"}:
            raise MaBlocked("auth carries the token only")
        return
    if server:
        return check_server_read(command, args)
    if command in MA_READS:
        return check_read(command, args)
    if command in MA_COMMANDS:
        if ticket is None or ticket.used or ticket.command != command:
            raise MaBlocked(f"{command!r} is a command; only command() may send it, when the gate allows")
        extra = set(args) - MA_COMMANDS[command]
        if extra:
            raise MaBlocked(f"{command!r} may not carry {sorted(extra)}")
        ticket.used = True
        return
    raise MaBlocked(f"refusing to send {command!r} to Music Assistant")


def ws_url_of(url: str) -> str:
    u = url.rstrip("/")
    if u.startswith("http"):
        u = u.replace("http", "ws", 1)
    return u if u.endswith("/ws") else u + "/ws"


class MaClient:
    def __init__(self, url: str, token_file: Path, gate: Any = REFUSE_ALL, *, request_timeout: float = 30.0,
                 backoff_start: float = 1.0, backoff_max: float = 30.0) -> None:
        self.ws_url = ws_url_of(url)
        self.token_file = Path(token_file)          # read at each connect (rotation); value never stored on self
        self.gate = gate
        self.request_timeout = request_timeout
        self.backoff_start, self.backoff_max = backoff_start, backoff_max
        self.server_info: dict | None = None
        self.user: dict | None = None
        self.connected = asyncio.Event()
        self.connects = 0
        self.sent: list[str] = []                   # commands sent, in order (tests, stats)
        self._ids = itertools.count(1)
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._partial: dict[str, list] = {}
        self._listeners: dict[int, tuple[frozenset[str] | None, Callable[[dict], None]]] = {}
        self._lid = itertools.count(1)
        self._task: asyncio.Task | None = None

    # ----------------------------------------------------------------- connection
    def start(self) -> asyncio.Task:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.run())
        return self._task

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self._ws is not None:
            await self._ws.close()

    async def run(self) -> None:
        backoff = self.backoff_start
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    await self._session(session)
                    backoff = self.backoff_start
                except asyncio.CancelledError:
                    raise
                except MaTokenMissing as exc:
                    log.error("Music Assistant connector stopped: %s", exc)
                    raise
                except Exception as exc:  # reconnect on anything else (bad token included: it may be fixed)
                    log.warning("Music Assistant connection lost (%s: %s); retrying in %.0fs",
                                type(exc).__name__, exc, backoff)
                self._lost()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self.backoff_max)

    def _lost(self) -> None:
        self.connected.clear()
        self._ws = None
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(MaUnavailable("Music Assistant connection closed"))
        self._pending.clear()
        self._partial.clear()

    async def _session(self, session: aiohttp.ClientSession) -> None:
        token = read_secret(self.token_file)
        async with session.ws_connect(self.ws_url, max_msg_size=0, heartbeat=30) as ws:
            info = await asyncio.wait_for(ws.receive_json(), self.request_timeout)
            if not isinstance(info, dict) or "server_version" not in info:
                raise RuntimeError("unexpected greeting from Music Assistant")
            self.server_info = info
            mid = str(next(self._ids))
            frame = {"message_id": mid, "command": "auth", "args": {"token": token}}
            check_outgoing(frame)
            self.sent.append("auth")
            await ws.send_str(json.dumps(frame))
            del token, frame
            reply = await asyncio.wait_for(ws.receive_json(), self.request_timeout)
            res = reply.get("result") if isinstance(reply, dict) else None
            if reply.get("message_id") != mid or not isinstance(res, dict) or res.get("authenticated") is not True:
                raise RuntimeError(f"Music Assistant refused the token ({reply.get('error_code', '?')})")
            self.user = res.get("user")
            self._ws = ws
            self.connects += 1
            log.info("authenticated to Music Assistant %s", info.get("server_version"))
            self.connected.set()
            if self.connects > 1:      # events missed while away: listeners should read again
                self._dispatch({"event": "mantel_reconnected", "object_id": None, "data": None})
            async for m in ws:
                if m.type == aiohttp.WSMsgType.TEXT:
                    self._handle(json.loads(m.data))
                elif m.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break

    def _handle(self, data: dict) -> None:
        if not isinstance(data, dict):
            return
        if "event" in data:
            self._dispatch(data)
            return
        mid = data.get("message_id")
        fut = self._pending.get(mid)
        if fut is None:
            return
        if "error_code" in data:
            self._pending.pop(mid, None)
            self._partial.pop(mid, None)
            if not fut.done():
                fut.set_exception(RuntimeError(f"Music Assistant error {data.get('error_code')}: {data.get('details')}"))
            return
        if data.get("partial"):
            self._partial.setdefault(mid, []).extend(data.get("result") or [])
            return
        self._pending.pop(mid, None)
        result = data.get("result")
        if mid in self._partial:
            result = self._partial.pop(mid) + (result or [])
        if not fut.done():
            fut.set_result(result)

    def _dispatch(self, event: dict) -> None:
        for kinds, cb in list(self._listeners.values()):
            if kinds is None or event.get("event") in kinds:
                try:
                    cb(event)
                except Exception as exc:  # noqa: BLE001 -- one listener never breaks the others
                    log.warning("MA event listener failed: %s", exc)

    async def _call(self, command: str, args: dict, ticket: _Ticket | None = None, server: bool = False) -> Any:
        frame = {"message_id": "", "command": command, "args": args}
        check_outgoing(frame, ticket, server=server)  # before waiting on anything: a refusal sends nothing
        try:
            await asyncio.wait_for(self.connected.wait(), self.request_timeout)
        except asyncio.TimeoutError as exc:
            raise MaUnavailable("Music Assistant is not connected") from exc
        ws = self._ws
        if ws is None:
            raise MaUnavailable("Music Assistant is not connected")
        frame["message_id"] = mid = str(next(self._ids))
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        self.sent.append(command)
        try:
            await ws.send_str(json.dumps(frame))
            return await asyncio.wait_for(fut, self.request_timeout)
        finally:
            self._pending.pop(mid, None)
            self._partial.pop(mid, None)

    # ----------------------------------------------------------------- reads
    async def read(self, command: str, **args: Any) -> Any:
        check_read(command, args)
        return await self._call(command, args)

    async def server_read(self, command: str, **args: Any) -> Any:
        """One of Mantel's own server-only reads (MA_SERVER_READS). Never reachable from a page."""
        check_server_read(command, args)
        return await self._call(command, args, server=True)

    async def send_command(self, command: str, **args: Any) -> Any:
        """hk_core.music.warm's ``MusicServer``: a read (MA_READS) or a server-only read
        (MA_SERVER_READS). Never a command: anything else is refused and nothing is sent."""
        if command in MA_READS and not set(args) - MA_READS[command]:
            return await self.read(command, **args)
        return await self.server_read(command, **args)

    async def players(self) -> Any:
        return await self.read("players/all")

    async def queues(self) -> Any:
        return await self.read("player_queues/all")

    async def active_queue(self, player_id: str) -> Any:
        return await self.read("player_queues/get_active_queue", player_id=player_id)

    async def queue_items(self, queue_id: str, limit: int = 500, offset: int = 0) -> Any:
        return await self.read("player_queues/items", queue_id=queue_id, limit=limit, offset=offset)

    async def library(self, media_type: str, **args: Any) -> Any:
        if media_type not in LIBRARY_TYPES:
            raise MaBlocked(f"no library of {media_type!r}")
        return await self.read(f"music/{media_type}/library_items", **args)

    async def playlist_tracks(self, item_id: str, provider: str) -> Any:
        return await self.read("music/playlists/playlist_tracks", item_id=item_id,
                               provider_instance_id_or_domain=provider)

    async def search(self, query: str, media_types: Iterable[str] | None = None, limit: int = 25,
                     library_only: bool = False) -> Any:
        args: dict[str, Any] = {"search_query": query, "limit": limit, "library_only": library_only}
        if media_types is not None:
            args["media_types"] = list(media_types)
        return await self.read("music/search", **args)

    async def browse(self, path: str | None = None) -> Any:
        return await self.read("music/browse", **({"path": path} if path else {}))

    def subscribe(self, callback: Callable[[dict], None], events: Iterable[str] | None = None) -> Callable[[], None]:
        """Local fan-out of MA's event stream (MA sends every event once authenticated)."""
        lid = next(self._lid)
        self._listeners[lid] = (frozenset(events) if events is not None else None, callback)
        return lambda: self._listeners.pop(lid, None) and None

    # ----------------------------------------------------------------- the gated command path
    async def command(self, identity: Any, command: str, **args: Any) -> Any:
        """Send an MA command, ONLY if the gate allows `identity` this command. Refused -> nothing sent."""
        if command not in MA_COMMANDS:
            raise MaBlocked(f"{command!r} is not in the Music Assistant command catalog")
        gate = self.gate if self.gate is not None else REFUSE_ALL
        if await resolve(gate.allow(identity, command, dict(args))) is not True:
            raise CommandRefused(f"{command!r} refused by the gate")
        return await self._call(command, args, _Ticket(command))


def register(app, hub, hooks) -> MaClient | None:
    """Client messages `ma/read`, `ma/subscribe`, `ma/unsubscribe` (reads only; feature:music).

    There is deliberately no client message that sends an MA command: P3.3's gateway calls
    ``app["ma"].command(identity, …)`` itself, with its own checks and audit, as the gate.
    Off (``app["ma"] = None``, every message answers ``unavailable``) unless ``cfg.ma_url`` is set.
    """
    hooks = Hooks.coerce(hooks)
    cfg = app["cfg"]
    url = getattr(cfg, "ma_url", "") or ""
    client = MaClient(url, getattr(cfg, "ma_token_file"), gate=hooks.ma_gate) if url else None
    app["ma"] = client

    async def fail(ctx: Ctx, rid: Any, code: str, text: str = "") -> None:
        await ctx.send({"type": "ma_result", "id": rid, "error": {"code": code, "message": text}})

    async def allowed(ctx: Ctx, rid: Any) -> bool:
        if client is None:
            await fail(ctx, rid, "unavailable")
            return False
        if not await may_feature(hooks, ctx.identity, "music"):
            await fail(ctx, rid, "forbidden", "may not use music")
            return False
        return True

    async def on_read(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        if not await allowed(ctx, rid):
            return
        args = msg.get("args") or {}
        try:
            if set(msg) - {"type", "id", "command", "args"}:
                raise MaBlocked("ma/read carries type, id, command and args only")
            if not isinstance(args, dict):
                raise MaBlocked("args must be an object")
            result = await client.read(msg.get("command"), **args)  # type: ignore[union-attr,arg-type]
        except MaBlocked as exc:
            log.warning("refused an MA read: %s", exc)
            return await fail(ctx, rid, "not_allowed", str(exc))
        except MaUnavailable as exc:
            return await fail(ctx, rid, "unavailable", str(exc))
        except Exception as exc:  # noqa: BLE001
            return await fail(ctx, rid, "failed", str(exc))
        await ctx.send({"type": "ma_result", "id": rid, "result": result})

    async def on_subscribe(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        if not await allowed(ctx, rid):
            return
        events = msg.get("events")
        if (not isinstance(rid, int) or ("ma", rid) in ctx.subs or set(msg) - {"type", "id", "events"}
                or (events is not None and not (isinstance(events, list) and all(isinstance(e, str) for e in events)))):
            return await fail(ctx, rid, "invalid")
        stop = client.subscribe(lambda ev: ctx.emit({"type": "ma_event", "id": rid, "event": ev}), events)  # type: ignore[union-attr]

        async def unsubscribe() -> None:
            stop()
        ctx.subs[("ma", rid)] = unsubscribe
        await ctx.send({"type": "ma_result", "id": rid, "result": None})

    async def on_unsubscribe(ctx: Ctx, msg: dict) -> None:
        await ctx.end(("ma", msg.get("id")))

    ws_handlers(app).update({"ma/read": on_read, "ma/subscribe": on_subscribe, "ma/unsubscribe": on_unsubscribe})

    if client is not None:
        async def start(app) -> None:
            client.start()

        async def stop(app) -> None:
            await client.close()
        app.on_startup.append(start)
        app.on_cleanup.append(stop)
    return client
