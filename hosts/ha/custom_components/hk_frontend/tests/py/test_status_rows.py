"""The status rows: a room page's (rooms.status) and the category pages'
(status_rows.<page>) -- what each may show, in the house's order, the rooms a
page leaves out, and the entry that had Climate's row before (1.9 -> 1.10)."""
from __future__ import annotations

import pytest


def test_each_page_shows_its_defaults_in_order():
    from custom_components.hk_frontend import settings as S
    rows = S.merged({})["status_rows"]
    assert set(rows) == {"climate", "lights", "doors_windows", "water", "security", "vacuums", "timers"}
    assert rows["vacuums"]["status"] == ["vacuums", "vacuum_battery"] and rows["timers"]["status"] == ["timers"]
    assert rows["security"] == {"status": ["security", "locks", "garage", "doors", "windows", "leaks"],
                                "exclude_areas": []}
    assert rows["lights"]["status"] == ["lights", "outlets"]
    # what a page shows by default it may show
    for kinds, default in S.STATUS_ROWS.values():
        assert set(default) <= set(kinds)
    # and a room's row may show everything a page's can, in the Home app's order
    # -- but the Vacuums and Timers pages' own (a room's row never counts its
    # vacuum or the house's timers)
    utility = {"vacuums", "vacuum_battery", "timers"}
    assert {k for kinds, _ in S.STATUS_ROWS.values() for k in kinds} - utility <= set(S.STATUS_KINDS)
    assert not utility & set(S.STATUS_KINDS)
    assert S.merged({})["rooms"]["status"] == list(S.STATUS_KINDS)


def test_a_page_row_keeps_the_houses_order_and_its_rooms():
    from custom_components.hk_frontend import settings as S, settings_api as A
    updated, errors = A.apply_house({}, {"status_rows.security": {"status": ["doors", "security"],
                                                                  "exclude_areas": ["shed"]}})
    assert not errors
    rows = S.merged(updated)["status_rows"]
    assert rows["security"] == {"status": ["doors", "security"], "exclude_areas": ["shed"]}
    assert rows["lights"]["status"] == ["lights", "outlets"], "the other pages keep their defaults"
    # nothing shown is a choice too: the row is gone
    updated, errors = A.apply_house(updated, {"status_rows.water": {"status": []}})
    assert not errors and S.merged(updated)["status_rows"]["water"] == {"status": [], "exclude_areas": []}
    # a kind the page cannot show, a twice-named one, a stray key, a bad area
    for bad in ({"status": ["locks"]}, {"status": [], "x": 1},
                {"exclude_areas": ["not an id"]}, ["lights"]):
        _, errors = A.apply_house({}, {"status_rows.lights": bad})
        assert "status_rows.lights" in errors, bad
    _, errors = A.apply_house({}, {"status_rows.garden": {"status": []}})
    assert "status_rows.garden" in errors


def test_a_rooms_row_keeps_the_houses_order():
    from custom_components.hk_frontend import settings as S, settings_api as A
    updated, errors = A.apply_house({}, {"rooms.status": ["speakers", "lights", "temperature"]})
    assert not errors and S.merged(updated)["rooms"]["status"] == ["speakers", "lights", "temperature"]
    assert A.HOUSE["rooms.status"](["lights", "lights"]) == ["lights"], "each once"
    for bad in (["sprinklers"], "lights"):
        _, errors = A.apply_house({}, {"rooms.status": bad})
        assert "rooms.status" in errors, bad


def test_the_status_rows_arrive_with_1_10():
    """9 -> 10: Climate's row moves in; a room row saved before gains the new
    kinds in their places; anything else is left alone."""
    from custom_components.hk_frontend import settings as S
    old = {"dashboard": {"climate": {"status": ["humidity"], "exclude_areas": ["outside"]},
                         "rooms": {"status": ["temperature", "fans", "motion"], "headings": False},
                         "sky": {"moon": None}}, "sidebar": True}
    new = S.status_lifted(old)
    assert new["sidebar"] is True and new["dashboard"]["sky"] == {"moon": None}
    assert "climate" not in new["dashboard"]
    assert new["dashboard"]["status_rows"] == {"climate": {"status": ["humidity"], "exclude_areas": ["outside"]}}
    assert new["dashboard"]["rooms"] == {"headings": False, "status": [
        "temperature", "security", "tvs", "lights", "fans", "valves", "motion", "speakers"]}
    merged = S.merged(new)
    assert merged["status_rows"]["climate"]["exclude_areas"] == ["outside"]
    assert merged["status_rows"]["water"]["status"] == ["leaks", "valves"]
    # a house with neither saved, or already moved, is left alone
    assert S.status_lifted({}) is None
    assert S.status_lifted({"dashboard": {"rooms": {"order": ["den"]}}}) is None
    assert S.status_lifted(new) is None


@pytest.mark.parametrize("saved", [None, {"status": ["humidity"], "exclude_areas": []}])
async def test_an_entry_from_1_9_gets_its_status_rows(hass, base, saved):
    from conftest import house_entry
    from custom_components.hk_frontend import settings as S
    options = {"dashboard": {"climate": saved}} if saved else {}
    old = house_entry(minor_version=9, options=options)
    old.add_to_hass(hass)
    assert await hass.config_entries.async_setup(old.entry_id)
    await hass.async_block_till_done()
    assert old.minor_version == 16
    rows = S.merged(old.options)["status_rows"]
    assert rows["climate"]["status"] == (["humidity"] if saved else ["temperature", "humidity", "blinds", "fans"])
