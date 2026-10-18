"""Custom chips (settings.py SUBENTRY_CHIP): status chips the house
writes itself -- a card in YAML -- items of the integration, shown by the
screens that list them (the board's chips_custom), sitting after a kind or
where a screen's own chip order puts them."""
from __future__ import annotations

import json

from homeassistant.config_entries import ConfigSubentry

from conftest import entry
from test_settings_api import _admin

BATTERY = {"type": "custom:hk-status-chip-card", "name": "House Battery", "icon": "hk:home-battery",
           "entity": "sensor.house_battery", "tap_action": {"action": "navigate", "navigation_path": "./ecoflow"}}


async def test_a_chip_is_made_changed_and_sent_to_every_screen(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_chip_save
    conn = await _admin(hass)
    ws_chip_save(hass, conn, {"id": 1, "type": "hk_frontend/chip/save", "name": "House Battery", "after": "end",
                              "card": BATTERY})
    assert conn.sent[-1]["success"], conn.sent[-1]
    chips = S.as_client(entry(hass))["custom_chips"]
    assert [(c["key"], c["name"], c["after"], c["card"]["entity"]) for c in chips] == [
        ("house-battery", "House Battery", "end", "sensor.house_battery")]
    # the same name again is another chip, with its own key
    ws_chip_save(hass, conn, {"id": 2, "type": "hk_frontend/chip/save", "name": "House Battery", "after": "start",
                              "card": BATTERY})
    assert sorted(c["key"] for c in S.custom_chips(entry(hass))) == ["house-battery", "house-battery-2"]
    # changed by its key: name, where it sits, its card
    ws_chip_save(hass, conn, {"id": 3, "type": "hk_frontend/chip/save", "key": "house-battery", "name": "Battery",
                              "after": "lights", "card": {**BATTERY, "icon_color": "green"}})
    c = next(c for c in S.custom_chips(entry(hass)) if c["key"] == "house-battery")
    assert (c["name"], c["after"], c["card"]["icon_color"]) == ("Battery", "lights", "green")


async def test_a_chip_is_refused_by_field(hass, frontend):
    from custom_components.hk_frontend.panel import ws_chip_save
    conn = await _admin(hass)
    ws_chip_save(hass, conn, {"id": 1, "type": "hk_frontend/chip/save", "name": " ", "after": "sofa",
                              "card": {"name": "no type"}})
    assert conn.sent[-1]["error"] == "invalid_format"
    assert json.loads(conn.sent[-1]["message"]) == {"name": "name_needed", "card": "chip_card", "after": "choice"}
    ws_chip_save(hass, conn, {"id": 2, "type": "hk_frontend/chip/save", "key": "gone", "name": "X", "after": "end",
                              "card": BATTERY})
    assert json.loads(conn.sent[-1]["message"]) == {"key": "chip_gone"}


async def test_a_screen_lists_it_and_removing_it_takes_it_off_every_screen(hass, frontend):
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend.panel import ws_board_set, ws_chip_remove, ws_chip_save
    conn = await _admin(hass)
    ws_chip_save(hass, conn, {"id": 1, "type": "hk_frontend/chip/save", "name": "House Battery", "after": "end",
                              "card": BATTERY})
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))
    ws_board_set(hass, conn, {"id": 2, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall",
                              "changes": {"chips_custom": ["house-battery"], "chips": ["lights", "chip:house-battery"]}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    b = S.boards(entry(hass))["dashboard-hall"]
    assert b["chips_custom"] == ["house-battery"] and b["chips"] == ["lights", "chip:house-battery"]
    ws_chip_remove(hass, conn, {"id": 3, "type": "hk_frontend/chip/remove", "key": "house-battery"})
    assert conn.sent[-1]["success"], conn.sent[-1]
    b = S.boards(entry(hass))["dashboard-hall"]
    assert S.custom_chips(entry(hass)) == [] and b["chips_custom"] == [] and b["chips"] == ["lights"]
    ws_chip_remove(hass, conn, {"id": 4, "type": "hk_frontend/chip/remove", "key": "house-battery"})
    assert json.loads(conn.sent[-1]["message"]) == {"key": "chip_gone"}


def test_the_chip_normaliser():
    from custom_components.hk_frontend.settings import custom_chip
    c = custom_chip({"name": "X", "after": "sofa", "card": "not a card"}, "x")
    assert c["after"] == "end" and c["card"]["type"] == "custom:hk-status-chip-card", "a bad card is a plain chip"
