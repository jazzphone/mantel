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

Two reads HK's pages send to HA are answered by Mantel itself and never forwarded (MANTEL_READS, each
with a rule in ROUTE_RULES): `config/entity_registry/get` from the hub's own entity registry copy, cut
down to the one thing HK reads (a light's favourite colours), and `hk_frontend/hidden/get` from Mantel's
settings store with the hub's states and registries (hidden.py). An entity the person may not `view`
is answered exactly as one that does not exist.
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

from .connectors import Ctx, Forbidden, Hooks, Route, allowed_ids, may_feature, media_art, read_routes, ws_handlers

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
    # The screensaver's photo, resolved by Mantel itself (connectors/media_photos.py): HA's answer is a signed
    # address on HA's own origin, so a page never sees it; the page gets Mantel's short-lived photo route.
    "media_source/resolve_media": frozenset({"media_content_id", "expires"}),
    # P3.5: HK's settings, read ONCE by Mantel itself for the one-time settings import
    # (settings_store.import_settings). Never for a page: SERVER_ONLY_READS below.
    "hk_frontend/panel/get": frozenset(),
    # THE INTERIM MUSIC BRIDGE: HK's Music page, read from HA's hk_frontend integration. Since Phase 4 these
    # are answered by Mantel's own music engine (music.py, talking to Music Assistant directly) once Music
    # Assistant and the music settings are in Mantel; until then (HA App mode with no MA token in Mantel)
    # music.py's routes hand them to this bridge. Reads only; every other hk_music/* type (queue_play, used,
    # item/remove, playlist/save, preset/save, settings/set, playlists/order) is a write or a side effect
    # and stays the gateway's (commands off).
    "hk_music/subscribe": frozenset(),
    "hk_music/queue": frozenset({"entity_id", "limit"}),
    "hk_music/settings/library": frozenset(),
    # INTERIM (until Live TV's channel cameras, transcode and viewers move into Mantel): the Live TV page's
    # channel list (hk-tv-guide-card), each channel's camera and "now playing" sensor, from HA's
    # hk_frontend. A read; `hk_tv/watching` (a viewer's heartbeat, which HA writes into a sensor) and
    # `hk_tv/settings/set` are writes and stay the gateway's (commands off). Where Mantel serves Live TV
    # itself (live_tv.py, its own go2rtc) this read is answered there and never forwarded; the heartbeat is
    # counted by Mantel everywhere (`tv_watching`) and reaches HA only through the gateway, commands on.
    "hk_tv/channels": frozenset(),
    # The feature import (features.import_features): each added feature's own HK Settings read, ONCE,
    # by Mantel itself. Never for a page: SERVER_ONLY_READS below.
    "hk_notify/settings/get": frozenset(),
    "hk_clean_areas/settings/get": frozenset(),
    "hk_energy/settings/get": frozenset(),
    "hk_tv/settings/get": frozenset(),
    # The Energy plan's one extra read: {sensor: the sensor it counts} for the Utility Meter / Integral /
    # Derivative sensors (HK's hk_energy/sources, admin-only, read only). HA keeps a helper's source in a
    # private field of the sensor's object; Utility Meters publish no `source` attribute. Mantel itself asks
    # (features.energy_inputs); never a page (SERVER_ONLY_READS). An HK that predates it answers an error and
    # the plan falls back to the sources the states carry.
    "hk_energy/sources": frozenset(),
    # the same read from Mantel Link (its energy.py), so the plan needs no HK Frontend. Never a page's.
    "mantel/energy/sources": frozenset(),
    # the Lights page's "Tonight" list from Mantel Link (its page_headers.py), read by Mantel itself and sent to
    # the screens filtered (page_headers.py). Never a page's.
    "mantel/page_headers/get": frozenset(),
    # Music's HK Settings page, read by Mantel itself: for the music import (music.import_doc, with the feature
    # import) and, while Mantel's music engine is off, for HK Settings' Music page (feature_pages.py, rebuilt
    # key by key; with the engine on, music.py answers from Mantel's own settings). Never sent by a page.
    "hk_music/settings/get": frozenset(),
    # Alarm PIN's HK Settings page: read by Mantel itself for the Alarm PIN import (alarm_pin.import_ha_page:
    # which panel protects which alarm, the arm rule) and for HK Settings' page (feature_pages.py). HA never
    # sends its PIN or its hash. Never for a page: SERVER_ONLY_READS below.
    "hk_alarm_pin/settings/get": frozenset(),
}
# Reads only Mantel itself makes (ReadProxy.read_hk_settings / read_server, for the imports); a page's
# read of one is refused here, whichever path it comes by (FilteredReads, or server.py's Phase 0 read
# until P3.7 retires it). The page's own `hk_frontend/panel/get` is answered by Mantel's settings store
# (app["read_routes"]), and so is each feature's settings page (feature_pages.py: Mantel's own answer, or
# for Music and Alarm PIN, still HA's, HA's page read here by Mantel itself and rebuilt).
SERVER_ONLY_READS = frozenset({"hk_frontend/panel/get", "hk_notify/settings/get", "hk_clean_areas/settings/get",
                               "hk_energy/settings/get", "hk_energy/sources", "mantel/energy/sources", "mantel/page_headers/get",
                               "hk_tv/settings/get", "hk_music/settings/get",
                               "hk_alarm_pin/settings/get", "media_source/resolve_media"})
