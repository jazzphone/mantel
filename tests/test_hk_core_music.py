"""hk_core.music against a fake House: the music engine's decisions run once here, for every host.

The HA build runs the same code through hosts/ha's HaHouse (tests/py/test_feature_music_*.py),
with HA's state machine, registries and its media players behind it. Nothing here sends
anything: the fake House refuses every service call, and Keep Playlists Ready talks to a fake
Music Assistant client that only answers.
"""
import asyncio

import pytest

from hk_core.house import Device, Entity, Floor, State
from hk_core.music import announcements as A, checks, engine as E, groups as G, queue, settings as S
from hk_core.music.config import Item, MusicConfig
from hk_core.music.const import (
    CONF_HOMES, CONF_KEEP_READY, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME, GROUPING, SUB_PLAYLIST, SUB_PRESET,
    WARM_EVERY, WARM_GAP, WARM_QUIET, WARM_RETRY, WARM_SLOW_PAGE,
)
from hk_core.music.warm import Warmer

K, LR, OFF, LOFT, EXTRA = (f"media_player.{r}" for r in ("kitchen", "living_room", "office", "loft", "extra"))
ROOMS = [K, LR, OFF, LOFT, EXTRA]
DOWNG, EVERY = "media_player.downstairs_group", "media_player.everywhere_group"
DOWN = [K, LR]


class FakeHouse:
    """States, registries, areas and floors -- and no way to change anything."""

    def __init__(self):
        self._states = {}
        self._entities = {}
        self._devices = {}
        self._areas = {}            # area id -> (name, floor id)
        self._floors = {}           # floor id -> Floor
        self.calls = []

    def set(self, entity_id, state="idle", **attrs):
        old = self._states.get(entity_id)
        base = dict(old.attributes) if old else {}
        base.update(attrs)
        self._states[entity_id] = State(entity_id, state, base)

    def group(self, leader, others):
        gm = [leader] + [m for m in others if m != leader]
        for m in gm:
            self.set(m, self.state(m).state if self.state(m) else "idle", group_members=gm)

    def state(self, entity_id):
        return self._states.get(entity_id)

    def states(self, domain=None):
        return [s for s in self._states.values() if domain is None or s.domain == domain]

    def entity(self, entity_id):
        return self._entities.get(entity_id)

    def entities(self, domain=None):
        return [e for e in self._entities.values() if domain is None or e.domain == domain]

    def device(self, device_id):
        return self._devices.get(device_id)

    def device_entities(self, device_id):
        return [e for e in self._entities.values() if e.device_id == device_id]

    def area_ids(self):
        return set(self._areas)

    def area_name(self, area_id):
        a = self._areas.get(area_id)
        return a[0] if a else None

    def area_floor(self, area_id):
        a = self._areas.get(area_id)
        return self._floors.get(a[1]) if a and a[1] else None

    def local_time(self, when=None):
        raise AssertionError("the music rules never ask the time of the house")

    async def call_service(self, *a, **kw):
        self.calls.append((a, kw))
        raise AssertionError("the music rules never call a service")


def preset(key, name, group, members):
    return Item(SUB_PRESET, key, name, {"name": name, "group": group, "members": list(members)})


def playlist(key, name, items, order=0, chooser=None, icon=None):
    data = {"name": name, "items": list(items), "order": order}
    if chooser:
        data["chooser"] = chooser
    if icon:
        data["icon"] = icon
    return Item(SUB_PLAYLIST, key, f"{chooser} · {name}" if chooser else name, data)


ITEMS = [
    preset("p_down", "Downstairs", DOWNG, DOWN),
    preset("p_every", "Everywhere", EVERY, ROOMS),
    playlist("pl_country", "Country", ["library://playlist/124", "library://playlist/150"], order=20),
    playlist("pl_fav", "Favorites", ["library://playlist/147"], order=10),
    playlist("pl_80s", "1980s", ["library://playlist/148"], order=30, chooser="Decades"),
    playlist("pl_90s", "1990s", ["library://playlist/155"], order=40, chooser="Decades"),
    playlist("pl_empty", "Empty", [], order=50),
]


@pytest.fixture
def house():
    h = FakeHouse()
    for r in ROOMS:
        h.set(r, "idle", group_members=[], volume_level=0.2, friendly_name=r.split(".")[1].title())
    for g in (DOWNG, EVERY):
        h.set(g, "idle", group_members=None)
    # the Kitchen is in an area on the main floor (through its device); the Office in an area
    # upstairs; the Loft in an area on no floor; the others in none
    h._floors = {"main": Floor("main", "Main Floor", 1), "up": Floor("up", "Upstairs", 2)}
    h._areas = {"kitchen": ("Kitchen", "main"), "office": ("Study", "up"), "loft": ("Loft Room", None)}
    h._devices = {"dev_k": Device("dev_k", "kitchen")}
    h._entities = {K: Entity(K, device_id="dev_k"), OFF: Entity(OFF, area_id="office"),
                   LOFT: Entity(LOFT, area_id="loft")}
    return h


@pytest.fixture
def cfg(house):
    opts = {CONF_SPEAKERS: list(ROOMS), CONF_VOLUME: 0.35, CONF_HOMES: {"u1": OFF, "u2": "media_player.gone"}}
    return MusicConfig.build(house, opts, ITEMS, library_entry="ma1")


# ------------------------------------------------------------- the configuration
def test_rooms_are_named_and_floored_from_the_house(cfg):
    names = {r.entity: (r.name, r.floor) for r in cfg.rooms}
    assert names[K] == ("Kitchen", "Main Floor"), "through its device's area"
    assert names[OFF] == ("Study", "Upstairs"), "its area's name, not its own"
    assert names[LOFT] == ("Loft Room", None)
    assert names[LR] == ("Living_Room", None), "no area: its friendly name"
    # floors in level order, then the order they were picked; no floor last
    assert cfg.room_ids == [K, OFF, LR, LOFT, EXTRA]


def test_presets_widest_first_playlists_in_order(cfg):
    assert [p.name for p in cfg.presets] == ["Everywhere", "Downstairs"]
    assert [p.name for p in cfg.playlists] == ["Favorites", "Country", "1980s", "1990s", "Empty"]
    assert cfg.preset_for_rooms(reversed(DOWN)).group == DOWNG
    assert cfg.preset_for_group(EVERY).name == "Everywhere"
    assert cfg.players() == [EVERY, DOWNG] + cfg.room_ids
    assert cfg.name_of(DOWNG) == "Downstairs" and cfg.name_of("media_player.tv") == "media_player.tv"


