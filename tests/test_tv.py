"""TVs (phase 23; hk_core/tv.py, mantel_server/tv.py): what Accessories -> TVs may save, the apps an Apple TV opens counted and shared
as Mantel's own sensor, the input a room's player is on learned as it wakes its TV, an icon looked up once on Apple's host only and
never for Apple's own apps or with lookups off, and the icon served to signed-in screens; an app nobody has opened gets an icon
guessed by its name, dropped when it opens as another app."""
import pytest

import gateway_fakes as GF
from hk_core import tv as T
from hk_core.settings import changes as C
from mantel_server.settings_store import Actor as SettingsActor

gw = GF.gw          # (the fixture, by name)
TV, ATV = "media_player.bedroom_tv", "media_player.bedroom_apple_tv"
YTV = "com.google.ios.youtubeunplugged"


# -- the rules ---------------------------------------------------------------------------------------------------------------------
def test_a_tvs_wiring_saves_what_automatic_cant_and_refuses_the_rest():
    got = T.tv_sets([{"tv": TV, "player": ATV, "input": "HDMI 1", "volume": "tv", "hidden": ["HDMI 3", "HDMI 3", "AV"]},
                     {"tv": "media_player.deck_tv"}, {"tv": "media_player.den_tv", "volume": "auto"}])
    # (a TV with nothing set, or Automatic, is left out; hidden inputs once each)
    assert got == [{"tv": TV, "player": ATV, "input": "HDMI 1", "volume": "tv", "hidden": ["HDMI 3", "AV"]}]
    assert T.tv_sets([{"tv": TV, "player": "none", "volume": "media_player.receiver"}]) == [
        {"tv": TV, "player": "none", "volume": "media_player.receiver"}]
    for bad in ([{"tv": "light.x"}], [{"tv": TV, "volume": "loud"}], [{"tv": TV, "input": ""}], [{"tv": TV, "extra": 1}],
                [{"tv": TV}, {"tv": TV}], {"tv": TV}, [{"tv": TV, "hidden": "HDMI 1"}]):
        with pytest.raises(T.Invalid):
            T.tv_sets(bad)
    assert T.favorites(["YouTube TV", "Netflix", "YouTube TV"]) == ["YouTube TV", "Netflix"]
    with pytest.raises(T.Invalid):
        T.favorites(["x" * 61])
    with pytest.raises(T.Invalid):
        T.show("all")


def test_the_settings_page_writes_them_through_the_house_settings():
    # (each key's own check, its refusal as the page's code)
    assert C.HOUSE["features.tv_show"]("favorites") == "favorites"
    assert C.HOUSE["features.tv_icons"](False) is False
    with pytest.raises(C.Invalid) as e:
        C.HOUSE["features.tv_sets"]([{"tv": "switch.x"}])
    assert e.value.code == "tv_set"


def test_an_app_opened_counts_and_the_most_used_come_first():
    on = lambda app, name="YouTube TV": {"s": "playing", "a": {"app_id": app, "app_name": name}}   # noqa: E731
    assert T.opened({"s": "off", "a": {}}, on(YTV)) == (YTV, "YouTube TV")
    assert T.opened(on(YTV), on(YTV)) is None                       # (the same app still open)
    assert T.opened(on(YTV), {"s": "off", "a": {"app_id": YTV}}) is None
    assert T.opened(on(YTV), on("com.netflix.Netflix", "Netflix")) == ("com.netflix.Netflix", "Netflix")
    assert T.opened(None, {"s": "on", "a": {"app_id": "not a bundle id!"}}) is None
    apps: dict = {}
    for app, name, at in ((YTV, "YouTube TV", 1), ("com.netflix.Netflix", "Netflix", 2), (YTV, "YouTube TV", 3),
                          ("com.apple.TVWatchList", "TV", 4)):
        T.count(apps, app, name, at)
    rows = T.ranked(apps)
    assert [r["name"] for r in rows] == ["YouTube TV", "TV", "Netflix"] and rows[0]["count"] == 2
    assert rows[1]["glyph"] == "hk:television" and "glyph" not in rows[0]


