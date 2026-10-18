"""Energy, a feature of HK Frontend: the Energy page's plan (features/energy/
plan.py) worked out from Home Assistant's own Energy settings, the settings
page's checks, and the feature added and changed through its item."""
from __future__ import annotations

import json

import pytest

from conftest import add_feature, feature_entries, feature_gear, update_feature

from custom_components.hk_frontend.features.energy import plan
from custom_components.hk_frontend.features.energy.settings_ws import apply, apply_device, move_device

# A HOUSE like the one this page was first written for: a whole-home meter
# counted by a Utility Meter over an Integral over a power sensor, circuits
# the same way, a smart plug with its own kWh and W, one device inside
# another, and a car.
PREFS = {
    "energy_sources": [
        {"type": "grid", "stat_energy_from": "sensor.main_utility", "stat_cost": None,
         "entity_energy_price": "input_number.price", "number_energy_price": None},
        {"type": "battery", "stat_energy_from": "sensor.batt_out", "stat_energy_to": "sensor.batt_in"},
    ],
    "device_consumption": [
        {"stat_consumption": "sensor.office_utility", "name": "Office Utility"},
        {"stat_consumption": "sensor.living_room_utility"},
        {"stat_consumption": "sensor.kitchen_garage_utility", "name": "Kitchen & Garage Utility"},
        {"stat_consumption": "sensor.upstairs_ac_utility"},
        {"stat_consumption": "sensor.refrigerator_utility"},
        {"stat_consumption": "sensor.kitchen_outlets_utility"},
        {"stat_consumption": "sensor.coffee_plug_energy", "included_in_stat": "sensor.kitchen_outlets_utility"},
        {"stat_consumption": "sensor.wall_connector_utility"},
        {"stat_consumption": "sensor.mystery_utility", "stat_rate": "sensor.mystery_watts"},
        {"stat_consumption": "sensor.no_power_utility"},
    ],
}


def E(name, dc=None, unit=None, source=None, device=None, state=None, **kw):
    return {"name": name, "dc": dc, "unit": unit, "source": source, "device": device, "state": state, **kw}


ENTS = {
    "sensor.main_utility": E("Main Utility", "energy", "kWh", "sensor.main"),
    "sensor.main": E("Main", "energy", "kWh", "sensor.main_live"),
    "sensor.main_live": E("Main Live", "power", "kW"),
    "sensor.main_utility_cost": E("Main Utility Cost", "monetary", "USD"),
    "sensor.office_utility": E("Office Utility", "energy", "kWh", "sensor.office", state="40"),
    "sensor.office": E("Office", "energy", "kWh", "sensor.panel_office_power"),
    "sensor.panel_office_power": E("Panel Office Power", "power", "W"),
    "sensor.living_room_utility": E("Living Room Utility", "energy", "kWh", "sensor.lr", state="10"),
    "sensor.lr": E("LR", "energy", "kWh", "sensor.lr_power"),
    "sensor.lr_power": E("LR Power", "power", "W"),
    "sensor.kitchen_garage_utility": E("Kitchen & Garage Utility", "energy", "kWh", state="5"),
    "sensor.upstairs_ac_utility": E("Upstairs AC Utility", "energy", "kWh", "sensor.up_ac", state="300"),
    "sensor.up_ac": E("Up AC", "energy", "kWh", "sensor.upstairs_ac_live"),
    "sensor.upstairs_ac_live": E("Upstairs AC Live", "power", "W"),
    "sensor.refrigerator_utility": E("Refrigerator Utility", "energy", "kWh", state="50"),
    "sensor.kitchen_outlets_utility": E("Kitchen Outlets Utility", "energy", "kWh", state="20"),
    "sensor.coffee_plug_energy": E("Coffee Plug Energy", "energy", "kWh", device="plug1", state="2"),
    "sensor.coffee_plug_power": E("Coffee Plug Power", "power", "W", device="plug1"),
    "switch.coffee_plug": E("Coffee Plug", device="plug1"),
    "sensor.wall_connector_utility": E("Wall Connector Utility", "energy", "kWh", state="120"),
    "sensor.mystery_utility": E("Mystery Utility", "energy", "kWh", state="1"),
    "sensor.mystery_watts": E("Mystery Watts", "power", "W"),
    "sensor.no_power_utility": E("Dehumidifier Utility", "energy", "kWh", state="0"),
    "climate.downstairs": E("Downstairs Thermostat"),
    "climate.upstairs": E("Upstairs Thermostat"),
    "sensor.outside_temp": E("Backyard Temperature", "temperature", "°F"),
    "sensor.car_battery": E("Roadster Battery Level", "battery", "%", device="car", range="sensor.car_range"),
    "sensor.car_range": E("Roadster Range", "distance", "mi", device="car"),
}
AREAS = {"office": {"name": "Office", "icon": "mdi:monitor"}, "living_room": {"name": "Living Room", "icon": "mdi:sofa"},
         "kitchen": {"name": "Kitchen", "icon": None}, "garage": {"name": "Garage", "icon": "mdi:car"}}


