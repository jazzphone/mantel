"""The Power page (features/energy/power.py): the Energy feature's second
page, right now and the controls. Its plan from the feature's `power` option
and the same devices as the Energy page: which are backed up by the house
battery (worked out from the device registry), the cars' parts found on their
own devices, and the option's checks."""
from __future__ import annotations

from custom_components.hk_frontend.features.energy import plan, power
from custom_components.hk_frontend.features.energy.settings_ws import apply

# this house's shapes: the EcoFlow panel's circuits on its own device, the
# water heater's switch a group of two of the panel's channels, a plug inside
# a backed-up outlet circuit, the air conditioners on their own meters, a car
PREFS = {
    "energy_sources": [
        {"type": "grid", "stat_energy_from": "sensor.main_utility", "stat_cost": None},
        {"type": "solar", "stat_energy_from": "sensor.pv_energy", "stat_rate": "sensor.pv_power"},
    ],
    "device_consumption": [
        {"stat_consumption": "sensor.office_utility", "stat_rate": "sensor.panel_office_power"},
        {"stat_consumption": "sensor.heater_utility", "stat_rate": "sensor.heater_power"},
        {"stat_consumption": "sensor.outlets_utility", "stat_rate": "sensor.panel_outlets_power"},
        {"stat_consumption": "sensor.rack_utility", "stat_rate": "sensor.rack_power", "included_in_stat": "sensor.outlets_utility"},
        {"stat_consumption": "sensor.ac_utility", "stat_rate": "sensor.ac_power"},
    ],
}


def E(name, dc=None, unit=None, device=None, **kw):
    return {"name": name, "dc": dc, "unit": unit, "device": device, "source": None, "state": "1", **kw}


ENTS = {
    "sensor.main_utility": E("Main Utility", "energy", "kWh"),
    "sensor.main_live": E("Main Live", "power", "kW"),
    "sensor.office_utility": E("Office Utility", "energy", "kWh"), "sensor.panel_office_power": E("Panel Office Power", "power", "W", "panel"),
    "switch.panel_c01": E("Office", device="panel"),
    "sensor.heater_utility": E("Water Heater Utility", "energy", "kWh"), "sensor.heater_power": E("Water Heater Power", "power", "W"),
    "switch.heater_circuits": E("Water Heater Circuits", members=["switch.panel_c02", "switch.panel_c04"]),
    "switch.panel_c02": E("Heater L1", device="panel"), "switch.panel_c04": E("Heater L2", device="panel"),
    "sensor.outlets_utility": E("Garage Outlets Utility", "energy", "kWh"), "sensor.panel_outlets_power": E("Panel Outlets Power", "power", "W", "panel"),
    "sensor.rack_utility": E("Network Rack Utility", "energy", "kWh"), "sensor.rack_power": E("Network Rack Power", "power", "W", "plug"),
    "sensor.ac_utility": E("Upstairs AC Utility", "energy", "kWh"), "sensor.ac_power": E("Upstairs AC Power", "power", "W", "monitor"),
    "sensor.panel_level": E("Panel Battery Level", "battery", "%", "panel"),
    "sensor.pv_power": E("Solar Power", "power", "W"),
    "sensor.car_level": E("Blue Car Battery level", "battery", "%", "car", range="sensor.car_range"),
    "sensor.car_range": E("Blue Car Range", "distance", "mi", "car"),
    "sensor.car_charger_power": E("Blue Car Charger power", "power", "kW", "car"),
    "device_tracker.car_location": E("Blue Car Location", device="car"),
    "binary_sensor.car_charge_cable": E("Blue Car Charge cable", device="car"),
    "switch.car_charge": E("Blue Car Charge", device="car"),
    "number.car_charge_limit": E("Blue Car Charge limit", device="car"),
    "number.car_charge_current": E("Blue Car Charge current", device="car"),
}
DEVICES_OPT = {"sensor.heater_utility": {"control": "switch.heater_circuits"}, "sensor.office_utility": {"control": "switch.panel_c01"}}


def ctx():
    return {"prefs": PREFS, "entities": ENTS, "areas": {}, "thermostats": [], "outside": None, "house_power": "sensor.main_live",
            "vehicles": ["sensor.car_level"]}


def page(**pw):
    return plan.build(ctx(), {"devices": DEVICES_OPT, "power": {"battery": {"level": "sensor.panel_level"}, **pw}})["power"]


def items(p):
    return {i["name"]: i for s in p["sections"] for i in s["items"]}


def test_off_until_the_option_is_there():
    assert plan.build(ctx(), {})["power"] is None
    assert plan.build(ctx(), {"power": {"on": False}})["power"] is None


def test_automatic_readings_the_whole_house_the_grid_the_sun():
    p = page()
    assert p["title"] == "Power" and p["path"] == "power"
    assert p["home"] == "sensor.main_live" and p["grid"] == "sensor.main_live"
    assert p["solar"] == "sensor.pv_power"
    assert p["backs_up"] == "some"


