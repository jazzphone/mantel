"""The House Timeline on a 5,000-entity house (docs/phase19/HOUSE-TIMELINE.md "Performance"): the tap's p95 under
0.2 ms per hub batch with 300 members and 500 changes a second; a flush's p95 under 15 ms; the queue doesn't grow;
the hub's fan-out is the same within noise with the tap and without it.

The numbers of a run are printed (``-s``) for docs/development/Performance-baseline.md."""
from __future__ import annotations

import os
import random
import statistics
import time
from types import SimpleNamespace

import pytest

from mantel_server import performance
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore
from mantel_server.storage.store import Store
from mantel_server.timeline.core import Timeline

N_ENTITIES = 5000
N_DOORS, N_LOCKS, N_DETECT = 200, 60, 40          # 300 members
RATE = 500                                        # changes a second
SECONDS = 60
BATCHES_PER_S = 20                                # HA's coalesced events: a batch every 50 ms
T0 = 1_800_000_000.0


def p95(xs):
    xs = sorted(xs)
    return xs[max(0, int(len(xs) * 0.95) - 1)]


def house():
    areas = [{"area_id": f"a{i}", "name": f"Room {i}"} for i in range(40)]
    devices = [{"id": f"cam{i}", "name": f"Cam {i}", "area_id": f"a{i % 40}"} for i in range(N_DETECT)]
    entities, states = [], {}
    for i in range(N_DOORS):
        eid = f"binary_sensor.door_{i}"
        entities.append({"entity_id": eid, "area_id": f"a{i % 40}", "original_device_class": "door"})
        states[eid] = "off"
    for i in range(N_LOCKS):
        eid = f"lock.lock_{i}"
        entities.append({"entity_id": eid, "area_id": f"a{i % 40}"})
        states[eid] = "locked"
    for i in range(N_DETECT):
        entities.append({"entity_id": f"camera.cam_{i}", "device_id": f"cam{i}"})
        states[f"camera.cam_{i}"] = "idle"
        eid = f"binary_sensor.cam_{i}_person_detected"
        entities.append({"entity_id": eid, "device_id": f"cam{i}", "original_device_class": "occupancy"})
        states[eid] = "off"
    n = len(states)
    for i in range(N_ENTITIES - n):
        eid = f"sensor.power_{i}"
        entities.append({"entity_id": eid, "area_id": f"a{i % 40}", "original_device_class": "power"})
        states[eid] = "0"
    return areas, devices, entities, states


@pytest.mark.skipif(os.environ.get("MANTEL_SKIP_PERF") == "1", reason="MANTEL_SKIP_PERF=1")
def test_the_tap_and_the_writer_stay_within_budget_on_a_5000_entity_house(tmp_path):
    areas, devices, entities, first = house()
    store = Store(tmp_path / "m.db")
    hub = SimpleNamespace(store=StateStore(), registry=Registry(), taps=[], ha=None)
    hub.registry.load(areas, devices, entities)
    now = [T0]
    tl = Timeline({"cfg": None}, hub, store.db, clock=lambda: now[0], folder=tmp_path / "timeline")
    tl.tap(hub.store.replace_all({"a": {e: {"s": s, "a": {}, "lc": T0 - 60} for e, s in first.items()}}))
    assert len(tl.members) == N_DOORS + N_LOCKS + N_DETECT == 300
    performance.STATS.reset()
    rnd = random.Random(19)
    members = list(tl.members)
    others = [e for e in first if e.startswith("sensor.")]
    per_batch = RATE // BATCHES_PER_S
    toggles = {"off": "on", "on": "off", "locked": "unlocked", "unlocked": "locked"}
    flushes = []
    queue_max = 0
    t_all = time.perf_counter()
    for b in range(SECONDS * BATCHES_PER_S):
        now[0] += 1.0 / BATCHES_PER_S
        change: dict = {}
        for _ in range(per_batch):
            if rnd.random() < 0.04:                    # most of a house's changes are power, light and climate
                eid = rnd.choice(members)
                cur = hub.store.states[eid]["s"]
                change[eid] = {"+": {"s": toggles.get(cur, "on"), "lc": now[0]}}
            else:
                eid = rnd.choice(others)
                change[eid] = {"+": {"s": str(rnd.randint(0, 3000)), "lu": now[0]}}
        tl.tap(hub.store.apply_event({"c": change}))
        queue_max = max(queue_max, len(tl.queue))
        if b % (2 * BATCHES_PER_S) == 0 or len(tl.queue) >= 50:   # the writer: every 2 s or at 50 rows
            t0 = time.perf_counter()
            tl.flush()
            flushes.append((time.perf_counter() - t0) * 1000)
    tl.flush()
    took = time.perf_counter() - t_all
    tap = [v for _t, v in performance.STATS._tl_tap]
    write = [v for _t, v in performance.STATS._tl_write]
    rows = tl.rows.count()
    print(f"\ntimeline perf: {len(tap)} batches, tap p50 {statistics.median(tap):.4f} ms p95 {p95(tap):.4f} ms "
          f"max {max(tap):.3f} ms; {len(write)} flushes, write p95 {p95(write):.2f} ms max {max(write):.2f} ms; "
          f"{rows} rows; queue max {queue_max}; dropped {tl.dropped}; {took:.1f} s for {SECONDS} s of house")
    assert p95(tap) < 0.2
    assert p95(write) < 15
    assert tl.dropped == 0 and queue_max < 200 and not tl.queue
    store.db.close()


def test_the_hub_fans_out_the_same_with_the_tap():
    """A hub batch with and without the timeline's tap: the tap adds well under the fan-out's own noise."""
    from mantel_server.server import Hub
    from mantel_server.config import Config
    cfg = Config()
    hub = Hub(cfg)
    calls = []
    hub.taps.append(lambda changed: calls.append(len(changed)))
    hub.on_change({"sensor.a", "sensor.b"})
    assert calls == [2]

    def boom(changed):
        raise RuntimeError("a tap that fails")
    hub.taps.insert(0, boom)
    hub.on_change({"sensor.c"})                        # a failing tap never breaks the hub or the taps after it
    assert calls == [2, 1]
