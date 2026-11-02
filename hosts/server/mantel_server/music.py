"""WHOLE-HOME MUSIC IN MANTEL (Phase 4): HK's music engine, talking to Music Assistant directly.

Until now HK's Music page was answered by Home Assistant's ``hk_frontend`` integration, through an interim
read bridge (readproxy.py: ``hk_music/subscribe``, ``/queue``, ``/settings/library``), and its actions went to
HA's engine. This module runs the same engine inside Mantel Server:

* **The decisions are hk_core's** (``hk_core/music``): the configuration model, which rooms a request claims,
  what is in the way, who leads, what a move leaves behind, the refusals, the volume steps, the settings
  checks, a queue item's shape and Keep Playlists Ready's rounds. They read the house through MantelHouse
  (the hub's copy of HA's states and registries: the Music Assistant players' ``media_player`` states that
  HA's ``music_assistant`` integration keeps).
* **The steps are Music Assistant's own WebSocket commands** (connectors/ma.py), exactly the ones HA's
  ``music_assistant`` integration sends for the service calls HA's engine makes (``to_ma``). A player's
  Music Assistant id is its entity registry ``unique_id`` (platform ``music_assistant``); its queue id is
  its player id.
* **Commands go through the gateway, and only through it.** HK's music actions (``hk_frontend.music_*``
  service calls) and writes (``hk_music/*``) are gateway commands (classify_service / classify_ws): RBAC on
  the rooms they name, the audit row first, then ``Gateway._forward`` hands them to ``MusicHost.run``. Each
  request's Music Assistant commands carry a ``MusicRun``: the gateway (the MA client's gate) allows a
  command only for an open run, only one of the engine's own commands, and only on the house's speakers.
  With commands off there is no gateway, the MA client's gate refuses everything, and the page's commands
  are refused before anything is sent (server.py ``commands_disabled``).
* **Reads** (``hk_music/subscribe``, ``/queue``, ``/settings/library``) are answered here with RBAC (feature
  ``music``; only the players the person may view). HK Settings' Music page (``hk_music/settings/get``) is
  feature_pages.py's route, which answers with ``MusicHost.page`` while this engine is on. The feed's ``home`` is the person's own home room, else the wall
  tablet's room: Mantel knows both (``home_for``).
* **The configuration** (speakers, house volume, home rooms, presets, playlists, Keep Playlists Ready,
  Ignore Announcements) is Mantel's settings document ``house/music``, imported from HA's music feature
  (``import_page``: HA's ``hk_music/settings/get``, a server-only read) with the feature import (or once by
  HK Settings' music page when Mantel has none), and saved by HK Settings' music page (a settings write through
  feature_pages.py, ``configure`` on settings and music; Music Assistant not needed).

THE SWITCH (``MusicHost.active``): Mantel answers only when BOTH Music Assistant is configured in Mantel
(``cfg.ma_url`` and its token file) AND the music settings are in Mantel's store. Otherwise every read goes
to the interim bridge and every command to HA's engine, exactly as before, so the house keeps working in
HA App mode until Music Assistant's URL and token are given to Mantel (docs/OPERATIONS.md).

**Browse's library reads are reads** (``music_assistant/get_library``, ``MusicHost.get_library``): HK's library card
asks ``call_service music_assistant.get_library`` with ``return_response`` for its Discover shelves and every
category list. The page's shim (mantel-client.js) sends exactly that service, and nothing else, as the read
``music_assistant/get_library`` (Mantel's own read type, answered here), so it works with commands off and never
reaches the gateway, the audit or Home Assistant. Fields are checked against what HA's action accepts
(``check_get_library``), RBAC is ``view`` on feature ``music`` (no player is involved), and the answer is HA's
``{items: [{media_type, uri, name, version, image, artists, album}]}`` from Music Assistant's library-items
commands. Without Music Assistant in Mantel the read answers ``ma_not_configured`` and the shim falls back to the
old path (the call as a gateway command: HA's, or refused with commands off).

Announcement markers watch HA service events and player states for display-only suppression.
**Nothing about music through HA** (2026-10-31; docs/phase4/MANTEL-FEATURES.md): while Music Assistant is connected
here the speakers' states and covers are Music Assistant's (music_states.py), a page's plain ``media_player.*`` calls
on its speakers go to it (``MusicHost.route``), and Browse's tree, search, Up Next and the next-cover search are
answered from it (music_browse.py; the reads ``music_assistant/get_queue`` and ``/search``).
Not here: the failure notifications (HA raises persistent notifications; Mantel logs them and lists them in its
status).
"""
from __future__ import annotations

import asyncio
import copy
import itertools
import json
import logging
import re
import time
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from hk_core.house import area_of
from hk_core.music import engine as E
from hk_core.music import queue as Q
from hk_core.music import settings as S
from hk_core.music.config import Item, MusicConfig
from hk_core.music.const import (
    COMMANDS, CONF_CHOOSER, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS,
    CONF_KEEP_READY, CONF_MEMBERS, CONF_NAME, CONF_ORDER, CONF_PAIRS, CONF_PLAYERS, CONF_SPEAKERS, CONF_VOLUME,
    DEFAULT_VOLUME, NOTE_GROUP,
    NOTE_PARTIAL, NOTE_PLAY, NOTE_PRESET, NOTE_STOP, NOTE_TRANSFER, SERVICE_PLAY, SERVICE_PLAY_MEDIA, SERVICE_STOP,
    SERVICE_TRANSFER, SERVICE_TRANSPORT, SUB_PLAYLIST, SUB_PRESET, WARM_FIRST, WARM_RETRY, WARM_SOON,
    GROUPS_EVERY,
)
from hk_core.music.engine import ACTIVE, STOPPED, SUPERSEDED
from hk_core.music.groups import Groups, signature
from hk_core.music.resume import Resumes
from hk_core.music.queue import QUEUE_MAX
from hk_core.music.warm import Warmer

from .connectors import Ctx, Forbidden, Route, allowed_ids, may_feature, read_routes, ws_handlers
from .ha_client import HaCommandError
from .house import MantelHouse
from .music_announcements import Announcements

log = logging.getLogger("mantel.music")

MUSIC_DOC = "music"                       # house/<this>: speakers, volume, homes, presets, playlists, switches
MA_PLATFORM = "music_assistant"
DOMAIN = "hk_frontend"
MUSIC_SERVICES = frozenset({SERVICE_PLAY, SERVICE_TRANSFER, SERVICE_STOP, SERVICE_TRANSPORT, SERVICE_PLAY_MEDIA})
SETTINGS_WRITES = frozenset({"hk_music/settings/set", "hk_music/preset/save", "hk_music/playlist/save",
                             "hk_music/playlists/order", "hk_music/item/remove"})
PLAY_WRITES = frozenset({"hk_music/queue_play", "hk_music/used"})
MUSIC_WS = SETTINGS_WRITES | PLAY_WRITES
IMPORT_READ = "hk_music/settings/get"      # HA's music settings page: the import's one read (server-only)
ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
PLAYER = re.compile(r"^media_player\.[a-z0-9_]+$")
KEY = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
TEXT_MAX = 200
ITEMS_MAX = 100

# Every read this module answers in app["read_routes"] has exactly one rule here (tests/test_music.py).
ROUTE_RULES: dict[str, str] = {
    "hk_music/subscribe": "feature:music; per person/device: only the players the subject may view (a preset when "
                          "all its rooms are viewable); `home` the person's home room, else the wall "
                          "tablet's room; display-only announcement markers. Bridge to HA while Mantel's engine is off",
    "hk_music/queue": "view the media player (media_player.* only), else not_found; limit 1..100; from Music "
                      "Assistant's queue; items {id, title, artist, duration, image}, token-carrying images dropped. "
                      "Bridge to HA while Mantel's engine is off",
    "hk_music/settings/library": "feature:music; Music Assistant's library playlists as {uri, name}. Bridge to HA "
                                 "while Mantel's engine is off",
    "music_assistant/get_library": "feature:music (view; no player); HA's music_assistant.get_library fields only; "
                                   "Music Assistant's library items as {items: [...]}. Needs Music Assistant in Mantel "
                                   "(else ma_not_configured), not the music settings",
    "music_assistant/get_queue": "feature:music and view every media player named, else not_found; Music Assistant "
                                 "speakers only (else ma_not_configured, as without Music Assistant here); HA's "
                                 "get_queue answer {entity: queue details} from Music Assistant's active queue",
    "music_assistant/search": "feature:music (view; no player); HA's music_assistant.search fields only; Music "
                              "Assistant's search as HA's {artists, albums, tracks, ...}. Needs Music Assistant in "
                              "Mantel (else ma_not_configured)",
    "media_player/browse_media": "view the media player, else not_found. A Music Assistant speaker while Music "
                                 "Assistant is connected here: answered by Mantel from Music Assistant's reads in "
                                 "HA's BrowseMedia shape (music_browse.py; a media-source:// id stays HA's). "
                                 "Otherwise readproxy's (HA answers it); when HA fails to open a playlist uri, Music "
                                 "Assistant is asked once for its songs (a read); a refused sign-in (LoginFailed) is "
                                 "answered login_failed with what to do, else HA's error",
    "media_player/search_media": "view the media player, else not_found. A Music Assistant speaker while Music "
                                 "Assistant is connected here: Music Assistant's search in HA's SearchMedia shape "
                                 "(music_browse.py). Otherwise readproxy's (HA answers it)",
}

# measured timings (hk_core/music/const.py), read at call time so tests can shorten them
from hk_core.music.const import (  # noqa: E402
    JOIN_SETTLE, JOIN_TIMEOUT, PAUSE_TIMEOUT, RELEASE_TIMEOUT, START_TIMEOUT, STOP_TIMEOUT, TRANSFER_TIMEOUT,
)

# The request being served (set by MusicHost.run, carried into every await of it): its MusicRun.
RUN: ContextVar["MusicRun | None"] = ContextVar("mantel_music_run", default=None)


class MaNotConfigured(ConnectionError):
    """Answered to a library read when Music Assistant is not given to Mantel (readproxy._error_code: `read_code`)."""
    read_code = "ma_not_configured"


class SignInRefused(RuntimeError):
    """A playlist HA could not open because the streaming service refused Music Assistant's sign-in
    (``MusicHost.why_not_opened``): the page reads ``login_failed`` and this message, not HA's ``unknown_error``."""
    read_code = "login_failed"


# music_assistant_models.errors.LoginFailed.error_code: MA could not sign in to a streaming service (Apple Music's
# user token expired), so it cannot read that account's own library -- its saved playlists. A catalog playlist (a
# search result's apple_music://playlist/pl.…) needs no account and still opens.
MA_LOGIN_FAILED = 6
SIGN_IN_AGAIN = ("Music Assistant's sign-in to your music service was refused, so your saved playlists cannot "
                 "be read. Sign in to it again in Music Assistant (Settings, then Providers).")
MEDIA_URI = re.compile(r"^([a-z0-9_]+(?:--[A-Za-z0-9]+)?)://(playlist)/([^/?#]{1,200})$")


class MusicRefusal(HaCommandError):
    """An answer the page reads as HA's error (`code`, `message`: HA's `invalid_format` is a JSON field map)."""

    def __str__(self) -> str:
        return self.message or self.code


# ------------------------------------------------------------------------------------- the settings doc
def empty_doc() -> dict[str, Any]:
    return {"options": {CONF_SPEAKERS: [], CONF_VOLUME: DEFAULT_VOLUME, CONF_HOMES: {}, CONF_KEEP_READY: False,
                        CONF_IGNORE_ANNOUNCEMENTS: True}, "items": [], "source": None}


def _text(v: Any, limit: int = TEXT_MAX) -> str:
    if not isinstance(v, str) or len(v) > limit:
        raise ValueError("text")
    return v


