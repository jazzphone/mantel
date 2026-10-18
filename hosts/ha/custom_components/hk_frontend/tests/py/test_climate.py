"""Climate discovery and the settings used by its summary/popup lists."""
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_related_readings_and_thermostat_fallback(hass):
    from custom_components.hk_frontend import kinds as K
    areas, entities, devices = ar.async_get(hass), er.async_get(hass), dr.async_get(hass)
    den, bedroom, outside = [areas.async_create(n) for n in ("Den", "Bedroom", "Outside")]
    for name, area, dc in (("den_t", den, "temperature"), ("den_h", den, "humidity"),
                           ("cpu_t", den, "temperature"), ("outside_t", outside, "temperature")):
        entity = entities.async_get_or_create("sensor", "test", name, suggested_object_id=name)
        entities.async_update_entity(entity.entity_id, area_id=area.id)
        hass.states.async_set(entity.entity_id, "74", {"device_class": dc, "unit_of_measurement": "°F" if dc == "temperature" else "%"})
    areas.async_update(den.id, temperature_entity_id="sensor.den_t", humidity_entity_id="sensor.den_h")
    areas.async_update(outside.id, temperature_entity_id="sensor.outside_t")
    entry = MockConfigEntry(domain="test")
    entry.add_to_hass(hass)
    device = devices.async_get_or_create(config_entry_id=entry.entry_id, identifiers={("test", "thermostat")})
    devices.async_update_device(device.id, area_id=bedroom.id)
    thermostat = entities.async_get_or_create("climate", "test", "bedroom", suggested_object_id="bedroom", device_id=device.id)
    hass.states.async_set(thermostat.entity_id, "cool", {"current_temperature": 80, "current_humidity": 89, "temperature": 62})
    found = K.resolve(K.candidates(hass), {})
    assert found["temperature"] == ["climate.bedroom", "sensor.den_t", "sensor.outside_t"]
    assert found["humidity"] == ["climate.bedroom", "sensor.den_h"]
    assert "sensor.cpu_t" not in found["temperature"]
    settings = {"counts": {"temperature": {"exclude": ["sensor.outside_t"], "include": ["sensor.cpu_t", "sensor.outside_t"]}}}
    assert K.resolve(K.candidates(hass), settings)["temperature"] == ["climate.bedroom", "sensor.den_t", "sensor.cpu_t"]
    # The primary source remains the chosen source when temporarily unavailable.
    hass.states.async_set("sensor.den_t", "unavailable", {"device_class": "temperature"})
    assert "sensor.den_t" in K.resolve(K.candidates(hass), {})["temperature"]
    # ...and so does a thermostat, though Home Assistant strips its
    # current_temperature / current_humidity while it is unavailable.
    hass.states.async_set(thermostat.entity_id, "unavailable", {})
    gone = K.resolve(K.candidates(hass), {})
    assert "climate.bedroom" in gone["temperature"] and "climate.bedroom" in gone["humidity"]
    hass.states.async_set(thermostat.entity_id, "cool", {"current_temperature": 80, "current_humidity": 89})
    # Changing the area's designated sensor changes discovery without copying
    # any entity lists into the Climate page config.
    areas.async_update(den.id, temperature_entity_id="sensor.cpu_t")
    assert "sensor.cpu_t" in K.resolve(K.candidates(hass), {})["temperature"]
    assert "sensor.den_t" not in K.resolve(K.candidates(hass), {})["temperature"]