def test_icons_are_asked_for_once_a_week_never_for_apples_own_and_only_from_apples_host():
    assert T.wants_icon(YTV, {}, 1e9, True)
    assert not T.wants_icon(YTV, {}, 1e9, False)                    # (lookups off)
    assert not T.wants_icon(YTV, {"icon": True}, 1e9, True)
    assert not T.wants_icon(YTV, {"tried": 1e9 - 3600}, 1e9, True)
    assert not T.wants_icon("com.apple.TVWatchList", {}, 1e9, True)
    found = {"results": [{"artworkUrl512": "https://is1-ssl.mzstatic.com/image/thumb/x/512x512bb.jpg"}]}
    assert T.artwork(found) == "https://is1-ssl.mzstatic.com/image/thumb/x/512x512bb.jpg"
    assert T.artwork({"results": [{"artworkUrl512": "https://evil.example/icon.png"}]}) is None
    assert T.artwork({"results": []}) is None


def _r(title, bundle, genre="Entertainment", art="https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.png"):
    return {"trackName": title, "bundleId": bundle, "primaryGenreName": genre, "artworkUrl512": art}


def test_an_icon_is_guessed_by_the_closest_name_never_from_a_category_no_tv_app_is_in():
    # (shaped as the App Store search answered for this house's Apple TV, 2026-11-10)
    dusk = {"results": [_r("DUSK - Drinks, Deals & Rewards", "co.uk.drinki", "Food & Drink"), _r("Dusk.fm", "fm.dusk", "Music"),
                        _r("Dusk", "app.dusk", "Photo & Video")]}
    assert T.best_match("Dusk", dusk)["bundle"] == "app.dusk"                    # (the drinks app's name comes first, not its icon)
    plex = {"results": [_r("Plex: Find Movies and TV Shows", "com.plexapp.plex")]}
    assert T.best_match("Plex", plex) == {"bundle": "com.plexapp.plex", "art": "https://is1-ssl.mzstatic.com/image/thumb/a/512x512bb.png"}
    assert T.best_match("discovery+", {"results": [_r("discovery+ | Stream TV Shows", "com.discovery.plus")]})["bundle"] == "com.discovery.plus"
    assert T.best_match("Speedtest", {"results": [_r("Speedtest by Ookla", "com.ookla.speedtest", "Utilities")]})["bundle"] == "com.ookla.speedtest"
    tarot = {"results": [_r("Moonlight: Interactive Tarot", "world.moonlight", "Lifestyle"), _r("Moonlight", "moon.game", "Games")]}
    assert T.best_match("Moonlight", tarot)["bundle"] == "moon.game"
    assert T.best_match("Moon", {"results": [_r("Moonlight", "moon.game", "Games")]}) is None     # (a word, not part of one)
    assert T.best_match("Prime Video", {"results": [_r("Amazon Prime Video", "com.amazon.aiv")]}) is None
    assert T.best_match("YouTube", {"results": [_r("YouTube", "com.google.ios.youtube", art="https://evil.example/y.png")]}) is None
    assert T.best_match("YouTube", {"results": [{"trackName": "YouTube", "bundleId": "../etc", "artworkUrl512": "https://a.mzstatic.com/x"}]}) is None


def test_a_name_is_searched_once_a_week_never_apples_own_and_apples_own_get_glyphs():
    assert T.wants_guess("Netflix", None, 1e9, True)
    assert not T.wants_guess("Netflix", None, 1e9, False)                       # (lookups off)
    assert not T.wants_guess("Netflix", {"icon": True}, 1e9, True)
    assert not T.wants_guess("Netflix", {"tried": 1e9 - 3600}, 1e9, True)
    assert not T.wants_guess("Settings", None, 1e9, True) and not T.wants_guess("", None, 1e9, True)
    assert not T.wants_guess("App\u00a0Store", None, 1e9, True)                  # (as the Apple TV lists it, a no-break space)
    rows = {"Netflix": {"bundle": "com.netflix.Netflix", "icon": True}, "Dusk": {"tried": 5}}
    assert T.guesses(rows, ["Dusk", "Netflix", "Settings"]) == {
        "Netflix": {"id": "com.netflix.Netflix", "src": "/api/tv/icon/com.netflix.Netflix"}, "Settings": {"glyph": "hk:cog"}}


