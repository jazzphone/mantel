"""Laundry: Done held until someone unloads (phase 22; hk_core/laundry.py, mantel_server/features/laundry.py): a machine that was running and
isn't is Done, shared as Mantel's own sensor, gone when cleared from any screen, when the door opens, when it runs again or after
Clear After hours; kept across a restart; found machines watched with nothing saved; a power plug's machine too."""
import pytest

import gateway_fakes as GF
from hk_core import laundry as R
from mantel_server.features.laundry import LaundryDone
from mantel_server.settings_store import Actor as SettingsActor

gw = GF.gw          # (the fixture, by name)
HOUR = 3600.0
ST, JOB, DOOR = "sensor.washer_machine_state", "sensor.washer_job_state", "binary_sensor.washer_door"
JOBS = ["drying", "finish", "none", "rinse", "spin", "wash", "wrinkle_prevent"]


class House:
    """A washer-dryer found on its device (nothing saved), its door on the same device."""
    def __init__(self, gw):
        self.gw, self.hub, self.host = gw, gw.m.app["hub"], gw.m.app["laundry"]
        ents = list(GF.HOUSE_ENTITIES) + [{"entity_id": e, "device_id": "w1"} for e in (ST, JOB, DOOR, "select.washer")]
        self.hub.registry.load(GF.HOUSE_AREAS, [{"id": "w1", "name": "Washer", "model": "WD53"}], ents)
        self.put(ST, "stop", device_class="enum", options=["pause", "run", "stop"])
        self.put(JOB, "none", device_class="enum", options=JOBS)
        self.put(DOOR, "off", device_class="door")
        self.put("select.washer", "stop", options=["stop", "run", "pause"])

    def put(self, eid, state, **attrs):
        old = self.hub.store.states.get(eid)
        a = attrs or (old or {}).get("a") or {}
        self.hub.store.states[eid] = {"s": state, "a": a, "lc": self.gw.now[0], "lu": self.gw.now[0]}
        self.hub.on_change({eid})

    def run(self, job="wash"):
        self.put(ST, "run")
        self.put(JOB, job)

    def finish(self):
        self.put(ST, "stop")
        self.put(JOB, "none")

    @property
    def done(self):
        return self.hub.store.states[R.SENSOR]["a"]["machines"]


def settings(env, **features):
    env.m.app["settings"].store.write([("house", "settings", {"features": features})], actor=SettingsActor(label="test"))
    env.app["laundry"].expire()


async def test_found_with_nothing_saved_and_done_when_it_stops(gw):
    h = House(gw)
    assert h.done == {} and R.SENSOR in h.hub.store.ours and h.host.status()["watching"] == ["washer"]
    h.run()
    gw.now[0] += 50 * 60
    h.run("drying")
    assert h.done == {}
    gw.now[0] += 30 * 60
    h.finish()
    assert h.done == {"washer": {"since": gw.now[0], "words": "Done"}} and h.hub.store.states[R.SENSOR]["s"] == "1"


async def test_stopping_without_having_been_seen_running_is_not_guessed_at(gw):
    h = House(gw)
    h.finish()
    assert h.done == {}


async def test_running_again_or_the_door_clears_it(gw):
    h = House(gw)
    h.run()
    h.finish()
    assert "washer" in h.done
    h.run()
    assert h.done == {}
    h.finish()
    assert "washer" in h.done
    h.put(DOOR, "on")
    assert h.done == {}
    assert gw.m.app["store"].db.execute("SELECT COUNT(*) FROM laundry_done").fetchone()[0] == 0


