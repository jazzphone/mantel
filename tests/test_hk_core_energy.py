"""hk_core.energy: the Energy and Power pages' plan, run once here without Home Assistant (the HA
feature's suites, tests/py/test_feature_energy.py and test_feature_power.py, run the same code
through the HACS build, with HA's `collect` feeding it)."""
from hk_core.energy import plan, power


def test_names_lose_their_meter_words():
    assert plan.short_name("Office Utility") == "Office"
    assert plan.short_name("Smart Plug Energy Consumption") == "Smart Plug"
    assert plan.short_name("Utility") == "Utility"


def test_the_grid_is_read_from_the_energy_preferences():
    prefs = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_in"}],
                                 "flow_to": [{"stat_energy_to": "sensor.grid_out"}]}]}
    g = plan.grid_of(prefs)
    assert g and "sensor.grid_in" in str(g)
    assert plan.grid_of(None) in ({}, None) or not plan.grid_of(None)


def test_power_module_is_plain_python():
    assert hasattr(power, "build") and hasattr(power, "check")
