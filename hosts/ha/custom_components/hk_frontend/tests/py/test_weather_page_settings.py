"""The Weather page's own settings (2026-10-16): weather.page and
weather.radar_native -- typed objects read over their defaults, refused whole
when anything in them is wrong, and the one-time move from the Weather Radar
Card (entry 1.16)."""
from __future__ import annotations

import json

import pytest

from conftest import entry
from custom_components.hk_frontend import settings as S
from test_settings_api import _set


# ------------------------------------------------------------ the parsers
def test_defaults_whole_and_partial():
    assert S.weather_page(None) == S.WEATHER_PAGE_DEFAULTS
    assert S.radar_native(None) == S.RADAR_DEFAULTS
    got = S.weather_page({"hours": 24})
    assert got["hours"] == 24 and got["days"] == 8 and got["details"] == list(S.WEATHER_DETAILS)
    got = S.radar_native({"enabled": True, "zoom": 8})
    assert got["enabled"] is True and got["zoom"] == 8 and got["provider"] == "auto"


def test_a_stored_false_stays_false():
    m = S.merged({"dashboard": {"weather": {"page": {"show_hourly": False, "load_animation": False},
                                            "radar_native": {"enabled": False, "marker": False}}}})
    assert m["weather"]["page"]["show_hourly"] is False and m["weather"]["page"]["load_animation"] is False
    assert m["weather"]["page"]["show_daily"] is True, "the rest from the defaults"
    assert m["weather"]["radar_native"]["marker"] is False and m["weather"]["radar_native"]["opacity"] == 75


def test_a_save_refuses_anything_wrong_whole():
    bad_page = [{"hours": 7}, {"days": "8"}, {"hourly_metric": "snow"}, {"details": ["wind", "wind"]},
                {"details": ["wind", "tide"]}, {"details": "wind"}, {"show_hourly": 1}, {"shiny": True},
                {"hours": True}, []]
    for v in bad_page:
        assert S.weather_page(v) is None, v
    bad_radar = [{"zoom": 3}, {"zoom": 11}, {"zoom": 6.5}, {"zoom": True}, {"zoom": float("nan")},
                 {"zoom": float("inf")}, {"opacity": 10}, {"opacity": 101}, {"opacity": False},
                 {"provider": "dwd"}, {"basemap": "google"}, {"center": "work"}, {"zone": "sensor.x"},
                 {"zone": "zone.Bad Name"}, {"history_minutes": 45}, {"playback_speed": "warp"},
                 {"version": 2}, {"version": True}, {"enabled": "yes"}, {"token": "x"}]
    for v in bad_radar:
        assert S.radar_native(v) is None, v
    # an integral float is a whole number; details keep their order
    assert S.radar_native({"zoom": 7.0})["zoom"] == 7
    assert S.weather_page({"details": ["moon", "wind"]})["details"] == ["moon", "wind"]
    assert S.weather_page({"details": []})["details"] == []
    assert S.radar_native({"center": "zone", "zone": "zone.work"})["zone"] == "zone.work"


def test_what_is_stored_reads_back_leniently():
    """A stored object from an older or hand-edited store: a bad key is its
    default, never the whole object lost."""
    m = S.merged({"dashboard": {"weather": {"page": {"hours": 99, "days": 5, "junk": 1},
                                            "radar_native": {"zoom": 99, "provider": "rainviewer"}}}})
    assert m["weather"]["page"]["hours"] == 12 and m["weather"]["page"]["days"] == 5
    assert "junk" not in m["weather"]["page"]
    assert m["weather"]["radar_native"]["zoom"] == 5 and m["weather"]["radar_native"]["provider"] == "rainviewer"
    m = S.merged({"dashboard": {"weather": {"page": "nonsense", "radar_native": None}}})
    assert m["weather"]["page"] == S.WEATHER_PAGE_DEFAULTS and m["weather"]["radar_native"] == S.RADAR_DEFAULTS


# ------------------------------------------------------------ the migration
def test_legacy_options_map_where_they_can():
    got = S.radar_from_legacy({"data_source": "RainViewer", "zoom_level": 12, "static_map": False,
                               "show_playback": False, "height": "520px"}, True)
    assert (got["enabled"], got["provider"], got["zoom"], got["interactive"], got["playback_controls"]) == (
        True, "rainviewer", 10, True, False)
    got = S.radar_from_legacy({"data_source": "NOAA", "zoom_level": 2, "static_map": True}, True)
    assert (got["provider"], got["zoom"], got["interactive"]) == ("noaa", 4, False)
    # nothing stored: the native defaults, on
    got = S.radar_from_legacy({}, True)
    assert got == {**S.RADAR_DEFAULTS, "enabled": True}


