"""Hidden Accessories (hiding.py): every place an accessory can be hidden
from, read and set in one place -- over the settings each place has always
been stored in (Hidden from Screens, Status & Chips' Left Out, Show on Home,
and the new Room Page)."""
from __future__ import annotations

import pytest
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from conftest import FakeConnection, entry

DOMAIN = "hk_frontend"


class Conn(FakeConnection):
    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "error": code})


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


def _house(hass):
    """The case that started it: a water heater (a climate entity) in the
    Crawl Space, beside a real thermostat, and a lamp in the Den."""
    areas, ents, devs = ar.async_get(hass), er.async_get(hass), dr.async_get(hass)
    crawl, den = areas.async_create("Crawl Space"), areas.async_create("Den")
    src = MockConfigEntry(domain="test")
    src.add_to_hass(hass)
    heater = devs.async_get_or_create(config_entry_id=src.entry_id, identifiers={("test", "heater")})
    devs.async_update_device(heater.id, area_id=crawl.id)
    for domain, uid, dev, area, state, attrs in (
            ("climate", "water_heater", heater.id, None, "heat", {"current_temperature": 120, "temperature": 120}),
            ("climate", "downstairs", None, den.id, "cool", {"current_temperature": 72, "temperature": 70}),
            ("light", "lamp", None, den.id, "on", {}),
            ("switch", "coffee", None, den.id, "off", {})):
        e = ents.async_get_or_create(domain, "test", uid, suggested_object_id=uid, device_id=dev)
        if area:
            ents.async_update_entity(e.entity_id, area_id=area)
        hass.states.async_set(e.entity_id, state, attrs)


async def _set(hass, conn, n, ids, everywhere=False, places=None):
    from custom_components.hk_frontend.hiding import ws_hidden_set
    ws_hidden_set(hass, conn, {"id": n, "type": "hk_frontend/hidden/set", "entity_ids": ids,
                               "everywhere": everywhere, "places": places or {}})
    await hass.async_block_till_done()
    return conn.sent[-1]


def _opts(hass):
    from custom_components.hk_frontend import settings as S
    return S.merged(entry(hass).options)


async def test_left_out_of_thermostats_reads_as_hidden_from_climate_and_shows_again(hass, frontend):
    from custom_components.hk_frontend import kinds
    from custom_components.hk_frontend.hiding import ws_hidden_get
    _house(hass)
    conn = await _admin(hass)
    # Left Out under Status & Chips -> Thermostats, as the house had it
    from custom_components.hk_frontend import settings_api
    opts, err = settings_api.apply_house(entry(hass).options, {
        "counts.thermostats": {"exclude": ["climate.water_heater"], "include": []}})
    assert not err
    hass.config_entries.async_update_entry(entry(hass), options=opts)
    await hass.async_block_till_done()
    assert kinds.current(hass)["thermostats"] == ["climate.downstairs"]

    ws_hidden_get(hass, conn, {"id": 1, "type": "hk_frontend/hidden/get"})
    snap = conn.sent[-1]["result"]
    # its room's places (through its DEVICE's area) and the kinds it is in
    assert snap["can"]["climate.water_heater"][:2] == ["home", "room"]
    assert "thermostats" in snap["can"]["climate.water_heater"]
    assert snap["off"]["climate.water_heater"] == ["thermostats"]
    assert snap["places"]["thermostats"][0] == "Climate"
    assert "climate.downstairs" not in snap["off"]

    # nothing chosen, not everywhere: shown everywhere -- on the Climate page again
    r = await _set(hass, conn, 2, ["climate.water_heater"])
    assert r["success"] and r["result"]["off"] == {}
    assert _opts(hass)["counts"]["thermostats"]["exclude"] == []
    assert kinds.current(hass)["thermostats"] == ["climate.downstairs", "climate.water_heater"]


