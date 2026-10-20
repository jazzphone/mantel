"""hk_core.music against a fake House: the music engine's decisions run once here, for every host.

The HA build runs the same code through hosts/ha's HaHouse (tests/py/test_feature_music_*.py),
with HA's state machine, registries and its media players behind it. Nothing here sends
anything: the fake House refuses every service call, and Keep Playlists Ready talks to a fake
Music Assistant client that only answers.
"""
import asyncio

import pytest

from hk_core.house import Device, Entity, Floor, State
from hk_core.music import announcements as A, checks, engine as E, queue, settings as S
from hk_core.music.config import Item, MusicConfig
from hk_core.music.const import (
    CONF_HOMES, CONF_KEEP_READY, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME, SUB_PLAYLIST, SUB_PRESET, WARM_EVERY,
    WARM_GAP, WARM_QUIET, WARM_RETRY, WARM_SLOW_PAGE,
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