SUBSCRIBE_TYPES = frozenset({"weather/subscribe_forecast", "persistent_notification/subscribe", "hk_music/subscribe"})
# housekeeping the proxy itself sends to end a subscription it started
INTERNAL = {"unsubscribe_events"}
# the REST reads (GET only): path prefix under /api/ -> the query keys it may carry
REST_READS: dict[str, frozenset[str]] = {"calendars": frozenset({"start", "end"})}

CALENDAR_ID = re.compile(r"^calendar\.[a-z0-9_]+$")
WHEN = re.compile(r"^[0-9][0-9T:.+\-Z ]{9,39}$")       # an ISO date or date-time, nothing else
LOCATION_KEYS = frozenset({"latitude", "longitude", "elevation", "radius"})
# What cameras saw, as media: camera snapshots (the camera connector's, not here), and the recordings and events of
# Home Assistant's camera and NVR integrations. Media browsing is decided as music, so none of it is offered there.
CAMERA_MEDIA = tuple(f"media-source://{p}" for p in ("camera", "frigate", "unifiprotect", "reolink", "nest",
                                                       "motioneye", "netatmo"))


class ReadBlocked(Exception):
    pass


class NotFound(Exception):
    """Answered as HA answers an entity that does not exist (code `not_found`): also what a person is
    told about an entity they may not view, so the two cannot be told apart."""


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

    def retarget(self, ha_url: str, token: str, ws_url: str | None = None) -> None:
        """New address/credential (connections.py, hot apply): the open connection is closed (its
        pending reads fail, its subscriptions end) and the next read connects with the new values."""
        self.base_url = ha_url.rstrip("/")
        self.ws_url = ws_url or self.base_url.replace("http", "ws", 1) + "/api/websocket"
        self._token = token
        ws = self._ws
        if ws is not None and not ws.closed:
            asyncio.get_running_loop().create_task(ws.close())

    async def _connect(self) -> None:
        async with self._lock:
            if self._ws is not None and not self._ws.closed:
                return
            if not self._token:
                raise ConnectionError("Home Assistant is not connected yet (admin page: Connections)")
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

    async def read_server(self, msg: dict) -> Any:
        """One of the server-only reads (SERVER_ONLY_READS: HK's settings and each feature's settings,
        for the imports), as Mantel itself asks it. Anything else is refused here."""
        if not isinstance(msg, dict) or msg.get("type") not in SERVER_ONLY_READS:
            raise ReadBlocked(f"{msg.get('type') if isinstance(msg, dict) else msg!r} is not a server-only read")
        return await self.request(msg, server_read=True)

    async def get_calendar_events(self, entity_id: str, start: str, end: str) -> Any:
        """GET /api/calendars/<entity>?start&end: the one REST read (REST_READS)."""
        check_calendar(entity_id, start, end)
        self._http = self._http or aiohttp.ClientSession()
        self.sent_types.append("GET calendars")
        async with self._http.get(f"{self.base_url}/api/calendars/{entity_id}", params={"start": start, "end": end},
                                  headers={"Authorization": f"Bearer {self._token}"},
                                  timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                raise RuntimeError(f"Home Assistant answered {r.status} for {entity_id}")
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
    "media_source/resolve_media": "server-only: Mantel's photo route answers it (connectors/media_photos.py), feature:media",
    "hk_frontend/panel/get": "never for a page (SERVER_ONLY_READS): the settings import's own read; pages get "
                             "Mantel's settings store",
    "hk_music/subscribe": "feature:music; every event pruned to the players the subject may view (speakers, "
                          "presets' members, floors, announcements); `home` always null (HA's is Mantel's user's)",
    "hk_music/queue": "view the media player (media_player.* only), else not_found; limit 1..100; items rebuilt "
                      "as {id, title, artist, duration, image} with token-carrying image addresses dropped",
    "hk_music/settings/library": "feature:music; items rebuilt as {uri, name}",
    "hk_tv/channels": "each channel kept only if the subject may view its camera.* entity; its `now` sensor.* only if "
                      "viewable (else null); rebuilt as {configured, channels: [{number, name, camera, now}]}",
    "hk_notify/settings/get": "never for a page (SERVER_ONLY_READS): the feature import's own read",
    "hk_clean_areas/settings/get": "never for a page (SERVER_ONLY_READS): the feature import's own read",
    "hk_energy/settings/get": "never for a page (SERVER_ONLY_READS): the feature import's own read",
    "hk_tv/settings/get": "never for a page (SERVER_ONLY_READS): the feature import's own read",
    "hk_energy/sources": "never for a page (SERVER_ONLY_READS): the Energy plan's own read of the helpers' sources",
    "mantel/energy/sources": "never for a page (SERVER_ONLY_READS): the same read, answered by Mantel Link",
    "mantel/page_headers/get": "never for a page (SERVER_ONLY_READS): the Lights page's Tonight list, read by Mantel "
                               "and sent to the screens filtered (page_headers.py)",
    "hk_music/settings/get": "never for a page (SERVER_ONLY_READS): the music import's own read (once; HK Settings' "
                             "Music page is Mantel's own settings, music.py)",
    "hk_alarm_pin/settings/get": "never for a page (SERVER_ONLY_READS): the Alarm PIN import's own read, and HK "
                                 "Settings' Alarm PIN page only while HK Frontend runs the keypads (alarm_pin.py)",
}


