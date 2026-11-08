"""The Holiday slide's settings (phase 20, docs/phase20/HOLIDAY-SLIDE.md "Settings"): their defaults, the checks that
refuse what the slide could not use, the house outside the US, the Holiday Whimsy Look, and the calendar's ids in step
with web/hk/modules/hk-holidays.js."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import looks as L
from hk_core.settings import model as M
from hk_core.settings import saver_designs as S
from hk_core.settings import saver_holidays as HOL

ROOT = Path(__file__).resolve().parents[1]
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


def test_off_by_default_with_the_plans_defaults():
    d = S.saver_options({})
    assert {k: v for k, v in d.items() if k.startswith("holiday_")} == {
        "holiday_slide": False, "holiday_pick": "next", "holiday_one": "christmas", "holiday_days": 60, "holiday_off": [],
        "holiday_own": [], "holiday_fx": "full", "holiday_outdoors": [], "holiday_hide": []}
    assert HOL.PARTS == ("count", "next")


def test_good_values_are_kept_and_cleaned():
    o = S.saver_options({"holiday_slide": True, "holiday_pick": "turns", "holiday_days": 90, "holiday_one": "own:beach-trip",
                         "holiday_off": ["christmas", "birthdays", "easter"], "holiday_outdoors": ["halloween", "christmas"],
                         "holiday_hide": ["next", "count"], "holiday_fx": "gentle",
                         "holiday_own": [{"name": "  Beach Trip ", "month": 7, "day": 12, "scene": "summer"},
                                         {"name": "Leap", "month": 2, "day": 29, "year": 2028}]})
    assert o is not None
    assert o["holiday_off"] == ["easter", "christmas", "birthdays"], "in the calendar's order"
    assert o["holiday_outdoors"] == ["halloween", "christmas"] and o["holiday_hide"] == ["count", "next"]
    assert o["holiday_own"] == [{"name": "Beach Trip", "month": 7, "day": 12, "scene": "summer"},
                                {"name": "Leap", "month": 2, "day": 29, "scene": "spring", "year": 2028}]
    assert S.saver_options({"holiday_one": "birthday:anna"})["holiday_one"] == "birthday:anna"


@pytest.mark.parametrize("bad", [
    {"holiday_slide": "yes"}, {"holiday_pick": "random"}, {"holiday_fx": "max"}, {"holiday_days": 45}, {"holiday_days": True},
    {"holiday_days": 60.0}, {"holiday_one": "xmas"}, {"holiday_one": "own:"}, {"holiday_one": 3}, {"holiday_off": ["hanukkah"]},
    {"holiday_off": "christmas"}, {"holiday_outdoors": ["easter"]}, {"holiday_outdoors": ["birthdays"]}, {"holiday_hide": ["cost"]},
    {"holiday_own": [{"name": "A", "month": 2, "day": 30}]}, {"holiday_own": [{"name": "A", "month": 2, "day": 29, "year": 2027}]},
    {"holiday_own": [{"name": "A", "month": 13, "day": 1}]}, {"holiday_own": [{"name": "", "month": 1, "day": 1}]},
    {"holiday_own": [{"name": "x" * 41, "month": 1, "day": 1}]}, {"holiday_own": [{"name": "<b>", "month": 1, "day": 1}]},
    {"holiday_own": [{"name": "A", "month": 1, "day": 1, "scene": "moon"}]}, {"holiday_own": [{"name": "A", "month": 1}]},
    {"holiday_own": [{"name": "A", "month": 1, "day": 1, "color": "red"}]}, {"holiday_own": [{"name": "A", "month": True, "day": 1}]},
    {"holiday_own": [{"name": "A", "month": 1, "day": 1, "year": 1700}]}, {"holiday_own": [{"name": "A", "month": 1, "day": 1}] * 13},
])
def test_what_the_slide_could_not_use_is_refused(bad):
    assert S.saver_options(bad) is None


def test_a_house_outside_the_us_leaves_the_us_only_holidays_off_until_it_chooses():
    try:
        M.set_house_place(51.5, "GB")
        assert M.merged({})["look"]["saver"]["holiday_off"] == ["july4", "thanksgiving"]
        chosen = {M.CONF_DASHBOARD: {"look": {"saver": {"holiday_off": []}}}}
        assert M.merged(chosen)["look"]["saver"]["holiday_off"] == [], "a saved choice wins"
        M.set_house_place(40.0, "US")
        assert M.merged({})["look"]["saver"]["holiday_off"] == []
    finally:
        M.set_house_place(None, None)
    assert M.merged({})["look"]["saver"]["holiday_off"] == []


def test_holiday_whimsy_turns_it_on():
    assert L.look("holiday")["saver"]["holiday_slide"] is True
    assert S.saver_options(L.look("holiday")["saver"]) is not None


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_calendar_names_the_same_holidays(tmp_path):
    prelude = tmp_path / "p.js"
    prelude.write_text(f"var window = this;\nload({json.dumps(str(ROOT / 'web/hk/modules/hk-holidays.js'))});\n"
                       "var H = window.hkHolidays;\n"
                       "print(JSON.stringify({ids: H.IDS, painted: H.PAINTED, us: H.US_ONLY, scenes: Object.keys(H.OWN_SCENES),"
                       " max: H.OWN_MAX, name: H.NAME_MAX}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert tuple(out["ids"]) == HOL.IDS
    assert set(out["painted"]) == set(HOL.PAINTED) and set(out["us"]) == set(HOL.US_ONLY)
    assert tuple(out["scenes"]) == HOL.OWN_SCENES
    assert (out["max"], out["name"]) == (HOL.OWN_MAX, HOL.NAME_MAX)
