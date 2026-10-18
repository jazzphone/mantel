"""Alarm PIN, a feature of HK Frontend, against real alarm entities: added
from Add feature (an item of the house's entry), the PIN panel it makes, its
gear (a new PIN, the arm rule, another alarm), and an Alarm PIN entry of a
pre-release of 1.0 folded into the house's entry."""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from homeassistant.data_entry_flow import InvalidData
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component

from conftest import (DOMAIN, add_feature, entry, feature_entries, feature_gear, house_entry,
                      pre_release_entry)

ALARM = "alarm_control_panel.home_alarm"
OTHER = "alarm_control_panel.garage"


async def two_alarms(hass):
    """Two code-less alarms that arm and disarm at once -- HA's manual alarm
    with no code, standing in for an alarm integration with no code of its
    own (for example Honeywell Lyric). Set up BEFORE HK Frontend: the house's
    entry sets up alarm_control_panel (for the PIN panels), and after that
    these YAML alarms would never load."""
    assert "alarm_control_panel" not in hass.config.components, "ask for `alarms` before `frontend`"
    assert await async_setup_component(hass, "alarm_control_panel", {"alarm_control_panel": [
        {"platform": "manual", "name": "Home Alarm", "code_arm_required": False,
         "arming_time": 0, "delay_time": 0, "trigger_time": 5},
        {"platform": "manual", "name": "garage", "code_arm_required": False,
         "arming_time": 0, "delay_time": 0, "trigger_time": 5}]})
    await hass.async_block_till_done()
    assert hass.states.get(ALARM).attributes.get("code_format") is None
    return ALARM


@pytest.fixture
async def alarms(hass):
    return await two_alarms(hass)


async def add(hass, alarm, pin="4321", arm_required=True, again=None):
    return await add_feature(hass, "alarm_pin", {
        "alarm": alarm, "pin": pin, "pin_again": pin if again is None else again,
        "arm_required": arm_required})


def pins(hass):
    return feature_entries(hass, "alarm_pin")


def panel_of(hass, feat):
    return er.async_get(hass).async_get_entity_id("alarm_control_panel", DOMAIN, feat.entry_id)


async def call(hass, service, entity, code=None):
    data = {"entity_id": entity}
    if code is not None:
        data["code"] = code
    await hass.services.async_call("alarm_control_panel", service, data, blocking=True)
    await hass.async_block_till_done()


async def gear(hass, feat, *steps):
    """Its gear, one submit per step; the last result."""
    r = await feature_gear(hass, feat)
    assert r["type"] == "form" and r["step_id"] == "alarm_pin_options", r
    for step in steps:
        r = await hass.config_entries.subentries.async_configure(r["flow_id"], step)
    await hass.async_block_till_done()
    return r


async def test_add_refuses_nonsense_and_duplicates(hass, alarms, frontend):
    r = await add(hass, ALARM, pin="12")
    assert r["errors"] == {"pin": "alarm_pin_too_short"}
    r = await add(hass, ALARM, pin="4321", again="4312")          # a slip is caught
    assert r["errors"] == {"pin_again": "alarm_pin_mismatch"}
    assert not pins(hass)
    r = await add(hass, ALARM)
    assert r["type"] == "create_entry" and r["title"] == "Home Alarm PIN"
    (feat,) = pins(hass)
    assert feat.domain == DOMAIN and feat.data == {"kind": "alarm_pin", "alarm": ALARM}
    assert feat.unique_id == "feature:alarm_pin:alarm_control_panel.home_alarm"
    assert feat.config_entry_id == frontend.entry_id and feat.entry_id in frontend.subentries
    ent = er.async_get(hass).async_get(panel_of(hass, feat))
    assert ent.platform == DOMAIN and ent.unique_id == feat.entry_id
    assert ent.config_entry_id == frontend.entry_id and ent.config_subentry_id == feat.entry_id, \
        "the house's entity, of the feature's item"
    r = await add(hass, ALARM)                                     # it has a PIN already
    assert r["type"] == "form" and r["errors"] == {"alarm": "alarm_pin_taken"}
    assert len(pins(hass)) == 1
    with pytest.raises(InvalidData):                  # the picker leaves its own panels out
        await add(hass, panel_of(hass, feat))
    # one per alarm: the feature menu goes on offering it
    flows = hass.config_entries.subentries
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert "alarm_pin" in r["menu_options"]
    flows.async_abort(r["flow_id"])


async def test_a_pin_added_twice_at_once_is_added_once(hass, alarms, frontend):
    """Two forms for one alarm, both past the form's check: the second
    stops at the item's own, rather than making a second PIN for it."""
    await add(hass, ALARM)
    with patch("custom_components.hk_frontend.features.alarm_pin.checks.alarm_error", return_value=None):
        r = await add(hass, ALARM, pin="1111")
    assert r["type"] == "abort" and r["reason"] == "alarm_pin_already_configured"
    assert len(pins(hass)) == 1