def check_doc(body: Any) -> dict[str, Any]:
    """``house/music`` as Mantel keeps it, checked: {options: {speakers, volume, homes, keep_ready,
    ignore_announcements, pairs?}, items: [{kind, key, title, data}], source}. Raises ValueError."""
    if not isinstance(body, Mapping):
        raise ValueError("house/music is an object")
    out = empty_doc()
    opts = body.get("options") if isinstance(body.get("options"), Mapping) else {}
    sp = opts.get(CONF_SPEAKERS, [])
    if not isinstance(sp, list) or not all(isinstance(x, str) and PLAYER.match(x) for x in sp):
        raise ValueError("options.speakers: media_player entity ids")
    out["options"][CONF_SPEAKERS] = list(dict.fromkeys(sp))
    vol = opts.get(CONF_VOLUME, DEFAULT_VOLUME)
    if isinstance(vol, bool) or not isinstance(vol, (int, float)) or not 0 <= vol <= 1:
        raise ValueError("options.volume: 0..1")
    out["options"][CONF_VOLUME] = round(float(vol), 2)
    homes = opts.get(CONF_HOMES, {})
    if not isinstance(homes, Mapping) or not all(isinstance(k, str) and 0 < len(k) <= 100 and isinstance(v, str)
                                                  and PLAYER.match(v) for k, v in homes.items()):
        raise ValueError("options.homes: {person: media_player}")
    out["options"][CONF_HOMES] = dict(homes)
    for k in (CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS):
        if k in opts:
            if not isinstance(opts[k], bool):
                raise ValueError(f"options.{k}: true or false")
            out["options"][k] = opts[k]
    if CONF_PAIRS in opts:       # VIRTUAL PAIRS (docs/phase4/VIRTUAL-PAIRS.md): [{players: [first, second], name}]
        pairs = opts[CONF_PAIRS]
        if not isinstance(pairs, list) or len(pairs) > ITEMS_MAX or not all(
                isinstance(p, Mapping) and isinstance(p.get(CONF_PLAYERS), list) and len(p[CONF_PLAYERS]) == 2
                and all(isinstance(x, str) and PLAYER.match(x) for x in p[CONF_PLAYERS]) for p in pairs):
            raise ValueError("options.pairs: [{players: [two media_players], name}]")
        out["options"][CONF_PAIRS] = [{CONF_PLAYERS: list(p[CONF_PLAYERS]), CONF_NAME: _text(p.get(CONF_NAME) or "")}
                                      for p in pairs]
    items = body.get("items", [])
    if not isinstance(items, list) or len(items) > ITEMS_MAX:
        raise ValueError(f"items: at most {ITEMS_MAX}")
    seen = set()
    for it in items:
        if not isinstance(it, Mapping) or it.get("kind") not in (SUB_PRESET, SUB_PLAYLIST) \
                or not isinstance(it.get("key"), str) or not KEY.match(it["key"]) or it["key"] in seen:
            raise ValueError("items: {kind: preset|playlist, key, title, data}")
        seen.add(it["key"])
        d = it.get("data") if isinstance(it.get("data"), Mapping) else {}
        if it["kind"] == SUB_PRESET:
            # (a group saved with a preset before presets were Mantel's own is dropped: none plays it)
            members = d.get(CONF_MEMBERS)
            if not isinstance(members, list) or not all(isinstance(m, str) and PLAYER.match(m) for m in members):
                raise ValueError("a preset: {name, members}")
            data = {CONF_NAME: _text(d.get(CONF_NAME, "")), CONF_MEMBERS: list(members)}
        else:
            uris = d.get(CONF_ITEMS)
            order = d.get(CONF_ORDER, 0)
            if not isinstance(uris, list) or not all(isinstance(u, str) and 0 < len(u) <= 500 for u in uris) \
                    or isinstance(order, bool) or not isinstance(order, (int, float)):
                raise ValueError("a playlist: {name, icon, items, order, chooser?}")
            data = {CONF_NAME: _text(d.get(CONF_NAME, "")), CONF_ICON: _text(d.get(CONF_ICON) or S.DEFAULT_ICON),
                    CONF_ITEMS: list(uris), CONF_ORDER: float(order)}
            if d.get(CONF_CHOOSER):
                data[CONF_CHOOSER] = _text(d[CONF_CHOOSER])
        out["items"].append({"kind": it["kind"], "key": it["key"], "title": _text(it.get("title") or data[CONF_NAME]),
                             "data": data})
    src = body.get("source")
    out["source"] = src if isinstance(src, str) and len(src) <= 80 else None
    return out


def import_page(page: Any, source: str | None = None) -> dict[str, Any] | None:
    """HA's music settings page (``hk_music/settings/get``: settings_ws.page) -> ``house/music``, or None when
    HA's music is not set up. Home rooms are HA users' (``ha:<HA user id>``): a Mantel person linked to that HA
    user has that home room until one is chosen for them in Mantel. Values that would not pass check_doc are
    left out rather than failing the import."""
    if not isinstance(page, Mapping) or not page.get("configured"):
        return None
    sp = [s.get("entity") for s in page.get("speakers") or [] if isinstance(s, Mapping)]
    sp = [s for s in sp if isinstance(s, str) and PLAYER.match(s)]
    homes = {f"ha:{u}": r for u, r in (page.get("homes") or {}).items()
             if isinstance(u, str) and 0 < len(u) <= 64 and isinstance(r, str) and r in sp}
    vol = page.get("volume", DEFAULT_VOLUME)
    opts = {CONF_SPEAKERS: sp, CONF_VOLUME: vol if isinstance(vol, (int, float)) and not isinstance(vol, bool)
            and 0 <= vol <= 1 else DEFAULT_VOLUME, CONF_HOMES: homes,
            CONF_KEEP_READY: page.get("keep_ready") is True,
            CONF_IGNORE_ANNOUNCEMENTS: page.get("ignore_announcements", True) is not False}
    items = []
    for p in page.get("presets") or []:
        one = {"kind": SUB_PRESET, "key": p.get("id"), "title": p.get("name"),
               "data": {CONF_NAME: p.get("name"), CONF_MEMBERS: p.get("members")}} \
            if isinstance(p, Mapping) else None
        items.append(one)
    for p in page.get("playlists") or []:
        if not isinstance(p, Mapping):
            continue
        data = {CONF_NAME: p.get("name"), CONF_ICON: p.get("icon") or S.DEFAULT_ICON, CONF_ITEMS: p.get("items"),
                CONF_ORDER: p.get("order") or 0}
        if p.get("chooser"):
            data[CONF_CHOOSER] = p["chooser"]
        items.append({"kind": SUB_PLAYLIST, "key": p.get("id"),
                      "title": S.playlist_title(str(p.get("name") or ""), p.get("chooser")), "data": data})
    good = []
    for it in items:
        try:
            check_doc({"options": {}, "items": [it]})
            good.append(it)
        except (ValueError, TypeError):
            log.warning("music import: left out a preset or playlist HA has that Mantel cannot keep")
    return check_doc({"options": opts, "items": good, "source": source})


async def import_doc(panel: Any, read: Callable[[dict], Any], source: str | None = None) -> dict[str, Any] | None:
    """The feature import's music part: only when HA has Music added (panel/get's ``features.hk_music``), one
    server-only read of HA's music settings page. Reads only; never writes to HA."""
    feats = panel.get("features") if isinstance(panel, Mapping) else None
    hk = feats.get("hk_music") if isinstance(feats, Mapping) else None
    if not isinstance(hk, Mapping) or not hk.get("entries"):
        return None
    return import_page(await read({"type": IMPORT_READ}), source)


# ---------------------------------------------------------------------------- Music Assistant's players
def ma_players(registry: Any) -> dict[str, str]:
    """{media_player entity: its Music Assistant player id} (HA's music_assistant entities' unique ids)."""
    out = {}
    for e in getattr(registry, "entity_entries", None) or []:
        eid, uid = e.get("entity_id"), e.get("unique_id")
        if e.get("platform") == MA_PLATFORM and isinstance(eid, str) and eid.startswith("media_player.") \
                and isinstance(uid, str) and uid:
            out[eid] = uid
    return out


def library_entry(registry: Any) -> str | None:
    """Music Assistant's config entry in HA (Browse's ``get_library`` asks it): from its entities' entries."""
    for e in getattr(registry, "entity_entries", None) or []:
        if e.get("platform") == MA_PLATFORM and isinstance(e.get("config_entry_id"), str):
            return e["config_entry_id"]
    return None


def _ids(value: Any) -> list[str]:
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [v for v in value if isinstance(v, str)] if isinstance(value, (list, tuple)) else []


PLAYER_COMMANDS = {"media_play": "players/cmd/play", "media_pause": "players/cmd/pause",
                   "media_play_pause": "players/cmd/play_pause", "media_stop": "players/cmd/stop",
                   "media_next_track": "players/cmd/next", "media_previous_track": "players/cmd/previous"}


def to_ma(domain: str, service: str, data: Mapping[str, Any], pid: Callable[[str], str]) -> list[tuple[str, dict]]:
    """One of HA's engine's service calls -> the Music Assistant commands HA's ``music_assistant`` integration
    sends for it (its media_player entity calls the official client: ``players/cmd/*``, ``player_queues/*``).
    ``pid``: entity -> MA player id (KeyError for one that is not a Music Assistant player). HA's volume is
    0..1, Music Assistant's 0..100."""
    ents = _ids(data.get("entity_id"))
    if domain == "media_player" and service in PLAYER_COMMANDS:
        return [(PLAYER_COMMANDS[service], {"player_id": pid(e)}) for e in ents]
    if domain == "media_player" and service == "unjoin":
        return [("players/cmd/ungroup", {"player_id": pid(e)}) for e in ents]
    if domain == "media_player" and service == "join":
        return [("players/cmd/group_many", {"target_player": pid(ents[0]),
                                            "child_player_ids": [pid(m) for m in _ids(data.get("group_members"))]})]
    if domain == "media_player" and service == "volume_set":
        level = int(round(float(data["volume_level"]) * 100))
        return [("players/cmd/volume_set", {"player_id": pid(e), "volume_level": level}) for e in ents]
    if domain == "media_player" and service == "shuffle_set":
        return [("player_queues/shuffle", {"queue_id": pid(e), "shuffle_enabled": bool(data["shuffle"])}) for e in ents]
    if domain == "media_player" and service in ("volume_up", "volume_down"):
        return [(f"players/cmd/{service}", {"player_id": pid(e)}) for e in ents]
    if domain == "media_player" and service == "volume_mute":
        return [("players/cmd/volume_mute", {"player_id": pid(e), "muted": bool(data["is_volume_muted"])}) for e in ents]
    if domain == "media_player" and service == "media_seek":
        return [("players/cmd/seek", {"player_id": pid(e), "position": int(float(data["seek_position"]))}) for e in ents]
    if domain == "media_player" and service == "repeat_set":
        if data.get("repeat") not in ("off", "one", "all"):
            raise KeyError("repeat is off, one or all")
        return [("player_queues/repeat", {"queue_id": pid(e), "repeat_mode": data["repeat"]}) for e in ents]
    if domain == "media_player" and service == "play_media":
        return [("player_queues/play_media", {"queue_id": pid(e), "media": [str(data["media_content_id"])],
                                              "option": data.get("enqueue") or "play"}) for e in ents]
    if domain == "music_assistant" and service == "play_media":
        media = data["media_id"]
        return [("player_queues/play_media", {"queue_id": pid(e), "media": list(media) if isinstance(media, list)
                                              else [media], "option": data.get("enqueue") or "play"}) for e in ents]
    if domain == "music_assistant" and service == "transfer_queue":
        return [("player_queues/transfer", {"source_queue_id": pid(data["source_player"]),
                                            "target_queue_id": pid(ents[0]),
                                            "auto_play": bool(data.get("auto_play", True))})]
    raise KeyError(f"{domain}.{service} has no Music Assistant command here")


# Every Music Assistant command a request's steps may send (to_ma's, and the queue's play_index).
RUN_COMMANDS = frozenset({*PLAYER_COMMANDS.values(), "players/cmd/ungroup", "players/cmd/group_many",
                          "players/cmd/volume_set", "player_queues/shuffle", "player_queues/play_media",
                          "player_queues/transfer", "player_queues/play_index",
                          # a page's own media_player.* call on a Music Assistant speaker (MA_SERVICES)
                          "players/cmd/volume_up", "players/cmd/volume_down", "players/cmd/volume_mute",
                          "players/cmd/seek", "player_queues/repeat"})

# HA's media_player services a page calls on a speaker (the Side Pane's volume and play/pause, the media sheet, the
# screensaver, the Speakers sheet, the app's volume) that go to Music Assistant, not HA, while it is connected to
# Mantel (MusicHost.route). The data each may carry besides entity_id; anything else (a TV's select_source) is HA's.
MA_SERVICES: dict[str, frozenset[str]] = {
    **{s: frozenset() for s in PLAYER_COMMANDS}, "unjoin": frozenset(), "join": frozenset({"group_members"}),
    "volume_set": frozenset({"volume_level"}), "volume_up": frozenset(), "volume_down": frozenset(),
    "volume_mute": frozenset({"is_volume_muted"}), "media_seek": frozenset({"seek_position"}),
    "shuffle_set": frozenset({"shuffle"}), "repeat_set": frozenset({"repeat"}),
    "play_media": frozenset({"media_content_id", "media_content_type", "enqueue"}),
}
OP_SERVICE = "media_player"        # MusicHost.run's op for one of them
VOLUME_SERVICES = frozenset({"volume_set", "volume_up", "volume_down", "volume_mute"})
_PLAYER_ARGS = ("player_id", "queue_id", "target_player", "source_queue_id", "target_queue_id")
_PLAYER_LISTS = ("child_player_ids", "player_ids")


