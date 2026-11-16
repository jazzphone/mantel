"""A screen built again is built from the whole house (2026-11-15, the owner: "all the cameras don't load on the cameras
page after awhile ... a blank page with 1 camera"). web/home.js narrows a screen's states to what its cards read; the
strategy decides what each page lists from the states it is given, so a settings change that built the screen again
after the narrowing built the Cameras page from the cameras some other card read (the Kitchen: 9, then 1). The rebuild
widens first, as a page not seen yet does, and narrows again after."""
from __future__ import annotations

import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


def _rebuild() -> str:
    text = (WEB / "home.js").read_text()
    m = re.search(r"const rebuild = \(\) => \{(.*?)\n  \};", text, re.S)
    assert m, "web/home.js has no rebuild()"
    return m.group(1)


def test_a_rebuild_widens_to_the_whole_house_before_the_strategy_runs():
    body = _rebuild()
    assert "widen()" in body and body.index("widen()") < body.index("await build()")


def test_a_rebuild_does_not_wait_on_a_widening_for_ever():
    assert "WIDE_MS" in _rebuild().split("await build()")[0]


def test_a_rebuild_narrows_again_after_drawing():
    body = _rebuild()
    assert body.index("narrowSoon(") > body.index("viewHost.reconfigure(")