def ctx(**over):
    base = {"prefs": PREFS, "entities": ENTS, "areas": AREAS, "thermostats": ["climate.downstairs", "climate.upstairs"],
            "outside": "sensor.outside_temp", "house_power": None, "vehicles": ["sensor.car_battery"]}
    return {**base, **over}


def items(p, sid):
    return [i for s in p["sections"] if s["id"] == sid for i in s["items"]]


def test_names_lose_their_meter_words():
    assert plan.short_name("Office Utility") == "Office"
    assert plan.short_name("Emma's Room Utility") == "Emma's Room"
    assert plan.short_name("Main Power Live") == "Main"
    assert plan.short_name("Utility") == "Utility"
    assert plan.short_name("Smart Plug Energy Consumption") == "Smart Plug"


@pytest.mark.parametrize(("name", "section"), [
    ("Office", "rooms"), ("Living Room", "rooms"), ("Kitchen & Garage", "rooms"), ("Upstairs AC", "hvac"),
    ("Downstairs Air Handler", "hvac"), ("Heat Pump", "hvac"), ("Refrigerator", "appliances"),
    ("Kitchen Outlets", "outlets"), ("Deck Outlet", "outlets"), ("Left Wall Connector Charging", "charging"),
    ("EV Charger", "charging"), ("Crawl Space Dehumidifier", "appliances"), ("Network Rack", "appliances"),
    ("Guest Bedroom", "rooms"), ("Laundry", "appliances"), ("Water Heater", "appliances")])
def test_sections_are_guessed_from_names(name, section):
    assert plan.guess_section(name, ["Office", "Living Room", "Kitchen", "Garage"]) == section


def test_power_is_found_through_the_helpers_sources_then_the_device():
    c = ctx()
    assert plan.resolve_power(c, "sensor.office_utility") == ("sensor.panel_office_power", "source")
    assert plan.resolve_power(c, "sensor.coffee_plug_energy") == ("sensor.coffee_plug_power", "device")
    assert plan.resolve_power(c, "sensor.mystery_utility", "sensor.mystery_watts") == ("sensor.mystery_watts", "energy")
    assert plan.resolve_power(c, "sensor.office_utility", None, "sensor.x") == ("sensor.x", "own")
    assert plan.resolve_power(c, "sensor.refrigerator_utility") == (None, "")


def test_a_meter_over_a_plugs_own_kwh_finds_the_plugs_watts():
    """A Utility Meter (no device) counting a smart plug's own kWh: the
    plug's power sensor, beside that kWh on its device."""
    ents = {"sensor.rack_utility": E("Network Rack Utility", "energy", "kWh", "sensor.rack_plug_energy"),
            "sensor.rack_plug_energy": E("Rack Plug Energy", "energy", "kWh", device="plug2"),
            "sensor.rack_plug_power": E("Rack Plug Power", "power", "W", device="plug2")}
    assert plan.resolve_power({"entities": ents}, "sensor.rack_utility") == ("sensor.rack_plug_power", "device")


@pytest.mark.parametrize(("name", "icon"), [("Network Rack", "hk:server-network"), ("Lab Rack", "hk:server-network"),
                                            ("Dishwasher", "hk:dishwasher"), ("Laundry", "hk:washing-machine"),
                                            ("Upstairs AC", "hk:air-conditioner"), ("Garage Outlets", "hk:power-socket-us")])
