"""Fakes for the music engine tests (tests/test_music.py): a fictional house of Music Assistant players, and a
fake Music Assistant that answers the engine's reads and, for each command it is sent, changes the players'
Home Assistant states the way HA's music_assistant integration would report them (so the engine's waits see
its steps land). Every frame is recorded so tests can assert exactly what Mantel sent. No real HA or MA is
contacted; every name, id and token is fictional."""
from __future__ import annotations

import time

from connector_fakes import FakeMa

MA_ENTRY = "ma-entry-fictional"
# entity -> (Music Assistant player id, area)
PLAYERS = {
    "media_player.kitchen_ma": ("ma-kitchen", "kitchen"),
    "media_player.den_ma": ("ma-den", "den"),
    "media_player.cody_ma": ("ma-cody", "cody_room"),
    "media_player.downstairs_ma": ("ma-downstairs", None),        # a sync group: no room
    "media_player.garage_ma": ("ma-garage", "garage"),           # MA has it; not one of the house's speakers
}
AREAS = [{"area_id": "kitchen", "name": "Kitchen", "floor_id": "main"},
         {"area_id": "den", "name": "Den", "floor_id": "main"},
         {"area_id": "cody_room", "name": "Cody's Room", "floor_id": "upper"},
         {"area_id": "garage", "name": "Garage", "floor_id": "main"},
         {"area_id": "porch", "name": "Porch"}]
FLOORS = [{"floor_id": "main", "name": "Main Floor", "level": 0}, {"floor_id": "upper", "name": "Upstairs", "level": 1}]
ENTITIES = [{"entity_id": e, "area_id": a, "platform": "music_assistant", "unique_id": pid,
             "config_entry_id": MA_ENTRY} for e, (pid, a) in PLAYERS.items()] + [
    {"entity_id": "media_player.tv", "area_id": "den", "platform": "cast", "unique_id": "cast-1"}]
PID = {e: pid for e, (pid, _a) in PLAYERS.items()}
ENT = {pid: e for e, pid in PID.items()}
LIBRARY = [{"uri": "library://playlist/1", "name": "Morning Mix", "item_id": "1",
            "provider_mappings": [{"provider_domain": "apple_music"}]},
           {"uri": "library://playlist/2", "name": "Evening", "item_id": "2",
            "provider_mappings": [{"provider_domain": "builtin"}]}]
PROXY_ID = "ab" * 32       # Music Assistant 2.10's image id: 64 hex (fictional)


def _art(n: int, remote: bool = False) -> dict:
    return {"type": "thumb", "path": f"https://img.example/{n}.jpg" if remote else f"/data/art/{n}.jpg",
            "provider": "library", "remotely_accessible": remote}


def _artist(n: int, name: str) -> dict:
    return {"item_id": str(n), "provider": "library", "media_type": "artist", "uri": f"library://artist/{n}",
            "name": name, "version": "", "image": None}


# Music Assistant's library items (to_dict shapes), per media type: what music/<type>/library_items answers
BAND, SOLOIST = _artist(7, "Band"), _artist(8, "Soloist")
ALBUMS = [{"item_id": str(i), "provider": "library", "media_type": "album", "uri": f"library://album/{i}",
           "name": f"Album {chr(64 + i)}", "version": "Deluxe" if i == 2 else "", "album_type": t,
           "favorite": i in (2, 4), "last_played": 100 - i, "artists": [BAND if i % 2 else SOLOIST],
           "metadata": {"images": [{"type": "fanart", "path": "/x/fan.jpg", "provider": "library"},
                                   dict(_art(i), proxy_id=PROXY_ID) if i == 3 else _art(i)]}}
          for i, t in ((1, "album"), (2, "album"), (3, "single"), (4, "compilation"), (5, "album"))]
TRACKS = [{"item_id": str(i), "provider": "library", "media_type": "track", "uri": f"library://track/{i}",
           "name": f"Song {i}", "version": "", "favorite": i == 3, "artists": [BAND], "album": ALBUMS[0],
           "image": _art(i, remote=True)} for i in range(1, 8)]
