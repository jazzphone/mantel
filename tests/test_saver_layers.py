"""A screen's screensaver row by row over All Screens', and the slides in minutes (phase 33, decisions 9 and 12;
hk_core/settings/saver_layers.py). What a house set before reads the same after: a screen with a whole set of its
own keeps every key; a screen that follows still follows; and a slide over the photos comes after the same time."""
import re
from pathlib import Path

from hk_core.settings import changes as C
from hk_core.settings import model as S
from hk_core.settings import saver_layers as SL
from hk_core.settings.model.dashboard_rules import board
from hk_core.settings.model.menu_rules import resolved

ROOT = Path(__file__).resolve().parents[1]

# the house's All Screens (2026-11-16): photos with the forecast between, a slide every 3 photos of 20 s
HOUSE = {"show": "both", "forecast_every": 3, "each_photo": 20, "extra_every": 2, "extra_for": 30, "music_first": True,
         "weather_slide": True, "energy_slide": True, "holiday_slide": True, "timer_slide": True}
OPTIONS = {"dashboard": {"look": {"saver": HOUSE}}}
# ...and its three screens with whole sets of their own (written before per key: every key)
OWN_WHOLE = dict(S.SAVER_DEFAULTS, show="clock", forecast_every=5, extra_every=2, starts_after=60)


def read(saver_options):
    return resolved(board({"screensaver": True, "screensaver_options": saver_options}), OPTIONS)


def test_the_house_slide_over_its_photos_comes_after_the_same_time():
    before = HOUSE["forecast_every"] * HOUSE["each_photo"]          # 3 photos of 20 s
    o = S.merged(OPTIONS)["look"]["saver"]
    assert o["extra_every"] == 1 and o["extra_every"] * 60 == before
    # it shows for a photo's time, as it did, and an older version counts the same 3 photos
    assert o["extra_for"] == 20 and o["forecast_every"] == 3


def test_every_n_photos_takes_the_nearest_offered_minutes_and_is_carried_over_once():
    o = SL.in_minutes(dict(S.SAVER_DEFAULTS, show="photos", forecast_every=5, each_photo=30, extra_every=5))
    assert o["extra_every"] == 2 and o["forecast_every"] == 4       # 2.5 minutes: 2 is nearest
    assert SL.in_minutes(o) == o
    # written in minutes, it is never carried over again, whatever the photos' time
    for every, each in ((1, 600), (30, 5), (5, 20), (1, 10)):
        mine = SL.in_minutes(dict(S.SAVER_DEFAULTS, show="photos", extra_every=every, each_photo=each, forecast_every=SL.photos_for(every, each)))
        assert mine["extra_every"] == every and 2 <= mine["forecast_every"] <= 100


def test_a_clock_or_forecast_keeps_its_minutes():
    for show in ("clock", "forecast", "glance"):
        o = SL.in_minutes(dict(S.SAVER_DEFAULTS, show=show, forecast_every=7, each_photo=30, extra_every=10, extra_for=60))
        assert (o["extra_every"], o["extra_for"]) == (10, 60)


def test_a_screen_with_a_whole_set_of_its_own_keeps_exactly_its_behavior():
    b = read(OWN_WHOLE)
    assert b["screensaver_house"] is False and set(b["screensaver_own"]) == set(S.SAVER_DEFAULTS)
    old = S.saver_options(OWN_WHOLE)
    o = b["screensaver_options"]
    # every key as it read before; forecast_every (a count of photos a clock never reads) in step with its minutes
    assert {k: v for k, v in o.items() if k != "forecast_every"} == {k: v for k, v in old.items() if k != "forecast_every"}
    assert (o["show"], o["extra_every"], o["starts_after"], o["music_first"]) == ("clock", 2, 60, False)


def test_a_whole_set_missing_a_newer_key_still_takes_its_default_not_all_screens():
    whole = {k: v for k, v in OWN_WHOLE.items() if k not in ("timer_slide", "holiday_slide")}
    o = read(whole)["screensaver_options"]
    assert o["timer_slide"] is True and o["holiday_slide"] is False     # the defaults, as before; All Screens' holiday is on


def test_a_screen_that_follows_reads_all_screens_options():
    for none in (None, {}):
        b = read(none)
        assert b["screensaver_house"] is True and b["screensaver_own"] == {}
        assert b["screensaver_options"] == S.merged(OPTIONS)["look"]["saver"]


def test_a_screen_changes_one_row_and_follows_all_screens_in_the_rest():
    b = read({"starts_after": 60})
    o, house = b["screensaver_options"], S.merged(OPTIONS)["look"]["saver"]
    assert b["screensaver_house"] is False and b["screensaver_own"] == {"starts_after": 60}
    assert o["starts_after"] == 60 and {k: v for k, v in o.items() if k != "starts_after"} == {k: v for k, v in house.items() if k != "starts_after"}
    # its own photos' time: its slides still every All Screens' minute, counted in its photos for an older version
    o = read({"each_photo": 60})["screensaver_options"]
    assert o["extra_every"] == 1 and o["forecast_every"] == 2


def test_a_save_keeps_only_the_keys_given():
    put = C.BOARD["screensaver_options"]
    assert put({"starts_after": 60, "extra_every": 1}) == {"starts_after": 60, "extra_every": 1}
    assert put({}) is None and put(None) is None
    assert put({"music_slide": True}) == {"music_first": True, "music_slide": False}
    for bad in ({"starts_after": 5}, {"nope": 1}, {"show": "fireworks"}):
        try:
            put(bad)
        except C.Invalid:
            continue
        raise AssertionError(bad)


def test_the_page_rows_and_the_design_cover_every_key():
    assert SL.PAGE_KEYS <= set(S.SAVER_DEFAULTS)
    design = SL.design_keys(S.SAVER_DEFAULTS)
    assert {"layout", "designs", "active_design", "show", "clock_style", "clock_bg", "tb_size"} <= design
    assert not design & {"starts_after", "extra_every", "clock_night", "each_photo"}


def test_an_import_or_handover_keeps_the_screen_own_keys_not_a_copy():
    from mantel_server.settings_store.importing import as_stored
    b = read({"starts_after": 60})
    assert as_stored("board", b)["screensaver_options"] == {"starts_after": 60}
    assert as_stored("board", read(None))["screensaver_options"] is None


def test_web_mirrors_the_choices_and_the_rows():
    """hk-settings-model-search.js and the dashboard's saver count the same choices and rows as saver_layers."""
    model = (ROOT / "web/hk/settings-model/hk-settings-model-search.js").read_text()
    saver = (ROOT / "web/hk/saver/hk-saver-helpers.js").read_text()
    every = tuple(int(x) for x in re.search(r"SAVER_EVERY = \[([\d, ]+)\]", model).group(1).split(","))
    assert every == SL.EVERY
    assert tuple(int(x) for x in re.search(r"EVERY = \[([\d, ]+)\]", saver).group(1).split(",")) == SL.EVERY
    rows = set(re.findall(r"'([a-z_0-9]+)'", re.search(r"SAVER_PAGE_KEYS = \[(.*?)\]", model, re.S).group(1)))
    assert rows == set(SL.PAGE_KEYS)