def test_a_screen_gets_floors_choosers_and_only_its_own_real_home(cfg):
    c = cfg.as_client("u1")
    assert c["configured"] and c["library_entry"] == "ma1" and c["volume"] == 0.35
    assert [f["name"] for f in c["floors"]] == ["Main Floor", "Upstairs", "Other"]
    assert c["playlists"][2] == {"name": "Decades", "icon": "mdi:playlist-music", "options": [
        {"name": "1980s", "key": "pl_80s"}, {"name": "1990s", "key": "pl_90s"}]}
    assert c["home"] == OFF
    assert cfg.as_client("u2")["home"] is None, "a home room that is no longer a speaker"
    assert cfg.as_client(None)["home"] is None


# ------------------------------------------------------------- refusals
def test_refusals_answer_before_anything_is_sent(house, cfg):
    def msg(rooms, key="pl_fav"):
        return E.check_play(house, cfg, rooms, key)[0]["message"]
    assert "at least one" in msg([])
    assert "twice" in msg([OFF, OFF])
    assert "knows" in msg(["media_player.tv"])
    house.set(LOFT, "unavailable")
    assert msg([LOFT]) == "Loft Room is unavailable right now."
    assert "no playlist" in msg([OFF], "nope") and "no playlist" in msg([OFF], "pl_empty")
    fail, pl = E.check_play(house, cfg, [OFF], "pl_country")
    assert fail is None and pl.name == "Country"
    assert house.calls == []


def test_a_preset_plays_through_its_group_unless_the_group_is_gone(house, cfg):
    fail, p, members = E.play_rooms(house, cfg, [LR, K])
    assert fail is None and p.group == DOWNG and members == DOWN
    assert E.play_rooms(house, cfg, [OFF, LOFT]) == (None, None, [OFF, LOFT])
    house.set(DOWNG, "unavailable")
    assert "Downstairs is unavailable" in E.play_rooms(house, cfg, DOWN)[0]["message"]


def test_a_link_gone_from_the_library_is_found(cfg):
    pl = cfg.playlist("pl_country")
    wanted = E.library_links(pl.items + ["apple_music://playlist/x"])
    assert wanted == pl.items
    assert E.missing(wanted, [{"uri": "library://playlist/124"}]) == ["library://playlist/150"]
    assert "no longer in the music library" in E.gone_from_library(pl)["message"]


# ------------------------------------------------------------- grouping
def test_what_is_in_the_way_and_nothing_wider(house, cfg):
    house.group(K, [LR])                    # somebody's music elsewhere
    assert E.in_the_way(house, cfg, [OFF, LOFT]) == []
    house.group(OFF, [EXTRA])
    assert sorted(E.in_the_way(house, cfg, [OFF, LOFT])) == sorted([OFF, EXTRA])
    # the preset's own sync group is left standing
    house.group(K, [LR])
    assert E.in_the_way(house, cfg, DOWN, keep=set(DOWN)) == []
    assert E.entangled(house, cfg, [OFF]) == {OFF, EXTRA}


def test_a_group_playing_on_in_rooms_not_picked_keeps_its_music(house, cfg):
    house.group(LR, [K])
    house.set(LR, "playing")
    way = E.in_the_way(house, cfg, [K, OFF])
    assert E.split(house, cfg, way, {K, OFF}) == [(LR, [LR], [LR, K])]
    house.set(LR, "idle")
    assert E.split(house, cfg, way, {K, OFF}) == [], "not playing: simply released"


def test_who_leads_is_the_live_group_whatever_the_tap_order(house, cfg):
    house.group(OFF, [LOFT])
    target, found, way = E.play_target(house, cfg, [LOFT, OFF], None, [LOFT, OFF])
    assert (target, found, way) == (OFF, [OFF, LOFT], [])
    assert not E.needs_join([LOFT, OFF], None, found)
    target, found, way = E.play_target(house, cfg, [EXTRA, K], None, [EXTRA, K])
    assert target == EXTRA and found is None and E.needs_join([EXTRA, K], None, found)
    p = cfg.preset_for_rooms(DOWN)
    assert E.play_target(house, cfg, DOWN, p, DOWN)[0] == DOWNG and not E.needs_join(DOWN, p, None)


# ------------------------------------------------------------- moving music
def test_transfer_refusals(house, cfg):
    assert "not playing" in E.check_transfer(house, cfg, [LOFT], OFF)[0]["message"]
    house.set(OFF, "playing")
    assert E.check_transfer(house, cfg, [OFF], OFF)[0]["message"] == "The music is already there."
    assert "knows" in E.check_transfer(house, cfg, [LOFT], "media_player.tv")[0]["message"]
    house.set(DOWNG, "playing")
    assert "already on Downstairs" in E.check_transfer(house, cfg, DOWN, DOWNG)[0]["message"]
    # the leader alone, while it leads a group: let the others go
    house.group(OFF, [LOFT])
    assert E.check_transfer(house, cfg, [OFF], OFF) == (None, None)


def test_a_move_plans_its_leader_and_what_it_leaves_behind(house, cfg):
    house.set(OFF, "playing", media_content_id="q1")
    assert E.move_plan(house, [LOFT, OFF], OFF, None) == (OFF, [LOFT], True), "add: no queue moves"
    assert E.move_plan(house, [LOFT, EXTRA], OFF, None) == (LOFT, [EXTRA], False)
    assert E.move_plan(house, DOWN, OFF, cfg.preset_for_rooms(DOWN)) == (DOWNG, [], False)
    assert E.transfer_rooms(house, cfg, [LOFT], OFF) == {LOFT, OFF}
    assert not E.arrived(house, LOFT, "q1")
    house.set(LOFT, "playing", media_content_id="other")
    assert not E.arrived(house, LOFT, "q1"), "playing something else is not the queue we moved"
    house.set(LOFT, "playing", media_content_id="q1")
    assert E.arrived(house, LOFT, "q1")
    house.group(OFF, [EXTRA])
    assert E.stale(house, cfg, [LOFT], LOFT, OFF) == [OFF, EXTRA]
    assert E.stale(house, cfg, DOWN, DOWNG, OFF) == [], "a preset's rooms belong to its group"
    house.group(LOFT, [EXTRA])
    assert E.already_moved(house, LOFT, [EXTRA])
    # a preset's rooms picked while a room among them plays: the others join that room, its queue stays
    house.group(OFF, [OFF])
    every = cfg.preset_for_rooms(ROOMS)
    assert E.move_plan(house, ROOMS, OFF, every, cfg) == (OFF, [K, LR, LOFT, EXTRA], True)
    assert E.stale(house, cfg, ROOMS, OFF, OFF) == []