# Reads Mantel answers itself (register() puts them in app["read_routes"]); nothing is sent to HA.
# Pinned by tests/test_readproxy_filters.py: each has exactly one rule and none is in READ_ALLOWED.
ROUTE_RULES: dict[str, str] = {
    "config/entity_registry/get": "view the entity, else not_found (as a nonexistent one); answered from the "
                                  "hub's registry copy: entity_id and options.light.favorite_colors only",
    "hk_frontend/hidden/get": "configure on settings (HA: require_admin); every entity, device and room the "
                              "subject may not view is left out; an asked-about one reads as nonexistent",
}
MANTEL_READS = frozenset(ROUTE_RULES)
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
# a favourite colour: exactly one of these keys, with this many numbers (0: one number)
FAVOURITE = {"color_temp_kelvin": 0, "hs_color": 2, "rgb_color": 3, "rgbw_color": 4, "rgbww_color": 5, "xy_color": 2}
MAX_FAVOURITES = 32


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e6


def favourite_colours(value: Any) -> list[dict]:
    """A light's options.light.favorite_colors, each entry checked: one known colour key and its
    numbers, nothing else (an entry that is anything more is dropped)."""
    if not isinstance(value, list):
        return []
    out = []
    for f in value[:MAX_FAVOURITES]:
        if not isinstance(f, dict) or len(f) != 1:
            continue
        (k, v), = f.items()
        n = FAVOURITE.get(k)
        if n == 0 and _number(v):
            out.append({k: v})
        elif n and isinstance(v, list) and len(v) == n and all(_number(x) for x in v):
            out.append({k: list(v)})
    return out