def test_glyphs_are_guessed_from_names(name, icon):
    assert plan.guess_icon(name) == icon


def test_a_source_loop_ends():
    loop = {"sensor.a": E("A", source="sensor.b"), "sensor.b": E("B", source="sensor.a")}
    assert plan.follow_source({"entities": loop}, "sensor.a") is None


def test_the_whole_page_from_home_assistants_energy_settings_alone():
    p = plan.build(ctx())
    assert p["title"] == "Energy"
    assert p["total"] == {"name": "Whole Home", "power": "sensor.main_live", "stat": "sensor.main_utility",
                          "cost": "sensor.main_utility_cost", "price": None}
    assert [s["id"] for s in p["sections"]] == ["hvac", "rooms", "appliances", "outlets", "charging"]
    assert [i["name"] for i in items(p, "rooms")] == ["Office", "Living Room", "Kitchen & Garage"]
    assert [i["name"] for i in items(p, "hvac")] == ["Upstairs AC"]
    office = items(p, "rooms")[0]
    assert office["power"] == "sensor.panel_office_power" and office["stat"] == "sensor.office_utility"
    assert office["icon"] == "hk:desk" and office["color"] == "orange"
    # a device with no power sensor is still shown (its tile reads today's kWh)
    assert "Dehumidifier" in [i["name"] for i in items(p, "appliances")]
    # the car's battery joins Charging, with its range
    car = [i for i in items(p, "charging") if i["kind"] == "battery"][0]
    assert car["name"] == "Roadster" and car["label"] == "sensor.car_range" and car["label_suffix"] == " mi range"
    assert car["house"] is False, "each battery row says whether it is the house's (HK Settings reads it)"
    # the readings row: cost, two thermostats, outside
    assert [t["kind"] for t in p["top"]] == ["cost", "climate", "climate", "temp"]
    assert p["top"][1]["name"] == "Downstairs" and p["top"][3]["name"] == "Outside"
    # the daily bars: the whole home, then the biggest top-level meters
    assert [u["name"] for u in p["usages"]][:3] == ["Whole Home", "Upstairs AC", "Wall Connector"]
    assert "Coffee Plug" not in [u["name"] for u in p["usages"]]
    # Home Assistant's own charts are off unless chosen (the page has its own)
    assert p["detail"] is False
    # what the house has, for Your Day's width: a battery, no water or gas
    assert p["sources"] == {"battery": True, "water": False, "gas": False, "solar": False, "cost": True}
    # the daily bars are automatic: each device's sheet has them
    assert p["usages_auto"] is True and p["page"] == {}


def test_a_device_inside_another_is_known_both_ways():
    p = plan.build(ctx())
    coffee = p["devices"]["sensor.coffee_plug_power"]
    assert coffee["parent"] == "sensor.kitchen_outlets_utility" and coffee["control"] == "switch.coffee_plug"
    assert p["devices"]["sensor.kitchen_outlets_utility"]["children"] == ["sensor.coffee_plug_energy"]
    assert p["names"]["sensor.coffee_plug_energy"] == "Coffee Plug"


def test_the_options_sort_name_and_hide():
    opts = {"sections": [{"id": "big", "name": "The Big Ones", "items": ["sensor.upstairs_ac_utility",
                                                                          "sensor.refrigerator_utility"],
                          "link": {"path": "/dashboard-home/power", "text": "Panel›"}},
                         {"id": "rooms", "name": "Rooms", "items": ["sensor.living_room_utility"]}],
            "devices": {"sensor.refrigerator_utility": {"name": "Fridge", "icon": "hk:fridge", "color": "mint"},
                        "sensor.no_power_utility": {"hidden": True}}}
    p = plan.build(ctx(), opts)
    ids = [s["id"] for s in p["sections"]]
    # the options' sections first, in their order; what they do not place
    # goes to the section its guess names if listed, else Other
    assert ids[:2] == ["big", "rooms"]
    assert [i["name"] for i in items(p, "big")] == ["Upstairs AC", "Fridge"]
    assert p["sections"][0]["link"] == {"path": "/dashboard-home/power", "text": "Panel›"}
    assert [i["name"] for i in items(p, "rooms")] == ["Living Room", "Office", "Kitchen & Garage"]
    assert "Dehumidifier" not in [i["name"] for s in p["sections"] for i in s["items"]]
    assert "other" in ids
    fridge = items(p, "big")[1]
    assert fridge["icon"] == "hk:fridge" and fridge["color"] == "mint"