def test_new_speakers_for_a_group_that_plays_update_it_in_place(house, cfg):
    """Downstairs playing, Everywhere picked: its queue moved to Everywhere's group, which Music Assistant had
    left with no members, and the music stopped (2026-11-01). Rooms that share one with the group playing
    join it and leave it instead; nothing moves its queue."""
    house.set(DOWNG, "playing", supported_features=GROUPING, group_members=[K, LR])
    house.group(K, [LR])
    assert E.update_plan(house, cfg, [K, LR, OFF], DOWNG) == ([OFF], []), "added: it joins"
    assert E.update_plan(house, cfg, [K], DOWNG) == ([], [LR]), "unticked: it leaves"
    assert E.update_plan(house, cfg, [LR, OFF, LOFT], DOWNG) == ([OFF, LOFT], [K]), "its leader too"
    # a preset sharing rooms with it: the preset's other rooms join the group playing
    every = cfg.preset_for_rooms(ROOMS)
    assert E.check_transfer(house, cfg, ROOMS, DOWNG) == (None, every)
    assert E.update_plan(house, cfg, ROOMS, DOWNG) == ([OFF, LOFT, EXTRA], [])
    # no room shared: the queue moves (move_plan's)
    assert E.update_plan(house, cfg, [OFF, LOFT], DOWNG) is None
    # a group that cannot take members, and a room (move_plan adds to a room): not this
    house.set(DOWNG, supported_features=0)
    assert E.update_plan(house, cfg, ROOMS, DOWNG) is None
    house.set(OFF, "playing", supported_features=GROUPING)
    assert E.update_plan(house, cfg, [OFF, LOFT], OFF) is None


def test_a_presets_group_is_made_its_rooms_again_before_it_plays(house, cfg):
    """A group with dynamic members gives up rooms that play elsewhere (Everywhere's held none: Music Assistant
    cannot play an empty group) and keeps rooms added to it while it played."""
    down = cfg.preset_for_rooms(DOWN)
    assert E.preset_plan(house, cfg, down) == ([], []), "a group that cannot take members: as it is"
    house.set(DOWNG, "idle", supported_features=GROUPING, group_members=[])
    assert E.preset_plan(house, cfg, down) == (DOWN, [])
    house.set(DOWNG, "playing", group_members=[K, LR, OFF])
    house.group(K, [LR, OFF])
    assert E.preset_plan(house, cfg, down) == ([], [OFF])
    # its own rooms are not in its way while it holds the Office: the Office is taken out instead
    target, found, way = E.play_target(house, cfg, DOWN, down, DOWN)
    assert target == DOWNG and way == []


# ------------------------------------------------------------- the rest
def test_newest_request_wins():
    claims = E.Claims()
    first = claims.claim([K, LR])
    other = claims.claim([OFF])
    assert not claims.superseded(first) and not claims.superseded(other)
    claims.claim([LR])
    assert claims.superseded(first) and not claims.superseded(other)


def test_stop_and_the_buttons(house, cfg):
    assert E.stop_plan(cfg, None) == (True, cfg.room_ids)
    assert E.stop_plan(cfg, [OFF, "media_player.tv"]) == (False, [OFF])
    assert E.stop_plan(cfg, ["media_player.tv"])[1] == []
    assert E.stop_groups(cfg, True) == [EVERY, DOWNG] and E.stop_groups(cfg, False) == []
    assert E.new_volume("volume_up", 0.98, None, 0.35) == 1.0
    assert E.new_volume("volume_down", 0.02, None, 0.35) == 0.0
    assert E.new_volume("volume_up", None, None, 0.35) == 0.05
    assert E.new_volume("volume_set", 0.9, None, 0.35) == 0.35
    assert E.new_volume("volume_set", 0.9, 0.555, 0.35) == 0.56
    assert E.check_player(cfg, DOWNG) is None and E.check_player(cfg, "media_player.tv")["ok"] is False
    house.set(OFF, "unavailable")
    assert "unavailable" in E.check_browse(house, cfg, OFF)["message"]
    assert E.browse_rooms(house, cfg, DOWNG) == set(DOWN)
    assert house.calls == []


# ------------------------------------------------------------- the forms and the settings page
def test_the_shared_checks():
    assert checks.speakers_errors([], []) == {"speakers": "no_speakers"}
    assert checks.speakers_errors([K, DOWNG], [DOWNG]) == {"speakers": "group_is_room"}
    assert checks.preset_errors("", DOWNG, DOWN, ROOMS) == {"name": "no_name"}
    assert checks.preset_errors("D", K, DOWN, ROOMS) == {"group": "group_is_room"}
    assert checks.preset_errors("D", DOWNG, ["media_player.tv"], ROOMS) == {"members": "not_a_speaker"}
    assert checks.playlist_errors("P", ["library://playlist/9"], {"library://playlist/1"}) == {"items": "not_in_library"}
    assert checks.playlist_errors("P", ["library://playlist/9"], None) == {}, "an unreadable library refuses nothing"


