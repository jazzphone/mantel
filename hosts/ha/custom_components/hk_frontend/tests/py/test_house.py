"""The House port's Home Assistant side (house.py's HaHouse): what shared feature logic in hk_core
reads, copied out of HA's own registries. Reads only; nothing here calls a service."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er, floor_registry as fr

from custom_components.hk_frontend.hk_core.house import Floor
from custom_components.hk_frontend.house import HaHouse


async def test_an_areas_floor_comes_from_has_floor_registry(hass):
    floors, areas = fr.async_get(hass), ar.async_get(hass)
    up = floors.async_create("Upstairs", level=2)
    attic = floors.async_create("Attic")                       # no level set
    office = areas.async_create("Office", floor_id=up.floor_id)
    loft = areas.async_create("Loft", floor_id=attic.floor_id)
    shed = areas.async_create("Shed")                          # on no floor
    house = HaHouse(hass)
    assert house.area_floor(office.id) == Floor(up.floor_id, "Upstairs", 2)
    assert house.area_floor(loft.id) == Floor(attic.floor_id, "Attic", None)
    assert house.area_floor(shed.id) is None
    assert house.area_floor("no_such_area") is None
    # renamed in HA, read again: a view, never a held HA object
    floors.async_update(up.floor_id, name="Second Floor")
    assert house.area_floor(office.id).name == "Second Floor"


async def test_a_devices_entities_and_name_come_from_has_registries(hass):
    """What the wall tablets' rules read (hk_core/tablets: a kiosk app's parts, the kiosk apps'
    devices): a device's entities in the registry's order, `disabled` saying which are off;
    every entity's integration and device; and a device's name, the user's over its own."""
    ce = MockConfigEntry(domain="esphome")
    ce.add_to_hass(hass)
    devs, reg = dr.async_get(hass), er.async_get(hass)
    dev = devs.async_get_or_create(config_entry_id=ce.entry_id, identifiers={("esphome", "loft")}, name="Loft Kiosk")
    bat = reg.async_get_or_create("sensor", "esphome", "loft-battery", suggested_object_id="loft_kiosk_battery",
                                  device_id=dev.id, config_entry=ce)
    off = reg.async_get_or_create("sensor", "esphome", "loft-uptime", suggested_object_id="loft_kiosk_app_uptime",
                                  device_id=dev.id, config_entry=ce, disabled_by=er.RegistryEntryDisabler.USER)
    house = HaHouse(hass)
    got = house.device_entities(dev.id)
    assert [(e.entity_id, e.disabled) for e in got] == [(bat.entity_id, False), (off.entity_id, True)]
    assert [e.entity_id for e in got if not e.disabled] == \
        [e.entity_id for e in er.async_entries_for_device(reg, dev.id)], "the enabled ones, as HA lists them"
    mine = {e.entity_id: e for e in house.entities() if e.device_id == dev.id}
    assert set(mine) == {bat.entity_id, off.entity_id} and mine[bat.entity_id].platform == "esphome"
    assert house.device(dev.id).name == "Loft Kiosk"
    devs.async_update_device(dev.id, name_by_user="Loft Tablet")
    assert house.device(dev.id).name == "Loft Tablet", "the user's name for it"
    assert house.device("no_such_device") is None and house.device_entities("no_such_device") == []


async def test_a_state_says_when_it_last_changed(hass):
    """What the Sleep Screen's decisions read (hk_core/sleep: when presence rose, when the lit
    lights or Good Night last changed): a state's last_changed, the state's own, not moved by an
    attribute; and two views of the same state are equal whenever it was read."""
    hass.states.async_set("binary_sensor.hall_motion", "on", {"device_class": "motion"})
    st = hass.states.get("binary_sensor.hall_motion")
    house = HaHouse(hass)
    first = house.state("binary_sensor.hall_motion")
    assert first.last_changed == st.last_changed and first.last_changed.tzinfo is not None
    hass.states.async_set("binary_sensor.hall_motion", "on", {"device_class": "motion", "friendly_name": "Motion"})
    assert house.state("binary_sensor.hall_motion").last_changed == st.last_changed, "an attribute is no change"
    hass.states.async_set("binary_sensor.hall_motion", "on", {"device_class": "motion"})
    assert house.state("binary_sensor.hall_motion") == first
    assert [s.last_changed for s in house.states("binary_sensor")] == [st.last_changed]