ARTISTS = [dict(BAND, favorite=True, image=_art(7)), dict(SOLOIST, favorite=False, image=None)]
RADIOS = [{"item_id": "r1", "provider": "tunein", "media_type": "radio", "uri": "library://radio/r1",
           "name": "Jazz FM", "version": "", "favorite": True, "image": None}]
PODCASTS = [{"item_id": "p1", "provider": "rss", "media_type": "podcast", "uri": "library://podcast/p1",
             "name": "Talk Show", "version": "", "favorite": False, "image": None}]
LIB_ITEMS = {"artists": ARTISTS, "albums": ALBUMS, "tracks": TRACKS, "playlists": LIBRARY, "radios": RADIOS,
             "podcasts": PODCASTS, "audiobooks": []}


def library_answer(cmd: str, args: dict) -> list:
    """What Music Assistant answers music/<type>/library_items: the filters it takes (favorite, search, album_types,
    album_artists_only), an order, offset and limit."""
    items = list(LIB_ITEMS[cmd.split("/")[1]])
    if args.get("favorite") is not None:
        items = [i for i in items if bool(i.get("favorite")) == args["favorite"]]
    if args.get("search"):
        items = [i for i in items if args["search"].lower() in i["name"].lower()]
    if args.get("album_types"):
        items = [i for i in items if i.get("album_type") in args["album_types"]]
    if args.get("album_artists_only"):
        items = [i for i in items if i["name"] == "Band"]
    order = args.get("order_by")
    if order in ("last_played", "last_played_desc"):
        items.sort(key=lambda i: i.get("last_played", 0), reverse=order.endswith("_desc"))
    off = args.get("offset", 0)
    return items[off: off + args.get("limit", 500)]


QUEUE_ITEMS = [{"queue_item_id": "qi-3", "name": "Song Three", "duration": 200,
                "media_item": {"name": "Song Three", "artists": [{"name": "Band"}],
                               "image": {"path": "https://img.example/3.jpg"}}},
               {"queue_item_id": "qi-4", "name": "Song Four", "duration": 180,
                "media_item": {"name": "Song Four", "artists": [],
                               "image": "https://ma.example/imageproxy?path=x&token=fictional"}}]


def states(**over) -> dict:
    out = {}
    for e in PLAYERS:
        out[e] = {"s": "idle", "a": {"friendly_name": e.split(".")[1].replace("_", " ").title(), "group_members": [],
                                     "volume_level": 0.2}, "lc": 1.0, "lu": 1.0}
    out["media_player.tv"] = {"s": "off", "a": {"friendly_name": "TV"}, "lc": 1.0, "lu": 1.0}
    for e, patch in over.items():
        out[e.replace("__", ".")]["s"] = patch.get("s", out[e.replace("__", ".")]["s"])
        out[e.replace("__", ".")]["a"].update(patch.get("a") or {})
    return out


DOC = {
    "options": {"speakers": ["media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"],
                "volume": 0.3, "homes": {"ha:ha-owner": "media_player.den_ma"}, "keep_ready": False,
                "ignore_announcements": True},
    "items": [
        {"kind": "preset", "key": "pre1", "title": "Downstairs",
         "data": {"name": "Downstairs", "group": "media_player.downstairs_ma",
                  "members": ["media_player.kitchen_ma", "media_player.den_ma"]}},
        {"kind": "playlist", "key": "pl1", "title": "Morning",
         "data": {"name": "Morning", "icon": "mdi:coffee", "items": ["library://playlist/1"], "order": 10.0}},
        {"kind": "playlist", "key": "pl_gone", "title": "Gone",
         "data": {"name": "Gone", "icon": "mdi:x", "items": ["library://playlist/99"], "order": 20.0}},
    ],
    "source": "test",
}