def registry_answer(entry: dict) -> dict:
    """What `config/entity_registry/get` answers a page. HK's one caller (hk-detail.js `favourites`)
    reads only options.light.favorite_colors. HA's own answer also carries the device, area and config
    entry ids, aliases, labels, categories, capabilities and every integration's options -- some of
    which name other entities (switch_as_x's options name the light that wraps a switch) -- so none of
    that is sent."""
    out: dict[str, Any] = {"entity_id": entry["entity_id"]}
    options = entry.get("options") if isinstance(entry.get("options"), dict) else {}
    light = options.get("light") if isinstance(options.get("light"), dict) else {}
    fav = favourite_colours(light.get("favorite_colors"))
    if fav:
        out["options"] = {"light": {"favorite_colors": fav}}
    return out


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


# ------------------------------------------------------------------- music (interim, until Phase 4)
MEDIA_PLAYER = re.compile(r"^media_player\.[a-z0-9_]+$")
QUEUE_MAX = 100                       # hk_core/music/queue.py QUEUE_MAX (HA's schema: 1..QUEUE_MAX)
TOKENISH = re.compile(r"(token|auth|sig|signature|key|secret|password|session)", re.I)


def music_players(payload: Any) -> set[str]:
    """Every entity id an hk_music/subscribe event names (to ask RBAC about them at once)."""
    out: set[str] = set()
    if not isinstance(payload, dict):
        return out
    for s in payload.get("speakers") or []:
        if isinstance(s, dict):
            out |= {v for v in [s.get("entity"), *(s.get("members") or [])] if isinstance(v, str)}
    for f in payload.get("floors") or []:
        if isinstance(f, dict):
            out |= {v for v in f.get("entities") or [] if isinstance(v, str)}
    out |= {v for v in payload.get("announcements") or [] if isinstance(v, str)}
    return out


def music_config(payload: Any, ok: set[str]) -> dict:
    """hk_music/subscribe's event (hk_core MusicConfig.as_client + `announcements`) cut down to the
    players in ``ok``. Kept: `configured`, `library_entry` (Music Assistant's config entry id, for
    Browse), `playlists` (names, icons and keys), `volume`, `ignore_announcements`. `home` is always
    None: HA answers as Mantel's own HA user, so its home room is not this person's (Phase 4)."""
    if not isinstance(payload, dict) or not payload.get("configured"):
        return {"configured": False}
    speakers = []
    for s in payload.get("speakers") or []:
        if not isinstance(s, dict) or s.get("entity") not in ok:
            continue
        one = {"name": s.get("name"), "entity": s["entity"]}
        if isinstance(s.get("members"), list):                 # a preset (a group of speakers)
            one["members"] = [m for m in s["members"] if m in ok]
        if isinstance(s.get("pair"), list):                    # a pair room: its players' names
            one["pair"] = [str(n) for n in s["pair"]]
        speakers.append(one)
    floors = []
    for f in payload.get("floors") or []:
        if isinstance(f, dict):
            ents = [e for e in f.get("entities") or [] if e in ok]
            if ents:
                floors.append({"name": f.get("name"), "entities": ents})
    out = {"configured": True, "library_entry": payload.get("library_entry"), "speakers": speakers,
           "floors": floors, "playlists": payload.get("playlists") if isinstance(payload.get("playlists"), list) else [],
           "home": None, "volume": payload.get("volume"),
           "ignore_announcements": payload.get("ignore_announcements")}
    if "announcements" in payload:
        out["announcements"] = [p for p in payload.get("announcements") or [] if p in ok]
    return out


