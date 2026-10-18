"""The integration's own entity, the Seasonal decorations switch, and an
entry from an older version upgraded to the current one."""
from __future__ import annotations

from homeassistant.helpers import entity_registry as er

from conftest import FakeConnection, entry

DOMAIN = "hk_frontend"
# The newest entry version (config_flow.py): every migration test ends there.
from custom_components.hk_frontend.config_flow import HkFrontendConfigFlow  # noqa: E402
LATEST = HkFrontendConfigFlow.MINOR_VERSION
SWITCH = "switch.hk_frontend_seasonal_decorations"


# ------------------------------------------------------------ the switch
async def test_the_seasonal_switch_is_the_setting(hass, frontend):
    assert hass.states.get(SWITCH).state == "on"
    reg = er.async_get(hass)
    ent = reg.async_get(SWITCH)
    assert ent.unique_id == f"{entry(hass).entry_id}_seasonal_decorations"
    conn = FakeConnection(None)
    from custom_components.hk_frontend import ws_settings_subscribe
    ws_settings_subscribe(hass, conn, {"id": 1})
    await hass.services.async_call("switch", "turn_off", {"entity_id": SWITCH}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get(SWITCH).state == "off"
    assert entry(hass).options["dashboard"]["sky"]["decorations"] is False
    assert conn.sent[-1]["event"]["sky"]["decorations"] is False, "screens were told"
    assert await hass.config_entries.async_reload(entry(hass).entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(SWITCH).state == "off", "it survives a reload"


# ------------------------------------------------ an entry from an older version
async def test_an_old_entry_is_upgraded_to_the_current_minor_version(hass, base):
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    old = MockConfigEntry(domain=DOMAIN, title="HK Frontend", version=1, minor_version=2,
                          unique_id=DOMAIN, data={}, options={})
    old.add_to_hass(hass)
    assert await hass.config_entries.async_setup(old.entry_id)
    assert old.minor_version == LATEST