class HouseMa(FakeMa):
    """FakeMa that knows the house: it answers the engine's reads and moves the players' HA states (through
    ``hub.store`` + ``hub.ha.on_change``, as HA's subscribe_entities would) for each command."""

    def __init__(self, hub=None) -> None:
        super().__init__()
        self.hub = hub
        self.react = True
        # (provider, item id) of playlists whose songs MA cannot read: the streaming service refused its sign-in
        self.signed_out: set[tuple[str, str]] = set()

    def sent(self, *, commands_only: bool = True) -> list[tuple[str, dict]]:
        out = []
        for f in self.frames:
            c = f.get("command")
            if commands_only and not (c.startswith("players/cmd/") or c.startswith("player_queues/")
                                      and c not in ("player_queues/get_active_queue", "player_queues/items")):
                continue
            out.append((c, f.get("args") or {}))
        return out

    def _set(self, entity: str, s: str | None = None, **attrs) -> None:
        if self.hub is None or not self.react:
            return
        plus: dict = {"lu": time.time()}
        if s is not None:
            plus["s"], plus["lc"] = s, time.time()
        if attrs:
            plus["a"] = attrs
        changed = self.hub.store.apply_event({"c": {entity: {"+": plus}}})
        self.hub.ha.on_change(changed)

    async def answer(self, ws, mid, cmd, args) -> None:
        async def ok(result):
            await ws.send_json({"message_id": mid, "result": result, "partial": False})

        if cmd.startswith("music/") and cmd.endswith("/library_items"):
            return await ok(library_answer(cmd, args))
        if cmd == "player_queues/get_active_queue":
            return await ok({"queue_id": args["player_id"], "current_index": 2, "items": 9})
        if cmd == "player_queues/items":
            return await ok(QUEUE_ITEMS[: args.get("limit", 10)])
        if cmd == "music/playlists/playlist_tracks":
            if (args.get("provider_instance_id_or_domain"), args.get("item_id")) in self.signed_out:
                return await ws.send_json({"message_id": mid, "error_code": 6,          # LoginFailed
                                           "details": "Login failed. Please check your credentials and try again."})
            return await ok([{"item_id": "t"}] * 3)
        if cmd == "music/recently_played_items":
            return await ok([{"item_id": "1", "provider": "library", "media_type": "playlist"}])
        e = ENT.get(args.get("player_id") or args.get("queue_id") or args.get("target_player") or
                    args.get("target_queue_id") or "")
        if cmd == "players/cmd/ungroup":
            self._set(e, group_members=[])
        elif cmd == "players/cmd/group_many":
            group = [e] + [ENT[c] for c in args["child_player_ids"]]
            for m in group:
                self._set(m, group_members=group)
        elif cmd == "players/cmd/pause":
            self._set(e, "paused")
        elif cmd == "players/cmd/stop":
            self._set(e, "idle")
        elif cmd == "players/cmd/play_pause":
            st = self.hub.store.states.get(e, {}).get("s") if self.hub else None
            self._set(e, "paused" if st == "playing" else "playing")
        elif cmd == "players/cmd/volume_set":
            self._set(e, volume_level=args["volume_level"] / 100)
        elif cmd == "player_queues/shuffle":
            self._set(e, shuffle=args["shuffle_enabled"])
        elif cmd == "player_queues/play_media":
            self._set(e, "playing", media_content_id=args["media"][0])
            if e == "media_player.downstairs_ma":
                for m in ("media_player.kitchen_ma", "media_player.den_ma"):
                    self._set(m, "playing")
        elif cmd == "player_queues/transfer":
            src = ENT[args["source_queue_id"]]
            moving = self.hub.store.states[src]["a"].get("media_content_id") if self.hub else None
            self._set(e, "playing", media_content_id=moving)
            self._set(src, "idle")
        if cmd.startswith("players/cmd/") or cmd.startswith("player_queues/"):
            return await ok(None)
        return await super().answer(ws, mid, cmd, args)
