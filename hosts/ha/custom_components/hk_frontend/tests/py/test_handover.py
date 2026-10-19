"""The bridge hand-over, HK Frontend's side (handover.py; Mantel's
docs/phase9/MANTEL-LINK.md): this release tells Mantel it can hand over (the
link's `bridge` feature); while Mantel Link holds the bridge nothing of Mantel's
is mirrored here, and hk_frontend.set_black_screen still reaches every wall
tablet (this integration's own switches, Mantel Link's through
mantel.set_black_screen); an entity this integration adds whose unique id
Mantel Link holds is taken back with its entity id, never added beside it."""
from __future__ import annotations

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers import entity_registry as er

from conftest import house_entry
from mantel_fake import BLACK, ENTRY, FULL, INUSE, PHOTOS, SLEEP, TOKEN, FakeMantel, until

DOMAIN = "hk_frontend"
AWAY = {**FULL, "bridge": "mantel"}


@pytest.fixture
async def mantel(socket_enabled):
    fake = await FakeMantel().start()
    yield fake
    await fake.close()


async def _set_up(hass, mantel, owners):
    mantel.owners = dict(owners)
    e = house_entry(entry_id=ENTRY, data={"mantel_link": {"url": mantel.url, "token": TOKEN}, "mantel_owners": owners})
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    from custom_components.hk_frontend import linked_mode
    await until(hass, lambda: linked_mode.active(hass) is not None and linked_mode.active(hass).connected)
    return e


async def test_this_release_says_it_can_hand_over(hass, base, mantel):
    e = await _set_up(hass, mantel, FULL)
    assert mantel.headers[-1]["X-Mantel-Link"] == "domain=hk_frontend; protocol=1; features=bridge"
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    assert er.async_get(hass).async_get(BLACK).platform == DOMAIN
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_mantel_link_holds_the_bridge_nothing_mirrored_here(hass, base, mantel):
    e = await _set_up(hass, mantel, AWAY)
    await hass.async_block_till_done()
    for eid in (BLACK, PHOTOS, SLEEP, INUSE):
        assert hass.states.get(eid) is None
    from custom_components.hk_frontend import linked_mode
    assert linked_mode.active(hass).entities == {} and "Mantel Link holds the bridge" in linked_mode.describe(e)
    from custom_components.hk_frontend.diagnostics import async_get_config_entry_diagnostics
    assert (await async_get_config_entry_diagnostics(hass, e))["linked"]["owners"]["bridge"] == "mantel"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_the_bridge_handed_over_while_mirroring_lets_go_at_once(hass, base, mantel):
    e = await _set_up(hass, mantel, FULL)
    await until(hass, lambda: hass.states.get(BLACK) is not None and hass.states.get(BLACK).state == "off")
    mantel.owners = dict(AWAY)
    await mantel.push({"type": "owners", "owners": AWAY})
    await until(hass, lambda: e.data["mantel_owners"]["bridge"] == "mantel")
    from homeassistant.helpers.entity import entity_sources
    await until(hass, lambda: BLACK not in entity_sources(hass))
    assert hass.states.get(BLACK) is None or hass.states.get(BLACK).state == "unavailable"
    assert er.async_get(hass).async_get(BLACK) is not None, "the registry entry stays, for Mantel Link to take"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_set_black_screen_reaches_mantel_link_s_switches(hass, base, mantel):
    calls = []

    async def mantel_link_black(call):
        calls.append(dict(call.data))
    hass.services.async_register("mantel", "set_black_screen", mantel_link_black)
    link = MockConfigEntry(domain="mantel")
    link.add_to_hass(hass)
    er.async_get(hass).async_get_or_create("switch", "mantel", f"{ENTRY}_hall_black_screen",
                                           suggested_object_id="hall_black_screen", config_entry=link)
    e = await _set_up(hass, mantel, AWAY)
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True, "brightness": 7},
                                   blocking=True)
    assert calls == [{"entity_id": [BLACK], "black": True, "brightness": 7}]
    assert mantel.calls() == [], "not forwarded over HK Frontend's own link"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_an_entity_mantel_link_holds_is_taken_back_with_its_id(hass, base, mantel):
    """The bridge is HK Frontend's again (or Mantel Link was removed): the
    registry entries Mantel Link holds come back here, entity ids and all."""
    link = MockConfigEntry(domain="mantel")
    link.add_to_hass(hass)
    reg = er.async_get(hass)
    held = reg.async_get_or_create("switch", "mantel", f"{ENTRY}_hall_black_screen",
                                   suggested_object_id="hall_tablet_darkness", config_entry=link)
    e = await _set_up(hass, mantel, FULL)
    await until(hass, lambda: hass.states.get("switch.hall_tablet_darkness") is not None)
    ent = reg.async_get("switch.hall_tablet_darkness")
    assert ent.id == held.id and ent.platform == DOMAIN and ent.config_entry_id == e.entry_id
    assert hass.states.get(BLACK) is None, "never a second entity beside it"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_configure_fills_in_mantel_link_s_address(hass, frontend):
    """HK Frontend's last release: Configure -> Linked to Mantel offers the address Mantel Link is linked to (it
    found Mantel itself); a plain address that isn't this machine's or the App network's is never offered."""
    from conftest import entry
    e = entry(hass)
    MockConfigEntry(domain="mantel", data={"url": "https://mantel.example.com", "token": "t"}).add_to_hass(hass)
    r = await hass.config_entries.options.async_init(e.entry_id)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "linked"})
    defaults = {str(k): k.default() for k in r["data_schema"].schema if hasattr(k, "default") and callable(k.default)}
    assert r["step_id"] == "linked" and defaults["url"] == "https://mantel.example.com"
    hass.config_entries.async_update_entry(hass.config_entries.async_entries("mantel")[0],
                                           data={"url": "http://192.0.2.4:8099", "token": "t"})
    r = await hass.config_entries.options.async_init(e.entry_id)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "linked"})
    defaults = {str(k): k.default() for k in r["data_schema"].schema if hasattr(k, "default") and callable(k.default)}
    assert defaults["url"] != "http://192.0.2.4:8099"