def test_not_following_lists_only_the_features_own_devices():
    opts = {"follow": False, "extra": [{"key": "sensor.rack_power", "name": "Network Rack",
                                        "power": "sensor.rack_power"}]}
    p = plan.build(ctx(entities={**ENTS, "sensor.rack_power": E("Rack", "power", "W")}), opts)
    assert [i["name"] for s in p["sections"] for i in s["items"] if i["kind"] == "device"] == ["Network Rack"]


def test_the_options_choose_the_rows():
    opts = {"top": ["sensor.outside_temp"], "cost": False, "detail": False,
            "usages": [{"entity": "sensor.panel_office_power", "color": "purple"},
                       {"entity": "sensor.runtime", "name": "AC Runtime"}],
            "batteries": [{"entity": "sensor.car_battery", "name": "Car"}],
            "total": {"power": "sensor.other_power"}}
    ents = {**ENTS, "sensor.runtime": E("AC Run Time", "duration", "h")}
    p = plan.build(ctx(entities=ents), opts)
    assert p["top"] == [{"kind": "temp", "entity": "sensor.outside_temp", "name": "Outside"}]
    assert p["usages"][0] == {"entity": "sensor.panel_office_power", "stat": "sensor.office_utility", "name": "Office",
                              "color": "purple", "runtime": False}
    assert p["usages"][1]["runtime"] is True and p["usages"][1]["name"] == "AC Runtime"
    assert p["total"]["power"] == "sensor.other_power" and p["detail"] is False


def test_no_energy_settings_no_cost_and_no_detail():
    p = plan.build(ctx(prefs={}, vehicles=[]))
    assert p["total"]["stat"] is None and p["sections"] == [] and p["detail"] is False
    assert [t["kind"] for t in p["top"]] == ["climate", "climate", "temp"]


def test_the_newer_grid_shape_and_its_power():
    prefs = {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.main_utility", "stat_rate": "sensor.grid_w",
                                 "stat_cost": "sensor.my_cost"}]}
    g = plan.grid_of(prefs)
    assert g["stat"] == "sensor.main_utility" and g["rate"] == "sensor.grid_w" and g["cost"] == "sensor.my_cost"
    legacy = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.m",
                                                                 "entity_energy_price": "input_number.p"}]}]}
    assert plan.grid_of(legacy)["stat"] == "sensor.m" and plan.grid_of(legacy)["price"] == "input_number.p"


# ------------------------------------------------------------- the checks
def test_settings_are_checked_by_field():
    out, err = apply({}, {"follow": False, "title": "Power", "top": ["sensor.a"], "nope": 1, "cost": "yes",
                          "usages": [{"entity": "not an id"}]})
    assert out["follow"] is False and out["title"] == "Power" and out["top"] == ["sensor.a"]
    assert set(err) == {"nope", "cost", "usages"}
    out, err = apply({"top": ["sensor.a"]}, {"top": None})
    assert "top" not in out and not err
    out, err = apply({}, {"top": ["sensor.a"] * 5})
    assert err["top"]


def test_sections_place_a_device_once():
    out, err = apply({}, {"sections": [{"id": "a", "name": "A", "items": ["sensor.x", "sensor.y"]},
                                       {"id": "b", "name": "B", "items": ["sensor.x", "sensor.z"]}]})
    assert not err and out["sections"][1]["items"] == ["sensor.z"]
    _, err = apply({}, {"sections": [{"id": "a", "name": "A"}, {"id": "a", "name": "B"}]})
    assert err["sections"]