class MusicRun:
    """One audited music request, as the MA client's gate (the gateway) sees it: minted only by
    ``MusicHost.run`` (which only the gateway calls, after RBAC and the audit row), open while the request
    runs, for the engine's own commands (RUN_COMMANDS) on the house's speakers (``players``: their MA ids)."""

    def __init__(self, principal: Any, audit_id: int, players: Iterable[str]) -> None:
        self.principal, self.audit_id = principal, audit_id
        self.players = frozenset(players)
        self.open = audit_id > 0
        self.sent: list[str] = []

    def allow(self, command: str, args: Mapping[str, Any]) -> bool:
        if not self.open or command not in RUN_COMMANDS:
            return False
        named = [args[k] for k in _PLAYER_ARGS if k in args]
        for k in _PLAYER_LISTS:
            if k in args:
                if not isinstance(args[k], list):
                    return False
                named += args[k]
        if not named or not all(isinstance(p, str) and p in self.players for p in named):
            return False
        self.sent.append(command)
        return True


# ---------------------------------------------------------------------------- Browse's library read
# music_assistant.get_library as HA 2026.10 accepts it (the action's fields), and Music Assistant's command per type.
LIBRARY_COMMAND = {"artist": "artists", "album": "albums", "track": "tracks", "playlist": "playlists",
                   "radio": "radios", "podcast": "podcasts", "audiobook": "audiobooks"}
LIBRARY_ORDER = frozenset({"name", "name_desc", "sort_name", "sort_name_desc", "timestamp_added",
                           "timestamp_added_desc", "last_played", "last_played_desc", "play_count",
                           "play_count_desc", "random", "random_play_count"})
ALBUM_TYPES = frozenset({"album", "single", "compilation", "ep", "unknown"})
LIBRARY_FIELDS = frozenset({"config_entry_id", "media_type", "favorite", "search", "limit", "offset", "order_by",
                            "album_type", "album_artists_only"})
LIBRARY_LIMIT = 500
IMAGE_SIZE = 256


def check_get_library(data: Any) -> dict[str, Any]:
    """``music_assistant.get_library``'s service data -> Music Assistant's ``library_items`` call:
    ``{"media_type": "albums", "args": {...}}``. Anything HA's action would not take raises ValueError."""
    if not isinstance(data, Mapping):
        raise ValueError("get_library takes its fields in service_data")
    extra = set(data) - LIBRARY_FIELDS
    if extra:
        raise ValueError(f"get_library may not carry {sorted(extra)}")
    entry = data.get("config_entry_id")
    if entry is not None and (not isinstance(entry, str) or len(entry) > 128):
        raise ValueError("config_entry_id is a string")
    kind = data.get("media_type")
    if kind not in LIBRARY_COMMAND:
        raise ValueError(f"media_type is one of {sorted(LIBRARY_COMMAND)}")
    args: dict[str, Any] = {}
    for key in ("favorite", "album_artists_only"):
        if key in data:
            if not isinstance(data[key], bool):
                raise ValueError(f"{key} is true or false")
            if key == "album_artists_only" and kind != "artist":
                raise ValueError("album_artists_only is for artists")
            args[key] = data[key]
    if "search" in data:
        if not isinstance(data["search"], str) or len(data["search"]) > TEXT_MAX:
            raise ValueError(f"search is text of at most {TEXT_MAX} characters")
        if data["search"]:
            args["search"] = data["search"]
    for key, low, high in (("limit", 1, LIBRARY_LIMIT), ("offset", 0, 10_000_000)):
        if key in data:
            v = data[key]
            if isinstance(v, bool) or not isinstance(v, int) or not low <= v <= high:
                raise ValueError(f"{key} is {low}..{high}")
            args[key] = v
    args.setdefault("limit", 25)                      # HA's default
    if "order_by" in data:
        if data["order_by"] not in LIBRARY_ORDER:
            raise ValueError(f"order_by is one of {sorted(LIBRARY_ORDER)}")
        args["order_by"] = data["order_by"]
    if "album_type" in data:
        kinds = data["album_type"]
        if kind != "album":
            raise ValueError("album_type is for albums")
        if isinstance(kinds, str):
            kinds = [kinds]
        if not isinstance(kinds, list) or not kinds or not all(k in ALBUM_TYPES for k in kinds):
            raise ValueError(f"album_type is some of {sorted(ALBUM_TYPES)}")
        args["album_types"] = list(dict.fromkeys(kinds))
    return {"media_type": LIBRARY_COMMAND[kind], "args": args}


PROXY_ID = re.compile(r"^[0-9a-f]{64}$")


def _library_image(v: Any) -> str | None:
    """A library item's picture as a page can load it: the artwork's own address when it is a web one without a
    token, else Music Assistant's image proxy under Mantel's ``/ma`` (media_proxy.py: the page's prefix goes in
    front in the shim). None when there is none.

    MUSIC ASSISTANT 2.10 SERVES ``/imageproxy/<proxy_id>`` ONLY: the ``proxy_id`` it puts on every image it
    sends. Its old ``/imageproxy?path=…&provider=…`` answers 400, which is every playlist's and album's artwork
    that is not a web address (a collage, a playlist's own picture, Apple Music's). The old form is kept only
    for a Music Assistant that sends no ``proxy_id``."""
    from urllib.parse import quote
    from .readproxy import _safe_image
    if isinstance(v, str):
        return _safe_image(v)
    if not isinstance(v, Mapping) or not isinstance(v.get("path"), str) or not v["path"]:
        return None
    path, provider = v["path"], v.get("provider")
    if v.get("remotely_accessible") is True or path.startswith(("http://", "https://")):
        return _safe_image(path)
    pid = v.get("proxy_id")
    if isinstance(pid, str) and PROXY_ID.match(pid.lower()):
        return f"/ma/imageproxy/{pid.lower()}?size={IMAGE_SIZE}"
    if not isinstance(provider, str):
        return None
    return f"/ma/imageproxy?path={quote(path, safe='')}&provider={quote(provider, safe='')}&size={IMAGE_SIZE}"


def _item_image(item: Mapping[str, Any]) -> str | None:
    img = item.get("image")
    if img is None:
        meta = item.get("metadata")
        imgs = meta.get("images") if isinstance(meta, Mapping) else None
        if isinstance(imgs, list):
            ranked = [i for i in imgs if isinstance(i, Mapping)]
            ranked.sort(key=lambda i: 0 if i.get("type") == "thumb" else 1)
            img = ranked[0] if ranked else None
    return _library_image(img)


def library_item(item: Mapping[str, Any], nested: bool = False) -> dict[str, Any]:
    """HA's ``media_item_dict_from_mass_item``: {media_type, uri, name, version, image[, artists, album]}."""
    def text(v: Any) -> str:
        return v if isinstance(v, str) else ""
    kind = item.get("media_type")
    out: dict[str, Any] = {"media_type": text(getattr(kind, "value", kind)), "uri": text(item.get("uri")),
                           "name": text(item.get("name")), "version": text(item.get("version")),
                           "image": _item_image(item)}
    if not nested:
        artists = item.get("artists")
        if isinstance(artists, list) and artists:
            out["artists"] = [library_item(a, True) for a in artists if isinstance(a, Mapping)]
        album = item.get("album")
        if isinstance(album, Mapping):
            out["album"] = library_item(album, True)
    return out


# ------------------------------------------------------------------- Up Next and the next song's cover (reads)
# music_assistant.get_queue and music_assistant.search as HA 2026.10 accepts them, answered from Music Assistant
# (2026-10-31): the Music page's and the screensaver's Up Next, and the screensaver's search for the next song's cover.
SEARCH_FIELDS = frozenset({"config_entry_id", "name", "media_type", "artist", "album", "limit", "library_only"})
SEARCH_TYPES = ("artist", "album", "track", "playlist", "radio", "audiobook", "podcast")
SEARCH_KEYS = {"artist": "artists", "album": "albums", "track": "tracks", "playlist": "playlists", "radio": "radio",
               "audiobook": "audiobooks", "podcast": "podcasts"}


def check_search(data: Any) -> dict[str, Any]:
    """``music_assistant.search``'s service data -> Music Assistant's ``music/search`` args (HA's handler: the
    artist and album go in front of the name). Anything HA's action would not take raises ValueError."""
    if not isinstance(data, Mapping) or set(data) - SEARCH_FIELDS:
        raise ValueError(f"search takes {sorted(SEARCH_FIELDS)} in service_data")
    name = data.get("name")
    if not isinstance(name, str) or not 0 < len(name) <= TEXT_MAX:
        raise ValueError("name is text")
    parts = []
    for k in ("artist", "album"):
        v = data.get(k)
        if v is not None and (not isinstance(v, str) or len(v) > TEXT_MAX):
            raise ValueError(f"{k} is text")
        if v:
            parts.append(v)
    kinds = data.get("media_type", list(SEARCH_TYPES))
    kinds = [kinds] if isinstance(kinds, str) else kinds
    if not isinstance(kinds, list) or not kinds or not all(k in SEARCH_TYPES for k in kinds):
        raise ValueError(f"media_type is some of {list(SEARCH_TYPES)}")
    limit = data.get("limit", 5)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit is 1..100")
    if not isinstance(data.get("library_only", False), bool):
        raise ValueError("library_only is true or false")
    return {"search_query": " - ".join(parts + [name]), "media_types": list(dict.fromkeys(kinds)), "limit": limit,
            "library_only": data.get("library_only", False)}


def search_answer(got: Any) -> dict[str, list]:
    got = got if isinstance(got, Mapping) else {}
    return {key: [library_item(i) for i in got.get(key) or [] if isinstance(i, Mapping)] for key in SEARCH_KEYS.values()}


def queue_item_dict(item: Any) -> dict[str, Any] | None:
    """HA's queue_item_dict_from_mass_item (no stream details: nothing on a page reads them)."""
    if not isinstance(item, Mapping):
        return None
    mi = item.get("media_item")
    stream = item.get("streamdetails") if isinstance(item.get("streamdetails"), Mapping) else {}
    return {"queue_item_id": str(item.get("queue_item_id") or ""), "name": str(item.get("name") or ""),
            "duration": item.get("duration") if isinstance(item.get("duration"), int) else None,
            "media_item": library_item(mi) if isinstance(mi, Mapping) else None,
            "stream_title": stream.get("stream_title") if isinstance(stream.get("stream_title"), str) else None}


def queue_details(q: Mapping[str, Any]) -> dict[str, Any]:
    """HA's music_assistant.get_queue answer for one player (QUEUE_DETAILS_SCHEMA)."""
    return {"queue_id": q.get("queue_id"), "active": q.get("active"), "name": q.get("display_name"),
            "items": q.get("items"), "shuffle_enabled": q.get("shuffle_enabled"), "repeat_mode": q.get("repeat_mode"),
            "current_index": q.get("current_index"), "elapsed_time": q.get("elapsed_time"),
            "current_item": queue_item_dict(q.get("current_item")), "next_item": queue_item_dict(q.get("next_item"))}


# ----------------------------------------------------------------------------------- the gateway's side
def _room_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = [x.strip() for x in v.split(",") if x.strip()]
    if not isinstance(v, list) or not all(isinstance(x, str) and ENTITY.match(x) for x in v):
        from .gateway import Refused
        raise Refused("invalid_command", "rooms are media_player entity ids")
    return list(v)


