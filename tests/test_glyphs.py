"""An accessory's glyph as the screens draw it, for the widgets (hk_core.glyphs: the strategy's rule)."""
from hk_core import glyphs as G


def test_the_house_s_own_choice_first():
    assert G.glyph("light.desk", "on", {}, "Desk", acc={"icon": "mdi:desk-lamp"}) == "hk:desk-lamp"
    assert G.glyph("light.desk", "on", {}, "Desk", acc={"icon": "hk:chandelier"}) == "hk:chandelier"
    assert G.glyph("light.desk", "on", {}, "Desk", entry={"icon": "hk:fire"}) == "hk:fire"
    assert G.glyph("light.desk", "on", {}, "Desk", entry={"icon": "mdi:fire"}) == "hk:lightbulb"   # (only the house's set)


def test_what_it_is():
    assert G.glyph("light.a", "on", {}, "Kitchen Floor Lamp") == "hk:floor-lamp"
    assert G.glyph("light.a", "on", {"entity_id": ["light.b"]}, "Kitchen") == "hk:lightbulb-group"
    assert G.glyph("switch.a", "on", {}, "Fountain") == "hk:power-socket-us"
    assert G.glyph("switch.a", "on", {}, "Fan", acc={"show_as": "fan"}) == "hk:fan"
    assert G.glyph("cover.g", "closed", {"device_class": "garage"}) == "hk:garage"
    assert G.glyph("cover.g", "open", {"device_class": "garage"}) == "hk:garage-open"
    assert G.glyph("cover.b", "open", {"device_class": "blind"}) == "hk:blinds-horizontal"
    assert G.glyph("lock.f", "unlocked", {}) == "hk:lock-open-variant"
    assert G.glyph("media_player.k", "idle", {}, model="HomePod mini") == "hk:homepod-mini"
    assert G.glyph("media_player.v", "idle", {}, model="HomeAccessory17,1") == "hk:homeview"
    assert G.glyph("media_player.t", "on", {"device_class": "tv"}) == "hk:television"
    assert G.glyph("alarm_control_panel.h", "armed_away", {}) == "hk:alarm-light"
    assert G.glyph("scene.movie", "scening", {"icon": "hk:popcorn"}) == "hk:popcorn"
    assert G.glyph("scene.movie", "scening", {}) == "mdi:palette"
    assert G.glyph("sensor.t", "70", {"device_class": "temperature"}) is None     # a reading draws what it measures