def _safe_image(v: Any) -> str | None:
    if not isinstance(v, str) or not v.startswith(("http://", "https://")):
        return None
    q = urlsplit(v).query
    return None if q and any(TOKENISH.search(k) for k in parse_qs(q, keep_blank_values=True)) else v


def music_queue(res: Any) -> dict:
    """hk_music/queue's answer, rebuilt: {ok, queue_id, index, items: [{id, title, artist, duration,
    image}]} or {ok: False, message}. An image address carrying a token-like query key is dropped."""
    if not isinstance(res, dict):
        return {"ok": False, "message": "The queue could not be read."}
    if not res.get("ok"):
        return {"ok": False, "message": str(res.get("message") or "The queue could not be read.")[:200]}
    items = []
    for i in res.get("items") or []:
        if isinstance(i, dict):
            items.append({"id": i.get("id"), "title": i.get("title"), "artist": i.get("artist"),
                          "duration": i.get("duration"), "image": _safe_image(i.get("image"))})
    return {"ok": True, "queue_id": res.get("queue_id"), "index": res.get("index"), "items": items}


# ----------------------------------------------------------------- Live TV (interim, until it moves)
CAMERA_ID = re.compile(r"^camera\.[a-z0-9_]+$")
SENSOR_ID = re.compile(r"^sensor\.[a-z0-9_]+$")
CHANNEL_NO = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
CHANNELS_MAX = 500


def tv_entities(res: Any) -> list[str]:
    """Every entity id an hk_tv/channels answer names (to ask RBAC about them at once)."""
    out: list[str] = []
    for c in (res.get("channels") if isinstance(res, dict) else None) or []:
        if isinstance(c, dict):
            out += [v for v in (c.get("camera"), c.get("now")) if isinstance(v, str)]
    return out


