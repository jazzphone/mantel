"""The Timeline as a page a screen can choose (the owner, 2026-11-04: with a screen's Pages on This Screen set by
hand, Timeline was in neither SHOWN nor MORE). Mantel's catalog was imported from HK Frontend before the Timeline
existed; Mantel's Settings offers the kinds its own model knows besides. Home Assistant's HK Settings never offers it."""
from __future__ import annotations

import ast
from pathlib import Path

from hk_core.settings import model as SM
from hk_core.settings import pages as SP

ROOT = Path(__file__).resolve().parents[1]
OLD = ["weather", "calendar", "cameras", "live_tv", "security", "doors_windows", "climate", "lights", "timers",
       "vacuums", "music", "browse", "water", "energy", "power", "rooms"]


def test_an_imported_list_gets_the_timeline_before_the_rooms_and_keeps_its_own_order():
    got = SP.page_kinds_with(OLD)
    assert got == OLD[:-1] + ["timeline", "rooms"]
    assert SP.page_kinds_with(["weather", "rooms"]) == ["weather", "calendar", "cameras", "live_tv", "security",
                                                       "doors_windows", "climate", "lights", "timers", "vacuums",
                                                       "music", "browse", "water", "energy", "power", "timeline",
                                                       "rooms"]
    assert SP.page_kinds_with(OLD, host_pages=()) == OLD            # a host without the page never gets it
    scenes = [k for k in SP.page_kinds_with([k for k in OLD if k not in ("browse", "rooms")]) if k in SM.SCENE_PAGES]
    assert scenes[-1] == "timeline" and "rooms" not in scenes and "browse" not in scenes


def test_a_saved_page_list_with_the_timeline_is_accepted():
    assert "timeline" in SM.PAGE_KINDS and "timeline" in SM.PAGE_ORDER and "timeline" in SM.SCENE_PAGES


def test_home_assistants_hk_settings_never_offers_it():
    src = (ROOT / "hosts/ha/custom_components/hk_frontend/panel.py").read_text()
    assert '"page_kinds": SP.ha_kinds()[0], "scene_pages": SP.ha_kinds()[1]' in src
    kinds, scenes = SP.ha_kinds()
    assert "timeline" not in kinds and "timeline" not in scenes and "weather" in kinds
    ast.parse(src)


def test_mantels_settings_offers_it_beside_the_imported_catalog():
    src = (ROOT / "hosts/server/mantel_server/settings_store/service.py").read_text()
    assert 'SP.page_kinds_with(catalog.get("page_kinds", []))' in src
