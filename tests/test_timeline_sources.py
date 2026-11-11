"""The House Timeline's write path (docs/phase19/HOUSE-TIMELINE.md "The write path"), on a fake clock and a fake hub:
a change becomes a row at Home Assistant's ``lc``; attribute-only changes and ``unavailable`` don't; the rollups;
catching up after a gap; who did it from the audit; Refused and System rows; the queue's limits."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore
from mantel_server.storage.store import Store
from mantel_server.timeline import core as T
from mantel_server.timeline.core import Timeline

T0 = 1_800_000_000.0

AREAS = [{"area_id": "hall", "name": "Hallway"}, {"area_id": "drive", "name": "Driveway"},
         {"area_id": "garden", "name": "Garden"}]
DEVICES = [{"id": "cam1", "name": "Driveway Cam", "area_id": "drive"},
           {"id": "cam2", "name": "Garden Cam", "area_id": "garden"}]
ENTITIES = [
    {"entity_id": "lock.back_door", "area_id": "hall"},
    {"entity_id": "binary_sensor.back_door", "area_id": "hall", "original_device_class": "door"},
    {"entity_id": "binary_sensor.loft_window", "area_id": "hall", "original_device_class": "window"},
    {"entity_id": "cover.garage", "area_id": "drive", "original_device_class": "garage"},
    {"entity_id": "alarm_control_panel.house", "area_id": "hall"},
    {"entity_id": "person.emma"},
    {"entity_id": "camera.driveway", "device_id": "cam1"},
    {"entity_id": "binary_sensor.driveway_person_detected", "device_id": "cam1", "original_device_class": "occupancy"},
    {"entity_id": "binary_sensor.driveway_package_detected", "device_id": "cam1", "original_device_class": "occupancy"},
    {"entity_id": "binary_sensor.driveway_motion", "device_id": "cam1", "original_device_class": "motion"},
    {"entity_id": "camera.garden", "device_id": "cam2"},
    {"entity_id": "binary_sensor.garden_motion", "device_id": "cam2", "original_device_class": "motion"},
    {"entity_id": "binary_sensor.kitchen_leak", "area_id": "hall", "original_device_class": "moisture"},
    {"entity_id": "sensor.temperature", "area_id": "hall"},
    {"entity_id": "binary_sensor.diag", "area_id": "hall", "original_device_class": "door",
     "entity_category": "diagnostic"},
]
NAMES = {"lock.back_door": "Back Door", "binary_sensor.back_door": "Back Door", "cover.garage": "Garage",
         "alarm_control_panel.house": "Alarm", "person.emma": "Emma", "binary_sensor.loft_window": "Loft Window",
         "binary_sensor.kitchen_leak": "Kitchen Sink", "camera.driveway": "Driveway Cam",
         "camera.garden": "Garden Cam", "binary_sensor.driveway_person_detected": "Driveway Cam Person detected",
         "binary_sensor.driveway_package_detected": "Driveway Cam Package detected",
         "binary_sensor.garden_motion": "Garden Cam Motion", "sensor.temperature": "Temperature", "binary_sensor.diag": "Diag Door"}
FIRST = {"lock.back_door": "locked", "binary_sensor.back_door": "off", "binary_sensor.loft_window": "off",
         "cover.garage": "closed", "alarm_control_panel.house": "disarmed", "person.emma": "home",
         "camera.driveway": "idle", "binary_sensor.driveway_person_detected": "off",
         "binary_sensor.driveway_package_detected": "off", "binary_sensor.driveway_motion": "off",
         "camera.garden": "idle", "binary_sensor.garden_motion": "off", "binary_sensor.kitchen_leak": "off",
         "sensor.temperature": "20", "binary_sensor.diag": "off"}


class Env:
    def __init__(self, tmp_path):
        self.now = [T0]
        self.store = Store(tmp_path / "m.db")
        self.db = self.store.db
        self.hub = SimpleNamespace(store=StateStore(), registry=Registry(), taps=[], ha=None)
        self.hub.registry.load(AREAS, DEVICES, ENTITIES)
        self.app = {"cfg": None}
        self.tl = Timeline(self.app, self.hub, self.db, clock=lambda: self.now[0], folder=tmp_path / "timeline")

    def first(self, states=FIRST, lc=T0 - 3600):
        ev = {"a": {eid: {"s": s, "a": {"friendly_name": NAMES.get(eid, eid)}, "lc": lc} for eid, s in states.items()}}
        self.tl.tap(self.hub.store.replace_all(ev))

    def set(self, eid, s, at=None, attrs=None):
        at = self.now[0] if at is None else at
        change = {"+": {"s": s, "lc": at}}
        if attrs:
            change["+"]["a"] = attrs
        self.tl.tap(self.hub.store.apply_event({"c": {eid: change}}))

    def attrs(self, eid, attrs):
        self.tl.tap(self.hub.store.apply_event({"c": {eid: {"+": {"a": attrs, "lu": self.now[0]}}}}))

    def rows(self):
        self.tl.flush()
        return [dict(r) for r in self.db.execute("SELECT * FROM timeline_events ORDER BY id")]


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.db.close()


def test_the_catalog_picks_what_matters(env):
    env.first()
    m = env.tl.members
    assert m["lock.back_door"].family == "lock" and m["cover.garage"].family == "garage"
    assert m["binary_sensor.driveway_person_detected"].family == "detection"
    assert m["binary_sensor.driveway_person_detected"].camera == "camera.driveway"
    # the garden camera has no smart detection: its motion is recorded; the driveway's isn't
    assert m["binary_sensor.garden_motion"].family == "motion" and "binary_sensor.driveway_motion" not in m
    for eid in ("binary_sensor.loft_window", "sensor.temperature", "binary_sensor.diag", "camera.driveway"):
        assert eid not in m


def test_a_change_is_a_row_at_its_own_time_and_the_first_states_are_not(env):
    env.first()
    assert env.rows() == []                        # no history invented (decision 15)
    env.now[0] += 10
    env.set("lock.back_door", "unlocked", at=env.now[0] - 1)
    env.attrs("lock.back_door", {"battery": 80})   # attributes only
    env.set("lock.back_door", "unavailable")       # gone is no row ...
    env.set("lock.back_door", "unlocked")          # ... and back to the same state is none either
    rows = env.rows()
    assert len(rows) == 1
    r = rows[0]
    assert r["title"] == "Back Door unlocked" and r["family"] == "lock" and r["kind"] == "unlocked"
    assert r["at"] == env.now[0] - 1 and r["area"] == "hall" and r["how"] == "hand_or_automation"
    assert "hallway" in r["search"] and "back" in r["search"]


def test_arrivals_people_and_privacy(env):
    env.db.execute("INSERT INTO users (id, username, name, role, kind, created, updated) VALUES ('u1','emma','Emma','adult','hk',0,0)")
    env.db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES ('ha1','u1',0)")
    env.db.commit()
    st = dict(FIRST)
    env.first(st)
    env.hub.store.states["person.emma"]["a"]["user_id"] = "ha1"
    env.tl.refresh()
    env.now[0] += 5
    env.set("person.emma", "not_home")
    rows = env.rows()
    assert rows[-1]["title"] == "Emma left home" and rows[-1]["person"] == "u1"
    assert "emma" not in rows[-1]["search"]
    # Keep My Arrivals Private: never written
    env.db.execute("INSERT INTO user_data (subject, key, value, updated) VALUES ('u:u1','timeline_private','true',0)")
    env.db.commit()
    env.set("person.emma", "home")
    assert len(env.rows()) == 1
    env.tl.prune()                                  # ... and the old one is deleted
    assert env.rows() == []


def test_a_removed_person_is_forgotten(env):
    env.db.execute("INSERT INTO users (id, username, name, role, kind, created, updated) VALUES ('u1','emma','Emma','adult','hk',0,0)")
    env.db.commit()
    env.first()
    env.tl.on_command({"id": 7, "timestamp": env.now[0], "actor": "u1", "actor_name": "Emma", "device": None,
                       "action": "lock.unlock", "targets": ["lock.back_door"], "decision": "allowed",
                       "door": "lan", "via": None, "result": None})
    env.set("lock.back_door", "unlocked", at=env.now[0] + 2)
    row = env.rows()[0]
    assert row["actor"] == "u1" and row["actor_name"] == "Emma" and row["how"] == "home" and row["audit_id"] == 7
    with env.db:
        env.db.execute("DELETE FROM users WHERE id = 'u1'")
    row = env.rows()[0]
    assert row["actor"] is None and row["actor_name"] == "A former member"


def test_who_did_it_matches_within_30_seconds_and_the_right_entity_only(env):
    env.first()
    cmd = {"id": 1, "timestamp": env.now[0], "actor": "u2", "actor_name": "Mark", "device": None,
           "action": "lock.unlock", "targets": ["lock.back_door"], "decision": "allowed", "door": "tunnel",
           "via": None, "result": None}
    env.tl.on_command(cmd)
    env.tl.on_command({**cmd, "id": 2, "action": "cover.open_cover", "targets": ["cover.garage"]})
    env.now[0] += 45
    env.set("lock.back_door", "unlocked")          # 45 s later: no match
    env.set("cover.garage", "open", at=env.now[0] - 40)
    rows = env.rows()
    assert rows[0]["how"] == "hand_or_automation" and rows[0]["actor"] is None
    assert rows[1]["actor"] == "u2" and rows[1]["how"] == "away"
    env.tl.on_command({**cmd, "id": 3, "action": "lock.lock", "via": "mcp:claude", "timestamp": env.now[0]})
    env.set("lock.back_door", "locked", at=env.now[0] + 1)
    assert env.rows()[-1]["how"] == "assistant"


def test_a_refused_command_is_a_refused_row(env):
    env.first()
    env.tl.on_command({"id": 9, "timestamp": env.now[0], "actor": None, "actor_name": None, "device": None,
                       "action": "alarm_control_panel.alarm_disarm", "targets": ["alarm_control_panel.house"],
                       "decision": "denied", "reason": "no_grant", "door": "lan", "via": None, "result": "not_sent"})
    env.tl.on_command({"id": 10, "timestamp": env.now[0], "action": "light.turn_on", "targets": ["light.x"],
                       "decision": "denied", "reason": "no_grant"})
    r = env.rows()
    assert len(r) == 1 and r[0]["family"] == "refused" and r[0]["title"] == "Tried to disarm Alarm; refused"
    assert r[0]["audit_id"] == 9 and r[0]["level"] == "warning"


def test_system_rows_from_the_alert_center(env):
    env.first()
    item = SimpleNamespace(log_id=3, kind="ha.lost", key="", level="critical", up=True,
                           title="Home Assistant disconnected", at=env.now[0])
    env.tl.on_alert(item)
    env.tl.on_alert(item)                             # the same log row once
    r = env.rows()
    assert len(r) == 1 and r[0]["family"] == "system" and r[0]["level"] == "warning"


def test_detections_end_motion_bursts_and_packages_roll_up(env):
    env.first()
    pd = "binary_sensor.driveway_person_detected"
    env.set(pd, "on")
    env.now[0] += 20
    env.set(pd, "off")
    r = env.rows()
    assert len(r) == 1 and r[0]["title"] == "Person at Driveway Cam" and r[0]["ended"] == env.now[0]
    assert r[0]["entity"] == "camera.driveway"
    # motion on the garden camera: one row per 10 minutes, with a count
    for i in range(5):
        env.now[0] += 30
        env.set("binary_sensor.garden_motion", "on")
        env.now[0] += 5
        env.set("binary_sensor.garden_motion", "off")
    motion = [x for x in env.rows() if x["family"] == "motion"]
    assert len(motion) == 1 and '"count":5' in motion[0]["detail"]
    env.now[0] += 700
    env.set("binary_sensor.garden_motion", "on")
    assert len([x for x in env.rows() if x["family"] == "motion"]) == 2
    # packages within 30 minutes are one row
    pk = "binary_sensor.driveway_package_detected"
    env.set(pk, "on")
    env.now[0] += 60
    env.set(pk, "off")
    env.now[0] += 600
    env.set(pk, "on")
    pkgs = [x for x in env.rows() if x["kind"] == "package"]
    assert len(pkgs) == 1 and '"count":2' in pkgs[0]["detail"]


def test_a_flapping_sensor_becomes_one_row(env):
    env.first()
    for i in range(12):
        env.now[0] += 10
        env.set("binary_sensor.back_door", "on" if i % 2 == 0 else "off")
    rows = env.rows()
    plain = [r for r in rows if r["kind"] != "flapping"]
    flap = [r for r in rows if r["kind"] == "flapping"]
    assert len(plain) == 6 and len(flap) == 1
    assert flap[0]["title"].startswith("Back Door keeps changing") and '"count":12' in flap[0]["detail"]


def test_catching_up_after_a_gap_is_late_and_never_repeats(env, tmp_path):
    env.first()
    env.now[0] += 10
    env.set("lock.back_door", "unlocked")
    env.tl.save_seen()
    env.rows()
    # Mantel stops; the lock is locked while it's off; Mantel starts again
    tl2 = Timeline(env.app, env.hub, env.db, clock=lambda: env.now[0], folder=tmp_path / "timeline")
    env.tl = tl2
    env.now[0] += 3600
    states = {**FIRST, "lock.back_door": "locked"}
    env.first(states, lc=env.now[0] - 1800)
    rows = env.rows()
    assert [r["title"] for r in rows] == ["Back Door unlocked", "Back Door locked"]
    assert '"late":true' in rows[-1]["detail"] and rows[-1]["at"] == env.now[0] - 1800
    # a reconnect with the same states: nothing new (the src makes it idempotent)
    env.tl.last.clear()
    env.tl.load()
    env.first(states, lc=env.now[0] - 1800)
    assert len(env.rows()) == 2


def test_the_queue_drops_noise_first_and_counts(env, monkeypatch):
    monkeypatch.setattr(T, "QUEUE_MAX", 3)
    env.first()
    m = env.tl.members["lock.back_door"]
    noise = env.tl.row("n1", "x", m, "locked", T0, "locked")
    env.tl.push(noise, noise=True)
    for i in range(3):
        env.tl.push(env.tl.row(f"r{i}", "x", m, "locked", T0 + i, "locked"))
    assert env.tl.dropped == 1 and [op[1].src for op in env.tl.queue] == ["r0", "r1", "r2"]
    env.tl.push(env.tl.row("r3", "x", m, "locked", T0 + 3, "locked"))
    assert env.tl.dropped == 2 and [op[1].src for op in env.tl.queue] == ["r1", "r2", "r3"]


def test_retention_prunes_rows_and_their_picture_files_first(env, tmp_path):
    env.first()
    env.set("lock.back_door", "unlocked", at=T0 - 40 * 86400)
    env.set("lock.back_door", "locked", at=T0 - 86400)
    rows = env.rows()
    old = rows[0]["id"]
    pic = tmp_path / "timeline" / "x.jpg"
    path = env.tl.pic_path("a" * 32, T0 - 40 * 86400)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpg")
    with env.db:
        env.db.execute("INSERT INTO timeline_pics (id, event, camera, at, size) VALUES (?,?,?,?,3)",
                       ("a" * 32, old, "camera.driveway", T0 - 40 * 86400))
    assert env.tl.prune() == 1
    assert not path.exists() and not pic.exists()
    assert env.db.execute("SELECT COUNT(*) FROM timeline_pics").fetchone()[0] == 0
    assert [r["title"] for r in env.rows()] == ["Back Door locked"]


def test_the_tap_is_cheap_for_changes_it_doesnt_record(env):
    env.first()
    for i in range(50):
        env.set("sensor.temperature", str(20 + i))
    assert env.rows() == [] and env.tl.status()["queued"] == 0