async def test_everywhere_then_only_home_and_its_room_page(hass, frontend):
    from custom_components.hk_frontend import accessories, kinds
    _house(hass)
    conn = await _admin(hass)
    r = await _set(hass, conn, 1, ["light.lamp"], everywhere=True)
    assert r["result"]["everywhere"] == ["light.lamp"]
    assert "light.lamp" in _opts(hass)["generated"]["exclude_entities"]
    assert "light.lamp" not in kinds.current(hass)["lights"]
    # Everywhere off, two places on: off Home and its room's page, still a light
    r = await _set(hass, conn, 2, ["light.lamp"], places={"home": True, "room": True})
    assert r["result"]["everywhere"] == []
    assert r["result"]["off"]["light.lamp"] == ["home", "room"]
    assert "light.lamp" not in _opts(hass)["generated"]["exclude_entities"]
    assert accessories.current(hass)["entities"]["light.lamp"] == {"home": False, "room": False}
    assert "light.lamp" in kinds.current(hass)["lights"]
    # Everywhere again clears the places: shown again, it shows in every one
    await _set(hass, conn, 3, ["light.lamp"], everywhere=True)
    assert "light.lamp" not in accessories.current(hass)["entities"]
    await _set(hass, conn, 4, ["light.lamp"])
    assert "light.lamp" not in _opts(hass)["generated"]["exclude_entities"]


async def test_several_at_once_each_only_where_it_can_be(hass, frontend):
    """A lamp and a thermostat hidden from Lights: only the lamp is a light;
    the thermostat is untouched there, and nothing else changes."""
    from custom_components.hk_frontend import kinds
    _house(hass)
    conn = await _admin(hass)
    r = await _set(hass, conn, 1, ["light.lamp", "climate.downstairs"], places={"lights": True})
    assert r["result"]["off"] == {"light.lamp": ["lights"]}
    assert _opts(hass)["counts"]["lights"]["exclude"] == ["light.lamp"]
    assert _opts(hass)["counts"]["thermostats"] is None          # never written: still automatic
    assert "climate.downstairs" in kinds.current(hass)["thermostats"]


async def test_include_in_status_off_reads_as_its_kinds_and_turns_into_them(hass, frontend):
    from custom_components.hk_frontend import accessories, kinds
    from custom_components.hk_frontend.hiding import ws_hidden_get
    _house(hass)
    accessories.get(hass).set("light.lamp", {"status": False})
    await hass.async_block_till_done()
    conn = await _admin(hass)
    ws_hidden_get(hass, conn, {"id": 1, "type": "hk_frontend/hidden/get", "entity_ids": ["light.lamp", "switch.coffee"]})
    snap = conn.sent[-1]["result"]
    assert snap["off"] == {"light.lamp": ["lights"]}
    assert set(snap["can"]) == {"light.lamp", "switch.coffee"}
    # saved here: the old switch goes, its kind's Left Out keeps it out
    await _set(hass, conn, 2, ["light.lamp"], places={"lights": True})
    assert "status" not in (accessories.current(hass)["entities"].get("light.lamp") or {})
    assert _opts(hass)["counts"]["lights"]["exclude"] == ["light.lamp"]
    assert "light.lamp" not in kinds.current(hass)["lights"]