def classify_service(domain: Any, service: Any, data: Any, target: Any, return_response: Any) -> Any:
    """``hk_frontend.music_*`` -> the gateway's Command, or None for any other service. Checks: ``control`` on
    feature ``music`` and on every room/player the call names (Stop All: every room, MusicHost.expand). The
    frame is HA's own call, sent to HA's engine when Mantel's is off."""
    if domain != DOMAIN or service not in MUSIC_SERVICES:
        return None
    from .gateway import Check, Command, Refused
    data = {} if data is None else data
    if not isinstance(data, dict) or target not in (None, {}) or not isinstance(return_response, bool):
        raise Refused("invalid_command", f"{DOMAIN}.{service} takes its fields in data")
    allowed = {SERVICE_PLAY: {"rooms", "playlist"}, SERVICE_TRANSFER: {"rooms", "source"}, SERVICE_STOP: {"rooms"},
               SERVICE_TRANSPORT: {"player", "command", "level"},
               SERVICE_PLAY_MEDIA: {"player", "media_content_id", "media_content_type"}}[service]
    if set(data) - allowed:
        raise Refused("invalid_command", f"{DOMAIN}.{service} carries {sorted(allowed)} only")
    args: dict[str, Any] = {}
    names: list[str] = []
    if "rooms" in allowed:
        args["rooms"] = _room_list(data.get("rooms")) if "rooms" in data or service != SERVICE_STOP else None
        if service != SERVICE_STOP and not args["rooms"]:
            raise Refused("invalid_command", "pick at least one speaker")
        names += args["rooms"] or []
    for k in ("source", "player"):
        if k in allowed:
            v = data.get(k)
            if not isinstance(v, str) or not ENTITY.match(v):
                raise Refused("invalid_command", f"{k} is a media_player entity id")
            args[k] = v
            names.append(v)
    if service == SERVICE_PLAY:
        if not isinstance(data.get("playlist"), str) or not 0 < len(data["playlist"]) <= TEXT_MAX:
            raise Refused("invalid_command", "playlist is a playlist's key")
        args["playlist"] = data["playlist"]
    if service == SERVICE_TRANSPORT:
        if data.get("command") not in COMMANDS:
            raise Refused("invalid_command", f"command is one of {list(COMMANDS)}")
        lv = data.get("level")
        if lv is not None and (isinstance(lv, bool) or not isinstance(lv, (int, float)) or not 0 <= lv <= 1):
            raise Refused("invalid_command", "level is 0..1")
        args.update(command=data["command"], level=lv)
    if service == SERVICE_PLAY_MEDIA:
        for k in ("media_content_id", "media_content_type"):
            if not isinstance(data.get(k), str) or not 0 < len(data[k]) <= 1000:
                raise Refused("invalid_command", f"{k} is a string")
            args[k] = data[k]
    action = f"{DOMAIN}.{service}"
    names = list(dict.fromkeys(names))
    checks = [Check("control", feature="music")] + [Check(action, n) for n in names]
    frame: dict = {"type": "call_service", "domain": DOMAIN, "service": service}
    if data:
        frame["service_data"] = data
    if return_response:
        frame["return_response"] = True
    return Command("service", action, checks, frame=frame, targets=names or ["feature:music"],
                   music={"op": service, "args": args, "return_response": return_response})


_WS_KEYS = {
    "hk_music/queue_play": ({"entity_id", "item_id"}, set()),
    "hk_music/used": (set(), set()),
    "hk_music/settings/set": ({"changes"}, set()),
    "hk_music/preset/save": ({"name", "members"}, {"item"}),
    "hk_music/playlist/save": ({"name", "items"}, {"item", "icon", "chooser", "order"}),
    "hk_music/playlists/order": ({"ids"}, set()),
    "hk_music/item/remove": ({"item"}, set()),
}


def classify_ws(inner: dict) -> Any:
    """An ``hk_music/*`` write -> the gateway's Command, or None. ``queue_play``: ``control`` on its player;
    ``used``: ``control`` on feature music; the settings writes: ``configure`` on settings (HA: require_admin)."""
    t = inner.get("type")
    if t not in MUSIC_WS:
        return None
    from .gateway import Check, Command, Refused
    need, may = _WS_KEYS[t]
    body = {k: v for k, v in inner.items() if k not in ("type", "id")}
    if need - set(body) or set(body) - need - may:
        raise Refused("invalid_command", f"{t} carries {sorted(need | may)}")
    names: list[str] = []
    if t == "hk_music/queue_play":
        if not isinstance(body["entity_id"], str) or not PLAYER.match(body["entity_id"]) \
                or not isinstance(body["item_id"], str) or not 0 < len(body["item_id"]) <= 200:
            raise Refused("invalid_command", "queue_play: a media_player entity_id and a queue item_id")
        names = [body["entity_id"]]
        checks = [Check("control", feature="music"), Check("media_player.play_media", body["entity_id"])]
    elif t == "hk_music/used":
        checks = [Check("control", feature="music")]
    else:
        checks = [Check("configure", feature="settings")]
    frame = {"type": t, **body}
    return Command("ws", t, checks, frame=frame, targets=names or [c.target for c in checks],
                   music={"op": t, "args": body, "return_response": True})


