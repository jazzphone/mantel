"""A vacuum's water tank that ran dry, held until cleared (2026-11-09; hk_core/vacuum_water.py, mantel_server/vacuum_water.py): caught
from a one-second report, shared as Mantel's own sensor, cleared by the key or by Clear After hours, kept across a restart."""
import pytest

import gateway_fakes as GF
from hk_core import vacuum_water as R
from mantel_server.settings_store import Actor as SettingsActor
from mantel_server.features.vacuum_water import VacuumWater

gw = GF.gw          # (the fixture, by name)
V, ERR, DOCK = "vacuum.roborock", "sensor.roborock_operational_error", "sensor.roborock_dock_operational_error"
HOUR = 3600.0


# ---- the rules
@pytest.mark.parametrize("value,words", [("water_tank_empty", "Water tank empty"), ("Water Tank Missing", "Water tank missing"),
                                         ("mop_pad_missing", "Mop pad missing"), ("no_error", None), ("stuck", None), ("unavailable", None),
                                         (None, None), ("", None), ("clean_water_box_empty", "Clean water box empty")])
def test_what_counts_as_a_water_report(value, words):
    assert R.water_words(value) == words


def test_a_vacuums_own_state_and_attributes_are_read_too():
    assert R.own_words({"s": "docked", "a": {"status": "Water tank empty"}}) == "Water tank empty"
    assert R.own_words({"s": "error", "a": {"error": "water_shortage"}}) == "Water shortage"
    assert R.own_words({"s": "error", "a": {"error": "stuck"}}) is None and R.own_words(None) is None


def test_the_settings_and_their_defaults():
    assert R.settings(None) == (True, 24) and R.settings({"vacuums": {}}) == (True, 24)
    assert R.settings({"vacuums": {"water_tank": False, "water_clear": 48}}) == (False, 48)
    assert R.settings({"vacuums": {"water_clear": 0}}) == (True, 0) and R.settings({"vacuums": {"water_clear": 7}}) == (True, 24)


def test_expiry():
    assert not R.expired(0, 24, 24 * HOUR - 1) and R.expired(0, 24, 24 * HOUR) and not R.expired(0, 0, 10 ** 9)


def test_the_error_sensors_are_the_vacuums_not_the_docks():
    entries = {V: {"device_id": "d1"}, ERR: {"device_id": "d1"}, DOCK: {"device_id": "d1"}, "sensor.roborock_battery": {"device_id": "d1"},
               "sensor.other_operational_error": {"device_id": "d2"}, "sensor.roborock_charge_error": {"device_id": "d1"}}
    assert R.error_sensor_of(V, "d1", entries, {}) == ["sensor.roborock_charge_error", ERR] and R.error_sensor_of(V, None, entries, {}) == []


# ---- on Mantel
class House:
    def __init__(self, gw, *, second=False):
        self.gw, self.hub, self.host = gw, gw.m.app["hub"], gw.m.app["vacuum_water"]
        ents = list(GF.HOUSE_ENTITIES) + [{"entity_id": V, "device_id": "d1"}, {"entity_id": ERR, "device_id": "d1"}, {"entity_id": DOCK, "device_id": "d1"}]
        if second:
            ents += [{"entity_id": "vacuum.bruce", "device_id": "d2"}, {"entity_id": "sensor.bruce_operational_error", "device_id": "d2"}]
        self.hub.registry.load(GF.HOUSE_AREAS, [], ents)
        self.put(V, "docked", friendly_name="Roborock")
        self.put(ERR, "no_error")
        self.put(DOCK, "no_error")
        if second:
            self.put("vacuum.bruce", "docked")
            self.put("sensor.bruce_operational_error", "no_error")

    def put(self, eid, state, **attrs):
        self.hub.store.states[eid] = {"s": state, "a": attrs, "lc": self.gw.now[0], "lu": self.gw.now[0]}
        self.hub.on_change({eid})

    def blip(self, eid=ERR, words="water_tank_empty"):
        """The report of under a second: it appears, and is gone."""
        self.put(eid, words)
        self.put(eid, "no_error")

    @property
    def tanks(self):
        return self.hub.store.states[R.SENSOR]["a"]["tanks"]


def settings(env, **vacuums):
    env.m.app["settings"].store.write([("house", "settings", {"headers": {"vacuums": vacuums}})], actor=SettingsActor(label="test"))
    env.app["vacuum_water"].expire()


async def test_a_one_second_report_is_caught_and_shared(gw):
    h = House(gw)
    assert h.tanks == {} and h.hub.store.states[R.SENSOR]["s"] == "0"
    gw.now[0] += 100
    h.blip()
    assert h.tanks == {V: {"since": gw.now[0], "words": "Water tank empty"}} and h.hub.store.states[R.SENSOR]["s"] == "1"
    assert R.SENSOR in h.hub.store.ours


