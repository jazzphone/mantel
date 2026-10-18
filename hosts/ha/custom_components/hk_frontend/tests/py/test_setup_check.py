"""Configure -> Setup check, and the two Repairs issues behind it
(setup_check.py): what a new house is told, and that it clears itself."""
from __future__ import annotations

from types import SimpleNamespace

from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from conftest import entry

DOMAIN = "hk_frontend"


def test_the_version_floor():
    from custom_components.hk_frontend.setup_check import version_ok
    assert version_ok("2026.8.0") and version_ok("2026.9.3") and version_ok("2027.1.0")
    assert not version_ok("2026.7.4") and not version_ok("2025.12.0")
    assert version_ok("dev"), "a development build is not nagged"


async def test_the_theme_issue_appears_and_clears_itself_on_a_themes_reload(hass, frontend):
    from homeassistant.components.frontend import DATA_THEMES, EVENT_THEMES_UPDATED
    reg = ir.async_get(hass)
    hass.data.pop("hk_frontend_themes")     # themes.py could not read its file
    hass.data[DATA_THEMES] = {}
    hass.bus.async_fire(EVENT_THEMES_UPDATED)
    await hass.async_block_till_done()
    issue = reg.async_get_issue(DOMAIN, "theme_missing")
    assert issue is not None and issue.translation_key == "theme_missing"
    hass.data[DATA_THEMES] = {"HK Kiosk": {}}
    hass.bus.async_fire(EVENT_THEMES_UPDATED)
    await hass.async_block_till_done()
    assert reg.async_get_issue(DOMAIN, "theme_missing") is None
    assert reg.async_get_issue(DOMAIN, "ha_too_old") is None, "the harness is new enough"


def _house(hass):
    """An area that is ready, one that is not, and a device in no area."""
    areas = ar.async_get(hass)
    ready = areas.async_create("Den", icon="mdi:sofa")
    hass.states.async_set("sensor.den_t", "71", {"device_class": "temperature"})
    hass.states.async_set("sensor.den_h", "46", {"device_class": "humidity"})
    areas.async_update(ready.id, temperature_entity_id="sensor.den_t", humidity_entity_id="sensor.den_h")
    areas.async_create("Porch")
    src = MockConfigEntry(domain="demo")
    src.add_to_hass(hass)
    dev = dr.async_get(hass).async_get_or_create(config_entry_id=src.entry_id,
                                                 identifiers={("demo", "lamp")}, name="Hall Lamp")
    er.async_get(hass).async_get_or_create("light", "demo", "lamp", device_id=dev.id,
                                           config_entry=src)
    diag = dr.async_get(hass).async_get_or_create(config_entry_id=src.entry_id,
                                                  identifiers={("demo", "bridge")}, name="Bridge")
    er.async_get(hass).async_get_or_create("sensor", "demo", "bridge_rssi", device_id=diag.id,
                                           config_entry=src, entity_category=er.EntityCategory.DIAGNOSTIC)
    watch = dr.async_get(hass).async_get_or_create(config_entry_id=src.entry_id,
                                                   identifiers={("demo", "watch")}, name="Watch")
    er.async_get(hass).async_get_or_create("device_tracker", "demo", "watch", device_id=watch.id,
                                           config_entry=src)


async def test_the_check_page_says_what_is_ready_and_what_to_fix(hass, frontend):
    _house(hass)
    e = entry(hass)
    r = await hass.config_entries.options.async_init(e.entry_id)
    assert "check" in r["menu_options"]
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "check"})
    assert r["type"] == "form" and r["step_id"] == "check"
    text = r["description_placeholders"]["report"]
    assert text.startswith("**1 thing to fix.**"), text.splitlines()[0]
    assert "⚠️\u2002**HK Kiosk Theme**" in text
    assert "ℹ️\u2002**1 device in no area** — Hall Lamp." in text
    assert "Bridge" not in text and "Watch" not in text, "only devices with a tile count"
    assert "ℹ️\u2002**1 area with no icon** — Porch." in text
    assert "ℹ️\u2002**1 area with no temperature or humidity sensor** — Porch." in text
    assert "ℹ️\u2002**Menu & Room Pages** — Off on every dashboard." in text
    assert "ℹ️\u2002**Live TV** — Not added." in text
    # the things to fix come first
    assert text.index("⚠️") < text.index("✅") < text.index("ℹ️")
    # it saves nothing; submitting goes back to the menu
    before = dict(e.options)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {})
    assert r["type"] == "menu" and dict(e.options) == before