def tv_channels(res: Any, ok: set[str]) -> dict:
    """hk_tv/channels' answer (HA: ws_channels, {configured, channels: [{number, name, camera, now}]}) cut
    down to the channels whose camera the subject may view; a `now` sensor they may not view reads null.
    Every channel is rebuilt from the four keys, each checked."""
    if not isinstance(res, dict):
        return {"configured": False, "channels": []}
    out = []
    for c in (res.get("channels") or [])[:CHANNELS_MAX]:
        if not isinstance(c, dict):
            continue
        cam, now, num = c.get("camera"), c.get("now"), c.get("number")
        if not (isinstance(cam, str) and CAMERA_ID.match(cam) and cam in ok):
            continue
        if not (isinstance(num, str) and CHANNEL_NO.match(num)):
            continue
        out.append({"number": num, "name": c.get("name")[:80] if isinstance(c.get("name"), str) else num,
                    "camera": cam, "now": now if isinstance(now, str) and SENSOR_ID.match(now) and now in ok else None})
    return {"configured": bool(res.get("configured")), "channels": out}


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
        from .linked_reads import FROM_LINK
        if FROM_LINK.get():
            raise ReadBlocked(f"{t!r} is Home Assistant's: a read relayed from Home Assistant is never sent back")
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
                    # what caused it is an entity the reader may not see: nothing of it stays (its name, its
                    # state -- "unlocked" --, the message naming it, the service and domain), only that there was
                    # a cause (context_id)
                    e = {k: v for k, v in e.items() if not k.startswith("context_") or k == "context_id"}
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
        if t == "hk_music/queue":
            eid, limit = msg.get("entity_id"), msg.get("limit", 40)
            if not isinstance(eid, str) or not MEDIA_PLAYER.match(eid):
                raise ReadBlocked("hk_music/queue needs a media_player entity_id")
            if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= QUEUE_MAX:
                raise ReadBlocked(f"hk_music/queue: limit is 1..{QUEUE_MAX}")
            if eid not in await allowed_ids(self.hooks, identity, "view", [eid]):
                raise NotFound("Entity not found")
            return music_queue(await self._proxy().request({"type": t, "entity_id": eid, "limit": limit}))
        if t == "hk_music/settings/library":
            await self._need_feature(identity, "music")
            res = await self._proxy().request(msg)
            items = res.get("items") if isinstance(res, dict) else None
            return {"items": [{"uri": i["uri"], "name": i.get("name") if isinstance(i.get("name"), str) else i["uri"]}
                              for i in items or [] if isinstance(i, dict) and isinstance(i.get("uri"), str)]}
        if t == "hk_tv/channels":
            res = await self._proxy().request(msg)
            ok = await allowed_ids(self.hooks, identity, "view", tv_entities(res))
            return tv_channels(res, ok)
        raise ReadBlocked(f"{t!r} has no RBAC rule")          # unreachable while RULES covers READ_ALLOWED

    async def subscribe(self, identity: Any, msg: dict, on_event: Callable[[dict], None]):
        """-> an async unsubscribe function."""
        check_read(msg)
        t = msg["type"]
        from .linked_reads import FROM_LINK
        if FROM_LINK.get():
            raise ReadBlocked(f"{t!r} is Home Assistant's: a read relayed from Home Assistant is never sent back")
        if t not in SUBSCRIBE_TYPES:
            raise ReadBlocked(f"{t!r} is not a subscription")
        async def gate() -> None:
            if t == "weather/subscribe_forecast":
                await self._need_view(identity, msg.get("entity_id"))
            elif t == "hk_music/subscribe":
                await self._need_feature(identity, "music")
            else:
                await self._need_feature(identity, "notifications")
        await gate()
        if t == "hk_music/subscribe":
            on_event = self._music_events(identity, on_event)
        proxy = self._proxy()
        mid = await proxy.subscribe(msg, on_event)

        async def unsubscribe() -> None:
            await proxy.unsubscribe(mid)

        async def recheck() -> bool:      # live.py: the same gate again (a role lowered, a grant removed)
            try:
                await gate()
            except (Forbidden, ReadBlocked, NotFound):
                return False
            return True
        unsubscribe.recheck = recheck              # type: ignore[attr-defined]
        return unsubscribe

    def _music_events(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[dict], None]:
        """Each hk_music/subscribe event pruned (music_config) before the page gets it. RBAC may be
        async, so each event is filtered in a task; a lock keeps them in the order HA sent them."""
        lock = asyncio.Lock()

        async def one(ev: dict) -> None:
            async with lock:
                try:
                    ok = await allowed_ids(self.hooks, identity, "view", sorted(music_players(ev)))
                    out = music_config(ev, ok)
                except Exception:  # noqa: BLE001 -- a failing hook sends nothing rather than everything
                    log.exception("music event filter failed; event dropped")
                    return
                on_event(out)

        tasks: set[asyncio.Task] = set()

        def handler(ev: dict) -> None:
            task = asyncio.get_running_loop().create_task(one(ev))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        return handler

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
    if isinstance(getattr(exc, "read_code", None), str):     # an error that names its own code (music.MaNotConfigured)
        return exc.read_code
    if isinstance(exc, (ReadBlocked, CommandBlocked)):
        return "not_allowed"
    if isinstance(exc, Forbidden):
        return "forbidden"
    if isinstance(exc, NotFound):
        return "not_found"
    if isinstance(exc, ConnectionError):
        return "unavailable"
    return "failed"


_refused_at: dict[str, float] = {}
REFUSED_WARN_EVERY = 300.0


def _warn_refused(text: str, now: Callable[[], float] = time.monotonic, what: str = "refused a read") -> None:
    """A refused read, logged once per distinct refusal every REFUSED_WARN_EVERY seconds: a page's
    feed that is not served yet (or not to this person) retries with backoff for ever. A read that
    failed upstream (`what` "a read failed": HA answering a calendar read with 500) the same way."""
    t = now()
    if t - _refused_at.get(text, float("-inf")) >= REFUSED_WARN_EVERY:
        if len(_refused_at) > 256:
            _refused_at.clear()
        _refused_at[text] = t
        log.warning("%s: %s (repeats are logged every %d s)", what, text, REFUSED_WARN_EVERY)


