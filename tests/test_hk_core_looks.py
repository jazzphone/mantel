"""The Looks (hk_core/settings/looks.py, 2026-10-30): every Look writes only what a screen can hold, its Undo is
checked as the settings are, and hk-settings-model.js's copy is the same list."""
import json
import subprocess
from pathlib import Path

import pytest

import web_sources

from hk_core.settings import changes as C
from hk_core.settings import looks as L
from hk_core.settings import model as M

ROOT = Path(__file__).resolve().parents[1]
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")


@pytest.mark.parametrize("look", L.LOOKS, ids=L.IDS)
def test_every_look_is_settings_a_screen_can_hold(look):
    ch = dict(look["settings"])
    ch["screensaver_options"] = {**M.saver_options({}), **look["saver"]}
    b, err = C.apply_board({}, ch)
    assert err == {}, err
    assert set(look["settings"]) <= set(L.SET_KEYS)
    assert set(look["saver"]) <= set(M.saver_options({}))
    assert look["layout"]["cell"] in ("tile", "square") and look["layout"]["starters"]
    assert len(look["art"]) == 4 and look["name"] and look["about"]


def test_eight_looks_each_its_own():
    assert L.IDS == ("homeview", "flat", "performance", "holiday", "weather", "calm", "night", "photos")
    assert len(set(L.IDS)) == len(L.IDS)


def test_a_looks_undo_is_checked_as_its_settings_are():
    b, err = C.apply_board({}, {"look_undo": {"look": "homeview", "was": {"glass": "house", "tile_style": None, "side_pane": None,
                                                                          "home_grid": None, "accent": "orange"}}})
    assert err == {} and M.board(b)["look_undo"]["look"] == "homeview"
    assert C.apply_board({}, {"look_undo": {"look": "plaid", "was": {}}})[1] == {"look_undo": "look_undo"}
    assert C.apply_board({}, {"look_undo": {"look": "flat", "was": {"menu": "tabbar"}}})[1] == {"look_undo": "look_undo"}
    assert C.apply_board({}, {"look_undo": {"look": "flat", "was": {"glass": "sparkly"}}})[1] == {"look_undo": "choice"}
    b, err = C.apply_board(b, {"look_undo": None})
    assert err == {} and M.board(b)["look_undo"] is None
    assert M.board({})["look_undo"] is None and M.board({"look_undo": "x"})["look_undo"] is None


@pytest.mark.skipif(not JSC.exists(), reason="JavaScriptCore's jsc is macOS's")
def test_the_settings_page_has_the_same_looks(tmp_path):
    prelude = tmp_path / "prelude.js"
    prelude.write_text("var window = this; window.hkCards = null;\n"
                       f"load({json.dumps(str(ROOT / 'web/client/hk-host-shell.js'))});\n"
                       # (a file cut into parts: its parts first, as the page's loader leaves them: tests/web_sources.py)
                       + "".join(f"load({json.dumps(str(x))});\n" for x in web_sources.parts("web/hk/panels/hk-settings-model.js"))
                       + f"load({json.dumps(str(ROOT / 'web/hk/panels/hk-settings-model.js'))});\n"
                       "print(JSON.stringify({looks: window.hkSettingsModel.LOOKS, set: window.hkSettingsModel.LOOK_KEYS,"
                       " undo: window.hkSettingsModel.LOOK_UNDO_KEYS}));\n")
    out = json.loads(subprocess.run([str(JSC), str(prelude)], capture_output=True, text=True, check=True, timeout=30).stdout)
    assert out["looks"] == json.loads(json.dumps(list(L.LOOKS)))
    assert out["set"] == list(L.SET_KEYS) and out["undo"] == list(L.UNDO_KEYS)