async def test_a_room_page_leaves_out_what_is_hidden_from_it_only(hass, frontend):
    """`room: False` is stored and sent like `home`."""
    from custom_components.hk_frontend.accessories import ws_accessory_set
    _house(hass)
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 1, "type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "room": False})
    assert conn.sent[-1]["result"] == {"room": False}
    ws_accessory_set(hass, conn, {"id": 2, "type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "room": True})
    assert conn.sent[-1]["result"] == {}


async def test_only_an_admin_reads_or_hides(hass, frontend):
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.hiding import ws_hidden_get, ws_hidden_set
    await hass.auth.async_create_user("Owner")
    tablet = Conn(await hass.auth.async_create_user("kitchen"))
    with pytest.raises(Unauthorized):
        ws_hidden_get(hass, tablet, {"id": 1, "type": "hk_frontend/hidden/get"})
    with pytest.raises(Unauthorized):
        ws_hidden_set(hass, tablet, {"id": 2, "type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"],
                                     "everywhere": True, "places": {}})


async def test_also_counted_from_the_accessory(hass, frontend):
    """An outlet you think of as a light: Also Count As Lights, from the
    accessory -- Status & Chips' Also count, stored where it always was."""
    from custom_components.hk_frontend import kinds
    from custom_components.hk_frontend.hiding import ws_hidden_also, ws_hidden_get
    _house(hass)
    conn = await _admin(hass)
    ws_hidden_get(hass, conn, {"id": 1, "type": "hk_frontend/hidden/get", "entity_ids": ["switch.coffee", "light.lamp"]})
    snap = conn.sent[-1]["result"]
    # a switch could also be a light, a fan or a valve; a light is a light already
    assert snap["also"]["switch.coffee"] == ["lights", "fans", "valves"]
    assert "lights" not in snap["also"].get("light.lamp", [])
    assert snap["added"] == {}
    ws_hidden_also(hass, conn, {"id": 2, "type": "hk_frontend/hidden/also", "entity_ids": ["switch.coffee"],
                                "kinds": {"lights": True, "speakers": True}})
    await hass.async_block_till_done()
    r = conn.sent[-1]
    assert r["success"] and r["result"]["added"] == {"switch.coffee": ["lights"]}     # not a speaker: not offered
    assert _opts(hass)["counts"]["lights"]["include"] == ["switch.coffee"]
    assert _opts(hass)["counts"]["speakers"] is None
    assert "switch.coffee" in kinds.current(hass)["lights"]
    # ...and it is not a place it can be hidden from: it was added, not found
    assert "lights" not in r["result"]["can"]["switch.coffee"]
    ws_hidden_also(hass, conn, {"id": 3, "type": "hk_frontend/hidden/also", "entity_ids": ["switch.coffee"],
                                "kinds": {"lights": False}})
    await hass.async_block_till_done()
    assert conn.sent[-1]["result"]["added"] == {}
    assert "switch.coffee" not in kinds.current(hass)["lights"]


async def test_a_reading_is_offered_only_to_what_reports_it(hass, frontend):
    from custom_components.hk_frontend.hiding import ws_hidden_get
    for eid, dc in (("sensor.cpu_t", "temperature"), ("sensor.grid_w", "power")):
        er.async_get(hass).async_get_or_create("sensor", "test", eid.split(".")[1], suggested_object_id=eid.split(".")[1])
        hass.states.async_set(eid, "40", {"device_class": dc})
    conn = await _admin(hass)
    ws_hidden_get(hass, conn, {"id": 1, "type": "hk_frontend/hidden/get", "entity_ids": ["sensor.cpu_t", "sensor.grid_w"]})
    also = conn.sent[-1]["result"]["also"]
    assert also.get("sensor.cpu_t") == ["temperature"] and "sensor.grid_w" not in also


async def test_a_group_helper_is_never_found_but_can_be_added(hass, frontend):
    """"Motion - Kitchen", a group helper over the kitchen's motion sensors
    (2026-10-13): never counted by itself (its members would count twice),
    but offered to Also Count As -- the only way in -- and counted once added.
    A hidden one is still offered nothing."""
    from custom_components.hk_frontend import kinds
    from custom_components.hk_frontend.hiding import ws_hidden_also, ws_hidden_get
    ents = er.async_get(hass)
    for uid in ("motion_kitchen", "motion_attic"):
        ents.async_get_or_create("binary_sensor", "group", uid, suggested_object_id=uid)
        hass.states.async_set("binary_sensor." + uid, "off",
                              {"device_class": "motion", "entity_id": ["binary_sensor.a", "binary_sensor.b"]})
    ents.async_update_entity("binary_sensor.motion_attic", hidden_by=er.RegistryEntryHider.USER)
    await hass.async_block_till_done()
    assert "binary_sensor.motion_kitchen" not in kinds.current(hass)["motion"]
    conn = await _admin(hass)
    ws_hidden_get(hass, conn, {"id": 1, "type": "hk_frontend/hidden/get",
                               "entity_ids": ["binary_sensor.motion_kitchen", "binary_sensor.motion_attic"]})
    also = conn.sent[-1]["result"]["also"]
    assert "motion" in also["binary_sensor.motion_kitchen"]
    assert "binary_sensor.motion_attic" not in also
    ws_hidden_also(hass, conn, {"id": 2, "type": "hk_frontend/hidden/also",
                                "entity_ids": ["binary_sensor.motion_kitchen", "binary_sensor.motion_attic"],
                                "kinds": {"motion": True}})
    await hass.async_block_till_done()
    assert conn.sent[-1]["result"]["added"] == {"binary_sensor.motion_kitchen": ["motion"]}
    assert "binary_sensor.motion_kitchen" in kinds.current(hass)["motion"]
