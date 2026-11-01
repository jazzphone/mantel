"""Fakes for the music engine tests (tests/test_music.py): a fictional house of Music Assistant players, and a
fake Music Assistant that answers the engine's reads and, for each command it is sent, changes the players'
Home Assistant states the way HA's music_assistant integration would report them (so the engine's waits see
its steps land). Every frame is recorded so tests can assert exactly what Mantel sent. No real HA or MA is
contacted; every name, id and token is fictional."""
from __future__ import annotations

from connector_fakes import FakeMa

MA_ENTRY = "ma-entry-fictional"
# entity -> (Music Assistant player id, area)
PLAYERS = {
    "media_player.kitchen_ma": ("ma-kitchen", "kitchen"),
    "media_player.den_ma": ("ma-den", "den"),
    "media_player.cody_ma": ("ma-cody", "cody_room"),
    "media_player.downstairs_ma": ("ma-downstairs", None),        # a sync group: no room
    "media_player.garage_ma": ("ma-garage", "garage"),           # MA has it; not one of the house's speakers
    # the Study's two HomePods, not yet speakers: a VIRTUAL PAIR's two players (docs/phase4/VIRTUAL-PAIRS.md)
    "media_player.study_left_ma": ("ma-study-l", "study"),
    "media_player.study_right_ma": ("ma-study-r", "study"),
    "media_player.study_pair_ma": ("ma-study-pair", None),       # a group of those two, when a test says so
}
AREAS = [{"area_id": "kitchen", "name": "Kitchen", "floor_id": "main"},
         {"area_id": "den", "name": "Den", "floor_id": "main"},
         {"area_id": "cody_room", "name": "Cody's Room", "floor_id": "upper"},
         {"area_id": "garage", "name": "Garage", "floor_id": "main"},
         {"area_id": "study", "name": "Study", "floor_id": "upper"},
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


# Music Assistant's own reads that Mantel makes to keep the speakers' states (music_states.py): not a request's
OVERLAY_READS = frozenset({"players/all", "player_queues/all"})


def ma_player(pid: str, entity: str) -> dict:
    """A Music Assistant player (to_dict shape) as the house starts: idle, volume 20, its own queue."""
    group = entity == "media_player.downstairs_ma"
    return {"player_id": pid, "display_name": entity.split(".")[1].replace("_", " ").title(),
            "type": "group" if group else "player", "available": True, "enabled": True, "powered": True,
            "playback_state": "idle", "volume_level": 20, "group_volume": 20, "volume_muted": False,
            "group_members": [], "synced_to": None, "active_source": pid, "current_media": None,
            "supported_features": ["volume_set", "volume_mute", "pause"] + ([] if group else ["set_members"]),
            "volume_control": "native", "mute_control": "native", "power_control": "none", "icon": "mdi-speaker",
            "source_list": [{"id": pid, "name": "Music Assistant Queue", "passive": False}]}


class HouseMa(FakeMa):
    """FakeMa that knows the house: it answers the engine's reads and, for each command, changes its players the way
    Music Assistant does and tells Mantel (``player_updated`` / ``queue_updated``), as the real one does -- so the
    speakers' states Mantel shows (music_states.py) and the engine's waits follow Music Assistant, not HA."""

    def __init__(self, hub=None) -> None:
        super().__init__()
        self.hub = hub
        self.react = True
        # (provider, item id) of playlists whose songs MA cannot read: the streaming service refused its sign-in
        self.signed_out: set[tuple[str, str]] = set()
        self.model = {pid: ma_player(pid, e) for e, pid in PID.items()}
        self.qs = {pid: {"queue_id": pid, "active": True, "shuffle_enabled": False, "repeat_mode": "off",
                         "current_index": 2, "items": 9, "current_item": None} for pid in PID.values()}
        self._players: list | None = None
        # a group's settings (config/players/get): {group id: the members it is set up with}; else what it holds now
        self.configured: dict[str, list[str]] = {}
        # PRESETS WRITE MUSIC ASSISTANT'S GROUPS: the entity HA's music_assistant integration gives a group Mantel
        # makes (None: HA never lists it), and the players Music Assistant leaves out of a new group (unavailable)
        self.new_entity: str | None = "media_player.new_group_ma"
        self.unavailable: set[str] = set()

    # players/all's answer, when a test gives one (hk_core/music/groups.py: pairs, the presets' rooms): what it says
    # about a player is that player's from then on
    @property
    def players(self):
        return self._players

    @players.setter
    def players(self, value) -> None:
        self._players = value
        if isinstance(value, list):
            for p in value:
                self.model[p["player_id"]] = {**ma_player(p["player_id"], ENT.get(p["player_id"], "x.x")),
                                              **self.model.get(p["player_id"], {}), **p}

    def commands(self) -> list[str]:
        return [c for c in super().commands() if c not in OVERLAY_READS]

    def sent(self, *, commands_only: bool = True) -> list[tuple[str, dict]]:
        out = []
        for f in self.frames:
            c = f.get("command")
            if c in OVERLAY_READS:
                continue
            if commands_only and not (c.startswith("players/cmd/") or c.startswith("player_queues/")
                                      and c not in ("player_queues/get_active_queue", "player_queues/items")):
                continue
            out.append((c, f.get("args") or {}))
        return out

    async def set(self, entity: str, s: str | None = None, **attrs) -> None:
        """A speaker changes in Music Assistant (HA's names for what changed: state, volume_level, media_content_id,
        media_title, media_artist, shuffle, group_members as entity ids), and Mantel is told."""
        if entity not in PID:
            return
        pid = PID[entity]
        p = dict(self.model[pid])
        q = dict(self.qs[pid])
        if s is not None:
            p["playback_state"], p["powered"] = (s, True) if s != "off" else (p["playback_state"], False)
        if "volume_level" in attrs:
            p["volume_level"] = p["group_volume"] = round(attrs.pop("volume_level") * 100)
        if "group_members" in attrs:
            p["group_members"] = [PID[e] for e in attrs.pop("group_members")]
        if "shuffle" in attrs:
            q["shuffle_enabled"] = attrs.pop("shuffle")
        media = dict(p.get("current_media") or {})
        for ha, ma in (("media_content_id", "uri"), ("media_title", "title"), ("media_artist", "artist"),
                       ("media_album_name", "album"), ("media_duration", "duration"), ("image", "image_url")):
            if ha in attrs:
                media[ma] = attrs.pop(ha)
        if media:
            p["current_media"] = media
        assert not attrs, f"the fake has no Music Assistant field for {sorted(attrs)}"
        self.model[pid], self.qs[pid] = p, q
        await self.push({"event": "queue_updated", "object_id": pid, "data": q})
        await self.push({"event": "player_updated", "object_id": pid, "data": p})

    async def _set(self, entity: str, s: str | None = None, **attrs) -> None:
        if self.react:
            await self.set(entity, s, **attrs)

    def dynamic(self, pid: str) -> bool:
        """A group that takes members (a dynamic sync group: set_members, as the house's are)."""
        p = self.model.get(pid) or {}
        return p.get("type") == "group" and "set_members" in (p.get("supported_features") or [])

    def dynamic_group_of(self, pid: str) -> str | None:
        """The dynamic sync group a player plays in: one playing or paused first."""
        holding = [g for g, p in self.model.items() if self.dynamic(g) and pid in (p.get("group_members") or [])]
        return next((g for g in holding if self.model[g]["playback_state"] in ("playing", "paused")),
                    holding[0] if holding else None)

    async def answer(self, ws, mid, cmd, args) -> None:
        async def ok(result):
            await ws.send_json({"message_id": mid, "result": result, "partial": False})

        if cmd == "players/all":
            return await ok(self.players if self.players is not None and not isinstance(self.players, list)
                            else list(self.model.values()))
        if cmd == "player_queues/all":
            return await ok(list(self.qs.values()))
        if cmd == "config/players/get":
            pid = args["player_id"]
            return await ok({"player_id": pid, "provider": "sync_group", "values": {"group_members": {
                "key": "group_members", "value": self.configured.get(pid, self.model[pid].get("group_members"))}}})
        if cmd == "players/create_group_player":
            # Music Assistant 2.10.9's sync group provider: available members only, a new id, dynamic as asked; HA's
            # integration then lists it (the hub's registry, as an entity registry update would)
            pid = f"syncgroup_fictnew{sum(1 for x in self.model if x.startswith('syncgroup_')) + 1}"
            members = [m for m in args["members"] if m in self.model and m not in self.unavailable]
            self.model[pid] = dict(ma_player(pid, "x.x"), display_name=args["name"], type="group", provider="sync_group",
                                   group_members=list(members),
                                   supported_features=["volume_set", "set_members"] if args["dynamic"] else ["volume_set"])
            self.configured[pid] = list(members)
            if self.hub is not None and self.new_entity:
                self.hub.registry.load(AREAS, [], self.hub.registry.entity_entries + [
                    {"entity_id": self.new_entity, "area_id": None, "platform": "music_assistant", "unique_id": pid,
                     "config_entry_id": MA_ENTRY}], FLOORS)
            return await ok(self.model[pid])
        if cmd == "config/players/save":
            pid = args["player_id"]
            if pid not in self.model:
                return await ws.send_json({"message_id": mid, "error_code": 999,
                                           "details": f"No config found for player id {pid}"})
            if "group_members" in args["values"]:
                self.configured[pid] = list(args["values"]["group_members"])
                if not self.dynamic(pid):          # a static group's members are its settings'
                    self.model[pid]["group_members"] = list(args["values"]["group_members"])
            return await ok({"player_id": pid, "provider": "sync_group", "values": {}})
        if cmd.startswith("music/") and cmd.endswith("/library_items"):
            return await ok(library_answer(cmd, args))
        if cmd == "player_queues/get_active_queue":
            return await ok({"queue_id": args["player_id"], "current_index": 2, "items": 9, "active": True,
                             "display_name": "Fictional", "shuffle_enabled": True, "repeat_mode": "off",
                             "elapsed_time": 12.5, "current_item": dict(QUEUE_ITEMS[0], media_item=TRACKS[2]),
                             "next_item": dict(QUEUE_ITEMS[1], media_item=dict(TRACKS[3], album=ALBUMS[2]))})
        if cmd == "player_queues/items":
            return await ok(QUEUE_ITEMS[: args.get("limit", 10)])
        if cmd == "music/item_by_uri":
            hit = next((i for items in LIB_ITEMS.values() for i in items if i["uri"] == args["uri"]), None)
            if hit is None and args["uri"] == "apple_music://playlist/pl.fictional":
                hit = {"item_id": "pl.fictional", "provider": "apple_music", "media_type": "playlist",
                       "uri": args["uri"], "name": "Fictional Mix"}
            if hit is None:
                return await ws.send_json({"message_id": mid, "error_code": 3, "details": "not found"})
            return await ok(dict(hit, provider=hit.get("provider", "library")))
        if cmd == "music/artists/artist_albums":
            return await ok([a for a in ALBUMS if a["artists"][0]["item_id"] == args["item_id"]])
        if cmd == "music/albums/album_tracks":
            return await ok(TRACKS[:3] + [dict(TRACKS[3], available=False)])
        if cmd == "music/search":
            return await ok({"artists": ARTISTS[:1], "albums": ALBUMS[:1], "tracks": TRACKS[:2], "playlists": [],
                             "radio": RADIOS, "podcasts": [], "audiobooks": []})
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
            held = self.dynamic_group_of(args["player_id"])
            if held is not None:            # it leaves the group, which plays on in the rest; it stops
                rest = [ENT[m] for m in self.model[held]["group_members"] if m != args["player_id"]]
                await self._set(ENT[held], group_members=rest)
                for m in rest:
                    await self._set(m, group_members=rest)
                await self._set(e, "idle", group_members=[])
            else:
                await self._set(e, group_members=[])
        elif cmd == "players/cmd/group_many" and self.dynamic(PID[e]):
            # a dynamic sync group takes them while it plays (Music Assistant's late join): they play with it
            g = self.model[PID[e]]
            group = [ENT[m] for m in g["group_members"]] + [ENT[c] for c in args["child_player_ids"]
                                                             if c not in g["group_members"]]
            await self._set(e, group_members=group)
            for m in group:
                await self._set(m, g["playback_state"], group_members=group,
                                media_content_id=(g.get("current_media") or {}).get("uri"))
        elif cmd == "players/cmd/group_many":
            group = [e] + [ENT[c] for c in args["child_player_ids"]]
            for m in group:
                await self._set(m, group_members=group)
        elif cmd == "players/cmd/pause":
            await self._set(e, "paused")
        elif cmd == "players/cmd/stop":
            await self._set(e, "idle")
        elif cmd == "players/cmd/play_pause":
            st = self.model[PID[e]]["playback_state"]
            await self._set(e, "paused" if st == "playing" else "playing")
        elif cmd == "players/cmd/volume_set":
            await self._set(e, volume_level=args["volume_level"] / 100)
        elif cmd == "player_queues/shuffle":
            await self._set(e, shuffle=args["shuffle_enabled"])
        elif cmd == "player_queues/play_media":
            await self._set(e, "playing", media_content_id=args["media"][0])
            if e == "media_player.downstairs_ma":
                for m in ("media_player.kitchen_ma", "media_player.den_ma"):
                    await self._set(m, "playing")
            elif self.model[PID[e]].get("type") == "group":        # any other group: its players play with it
                for m in self.model[PID[e]].get("group_members") or []:
                    await self._set(ENT[m], "playing", media_content_id=args["media"][0])
        elif cmd == "player_queues/transfer":
            src = ENT[args["source_queue_id"]]
            moving = (self.model[PID[src]].get("current_media") or {}).get("uri")
            await self._set(e, "playing", media_content_id=moving)
            await self._set(src, "idle")
        if cmd.startswith("players/cmd/") or cmd.startswith("player_queues/"):
            return await ok(None)
        return await super().answer(ws, mid, cmd, args)