def test_settings_changes_are_checked_by_field(house):
    opts = {CONF_SPEAKERS: [K, OFF], CONF_VOLUME: 0.35, CONF_HOMES: {"u1": OFF, "u2": K}}
    players = {K, OFF, LOFT, DOWNG}
    new, errors = S.apply(opts, {CONF_SPEAKERS: [K, LOFT, K], CONF_VOLUME: 0.456}, players, [DOWNG])
    assert errors == {} and new[CONF_SPEAKERS] == [K, LOFT] and new[CONF_VOLUME] == 0.46
    assert new[CONF_HOMES] == {"u2": K}, "a home that is no longer a speaker is no home"
    assert opts[CONF_SPEAKERS] == [K, OFF], "the stored options are not changed in place"
    _, errors = S.apply(opts, {"nope": 1, CONF_VOLUME: True, CONF_KEEP_READY: "yes",
                               CONF_SPEAKERS: [DOWNG], CONF_HOMES: {"u1": LOFT}}, players, [DOWNG])
    assert errors == {"nope": S.MSG["unknown"], CONF_VOLUME: S.MSG["volume"], CONF_KEEP_READY: S.MSG["on_off"],
                      CONF_SPEAKERS: S.MSG["group_is_room"], CONF_HOMES: S.MSG["homes"]}
    new, _ = S.apply(opts, {CONF_HOMES: {"u1": None, "u3": K}}, players, [])
    assert new[CONF_HOMES] == {"u2": K, "u3": K}


def test_a_preset_save_asks_for_the_players_only_when_it_must():
    asked = []

    def players():
        asked.append(1)
        return {DOWNG}
    assert S.check_preset("", DOWNG, DOWN, ROOMS, players) == {"name": S.MSG["no_name"]} and not asked
    assert S.check_preset("x" * 61, DOWNG, DOWN, ROOMS, players) == {"name": S.MSG["text"]} and not asked
    assert S.check_preset("D", K, DOWN, ROOMS, players) == {"group": S.MSG["group_room"]}
    assert S.check_preset("D", EVERY, DOWN, ROOMS, players) == {"group": S.MSG["not_a_player"]} and asked
    assert S.check_preset("D", DOWNG, DOWN, ROOMS, players) == {}


def test_a_playlist_save_goes_last_or_keeps_its_place():
    title, data = S.playlist_save("Jazz", "", ["library://playlist/1"], None, None, None, [10.0, 30.0])
    assert title == "Jazz" and data == {"name": "Jazz", "icon": "mdi:playlist-music",
                                        "items": ["library://playlist/1"], "order": 40.0}
    old = {"name": "Old", "icon": "hk:star", "items": [], CONF_ORDER: 20}
    title, data = S.playlist_save("1980s", "Decades", ["library://playlist/2"], " ", None, old, [99.0])
    assert title == "Decades · 1980s" and data["order"] == 20.0 and data["icon"] == "hk:star"
    assert data["chooser"] == "Decades"
    assert S.playlist_save("A", "", [], None, 5, old, [])[1]["order"] == 5.0
    assert S.check_playlist("A", "c" * 61, ["library://playlist/1"], None) == {"chooser": S.MSG["text"]}
    assert S.reorder([10, 0, 30, None]) == [(1, 20.0), (3, 40.0)]


# ------------------------------------------------------------- Keep Playlists Ready
class LoginFailed(Exception):
    """music_assistant_models.errors.LoginFailed, as both hosts' clients raise it: its error_code."""
    error_code = 6


class Mass:
    def __init__(self, clock, songs=None, took=None, recent=(), builtin=(), signed_out=()):
        self.clock, self.sent = clock, []
        self.songs, self.took, self.recent, self.builtin = songs or {}, took or {}, list(recent), set(builtin)
        self.signed_out = set(signed_out)

    async def send_command(self, command, **kw):
        self.sent.append((command, kw))
        if command == "music/recently_played_items":
            return [{"item_id": i, "provider": "library"} for i in self.recent]
        if command == "music/playlists/library_items":
            ids = set(self.songs) | set(self.recent) | self.builtin
            return [{"item_id": i, "provider_mappings": [
                {"provider_domain": "builtin" if i in self.builtin else "apple_music"}]} for i in ids]
        if command == "music/playlists/playlist_tracks":
            if kw["item_id"] in self.signed_out:
                raise LoginFailed("Login failed. Please check your credentials and try again.")
            self.clock.t += self.took.get(kw["item_id"], 1.5)
            return [{}] * self.songs.get(kw["item_id"], 25)
        raise AssertionError(command)


class Clock:
    def __init__(self):
        self.t, self.slept = 1000.0, []

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.slept.append(round(s, 1))
        self.t += s


def _warmer(mass, clock, pills):
    w = Warmer(lambda: list(pills))
    w.server = lambda: mass
    w.clock, w.sleep = clock, clock.sleep
    return w


def _refreshed(mass):
    return [kw["item_id"] for c, kw in mass.sent if c == "music/playlists/playlist_tracks"]


def test_a_round_refreshes_the_pills_then_the_recent_gently():
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 25}, recent=["124", "137", "4"], builtin={"4"})
    w = _warmer(mass, clock, ["library://playlist/147", "library://playlist/124", "apple_music://playlist/x"])
    w.used()
    clock.t += 30
    assert asyncio.run(w.round()) == WARM_EVERY
    assert _refreshed(mass) == ["147", "124", "137"], "pills first, no repeats, MA's own left alone"
    assert clock.slept == [WARM_QUIET - 30, WARM_GAP, WARM_GAP], "waits out the Music page, then one at a time"
    assert w.status()["ready"] == 3 and w.status()["note"] is None


def test_apple_refusing_cuts_a_round_short_and_the_next_picks_up():
    clock = Clock()
    mass = Mass(clock, songs={"1": 25, "2": 100, "3": 25}, took={"2": WARM_SLOW_PAGE + 1})
    w = _warmer(mass, clock, [f"library://playlist/{i}" for i in "123"])
    assert asyncio.run(w.round()) == WARM_RETRY and "busy" in w.status()["note"]
    clock.t += WARM_RETRY
    mass.took = {}
    assert asyncio.run(w.round()) == WARM_EVERY
    assert _refreshed(mass) == ["1", "2", "3"]


def test_a_refused_sign_in_is_named_and_the_round_goes_on():
    # Apple Music's user token expired: the account's own playlists are refused (MA's LoginFailed), a catalog
    # playlist saved to the library still refreshes; the settings page says to sign in again
    clock = Clock()
    mass = Mass(clock, songs={"1": 25, "2": 25, "3": 25}, signed_out={"1", "3"})
    w = _warmer(mass, clock, [f"library://playlist/{i}" for i in "123"])
    assert asyncio.run(w.round()) == WARM_EVERY
    assert _refreshed(mass) == ["1", "2", "3"]
    assert w.status()["ready"] == 1 and "sign in to it again" in w.status()["note"].lower()
    mass.signed_out = set()                                   # signed in again: the next round is clean
    clock.t += WARM_EVERY
    asyncio.run(w.round())
    assert w.status()["ready"] == 3 and w.status()["note"] is None


