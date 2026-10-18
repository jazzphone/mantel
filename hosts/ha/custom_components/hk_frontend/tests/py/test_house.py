"""The House port's Home Assistant side (house.py's HaHouse): what shared feature logic in hk_core
reads, copied out of HA's own registries. Reads only; nothing here calls a service."""
from __future__ import annotations

from homeassistant.helpers import area_registry as ar, floor_registry as fr

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