async def test_its_own_panels_are_only_alarm_pin_entries_alarm_panels(hass, alarms, frontend):
    """The integration owns other entities (the house's switch): never
    counted as a PIN panel, and a PIN panel is never the house's."""
    from custom_components.hk_frontend.features.alarm_pin import checks
    await add(hass, ALARM)
    (feat,) = pins(hass)
    assert checks.ours(hass) == [panel_of(hass, feat)]


async def test_the_pin_is_never_stored(hass, alarms, frontend):
    await add(hass, ALARM)
    (feat,) = pins(hass)
    blob = json.dumps(dict(frontend.subentries[feat.entry_id].data))
    assert "4321" not in blob and '"hash"' in blob
    from custom_components.hk_frontend.diagnostics import async_get_config_entry_diagnostics
    diag = await async_get_config_entry_diagnostics(hass, entry(hass))
    mine = diag["features"][f"Home Alarm PIN ({feat.entry_id})"]
    assert mine["options"]["hash"] == "**REDACTED**" and mine["options"]["salt"] == "**REDACTED**"
    assert mine["data"]["alarm"] == ALARM and mine["options"]["arm_required"] is True
    assert mine["running"] is True
    assert feat.options["hash"] not in json.dumps(diag, default=str)


async def test_it_mirrors_and_forwards_only_the_right_pin(hass, alarms, frontend):
    await add(hass, ALARM)
    gate = panel_of(hass, pins(hass)[0])
    st = hass.states.get(gate)
    assert st.state == "disarmed" and st.attributes["code_format"] == "number"
    assert st.attributes["protects"] == ALARM and st.name == "Home Alarm PIN"
    with pytest.raises(ServiceValidationError) as err:
        await call(hass, "alarm_arm_away", gate, "1111")
    assert err.value.translation_domain == DOMAIN and err.value.translation_key == "alarm_pin_invalid_code"
    assert hass.states.get(ALARM).state == "disarmed", "a wrong PIN reached the alarm"
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_arm_away", gate)
    await call(hass, "alarm_arm_away", gate, "4321")
    assert hass.states.get(ALARM).state == "armed_away"
    assert hass.states.get(gate).state == "armed_away"
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_disarm", gate, "0000")
    await call(hass, "alarm_disarm", gate, "4321")
    assert hass.states.get(ALARM).state == "disarmed"


async def test_two_alarms_two_pins(hass, alarms, frontend):
    await add(hass, ALARM, pin="1111")
    await add(hass, OTHER, pin="2222")
    e1, e2 = sorted(pins(hass), key=lambda e: e.title)           # "Home Alarm PIN", "garage PIN"
    g_alarm, g_garage = panel_of(hass, e1), panel_of(hass, e2)
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_arm_home", g_alarm, "2222")        # the garage's PIN
    await call(hass, "alarm_arm_home", g_garage, "2222")
    assert hass.states.get(OTHER).state == "armed_home" and hass.states.get(ALARM).state == "disarmed"


async def test_its_gear_changes_the_pin_and_the_arm_rule(hass, alarms, frontend):
    await add(hass, ALARM)
    (feat,) = pins(hass)
    r = await gear(hass, feat, {"alarm": ALARM, "pin": "12", "pin_again": "12"})
    assert r["errors"] == {"pin": "alarm_pin_too_short"}
    # A slip in either box changes nothing: the old PIN stays.
    r = await gear(hass, feat, {"alarm": ALARM, "pin": "9876", "pin_again": "9867"})
    assert r["errors"] == {"pin_again": "alarm_pin_mismatch"}
    r = await gear(hass, feat, {"alarm": ALARM, "pin": "", "pin_again": "9876"})
    assert r["errors"] == {"pin": "alarm_pin_too_short"}
    r = await gear(hass, feat, {"alarm": ALARM, "arm_required": False})
    assert r["type"] == "abort" and r["reason"] == "reconfigure_successful"
    gate = panel_of(hass, feat)
    await call(hass, "alarm_arm_home", gate)                       # no PIN to arm now
    assert hass.states.get(ALARM).state == "armed_home"
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_disarm", gate)
    await call(hass, "alarm_disarm", gate, "4321")                 # the kept PIN
    await gear(hass, feat, {"alarm": ALARM, "pin": "9876", "pin_again": "9876", "arm_required": True})
    assert panel_of(hass, feat) == gate, "rebuilt, with the same entity id"
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_arm_home", gate, "4321")
    await call(hass, "alarm_arm_home", gate, "9876")
    assert feat.data == {"kind": "alarm_pin", "alarm": ALARM}, "the alarm stays"


