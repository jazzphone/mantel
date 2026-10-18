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

        if cmd == "music/playlists/library_items":
            return await ok(LIBRARY)
        if cmd == "player_queues/get_active_queue":
            return await ok({"queue_id": args["player_id"], "current_index": 2, "items": 9})
        if cmd == "player_queues/items":
            return await ok(QUEUE_ITEMS[: args.get("limit", 10)])
        if cmd == "music/playlists/playlist_tracks":
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