async def test_the_menu_line_names_a_dashboard_that_does_not_exist(hass, frontend):
    from custom_components.hk_frontend import setup_check
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    items = [{"url": "/hk/cards/hk-base.js?v=1"}]
    hass.data[LOVELACE_DATA] = SimpleNamespace(
        dashboards={None: object(), "dashboard-hall": object()}, resource_mode="yaml",
        resources=SimpleNamespace(async_items=lambda: items))
    from custom_components.hk_frontend import settings as S
    lines = await setup_check.async_run(hass, {}, {"dashboard-hall": S.board({"menu": "auto"}),
                                                   "dashboard-gone": S.board({"menu": "off", "menu_phone": "tabbar"}),
                                                   "dashboard-none": S.board({"menu": "off", "menu_phone": "off"})})
    by = {x.title: x for x in lines}
    assert by["Menu & Room Pages"].ok is False and "dashboard-gone" in by["Menu & Room Pages"].detail
    assert "dashboard-hall" not in by["Menu & Room Pages"].detail, "a phones-only menu counts too"
    assert "dashboard-none" not in by["Menu & Room Pages"].detail
    cards = by["Card Files"]
    assert cards.ok is False and "YAML mode" in cards.detail and "/hk/cards/hk-base.js" not in cards.detail
    assert "/hk/cards/hk-room.js" in cards.detail
    lines = await setup_check.async_run(hass, {}, {"dashboard-hall": S.board({"menu": "off", "menu_phone": "button"})})
    assert {x.title: x for x in lines}["Menu & Room Pages"].ok is True


async def test_the_menu_line_reads_the_dashboard_items(hass, frontend):
    """The menu is on where a dashboard's item says so."""
    from custom_components.hk_frontend import setup_check
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    hass.data[LOVELACE_DATA] = SimpleNamespace(
        dashboards={None: object(), "dashboard-hall": object()}, resource_mode="storage",
        resources=SimpleNamespace(async_items=lambda: []))
    boards = {"dashboard-hall": {"menu": "open"}, "dashboard-den": {"menu": "off"}}
    line = {x.title: x for x in await setup_check.async_run(hass, {}, boards)}["Menu & Room Pages"]
    assert line.ok is True and "1 dashboard" in line.detail, "an item with the menu off does not count"
    boards["dashboard-gone"] = {"menu": "tab"}
    line = {x.title: x for x in await setup_check.async_run(hass, {}, boards)}["Menu & Room Pages"]
    assert line.ok is False and "dashboard-gone" in line.detail and "Dashboards" in line.detail


async def test_the_screensaver_lines(hass, frontend, monkeypatch):
    """WallPanel is only a line for a screen that chooses it; a screen with a
    photo screensaver gets a line counting its photos."""
    from custom_components.hk_frontend import setup_check
    from homeassistant.components import media_source
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    hass.data[LOVELACE_DATA] = SimpleNamespace(
        dashboards={None: object()}, resource_mode="storage", resources=SimpleNamespace(async_items=lambda: []))
    kid = lambda cls, exp: SimpleNamespace(media_class=cls, media_content_type="image/jpeg" if cls == "image" else "",
                                           can_expand=exp)
    folder = {"children": [kid("image", False), kid("image", False), kid("directory", True)]}

    async def browse(_hass, _id):
        if folder is None:
            raise ValueError("no such folder")
        return SimpleNamespace(children=folder["children"])
    monkeypatch.setattr(media_source, "async_browse_media", browse)
    titles = lambda lines: {x.title: x for x in lines}
    lines = titles(await setup_check.async_run(hass, {}, {"dashboard-k": {"menu": "open"}}))
    assert "WallPanel" not in lines and "Screensaver Photos" not in lines, "no screensaver, neither line"
    lines = titles(await setup_check.async_run(hass, {}, {"dashboard-k": {"menu": "open", "screensaver": True}}))
    assert "WallPanel" not in lines, "HK Frontend draws the screensaver itself"
    assert lines["Screensaver Photos"].ok is True and "2 photos" in lines["Screensaver Photos"].detail \
        and "1 folder" in lines["Screensaver Photos"].detail
    lines = titles(await setup_check.async_run(hass, {}, {"dashboard-k": {"screensaver": True,
                                                                          "screensaver_engine": "wallpanel"}}))
    assert "WallPanel" in lines, "a screen that chooses WallPanel is told whether it is ready"
    lines = titles(await setup_check.async_run(hass, {}, {"k": {"kiosk": True, "kiosk_engine": "hk"}}))
    assert "Kiosk Mode" not in lines, "HK Frontend hides Home Assistant's header and sidebar itself"
    lines = titles(await setup_check.async_run(hass, {}, {"k": {"kiosk": True, "kiosk_engine": "kiosk_mode"}}))
    assert "Kiosk Mode" in lines, "a screen that chooses the Kiosk Mode plugin is told whether it is ready"
    folder["children"] = []
    line = titles(await setup_check.async_run(hass, {}, {"k": {"screensaver": True}}))["Screensaver Photos"]
    assert line.ok is None and "empty" in line.detail and "forecast" in line.detail, \
        "no photos is not a fault: the forecast shows instead"
    folder = None
    line = titles(await setup_check.async_run(hass, {}, {"k": {"screensaver": True}}))["Screensaver Photos"]
    assert line.ok is None and "can’t read" in line.detail and "forecast" in line.detail
    lines = titles(await setup_check.async_run(hass, {}, {"k": {"screensaver": True,
                                                              "screensaver_options": {"show": "forecast"}}}))
    assert "Screensaver Photos" not in lines, "a screen set to Forecast never looks for photos"
    folder = {"children": []}
    line = titles(await setup_check.async_run(hass, {}, {"k": {"screensaver": True,
                                                             "screensaver_options": {"fallback": False}}}))["Screensaver Photos"]
    assert line.ok is False and "stays dark" in line.detail, "fallback off: no photos is a dark screen again"
    line = titles(await setup_check.async_run(hass, {}, {"k": {"screensaver": True, "screensaver_options":
                                                             {"fallback": False, "show": "both"}}}))["Screensaver Photos"]
    assert line.ok is None and "forecast" in line.detail, "Photos & Forecast: no photos is the forecast, never dark"