async def test_its_gear_moves_it_to_another_alarm(hass, alarms, frontend):
    """What Reconfigure did: another alarm, same PIN and arm rule, same panel."""
    await add(hass, ALARM)
    (feat,) = pins(hass)
    gate = panel_of(hass, feat)
    r = await gear(hass, feat, {"alarm": OTHER})
    assert r["type"] == "abort" and r["reason"] == "reconfigure_successful"
    assert feat.unique_id == "feature:alarm_pin:alarm_control_panel.garage" and feat.data["alarm"] == OTHER
    assert feat.title == "garage PIN" and feat.options["arm_required"] is True
    assert panel_of(hass, feat) == gate, "the same panel"
    assert hass.states.get(gate).attributes["protects"] == OTHER
    await call(hass, "alarm_arm_away", gate, "4321")
    assert hass.states.get(OTHER).state == "armed_away" and hass.states.get(ALARM).state == "disarmed"
    # an alarm another PIN protects is refused; its own panel is no choice
    await add(hass, ALARM, pin="1111")
    r = await gear(hass, feat, {"alarm": ALARM})
    assert r["type"] == "form" and r["errors"] == {"alarm": "alarm_pin_taken"}
    assert feat.data["alarm"] == OTHER
    with pytest.raises(InvalidData):
        await gear(hass, feat, {"alarm": gate})


async def test_it_follows_its_alarm_going_away(hass, alarms, frontend):
    await add(hass, ALARM)
    gate = panel_of(hass, pins(hass)[0])
    hass.states.async_set(ALARM, "unavailable")
    await hass.async_block_till_done()
    assert hass.states.get(gate).state == "unavailable"