# ------------------------------------------------------------------------------------------ the engine
class MantelMusic:
    """HA's MusicManager (features/music/music.py), its steps sent to Music Assistant. Same structure, same
    names, same answers: per-room locks, the newest request wins, waits are on the players' state changes
    (the hub's), Stop cancels what runs for its rooms, every request answers {ok, leader} / {ok: False, message}."""

    def __init__(self, host: "MusicHost") -> None:
        self.host = host
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._tlocks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._claims = E.Claims()
        self._ids = itertools.count(1)
        self._running: dict[asyncio.Task[Any], set[str]] = {}
        self._stopped: set[asyncio.Task[Any]] = set()
        self.settle = JOIN_SETTLE
        self.notes: dict[str, dict[str, str]] = {}          # HA's persistent notifications, kept here
        self.log: list[dict[str, Any]] = []                  # the last requests (status)

    @property
    def house(self) -> MantelHouse:
        return self.host.house

    @property
    def config(self) -> MusicConfig:
        return self.host.config()

    def _state(self, entity: str) -> str | None:
        return E.state_of(self.house, entity)

    def _now_playing(self, entity: str) -> tuple[Any, ...]:
        return (self._state(entity), self._attr(entity, "media_content_id"), self._attr(entity, "media_title"))

    def _started_anew(self, entity: str, was: tuple[Any, ...]) -> bool:
        """Playing, and not still what played before: a speaker already playing said "playing" at once."""
        now = self._now_playing(entity)
        return now[0] == "playing" and (was[0] != "playing" or now[1:] != was[1:])

    def _attr(self, entity: str, name: str) -> Any:
        return E.attr(self.house, entity, name)

    def _members(self, entity: str) -> list[str]:
        return E.members(self.house, entity)

    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> bool:
        """One step, as HA's engine's service call, sent as Music Assistant's commands through the gated
        path (the request's MusicRun). Reports instead of raising: a failed step is a logged False."""
        run = RUN.get()
        client = self.host.ma
        try:
            if run is None or client is None:
                raise PermissionError("no audited music request is running")
            for command, args in to_ma(domain, service, data, self.host.pid):
                await client.command(run, command, **args)
        except Exception as err:  # noqa: BLE001 -- any failure is a result here
            log.warning("music: %s.%s failed: %s", domain, service, type(err).__name__)
            return False
        return True

    async def _wait(self, entities: Iterable[str], pred: Callable[[], bool], timeout: float) -> bool:
        if pred():
            return True
        done = asyncio.get_running_loop().create_future()

        def changed() -> None:
            if not done.done() and pred():
                done.set_result(True)

        stop = self.host.watch(set(entities), changed)
        try:
            async with asyncio.timeout(timeout):
                await done
            return True
        except TimeoutError:
            return pred()
        finally:
            stop()

    def _note(self, note_id: str, title: str, message: str) -> None:
        self.notes[note_id] = {"title": title, "message": message}
        log.info("music: %s: %s", title, message)

    def _clear(self, *note_ids: str) -> None:
        for n in note_ids:
            self.notes.pop(n, None)

    def _done(self, res: dict[str, Any], what: str, rid: int, t0: float) -> dict[str, Any]:
        quiet = res.get("ok") or res.get("superseded")
        log.log(logging.DEBUG if quiet else logging.INFO, "music #%d %s -> %s (%.1fs)", rid, what, res,
                time.monotonic() - t0)
        self.log = (self.log + [{"id": rid, "what": what, "result": res}])[-20:]
        return res

    @asynccontextmanager
    async def _request(self, rooms: Iterable[str]):
        task = asyncio.current_task()
        if task is not None:
            self._running[task] = set(rooms)
        try:
            yield
        finally:
            if task is not None:
                self._running.pop(task, None)

    def _was_stopped(self) -> bool:
        task = asyncio.current_task()
        if task is None or task not in self._stopped:
            return False
        self._stopped.discard(task)
        task.uncancel()
        return True

    @asynccontextmanager
    async def _hold(self, rooms: Iterable[str]):
        held: list[asyncio.Lock] = []
        try:
            for r in sorted(set(rooms)):
                lock = self._locks[r]
                await lock.acquire()
                held.append(lock)
            yield
        finally:
            for lock in reversed(held):
                lock.release()

    async def _release(self, rooms: list[str]) -> bool:
        playing = [r for r in rooms if self._state(r) == "playing"]
        if playing:
            await self._call("media_player", "media_pause", {"entity_id": playing})
            await self._wait(rooms, lambda: all(self._state(r) != "playing" for r in rooms), PAUSE_TIMEOUT)
        await self._call("media_player", "unjoin", {"entity_id": rooms})
        return await self._wait(rooms, lambda: all(len(self._members(r)) <= 1 for r in rooms), RELEASE_TIMEOUT)

    async def _join(self, leader: str, rooms: list[str]) -> bool:
        others = [r for r in rooms if r != leader]
        want = sorted(rooms)
        exact = lambda: sorted(self._members(leader)) == want  # noqa: E731
        for attempt in (1, 2):
            await asyncio.sleep(self.settle)
            await self._call("media_player", "join", {"entity_id": leader, "group_members": others})
            if await self._wait(rooms, exact, JOIN_TIMEOUT):
                return True
            log.warning("music: join %s <- %s attempt %d gave %s", leader, others, attempt, self._members(leader))
            await self._call("media_player", "unjoin", {"entity_id": rooms})
        return False

    # ---------------------------------------------------------------------------- requests
    async def play(self, rooms: list[str], playlist: str | None) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        rooms = list(rooms or [])
        what = f"play {playlist} rooms={rooms}"
        fail, pl = E.check_play(self.house, cfg, rooms, playlist)
        if fail:
            return self._done(fail, what, rid, t0)
        gone = await self._missing(cfg, pl.items)
        if gone:
            self._note(NOTE_PLAY, "A playlist is missing",
                       f"{pl.name} points at {', '.join(gone)}, which is no longer in the Music Assistant library.")
            return self._done(E.gone_from_library(pl), what, rid, t0)
        fail, preset, members = E.play_rooms(self.house, cfg, rooms)
        if fail:
            return self._done(fail, what, rid, t0)
        stamps = self._claims.claim(E.entangled(self.house, cfg, members))
        try:
            async with self._request(stamps):
                return self._done(await self._play(cfg, pl, rooms, preset, members, stamps), what, rid, t0)
        except asyncio.CancelledError:
            if self._was_stopped():
                return self._done(dict(STOPPED), what, rid, t0)
            raise

    async def _play(self, cfg, pl, rooms, preset, members, stamps) -> dict[str, Any]:
        async with self._hold(stamps):
            if self._claims.superseded(stamps):
                return dict(SUPERSEDED)
            target, existing, way = E.play_target(self.house, cfg, rooms, preset, members)
            split = E.split(self.house, cfg, way, set(members))
            for leader, rest, _gm in split:
                moved = await self._move(cfg, rest, leader, None)
                if not moved.get("ok"):
                    self._note(NOTE_PRESET if preset else NOTE_GROUP, "Speakers did not release",
                               f"The music in {', '.join(cfg.name_of(r) for r in rest)} could not keep playing "
                               "without the requested speakers. No new music was started. Try again.")
                    return {"ok": False, "message": "The speakers did not release."}
            if split:
                done = {m for _l, _r, gm in split for m in gm}
                way = [r for r in way if r not in done]
                if not way and preset is not None:
                    await asyncio.sleep(self.settle)
            # A VIRTUAL PAIR'S OWN GROUP holding its players while they are to play elsewhere: stopped first
            busy = E.groups_in_the_way(self.house, cfg, members, target)
            if busy:
                await self._call("media_player", "media_stop", {"entity_id": busy})
                await self._wait(busy, lambda: all(self._state(g) not in ACTIVE for g in busy), STOP_TIMEOUT)
                await asyncio.sleep(self.settle)
            if way:
                if not await self._release(way):
                    self._note(NOTE_PRESET if preset else NOTE_GROUP, "Speakers did not release",
                               "The previous group did not release the requested speakers. No new music was "
                               "started. Try again.")
                    return {"ok": False, "message": "The speakers did not release."}
                if preset is not None:
                    await asyncio.sleep(self.settle)
            if E.needs_join(rooms, preset, existing, cfg):
                if not await self._join(target, cfg.players_of(rooms)):
                    missing = list(dict.fromkeys(cfg.name_of(r) for r in cfg.players_of(rooms)
                                                 if r not in self._members(target)))
                    self._note(NOTE_GROUP, "Speakers did not group",
                               f"{', '.join(missing) or 'Some rooms'} did not join {cfg.name_of(target)}. Nothing "
                               "is playing -- the group was broken up rather than left wrong.")
                    return {"ok": False, "message": "The speakers did not group."}
            self._clear(NOTE_GROUP, NOTE_PRESET)
            await self._call("media_player", "volume_set", {"entity_id": E.volume_players(cfg, members),
                                                            "volume_level": cfg.volume})
            await self._call("media_player", "shuffle_set", {"entity_id": target, "shuffle": True})
            if self._claims.superseded(stamps):
                return dict(SUPERSEDED)
        await self._call("music_assistant", "play_media",
                         {"entity_id": target, "media_id": pl.items, "enqueue": "replace"})
        started = await self._wait([target], lambda: self._state(target) == "playing", START_TIMEOUT)
        if self._claims.superseded(stamps):
            return {"ok": True, "leader": target, "superseded": True}
        if not started:
            self._note(NOTE_PLAY, "The playlist did not start",
                       f"{pl.name} did not start on {cfg.name_of(target)} -- it is {self._state(target)}.")
            return {"ok": False, "message": f"{pl.name} did not start."}
        self._clear(NOTE_PLAY)
        await self._call("media_player", "shuffle_set", {"entity_id": target, "shuffle": True})
        if preset is not None:
            members = preset.members
            if not await self._wait(members, lambda: all(self._state(m) == "playing" for m in members), JOIN_TIMEOUT):
                if self._claims.superseded(stamps):
                    return {"ok": True, "leader": target, "superseded": True}
                names = ", ".join(cfg.name_of(m) for m in members if self._state(m) != "playing")
                self._note(NOTE_PRESET, "Some speakers did not join",
                           f"{names} did not join {preset.name}. The music is playing in the other rooms.")
                return {"ok": True, "leader": target, "message": f"{names} did not join."}
        return {"ok": True, "leader": target}

    async def transfer(self, rooms: list[str], source: str) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        rooms = list(rooms or [])
        what = f"transfer {source} -> {rooms}"
        source = E.source_of(self.house, cfg, source)       # a virtual pair playing through its own group: the group
        fail, preset = E.check_transfer(self.house, cfg, rooms, source)
        if fail:
            return self._done(fail, what, rid, t0)
        stamps = self._claims.claim(E.transfer_rooms(self.house, cfg, rooms, source))
        try:
            async with self._request(stamps):
                async with self._hold(stamps):
                    if self._claims.superseded(stamps):
                        return self._done(dict(SUPERSEDED), what, rid, t0)
                    return self._done(await self._move(cfg, rooms, source, preset), what, rid, t0)
        except asyncio.CancelledError:
            if self._was_stopped():
                return self._done(dict(STOPPED), what, rid, t0)
            raise

    async def _move(self, cfg, rooms, source, preset) -> dict[str, Any]:
        leader, others, adding = E.move_plan(self.house, rooms, source, preset, cfg)
        if self._state(source) not in ACTIVE:
            if E.already_moved(self.house, leader, others):
                return {"ok": True, "leader": leader}
            return {"ok": False, "message": f"{cfg.name_of(source)} is not playing."}
        if not adding:
            moving = self._attr(source, "media_content_id")
            await self._call("music_assistant", "transfer_queue",
                             {"entity_id": leader, "source_player": source, "auto_play": True})
            if not await self._wait([leader], lambda: E.arrived(self.house, leader, moving), TRANSFER_TIMEOUT):
                self._note(NOTE_TRANSFER, "Music did not move",
                           f"The queue from {cfg.name_of(source)} could not be confirmed on {cfg.name_of(leader)}.")
                return {"ok": False, "message": "The music did not move."}
        self._clear(NOTE_TRANSFER)
        message = None
        if others:
            await self._call("media_player", "join", {"entity_id": leader, "group_members": others})
            await self._wait(others + [leader], lambda: all(r in self._members(leader) for r in others), JOIN_TIMEOUT)
            missing = [r for r in others if r not in self._members(leader)]
            if missing:
                names = ", ".join(dict.fromkeys(cfg.name_of(r) for r in missing))
                message = f"{names} did not join."
                self._note(NOTE_PARTIAL, "Some speakers did not join",
                           f"{names} did not join {cfg.name_of(leader)}. The music moved and is playing there.")
            else:
                self._clear(NOTE_PARTIAL)
        stale = E.stale(self.house, cfg, rooms, leader, source)
        if stale:
            await self._call("media_player", "unjoin", {"entity_id": stale})
            await self._wait(stale, lambda: all(len(self._members(r)) <= 1 for r in stale), RELEASE_TIMEOUT)
            await self._call("media_player", "media_pause", {"entity_id": stale})
        res: dict[str, Any] = {"ok": True, "leader": leader}
        if message:
            res["message"] = message
        return res

    async def stop(self, rooms: list[str] | None = None) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        whole, targets = E.stop_plan(cfg, rooms)
        if not targets:
            return dict(E.NO_ROOMS)
        self._claims.claim(targets)
        mine = asyncio.current_task()
        doomed = [t for t, held in self._running.items()
                  if t is not mine and not t.done() and (whole or held & set(targets))]
        for t in doomed:
            self._stopped.add(t)
            t.cancel()
        if doomed:
            await asyncio.wait(doomed, timeout=STOP_TIMEOUT)
        groups = E.stop_groups(cfg, whole, targets)
        if groups:
            await self._call("media_player", "media_stop", {"entity_id": groups})
        await self._call("media_player", "media_stop", {"entity_id": targets})
        quiet = lambda: all(self._state(e) != "playing" for e in targets + groups)  # noqa: E731
        await self._wait(targets + groups, quiet, STOP_TIMEOUT)
        await self._call("media_player", "unjoin", {"entity_id": cfg.players_of(targets)})
        res: dict[str, Any] = {"ok": True}
        if whole:
            if await self._wait(targets + groups, quiet, STOP_TIMEOUT):
                self._clear(NOTE_STOP)
            else:
                still = [cfg.name_of(e) for e in targets + groups if self._state(e) == "playing"]
                self._note(NOTE_STOP, "Some music is still playing", f"Stop All did not quiet {', '.join(still)}.")
                res = {"ok": False, "message": f"{', '.join(still)} did not stop."}
        return self._done(res, f"stop {'everything' if whole else targets}", rid, t0)

    async def transport(self, player: str, command: str, level: float | None = None) -> dict[str, Any]:
        cfg = self.config
        fail = E.check_player(cfg, player)
        if fail:
            return fail
        async with self._tlocks[player]:
            if command == "play_pause":
                ok = await self._call("media_player", "media_play_pause", {"entity_id": player})
            elif command == "next":
                ok = await self._call("media_player", "media_next_track", {"entity_id": player})
            elif command == "previous":
                ok = await self._call("media_player", "media_previous_track", {"entity_id": player})
            elif command == "stop":
                ok = await self._call("media_player", "media_stop", {"entity_id": player})
            elif command in ("volume_up", "volume_down", "volume_set"):
                current = self._attr(player, "volume_level") if command != "volume_set" else None
                new = E.new_volume(command, current, level, cfg.volume)
                ok = await self._call("media_player", "volume_set", {"entity_id": E.volume_players(cfg, [player]),
                                                                     "volume_level": new})
            else:
                return {"ok": False, "message": f"Unknown command {command}."}
        return {"ok": ok} if ok else {"ok": False, "message": f"{cfg.name_of(player)} did not respond."}

    async def play_media(self, player: str, content_id: str, content_type: str) -> dict[str, Any]:
        rid, t0 = next(self._ids), time.monotonic()
        cfg = self.config
        what = f"browse {content_id} on {player}"
        fail = E.check_browse(self.house, cfg, player)
        if fail:
            return self._done(fail, what, rid, t0)
        stamps = self._claims.claim(E.browse_rooms(self.house, cfg, player))
        try:
            async with self._request(stamps):
                # A VIRTUAL PAIR plays as one: through its own Music Assistant group, else its second player
                # joined to its first before the item is sent
                target, join = E.browse_target(self.house, cfg, player)
                if join and not await self._join(player, [player] + join):
                    return self._done({"ok": False, "message": f"{cfg.name_of(player)}’s two speakers did not "
                                       "group."}, what, rid, t0)
                # Browse starts afresh, as Apple Music does: the queue is replaced, never added to (a
                # playlist "played" into a shuffled queue was lost among its songs, the owner 2026-10-31)
                was = self._now_playing(target)
                ok = await self._call("media_player", "play_media", {"entity_id": target, "media_content_id": content_id,
                                                                     "media_content_type": content_type,
                                                                     "enqueue": "replace"})
                if not ok:
                    return self._done({"ok": False, "message": "Music Assistant could not play that."}, what, rid, t0)
                started = await self._wait([target], lambda: self._started_anew(target, was), START_TIMEOUT)
        except asyncio.CancelledError:
            if self._was_stopped():
                return self._done(dict(STOPPED), what, rid, t0)
            raise
        if self._claims.superseded(stamps):
            return self._done({"ok": True, "leader": target, "superseded": True}, what, rid, t0)
        if not started:
            return self._done({"ok": False, "message": f"It did not start on {cfg.name_of(player)}."}, what, rid, t0)
        return self._done({"ok": True, "leader": target}, what, rid, t0)

    async def service(self, service: str, data: dict[str, Any]) -> dict[str, Any]:
        """A page's own ``media_player.<service>`` on Music Assistant speakers (MA_SERVICES), sent as the commands HA's
        music_assistant integration sends for it. Shuffle and repeat act on the speaker's active queue, as HA's do."""
        def queue_of(e: str) -> str:
            q = self._attr(e, "active_queue")
            return q if isinstance(q, str) and q else self.host.pid(e)
        run, client = RUN.get(), self.host.ma
        if service in VOLUME_SERVICES:       # a virtual pair's volume is both its players', together
            data = dict(data, entity_id=E.volume_players(self.config, _ids(data.get("entity_id"))))
        try:
            if run is None or client is None:
                raise PermissionError("no audited music request is running")
            pid = queue_of if service in ("shuffle_set", "repeat_set") else self.host.pid
            for command, args in to_ma(OP_SERVICE, service, data, pid):
                await client.command(run, command, **args)
        except Exception as err:  # noqa: BLE001 -- an answer, never a dropped request
            log.warning("music: media_player.%s failed: %s", service, type(err).__name__)
            return {"ok": False, "message": "The speaker did not respond."}
        return {"ok": True}

    async def _missing(self, cfg: MusicConfig, items: list[str]) -> list[str]:
        wanted = E.library_links(items)
        if not wanted or self.host.ma is None:
            return []
        try:
            lib = await self.host.library_playlists()
        except Exception as err:  # noqa: BLE001 -- the check catches a dead link; it never blocks music
            log.warning("music: could not check the library: %s", type(err).__name__)
            return []
        return E.missing(wanted, lib)

    async def queue_play(self, entity_id: str, item_id: str) -> dict[str, Any]:
        """Play one song of the queue (by its queue_item_id), on the player's active queue."""
        try:
            qid, _cur = await self.host.active_queue(entity_id)
            if not qid:
                return {"ok": False, "message": "That speaker has no queue."}
            run, client = RUN.get(), self.host.ma
            if run is None or client is None:
                raise PermissionError("no audited music request is running")
            await client.command(run, "player_queues/play_index", queue_id=qid, index=item_id)
            return {"ok": True}
        except Exception as err:  # noqa: BLE001 -- an answer, never a dropped request
            log.warning("music: queue_play failed: %s", type(err).__name__)
            return {"ok": False, "message": "That song could not be played."}


class MantelWarmer(Warmer):
    """KEEP PLAYLISTS READY on Mantel: hk_core's rounds, against Mantel's own MA client (server-only reads),
    while the switch is on and Mantel's engine runs."""

    def __init__(self, host: "MusicHost") -> None:
        super().__init__(lambda: [u for p in host.config().playlists for u in p.items])
        self.host = host
        self._task: asyncio.Task | None = None

    def server(self) -> Any:
        return self.host.ma if self.host.active else None

    @property
    def on(self) -> bool:
        return self.host.active and bool((self.host.doc() or {}).get("options", {}).get(CONF_KEEP_READY))

    def follow(self, first: float = WARM_FIRST) -> None:
        running = self._task is not None and not self._task.done()
        if self.on and not running:
            self._task = asyncio.get_running_loop().create_task(self._loop(first))
        elif not self.on and running:
            self.stop()

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _loop(self, delay: float) -> None:
        while True:
            await self.sleep(delay)
            if not self.on:
                return
            try:
                delay = await self.round()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- one bad round must not end them
                log.exception("music: keeping playlists ready failed")
                delay = WARM_RETRY


# --------------------------------------------------------------------------------------------- the host
def _principal_ok(identity: Any) -> bool:
    return identity is not None and getattr(identity, "valid", True) and \
        (getattr(identity, "user", None) is not None or getattr(identity, "device", None) is not None)


