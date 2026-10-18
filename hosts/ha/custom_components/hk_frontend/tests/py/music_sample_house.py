"""Music's test house: a SAMPLE configuration (nine rooms, two sync-group
presets, a set of playlists with one chooser), a fake Music Assistant, and
the fixtures the test_feature_music*.py files share. Test data only -- the
feature itself starts empty and never reads this.

THE FAKE HOUSE behaves the way Music Assistant was MEASURED to behave, not the
way it is documented -- every rule below is one the engine is written around:
  * a joined group reports the SAME group_members, leader first, on every
    member; a lone room reports [];
  * media_player.join returns success even for a member it could not take
    (`stubborn` rooms), so only reading group_members back tells you;
  * a sync group player reports group_members None;
  * music_assistant.play_media only returns once playback has started
    (`slow_start` delays it; `dead` rooms never start);
  * transfer_queue moves the queue AND its content id to the leader.

A test module uses the fixtures by importing them:
    from music_sample_house import house, music  # noqa: F401
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse

from conftest import add_feature, feature_entries, update_feature

ROOMS = ["media_player.%s_homepod_ma" % k for k in (
    "kitchen", "living_room", "master_bedroom", "master_bathroom", "guest_bedroom",
    "office", "kids_room", "extra_room", "loft")]
EVERY = "media_player.homepods_2"
DOWNG = "media_player.downstairs_homepods_downstairs"
DOWN = ROOMS[:5]
K, LR, OFF, EXTRA, LOFT = ROOMS[0], ROOMS[1], ROOMS[5], ROOMS[7], ROOMS[8]

PRESETS = [
    {"name": "Everywhere", "group": EVERY, "members": list(ROOMS)},
    {"name": "Downstairs", "group": DOWNG, "members": DOWN},
]

# (name, icon, library uris, chooser)
PLAYLISTS = [
    ("Favorites Mix", "hk:star-fill", ["library://playlist/147"], None),
    ("New Music", "hk:sparkles", ["library://playlist/140"], None),
    ("Jazz", "mdi:saxophone",
     ["library://playlist/132", "library://playlist/139", "library://playlist/137",
      "library://playlist/120", "library://playlist/135", "library://playlist/127"], None),
    ("Country", "hk:guitar-acoustic",
     ["library://playlist/124", "library://playlist/150", "library://playlist/151",
      "library://playlist/152"], None),
    ("Christmas", "hk:christmas-tree",
     ["library://playlist/136", "library://playlist/128"], None),
    ("2020s", "hk:timer-sand", ["library://playlist/158"], "Decades"),
    ("2010s", "hk:timer-sand", ["library://playlist/157"], "Decades"),
    ("2000s", "hk:timer-sand", ["library://playlist/156"], "Decades"),
    ("1990s", "hk:timer-sand", ["library://playlist/155"], "Decades"),
    ("1980s", "hk:timer-sand", ["library://playlist/148"], "Decades"),
    ("1970s", "hk:timer-sand", ["library://playlist/154"], "Decades"),
]

VOLUME = 0.35


def subentries():
    """The presets and playlists as ConfigSubentry objects."""
    from types import MappingProxyType

    from homeassistant.config_entries import ConfigSubentry
    out = [ConfigSubentry(data=MappingProxyType({"name": p["name"], "group": p["group"],
                                                 "members": list(p["members"])}),
                          subentry_type="preset", title=p["name"], unique_id=None)
           for p in PRESETS]
    for i, (name, icon, items, chooser) in enumerate(PLAYLISTS):
        data = {"name": name, "icon": icon, "items": list(items), "order": i * 10}
        if chooser:
            data["chooser"] = chooser
        out.append(ConfigSubentry(data=MappingProxyType(data), subentry_type="playlist",
                                  title=f"{chooser} · {name}" if chooser else name,
                                  unique_id=None))
    return out


def music_entry(hass):
    """The house's Music feature (there is only ever one)."""
    (e,) = feature_entries(hass, "music")
    return e