def register(app, hub, hooks) -> FilteredReads:
    """Client messages `read`, `read_subscribe`, `read_unsubscribe`, `read_api`, RBAC-filtered.

    Same frames as server.py's unfiltered read() today ({"type":"read_result","id",...} and
    {"type":"read_event","id","event"}), so the page's hub.js is unchanged; P3.7 retires that one.
    A read whose HA type a connector registered in app["read_routes"] (camera signaling) goes there.
    MANTEL_READS are registered there too, answered here from Mantel's own copies (ROUTE_RULES).
    """
    from .hidden import MAX_IDS, Hiding

    reads = FilteredReads(lambda: getattr(hub, "readproxy", None), hooks)
    app["filtered_reads"] = reads
    routes = read_routes(app)
    hiding = Hiding(getattr(hub, "store", None), getattr(hub, "registry", None))
    app["hiding"] = hiding

    async def entity_registry_get(ctx: Ctx, msg: dict) -> dict:
        if set(msg) - {"id", "type", "entity_id"}:
            raise ReadBlocked("config/entity_registry/get carries entity_id only")
        eid = msg.get("entity_id")
        if not isinstance(eid, str) or not ENTITY_ID.match(eid):
            raise ReadBlocked("config/entity_registry/get needs an entity_id")
        entry = (getattr(getattr(hub, "registry", None), "entries", None) or {}).get(eid)
        # one answer for "no such entity" and "not yours to view"; RBAC is asked either way
        allowed = eid in await allowed_ids(reads.hooks, ctx.identity, "view", [eid])
        if not isinstance(entry, dict) or not allowed:
            raise NotFound("Entity not found")
        return registry_answer(entry)

    async def hidden_get(ctx: Ctx, msg: dict) -> dict:
        if set(msg) - {"id", "type", "entity_ids"}:
            raise ReadBlocked("hk_frontend/hidden/get carries entity_ids only")
        asked = msg.get("entity_ids")
        if asked is not None:
            if not isinstance(asked, list) or len(asked) > MAX_IDS or \
                    not all(isinstance(i, str) and ENTITY_ID.match(i) for i in asked):
                raise ReadBlocked("hk_frontend/hidden/get: entity_ids must be entity ids")
            asked = list(dict.fromkeys(asked))
        service = app.get("settings")
        if service is None:
            raise ConnectionError("unavailable")
        from .settings_store import Scope
        if not await service.allowed(ctx.identity, Scope("house", "settings")):
            raise Forbidden("Hidden Accessories needs configure on settings")
        settings = {**service.house_settings(),
                    "accessories": service.store.body("house", "accessories") or {"entities": {}}}
        snap = hiding.snapshot(settings, asked)
        names = hiding.entity_ids_in(snap) | set(asked or ())
        visible = await allowed_ids(reads.hooks, ctx.identity, "view", sorted(names))
        return hiding.only_visible(snap, visible, asked)

    routes.update({"config/entity_registry/get": Route(request=entity_registry_get),
                   "hk_frontend/hidden/get": Route(request=hidden_get)})

    async def answer(ctx: Ctx, rid: Any, work) -> None:
        try:
            result = await work
        except Exception as exc:  # noqa: BLE001 -- a failed read is the page's error, never the socket's
            code = _error_code(exc)
            if code in ("not_allowed", "forbidden"):
                _warn_refused(str(exc))
            elif code == "failed":
                # (a calendar its account no longer reads answers 500 at every load: the house, 2026-10-20,
                # when Mantel's log said nothing and the page only "couldn't be read")
                _warn_refused(f"{type(exc).__name__}: {exc}", what="a read failed")
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
            key = ("read", rid)
            if not isinstance(rid, int) or not ctx.reserve(key):         # (taken before any await: Ctx.reserve)
                raise ReadBlocked("invalid id")
            try:
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
            except BaseException:
                ctx.unreserve(key)
                raise
            await ctx.keep(key, unsub, kind=inner.get("type"))
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