class MusicHost:
    """``app["music"]``: the engine, its reads, its settings and the switch (``active``)."""

    ma_players: list[Any] | None = None     # Music Assistant's player list (refresh_groups)

    def __init__(self, app: Any, hub: Any, hooks: Any) -> None:
        self.app, self.hub, self.hooks = app, hub, hooks
        authz = app.get("authz")
        self.house = MantelHouse(hub.store, hub.registry, tz=(lambda: authz.tz) if authz is not None else "UTC")
        self.announcements = Announcements(self.house, hub.registry, self.config, self.push)
        # MUSIC STOPPED AFTER A PAUSE (hk_core/music/resume.py): the screens show it paused, so play resumes it
        self.resumes = Resumes()
        self.engine = MantelMusic(self)
        # THE SPEAKERS' STATES FROM MUSIC ASSISTANT (music_states.py): while it is configured here, what the pages,
        # the app and the engine's waits read for a Music Assistant speaker is Music Assistant's, never HA's
        from .music_states import MusicStates
        self.states = MusicStates(app, hub, lambda: ma_players(hub.registry), self._states_changed)
        self.warmer = MantelWarmer(self)
        self._watchers: dict[int, tuple[set[str], Callable[[], None]]] = {}
        self._wid = itertools.count(1)
        self._subs: dict[int, tuple[Any, Callable[[dict], None]]] = {}
        self._sid = itertools.count(1)
        self._sent: dict[int, Any] = {}
        self.started = False
        # MUSIC ASSISTANT'S PLAYER LIST (hk_core/music/groups.py: pairs, and its groups), as
        # refresh_groups last read it; None until it could be. Read every GROUPS_EVERY while running.
        self.ma_players = None
        self._groups_task: asyncio.Task | None = None

    # -- what it runs on ----------------------------------------------------------------------------------
    @property
    def ma(self) -> Any:
        return self.app.get("ma")

    @property
    def store(self) -> Any:
        svc = self.app.get("settings")
        return getattr(svc, "store", None)

    def doc(self) -> dict | None:
        store = self.store
        if store is None:
            return None
        got = store.get("house", MUSIC_DOC)
        if got is None:
            return None
        try:
            return check_doc(got.body)
        except ValueError:
            log.exception("music: house/music is not readable; Mantel's engine stays off")
            return None

    @property
    def active(self) -> bool:
        """THE SWITCH: Mantel's engine answers only with Music Assistant configured here AND the music settings
        in Mantel's store; otherwise the interim bridge (reads) and HA's engine (commands), as before."""
        return self.ma is not None and self.doc() is not None

    def config(self) -> MusicConfig:
        d = self.doc() or empty_doc()
        items = [Item(i["kind"], i["key"], i["title"], i["data"]) for i in d["items"]]
        groups = Groups.read(self.ma_players, ma_players(self.hub.registry)) if self.ma_players is not None else None
        return MusicConfig.build(self.house, d["options"], items, library_entry(self.hub.registry), groups)

    async def refresh_groups(self) -> bool:
        """Music Assistant's player list, read again (a read: no gate, no audit). A failure keeps the last list.
        True when the groups in it changed -- the screens' feed is then re-sent."""
        client = self.ma
        if client is None or not client.connected.is_set():
            return False
        try:
            raw = await client.players()
        except Exception as err:  # noqa: BLE001 -- the last list stays
            log.debug("music: Music Assistant's players could not be read: %s", type(err).__name__)
            return False
        if not isinstance(raw, list):
            return False
        old, self.ma_players = self.ma_players, raw
        changed = old is None or signature(old) != signature(raw)
        if changed and self._subs:
            self.push()
        return changed

    async def _groups_loop(self) -> None:
        while True:
            await self.refresh_groups()
            await asyncio.sleep(GROUPS_EVERY)

    def pid(self, entity: str) -> str:
        got = ma_players(self.hub.registry).get(entity)
        if got is None:
            raise KeyError(f"{entity} is not a Music Assistant player")
        return got

    def _states_changed(self, changed: set[str]) -> None:
        """The overlay changed speakers' states: everything that follows the hub's changes hears it (HA's change
        chain, which this module heads; without an HA client, the hub's pages and the engine's waits)."""
        ha = getattr(self.hub, "ha", None)
        if ha is not None:
            ha.on_change(set(changed))
            return
        self.hub.on_change(set(changed))
        self.on_change(set(changed))

    # -- the hub's changes (the engine's waits; the screens' feed) -------------------------------------------
    def watch(self, entities: set[str], cb: Callable[[], None]) -> Callable[[], None]:
        wid = next(self._wid)
        self._watchers[wid] = (entities, cb)
        return lambda: self._watchers.pop(wid, None) and None

    def on_change(self, changed: set[str]) -> None:
        """A state change wakes the engine's waits on it. The feed does not follow states (as HA's: it is the
        configuration, re-sent when it or the areas and floors it is named from change) -- but for the music Music
        Assistant stopped after a pause (``resumable``), which it lists."""
        self.announcements.state(changed)
        now, kept = time.monotonic(), False
        for e in changed:
            if e.startswith("media_player."):
                st = self.house.state(e)
                kept = self.resumes.state(e, st.state if st else None, now) or kept
        if kept:
            self.push()
        for ents, cb in list(self._watchers.values()):
            if ents & changed:
                try:
                    cb()
                except Exception:  # noqa: BLE001
                    log.exception("music: a wait failed")

    def on_registry(self) -> None:
        if self._subs:
            self.push()      # a renamed area renames its pill; a moved area moves floors (sent only if changed)

    # -- the screens' feed (hk_music/subscribe) ---------------------------------------------------------------
    def home_for(self, identity: Any, cfg: MusicConfig) -> str | None:
        """The person's own home room (chosen in Mantel, or their linked HA user's from the import), else the
        wall tablet's: the first speaker, in the order the speakers were picked, in the device's room."""
        rooms = set(cfg.room_ids)
        u, d = getattr(identity, "user", None), getattr(identity, "device", None)
        if u is not None:
            for key in (u.id, f"ha:{u.ha_user_id}" if getattr(u, "ha_user_id", None) else None):
                r = cfg.homes.get(key) if key else None
                if r in rooms:
                    return r
        room = getattr(d, "room", None) if d is not None else None
        if room:
            order = (self.doc() or empty_doc())["options"][CONF_SPEAKERS]
            for r in order:
                if r in rooms and area_of(self.house, self.house.entity(r)) == room:
                    return r
        return None

    async def payload(self, identity: Any) -> dict[str, Any]:
        from .readproxy import music_config, music_players
        if self.doc() is None:
            return {"configured": False}
        cfg = self.config()
        raw = cfg.as_client(None)
        raw["announcements"] = self.announcements.players() if cfg.ignore_announcements else []
        raw["resumable"] = self.resumes.players(time.monotonic())
        names = music_players(raw)
        ok = await allowed_ids(self.hooks, identity, "view", sorted(names))
        out = music_config(raw, ok)
        home = self.home_for(identity, cfg)
        out["home"] = home if home in ok else None
        return out

    def push(self) -> None:
        for sid in list(self._subs):
            asyncio.get_running_loop().create_task(self._push_one(sid))

    async def _push_one(self, sid: int, force: bool = False) -> None:
        sub = self._subs.get(sid)
        if sub is None:
            return
        identity, on_event = sub
        try:
            got = await self.payload(identity)
        except Exception:  # noqa: BLE001 -- a failing hook sends nothing rather than everything
            log.exception("music: the feed failed; nothing sent")
            return
        if sid in self._subs and (force or self._sent.get(sid) != got):
            self._sent[sid] = got
            on_event(got)

    async def subscribe(self, ctx: Ctx, on_event: Callable[[dict], None]):
        if not await may_feature(self.hooks, ctx.identity, "music"):
            raise Forbidden("may not use music")
        sid = next(self._sid)
        self._subs[sid] = (ctx.identity, on_event)
        await self._push_one(sid, force=True)

        async def unsubscribe() -> None:
            self._subs.pop(sid, None)
            self._sent.pop(sid, None)

        async def recheck() -> bool:      # live.py: the music feature, decided again (a role lowered, a grant removed)
            return await may_feature(self.hooks, ctx.identity, "music")
        unsubscribe.recheck = recheck              # type: ignore[attr-defined]
        return unsubscribe

    # -- Music Assistant reads ---------------------------------------------------------------------------------
    async def active_queue(self, entity_id: str) -> tuple[str | None, int]:
        q = await self.ma.active_queue(self.pid(entity_id))
        if not isinstance(q, Mapping):
            return None, 0
        cur = q.get("current_index")
        return q.get("queue_id"), int(cur) if isinstance(cur, int) and not isinstance(cur, bool) else 0

    async def queue(self, entity_id: str, limit: int) -> dict[str, Any]:
        """HA's hk_music/queue answer, from Music Assistant: the songs from the current one on."""
        from .readproxy import music_queue
        try:
            qid, cur = await self.active_queue(entity_id)
            if not qid:
                return {"ok": False, "message": "That speaker has no queue."}
            items = await self.ma.queue_items(qid, limit=limit, offset=cur)
            return music_queue({"ok": True, "queue_id": qid, "index": cur,
                                "items": [Q.item(i) for i in items or [] if isinstance(i, Mapping)]})
        except KeyError:
            return {"ok": False, "message": "That speaker has no queue."}
        except Exception as err:  # noqa: BLE001 -- an answer, never a dropped request
            log.info("music: the queue could not be read: %s", type(err).__name__)
            return {"ok": False, "message": "The queue could not be read."}

    async def library_playlists(self, order: bool = False) -> list[dict[str, Any]]:
        args: dict[str, Any] = {"limit": 500 if order else 1000}
        if order:
            args["order_by"] = "name"
        got = await self.ma.library("playlists", **args)
        if isinstance(got, Mapping):
            got = got.get("items")
        return [i for i in got or [] if isinstance(i, Mapping)]

    async def get_library(self, query: dict[str, Any]) -> dict[str, Any]:
        """Browse's library read (``check_get_library``'s result): HA's {items} from Music Assistant."""
        try:
            got = await self.ma.library(query["media_type"], **query["args"])
        except Exception as err:  # noqa: BLE001 -- the page's error, never a dropped request
            log.info("music: the library could not be read: %s", type(err).__name__)
            raise ConnectionError("Music Assistant could not be read.") from None
        if isinstance(got, Mapping):
            got = got.get("items")
        return {"items": [library_item(i) for i in got or [] if isinstance(i, Mapping)]}

    async def why_not_opened(self, content_id: Any) -> str | None:
        """HA could not open a playlist (``media_player/browse_media``: its ``unknown_error`` says nothing): Music
        Assistant's own answer for the same songs, asked once, through Mantel's client. Only a refused sign-in is
        named (``SIGN_IN_AGAIN``); anything else, or no Music Assistant here, is None and HA's error stands."""
        m = MEDIA_URI.match(content_id) if isinstance(content_id, str) else None
        if m is None or self.ma is None:
            return None
        from .connectors.ma import MaError
        try:
            await self.ma.playlist_tracks(m.group(3), m.group(1))
        except MaError as err:
            if err.error_code == MA_LOGIN_FAILED:
                log.warning("music: Music Assistant's sign-in to %s was refused; saved playlists cannot be read "
                            "until it is signed in again", m.group(1))
                return SIGN_IN_AGAIN
        except Exception as err:  # noqa: BLE001 -- HA's error stands
            log.debug("music: asking Music Assistant about a playlist failed: %s", type(err).__name__)
        return None

    async def library(self) -> list[dict[str, str]]:
        try:
            lib = await self.library_playlists(order=True)
        except Exception:  # noqa: BLE001 -- no list is still a usable form (HA's flows.library)
            return []
        return [{"uri": i["uri"], "name": i.get("name") if isinstance(i.get("name"), str) else i["uri"]}
                for i in lib if isinstance(i.get("uri"), str)]

    # -- HK Settings' music page ------------------------------------------------------------------------------
    def _people(self) -> list[dict[str, Any]]:
        acc = self.app.get("accounts")
        try:
            users = acc.list_users() if acc is not None else []
        except Exception:  # noqa: BLE001
            users = []
        return [u for u in users if not u.get("disabled")]

    def _name(self, eid: str) -> str:
        st = self.house.state(eid)
        return str(st.attributes.get("friendly_name") or eid) if st else eid

    def _players(self, doc: dict) -> list[str]:
        ent = {e.get("entity_id"): e for e in self.hub.registry.entity_entries}
        ma = {e for e in ma_players(self.hub.registry) if not (ent.get(e) or {}).get("disabled_by")}
        chosen = set(doc["options"][CONF_SPEAKERS])
        return sorted(ma | chosen, key=lambda x: self._name(x).casefold())

    def page(self, start: bool = False) -> dict[str, Any]:
        """HA's settings_ws.page shape, from Mantel: the people are Mantel's (a person linked to an HA user
        shows that HA user's imported home room until one is chosen here). ``start``: with no ``house/music``
        yet, the empty settings (Music is added in Mantel: the first save makes the document)."""
        doc = self.doc()
        if doc is None and start:
            doc = empty_doc()
        if doc is None:
            return {"configured": False}
        cfg = self.config()
        opts = doc["options"]
        floor = {r.entity: r.floor for r in cfg.rooms}
        room = {r.entity: r.name for r in cfg.rooms}
        people = self._people()
        homes = {}
        for p in people:
            r = opts[CONF_HOMES].get(p["id"]) or (opts[CONF_HOMES].get(f"ha:{p['ha_user_id']}") if p.get("ha_user_id") else None)
            if r:
                homes[p["id"]] = r
        return {
            "configured": True, "state": "loaded",
            "speakers": [{"entity": e, "name": room.get(e) or self._name(e), "floor": floor.get(e),
                          "player": self._name(e)} for e in opts[CONF_SPEAKERS]],
            "volume": float(opts[CONF_VOLUME]), "homes": homes,
            "users": sorted(({"id": p["id"], "name": p.get("name") or p.get("username") or p["id"]} for p in people),
                            key=lambda u: str(u["name"]).casefold()),
            "presets": [{"id": p.key, "name": p.name, "members": p.members} for p in cfg.presets],
            "playlists": [{"id": p.key, "name": p.name, "icon": p.icon, "items": p.items, "chooser": p.chooser,
                           "order": p.order} for p in cfg.playlists],
            "players": [{"entity": e, "name": self._name(e)} for e in self._players(doc)],
            # Music Assistant's groups: the pairs among the speakers, each group's rooms and problems
            **S.groups_page(cfg, self._players(doc)),
            # VIRTUAL PAIRS: two players as one room, made here (docs/phase4/VIRTUAL-PAIRS.md)
            "virtual_pairs": S.pairs_page(cfg, opts, self._name), "pairs_here": True,
            "library_ready": self.ma is not None and self.ma.connected.is_set(),
            "ignore_announcements": opts[CONF_IGNORE_ANNOUNCEMENTS],
            "keep_ready": bool(opts[CONF_KEEP_READY]),
            "keep_ready_last": self.warmer.status(),
        }

    def _refused(self, errors: Mapping[str, str]) -> MusicRefusal:
        return MusicRefusal("invalid_format", json.dumps(dict(errors)))

    def _save(self, doc: dict, principal: Any, message: str) -> None:
        from .settings_store import actor_of
        self.store.write([("house", MUSIC_DOC, check_doc(doc))], actor=actor_of(principal), action="set",
                         message=message, source="hk_music")
        self.changed()

    async def settings_write(self, principal: Any, t: str, a: dict) -> dict[str, Any]:
        """One of HK Settings' music saves (SETTINGS_WRITES) on ``house/music``: checked by the shared checks
        (hk_core.music.settings), a new version of the document (who, why), never Home Assistant. Needs only the
        document, not Music Assistant: settings_store.FEATURE_SAVES brings them here through feature_pages.py,
        commands on or off. A house with no ``house/music`` yet starts one with ``hk_music/settings/set``."""
        doc = self.doc()
        if doc is None and t == "hk_music/settings/set":
            doc = empty_doc()
        if doc is None:
            raise MusicRefusal("not_set_up", "Music is not added")
        doc = copy.deepcopy(doc)
        items = doc["items"]

        def sub(key: Any, kind: str) -> dict | None:
            return next((i for i in items if i["key"] == key and i["kind"] == kind), None) if key else None

        if t == "hk_music/settings/set":
            if not isinstance(a["changes"], dict):
                raise self._refused({"changes": S.MSG["list"]})
            g = self.config().groups
            opts, errors = S.apply(doc["options"], dict(a["changes"]), set(self._players(doc)), pairs=True,
                                   ma_groups=[e for e in self._players(doc) if g is not None and g.is_group(e)])
            if errors:
                raise self._refused(errors)
            doc["options"] = opts
        elif t == "hk_music/preset/save":
            it = sub(a.get("item"), SUB_PRESET)
            if a.get("item") and it is None:
                raise self._refused({"item": S.MSG["no_item"]})
            if not isinstance(a["name"], str) or not isinstance(a["members"], list) \
                    or not all(isinstance(m, str) for m in a["members"]):
                raise self._refused({"name": S.MSG["list"]})
            name, members = S.text(a["name"]), list(dict.fromkeys(a["members"]))
            errors = S.check_preset(name, members, list(doc["options"][CONF_SPEAKERS]), self.config().pairs)
            if errors:
                raise self._refused(errors)
            data = S.preset_data(name, members)
            if it is None:
                items.append({"kind": SUB_PRESET, "key": self._new_key(items), "title": name, "data": data})
            else:
                it.update(title=name, data=data)
        elif t == "hk_music/playlist/save":
            it = sub(a.get("item"), SUB_PLAYLIST)
            if a.get("item") and it is None:
                raise self._refused({"item": S.MSG["no_item"]})
            if not isinstance(a["name"], str) or not isinstance(a["items"], list) \
                    or not all(isinstance(i, str) for i in a["items"]) \
                    or not (a.get("chooser") is None or isinstance(a["chooser"], str)) \
                    or not (a.get("icon") is None or isinstance(a["icon"], str)) \
                    or not (a.get("order") is None or (isinstance(a["order"], (int, float)) and not isinstance(a["order"], bool))):
                raise self._refused({"items": S.MSG["list"]})
            name, chooser = S.text(a["name"]), S.text(a.get("chooser"))
            uris = [i for i in dict.fromkeys(a["items"]) if i]
            # the library is Music Assistant's: without it here (or not connected) the songs aren't checked against
            # it, as HA's form takes them when its library can't be read; the screens then say what is missing
            known = None
            if self.ma is not None and self.ma.connected.is_set():
                known = {i["uri"] for i in await self.library()}
            errors = S.check_playlist(name, chooser, uris, known)
            if errors:
                raise self._refused(errors)
            title, data = S.playlist_save(name, chooser, uris, a.get("icon"), a.get("order"), it["data"] if it else None,
                                          [float(i["data"].get(CONF_ORDER, 0) or 0) for i in items if i["kind"] == SUB_PLAYLIST])
            if it is None:
                items.append({"kind": SUB_PLAYLIST, "key": self._new_key(items), "title": title, "data": data})
            else:
                it.update(title=title, data=data)
        elif t == "hk_music/playlists/order":
            ids = a["ids"]
            subs = [sub(i, SUB_PLAYLIST) for i in ids] if isinstance(ids, list) else [None]
            if not subs or any(s is None for s in subs):
                raise self._refused({"ids": S.MSG["no_item"]})
            for i, order in S.reorder([s["data"].get(CONF_ORDER, 0) for s in subs]):
                subs[i]["data"][CONF_ORDER] = order
        elif t == "hk_music/item/remove":
            it = next((i for i in items if i["key"] == a["item"]), None)
            if it is None:
                raise self._refused({"item": S.MSG["no_item"]})
            items.remove(it)
        self._save(doc, principal, t)
        return self.page()

    @staticmethod
    def _new_key(items: list[dict]) -> str:
        import secrets
        have = {i["key"] for i in items}
        while True:
            k = secrets.token_hex(13)
            if k not in have:
                return k

    def changed(self) -> None:
        """The music settings changed (a save, an import): the screens hear it, the warmer follows."""
        if self._subs:
            self.push()
        if self.started:
            self.warmer.follow(WARM_SOON)

    # -- the gateway's side --------------------------------------------------------------------------------
    def route(self, cmd: Any) -> Any:
        """A page's plain ``media_player.*`` call (gateway.service_command: its checks, its audit) that names only
        Music Assistant speakers goes to Music Assistant while it is connected here (MA_SERVICES), never to HA: the
        command gets ``music`` (op OP_SERVICE), and Gateway._forward hands it to ``run``. Anything else as it was."""
        frame = cmd.frame or {}
        if cmd.music is not None or cmd.kind not in ("service", "ws") or frame.get("type") != "call_service" \
                or frame.get("domain") != OP_SERVICE or frame.get("service") not in MA_SERVICES:
            return cmd
        service = frame["service"]
        data, target = dict(frame.get("service_data") or {}), dict(frame.get("target") or {})
        if set(target) - {"entity_id"} or set(data) - {"entity_id"} - MA_SERVICES[service]:
            return cmd
        ents = list(dict.fromkeys(_ids(target.get("entity_id")) + _ids(data.get("entity_id"))))
        named = ents + _ids(data.get("group_members"))
        speakers = ma_players(self.hub.registry)
        if not ents or not all(e in speakers for e in named):
            return cmd
        data["entity_id"] = ents
        cmd.music = {"op": OP_SERVICE, "args": {"service": service, "data": data},
                     "return_response": bool(frame.get("return_response"))}
        return cmd

    def expand(self, cmd: Any) -> Any:
        """The checks Mantel's engine adds, knowing the configuration: Stop All names every room."""
        from .gateway import Check
        m = cmd.music or {}
        if m.get("op") == OP_SERVICE:         # a plain media_player call: its own checks, as for HA's
            return cmd
        cfg = self.config()
        action = cmd.action
        names = [c.entity_id for c in cmd.checks if c.entity_id]
        if m.get("op") == SERVICE_STOP and not (m.get("args") or {}).get("rooms"):
            names = list(cfg.room_ids)
        out = list(dict.fromkeys(names))
        keep = [c for c in cmd.checks if c.entity_id is None]
        if not out and keep == cmd.checks:
            return cmd
        cmd.checks = keep + [Check(action if action.startswith(f"{DOMAIN}.") else "media_player.play_media", n)
                             for n in out]
        cmd.targets = out or cmd.targets
        return cmd

    async def run(self, principal: Any, music: dict, audit_id: int) -> Any:
        """One gateway-approved music command (Gateway._forward, after RBAC and the audit row). Answers as HA
        answers it: a service call {context, response}, a write its result."""
        op, a = music["op"], dict(music.get("args") or {})
        self.warmer.used()
        if op in SETTINGS_WRITES:
            return await self.settings_write(principal, op, a)
        if op == "hk_music/used":
            return None
        cfg = self.config()
        players = set()
        speakers = cfg.ma_players()           # (a virtual pair's second player and its own group with its room)
        if op == OP_SERVICE:                  # the speakers it names (each checked by the gateway), and their queues
            d = a["data"]
            speakers = cfg.players_of(_ids(d.get("entity_id")) + _ids(d.get("group_members")))
            players |= {q for e in speakers for q in [self.engine._attr(e, "active_queue")] if isinstance(q, str) and q}
        for e in speakers:
            try:
                players.add(self.pid(e))
            except KeyError:
                pass
        run = MusicRun(principal, audit_id, players)
        token = RUN.set(run)
        try:
            if op == "hk_music/queue_play":
                return await self.engine.queue_play(a["entity_id"], a["item_id"])
            if op == SERVICE_PLAY:
                res = await self.engine.play(a["rooms"], a["playlist"])
            elif op == SERVICE_TRANSFER:
                res = await self.engine.transfer(a["rooms"], a["source"])
            elif op == SERVICE_STOP:
                res = await self.engine.stop(a.get("rooms"))
            elif op == SERVICE_TRANSPORT:
                res = await self.engine.transport(a["player"], a["command"], a.get("level"))
            elif op == SERVICE_PLAY_MEDIA:
                res = await self.engine.play_media(a["player"], a["media_content_id"], a["media_content_type"])
            elif op == OP_SERVICE:
                res = await self.engine.service(a["service"], a["data"])
            else:
                raise MusicRefusal("invalid_command", f"{op} is not a music action")
        finally:
            run.open = False
            RUN.reset(token)
        # EVERY ACTION ANSWERS (HA's _answer): a caller that did not ask for the answer learns of a failure
        # as an error; a request that stood down for a newer one is not a failure
        if op == OP_SERVICE:                  # HA's answer to a plain service call: its context, no response
            if not res.get("ok"):
                raise MusicRefusal("home_assistant_error", str(res.get("message")))
            return {"context": {"id": f"mantel-audit-{audit_id}"}, "response": None}
        if not music.get("return_response") and not res.get("ok") and not res.get("superseded"):
            raise MusicRefusal("home_assistant_error", str(res.get("message") or "The request failed."))
        return {"context": {"id": f"mantel-audit-{audit_id}"},
                "response": res if music.get("return_response") else None}

    # -- the import -------------------------------------------------------------------------------------------
    async def import_from_ha(self, panel: Any, read: Callable[[dict], Any], actor: Any, source: str | None) -> bool:
        """The feature import's music part (features.FeatureHost.import_from_ha): HA's music settings, read once,
        written as a new version of ``house/music``. HA's music not added: nothing is written."""
        body = await import_doc(panel, read, source)
        if body is None or self.store is None:
            return False
        got = self.store.write([("house", MUSIC_DOC, body)], actor=actor, action="import",
                               message="music import", source=source)
        self.changed()
        return bool(got)

    def status(self) -> dict[str, Any]:
        doc = self.doc()
        return {"active": self.active, "music_assistant": self.ma is not None, "states": self.states.status(),
                "connected": bool(self.ma is not None and self.ma.connected.is_set()),
                "settings": doc is not None, "notes": dict(self.engine.notes), "requests": list(self.engine.log),
                "keep_ready": {"on": self.warmer.on, "last": self.warmer.status()},
                "announcements": "display-only HA service markers with native/MA physical identity matching"}

    def connection_changed(self) -> None:
        """Music Assistant was connected, moved or disconnected on the Connections page (connections.py,
        server.apply_connection): ``self.ma`` already reads the new client (or None). Screens subscribed to
        Mantel's feed get it again now. A screen that is on the interim bridge, or on Mantel's feed after a
        disconnect, keeps that subscription until it subscribes again (its next page load or reconnect);
        reads and commands switch at once."""
        log.info("music: Music Assistant %s; Mantel's engine is %s", "connected" if self.ma is not None else "removed",
                 "on" if self.active else "off (the interim bridge answers)")
        if self._subs:
            for sid in list(self._subs):
                asyncio.get_running_loop().create_task(self._push_one(sid, force=True))
        # Keep Playlists Ready follows the connection too: its loop ends when Music Assistant goes, and was
        # started only at start() and on a settings save, so one connected later never warmed anything
        self.states.connection_changed()
        if self.started:
            self.warmer.follow(WARM_SOON)
            asyncio.get_running_loop().create_task(self.refresh_groups())

    async def start(self) -> None:
        self.started = True
        self.states.start()
        self.warmer.follow()
        self._groups_task = asyncio.get_running_loop().create_task(self._groups_loop())

    async def stop(self) -> None:
        self.started = False
        await self.states.stop()
        self.warmer.stop()
        self.announcements.reset()
        self.resumes.clear()
        if self._groups_task is not None:
            self._groups_task.cancel()
            self._groups_task = None