async def test_unload_and_remove(hass, alarms, frontend):
    """Unloading and reloading the house's entry takes the panel with it
    and brings it back; removing the item removes the panel and its device,
    and the house's entry stays."""
    from custom_components.hk_frontend import features as F
    await add(hass, ALARM)
    (feat,) = pins(hass)
    gate = panel_of(hass, feat)
    assert await hass.config_entries.async_unload(frontend.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(gate).state == "unavailable"
    assert await hass.config_entries.async_reload(frontend.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(gate).state == "disarmed"
    (feat,) = pins(hass)
    assert feat.loaded
    F.async_remove(hass, feat)
    await hass.async_block_till_done()
    assert not pins(hass)
    assert er.async_get(hass).async_get(gate) is None and hass.states.get(gate) is None
    assert not dr.async_get(hass).async_get_devices(
        identifiers={(DOMAIN, feat.entry_id)}), "its device goes too"
    assert hass.config_entries.async_get_entry(frontend.entry_id), "the house's entry stays"


async def test_an_alarm_not_loaded_yet_still_gives_its_name(hass, frontend):
    """No state yet (its integration has not loaded): the registry's name."""
    er.async_get(hass).async_get_or_create("alarm_control_panel", "other_integration", "abc",
                                           suggested_object_id="house_alarm", original_name="House Alarm")
    r = await add(hass, "alarm_control_panel.house_alarm")
    assert r["type"] == "create_entry" and r["title"] == "House Alarm PIN"


async def test_a_pre_release_alarm_pin_entry_is_folded_into_the_house(hass, base, alarms):
    """An Alarm PIN of a pre-release of 1.0 (an entry of its own) becomes an
    item of the house's entry at start, with the entry's id as its own: its
    panel keeps its entity id and its device, both move to the house's
    entry, and the PIN (only ever a hash) works."""
    from custom_components.hk_frontend import features as F
    from custom_components.hk_frontend.features.alarm_pin.pin import hash_pin
    stored = await hass.async_add_executor_job(hash_pin, "4321")
    house = house_entry()
    house.add_to_hass(hass)
    old = pre_release_entry("alarm_pin", {"alarm": ALARM}, {"arm_required": False, **stored},
                            title="Home Alarm", unique_id="alarm_pin:alarm_control_panel.home_alarm")
    old.add_to_hass(hass)
    dreg, ereg = dr.async_get(hass), er.async_get(hass)
    dev = dreg.async_get_or_create(config_entry_id=old.entry_id, identifiers={(DOMAIN, old.entry_id)},
                                   name="Home Alarm", entry_type=dr.DeviceEntryType.SERVICE)
    made = ereg.async_get_or_create("alarm_control_panel", DOMAIN, old.entry_id, config_entry=old,
                                    device_id=dev.id, suggested_object_id="alarm_panel_keypad")
    ereg.async_update_entity(made.entity_id, name="Alarm Panel Keypad")
    panel = "alarm_control_panel.alarm_panel_keypad"
    assert made.entity_id == panel

    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    assert hass.config_entries.async_get_entry(old.entry_id) is None, "the old entry is gone"
    assert hass.config_entries.async_entries(DOMAIN) == [house]
    (feat,) = pins(hass)
    assert feat.entry_id == old.entry_id, "the entry's id is the item's"
    assert feat.unique_id == F.unique_id("alarm_pin", ALARM)
    assert feat.title == "Home Alarm PIN", "its item names the PIN, not the alarm"
    assert dict(house.subentries[feat.entry_id].data) == F.item_data("alarm_pin", old.data, old.options)
    assert feat.data == {"kind": "alarm_pin", "alarm": ALARM}
    assert feat.options == {"arm_required": False, **stored}
    assert feat.loaded
    ent = ereg.async_get(panel)
    assert ent.platform == DOMAIN and ent.unique_id == old.entry_id
    assert ent.config_entry_id == house.entry_id and ent.config_subentry_id == old.entry_id
    assert ent.name == "Alarm Panel Keypad" and ent.device_id == dev.id
    moved = dreg.async_get(dev.id)
    assert moved.identifiers == {(DOMAIN, old.entry_id)}
    from conftest import device_place
    assert device_place(moved) == (house.entry_id, old.entry_id)
    st = hass.states.get(panel)
    assert st.state == "disarmed" and st.attributes["protects"] == ALARM
    await call(hass, "alarm_arm_away", panel)                      # the arm rule came along
    with pytest.raises(ServiceValidationError):
        await call(hass, "alarm_disarm", panel, "1111")
    await call(hass, "alarm_disarm", panel, "4321")                # the same PIN, never re-entered
    assert hass.states.get(ALARM).state == "disarmed"
    # a reload changes nothing
    assert await hass.config_entries.async_reload(house.entry_id)
    await hass.async_block_till_done()
    assert len(pins(hass)) == 1 and ereg.async_get(panel).config_subentry_id == old.entry_id
    assert not [x for x in hass.states.async_entity_ids() if x.endswith("_2")]


async def test_its_panel_is_listed_beside_the_alarm_in_the_alarm_notifications(hass, alarms, frontend):
    """The Alarm category of Notifications (2026-10-13): the PIN panel is
    listed beside the alarm it protects, saying what it is; the two are one
    alarm, so with both ticked only the alarm is watched."""
    from custom_components.hk_frontend.features.notifications import candidates
    assert candidates(hass, "alarms") == [OTHER, ALARM]
    await add(hass, ALARM)
    await hass.async_block_till_done()
    panel = panel_of(hass, pins(hass)[0])
    assert panel and panel != ALARM
    # listed beside the alarm it protects, each saying what it is
    assert candidates(hass, "alarms") == sorted([OTHER, ALARM, panel])
    from custom_components.hk_frontend.features.notifications import members
    from custom_components.hk_frontend.features.notifications.settings_ws import _named
    rows = {r["entity"]: r for r in _named(hass, [OTHER, ALARM, panel])}
    assert rows[panel]["note"].endswith("with a PIN · made by HK’s Alarm PIN")
    assert rows[ALARM]["note"].startswith("Opens ") and "note" not in rows[OTHER]
    # one alarm: both ticked, only the alarm is watched; the panel alone, the panel
    assert sorted(members(hass, {"category": "alarms"})) == sorted([OTHER, ALARM])
    assert sorted(members(hass, {"category": "alarms", "exclude": [ALARM]})) == sorted([OTHER, panel])


async def test_a_notification_about_the_alarm_opens_the_keypad(hass, alarms, frontend):
    """A tap on a notification about an alarm with a PIN panel in front of it
    opens the PIN panel's sheet -- the keypad -- not the alarm's own Arm /
    Disarm sheet, whatever the notification watches (2026-10-13). Another
    alarm, with no PIN panel, still opens its own."""
    from custom_components.hk_frontend.features import notifications as N
    await add(hass, ALARM)
    await hass.async_block_till_done()
    panel = panel_of(hass, pins(hass)[0])
    from custom_components.hk_frontend.features.notifications.const import DEFAULTS
    opts = {**DEFAULTS}
    p = N.build(hass, opts, {"id": "a", "entity": ALARM, "when": "triggered"}, hass.states.get(ALARM), test=True)
    assert p["entity"] == ALARM and p["sheet"] == panel
    q = N.build(hass, opts, {"id": "b", "entity": OTHER, "when": "triggered"}, hass.states.get(OTHER), test=True)
    assert q["sheet"] == OTHER
    r = N.build_action(hass, opts, {"title": "Alarm!", "entity": ALARM})
    assert r["sheet"] == panel