def test_a_players_tv_is_the_one_in_its_room():
    area = {ATV: "bedroom", TV: "bedroom", "media_player.den_tv": "den", "media_player.lost": None}
    assert T.tv_of(ATV, area, [TV, "media_player.den_tv"]) == TV
    assert T.tv_of("media_player.lost", area, [TV]) is None


# -- the server -------------------------------------------------------------------------------------------------------------------
class House:
    """A bedroom with an LG TV and an Apple TV, both off."""
    def __init__(self, gw):
        self.gw, self.hub, self.host = gw, gw.m.app["hub"], gw.m.app["tv"]
        ents = list(GF.HOUSE_ENTITIES) + [{"entity_id": TV, "device_id": "t1", "platform": "webostv"},
                                          {"entity_id": ATV, "device_id": "a1", "platform": "apple_tv"}]
        areas = list(GF.HOUSE_AREAS) + [{"area_id": "bedroom", "name": "Bedroom"}]
        self.hub.registry.load(areas, [{"id": "t1", "area_id": "bedroom"}, {"id": "a1", "area_id": "bedroom"}], ents)
        self.put(TV, "off", device_class="tv", source_list=["HDMI 1", "HDMI 2", "Live TV"])
        self.put(ATV, "standby")

    def put(self, eid, state, **attrs):
        old = self.hub.store.states.get(eid)
        a = dict((old or {}).get("a") or {})
        a.update(attrs)
        self.hub.store.states[eid] = {"s": state, "a": a, "lc": self.gw.now[0], "lu": self.gw.now[0]}
        self.hub.on_change({eid})

    @property
    def sensor(self):
        return self.hub.store.states[T.SENSOR]["a"]


async def test_the_apps_opened_are_counted_and_shared_for_every_screen(gw):
    h = House(gw)
    h.host.lookup = False                       # (no App Store from a test)
    h.put(ATV, "playing", app_id=YTV, app_name="YouTube TV")
    h.put(ATV, "paused")                        # (the same app: not again)
    h.put(ATV, "playing", app_id="com.netflix.Netflix", app_name="Netflix")
    h.put(ATV, "playing", app_id=YTV, app_name="YouTube TV")
    assert [(a["name"], a["count"]) for a in h.sensor["apps"]] == [("YouTube TV", 2), ("Netflix", 1)]
    assert T.SENSOR in h.hub.store.ours
    # kept across a restart
    assert h.host.store.apps()[YTV]["count"] == 2


async def test_the_input_the_player_is_on_is_learned_as_it_wakes_the_tv(gw):
    h = House(gw)
    h.host.lookup = False
    h.put(ATV, "on")                            # the Apple TV wakes ...
    gw.now[0] += 4
    h.put(TV, "on", source="HDMI 1")            # ... and its TV comes on at HDMI 1
    assert h.sensor["inputs"] == {TV: "HDMI 1"} and h.host.store.inputs() == {TV: "HDMI 1"}
    # an input changed later, with no player waking, is someone's choice: not learned
    gw.now[0] += 300
    h.put(TV, "on", source="HDMI 2")
    assert h.sensor["inputs"] == {TV: "HDMI 1"}


async def test_the_input_is_learned_the_other_way_round_too(gw):
    # (the Master Bedroom on the house: the TV turned on first, at its soundbar's input, and the Apple TV woke after)
    h = House(gw)
    h.host.lookup = False
    h.put(TV, "on", source="LG S95TR")
    gw.now[0] += 12
    h.put(ATV, "on")
    assert h.sensor["inputs"] == {TV: "LG S95TR"}


async def test_an_icon_is_looked_up_once_and_served_to_signed_in_screens(gw, monkeypatch):
    h = House(gw)
    asked = []

    async def fetch(app):
        asked.append(app)
        return b"\x89PNG fictional", "image/png"
    monkeypatch.setattr(h.host, "fetch_icon", fetch)
    h.put(ATV, "playing", app_id=YTV, app_name="YouTube TV")
    for _ in range(5):
        await __import__("asyncio").sleep(0)
    h.put(ATV, "playing", app_id="com.apple.TVWatchList", app_name="TV")
    h.put(ATV, "playing", app_id=YTV, app_name="YouTube TV")
    for _ in range(5):
        await __import__("asyncio").sleep(0)
    assert asked == [YTV] and h.host.store.icon(YTV) == (b"\x89PNG fictional", "image/png")
    assert [a["icon"] for a in h.sensor["apps"] if a["id"] == YTV] == [True]


