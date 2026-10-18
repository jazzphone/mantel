"""ReadProxy: live HA reads for a page (forecasts, notifications, history ...), through a second HA
connection with its OWN explicit allowlist. HaClient's allowlist is not touched.

Only messages in READ_ALLOWED, with only the listed keys, are sent. Anything else is refused before
it reaches HA. Nothing here can change anything in HA; tests/test_proof1_guards.py pins the list.
The one REST read is GET /api/calendars/<calendar entity>?start&end (REST_READS), the same answer
HA's calendar panel and HK's calendar card draw.

P3.4: FilteredReads puts RBAC in front of every read (PLAN §4 "proxies, not copies", §5): a hook
`may_read(identity, kind, ids)` decides which entity/statistic ids the subject may `view` or read the
`history` of, and those ids are taken out of the request before it reaches HA *and* out of the answer
after (a hook can never widen what was asked). `register(app, hub, hooks)` offers the client
messages `read`, `read_subscribe`, `read_unsubscribe` and `read_api` through it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

import aiohttp

from .connectors import Ctx, Forbidden, Hooks, allowed_ids, may_feature, media_art, read_routes, ws_handlers

log = logging.getLogger("mantel.readproxy")

# message type -> the keys it may carry besides id/type. Reads and read-only subscriptions only.
READ_ALLOWED: dict[str, frozenset[str]] = {
    "get_config": frozenset(),
    "frontend/get_themes": frozenset(),
    "weather/subscribe_forecast": frozenset({"entity_id", "forecast_type"}),
    "persistent_notification/subscribe": frozenset(),
    "history/history_during_period": frozenset({"start_time", "end_time", "entity_ids", "minimal_response",
                                                "no_attributes", "significant_changes_only"}),
    "logbook/get_events": frozenset({"start_time", "end_time", "entity_ids"}),
    "recorder/statistics_during_period": frozenset({"start_time", "end_time", "statistic_ids", "period", "types",
                                                    "units"}),
    "energy/get_prefs": frozenset(),
    "energy/info": frozenset(),
    # P3.4: media browsing (HK's library card and the screensaver's photo walk)
    "media_player/browse_media": frozenset({"entity_id", "media_content_id", "media_content_type"}),
    "media_player/search_media": frozenset({"entity_id", "search_query", "media_content_id", "media_content_type",
                                            "media_filter_classes"}),
    "media_source/browse_media": frozenset({"media_content_id"}),
    # P3.5: HK's settings, read ONCE by Mantel itself for the one-time settings import
    # (settings_store.import_settings). Never for a page: SERVER_ONLY_READS below.
    "hk_frontend/panel/get": frozenset(),
}
# Reads only Mantel itself makes (ReadProxy.read_hk_settings); a page's read of one is refused here,
# whichever path it comes by (FilteredReads, or server.py's Phase 0 read until P3.7 retires it). The
# page's own `hk_frontend/panel/get` is answered by Mantel's settings store (app["read_routes"]).
SERVER_ONLY_READS = frozenset({"hk_frontend/panel/get"})
SUBSCRIBE_TYPES = frozenset({"weather/subscribe_forecast", "persistent_notification/subscribe"})
# housekeeping the proxy itself sends to end a subscription it started
INTERNAL = {"unsubscribe_events"}
# the REST reads (GET only): path prefix under /api/ -> the query keys it may carry
REST_READS: dict[str, frozenset[str]] = {"calendars": frozenset({"start", "end"})}

CALENDAR_ID = re.compile(r"^calendar\.[a-z0-9_]+$")
WHEN = re.compile(r"^[0-9][0-9T:.+\-Z ]{9,39}$")       # an ISO date or date-time, nothing else
LOCATION_KEYS = frozenset({"latitude", "longitude", "elevation", "radius"})
CAMERA_MEDIA = "media-source://camera"                   # camera snapshots: the camera connector's, not here


class ReadBlocked(Exception):
    pass


def check_read(message: dict) -> None:
    kind = message.get("type")
    allowed = READ_ALLOWED.get(kind)
    if allowed is None:
        raise ReadBlocked(f"{kind!r} is not an allowed read")
    extra = set(message) - {"id", "type"} - allowed
    if extra:
        raise ReadBlocked(f"{kind!r} may not carry {sorted(extra)}")


def check_calendar(entity_id: object, start: object, end: object) -> None:
    if not isinstance(entity_id, str) or not CALENDAR_ID.match(entity_id):
        raise ReadBlocked(f"not a calendar entity: {entity_id!r}")
    for v in (start, end):
        if not isinstance(v, str) or not WHEN.match(v):
            raise ReadBlocked("calendar start/end must be ISO dates")


class ReadProxy:
    check = staticmethod(check_read)       # what request/subscribe accept (a subclass may narrow it)

    def __init__(self, ha_url: str, token: str, ws_url: str | None = None) -> None:
        self.base_url = ha_url.rstrip("/")
        self.ws_url = ws_url or self.base_url.replace("http", "ws", 1) + "/api/websocket"
        self._token = token
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._http: aiohttp.ClientSession | None = None
        self._reader: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._next = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._subs: dict[int, Callable[[dict], None]] = {}
        self.rx_bytes = 0
        self.sent_types: list[str] = []

    async def _connect(self) -> None:
        async with self._lock:
            if self._ws is not None and not self._ws.closed:
                return
            self._http = self._http or aiohttp.ClientSession()
            ws = await self._http.ws_connect(self.ws_url, max_msg_size=0, heartbeat=30)
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": self._token})
            if (await ws.receive_json()).get("type") != "auth_ok":
                raise RuntimeError("Home Assistant rejected the token")
            self._ws = ws
            self._reader = asyncio.create_task(self._read(ws))

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        try:
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    break
                self.rx_bytes += len(m.data)
                data = json.loads(m.data)
                mid = data.get("id")
                if data.get("type") == "result" and mid in self._pending:
                    fut = self._pending.pop(mid)
                    if not fut.done():
                        if data.get("success"):
                            fut.set_result(data.get("result"))
                        else:
                            fut.set_exception(RuntimeError((data.get("error") or {}).get("code", "error")))
                elif data.get("type") == "event" and mid in self._subs:
                    self._subs[mid](data["event"])
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("Home Assistant connection closed"))
            self._pending.clear()
            self._subs.clear()

    async def _send(self, msg: dict) -> int:
        await self._connect()
        self._next += 1
        mid = self._next
        self.sent_types.append(msg["type"])
        await self._ws.send_str(json.dumps({**msg, "id": mid}))
        return mid

    async def request(self, msg: dict, *, server_read: bool = False):
        self.check(msg)
        if msg.get("type") in SERVER_ONLY_READS and not server_read:
            raise ReadBlocked(f"{msg.get('type')!r} is read by Mantel itself (the settings import), never for a page")
        mid = await self._send(msg)
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        return await asyncio.wait_for(fut, 30)

    async def subscribe(self, msg: dict, on_event: Callable[[dict], None]) -> int:
        self.check(msg)
        await self._connect()
        mid = self._next + 1                       # reserve the id before the events can arrive
        self._subs[mid] = on_event
        try:
            got = await self._send(msg)
            assert got == mid
            fut = asyncio.get_running_loop().create_future()
            self._pending[mid] = fut
            await asyncio.wait_for(fut, 30)
        except BaseException:
            self._subs.pop(mid, None)
            raise
        return mid

    async def unsubscribe(self, mid: int) -> None:
        if self._subs.pop(mid, None) is None:
            return
        try:
            await self._send({"type": "unsubscribe_events", "subscription": mid})
        except Exception:
            pass

    async def read_hk_settings(self) -> Any:
        """HK's settings as HK Settings reads them (hk_frontend/panel/get): the settings import's one read."""
        return await self.request({"type": "hk_frontend/panel/get"}, server_read=True)

    async def get_calendar_events(self, entity_id: str, start: str, end: str) -> Any:
        """GET /api/calendars/<entity>?start&end: the one REST read (REST_READS)."""
        check_calendar(entity_id, start, end)
        self._http = self._http or aiohttp.ClientSession()
        self.sent_types.append("GET calendars")
        async with self._http.get(f"{self.base_url}/api/calendars/{entity_id}", params={"start": start, "end": end},
                                  headers={"Authorization": f"Bearer {self._token}"},
                                  timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                raise RuntimeError(f"Home Assistant answered {r.status}")
            return await r.json()

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
        if self._http is not None:
            await self._http.close()


# ---------------------------------------------------------------------------------------- RBAC
# Every READ_ALLOWED type has exactly one rule here (pinned by tests/test_readproxy_filters.py).
RULES: dict[str, str] = {
    "get_config": "open; latitude/longitude/elevation/radius only with feature:locations",
    "frontend/get_themes": "open (the theme list)",
    "weather/subscribe_forecast": "view the weather entity",
    "persistent_notification/subscribe": "feature:notifications",
    "history/history_during_period": "entity_ids required; filtered to history-able ids, answer filtered too",
    "logbook/get_events": "entity_ids required; filtered to history-able ids, entries filtered too",
    "recorder/statistics_during_period": "statistic_ids filtered to history-able ids, answer filtered too",
    "energy/get_prefs": "feature:energy; entries naming a stat/entity the subject may not view are pruned",
    "energy/info": "feature:energy",
    "media_player/browse_media": "view the media player",
    "media_player/search_media": "view the media player",
    "media_source/browse_media": "feature:media; camera sources refused and pruned",
    "hk_frontend/panel/get": "never for a page (SERVER_ONLY_READS): the settings import's own read; pages get "
                             "Mantel's settings store",
}


def _stat_refs(obj: Any, out: set[str]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and v and (k.startswith("stat_") or k.startswith("entity_")):
                out.add(v)
            else:
                _stat_refs(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _stat_refs(v, out)


def _own_refs(d: dict) -> set[str]:
    return {v for k, v in d.items() if isinstance(v, str) and v and (k.startswith("stat_") or k.startswith("entity_"))}


def _prune(obj: Any, ok: set[str]) -> Any:
    """Drop every list entry that names a stat/entity outside `ok`; recurse into the rest."""
    if isinstance(obj, list):
        return [_prune(v, ok) for v in obj if not (isinstance(v, dict) and _own_refs(v) - ok)]
    if isinstance(obj, dict):
        return {k: _prune(v, ok) for k, v in obj.items()}
    return obj


def _no_camera(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {k: _no_camera(v) for k, v in obj.items()}
        if isinstance(out.get("children"), list):
            out["children"] = [c for c in out["children"] if not (isinstance(c, dict) and str(
                c.get("media_content_id", "")).startswith(CAMERA_MEDIA))]
        return out
    return obj


class FilteredReads:
    """The page's reads, with the subject's RBAC applied before and after HA."""

    def __init__(self, proxy: Callable[[], ReadProxy | None], hooks: Hooks | None = None) -> None:
        self._get = proxy
        self.hooks = Hooks.coerce(hooks)

    def _proxy(self) -> ReadProxy:
        p = self._get()
        if p is None:
            raise ConnectionError("unavailable")
        return p

    async def _ids(self, identity: Any, kind: str, msg: dict, key: str) -> list[str]:
        asked = msg.get(key)
        if isinstance(asked, str):
            asked = [asked]
        if not isinstance(asked, list) or not asked or not all(isinstance(i, str) for i in asked):
            raise ReadBlocked(f"{msg['type']!r} needs {key} (without them it is the whole house)")
        ok = await allowed_ids(self.hooks, identity, kind, asked)
        return [i for i in asked if i in ok]

    async def _need_view(self, identity: Any, entity_id: object) -> None:
        if not isinstance(entity_id, str) or entity_id not in await allowed_ids(self.hooks, identity, "view", [entity_id]):
            raise Forbidden(f"may not view {entity_id!r}")

    async def _need_feature(self, identity: Any, feature: str) -> None:
        if not await may_feature(self.hooks, identity, feature):
            raise Forbidden(f"may not use {feature}")

    async def request(self, identity: Any, msg: dict) -> Any:
        check_read(msg)
        t = msg["type"]
        if t in SUBSCRIBE_TYPES:
            raise ReadBlocked(f"{t!r} is a subscription (read_subscribe)")
        if t in SERVER_ONLY_READS:
            raise ReadBlocked(f"{t!r} is read by Mantel itself, never for a page")
        if t == "get_config":
            res = await self._proxy().request(msg)
            if isinstance(res, dict) and not await may_feature(self.hooks, identity, "locations"):
                res = {k: v for k, v in res.items() if k not in LOCATION_KEYS}
            return res
        if t == "frontend/get_themes":
            return await self._proxy().request(msg)
        if t == "history/history_during_period":
            ids = await self._ids(identity, "history", msg, "entity_ids")
            if not ids:
                return {}
            res = await self._proxy().request({**msg, "entity_ids": ids})
            if not isinstance(res, dict):
                return {}
            # no HA token in an answer either (camera/artwork pictures, connectors/media_art.py)
            return {k: [media_art.strip_tokens(k, row) for row in v] if isinstance(v, list) else v
                    for k, v in res.items() if k in ids}
        if t == "logbook/get_events":
            ids = await self._ids(identity, "history", msg, "entity_ids")
            if not ids:
                return []
            res = await self._proxy().request({**msg, "entity_ids": ids})
            out = []
            for e in res if isinstance(res, list) else []:
                if not isinstance(e, dict) or e.get("entity_id") not in ids:
                    continue
                if e.get("context_entity_id") and e["context_entity_id"] not in ids:
                    e = {k: v for k, v in e.items() if not k.startswith("context_entity_id")}
                out.append(e)
            return out
        if t == "recorder/statistics_during_period":
            ids = await self._ids(identity, "history", msg, "statistic_ids")
            if not ids:
                return {}
            res = await self._proxy().request({**msg, "statistic_ids": ids})
            return {k: v for k, v in (res or {}).items() if k in ids} if isinstance(res, dict) else {}
        if t == "energy/info":
            await self._need_feature(identity, "energy")
            return await self._proxy().request(msg)
        if t == "energy/get_prefs":
            await self._need_feature(identity, "energy")
            res = await self._proxy().request(msg)
            refs: set[str] = set()
            _stat_refs(res, refs)
            ok = await allowed_ids(self.hooks, identity, "view", sorted(refs))
            return _prune(res, ok)
        if t in ("media_player/browse_media", "media_player/search_media"):
            await self._need_view(identity, msg.get("entity_id"))
            return await self._proxy().request(msg)
        if t == "media_source/browse_media":
            await self._need_feature(identity, "media")
            if str(msg.get("media_content_id", "")).startswith(CAMERA_MEDIA):
                raise Forbidden("camera media is viewed through the camera connector")
            return _no_camera(await self._proxy().request(msg))
        raise ReadBlocked(f"{t!r} has no RBAC rule")          # unreachable while RULES covers READ_ALLOWED

    async def subscribe(self, identity: Any, msg: dict, on_event: Callable[[dict], None]):
        """-> an async unsubscribe function."""
        check_read(msg)
        t = msg["type"]
        if t not in SUBSCRIBE_TYPES:
            raise ReadBlocked(f"{t!r} is not a subscription")
        if t == "weather/subscribe_forecast":
            await self._need_view(identity, msg.get("entity_id"))
        else:
            await self._need_feature(identity, "notifications")
        proxy = self._proxy()
        mid = await proxy.subscribe(msg, on_event)

        async def unsubscribe() -> None:
            await proxy.unsubscribe(mid)
        return unsubscribe

    async def calendar_events(self, identity: Any, entity_id: object, start: object, end: object) -> Any:
        check_calendar(entity_id, start, end)
        await self._need_view(identity, entity_id)
        return await self._proxy().get_calendar_events(entity_id, start, end)  # type: ignore[arg-type]


def parse_api_path(method: object, path: object) -> tuple[str, str, str]:
    """`read_api` {method, path}: only GET calendars/<entity>?start=…&end=… -> (entity, start, end)."""
    if method != "GET" or not isinstance(path, str):
        raise ReadBlocked("only GET calendars/<entity>?start&end is offered")
    parts = urlsplit(path.lstrip("/"))
    seg = parts.path.split("/")
    if parts.scheme or parts.netloc or len(seg) != 2 or seg[0] not in REST_READS:
        raise ReadBlocked("only GET calendars/<entity>?start&end is offered")
    q = parse_qs(parts.query, keep_blank_values=True)
    if set(q) - REST_READS[seg[0]] or any(len(v) != 1 for v in q.values()):
        raise ReadBlocked("calendars takes start and end only")
    entity, start, end = seg[1], (q.get("start") or [""])[0], (q.get("end") or [""])[0]
    check_calendar(entity, start, end)
    return entity, start, end


def _error_code(exc: BaseException) -> str:
    from .ha_client import CommandBlocked
    if isinstance(exc, (ReadBlocked, CommandBlocked)):
        return "not_allowed"
    if isinstance(exc, Forbidden):
        return "forbidden"
    if isinstance(exc, ConnectionError):
        return "unavailable"
    return "failed"


_refused_at: dict[str, float] = {}
REFUSED_WARN_EVERY = 300.0


def _warn_refused(text: str, now: Callable[[], float] = time.monotonic) -> None:
    """A refused read, logged once per distinct refusal every REFUSED_WARN_EVERY seconds: a page's
    feed that is not served yet (hk_music/subscribe until Phase 4) retries with backoff for ever."""
    t = now()
    if t - _refused_at.get(text, float("-inf")) >= REFUSED_WARN_EVERY:
        if len(_refused_at) > 256:
            _refused_at.clear()
        _refused_at[text] = t
        log.warning("refused a read: %s (repeats are logged every %d s)", text, REFUSED_WARN_EVERY)


def register(app, hub, hooks) -> FilteredReads:
    """Client messages `read`, `read_subscribe`, `read_unsubscribe`, `read_api`, RBAC-filtered.

    Same frames as server.py's unfiltered read() today ({"type":"read_result","id",...} and
    {"type":"read_event","id","event"}), so the page's hub.js is unchanged; P3.7 retires that one.
    A read whose HA type a connector registered in app["read_routes"] (camera signaling) goes there.
    """
    reads = FilteredReads(lambda: getattr(hub, "readproxy", None), hooks)
    app["filtered_reads"] = reads
    routes = read_routes(app)

    async def answer(ctx: Ctx, rid: Any, work) -> None:
        try:
            result = await work
        except Exception as exc:  # noqa: BLE001 -- a failed read is the page's error, never the socket's
            code = _error_code(exc)
            if code in ("not_allowed", "forbidden"):
                _warn_refused(str(exc))
            await ctx.send({"type": "read_result", "id": rid, "error": {"code": code, "message": str(exc)}})
            return
        await ctx.send({"type": "read_result", "id": rid, "result": result})

    def inner_of(msg: dict) -> dict:
        if set(msg) - {"type", "id", "msg"}:                 # e.g. a "cmd"/"service" riding along: refused
            raise ReadBlocked("a read carries type, id and msg only")
        inner = msg.get("msg")
        if not isinstance(inner, dict):
            raise ReadBlocked("invalid")
        return inner

    async def on_read(ctx: Ctx, msg: dict) -> None:
        async def work():
            inner = inner_of(msg)
            route = routes.get(inner.get("type"))
            if route is not None:
                if route.request is None:
                    raise ReadBlocked(f"{inner.get('type')!r} is a subscription (read_subscribe)")
                return await route.request(ctx, inner)
            return await reads.request(ctx.identity, inner)
        await answer(ctx, msg.get("id"), work())

    async def on_read_subscribe(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")

        async def work():
            if not isinstance(rid, int) or ("read", rid) in ctx.subs:
                raise ReadBlocked("invalid id")
            inner = inner_of(msg)

            def on_event(ev: dict) -> None:
                ctx.emit({"type": "read_event", "id": rid, "event": ev})

            route = routes.get(inner.get("type"))
            if route is not None:
                if route.subscribe is None:
                    raise ReadBlocked(f"{inner.get('type')!r} is not a subscription")
                unsub = await route.subscribe(ctx, inner, on_event)
            else:
                unsub = await reads.subscribe(ctx.identity, inner, on_event)
            ctx.subs[("read", rid)] = unsub
            return None
        await answer(ctx, rid, work())

    async def on_read_unsubscribe(ctx: Ctx, msg: dict) -> None:
        await ctx.end(("read", msg.get("id")))

    async def on_read_api(ctx: Ctx, msg: dict) -> None:
        async def work():
            if set(msg) - {"type", "id", "method", "path"}:
                raise ReadBlocked("read_api carries type, id, method and path only")
            entity, start, end = parse_api_path(msg.get("method"), msg.get("path"))
            return await reads.calendar_events(ctx.identity, entity, start, end)
        await answer(ctx, msg.get("id"), work())

    ws_handlers(app).update({"read": on_read, "read_subscribe": on_read_subscribe,
                             "read_unsubscribe": on_read_unsubscribe, "read_api": on_read_api})
    return reads
