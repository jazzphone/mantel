"""Clean Areas, a feature of HK Frontend: added from Add feature (an item of
the house's entry), its action, its gear, and a Clean Areas entry of a
pre-release of 1.0 folded into the house's entry."""
from __future__ import annotations

from homeassistant.setup import async_setup_component

from conftest import (DOMAIN, add_feature, entry, feature_entries, feature_gear, house_entry,
                      pre_release_entry, update_feature)


async def test_added_from_the_feature_menu_once(hass, frontend):
    r = await add_feature(hass, "clean_areas", {"vacuums": ["vacuum.downstairs"]})
    assert r["type"] == "create_entry" and r["title"] == "Clean Areas"
    (e,) = feature_entries(hass, "clean_areas")
    assert e.options == {"vacuums": ["vacuum.downstairs"]}
    assert e.unique_id == "feature:clean_areas" and e.loaded
    assert hass.services.has_service(DOMAIN, "clean_areas")
    # one per house: the menu no longer offers it
    flows = hass.config_entries.subentries
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert "clean_areas" not in r["menu_options"] and "alarm_pin" in r["menu_options"]
    flows.async_abort(r["flow_id"])


async def test_a_second_opened_before_the_first_was_added_is_refused(hass, frontend):
    """Two Add feature forms open at once: the second finds it added."""
    flows = hass.config_entries.subentries
    early = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert "clean_areas" in early["menu_options"]
    await add_feature(hass, "clean_areas", {})
    r = await flows.async_configure(early["flow_id"], {"next_step_id": "clean_areas"})
    assert r["type"] == "abort" and r["reason"] == "already_configured"
    assert len(feature_entries(hass, "clean_areas")) == 1


async def test_its_gear_keeps_what_it_does_not_show(hass, frontend):
    await add_feature(hass, "clean_areas", {})
    (e,) = feature_entries(hass, "clean_areas")
    update_feature(hass, e, options={**e.options, "future": 1})
    await hass.async_block_till_done()
    r = await feature_gear(hass, e)
    assert r["type"] == "form" and r["step_id"] == "clean_areas_options"
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"vacuums": ["vacuum.up"], "areas": ["kitchen"]})
    await hass.async_block_till_done()
    assert r["type"] == "abort" and r["reason"] == "reconfigure_successful"
    assert e.options == {"vacuums": ["vacuum.up"], "areas": ["kitchen"], "future": 1}


async def test_the_action_says_when_the_feature_is_not_added(hass, frontend):
    import pytest
    from homeassistant.exceptions import ServiceValidationError
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "clean_areas", {"areas": ["kitchen"]}, blocking=True,
                                       return_response=True)


async def test_a_pre_release_clean_areas_entry_is_folded_into_the_house(hass, base):
    """A Clean Areas of a pre-release of 1.0 (an entry of its own) becomes an
    item of the house's entry at start, with the entry's id, and is running."""
    from custom_components.hk_frontend import features as F
    house = house_entry()
    house.add_to_hass(hass)
    old = pre_release_entry("clean_areas", {}, {"vacuums": ["vacuum.downstairs"], "areas": ["kitchen"]},
                            unique_id="clean_areas")
    old.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    (e,) = feature_entries(hass, "clean_areas")
    assert e.entry_id == old.entry_id and e.title == "Clean Areas"
    assert e.unique_id == F.unique_id("clean_areas")
    assert dict(house.subentries[e.entry_id].data) == F.item_data("clean_areas", old.data, old.options)
    assert e.options == {"vacuums": ["vacuum.downstairs"], "areas": ["kitchen"]}
    assert e.data == {"kind": "clean_areas"}
    assert hass.config_entries.async_get_entry(old.entry_id) is None, "the old entry is gone"
    assert hass.config_entries.async_entries(DOMAIN) == [entry(hass)] == [house]
    assert e.loaded and F.loaded(hass, "clean_areas") == [e]
    # and only once: a reload finds nothing more to fold
    assert await hass.config_entries.async_reload(house.entry_id)
    await hass.async_block_till_done()
    assert len(feature_entries(hass, "clean_areas")) == 1


async def test_every_screen_learns_it_is_added(hass, frontend):
    """The settings feed's `added`: its action is always there, so this is
    how a card knows to offer it."""
    from custom_components.hk_frontend import features as F
    from custom_components.hk_frontend import ws_settings_subscribe
    from conftest import FakeConnection
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    assert screen.sent[-1]["event"]["added"] == []
    await add_feature(hass, "clean_areas", {})
    assert screen.sent[-1]["event"]["added"] == ["clean_areas"]
    (e,) = feature_entries(hass, "clean_areas")
    F.async_remove(hass, e)
    await hass.async_block_till_done()
    assert screen.sent[-1]["event"]["added"] == []


async def test_the_vacuums_are_sent_in_the_callers_context(hass, frontend, monkeypatch):
    """The logbook names who sent the vacuums: the vacuum calls carry the
    action's own context (they carried none)."""
    from homeassistant.core import Context
    from custom_components.hk_frontend.features.clean_areas import clean
    await add_feature(hass, "clean_areas", {})
    seen = []
    hass.services.async_register("vacuum", "clean_area", lambda call: seen.append(call.context))
    hass.services.async_register("vacuum", "start", lambda call: seen.append(call.context))
    monkeypatch.setattr(clean, "plan", lambda *a, **k: {"plan": [
        {"action": "clean_area", "vacuum": "vacuum.a", "areas": ["kitchen"]},
        {"action": "start", "vacuum": "vacuum.b", "areas": ["den"]}]})
    ctx = Context(user_id="u-owner")
    await hass.services.async_call(DOMAIN, "clean_areas", {"areas": ["kitchen", "den"]}, blocking=True,
                                   return_response=True, context=ctx)
    assert [c.user_id for c in seen] == ["u-owner", "u-owner"], seen
