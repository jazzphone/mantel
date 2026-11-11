"""music.py's Music Assistant's players and library, search and the queue as the page reads them (moved here by tools/split_py.py from hosts/server/mantel_server/music/__init__.py:
tools/split_py_manifests/music.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any
from .music_names import MA_PLATFORM, TEXT_MAX


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
    from ..ha.readproxy import _safe_image
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