def test_without_music_assistant_a_round_says_so():
    w = Warmer(lambda: ["library://playlist/1"])
    assert asyncio.run(w.round()) == WARM_RETRY
    assert w.status()["ready"] == 0 and "Music Assistant" in w.status()["note"]


# ------------------------------------------------------------- the queue and announcements
def test_a_queue_item_as_the_page_reads_it():
    assert queue.item({"queue_item_id": "a1", "duration": 115, "media_item": {
        "name": "Toucanet", "artists": [{"name": "Noflik"}], "image": {"path": "https://img/x.jpg"}}}) == {
        "id": "a1", "title": "Toucanet", "artist": "Noflik", "duration": 115, "image": "https://img/x.jpg"}
    assert queue.item({"name": "Motmot", "image": "/local/x.jpg"})["image"] is None
    assert queue.item(object()) == {"id": None, "title": "", "artist": "", "duration": None, "image": None}


def test_which_calls_are_announcements_and_what_they_hide(cfg):
    assert A.announced("tts", "speak", {"media_player_entity_id": f"{K}, {OFF}"}) == [K, OFF]
    assert A.announced("tts", "google_say", {"entity_id": [K, 3]}) == [K]
    assert A.announced("media_player", "play_media", {"entity_id": K, "announce": True}) == [K]
    assert A.announced("music_assistant", "play_announcement", {"entity_id": K}) == [K]
    assert A.announced("media_player", "play_media", {"entity_id": K}) == []
    assert A.released("media_player", "media_play", {"entity_id": K}) == [K]
    assert A.released("media_player", "play_media", {"entity_id": K, "announce": True}) == []
    assert A.hidden(cfg, DOWNG, {DOWNG}) == {DOWNG, *DOWN}
    assert A.hidden(cfg, "media_player.porch", {"media_player.porch"}) is None
    assert A.hidden(cfg, "tts.piper", {K}) is None
    assert A.content(State(K, "playing", {"media_title": "Song"})) == (None, "Song", None)
    assert A.content(State(K, "idle", {"media_title": "Song"})) is None


# ------------------------------------------------------------- Music Assistant's groups: pairs
# The Office is a STEREO PAIR (2026-10-30): a Music Assistant group of two HomePods hidden from the
# house, picked as one speaker. The presets' groups hold its two players themselves.
from hk_core.music import groups as G  # noqa: E402

PIDS = {K: "ap_k", LR: "ap_lr", OFF: "sg_office", LOFT: "ap_loft", EXTRA: "ap_x",
        DOWNG: "sg_down", EVERY: "sg_every", "media_player.half": "sg_half"}


def ma(*players):
    return [{"player_id": pid, "display_name": name, "type": kind, "group_members": list(members)}
            for pid, name, kind, members in players]


MA_PLAYERS = ma(
    ("ap_k", "Kitchen HomePod", "player", []), ("ap_lr", "Living Room HomePod", "player", []),
    ("ap_loft", "Loft HomePod", "player", []), ("ap_x", "Extra HomePod", "player", []),
    ("ap_l", "Office Left HomePod", "player", []), ("ap_r", "Office Right HomePod", "player", []),
    ("ap_deck", "Deck Speaker", "player", []),
    ("sg_office", "Office HomePods", "group", ["ap_l", "ap_r"]),
    ("sg_down", "Downstairs", "group", ["ap_k", "ap_lr"]),
    # Everywhere holds the Office's two players, not its group (a group can't hold a group)
    ("sg_every", "HomePods", "group", ["ap_k", "ap_lr", "ap_r", "ap_l", "ap_loft", "ap_x"]),
    ("sg_half", "Half", "group", ["ap_l", "ap_loft", "ap_deck"]))


@pytest.fixture
def pcfg(house):
    """The house with Music Assistant's groups read: the presets' chosen rooms are stale on purpose."""
    opts = {CONF_SPEAKERS: list(ROOMS), CONF_VOLUME: 0.35, CONF_HOMES: {}}
    items = [preset("p_down", "Downstairs", DOWNG, [K]), preset("p_every", "Everywhere", EVERY, [K, LR]),
             preset("p_half", "Half", "media_player.half", [LOFT])]
    return MusicConfig.build(house, opts, items, library_entry="ma1", groups=G.Groups.read(MA_PLAYERS, PIDS))


def test_music_assistants_players_are_read_whatever_comes():
    got = G.read_players(MA_PLAYERS + [None, {"player_id": 5}, {"player_id": "x", "group_childs": ["a"], "type": "group"}])
    assert got["sg_office"].group and got["sg_office"].members == ("ap_l", "ap_r")
    assert got["x"].members == ("a",) and got["x"].name == "x"           # an older server's key, no name
    assert G.Groups.read(None, PIDS) is None and G.Groups.read({"no": 1}, PIDS) is None
    assert G.signature(MA_PLAYERS) == G.signature(list(reversed(MA_PLAYERS)))
    assert G.signature(MA_PLAYERS) != G.signature(MA_PLAYERS[:-1]) and G.signature(None) == ()


def test_a_speaker_that_is_a_group_is_a_pair(pcfg):
    assert pcfg.pairs == {OFF: ["Office Left HomePod", "Office Right HomePod"]}
    office = [s for s in pcfg.as_client(None)["speakers"] if s["entity"] == OFF][0]
    assert office["pair"] == ["Office Left HomePod", "Office Right HomePod"] and "members" not in office
    assert all("pair" not in s for s in pcfg.as_client(None)["speakers"] if s["entity"] != OFF)
    assert G.kind(["a", "b"]) == "stereo pair" and G.kind(["a", "b", "c"]) == "speaker group"