async def test_the_dock_is_not_the_vacuum(gw):
    h = House(gw)
    h.blip(DOCK)
    assert h.tanks == {}


async def test_the_vacuums_own_attributes_count(gw):
    h = House(gw)
    h.put(V, "docked", friendly_name="Roborock", status="Water tank empty")
    assert h.tanks[V]["words"] == "Water tank empty"


async def test_a_new_report_refreshes_since_and_a_standing_one_does_not(gw):
    h = House(gw)
    h.blip()
    first = h.tanks[V]["since"]
    gw.now[0] += 2 * HOUR
    h.put(ERR, "no_error", extra=1)               # nothing new
    assert h.tanks[V]["since"] == first
    h.blip(words="water_tank_missing")
    assert h.tanks[V] == {"since": gw.now[0], "words": "Water tank missing"}
    gw.now[0] += HOUR
    h.put(ERR, "water_tank_missing")              # (a third report, an hour later: new, since it left in between)
    stamp = gw.now[0]
    gw.now[0] += HOUR
    h.put(ERR, "water_tank_missing", again=True)  # standing: the same report again is not a new one
    assert h.tanks[V]["since"] == stamp and len(h.tanks) == 1


async def test_one_latch_per_vacuum(gw):
    h = House(gw, second=True)
    h.blip()
    h.blip("sensor.bruce_operational_error")
    assert sorted(h.tanks) == ["vacuum.bruce", V]


async def test_clear_from_any_screen_clears_it_for_everyone(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    h.blip()
    got = await gw.command(ws, id=1, kind="service", domain="script", service=R.CLEAR, data={"vacuum": V}, return_response=True)
    assert got["result"]["response"] == {"cleared": True} and h.tanks == {}
    again = await gw.command(ws, id=2, kind="service", domain="script", service=R.CLEAR, data={"vacuum": V}, return_response=True)
    assert again["result"]["response"] == {"cleared": False, "reason": "not_latched"}
    assert not gw.fake.sent                      # nothing went to Home Assistant
    h.put(ERR, "no_error")
    assert h.tanks == {}
    await ws.close()


async def test_a_wall_tablet_can_clear_it(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    h.blip()
    got = await gw.command(ws, id=1, kind="service", domain="script", service=R.CLEAR, data={"vacuum": V}, return_response=True)
    assert got["result"]["response"] == {"cleared": True}
    await ws.close()


async def test_it_clears_itself_after_clear_after_hours(gw):
    h = House(gw)
    h.blip()
    gw.now[0] += 24 * HOUR - 5
    h.host.expire()
    assert V in h.tanks
    gw.now[0] += 10
    h.host.expire()
    assert h.tanks == {}


async def test_clear_after_is_a_setting_and_until_cleared_never_ends(gw):
    h = House(gw)
    settings(gw, water_clear=12)
    h.blip()
    gw.now[0] += 12 * HOUR
    h.host.expire()
    assert h.tanks == {}
    settings(gw, water_clear=0)
    h.blip(words="water_tank_missing")
    gw.now[0] += 400 * HOUR
    h.host.expire()
    assert V in h.tanks


async def test_off_latches_nothing_and_drops_what_was_there(gw):
    h = House(gw)
    h.blip()
    assert V in h.tanks
    settings(gw, water_tank=False)
    assert h.tanks == {} and gw.m.app["store"].db.execute("SELECT COUNT(*) FROM vacuum_water").fetchone()[0] == 0
    h.blip()
    assert h.tanks == {}
    settings(gw, water_tank=True)
    h.blip()
    assert V in h.tanks


async def test_it_survives_a_restart_and_a_standing_report_after_it_does_not_refresh(gw):
    h = House(gw)
    gw.now[0] += 50
    h.blip()
    since = h.tanks[V]["since"]
    gw.now[0] += 3 * HOUR
    again = VacuumWater(gw.m.app, h.hub, lambda: gw.now[0])          # a Mantel that starts now reads the same table
    assert again.latches == {V: {"since": since, "words": "Water tank empty"}}
    h.put(ERR, "water_tank_empty")                                    # (the report is still standing when it looks)
    again.hub = h.hub
    again.overlay({V})
    assert again.latches[V]["since"] == since


async def test_a_clear_of_a_vacuum_not_latched_says_so(gw):
    House(gw)
    assert gw.m.app["vacuum_water"].clear("vacuum.nobody") == {"cleared": False, "reason": "not_latched"}
    assert gw.m.app["vacuum_water"].clear(None) == {"cleared": False, "reason": "not_latched"}