# ------------------------------------------------------------------------------------------- register
def register(app: Any, hub: Any, hooks: Any = None) -> MusicHost:
    """``app["music"]``: the reads (in front of the interim bridge, which answers while the engine is off), the
    page's ``music_used`` message, ``GET /api/music/status`` (Owner/Admin), and the hub's changes. Commands come
    only through the gateway (``Gateway._forward`` -> ``MusicHost.run``)."""
    from .connectors import Hooks
    from .readproxy import MEDIA_PLAYER, READ_ALLOWED, NotFound, ReadBlocked
    BROWSE_KEYS, SEARCH_KEYS = READ_ALLOWED["media_player/browse_media"], READ_ALLOWED["media_player/search_media"]
    if "music" in app:
        return app["music"]
    hooks = Hooks.coerce(hooks)
    host = MusicHost(app, hub, hooks)
    app["music"] = host

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            # Music Assistant's speakers first: HA's word on them is put back before anything reads it
            try:
                host.states.reassert(set(changed))
            except Exception:  # noqa: BLE001 -- never break the hub's own callback
                log.exception("music: Music Assistant's states could not be put back")
            first_change(changed)
            host.on_change(set(changed))

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            host.on_registry()
        ha.on_change, ha.on_registry = on_change, on_registry
        ha.on_service = host.announcements.service
        ha.on_disconnect = host.announcements.reset

    def bridge():
        reads = app.get("filtered_reads")
        if reads is None:
            raise ConnectionError("unavailable")
        return reads

    async def subscribe(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        if not host.active:
            try:
                return await bridge().subscribe(ctx.identity, msg, on_event)
            except RuntimeError as exc:
                if str(exc) != "unknown_command":
                    raise
            # A HOME ASSISTANT WITHOUT HK FRONTEND has no hk_music feed, and Mantel's own engine is off (no Music
            # Assistant in Mantel): music isn't set up. Say so once, as the engine says it with no settings, and
            # keep the subscription open, so the page draws "not set up" instead of asking again and again.
            on_event({"configured": False})

            async def nothing() -> None:
                return None
            return nothing
        if set(msg) - {"type", "id"}:
            raise ReadBlocked("hk_music/subscribe carries nothing")
        return await host.subscribe(ctx, on_event)

    async def queue(ctx: Ctx, msg: dict):
        if not host.active:
            return await bridge().request(ctx.identity, msg)
        if set(msg) - {"type", "id", "entity_id", "limit"}:
            raise ReadBlocked("hk_music/queue carries entity_id and limit only")
        eid, limit = msg.get("entity_id"), msg.get("limit", 40)
        if not isinstance(eid, str) or not MEDIA_PLAYER.match(eid):
            raise ReadBlocked("hk_music/queue needs a media_player entity_id")
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= QUEUE_MAX:
            raise ReadBlocked(f"hk_music/queue: limit is 1..{QUEUE_MAX}")
        if eid not in await allowed_ids(hooks, ctx.identity, "view", [eid]):
            raise NotFound("Entity not found")
        return await host.queue(eid, limit)

    async def library(ctx: Ctx, msg: dict):
        if not host.active:
            return await bridge().request(ctx.identity, msg)
        if set(msg) - {"type", "id"}:
            raise ReadBlocked("hk_music/settings/library carries nothing")
        if not await may_feature(hooks, ctx.identity, "music"):
            raise Forbidden("may not use music")
        return {"items": await host.library()}

    async def get_library(ctx: Ctx, msg: dict):
        if host.ma is None:
            raise MaNotConfigured("Music Assistant is not connected to Mantel.")
        try:
            query = check_get_library({k: v for k, v in msg.items() if k not in ("type", "id")})
        except ValueError as err:
            raise ReadBlocked(str(err)) from None
        if not await may_feature(hooks, ctx.identity, "music"):
            raise Forbidden("may not use music")
        return await host.get_library(query)

    async def get_queue(ctx: Ctx, msg: dict):
        """music_assistant.get_queue as a read (the page's shim): {entity: HA's queue details}. A player that is not a
        Music Assistant speaker, or no Music Assistant here: ma_not_configured (the shim then asks the old way)."""
        if set(msg) - {"type", "id", "entity_id"}:
            raise ReadBlocked("get_queue carries entity_id only")
        ents = _ids(msg.get("entity_id"))
        if not ents or len(ents) > 20 or not all(MEDIA_PLAYER.match(e) for e in ents):
            raise ReadBlocked("get_queue needs media_player entity ids")
        speakers = ma_players(hub.registry)
        if host.ma is None or not all(e in speakers for e in ents):
            raise MaNotConfigured("Music Assistant is not connected to Mantel.")
        if not await may_feature(hooks, ctx.identity, "music"):
            raise Forbidden("may not use music")
        ok = await allowed_ids(hooks, ctx.identity, "view", ents)
        if any(e not in ok for e in ents):
            raise NotFound("Entity not found")
        out = {}
        try:
            for e in ents:
                q = await host.ma.active_queue(speakers[e])
                if not isinstance(q, Mapping) or not q.get("queue_id"):
                    raise NotFound(f"{e} has no queue")
                out[e] = queue_details(q)
        except (NotFound, ReadBlocked):
            raise
        except Exception as err:  # noqa: BLE001 -- the page's error, never a dropped request
            log.info("music: the queue could not be read: %s", type(err).__name__)
            raise ConnectionError("Music Assistant could not be read.") from None
        return out

    async def search(ctx: Ctx, msg: dict):
        """music_assistant.search as a read (the page's shim): HA's {artists, albums, tracks, ...} from Music
        Assistant. No Music Assistant here: ma_not_configured (the shim then asks the old way)."""
        if host.ma is None:
            raise MaNotConfigured("Music Assistant is not connected to Mantel.")
        try:
            args = check_search({k: v for k, v in msg.items() if k not in ("type", "id")})
        except ValueError as err:
            raise ReadBlocked(str(err)) from None
        if not await may_feature(hooks, ctx.identity, "music"):
            raise Forbidden("may not use music")
        try:
            return search_answer(await host.ma.read("music/search", **args))
        except Exception as err:  # noqa: BLE001 -- the page's error, never a dropped request
            log.info("music: Music Assistant could not be searched: %s", type(err).__name__)
            raise ConnectionError("Music Assistant could not be read.") from None

    def from_ma(msg: dict) -> bool:
        """A Browse read Mantel answers from Music Assistant: on one of its speakers, Music Assistant connected."""
        eid, cid = msg.get("entity_id"), msg.get("media_content_id")
        return host.ma is not None and isinstance(eid, str) and eid in ma_players(hub.registry) \
            and not (isinstance(cid, str) and cid.startswith("media-source://"))

    async def ma_browse(ctx: Ctx, msg: dict, keys: frozenset[str], answer: Callable[[], Any]):
        from . import music_browse
        if set(msg) - keys - {"type", "id"}:
            raise ReadBlocked(f"{msg.get('type')} carries {sorted(keys)} only")
        for k in keys - {"entity_id", "media_filter_classes"}:
            if msg.get(k) is not None and (not isinstance(msg[k], str) or len(msg[k]) > 1000):
                raise ReadBlocked(f"{k} is text")
        if msg["entity_id"] not in await allowed_ids(hooks, ctx.identity, "view", [msg["entity_id"]]):
            raise NotFound("Entity not found")
        from .connectors.ma import MaError
        try:
            return await answer()
        except music_browse.BrowseError as err:
            raise NotFound(str(err)) from None
        except MaError as err:
            if err.error_code == MA_LOGIN_FAILED:      # the streaming service refused MA's sign-in: say what to do
                raise SignInRefused(SIGN_IN_AGAIN) from None
            log.info("music: Music Assistant could not be browsed: error %s", err.error_code)
            raise ConnectionError("Music Assistant could not be read.") from None
        except Exception as err:  # noqa: BLE001 -- the page's error, never a dropped request
            log.info("music: Music Assistant could not be browsed: %s", type(err).__name__)
            raise ConnectionError("Music Assistant could not be read.") from None

    async def search_media(ctx: Ctx, msg: dict):
        if not from_ma(msg):
            return await bridge().request(ctx.identity, msg)
        from . import music_browse
        classes = msg.get("media_filter_classes")
        if classes is not None and not (isinstance(classes, list) and all(isinstance(c, str) for c in classes)):
            raise ReadBlocked("media_filter_classes is a list of media classes")
        if not isinstance(msg.get("search_query"), str):
            raise ReadBlocked("search_query is text")
        return await ma_browse(ctx, msg, SEARCH_KEYS, lambda: music_browse.search(
            host.ma, msg["search_query"], msg.get("media_content_id"), msg.get("media_content_type"), classes))

    async def browse_media(ctx: Ctx, msg: dict):
        if from_ma(msg):
            from . import music_browse
            return await ma_browse(ctx, msg, BROWSE_KEYS, lambda: music_browse.browse(
                host.ma, msg.get("media_content_id"), msg.get("media_content_type")))
        # HA answers it (readproxy: view on the player); when HA fails to open a playlist, Music Assistant is
        # asked why (a refused sign-in reads as HA's bare unknown_error otherwise)
        try:
            return await bridge().request(ctx.identity, msg)
        except (ReadBlocked, Forbidden, NotFound, MaNotConfigured):
            raise
        except Exception as err:
            why = await host.why_not_opened(msg.get("media_content_id"))
            if why is not None:
                raise SignInRefused(why) from None
            raise err

    read_routes(app).update({
        "media_player/browse_media": Route(request=browse_media),
        "media_player/search_media": Route(request=search_media),
        "hk_music/subscribe": Route(subscribe=subscribe),
        "hk_music/queue": Route(request=queue),
        "hk_music/settings/library": Route(request=library),
        "music_assistant/get_library": Route(request=get_library),
        "music_assistant/get_queue": Route(request=get_queue),
        "music_assistant/search": Route(request=search),
        # (HK Settings' Music page, hk_music/settings/get, is feature_pages.py's: MusicHost.page while active)
    })

    # "someone is using the Music page" (HA's hk_music/used): Keep Playlists Ready waits. Not a command
    # (nothing reaches Music Assistant or HA), so on every server, commands on or off.
    async def music_used(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        if not _principal_ok(ctx.identity) or set(msg) - {"type", "id"}:
            return await ctx.send({"type": "music_used_result", "id": rid, "error": {"code": "invalid"}})
        host.warmer.used()
        await ctx.send({"type": "music_used_result", "id": rid, "result": None})

    ws_handlers(app).update({"music_used": music_used})

    from .guards import guard

    @guard("manager")
    async def api_status(request) -> Any:
        from aiohttp import web
        return web.json_response(host.status())

    app.router.add_get("/api/music/status", api_status)

    async def start(_app: Any) -> None:
        await host.start()

    async def stop(_app: Any) -> None:
        await host.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