def test_a_presets_rooms_are_its_groups_with_the_pair_folded_back(pcfg):
    by = {p.key: p for p in pcfg.presets}
    # in the speakers' order, the Office's two players counted once, as the Office
    assert by["p_every"].members == [K, LR, OFF, LOFT, EXTRA] and by["p_every"].from_ma
    assert by["p_down"].members == [K, LR] and not by["p_down"].problems
    assert pcfg.preset_for_rooms([LOFT, OFF, K, LR, EXTRA]).key == "p_every"
    # half of the pair, and a player that is no speaker: said, and the rest still counted
    half = by["p_half"]
    assert half.members == [LOFT] and half.from_ma
    assert half.problems == [{"code": "part", "room": OFF, "in": ["Office Left HomePod"], "out": ["Office Right HomePod"]},
                             {"code": "not_a_speaker", "player": "Deck Speaker"}]
    words = S.preset_extra(pcfg, half)["problems"]
    assert words[0].startswith("Office Left HomePod is in this group without Office Right HomePod, so Study")
    assert "Deck Speaker is in this group but isn’t one of Music’s speakers" in words[1]


def test_without_music_assistants_groups_the_chosen_rooms_stand(house, cfg):
    assert cfg.pairs == {} and cfg.groups is None
    assert [p.members for p in cfg.presets] == [ROOMS, DOWN] and not any(p.from_ma for p in cfg.presets)
    # a group Music Assistant knows nothing of keeps its chosen rooms too
    g = G.Groups.read(ma(("ap_k", "Kitchen", "player", [])), {K: "ap_k"})
    built = MusicConfig.build(house, {CONF_SPEAKERS: list(ROOMS)}, ITEMS, groups=g)
    assert [p.members for p in built.presets] == [ROOMS, DOWN]


def test_a_pair_plays_alone_or_through_a_preset(house, pcfg):
    fail, preset_, rooms = E.play_rooms(house, pcfg, [K, OFF])
    assert preset_ is None and fail == {"ok": False, "message":
        "Study is a stereo pair, so it plays with other rooms only through a preset: Everywhere."}
    assert E.play_rooms(house, pcfg, [OFF]) == (None, None, [OFF])
    assert E.play_rooms(house, pcfg, [K, LR, OFF, LOFT, EXTRA])[0] is None
    assert E.play_rooms(house, pcfg, [K, LR]) [0] is None
    # moving music onto the pair and another room: the same refusal, before anything is sent
    house.set(K, "playing")
    fail, _ = E.check_transfer(house, pcfg, [OFF, LOFT], K)
    assert "Study is a stereo pair" in fail["message"]
    assert E.check_transfer(house, pcfg, [OFF], K) == (None, None)
    # a pair no preset holds all of
    lone = MusicConfig.build(house, {CONF_SPEAKERS: list(ROOMS)}, [], groups=G.Groups.read(MA_PLAYERS, PIDS))
    assert E.play_rooms(house, lone, [OFF, K])[0]["message"] == (
        "Study is a stereo pair, so it plays on its own, or with other rooms through a preset whose "
        "Music Assistant group holds all of it.")


def test_the_settings_page_says_what_music_assistant_has(pcfg):
    page = S.groups_page(pcfg, [DOWNG, EVERY, "media_player.half", OFF, K])
    assert page["ma_groups"] is True
    assert page["pairs"] == {OFF: {"parts": ["Office Left HomePod", "Office Right HomePod"], "kind": "stereo pair"}}
    # every group a preset could use, never the pair itself, never a single player
    assert set(page["groups"]) == {DOWNG, EVERY, "media_player.half"}
    assert page["groups"][EVERY] == {"rooms": [K, LR, OFF, LOFT, EXTRA], "problems": []}
    assert len(page["groups"]["media_player.half"]["problems"]) == 2
    assert S.groups_page(MusicConfig(), [EVERY]) == {"ma_groups": False, "pairs": {}, "groups": {}}


# ------------------------------------------------------------- VIRTUAL PAIRS (docs/phase4/VIRTUAL-PAIRS.md)
# The Study's two HomePods made ONE room in Mantel, with no group in Music Assistant: the left is the room, the
# right plays with it. Music Assistant also has a group of exactly those two (the "Actual Group Pair"), and
# Everywhere's group holds both players.
from hk_core.music.const import CONF_PAIRS  # noqa: E402

SL, SR, DECK = "media_player.study_left", "media_player.study_right", "media_player.deck"
SG = "media_player.study_group"
VPIDS = {K: "ap_k", LR: "ap_lr", SL: "ap_sl", SR: "ap_sr", DECK: "ap_deck", SG: "sg_study", DOWNG: "sg_down",
         EVERY: "sg_every", "media_player.half": "sg_half"}
V_PLAYERS = ma(
    ("ap_k", "Kitchen HomePod", "player", []), ("ap_lr", "Living Room HomePod", "player", []),
    ("ap_sl", "Study Left HomePod", "player", []), ("ap_sr", "Study Right HomePod", "player", []),
    ("ap_deck", "Deck Speaker", "player", []),
    ("sg_study", "Study HomePods", "group", ["ap_sr", "ap_sl"]),
    ("sg_down", "Downstairs", "group", ["ap_k", "ap_lr"]),
    ("sg_every", "Everywhere", "group", ["ap_k", "ap_sr", "ap_lr", "ap_sl"]),
    ("sg_half", "Half", "group", ["ap_sl", "ap_k"]))
PAIR = {"players": [SL, SR], "name": ""}


def vbuild(house, players=V_PLAYERS, name="", items=None, speakers=(K, SL, LR)):
    for e in (SL, SR, DECK, SG):
        if house.state(e) is None:
            house.set(e, "idle", group_members=[], volume_level=0.3, friendly_name=e.split(".")[1].title())
    house._entities.update({SL: Entity(SL, area_id="office"), SR: Entity(SR, area_id="office")})
    opts = {CONF_SPEAKERS: list(speakers), CONF_VOLUME: 0.35, CONF_HOMES: {}, CONF_PAIRS: [dict(PAIR, name=name)]}
    items = items if items is not None else [preset("p_every", "Everywhere", EVERY, [K]),
                                             preset("p_down", "Downstairs", DOWNG, DOWN)]
    groups = G.Groups.read(players, VPIDS) if players is not None else None
    return MusicConfig.build(house, opts, items, library_entry="ma1", groups=groups)


