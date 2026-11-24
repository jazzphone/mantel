"""Today's Energy Rings for the iPhone's widget (hk_core.energy.rings): today against a usual day, the dot by now."""
from hk_core.energy import rings as RG

MID = 1_800_000_000.0 - (1_800_000_000.0 % 86400)      # a midnight (UTC is enough here)


def start(r):
    return r["start"]


def day(d, per_hour, hours=24, sid="sensor.grid"):
    """`hours` rows of `per_hour` for the day `d` days before MID."""
    return [{"start": MID - d * 86400 + h * 3600, "change": per_hour} for h in range(hours)]


def test_a_usual_day_and_where_it_is_by_now():
    rows = {"sensor.grid": day(1, 1.0) + day(2, 0.5) + [{"start": MID + h * 3600, "change": 2.0} for h in range(6)]}
    got = RG.rings({"energy": ["sensor.grid"]}, rows, MID, MID + 6.5 * 3600, start)
    assert got == [{"key": "energy", "name": "Energy", "value": 12.0, "usual": 18.0, "by_now": 0.25, "unit": "kWh"}]


def test_which_rings_and_their_statistics():
    plan = {"total": {"stat": "sensor.grid", "cost": "sensor.grid_cost"}}
    prefs = {"energy_sources": [{"type": "solar", "stat_energy_from": "sensor.sun"}, {"type": "grid"},
                                {"type": "water", "stat_energy_from": "sensor.water"}]}
    assert RG.stats_of(plan, prefs) == {"energy": ["sensor.grid"], "cost": ["sensor.grid_cost"], "solar": ["sensor.sun"],
                                        "water": ["sensor.water"]}
    rows = {s: day(1, 1.0) + [{"start": MID, "change": 1.0}] for s in ("sensor.grid", "sensor.grid_cost", "sensor.sun",
                                                                         "sensor.water", "sensor.gas")}
    stats = dict(RG.stats_of(plan, prefs), gas=["sensor.gas"])
    got = RG.rings(stats, rows, MID, MID + 3600 * 2, start, {"water": "gal"})
    assert [r["key"] for r in got] == ["energy", "cost", "solar", "water"]          # four at most, the block's order
    assert got[1]["unit"] == "" and got[3]["unit"] == "gal"


def test_a_ring_with_nothing_is_left_out_and_a_day_with_no_rows_is_not_usual():
    rows = {"sensor.grid": day(3, 1.0)}
    got = RG.rings({"energy": ["sensor.grid"], "solar": ["sensor.sun"]}, rows, MID, MID + 3600, start)
    assert [r["key"] for r in got] == ["energy"] and got[0]["usual"] == 24.0 and got[0]["value"] == 0
