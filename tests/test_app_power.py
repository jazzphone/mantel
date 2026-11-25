"""The app's Power page (apps/app_power.py): what it reads from the Energy feature's Power plan, only what the person may
view; nothing in it acts."""
from mantel_server.apps.app_power import power_ids, power_page

PLAN = {
    "title": "Power", "home": "sensor.home_w", "grid": "sensor.grid_w", "solar": "sensor.solar_w",
    "grid_status": "binary_sensor.grid", "backs_up": "some",
    "battery": {"level": "sensor.bat_pct", "charge": "sensor.bat_in_w", "discharge": "sensor.bat_out_w"},
    "mode": {"entity": "select.bat_mode", "options": [{"value": "backup", "name": "Backup Only"}]},
    "levels": [{"entity": "number.reserve", "name": "Backup Reserve"}],
    "status": [{"entity": "sensor.bat_state"}],
    "cars": [{"name": "Car", "level": "sensor.car_pct", "charge": "switch.car_charge", "limit": "number.car_limit"}],
    "sections": [{"id": "kitchen", "name": "Kitchen", "items": [
        {"key": "fridge", "name": "Fridge", "power": "sensor.fridge_w", "control": "switch.fridge", "backed": True},
        {"key": "oven", "name": "Oven", "power": "sensor.oven_w", "control": None, "backed": False},
        {"key": "secret", "name": "Hidden", "power": "sensor.secret_w", "control": "switch.secret", "backed": False}]}],
}
S = lambda s, **a: {"s": s, "a": a}
STATES = {
    "sensor.home_w": S("1200", unit_of_measurement="W"), "sensor.grid_w": S("300", unit_of_measurement="W"),
    "sensor.solar_w": S("unavailable"), "binary_sensor.grid": S("on"),
    "sensor.bat_pct": S("89", unit_of_measurement="%"), "sensor.bat_in_w": S("900", unit_of_measurement="W"),
    "sensor.bat_out_w": S("0", unit_of_measurement="W"),
    "select.bat_mode": S("backup", friendly_name="Mode", options=["backup", "self"]),
    "number.reserve": S("20", unit_of_measurement="%", min=0, max=100, step=5),
    "sensor.bat_state": S("charging", friendly_name="Battery State"),
    "sensor.car_pct": S("64", unit_of_measurement="%"), "switch.car_charge": S("off"),
    "number.car_limit": S("80", min=50, max=100, step=1),
    "sensor.fridge_w": S("150", unit_of_measurement="W"), "switch.fridge": S("on"),
    "sensor.oven_w": S("0", unit_of_measurement="W"),
    "sensor.secret_w": S("40", unit_of_measurement="W"), "switch.secret": S("on"),
}


def test_it_names_every_entity_the_page_reads():
    ids = power_ids(PLAN)
    assert {"sensor.home_w", "select.bat_mode", "number.reserve", "switch.car_charge", "switch.fridge",
            "sensor.secret_w"} <= set(ids)
    assert len(ids) == len(set(ids))


def test_the_page_as_the_person_may_see_it():
    may = set(power_ids(PLAN)) - {"sensor.secret_w", "switch.secret"}
    got = power_page(PLAN, STATES, may)
    assert [r["key"] for r in got["readings"]] == ["home", "grid"]          # the sun reads no number: left out
    assert got["grid_status"] == {"entity": "binary_sensor.grid", "state": "on"}
    assert got["battery"]["level"]["value"] == 89.0
    assert [(p["key"], p["name"]) for p in got["battery"]["parts"]] == [("charge", "Charging"), ("discharge", "Discharging")]
    assert got["battery"]["backs_up"] == "some"
    assert got["mode"]["options"] == [{"value": "backup", "name": "Backup Only"}]    # the page's own words first
    assert got["levels"] == [{"entity": "number.reserve", "name": "Backup Reserve", "value": 20.0, "unit": "%",
                              "min": 0.0, "max": 100.0, "step": 5.0}]
    assert got["status"] == [{"entity": "sensor.bat_state", "name": "Battery State", "state": "charging"}]
    car = got["cars"][0]
    assert car["level"]["value"] == 64.0 and car["charge"] == {"entity": "switch.car_charge", "on": False}
    assert car["limit"]["max"] == 100.0
    names = [c["name"] for c in got["circuits"]]
    assert names == ["Fridge", "Oven"]                                         # what the person may not view: out
    fridge = got["circuits"][0]
    assert fridge["control"] == "switch.fridge" and fridge["on"] is True and fridge["backed"] is True
    assert got["circuits"][1]["control"] is None


def test_a_mode_without_the_pages_words_offers_the_selects_own():
    plan = {**PLAN, "mode": {"entity": "select.bat_mode"}}
    got = power_page(plan, STATES, set(power_ids(plan)))
    assert [o["value"] for o in got["mode"]["options"]] == ["backup", "self"]


def test_no_battery_no_mode_nothing_viewable():
    got = power_page({"title": "Power", "home": "sensor.home_w"}, STATES, set())
    assert got["readings"] == [] and got["battery"] is None and got["mode"] is None and got["circuits"] == []