def test_a_virtual_pair_is_one_room_its_second_player_folded_in(house):
    v = vbuild(house)
    assert v.room_ids == [K, SL, LR] and v.partners == {SL: SR}
    assert v.name_of(SL) == "Study" and v.name_of(SR) == "Study", "named by its first player's area"
    assert vbuild(house, name="Reading Nook").name_of(SL) == "Reading Nook", "or the name it was given"
    assert v.room_of(SR) == SL and v.room_of(SL) == SL and v.room_of(DECK) is None
    assert v.fold([K, SL, SR, DECK]) == [K, SL, DECK], "a group's members as rooms; other players stay"
    assert v.players_of([K, SL]) == [K, SL, SR]
    # one speaker on every screen, its two players said so the screens fold the second into it
    speakers = [s for s in v.as_client(None)["speakers"] if "members" not in s]
    assert [s["entity"] for s in speakers] == [K, SL, LR]
    assert speakers[1] == {"name": "Study", "entity": SL, "parts": [SL, SR]}
    # a request's steps may name the second player and the pair's own group; a command may not
    assert SR in v.ma_players() and SG in v.ma_players() and SR not in v.players()
    assert E.check_player(v, SR)["message"] == f"{SR} is not a speaker this house knows."
    assert "knows" in E.validate(house, v, [SR])["message"]


def test_music_assistants_own_group_of_the_two_is_found_and_presets_fold_the_pair(house):
    v = vbuild(house)
    g = G.Groups.read(V_PLAYERS, VPIDS)
    assert g.group_of([SL, SR]) == SG and g.group_of([SR, SL]) == SG and g.group_of([K]) is None
    assert g.group_of([SL, "media_player.unknown"]) is None
    assert v.pair_groups == {SL: SG} and v.name_of(SG) == "Study"
    by = {p.key: p for p in v.presets}
    assert by["p_every"].members == [K, SL, LR] and by["p_every"].from_ma and not by["p_every"].problems
    half = vbuild(house, items=[preset("p_half", "Half", "media_player.half", [K])]).presets[0]
    assert half.members == [K] and half.problems == [
        {"code": "part", "room": SL, "in": ["Study Left HomePod"], "out": ["Study Right HomePod"]}]
    # without Music Assistant's players: still one room, joined at play time, no group of its own
    assert vbuild(house, players=None).pair_groups == {} and vbuild(house, players=None).partners == {SL: SR}


def test_the_pair_alone_plays_through_its_own_group_else_both_players_join(house):
    v = vbuild(house)
    fail, p, members = E.play_rooms(house, v, [SL])
    assert fail is None and p.group == SG and p.key == f"pair:{SL}" and members == [SL]
    assert E.play_target(house, v, [SL], p, members)[0] == SG
    assert not E.needs_join([SL], p, None, v)
    assert p not in v.presets and all("pair:" not in s["entity"] for s in v.as_client(None)["speakers"])
    # its group gone, or none in Music Assistant: the two players are joined, the first leading
    house.set(SG, "unavailable")
    for vv in (v, vbuild(house, players=V_PLAYERS[:5])):
        fail, p, members = E.play_rooms(house, vv, [SL])
        assert fail is None and p is None and members == [SL]
        target, found, way = E.play_target(house, vv, [SL], None, [SL])
        assert target == SL and found is None and way == []
        assert E.needs_join([SL], None, None, vv)
    # already joined: nothing to do
    house.group(SL, [SR])
    v2 = vbuild(house, players=V_PLAYERS[:5])
    assert E.existing(house, [SL], v2) == [SL, SR] and not E.needs_join([SL], None, [SL, SR], v2)
    assert E.in_the_way(house, v2, [SL]) == [], "the pair's own two players are not a group in its way"


def test_the_pair_with_another_room_joins_both_its_players_and_stops_its_own_group(house):
    v = vbuild(house)
    fail, p, members = E.play_rooms(house, v, [K, SL])
    assert fail is None and p is None, "a virtual pair is never refused with other rooms"
    target, found, way = E.play_target(house, v, [K, SL], None, members)
    assert target == K and found is None and E.needs_join([K, SL], None, None, v)
    assert v.players_of([K, SL]) == [K, SL, SR]
    # its own group playing holds its two players: stopped first, never when it is the target
    house.set(SG, "playing")
    assert E.groups_in_the_way(house, v, [K, SL], K) == [SG]
    assert E.groups_in_the_way(house, v, [SL], SG) == [] and E.groups_in_the_way(house, v, [K], K) == []
    # joined already, in either order: that group
    house.group(K, [SR, SL])
    assert E.existing(house, [SL, K], v) == [K, SR, SL]
    # the second player joined to somebody else's music: that group is in the way, and claimed
    house.group(K, [K]); house.group(SL, [SL]); house.group(SR, [SR])
    house.group(LR, [SR])
    assert E.in_the_way(house, v, [SL]) == [LR]
    assert LR in E.entangled(house, v, [SL])
    # the house volume, the slider and the steps: both players, together
    assert E.volume_players(v, [SL]) == [SL, SR] and E.volume_players(v, [K, SL]) == [K, SL, SR]


def test_a_move_off_the_pairs_own_group_hands_its_queue_to_another_room(house):
    v = vbuild(house)
    house.set(SG, "playing")
    assert E.source_of(house, v, SL) == SG and E.source_of(house, v, K) == K
    assert E.check_transfer(house, v, [K, SL], SG) == (None, None)
    assert E.transfer_rooms(house, v, [K], SG) >= {K, SL}
    # moving it to the Kitchen and the Study: the Kitchen leads, both of the Study's players join it
    assert E.move_plan(house, [SL, K], SG, None, v) == (K, [SL, SR], False)
    # moving it to the Kitchen alone: the pair's players are left behind and freed
    house.group(SL, [SR])
    assert E.stale(house, v, [K], K, SG) == [SL, SR]
    # the pair alone again, already on its group: there already
    assert E.check_transfer(house, v, [SL], SG)[0] == {"ok": False, "message": "The music is already on Study."}
    # its group quiet: the pair itself is the source, and adding a room adds both its players' room
    house.set(SG, "idle"); house.set(SL, "playing")
    assert E.source_of(house, v, SL) == SL
    assert E.move_plan(house, [SL, K], SL, None, v) == (SL, [SR, K], True)
    # a group that takes members, playing the Kitchen: the pair joins it with both its players, and leaves so
    house.set(SL, "idle"); house.group(SL, [SL]); house.group(SR, [SR])
    house.set(DOWNG, "playing", supported_features=GROUPING, group_members=[K])
    assert E.update_plan(house, v, [K, SL], DOWNG) == ([SL, SR], [])
    house.set(DOWNG, group_members=[K, SL, SR])
    assert E.update_plan(house, v, [K], DOWNG) == ([], [SL, SR])
    house.set(SG, "playing", supported_features=GROUPING)
    assert E.update_plan(house, v, [K, SL], SG) is None, "the pair's own group plays the pair alone"
    # Stop on the pair stops its own group too; Stop All every pair's group and preset's
    assert E.stop_groups(v, False, [SL]) == [SG] and E.stop_groups(v, False, [K]) == []
    assert E.stop_groups(v, True) == [EVERY, DOWNG, SG]