async def test_lookups_off_in_settings_asks_nothing(gw, monkeypatch):
    h = House(gw)
    gw.m.app["settings"].store.write([("house", "settings", {"features": {"tv_icons": False}})], actor=SettingsActor(label="test"))
    asked = []

    async def fetch(app):
        asked.append(app)
    monkeypatch.setattr(h.host, "fetch_icon", fetch)
    h.put(ATV, "playing", app_id=YTV, app_name="YouTube TV")
    assert asked == [] and h.host.lookup is False


async def _settle():
    for _ in range(8):
        await __import__("asyncio").sleep(0)


async def test_an_app_nobody_opened_gets_a_guessed_icon_and_a_wrong_guess_goes_when_it_opens(gw, monkeypatch):
    h = House(gw)
    monkeypatch.setattr(T, "SEARCH_GAP", 0)
    searched, fetched = [], []

    async def search(name):
        searched.append(name)
        return {"Coax": ("com.guess.coax", b"PNG coax", "image/png"), "Dusk": ("app.dusk.photos", b"PNG dusk", "image/png")}.get(name)

    async def fetch(app):
        fetched.append(app)
        return b"PNG real", "image/png"
    monkeypatch.setattr(h.host, "search_icon", search)
    monkeypatch.setattr(h.host, "fetch_icon", fetch)
    h.put(ATV, "standby", source_list=["Coax", "Dusk", "Settings", "Rivulet"])
    await _settle()
    assert sorted(searched) == ["Coax", "Dusk", "Rivulet"]                          # (Apple's Settings never)
    g = h.sensor["guesses"]
    assert g["Coax"] == {"id": "com.guess.coax", "src": "/api/tv/icon/com.guess.coax"} and g["Settings"] == {"glyph": "hk:cog"}
    assert "Rivulet" not in g and h.host.store.guess_icon("com.guess.coax") == (b"PNG coax", "image/png")
    h.put(ATV, "standby", source_list=["Coax", "Dusk", "Settings", "Rivulet", "Netflix"])
    await _settle()
    assert searched.count("Coax") == 1 and searched.count("Rivulet") == 1 and "Netflix" in searched   # (once a week; a new app)
    # Coax opens as the guessed app: its guess stays and its own icon is looked up too; Dusk opens as another app: its guess goes
    h.put(ATV, "playing", app_id="com.guess.coax", app_name="Coax")
    h.put(ATV, "playing", app_id="com.real.dusk", app_name="Dusk")
    await _settle()
    assert fetched == ["com.guess.coax", "com.real.dusk"]
    assert "Coax" in h.sensor["guesses"] and "Dusk" not in h.sensor["guesses"] and h.host.store.guess_icon("app.dusk.photos") is None
    assert {a["id"]: a["icon"] for a in h.sensor["apps"]} == {"com.guess.coax": True, "com.real.dusk": True}