def test_one_device_at_a_time():
    out, err = apply_device({}, "sensor.x", {"name": "Fridge", "color": "mint"})
    assert not err and out["devices"] == {"sensor.x": {"name": "Fridge", "color": "mint"}}
    out, err = apply_device(out, "sensor.x", {"name": None, "color": None})
    assert not err and out["devices"] == {}
    _, err = apply_device({}, "sensor.x", {"color": "plaid"})
    assert err
    out, _ = apply_device({}, "sensor.x", {"hidden": True})
    assert out["devices"]["sensor.x"] == {"hidden": True}
    out, _ = apply_device(out, "sensor.x", {"hidden": False})
    assert out["devices"] == {}


def test_a_device_moved_keeps_every_other_place():
    """The sheet's Section picker: hidden devices keep their section, an
    empty section stays, links stay, and the device moved is shown."""
    placed = [{"id": "rooms", "name": "Rooms", "items": ["sensor.a", "sensor.hidden"], "link": {"path": "/x", "text": "X"}},
              {"id": "spare", "name": "Spare", "items": [], "link": None},
              {"id": "other", "name": "Other", "items": ["sensor.b"], "link": None}]
    opts = {"devices": {"sensor.b": {"hidden": True, "name": "Bee"}, "sensor.hidden": {"hidden": True}},
            "sections": [{"id": "rooms", "name": "Rooms", "items": ["sensor.a"]}, {"id": "spare", "name": "Spare"}]}
    keys = {"sensor.a", "sensor.b", "sensor.hidden"}
    out, err = move_device(opts, placed, keys, "sensor.b", "rooms")
    assert not err
    assert out["sections"] == [
        {"id": "rooms", "name": "Rooms", "items": ["sensor.a", "sensor.hidden", "sensor.b"], "link": {"path": "/x", "text": "X"}},
        {"id": "spare", "name": "Spare", "items": []}]       # Other was only guessed: emptied, it goes
    assert out["devices"] == {"sensor.b": {"name": "Bee"}, "sensor.hidden": {"hidden": True}}
    _, err = move_device(opts, placed, keys, "sensor.b", "nowhere")
    assert err == {"section": "Each section needs an id and a name."}
    _, err = move_device(opts, placed, keys, "sensor.nobody", "rooms")
    assert "key" in err


# ------------------------------------------------------------- the feature
async def test_added_once_and_its_plan_goes_to_the_screens(hass, frontend):
    hass.states.async_set("sensor.main_live", "1.5", {"device_class": "power", "unit_of_measurement": "kW"})
    r = await add_feature(hass, "energy", {"follow": True})
    assert r["type"] == "create_entry" and r["title"] == "Energy"
    (e,) = feature_entries(hass, "energy")
    assert e.unique_id == "feature:energy" and e.loaded and e.options == {"follow": True}
    flows = hass.config_entries.subentries
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert "energy" not in r["menu_options"]
    flows.async_abort(r["flow_id"])
    from custom_components.hk_frontend.features import energy
    p = energy.client(hass)
    assert p is not None and p["title"] == "Energy" and p["sections"] == []


class Conn:
    def __init__(self, user):
        self.user, self.sent = user, []

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})


async def _call(hass, conn, handler, **msg):
    handler(hass, conn, {"id": len(conn.sent) + 1, **msg})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


async def test_its_gear_and_its_settings_page(hass, frontend):
    from custom_components.hk_frontend.features.energy.settings_ws import (ws_device_set, ws_settings_get,
                                                                             ws_settings_set)
    conn = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    r = await _call(hass, conn, ws_settings_get, type="hk_energy/settings/get")
    assert r["result"] == {"configured": False}
    await add_feature(hass, "energy", {"follow": True})
    (e,) = feature_entries(hass, "energy")
    r = await feature_gear(hass, e)
    assert r["type"] == "form" and r["step_id"] == "energy_options"
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], {"follow": False})
    await hass.async_block_till_done()
    assert e.options == {"follow": False}
    r = await _call(hass, conn, ws_settings_set, type="hk_energy/settings/set", changes={"title": "Power", "cost": "no"})
    assert not r["success"] and json.loads(r["message"]) == {"cost": "Choose on or off."}
    r = await _call(hass, conn, ws_settings_set, type="hk_energy/settings/set", changes={"title": "Power"})
    assert r["success"] and r["result"]["plan"]["title"] == "Power" and r["result"]["options"]["title"] == "Power"
    assert e.options == {"follow": False, "title": "Power"}
    r = await _call(hass, conn, ws_device_set, type="hk_energy/device/set", key="sensor.x", changes={"name": "Fridge"})
    assert r["success"]
    assert e.options["devices"] == {"sensor.x": {"name": "Fridge"}}
    update_feature(hass, e, options={})
    await hass.async_block_till_done()