def test_browse_on_the_pair_plays_as_one(house):
    v = vbuild(house)
    assert E.browse_target(house, v, SL) == (SG, []), "through its own group"
    assert E.browse_target(house, v, K) == (K, [])
    nog = vbuild(house, players=V_PLAYERS[:5])
    assert E.browse_target(house, nog, SL) == (SL, [SR]), "else its second player joined first"
    house.group(SL, [SR])
    assert E.browse_target(house, nog, SL) == (SL, [])
    house.group(SL, [SR, K])
    assert E.browse_target(house, v, SL) == (SL, []), "with other rooms: where it plays"
    assert E.browse_rooms(house, v, SL) >= {SL, K}


def test_the_settings_make_and_take_apart_a_pair(house):
    players = {K, LR, SL, SR, DECK, SG, DOWNG}
    opts = {CONF_SPEAKERS: [K, SR, LR], CONF_HOMES: {"u1": SR, "u2": K}}
    got, err = S.apply(opts, {CONF_PAIRS: [{"players": [SL, SR], "name": " Study Pair "}]}, players, [DOWNG], pairs=True)
    assert err == {}
    # one speaker, in the place of the first of the two that was one; a home on the second moves to the room
    assert got[CONF_SPEAKERS] == [K, SL, LR] and got[CONF_HOMES] == {"u1": SL, "u2": K}
    assert got[CONF_PAIRS] == [{"players": [SL, SR], "name": "Study Pair"}]
    # the second player can't come back as a speaker of its own while it is paired
    assert S.apply(got, {CONF_SPEAKERS: [K, SL, SR]}, players, [DOWNG], pairs=True)[1] == {
        CONF_SPEAKERS: S.MSG["pair_part"]}
    # taken apart: the second player is a speaker again, just after the first
    back, err = S.apply(got, {CONF_PAIRS: []}, players, [DOWNG], pairs=True)
    assert err == {} and back[CONF_SPEAKERS] == [K, SL, SR, LR] and back[CONF_PAIRS] == []
    # the room taken off the speakers takes its pair with it
    gone, err = S.apply(got, {CONF_SPEAKERS: [K, LR]}, players, [DOWNG], pairs=True)
    assert err == {} and gone[CONF_PAIRS] == [] and gone[CONF_SPEAKERS] == [K, LR]
    # the refusals, by field
    def refused(pairs, **kw):
        return S.apply(opts, {CONF_PAIRS: pairs}, players, [DOWNG], **{"pairs": True, **kw})[1][CONF_PAIRS]
    assert refused([{"players": [SL, SL]}]) == S.MSG["pair_two"]
    assert refused([{"players": [SL]}]) == S.MSG["pair_two"]
    assert refused([{"players": [SL, "media_player.nope"]}]) == S.MSG["not_a_player"]
    assert refused([{"players": [SL, DOWNG]}]) == S.MSG["pair_group"]
    assert refused([{"players": [SL, SG]}], ma_groups=[SG]) == S.MSG["pair_group"]
    assert refused([{"players": [SL, SR]}, {"players": [K, SR]}]) == S.MSG["pair_twice"]
    assert refused([{"players": [SL, SR], "name": "x" * 61}]) == S.MSG["text"]
    assert refused("no") == S.MSG["list"] and refused([{"players": [SL, 5]}]) == S.MSG["list"]
    # a host whose engine doesn't play pairs (HK Frontend in Home Assistant) refuses them
    assert S.apply(opts, {CONF_PAIRS: []}, players, [DOWNG])[1] == {CONF_PAIRS: S.MSG["no_pairs"]}


def test_the_settings_page_lists_the_pairs_and_their_own_group(house):
    v = vbuild(house, name="Reading Nook")
    opts = {CONF_SPEAKERS: [K, SL, LR], CONF_PAIRS: [{"players": [SL, SR], "name": "Reading Nook"}]}
    names = {SL: "Study Left HomePod", SR: "Study Right HomePod", SG: "Study HomePods"}
    assert S.pairs_page(v, opts, lambda e: names.get(e, e)) == [{
        "room": SL, "name": "Reading Nook", "shown": "Reading Nook",
        "players": [{"entity": SL, "name": "Study Left HomePod"}, {"entity": SR, "name": "Study Right HomePod"}],
        "ma_group": "Study HomePods"}]
    # unreadable or overlapping pairs are left out, never a failure
    from hk_core.music.config import virtual_pairs
    assert virtual_pairs({CONF_PAIRS: [{"players": [SL, SR]}, {"players": [SR, K]}, {"players": [K]}, "x"]}) == [
        {"players": [SL, SR], "name": ""}]


async def test_a_dynamic_groups_rooms_are_the_ones_its_settings_name():
    """Its members now change as it plays; its settings keep its rooms. One that cannot be read keeps what it holds."""
    raw = [{"player_id": "sg1", "type": "group", "supported_features": ["set_members"], "group_members": []},
           {"player_id": "sg2", "type": "group", "supported_features": [], "group_members": ["a"]},
           {"player_id": "sg3", "type": "group", "supported_features": ["set_members"], "group_members": ["b"]},
           {"player_id": "a", "type": "player", "supported_features": ["set_members"], "group_members": []}]
    asked = []

    async def read(pid):
        asked.append(pid)
        if pid == "sg3":
            raise ConnectionError
        return {"values": {"group_members": {"key": "group_members", "value": ["a", "b"]}}}
    got = await G.with_configured(raw, read)
    assert asked == ["sg1", "sg3"], "only the groups whose members change"
    assert [p["group_members"] for p in got] == [["a", "b"], ["a"], ["b"], []]
    assert raw[0]["group_members"] == [], "the list read is left as it was"
    assert G.configured_members({"values": {}}) is None and G.configured_members(None) is None