class FakeHouse:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.at: list[tuple[str, float]] = []          # (call, loop time) -- for ordering
        self.stubborn: set[str] = set()
        self.dead: set[str] = set()
        self.slow_start = 0.0
        self.slow_unjoin = 0.0
        self.slow_transfer = 0.0
        self.lagging: set[str] = set()     # rooms that do not follow their sync group
        self.library = [{"name": "Favorites Mix", "uri": "library://playlist/147"},
                        {"name": "Country Hits", "uri": "library://playlist/124"}]
        for e in ROOMS:
            self.set(e, "idle", group_members=[], volume_level=0.2)
        for g in (EVERY, DOWNG):
            self.set(g, "idle", group_members=None, volume_level=0.2)

    # ---- state
    def set(self, entity: str, state: str | None = None, **attrs: Any) -> None:
        st = self.hass.states.get(entity)
        base = dict(st.attributes) if st else {"friendly_name": entity.split(".")[1]}
        base.update(attrs)
        self.hass.states.async_set(entity, state or (st.state if st else "idle"), base)

    def state(self, e: str) -> str:
        return self.hass.states.get(e).state

    def members(self, e: str) -> list[str]:
        return list(self.hass.states.get(e).attributes.get("group_members") or [])

    def group(self, leader: str, members: list[str]) -> None:
        gm = [leader] + [m for m in members if m != leader]
        for m in gm:
            self.set(m, group_members=gm)

    def called(self, name: str) -> list[dict[str, Any]]:
        return [d for n, d in self.calls if n == name]

    def when(self, name: str) -> list[float]:
        return [t for n, t in self.at if n == name]

    # ---- services
    def install(self) -> None:
        h = self.hass

        def ids(call: ServiceCall) -> list[str]:
            e = call.data["entity_id"]
            return [e] if isinstance(e, str) else list(e)

        def rec(name):
            def wrap(fn):
                async def handler(call: ServiceCall):
                    self.calls.append((name, dict(call.data)))
                    self.at.append((name, asyncio.get_running_loop().time()))
                    return await fn(call)
                return handler
            return wrap

        @rec("join")
        async def join(call):
            leader = ids(call)[0]
            take = [m for m in call.data["group_members"] if m not in self.stubborn]
            for m in take:
                self._leave(m)
            self.group(leader, list(dict.fromkeys(self.members(leader) or [leader])) + take)

        @rec("unjoin")
        async def unjoin(call):
            if self.slow_unjoin:
                await asyncio.sleep(self.slow_unjoin)
            for e in ids(call):
                self._leave(e)

        @rec("media_pause")
        async def pause(call):
            for e in ids(call):
                if self.state(e) == "playing":
                    self.set(e, "paused")

        @rec("media_stop")
        async def stop(call):
            for e in ids(call):
                self.set(e, "idle")

        @rec("media_play_pause")
        async def play_pause(call):
            for e in ids(call):
                self.set(e, "paused" if self.state(e) == "playing" else "playing")

        @rec("media_next_track")
        async def nxt(call):
            pass

        @rec("media_previous_track")
        async def prev(call):
            pass

        @rec("volume_set")
        async def volume(call):
            await asyncio.sleep(0)
            for e in ids(call):
                self.set(e, volume_level=call.data["volume_level"])

        @rec("shuffle_set")
        async def shuffle(call):
            pass

        @rec("ma_play_media")
        async def ma_play(call):
            target = ids(call)[0]
            if self.slow_start:
                await asyncio.sleep(self.slow_start)
            if target in self.dead:
                raise Exception("The command to the player failed.")
            self._play(target, str(call.data["media_id"]))

        @rec("play_media")
        async def play_media(call):
            target = ids(call)[0]
            if target in self.dead:
                raise Exception("The command to the player failed.")
            self._play(target, call.data["media_content_id"])

        @rec("transfer_queue")
        async def transfer(call):
            if self.slow_transfer:
                await asyncio.sleep(self.slow_transfer)
            leader, source = ids(call)[0], call.data["source_player"]
            cid = self.hass.states.get(source).attributes.get("media_content_id")
            self.set(source, "idle")
            self._play(leader, cid)

        async def get_library(call):
            self.calls.append(("get_library", dict(call.data)))
            return {"items": list(self.library)}

        for svc, fn in (("join", join), ("unjoin", unjoin), ("media_pause", pause),
                        ("media_stop", stop), ("media_play_pause", play_pause),
                        ("media_next_track", nxt), ("media_previous_track", prev),
                        ("volume_set", volume), ("shuffle_set", shuffle),
                        ("play_media", play_media)):
            h.services.async_register("media_player", svc, fn)
        h.services.async_register("music_assistant", "play_media", ma_play)
        h.services.async_register("music_assistant", "transfer_queue", transfer)
        h.services.async_register("music_assistant", "get_library", get_library,
                                  supports_response=SupportsResponse.ONLY)

    def _leave(self, e: str) -> None:
        gm = self.members(e)
        if len(gm) > 1:
            rest = [m for m in gm if m != e]
            for m in rest:
                self.set(m, group_members=rest if len(rest) > 1 else [])
        self.set(e, group_members=[])

    def _play(self, target: str, content: str | None) -> None:
        self.set(target, "playing", media_content_id=content)
        for m in self.members(target):
            if m != target:
                self.set(m, "playing", media_content_id=content)
        if target in (EVERY, DOWNG):
            for m in (ROOMS if target == EVERY else DOWN):
                if m not in self.lagging:
                    self.set(m, "playing")


@pytest.fixture
async def house(hass: HomeAssistant) -> FakeHouse:
    """The fake house: speakers that behave as Music Assistant was measured to."""
    fh = FakeHouse(hass)
    fh.install()
    yield fh


@pytest.fixture
async def music(hass: HomeAssistant, frontend, house: FakeHouse):
    """Music, added the way a user adds it (empty, from Add feature), then given
    the sample house: its speakers and volume, and its presets and playlists."""
    from custom_components.hk_frontend.features.music import music as M

    r = await add_feature(hass, "music", {})
    assert r["type"] == "create_entry", r
    entry = music_entry(hass)
    update_feature(hass, entry, options={**entry.options, "speakers": list(ROOMS), "volume": VOLUME})
    for sub in subentries():
        hass.config_entries.async_add_subentry(entry.house, sub)
    await hass.async_block_till_done()
    mgr: M.MusicManager = entry.runtime_data
    mgr.settle = 0          # the one real sleep, which tests do not need
    # The waits' BOUNDS, shortened: every wait here ends on an event, so only
    # the tests of a timeout ever reach one, and they need not take 15 s.
    saved = {k: getattr(M, k) for k in ("JOIN_TIMEOUT", "START_TIMEOUT", "RELEASE_TIMEOUT",
                                        "PAUSE_TIMEOUT", "STOP_TIMEOUT", "TRANSFER_TIMEOUT")}
    for k in saved:
        setattr(M, k, 0.5)
    yield mgr
    for k, v in saved.items():
        setattr(M, k, v)
