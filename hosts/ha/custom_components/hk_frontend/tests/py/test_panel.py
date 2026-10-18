"""The HK Settings page (panel.py): its commands are for admins, read
everything in one go, and write the ordered lists."""
from __future__ import annotations

import pytest

from conftest import entry
from test_accessories import Conn, _admin

DOMAIN = "hk_frontend"


async def test_the_page_reads_everything_in_one_answer(hass, frontend):
    from custom_components.hk_frontend.panel import ws_panel_get
    conn = await _admin(hass)
    ws_panel_get(hass, conn, {"id": 1, "type": "hk_frontend/panel/get"})   # async_response: a task
    # a BACKGROUND task (websocket async_response): the plain wait does not
    # count it, and the answer (a folder scan in the executor) can come later
    await hass.async_block_till_done(wait_background_tasks=True)
    r = conn.sent[-1]["result"]
    assert r["entry_id"] == entry(hass).entry_id
    for k in ("settings", "boards", "dashboards", "popups", "accessories", "kinds", "presets",
              "chip_kinds", "page_kinds", "shelves", "setup_done"):
        assert k in r, k
    assert r["setup_done"] is False and "wall_tablet" in r["presets"]


async def test_setup_done_survives_configure(hass, frontend):
    """The Setup Assistant marks itself done; a Configure page (which saves
    only its own keys) keeps that."""
    from custom_components.hk_frontend.panel import ws_setup_done
    conn = await _admin(hass)
    ws_setup_done(hass, conn, {"id": 2, "type": "hk_frontend/setup/done", "done": True})
    assert entry(hass).options["setup_done"] is True
    r = await hass.config_entries.options.async_init(entry(hass).entry_id)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "panel"})
    await hass.config_entries.options.async_configure(r["flow_id"], {"sidebar": True})
    assert entry(hass).options["setup_done"] is True


async def test_a_screens_lists_through_the_one_write(hass, frontend):
    """A screen's lists (chips, pages, scenes, room order) are written by
    board/set: refused whole when a value is not one it could be."""
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend.panel import ws_board_set
    from custom_components.hk_frontend.settings import as_client
    conn = await _admin(hass)
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))
    ws_board_set(hass, conn, {"id": 1, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall",
                              "changes": {"chips": ["security", "lights", "sensor.mail"], "chips_extra": ["sensor.mail"],
                                          "pages": ["lights", "weather"], "scenes": ["page:live_tv", "scene.bed"],
                                          "scenes_pages": ["live_tv"], "room_order": ["kitchen"], "home_rooms": "only",
                                          "rooms_custom": True}})
    assert conn.sent[-1]["success"], conn.sent[-1]
    b = as_client(entry(hass))["boards"]["dashboard-hall"]
    assert b["chips"] == ["security", "lights", "sensor.mail"] and b["pages"] == ["lights", "weather"]
    assert b["scenes"] == ["page:live_tv", "scene.bed"] and b["room_order"] == ["kitchen"] and b["home_rooms"] == "only"
    ws_board_set(hass, conn, {"id": 2, "type": "hk_frontend/board/set", "dashboard": "dashboard-hall",
                              "changes": {"chips": ["not_a_kind"], "scenes": ["page:rooms"]}})
    assert conn.sent[-1]["success"] is False
    assert as_client(entry(hass))["boards"]["dashboard-hall"]["chips"] == ["security", "lights", "sensor.mail"]


async def test_the_page_is_in_the_sidebar_and_configure_links_to_it(hass, frontend):
    """Set up with the integration, for admins, in the sidebar; the first
    Configure page (behind the integration card's gear) links to it and can
    take it out of the sidebar -- and the gear stays Configure: the page is
    NOT the domain's config panel, which would replace it."""
    from homeassistant.components.frontend import DATA_PANELS
    p = hass.data[DATA_PANELS]["hk-settings"]
    assert p.require_admin and p.show_in_sidebar and p.config_panel_domain is None
    assert p.config["_panel_custom"]["name"] == "hk-settings-panel"
    r = await hass.config_entries.options.async_init(entry(hass).entry_id)
    assert r["menu_options"][0] == "panel", "first on the gear"
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "panel"})
    assert r["description_placeholders"]["url"] == "/hk-settings"
    assert [(k.schema, k.default()) for k in r["data_schema"].schema] == [("sidebar", True)]
    before = dict(entry(hass).options)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"sidebar": False})
    assert r["type"] == "menu"
    await hass.async_block_till_done()
    assert entry(hass).options["sidebar"] is False
    assert {k: v for k, v in entry(hass).options.items() if k != "sidebar"} == before, "nothing else changed"
    p = hass.data[DATA_PANELS]["hk-settings"]
    assert p.show_in_sidebar is False and p.require_admin, "out of the sidebar, still there"
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "panel"})
    assert [(k.schema, k.default()) for k in r["data_schema"].schema] == [("sidebar", False)]
    await hass.config_entries.options.async_configure(r["flow_id"], {"sidebar": True})
    await hass.async_block_till_done()
    assert hass.data[DATA_PANELS]["hk-settings"].show_in_sidebar is True


async def test_a_renamed_dashboard_gives_its_screen_its_new_name(hass, frontend):
    """HK Settings' pencil renames the dashboard with Home Assistant's own
    lovelace/dashboards/update, then dashboard/titled: the screen's item takes
    the title Home Assistant now has -- only that, and only for a dashboard
    there is."""
    from types import SimpleNamespace
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend.panel import ws_dashboard_titled
    conn = await _admin(hass)
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Hall", unique_id="dashboard-hall"))
    real = hass.data.get(LOVELACE_DATA)
    hass.data[LOVELACE_DATA] = SimpleNamespace(dashboards={
        "dashboard-hall": SimpleNamespace(config={"id": "dashboard_hall", "title": "Front Hall", "mode": "storage"})})
    try:
        ws_dashboard_titled(hass, conn, {"id": 1, "type": "hk_frontend/dashboard/titled", "dashboard": "dashboard-hall"})
        assert conn.sent[-1]["success"] and conn.sent[-1]["result"] == {"title": "Front Hall"}, conn.sent[-1]
        sub = next(s for s in entry(hass).subentries.values() if s.unique_id == "dashboard-hall")
        assert sub.title == "Front Hall"
        ws_dashboard_titled(hass, conn, {"id": 2, "type": "hk_frontend/dashboard/titled", "dashboard": "dashboard-gone"})
        assert conn.sent[-1]["success"] is False
    finally:
        if real is None:
            hass.data.pop(LOVELACE_DATA, None)
        else:
            hass.data[LOVELACE_DATA] = real
