"""TVs (phase 23; hk_core/tv.py, mantel_server/tv.py): what Accessories -> TVs may save, the apps an Apple TV opens counted and shared
as Mantel's own sensor, the input a room's player is on learned as it wakes its TV, an icon looked up once on Apple's host only and
never for Apple's own apps or with lookups off, and the icon served to signed-in screens."""
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