def _count_config(hass):
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from custom_components.hk_frontend.const import SIGNAL_CONFIG
    sent = []
    async_dispatcher_connect(hass, SIGNAL_CONFIG, lambda *a: sent.append(1))
    return sent


async def test_a_save_reaches_the_screens_once(hass, frontend):
    from custom_components.hk_frontend.features.energy.settings_ws import ws_device_section, ws_settings_set
    conn = Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))
    await add_feature(hass, "energy", {"follow": False})
    (e,) = feature_entries(hass, "energy")
    sent = _count_config(hass)
    r = await _call(hass, conn, ws_settings_set, type="hk_energy/settings/set", changes={"title": "Power"})
    assert r["success"] and len(sent) == 1, sent
    # a device moved through its sheet: one save, the screens told once
    update_feature(hass, e, options={"follow": False, "extra": [{"key": "fridge", "name": "Fridge", "power": "sensor.fridge_w"}],
                                     "sections": [{"id": "rooms", "name": "Rooms", "items": []},
                                                  {"id": "spare", "name": "Spare", "items": []}],
                                     "devices": {"fridge": {"hidden": True}}})
    await hass.async_block_till_done()
    sent.clear()
    r = await _call(hass, conn, ws_device_section, type="hk_energy/device/section", key="fridge", section="rooms")
    assert r["success"] and len(sent) == 1, sent
    assert e.options["sections"] == [{"id": "rooms", "name": "Rooms", "items": ["fridge"]},
                                     {"id": "spare", "name": "Spare", "items": []}]
    assert "devices" not in e.options or "fridge" not in e.options["devices"]
    r = await _call(hass, conn, ws_device_section, type="hk_energy/device/section", key="fridge", section="nope")
    assert not r["success"]


async def test_a_wall_tablet_cannot_move_a_device(hass, frontend):
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.features.energy.settings_ws import ws_device_section
    await hass.auth.async_create_user("Owner")
    tablet = Conn(await hass.auth.async_create_user("kitchen"))
    with pytest.raises(Unauthorized):
        ws_device_section(hass, tablet, {"id": 1, "type": "hk_energy/device/section", "key": "x", "section": "y"})


async def test_a_registry_change_reaches_the_screens_only_when_the_plan_changes(hass, frontend):
    from datetime import timedelta
    from homeassistant.helpers import entity_registry as er
    from homeassistant.util import dt as dt_util
    from pytest_homeassistant_custom_component.common import async_fire_time_changed
    from custom_components.hk_frontend.features import energy
    await add_feature(hass, "energy", {"follow": False})
    (e,) = feature_entries(hass, "energy")
    update_feature(hass, e, options={"follow": False, "extra": [{"key": "fridge", "name": "Fridge",
                                                                 "stat": "sensor.fridge_kwh"}]})
    await hass.async_block_till_done()
    assert energy.client(hass)["sections"][0]["items"][0]["power"] is None
    sent = _count_config(hass)
    reg = er.async_get(hass)
    # an unrelated entity: the plan is the same, nothing is sent
    reg.async_get_or_create("sensor", "test", "elsewhere", suggested_object_id="elsewhere")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3))
    await hass.async_block_till_done()
    assert sent == []
    # the meter's device gains a power sensor: the screens are told
    from homeassistant.helpers import device_registry as dr
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    ce = MockConfigEntry(domain="test")
    ce.add_to_hass(hass)
    dev = dr.async_get(hass).async_get_or_create(config_entry_id=ce.entry_id, identifiers={("test", "fridge")})
    reg.async_get_or_create("sensor", "test", "fridge_kwh", suggested_object_id="fridge_kwh", device_id=dev.id)
    reg.async_get_or_create("sensor", "test", "fridge_w", suggested_object_id="fridge_w", device_id=dev.id)
    hass.states.async_set("sensor.fridge_kwh", "3", {"device_class": "energy", "unit_of_measurement": "kWh"})
    hass.states.async_set("sensor.fridge_w", "120", {"device_class": "power", "unit_of_measurement": "W"})
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=6))
    await hass.async_block_till_done()
    assert len(sent) == 1, sent
    assert energy.client(hass)["sections"][0]["items"][0]["power"] == "sensor.fridge_w"


