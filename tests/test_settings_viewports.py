"""Slice 10.1: Mantel Settings on iPhone and iPad (docs/phase10/APPLE-APPS.md §8).

The layout rules are pinned statically here; tools/headless/settings_viewports.py draws the page in headless
Chrome at 390x844, 844x390, 820x1180 and 1180x820 with an iPhone's safe areas and checks it (run here when
Chrome is installed, skipped otherwise).
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PANEL = (ROOT / "web/hk/panels/hk-settings.js").read_text()


def test_two_columns_from_700_px_when_there_is_height():
    assert "var wide = w >= 700 && tall" in PANEL
    page = (ROOT / "web/shim/settings-page.js").read_text()
    assert "window.innerWidth < 700 || window.innerHeight < 500" in page


def test_the_panel_keeps_clear_of_the_safe_areas():
    # (the sides through --hk-safe-right / -left first, which a check can stand in: hk-base.js SAFE, 2026-10-30)
    assert ("padding:env(safe-area-inset-top,0px) var(--hk-safe-right,env(safe-area-inset-right,0px)) 0 "
            "var(--hk-safe-left,env(safe-area-inset-left,0px))") in PANEL
    assert PANEL.count("env(safe-area-inset-bottom,0px)") >= 4      # the list's and the page's ends, both layouts


def _chrome() -> str:
    spec = importlib.util.spec_from_file_location("cdp", ROOT / "tools/headless/cdp.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.CHROME


@pytest.mark.skipif(not os.path.exists(_chrome()), reason="needs Chrome or Chromium (CHROME) for the headless check")
def test_iphone_and_ipad_sizes_in_a_browser():
    sys.path.insert(0, str(ROOT / "tools/headless"))
    spec = importlib.util.spec_from_file_location("settings_viewports", ROOT / "tools/headless/settings_viewports.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    results = asyncio.run(mod.check(port=9371))
    assert mod.problems(results) == []
    assert {r["name"]: r["got"]["wide"] for r in results} == {
        "iphone-upright": False, "iphone-side": False, "ipad-upright": True, "ipad-side": True}