async def test_wall_tablets_need_their_user_screen_and_kiosk(hass, frontend, monkeypatch):
    """A screen's screensaver runs only on a wall tablet: none, or a tablet
    whose user Home Assistant doesn't have, is a thing to fix -- otherwise it
    just never shows and nothing says why. (1.14: the tablets' own items.)"""
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend import settings as S, setup_check
    from homeassistant.components import media_source
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    hass.data[LOVELACE_DATA] = SimpleNamespace(
        dashboards={None: object(), "dashboard-k": SimpleNamespace(config={"title": "Kitchen"})},
        resource_mode="storage", resources=SimpleNamespace(async_items=lambda: []))

    async def browse(_hass, _id):
        return SimpleNamespace(children=[])
    monkeypatch.setattr(media_source, "async_browse_media", browse)
    await hass.auth.async_create_user("Kitchen Tablet")
    ent = entry(hass)

    async def line():
        return {x.title: x for x in await setup_check.async_run(hass, {}, S.boards(ent))}.get("Wall Tablets")
    assert await line() is None, "no screensaver and no tablet: no line"
    screen = ConfigSubentry(data={"screensaver": True}, subentry_type="dashboard", title="Kitchen",
                            unique_id="dashboard-k")
    hass.config_entries.async_add_subentry(ent, screen)
    got = await line()
    assert got.ok is False and "no wall tablet runs" in got.detail
    tab = ConfigSubentry(data={"name": "Kitchen", "screen": "dashboard-k", "user": "Kitchen Tablett",
                               "app": "kiosk_satellite"}, subentry_type="tablet", title="Kitchen", unique_id="kitchen")
    hass.config_entries.async_add_subentry(ent, tab)
    got = await line()
    assert got.ok is False and "no Home Assistant user “Kitchen Tablett”" in got.detail
    assert "its kiosk app’s device isn’t chosen" in got.detail
    hass.config_entries.async_update_subentry(ent, tab, data={**tab.data, "user": "Kitchen Tablet", "app": "browser"})
    got = await line()
    assert got.ok is True and got.detail == "1 tablet, each set up right."


def test_a_name_from_an_integration_is_text_never_markdown():
    """Device and area names reach a line that is Markdown (Configure renders
    it; the settings page turns its first link into the row's href). A name
    shaped like a link must stay text in both."""
    import re
    from custom_components.hk_frontend import setup_check as S
    evil = "[x](javascript:alert(1))"
    line = S._names([evil, "Lamp"]) + ". [Assign them](/config/devices/dashboard)."
    links = re.findall(r"(?<!\\)\[([^\]]+)\]\(([^)\s]+)\)", line)
    assert links == [("Assign them", "/config/devices/dashboard")], links
    assert S._plain("Emma’s *Lamp* (2)") == r"Emma’s \*Lamp\* \(2\)"


async def test_the_adaptive_lighting_line(hass):
    """Optional: found, not installed, or the Lights page told not to follow."""
    from custom_components.hk_frontend import setup_check as SC
    line = SC.adaptive_lighting_line(hass, {})
    assert line.ok is None and "Not installed" in line.detail
    hass.states.async_set("switch.adaptive_lighting_default", "on", {"color_temp_kelvin": 3000})
    assert SC.adaptive_lighting_line(hass, {}).ok is True
    from custom_components.hk_frontend.settings import CONF_DASHBOARD
    off = SC.adaptive_lighting_line(hass, {CONF_DASHBOARD: {"headers": {"lights": {"sky_follow": False}}}})
    assert off.ok is None and "doesn’t follow" in off.detail