def test_the_house_that_ships_unless_a_picture_folder_is_set():
    # (2026-10-14: HK Frontend's own house ships, frontend/power-house; a folder
    # of your own takes its place, and "chart" is the flow chart)
    from custom_components.hk_frontend.features.energy.power import BUILT_IN_ART
    p = page()
    assert p["picture"] is True and p["art"] == BUILT_IN_ART == "/hk/power-house/"
    assert page(picture="chart")["picture"] is False
    # ...and it is all there: each layer art.json names, beside it
    import json
    from pathlib import Path
    from custom_components.hk_frontend import settings as S   # (the component, wherever the tests sit)
    folder = Path(S.__file__).parent / "frontend" / "power-house"
    art = json.loads((folder / "art.json").read_text())
    assert {"house", "pole", "battery", "solar", "car", "charger", "cable"} <= set(art["layers"])
    for name, layer in art["layers"].items():
        assert (folder / layer[0]).is_file(), name
    p = page(art="/hk/art/my-house/")
    assert p["picture"] is True and p["art"] == "/hk/art/my-house/"
    assert page(art="/hk/art/my-house/", picture="chart")["picture"] is False


def test_backed_up_from_the_device_registry():
    it = items(page())
    assert it["Office"]["backed"] and "battery's device" in it["Office"]["why"]
    assert it["Water Heater"]["backed"] and it["Water Heater"]["why"] == "its switch is 2 of the battery's circuits"
    assert it["Garage Outlets"]["backed"]
    assert it["Network Rack"]["backed"] and it["Network Rack"]["why"] == "it is inside Garage Outlets"
    assert not it["Upstairs AC"]["backed"]


def test_a_devices_own_choice_wins_and_the_whole_house_choice():
    it = items(page(backed={"sensor.ac_utility": True, "sensor.office_utility": False}))
    assert it["Upstairs AC"]["backed"] and it["Upstairs AC"]["why"] == "chosen"
    assert not it["Office"]["backed"]
    assert all(i["backed"] for i in items(page(backs_up="all")).values())
    assert not any(i["backed"] for i in items(page(backs_up="none")).values())


def test_no_battery_named_nothing_is_backed_up():
    p = plan.build(ctx(), {"devices": DEVICES_OPT, "power": {}})["power"]
    assert p["backs_up"] == "none" and not any(i["backed"] for i in items(p).values())


def test_a_cars_parts_are_found_on_its_own_device():
    car = page()["cars"][0]
    assert car == {"level": "sensor.car_level", "name": "Blue Car", "home": "device_tracker.car_location",
                   "power": "sensor.car_charger_power", "plugged": "binary_sensor.car_charge_cable",
                   "charge": "switch.car_charge", "limit": "number.car_charge_limit", "range": "sensor.car_range",
                   "found_name": "Blue Car"}


def test_a_car_named_and_its_charging_read_where_the_settings_say():
    car = page(car_opts={"sensor.car_level": {"name": "Blue", "charger": "sensor.left_wall_connector_power"}})["cars"][0]
    assert car["name"] == "Blue" and car["found_name"] == "Blue Car" and car["charger"] == "sensor.left_wall_connector_power"
    own = page(car_opts={"sensor.car_level": {"charger": "car"}})["cars"][0]
    assert own["charger"] == "sensor.car_charger_power" and own["name"] == "Blue Car"
    assert "charger" not in page()["cars"][0]


def test_the_options_checks():
    out, err = apply({}, {"power": {"title": "EcoFlow", "path": "ecoflow", "battery": {"level": "sensor.panel_level", "packs": [{"name": "Pack 1", "level": "sensor.p1"}]},
                                    "mode": {"entity": "select.mode", "options": [{"value": "none", "name": "Off", "description": "Grid passes through."}]},
                                    "levels": [{"entity": "number.limit", "name": "Charge Limit", "color": "green"}], "backed": {"sensor.ac_utility": True}}})
    assert not err and out["power"]["path"] == "ecoflow" and out["power"]["mode"]["options"][0]["name"] == "Off"
    out, err = apply({}, {"power": {"car_opts": {"sensor.car_level": {"name": " Blue ", "charger": "car"}, "sensor.other_level": {"name": ""}}}})
    assert not err and out["power"]["car_opts"] == {"sensor.car_level": {"name": "Blue", "charger": "car"}}
    for bad in ({"grid": "not an entity"}, {"car_opts": {"sensor.car_level": {"charger": "the left one"}}}, {"car_opts": {"nope": {}}},
                {"car_opts": {"sensor.car_level": {"name": "x" * 41}}}, {"path": "Has Spaces"}, {"backs_up": "maybe"}, {"backed": {"x": "yes"}}, {"cars": [{"name": "x"}]}, "nope"):
        _, err = apply({}, {"power": bad})
        assert "power" in err, bad
    out, err = apply({"power": {"title": "x"}}, {"power": None})
    assert not err and "power" not in out