async def test_clear_from_any_screen_clears_it_for_everyone_and_sends_nothing(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    h.run()
    h.finish()
    got = await gw.command(ws, id=1, kind="service", domain="script", service=R.CLEAR, data={"machine": "washer"}, return_response=True)
    assert got["result"]["response"] == {"cleared": True} and h.done == {}
    again = await gw.command(ws, id=2, kind="service", domain="script", service=R.CLEAR, data={"machine": "washer"}, return_response=True)
    assert again["result"]["response"] == {"cleared": False, "reason": "not_done"}
    assert not gw.fake.sent
    await ws.close()


async def test_a_wall_tablet_can_clear_it(gw):
    h = House(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    h.run()
    h.finish()
    got = await gw.command(ws, id=1, kind="service", domain="script", service=R.CLEAR, data={"machine": "washer"}, return_response=True)
    assert got["result"]["response"] == {"cleared": True}
    await ws.close()


async def test_it_clears_itself_after_clear_after_hours_and_until_cleared_never_ends(gw):
    h = House(gw)
    h.run()
    h.finish()
    gw.now[0] += 4 * HOUR - 5
    h.host.expire()
    assert "washer" in h.done
    gw.now[0] += 10
    h.host.expire()
    assert h.done == {}
    settings(gw, laundry_clear=0)
    h.run()
    h.finish()
    gw.now[0] += 400 * HOUR
    h.host.expire()
    assert "washer" in h.done


async def test_a_saved_machine_on_a_power_plug(gw):
    h = House(gw)
    h.put("sensor.dryer_plug_power", "2.0", device_class="power", unit_of_measurement="W")
    settings(gw, laundry=[{"id": "dryer", "name": "Dryer", "kind": "dryer", "power": "sensor.dryer_plug_power", "watts": 20}])
    h.put("sensor.dryer_plug_power", "1.5")
    assert h.host.status()["watching"] == ["dryer"]
    h.put("sensor.dryer_plug_power", "640")
    h.put("sensor.dryer_plug_power", "12")          # (under Running Above: stopped)
    assert "dryer" in h.done
    h.run()
    h.finish()
    assert "washer" not in h.done                   # (the found washer isn't watched once the list is the person's)


async def test_it_survives_a_restart(gw):
    h = House(gw)
    h.run()
    gw.now[0] += 50
    h.finish()
    since = h.done["washer"]["since"]
    gw.now[0] += 3 * HOUR
    again = LaundryDone(gw.m.app, h.hub, lambda: gw.now[0])         # a Mantel that starts now reads the same table
    assert again.latches == {"washer": {"since": since, "words": "Done"}}
    again.overlay({ST})                                               # (its first look: what was caught stays)
    assert again.latches["washer"]["since"] == since


async def test_a_clear_of_a_machine_not_done_says_so(gw):
    House(gw)
    assert gw.m.app["laundry"].clear("nobody") == {"cleared": False, "reason": "not_done"}
    assert gw.m.app["laundry"].clear(None) == {"cleared": False, "reason": "not_done"}


@pytest.mark.parametrize("bad", [[{"id": "x", "name": "X", "kind": "washer"}], "nonsense"])
async def test_a_bad_saved_list_watches_the_found_machines(gw, bad):
    h = House(gw)
    gw.m.app["settings"].store.write([("house", "settings", {"features": {"laundry": bad}})], actor=SettingsActor(label="test"))
    h.host.expire()
    h.run()
    h.finish()
    assert "washer" in h.done


class Walked(dict):
    """The states, counting each look at every one of them."""
    walks = 0

    def __iter__(self):
        Walked.walks += 1
        return super().__iter__()

    def items(self):
        Walked.walks += 1
        return super().items()

    def keys(self):
        Walked.walks += 1
        return super().keys()


def startup(h, others=600, batch=3, on_change=None):
    """Home Assistant starting: the registry first, then its states a few at a time, the washer's among them (2026-11-13)."""
    devs = [{"id": f"d{i}", "name": f"Thing {i}", "model": "T1"} for i in range(others // 3)] + [{"id": "w1", "name": "Washer", "model": "WD53"}]
    ents = [{"entity_id": f"sensor.thing_{i}_temperature", "device_id": f"d{i // 3}"} for i in range(others)]
    ents += [{"entity_id": e, "device_id": "w1"} for e in (ST, JOB, DOOR, "select.washer")]
    h.hub.registry.load(GF.HOUSE_AREAS, devs, ents)
    rows = [(e["entity_id"], {"s": "21.5", "a": {"device_class": "temperature"}}) for e in ents[:others]]
    rows[others // 2:others // 2] = [(ST, {"s": "stop", "a": {"device_class": "enum", "options": ["pause", "run", "stop"]}}),
                                     (JOB, {"s": "none", "a": {"device_class": "enum", "options": JOBS}})]
    rows.append((DOOR, {"s": "off", "a": {"device_class": "door"}}))
    states = h.hub.store.states
    for i in range(0, len(rows), batch):
        part = rows[i:i + batch]
        for eid, st in part:
            states[eid] = {**st, "lc": h.gw.now[0], "lu": h.gw.now[0]}
        (on_change or h.hub.on_change)({eid for eid, _ in part})


async def test_home_assistant_starting_up_is_not_a_full_look_per_batch(gw, monkeypatch):
    # 2026-11-13: every batch that added an entity looked at the whole house again (`found`), and Home Assistant's start
    # (thousands of entities, a few at a time) held Mantel Server's event loop for minutes
    h = House(gw)
    calls = []
    real = R.found
    monkeypatch.setattr(R, "found", lambda *a: calls.append(1) or real(*a))
    startup(h)
    assert len(calls) <= 5, f"{len(calls)} full looks for one start"
    assert h.host.status()["watching"] == ["washer"]
    h.run()
    h.finish()
    assert "washer" in h.done
    h.put(DOOR, "on")                                # (the door, which came last, is watched)
    assert h.done == {}


async def test_an_entity_that_does_not_read_like_laundry_is_found_by_the_slow_look(gw):
    h = House(gw)
    h.put("sensor.laundry_energy", "12.0", device_class="energy", source="sensor.circuit_7_power")
    h.put("sensor.circuit_7_power", "1.0", device_class="power", unit_of_measurement="W")
    machine = next(m for m in h.host.machines if m["id"] == "washer")
    assert machine["power"] is None                  # (nothing in its words says laundry: not looked at per batch)
    gw.now[0] += 61
    h.host.expire()
    machine = next(m for m in h.host.machines if m["id"] == "washer")
    assert machine["power"] == "sensor.circuit_7_power"


async def test_no_overlay_looks_at_every_state_per_batch_while_home_assistant_starts(gw):
    # (the TV's players and the vacuums were found again on every batch that added an entity too)
    h = House(gw)
    h.hub.store.states = Walked(h.hub.store.states)
    Walked.walks = 0

    def overlays(changed):
        for overlay in h.hub.overlays:
            changed = overlay(changed)
    startup(h, on_change=overlays)
    assert Walked.walks <= 10, f"{Walked.walks} walks over every state for {len(h.hub.store.states) // 3} batches"
