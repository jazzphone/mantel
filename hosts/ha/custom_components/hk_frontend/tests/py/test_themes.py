"""The HK Kiosk themes, added by the integration itself (themes.py), against
the frontend's real theme code: at start, after "Reload themes", beside a
configuration.yaml theme of the same name, and as the server's default."""
from __future__ import annotations

from unittest.mock import patch

from homeassistant import config_entries
from homeassistant.components import frontend as fe
from homeassistant.helpers import issue_registry as ir

DOMAIN = "hk_frontend"
OURS = ("HK Kiosk", "HK Kiosk Camera")


async def _start(hass, yaml_themes=None):
    """The frontend's themes as configuration.yaml gives them, then the
    integration added the way a user adds it."""
    await fe._async_setup_themes(hass, yaml_themes or {})
    fired = []
    hass.bus.async_listen(fe.EVENT_THEMES_UPDATED, fired.append)
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    await hass.config_entries.flow.async_configure(r["flow_id"], {})
    await hass.async_block_till_done()
    return fired


async def _reload(hass, yaml_themes):
    with patch("homeassistant.components.frontend.async_hass_config_yaml",
               return_value={"frontend": {"themes": yaml_themes}}):
        await hass.services.async_call("frontend", "reload_themes", blocking=True)
    await hass.async_block_till_done()


async def test_both_themes_are_added_with_no_configuration_yaml(hass, base):
    fired = await _start(hass)
    themes = hass.data[fe.DATA_THEMES]
    assert set(OURS) <= set(themes)
    assert themes["HK Kiosk"]["ha-font-family-body"].startswith("'SF Pro'")
    assert "hk-glass-bg" in themes["HK Kiosk"], "the glass material"
    assert "modes" in themes["HK Kiosk Camera"]
    assert fired, "open browsers are told to fetch the themes again"
    assert ir.async_get(hass).async_get_issue(DOMAIN, "theme_missing") is None


async def test_a_configuration_yaml_theme_of_the_same_name_wins(hass, base):
    await _start(hass, {"HK Kiosk": {"primary-color": "red"}})
    themes = hass.data[fe.DATA_THEMES]
    assert themes["HK Kiosk"] == {"primary-color": "red"}
    assert "HK Kiosk Camera" in themes


async def test_reload_themes_puts_them_back(hass, base):
    await _start(hass)
    await _reload(hass, {"Other": {"primary-color": "blue"}})
    themes = hass.data[fe.DATA_THEMES]
    assert set(OURS) <= set(themes) and "Other" in themes
    assert ir.async_get(hass).async_get_issue(DOMAIN, "theme_missing") is None


async def test_the_server_default_theme_survives_start_and_reload(hass, base, hass_storage):
    hass_storage[fe.THEMES_STORAGE_KEY] = {
        "version": fe.THEMES_STORAGE_VERSION, "key": fe.THEMES_STORAGE_KEY,
        "data": {"frontend_default_theme": "HK Kiosk", "frontend_default_dark_theme": "HK Kiosk"}}
    await _start(hass)
    assert hass.data["frontend_default_theme"] == "HK Kiosk"
    assert hass.data["frontend_default_dark_theme"] == "HK Kiosk"
    await _reload(hass, {})
    assert hass.data["frontend_default_theme"] == "HK Kiosk"
    assert hass.data["frontend_default_dark_theme"] == "HK Kiosk"


async def test_a_default_someone_chose_since_is_left_alone(hass, base, hass_storage):
    hass_storage[fe.THEMES_STORAGE_KEY] = {
        "version": fe.THEMES_STORAGE_VERSION, "key": fe.THEMES_STORAGE_KEY,
        "data": {"frontend_default_theme": "Other"}}
    await _start(hass, {"Other": {"primary-color": "blue"}})
    assert hass.data["frontend_default_theme"] == "Other"
