"""The Overview -- Home Assistant's default dashboard, keyed None in Lovelace's
data -- is a dashboard like any other to HK Frontend, at the address
"lovelace" (lovelace_boards.py). Before 2026-10-12 it was skipped everywhere,
so it could not be added under Existing Dashboards."""
from types import SimpleNamespace

import pytest


@pytest.fixture
def boards(hass):
    from homeassistant.components.lovelace.const import LOVELACE_DATA

    class Board(SimpleNamespace):
        async def async_load(self, force):
            return self.cfg

    real = hass.data.get(LOVELACE_DATA)
    hass.data[LOVELACE_DATA] = SimpleNamespace(dashboards={
        # the Overview: no entry in the dashboards collection, no title
        None: Board(config=None, mode="storage",
                    cfg={"views": [{"title": "Home"}, {"title": "Garden", "path": "garden"}]}),
        "dashboard-hall": Board(config={"id": "dashboard_hall", "title": "Front Hall", "mode": "storage"},
                                mode="storage", cfg={"views": [{"title": "Hall"}]}),
    })
    yield
    if real is None:
        hass.data.pop(LOVELACE_DATA, None)
    else:
        hass.data[LOVELACE_DATA] = real


async def test_the_overview_has_an_address_and_a_name(hass, boards):
    from custom_components.hk_frontend import lovelace_boards as LB
    assert set(LB.all_boards(hass)) == {"lovelace", "dashboard-hall"}
    assert LB.get(hass, "lovelace") is LB._raw(hass)[None]
    assert LB.title(hass, "lovelace") == "Overview"
    assert LB.title(hass, "dashboard-hall") == "Front Hall"
    assert LB.title(hass, "dashboard-gone") == "dashboard-gone"
    assert LB.get(hass, "dashboard-gone") is None
    assert LB.mode(LB.get(hass, "lovelace")) == "storage"


async def test_hk_settings_lists_the_overview_without_a_rename(hass, boards):
    """In the list HK Settings offers under Existing Dashboards, by its
    address, as "Overview", and with no `id` -- so no pencil to rename it
    (the dashboards collection has no entry for it to update)."""
    from custom_components.hk_frontend.panel import _dashboards
    out = {d["path"]: d for d in await _dashboards(hass)}
    assert out["lovelace"]["title"] == "Overview"
    assert out["lovelace"]["id"] is None and out["lovelace"]["mode"] == "storage"
    assert out["lovelace"]["generated"] is False
    assert out["dashboard-hall"]["id"] == "dashboard_hall"


async def test_the_add_flow_and_the_menu_find_the_overview(hass, boards):
    from custom_components.hk_frontend.config_flow import _dashboard_title, _dashboards, _importable
    from custom_components.hk_frontend.panel import _menu_layout
    assert "lovelace" in await _dashboards(hass)
    assert await _dashboard_title(hass, "lovelace") == "Overview"
    # its pages: the menu reads its views, a custom page can start from one
    assert [p["path"] for p in await _menu_layout(hass, "lovelace")] == ["garden"]
    assert (await _importable(hass)).get("lovelace/garden") == "Garden · Overview"