async def test_an_icon_is_read_whole_across_its_chunks_and_refused_past_the_limit():
    from mantel_server.features import tv as S

    class Body:
        def __init__(self, parts):
            self.parts = parts

        async def iter_chunked(self, _n):
            for p in self.parts:
                yield p
    assert await S.read_all(Body([b"a" * 16384, b"b" * 16384, b"c" * 10])) == b"a" * 16384 + b"b" * 16384 + b"c" * 10
    assert await S.read_all(Body([b"x" * (S.ICON_MAX // 2 + 1)] * 2)) is None


async def test_no_name_is_searched_with_lookups_off(gw, monkeypatch):
    h = House(gw)
    gw.m.app["settings"].store.write([("house", "settings", {"features": {"tv_icons": False}})], actor=SettingsActor(label="test"))
    searched = []

    async def search(name):
        searched.append(name)
    monkeypatch.setattr(h.host, "search_icon", search)
    h.put(ATV, "standby", source_list=["Coax", "Netflix"])
    await _settle()
    assert searched == [] and h.sensor["guesses"] == {}


# -- the page's half (web/hk/modules/hk-tv.js), in node --------------------------------------------------------------------------
import json as _json
import shutil as _shutil
import subprocess as _sub
from pathlib import Path as _Path

_ROOT = _Path(__file__).resolve().parents[1]
_NODE = _shutil.which("node") or "/opt/homebrew/bin/node"
_JS = r"""
globalThis.window = globalThis;
require(process.argv[2]); require(process.argv[3]);
const T = window.hkTv, G = window.hkGridCatalog;
const states = {
  'media_player.bed_tv': { state: 'on', attributes: { friendly_name: 'Bedroom TV', device_class: 'tv', source: 'LG S95TR', app_id: 'com.webos.app.hdmi2', source_list: ['Apple TV', 'HDMI 1', 'LG S95TR', 'Live TV'], volume_level: 0.1, supported_features: 24509 } },
  'media_player.bed_apple_tv': { state: 'playing', attributes: { friendly_name: 'Bedroom Apple TV', app_id: 'com.netflix.Netflix', app_name: 'Netflix', media_title: 'A Show', source_list: ['App Store', 'Netflix', 'YouTube TV', 'Coax', 'Disney+'], supported_features: 450487 } },
  'remote.bed_apple_tv': { state: 'on', attributes: {} },
  'media_player.den_tv': { state: 'off', attributes: { friendly_name: 'Den TV', device_class: 'tv', supported_features: 151481 } },
  'media_player.den_apple_tv': { state: 'off', attributes: { friendly_name: 'Den Apple TV', source_list: ['Netflix'] } },
  'remote.den_tv': { state: 'on', attributes: {} },
  'media_player.kitchen_homepod': { state: 'playing', attributes: { friendly_name: 'Kitchen HomePod', app_id: 'music_assistant', mass_player_type: 'player', source_list: ['Music Assistant Queue'] } },
  'media_player.guest_apple_tv': { state: 'off', attributes: { friendly_name: 'Guest Apple TV', source_list: [] } },
  'sensor.hk_tv': { state: '2', attributes: { apps: [{ id: 'com.google.ios.youtubeunplugged', name: 'YouTube TV', count: 9, src: '/api/tv/icon/com.google.ios.youtubeunplugged', icon: true }],
                                               inputs: {}, guesses: { 'Coax': { id: 'com.guess.coax', src: '/api/tv/icon/com.guess.coax' },
                                                                      'YouTube TV': { id: 'wrong.guess', src: '/api/tv/icon/wrong.guess' },
                                                                      'App\u00a0Store': { glyph: 'hk:apple' } } } }
};
const entities = {
  'media_player.bed_tv': { area_id: 'bed', platform: 'webostv', device_id: 't1' }, 'media_player.bed_apple_tv': { area_id: 'bed', platform: 'apple_tv', device_id: 'a1' },
  'remote.bed_apple_tv': { device_id: 'a1', platform: 'apple_tv' }, 'media_player.den_tv': { area_id: 'den', platform: 'roku', device_id: 'r1' },
  'remote.den_tv': { device_id: 'r1', platform: 'roku' }, 'media_player.den_apple_tv': { area_id: 'den', platform: 'apple_tv' },
  'media_player.kitchen_homepod': { area_id: 'kitchen', platform: 'music_assistant' }, 'media_player.guest_apple_tv': { area_id: 'guest', platform: 'apple_tv' }
};
const client = { states, entities, devices: {}, areas: { bed: { name: 'Bedroom' }, den: { name: 'Den' }, guest: { name: 'Guest' } } };
window.hkHostClient = { current: () => client };
const out = {};
out.sets = T.sets(client).map((s) => [s.tv, s.player, s.remotes.player, s.remotes.tv, s.remotes.tvKind]);
const bed = T.setFor(client, 'media_player.bed_apple_tv'), den = T.setFor(client, 'den');
const lk = T.look(client, bed);
out.bed = { title: lk.title, sub: lk.sub, onPlayer: lk.onPlayer, arrows: lk.arrows, vol: lk.volume.mode, inputs: lk.inputs.map((x) => x.on ? '*' + x.name : x.name) };
out.keys = { tvUp: T.press(client, bed, 'tv', 'up'), back: T.press(client, bed, 'player', 'back'), rokuSelect: T.press(client, den, 'tv', 'select'),
             lgPlay: T.press(client, bed, 'tv', 'play_pause') };
out.denVol = T.look(client, den).volume.mode;
out.openDen = T.open(client, den, 'Netflix');
out.apps = T.apps(client, bed, 'recent', 4).map((a) => [a.name, !!a.icon, a.now]);
out.all = T.allApps(client, bed).map((a) => [a.name, a.icon, a.glyph]);
out.on = { bed: T.isOn(client, 'media_player.bed_tv'), den: T.isOn(client, 'den'), any: G.matches({ kind: 'tv_on' }, states),
           tablet: G.matches({ kind: 'tv_on', entity: 'tablet_room' }, states), denRule: G.matches({ kind: 'tv_on', entity: 'media_player.den_tv' }, states) };
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def js(tmp_path_factory):
    if not _Path(_NODE).exists():
        pytest.skip("no node")
    f = tmp_path_factory.mktemp("tv") / "run.cjs"
    f.write_text(_JS)
    r = _sub.run([_NODE, str(f), str(_ROOT / "web/hk/modules/hk-tv.js"), str(_ROOT / "web/hk/cards/hk-grid-catalog.js")],
                 capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return _json.loads(r.stdout)


def test_each_room_pairs_its_tv_with_its_player_and_a_homepod_is_neither(js):
    assert js["sets"] == [["media_player.bed_tv", "media_player.bed_apple_tv", "remote.bed_apple_tv", None, "webostv"],
                          ["media_player.den_tv", "media_player.den_apple_tv", None, "remote.den_tv", "roku"],
                          [None, "media_player.guest_apple_tv", None, None, ""]]


def test_what_is_on_and_where_the_arrows_go(js):
    # (the TV on its soundbar's input, which hasn't been learned yet; the Apple TV awake: it is what's on, and the arrows are its)
    assert js["bed"] == {"title": "A Show", "sub": "Netflix", "onPlayer": True, "arrows": "player", "vol": "set",
                         "inputs": ["Apple TV", "HDMI 1", "*LG S95TR", "Live TV"]}
    assert js["denVol"] is None                                             # (off: no volume until it's on)


def test_each_brands_keys(js):
    k = js["keys"]
    assert k["tvUp"] == [["webostv", "button", {"entity_id": "media_player.bed_tv", "button": "UP"}]]
    assert k["back"] == [["remote", "send_command", {"entity_id": "remote.bed_apple_tv", "command": "menu"}]]
    assert k["rokuSelect"] == [["remote", "send_command", {"entity_id": "remote.den_tv", "command": "select"}]]
    assert k["lgPlay"] == [["media_player", "media_play_pause", {"entity_id": "media_player.bed_tv"}]]


def test_an_app_from_a_dark_room_wakes_the_player_and_the_tv_first(js):
    assert js["openDen"] == [["media_player", "turn_on", {"entity_id": "media_player.den_apple_tv"}],
                             ["media_player", "turn_on", {"entity_id": "media_player.den_tv"}],
                             ["media_player", "select_source", {"entity_id": "media_player.den_apple_tv", "source": "Netflix"}]]


def test_recent_apps_put_the_most_used_first_with_its_icon_and_leave_out_apples_utilities(js):
    assert js["apps"] == [["YouTube TV", True, False], ["Netflix", False, True], ["Disney+", False, False], ["Coax", True, False]]


def test_an_app_nobody_opened_shows_its_guessed_icon_and_an_opened_apps_own_icon_wins(js):
    assert js["all"] == [["App\u00a0Store", None, "hk:apple"], ["Coax", "/api/tv/icon/com.guess.coax", None], ["Disney+", None, None],
                         ["Netflix", None, None], ["YouTube TV", "/api/tv/icon/com.google.ios.youtubeunplugged", None]]


def test_a_tv_is_on_by_a_tv_its_room_or_any(js):
    assert js["on"] == {"bed": True, "den": False, "any": True, "tablet": False, "denRule": False}
