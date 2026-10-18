"""HK as its own panel (hk_panel.py, Phase 2 P2.6): off by default -- nothing registered and
nothing a screen is sent changes -- until `hk_panel` is set; then a panel_custom for everyone
(or admins), in the sidebar unless not, that follows the setting and goes with the entry."""
from __future__ import annotations

import json

import pytest

from conftest import FakeConnection, entry

URL = "hk-panel"


class Conn(FakeConnection):
    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "error": code, "message": message})


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


def _panels(hass):
    from homeassistant.components.frontend import DATA_PANELS
    return hass.data[DATA_PANELS]


async def _set(hass, conn, value, msg_id=1):
    from custom_components.hk_frontend.panel import ws_settings_set
    ws_settings_set(hass, conn, {"id": msg_id, "type": "hk_frontend/settings/set", "changes": {"hk_panel": value}})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


def _hall(hass):
    from homeassistant.config_entries import ConfigSubentry
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={"glass": "blur"}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))


async def test_off_by_default_nothing_is_registered_and_the_feed_is_unchanged(hass, frontend):
    """THE PIN: a house that never switches it on has no HK panel, no option, and the
    settings feed every screen gets carries exactly the boards it did."""
    from custom_components.hk_frontend import hk_panel, ws_settings_subscribe
    from custom_components.hk_frontend import settings as S
    _hall(hass)
    await hass.async_block_till_done()
    assert URL not in _panels(hass)
    assert "hk-settings" in _panels(hass), "the HK Settings page is still there"
    assert hk_panel.OPTION not in entry(hass).options
    assert hk_panel.settings(entry(hass).options) is None
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    boards = screen.sent[-1]["event"]["boards"]
    assert set(boards) == set(S.as_client(entry(hass))["boards"]) and URL not in boards
    # a reload of the entry (an update pass) with it still off registers nothing either
    hass.config_entries.async_update_entry(entry(hass), options={**entry(hass).options, "sidebar": False})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert URL not in _panels(hass)


async def test_switched_on_it_is_a_custom_panel_drawing_the_chosen_screen(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    _hall(hass)
    conn = await _admin(hass)
    r = await _set(hass, conn, {"screen": "dashboard-hall"})
    assert r["success"], r
    p = _panels(hass)[URL]
    assert p.component_name == "custom" and p.sidebar_title == "HK" and p.show_in_sidebar
    assert p.require_admin is False, "a screen, for everyone, like a dashboard"
    pc = p.config["_panel_custom"]
    assert pc["name"] == "hk-ha-panel" and pc["module_url"].startswith("/hk/modules/hk-ha-panel.js?v=")
    assert pc["embed_iframe"] is False
    assert p.config["screen"] == "dashboard-hall"
    assert ["module", "/hk/cards/hk-strategy.js"] in p.config["resources"] or p.config["resources"] == []
    # the chosen screen's settings also under the panel's address (its first segment)
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    boards = screen.sent[-1]["event"]["boards"]
    assert boards[URL] == boards["dashboard-hall"] and boards[URL]["glass"] == "blur"


async def test_it_follows_the_setting_and_goes_when_switched_off(hass, frontend):
    conn = await _admin(hass)
    await _set(hass, conn, {"screen": "", "admin": True, "sidebar": False})
    p = _panels(hass)[URL]
    assert p.require_admin is True and p.show_in_sidebar is False and p.config["screen"] == ""
    await _set(hass, conn, {"screen": "dashboard-hall"}, 2)
    p = _panels(hass)[URL]
    assert p.require_admin is False and p.show_in_sidebar is True and p.config["screen"] == "dashboard-hall"
    r = await _set(hass, conn, None, 3)
    assert r["success"] and URL not in _panels(hass)
    await _set(hass, conn, {"screen": "dashboard-hall"}, 4)
    await _set(hass, conn, False, 5)
    assert URL not in _panels(hass)


@pytest.mark.parametrize("bad", ["dashboard-hall", True, {"screen": "Bad Name"}, {"screen": "x", "admin": "yes"},
                                 {"screen": "x", "colour": "red"}, [1]])
async def test_a_value_it_cannot_be_is_refused_and_nothing_is_registered(hass, frontend, bad):
    conn = await _admin(hass)
    r = await _set(hass, conn, bad)
    assert r["success"] is False and r["error"] == "invalid_format"
    assert json.loads(r["message"]) == {"hk_panel": "hk_panel"}
    assert URL not in _panels(hass) and "hk_panel" not in entry(hass).options


async def test_only_admins_switch_it(hass, frontend):
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.panel import ws_settings_set
    await hass.auth.async_create_user("Owner")          # the first user is the owner, an admin
    tablet = Conn(await hass.auth.async_create_user("Kitchen"))
    with pytest.raises(Unauthorized):
        ws_settings_set(hass, tablet, {"id": 1, "type": "hk_frontend/settings/set",
                                       "changes": {"hk_panel": {"screen": ""}}})
    assert URL not in _panels(hass)


async def test_it_is_registered_at_start_when_on_and_goes_with_the_entry(hass, frontend):
    e = entry(hass)
    hass.config_entries.async_update_entry(e, options={**e.options, "hk_panel": {"screen": "dashboard-hall"}})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert URL in _panels(hass)
    assert await hass.config_entries.async_unload(e.entry_id)
    await hass.async_block_till_done()
    assert URL not in _panels(hass) and "hk-settings" not in _panels(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    assert URL in _panels(hass), "set up again with it on: registered at start"


def test_the_setting_reads_only_what_it_can_be():
    from custom_components.hk_frontend import hk_panel
    assert hk_panel.settings({}) is None and hk_panel.settings(None) is None
    assert hk_panel.settings({"hk_panel": None}) is None and hk_panel.settings({"hk_panel": "x"}) is None
    assert hk_panel.settings({"hk_panel": {"screen": "../x"}}) is None
    assert hk_panel.settings({"hk_panel": {"screen": "dashboard-hall"}}) == {
        "screen": "dashboard-hall", "admin": False, "sidebar": True}
    assert hk_panel.check({"screen": None}) == {"screen": ""}
    payload = {"boards": {"a-b": {"x": 1}}}
    assert hk_panel.mirror(payload, {}) is payload and payload == {"boards": {"a-b": {"x": 1}}}
    assert hk_panel.mirror({"boards": {"a-b": {"x": 1}}}, {"hk_panel": {"screen": "a-b"}})["boards"][URL] == {"x": 1}
    assert URL not in hk_panel.mirror({"boards": {}}, {"hk_panel": {"screen": "a-b"}})["boards"]