def test_the_pages_own_settings_and_section_colors():
    """HK Settings -> Energy: the tab it opens on, its rings, its usual day,
    its highlights -- each checked, each field alone, a null back to
    Automatic -- and a color for a section."""
    out, err = apply({}, {"page": {"opens_on": "week", "rings": ["energy", "cost", "water"], "typical": 14}})
    assert not err and out["page"] == {"opens_on": "week", "rings": ["energy", "cost", "water"], "typical": 14}
    out, err = apply(out, {"page": {"highlights": False}})
    assert not err and out["page"]["highlights"] is False and out["page"]["opens_on"] == "week", "one field changes alone"
    out, err = apply(out, {"page": {"opens_on": None}})
    assert not err and "opens_on" not in out["page"], "a null is Automatic again"
    for bad in ({"opens_on": "year"}, {"rings": ["energy", "steps"]}, {"rings": []}, {"typical": 10},
                {"typical": True}, {"highlights": "yes"}, {"other": 1}, "week"):
        _, err = apply({}, {"page": bad})
        assert err.get("page"), bad
    out, err = apply(out, {"page": None})
    assert not err and "page" not in out
    out, err = apply({}, {"sections": [{"id": "rooms", "name": "Rooms", "items": [], "color": "purple"}]})
    assert not err and out["sections"][0]["color"] == "purple"
    _, err = apply({}, {"sections": [{"id": "rooms", "name": "Rooms", "items": [], "color": "plaid"}]})
    assert err.get("sections")
    # the plan carries them to the page
    ctx = {"prefs": {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.g"},
                                        {"type": "water", "stat_energy_from": "sensor.w"},
                                        {"type": "solar", "stat_energy_from": "sensor.s"}],
                     "device_consumption": [{"stat_consumption": "sensor.office_utility"}]},
           "entities": {"sensor.office_utility": {"name": "Office Utility", "dc": "energy", "unit": "kWh"}}}
    opts = {"page": {"opens_on": "day"}, "usages": [],
            "sections": [{"id": "rooms", "name": "Rooms", "items": ["sensor.office_utility"], "color": "purple"}]}
    p = plan.build(ctx, opts)
    assert p["page"] == {"opens_on": "day"} and p["usages_auto"] is False
    assert p["sources"]["water"] and p["sources"]["solar"] and not p["sources"]["battery"]
    assert [s["color"] for s in p["sections"] if s["id"] == "rooms"] == ["purple"]


def test_a_device_can_carry_its_runtime():
    """An AC's daily runtime, chosen on its page: checked as an entity, and in
    the plan's tile for the page to show its hours."""
    out, err = apply_device({}, "sensor.ac_utility", {"runtime": "sensor.ac_run_time"})
    assert err is None and out["devices"]["sensor.ac_utility"]["runtime"] == "sensor.ac_run_time"
    _, err = apply_device({}, "sensor.ac_utility", {"runtime": "not an entity"})
    assert err
    ctx = {"prefs": {"energy_sources": [{"type": "grid", "stat_energy_from": "sensor.g"}],
                     "device_consumption": [{"stat_consumption": "sensor.ac_utility"}]},
           "entities": {"sensor.ac_utility": {"name": "Upstairs AC Utility", "dc": "energy", "unit": "kWh"}}}
    p = plan.build(ctx, out)
    tile = [i for s in p["sections"] for i in s["items"] if i["key"] == "sensor.ac_utility"][0]
    assert tile["runtime"] == "sensor.ac_run_time"
