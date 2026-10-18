"""Configure: every setting is on the HK Settings page, and HA's Configure
is only the way there -- the page's link and sidebar switch, Your files and
Setup check. A dashboard item is still added through its flow (what it is
shown on sets its starting values); its gear points at the screen's page."""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from conftest import entry

HERE = os.path.dirname(os.path.abspath(__file__))
from conftest import COMPONENT, DOCS  # noqa: E402
TR = json.load(open(os.path.join(COMPONENT, "translations", "en.json")))
# the docs, every page: each group of HK Settings is documented on its topic's page
DOC = "\n".join(open(os.path.join(DOCS, f), encoding="utf-8").read()
                for f in sorted(os.listdir(DOCS)) if f.endswith(".md"))


async def test_configure_is_the_way_to_the_page(hass, frontend):
    r = await hass.config_entries.options.async_init(entry(hass).entry_id)
    assert r["type"] == "menu" and r["menu_options"] == ["panel", "files", "linked", "check", "done"]
    assert r["description_placeholders"]["url"] == "/hk-settings"
    assert "hk settings page" in TR["options"]["step"]["init"]["description"].lower()
    # a page saves its own key and comes back, saying so; Done closes
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "panel"})
    before = dict(entry(hass).options)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"sidebar": True})
    assert r["type"] == "menu" and r["description_placeholders"]["saved"] == "Saved: HK Settings page."
    assert {k: v for k, v in entry(hass).options.items() if k != "sidebar"} == \
        {k: v for k, v in before.items() if k != "sidebar"}
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "done"})
    assert r["type"] == "create_entry"
    # the house's own Configure pages (a feature's are its own, `<kind>_…`)
    from custom_components.hk_frontend.features import KINDS
    own = {k for k in TR["options"]["step"] if not k.startswith(KINDS)}
    assert own == {"init", "panel", "files", "linked", "check"}, "no page left behind"


@pytest.fixture
def dashboards():
    """Two dashboards for the picker (the harness has no lovelace)."""
    async def boards(_hass):
        return ["dashboard-hall", "dashboard-kitchen"]
    with patch("custom_components.hk_frontend.config_flow._dashboards", boards):
        yield


async def _add(hass, path, kind="custom", generated=False):
    e = entry(hass)

    async def gen(_hass):
        return [path] if generated else []
    with patch("custom_components.hk_frontend.config_flow._strategy_dashboards", gen):
        r = await hass.config_entries.subentries.async_init((e.entry_id, "dashboard"), context={"source": "user"})
        assert r["type"] == "form" and r["step_id"] == "user"
        r = await hass.config_entries.subentries.async_configure(r["flow_id"], {"dashboard": path})
        assert r["type"] == "form" and r["step_id"] == "kind"
        return await hass.config_entries.subentries.async_configure(r["flow_id"], {"kind": kind})


async def test_adding_a_dashboard_is_which_and_what_it_is_shown_on(hass, frontend, dashboards):
    from custom_components.hk_frontend.settings import as_client
    r = await _add(hass, "dashboard-kitchen", kind="wall_tablet")
    assert r["type"] == "create_entry" and r["unique_id"] == "dashboard-kitchen"
    b = as_client(entry(hass))["boards"]["dashboard-kitchen"]
    assert (b["menu"], b["time_weather"], b["kiosk"], b["car"]) == ("open", "menu", True, False)
    assert "kind" not in dict(next(iter(entry(hass).subentries.values())).data), "nothing remembers the preset"
    # a hand-written dashboard with no preset menu starts with it OFF
    r = await _add(hass, "dashboard-hall")
    assert as_client(entry(hass))["boards"]["dashboard-hall"]["menu"] == "off"
    # one that has an item is not offered again; none left: nothing to add
    e = entry(hass)
    r = await hass.config_entries.subentries.async_init((e.entry_id, "dashboard"), context={"source": "user"})
    assert r["type"] == "abort" and r["reason"] == "no_dashboards"


async def test_a_generated_dashboard_starts_with_its_menu(hass, frontend, dashboards):
    from custom_components.hk_frontend.settings import as_client
    r = await _add(hass, "dashboard-hall", generated=True)
    assert r["type"] == "create_entry"
    assert as_client(entry(hass))["boards"]["dashboard-hall"]["menu"] == "auto"
    r = await _add(hass, "dashboard-kitchen", kind="car")
    b = as_client(entry(hass))["boards"]["dashboard-kitchen"]
    assert (b["menu"], b["car"], b["kiosk"]) == ("off", True, True)


async def test_an_energy_display_is_only_the_energy_page(hass, frontend, dashboards):
    """Shown On -> Energy Display: no Home, only the Energy page (`energy`
    among its pages is the Energy feature's), no menu, no header."""
    from custom_components.hk_frontend.settings import as_client
    r = await _add(hass, "dashboard-hall", kind="energy", generated=True)
    assert r["type"] == "create_entry"
    b = as_client(entry(hass))["boards"]["dashboard-hall"]
    assert (b["home_page"], b["only_pages"], b["pages"], b["menu"], b["kiosk"]) == (False, ["energy"], [], "off", True)


async def test_its_gear_points_at_the_screens_page(hass, frontend, dashboards):
    await _add(hass, "dashboard-hall", kind="personal")
    e = entry(hass)
    sid = next(iter(e.subentries))
    before = dict(e.subentries[sid].data)
    r = await hass.config_entries.subentries.async_init(
        (e.entry_id, "dashboard"), context={"source": "reconfigure", "subentry_id": sid})
    assert r["type"] == "abort" and r["reason"] == "use_panel"
    assert r["description_placeholders"]["url"] == "/hk-settings#/screens/dashboard-hall"
    assert dict(e.subentries[sid].data) == before, "nothing changed"
    assert "{url}" in TR["config_subentries"]["dashboard"]["abort"]["use_panel"]


def test_every_field_left_is_labelled_and_documented():
    """No field of what is left of Configure without a label, and the page and
    its names in the docs (docs/*.md)."""
    opts = TR["options"]["step"]
    assert opts["panel"]["data"]["sidebar"] and opts["files"]["data"]["files_folder"]
    dash = TR["config_subentries"]["dashboard"]["step"]
    assert set(dash) == {"user", "kind"} and dash["kind"]["data"]["kind"]
    for name in ("HK Settings page", "Show HK Settings in the sidebar", "Your files", "Setup check",
                 "General", "Status & Chips", "Weather", "Appearance", "Sky", "Menu", "Rooms", "Music",
                 "Wall Tablets", "Accessories", "Pop-ups", "Custom Pages", "Advanced"):
        assert name.lower() in DOC.lower(), name
    for kind in ("popup", "page"):
        steps = TR["config_subentries"][kind]["step"]
        for step, body in steps.items():
            for field, label in (body.get("data") or {}).items():
                assert label, f"{kind}.{step}.{field}"