def test_radar_lifted_once_and_only_for_a_house_that_had_the_card():
    assert S.radar_lifted({}, installed=False) is None, "a new house: off, nothing stored"
    lifted = S.radar_lifted({}, installed=True)
    w = lifted["dashboard"]["weather"]
    assert w["radar_native"]["enabled"] is True and "radar" not in w
    # idempotent: a second run finds it moved
    assert S.radar_lifted(lifted, installed=True) is None
    # an explicit radar_native wins, even switched off
    off = {"dashboard": {"weather": {"radar_native": {"enabled": False}, "radar": {"zoom_level": 8}}}}
    assert S.radar_lifted(off, installed=True) is None
    # the card's own options carried over and kept as they were
    old = {"dashboard": {"weather": {"entity": "weather.home", "radar": {"zoom_level": 8, "markers": []}}}}
    w = S.radar_lifted(old, installed=True)["dashboard"]["weather"]
    assert w["radar"] == {"zoom_level": 8, "markers": []} and w["radar_native"]["zoom"] == 8
    assert w["entity"] == "weather.home"
    # a partial/empty dashboard section is fine
    assert S.radar_lifted({"dashboard": {}}, installed=True)["dashboard"]["weather"]["radar_native"]["enabled"]


async def test_an_entry_from_1_15_with_the_radar_card_keeps_a_radar(hass, base, tmp_path, monkeypatch):
    from conftest import house_entry
    monkeypatch.setattr(hass.config, "config_dir", str(tmp_path))
    card = tmp_path / "www" / "community" / "weather-radar-card"
    card.mkdir(parents=True)
    (card / "weather-radar-card.js").write_text("//")
    old = house_entry(options={"dashboard": {"weather": {"radar": {"data_source": "NOAA", "static_map": False}}}},
                      minor_version=15)
    old.add_to_hass(hass)
    assert await hass.config_entries.async_setup(old.entry_id)
    await hass.async_block_till_done()
    assert old.minor_version == 17
    w = S.merged(old.options)["weather"]
    assert w["radar_native"]["enabled"] is True and w["radar_native"]["provider"] == "noaa"
    assert w["radar_native"]["interactive"] is True
    assert w["radar"] == {"data_source": "NOAA", "static_map": False}, "the old options kept"


async def test_an_entry_from_1_15_without_the_card_stays_off(hass, base, tmp_path, monkeypatch):
    from conftest import house_entry
    monkeypatch.setattr(hass.config, "config_dir", str(tmp_path))
    old = house_entry(options={"dashboard": {"weather": {"radar": {"zoom_level": 9}}}}, minor_version=15)
    old.add_to_hass(hass)
    assert await hass.config_entries.async_setup(old.entry_id)
    await hass.async_block_till_done()
    assert old.minor_version == 17
    assert S.merged(old.options)["weather"]["radar_native"]["enabled"] is False
    assert "radar_native" not in old.options["dashboard"]["weather"]


# ------------------------------------------------------------ the page's saves
async def test_saving_the_weather_page_and_its_radar(hass, frontend):
    r = await _set(hass, {"weather.page": {**S.WEATHER_PAGE_DEFAULTS, "hours": 24, "details": ["moon", "wind"]}})
    assert r["success"]
    w = S.merged(entry(hass).options)["weather"]
    assert w["page"]["hours"] == 24 and w["page"]["details"] == ["moon", "wind"]
    r = await _set(hass, {"weather.radar_native": {**S.RADAR_DEFAULTS, "enabled": True, "provider": "rainviewer"}})
    assert r["success"]
    assert S.merged(entry(hass).options)["weather"]["radar_native"]["provider"] == "rainviewer"
    # refused by field, nothing saved
    r = await _set(hass, {"weather.radar_native": {"zoom": 30}, "weather.place": "Elsewhere"})
    assert r["success"] is False and json.loads(r["message"]) == {"weather.radar_native": "choice"}
    assert S.merged(entry(hass).options)["weather"]["place"] is None
    r = await _set(hass, {"weather.page": {"hours": 7}})
    assert r["success"] is False and json.loads(r["message"]) == {"weather.page": "choice"}
    # Reset: the defaults, which are not stored
    r = await _set(hass, {"weather.page": S.WEATHER_PAGE_DEFAULTS})
    assert r["success"] and "page" not in entry(hass).options["dashboard"]["weather"]
    # only that object: the radar is as it was
    assert S.merged(entry(hass).options)["weather"]["radar_native"]["enabled"] is True


@pytest.mark.parametrize("key", ["weather.page", "weather.radar_native"])
async def test_a_screen_is_handed_both_whole(hass, frontend, key):
    from test_settings_api import _screen
    conn = await _screen(hass)
    got = conn.sent[-1]["event"]["settings"] if "settings" in conn.sent[-1].get("event", {}) else conn.sent[-1]["event"]
    sec, k = key.split(".")
    assert isinstance(got[sec][k], dict) and got[sec][k]
