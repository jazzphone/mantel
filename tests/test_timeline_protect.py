"""UniFi Protect's events in the House Timeline (timeline/protect.py, ProtectConnector.listeners and speaks_for):
a ring is one doorbell row, a smart detection one row from its start to its end, packages within half an hour one
row with a count, motion only where a camera has no smart detection (then in bursts), a repeat never doubles a row,
and when Protect speaks for a camera Home Assistant's own detection entity of it is not a second row. The recorded
events (tests/fixtures/protect) are replayed through the tap. Fictional cameras and a fake clock."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from mantel_server.cameras import protect_api as pa
from mantel_server.cameras import protect_connector as PC
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore
from mantel_server.storage.store import Store
from mantel_server.timeline import protect as TP
from mantel_server.timeline.core import Timeline
from mantel_server.timeline.protect import ProtectTap

FIXTURES = Path(__file__).parent / "fixtures" / "protect"
T0 = 1_800_000_000.0
MS = 1000
FRONT = "cam-front"
GARDEN = "cam-garden"
AREAS = [{"area_id": "porch", "name": "Porch"}, {"area_id": "garden", "name": "Garden"}]


def camera(cid, name, smart=("person", "vehicle", "animal", "package"), doorbell=False):
    return pa.Camera(id=cid, name=name, model="UVC G4 Doorbell Pro" if doorbell else "UVC G5 Flex", state="CONNECTED",
                     mac="AABBCC000001", has_speaker=doorbell, has_mic=True, smart_types=tuple(smart),
                     smart_on=tuple(smart), is_doorbell=doorbell)


def source(cid, slug, name, area):
    return SimpleNamespace(slug=slug, name=name, area_id=area, protect_id=cid, entity_id=f"camera.mantel_{slug}")


class FakeConn:
    """What ProtectTap asks of the connector: the picked cameras, their matches with Home Assistant's, the list."""

    def __init__(self, cams, sources):
        self.cameras = {c.id: c for c in cams}
        self._sources = {s.protect_id: s for s in sources}
        self.matches: dict = {}
        self.cams = SimpleNamespace(matched=set())
        self.local = SimpleNamespace(mine={})
        self.listeners: list = []

    def picked(self):
        return self._sources


class Env:
    def __init__(self, tmp_path, cams=None, sources=None):
        self.now = [T0]
        self.store = Store(tmp_path / "m.db")
        self.db = self.store.db
        self.hub = SimpleNamespace(store=StateStore(), registry=Registry(), taps=[], ha=None)
        self.hub.registry.areas = {a["area_id"]: a["name"] for a in AREAS}
        self.app: dict = {"cfg": None}
        self.tl = Timeline(self.app, self.hub, self.db, clock=lambda: self.now[0], folder=tmp_path / "timeline")
        cams = cams or [camera(FRONT, "Front Door", doorbell=True), camera(GARDEN, "Garden Cam", smart=())]
        sources = sources or [source(FRONT, "front_door", "Front Door", "porch"),
                              source(GARDEN, "garden_cam", "Garden Cam", "garden")]
        self.conn = FakeConn(cams, sources)
        self.tap = ProtectTap(self.tl, self.conn)
        self.wanted: list = []
        self.app["timeline_pictures"] = SimpleNamespace(want=lambda *a, **k: self.wanted.append((a, k)))

    def ev(self, kind, cid, eid, at, end=None, active=True):
        return pa.ProtectEvent(kind, cid, eid, int(at * MS), None if end is None else int(end * MS), active)

    def send(self, *events):
        for e in events:
            self.tap.on_event(e)

    def rows(self):
        self.tl.flush()
        return [dict(r) for r in self.db.execute("SELECT * FROM timeline_events ORDER BY id")]


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    yield e
    e.db.close()


def detail(row):
    return json.loads(row["detail"])


# -- rings and detections ----------------------------------------------------------------------------------------------
def test_a_ring_is_one_doorbell_row_with_its_event_id_in_its_src(env):
    env.send(env.ev("ring", FRONT, "evt-1", T0, T0 + 10))
    (r,) = env.rows()
    assert r["src"] == "pt:evt-1:ring" and r["family"] == "doorbell" and r["kind"] == "ring"
    assert r["title"] == "Someone rang Front Door" and r["entity"] == "camera.mantel_front_door" and r["area"] == "porch"
    assert r["at"] == T0 and r["ended"] is None and detail(r)["source"] == "protect" and r["level"] == "info"
    assert "porch" in r["search"] and "rang" in r["search"]
    # its filmstrip is asked for, for the camera of the row
    assert env.wanted == [(("pt:evt-1:ring", "camera.mantel_front_door", "doorbell"), {"active": False})]


def test_the_same_event_again_is_not_a_second_row(env):
    ring = env.ev("ring", FRONT, "evt-1", T0, T0 + 10)
    env.send(ring, ring)
    env.rows()
    env.send(ring)                                                     # a reconnect sends it again, later
    assert len(env.rows()) == 1


def test_a_person_detection_start_then_end_is_one_row_with_its_end(env):
    env.send(env.ev("person", FRONT, "evt-2", T0))
    assert env.rows()[0]["ended"] is None
    env.send(env.ev("person", FRONT, "evt-2", T0, T0 + 42, active=False))
    (r,) = env.rows()
    assert r["src"] == "pt:evt-2:person" and r["title"] == "Person at Front Door" and r["family"] == "detection"
    assert r["ended"] == T0 + 42 and r["kind"] == "person"
    assert env.wanted[0][1] == {"active": True}                         # a detection's second frame waits for its end
    # the start again (a reconnect) neither doubles it nor takes its end away
    env.send(env.ev("person", FRONT, "evt-2", T0))
    assert len(env.rows()) == 1 and env.rows()[0]["ended"] == T0 + 42


def test_a_start_and_an_end_in_one_flush_are_still_one_row(env):
    env.send(env.ev("vehicle", FRONT, "evt-3", T0), env.ev("vehicle", FRONT, "evt-3", T0, T0 + 5, active=False))
    (r,) = env.rows()
    assert r["kind"] == "vehicle" and r["ended"] == T0 + 5 and r["title"] == "Vehicle at Front Door"


def test_one_event_that_is_two_kinds_is_a_row_for_each_kind_it_records(env):
    env.send(env.ev("person", FRONT, "evt-4", T0), env.ev("face", FRONT, "evt-4", T0), env.ev("animal", FRONT, "evt-4", T0))
    assert sorted(r["src"] for r in env.rows()) == ["pt:evt-4:animal", "pt:evt-4:person"]       # a face is no row


def test_an_ending_with_no_start_makes_no_row(env):
    env.send(env.ev("person", FRONT, "evt-5", T0, T0 + 3, active=False))
    assert env.rows() == []


def test_a_detection_that_never_ends_is_forgotten_after_a_while(env, monkeypatch):
    env.send(env.ev("person", FRONT, "evt-6", T0))
    assert env.tap.is_open("pt:evt-6:person")
    clock = {"t": 0.0}
    monkeypatch.setattr(TP.time, "monotonic", lambda: clock["t"])
    for key in list(env.tap.open):
        env.tap.open[key] = (env.tap.open[key][0], 0.0)
    clock["t"] = 1000.0
    env.tap._lapse()
    assert not env.tap.is_open("pt:evt-6:person") and len(env.rows()) == 1


def test_a_family_the_owner_turned_off_is_not_recorded(env):
    env.tl.settings.set("families", {"doorbell": False})
    env.send(env.ev("ring", FRONT, "evt-1", T0, T0 + 1), env.ev("person", FRONT, "evt-2", T0))
    assert [r["family"] for r in env.rows()] == ["detection"]


def test_an_event_of_a_camera_that_is_not_picked_is_ignored(env):
    env.send(env.ev("ring", "someone-elses-camera", "evt-1", T0, T0 + 1))
    assert env.rows() == [] and env.tap.events == 0


def test_a_camera_home_assistant_has_too_is_the_row_of_its_entity(env):
    """A matched camera's row is that camera's (its RBAC, its picture): Home Assistant's entity, its name, its area."""
    env.conn.matches[FRONT] = SimpleNamespace(camera="camera.front_door_high", device_id="d1", speaker=None, kinds={})
    env.conn.cams.matched = {"front_door"}
    env.hub.store.replace_all({"a": {"camera.front_door_high": {
        "s": "idle", "a": {"friendly_name": "Front Door Cam"}, "lc": 1.0, "lu": 1.0}}})
    env.hub.registry.entity_area = {"camera.front_door_high": "garden"}
    env.send(env.ev("ring", FRONT, "evt-1", T0, T0 + 1))
    (r,) = env.rows()
    assert r["entity"] == "camera.front_door_high" and r["title"] == "Someone rang Front Door Cam" and r["area"] == "garden"
    assert env.wanted[0][0][1] == "camera.front_door_high"


# -- packages ----------------------------------------------------------------------------------------------------------
def test_packages_within_half_an_hour_are_one_row_with_a_count(env):
    env.send(env.ev("package", FRONT, "pk-1", T0))
    env.send(env.ev("package", FRONT, "pk-2", T0 + 600))
    (r,) = env.rows()
    assert r["src"] == "pt:pk-1:package" and detail(r)["count"] == 2 and detail(r)["last"] == T0 + 600
    assert r["title"] == "Package at Front Door" and r["at"] == T0
    env.send(env.ev("package", FRONT, "pk-3", T0 + 600 + 29 * 60))        # 29 minutes after the last: still it
    assert len(env.rows()) == 1 and detail(env.rows()[0])["count"] == 3
    env.send(env.ev("package", FRONT, "pk-4", T0 + 600 + 29 * 60 + 31 * 60))     # 31 minutes after: a new delivery
    rows = env.rows()
    assert [r["src"] for r in rows] == ["pt:pk-1:package", "pt:pk-4:package"]
    assert detail(rows[1]).get("count") is None


def test_packages_on_two_cameras_are_two_rows(env):
    env.conn.cameras["cam-side"] = camera("cam-side", "Side Door")
    env.conn._sources["cam-side"] = source("cam-side", "side_door", "Side Door", "porch")
    env.send(env.ev("package", FRONT, "pk-1", T0), env.ev("package", "cam-side", "pk-2", T0 + 5))
    assert len(env.rows()) == 2


# -- motion ------------------------------------------------------------------------------------------------------------
def test_motion_on_a_smart_camera_is_no_row(env):
    env.send(env.ev("motion", FRONT, "m-1", T0), env.ev("motion", FRONT, "m-1", T0, T0 + 9, active=False))
    assert env.rows() == []


def test_motion_on_a_motion_only_camera_is_one_burst_row_with_a_count(env):
    env.send(env.ev("motion", GARDEN, "m-1", T0), env.ev("motion", GARDEN, "m-1", T0, T0 + 9, active=False))
    env.send(env.ev("motion", GARDEN, "m-2", T0 + 60), env.ev("motion", GARDEN, "m-3", T0 + 120))
    (r,) = env.rows()
    assert r["src"] == "pt:m-1:motion" and r["family"] == "motion" and r["title"] == "Motion at Garden Cam"
    assert detail(r)["count"] == 3 and r["ended"] == T0 + 120 and r["entity"] == "camera.mantel_garden_cam"
    assert r["area"] == "garden"
    # ten minutes on, another burst; no picture is asked for
    env.send(env.ev("motion", GARDEN, "m-4", T0 + 700))
    assert [x["src"] for x in env.rows()] == ["pt:m-1:motion", "pt:m-4:motion"] and env.wanted == []


def test_motion_is_the_first_a_full_queue_drops(env, monkeypatch):
    from mantel_server.timeline import core as T
    monkeypatch.setattr(T, "QUEUE_MAX", 2)
    env.send(env.ev("motion", GARDEN, "m-1", T0))
    env.send(env.ev("ring", FRONT, "r-1", T0, T0 + 1), env.ev("ring", FRONT, "r-2", T0 + 5, T0 + 6))
    assert env.tl.dropped == 1 and [r["src"] for r in env.rows()] == ["pt:r-1:ring", "pt:r-2:ring"]


# -- the connector and Home Assistant's own sensors --------------------------------------------------------------------
def connector(takes, connected=True, video_from="direct"):
    conn = object.__new__(PC.ProtectConnector)
    conn._takes = takes
    conn.stream = SimpleNamespace(connected=connected)
    conn.settings = lambda: {"p1": {"video_from": video_from}, "p2": {"video_from": video_from}}
    conn.listeners = []
    return conn


HA_OWN = "binary_sensor.front_door_person_detected"        # Home Assistant's own sensor of a matched camera
MANTELS = "binary_sensor.mantel_front_door_person"         # Mantel's own detection entity
NO_CAM = "binary_sensor.shed_person_detected"              # a sensor of a camera whose Home Assistant camera is off
TAKES = {HA_OWN: ("p1", "person", False), MANTELS: ("p1", "person", True), NO_CAM: ("p2", "person", None)}


def test_speaks_for_follows_the_sources_that_are_up_and_not_notify_for():
    conn = connector(TAKES)
    assert conn.speaks_for(HA_OWN) and conn.speaks_for(MANTELS) and conn.speaks_for(NO_CAM)
    assert conn.speaks_for("binary_sensor.other") is False and conn.speaks_for("") is False
    # the events socket is down: Home Assistant's own sensors are the record again; Mantel's own stays (it is the tap's)
    down = connector(TAKES, connected=False)
    assert down.speaks_for(HA_OWN) is False and down.speaks_for(NO_CAM) is False and down.speaks_for(MANTELS) is True
    # Video From Home Assistant: its sensors aren't replaced
    ha = connector(TAKES, video_from="ha")
    assert ha.speaks_for(HA_OWN) is False and ha.speaks_for(NO_CAM) is True
    # it doesn't depend on what is notified (takes() does), and a connector with no stream says no
    conn.available = lambda pid: ()
    conn.notify_for = lambda pid: ()
    assert conn.speaks_for(HA_OWN) is True and conn.takes(HA_OWN) is False
    none = connector(TAKES)
    none.stream = None
    assert none.speaks_for(HA_OWN) is False and none.speaks_for(NO_CAM) is False


def test_the_connector_calls_every_listener_of_a_picked_cameras_event_and_one_failing_changes_nothing(caplog):
    seen = []
    conn = object.__new__(PC.ProtectConnector)
    conn.listeners = [lambda ev: seen.append(ev.kind), lambda ev: 1 / 0, lambda ev: seen.append("after")]
    conn.picked = lambda: {FRONT: SimpleNamespace(slug="front_door", entity_id="camera.mantel_front_door")}
    conn.events_log = __import__("collections").deque(maxlen=10)
    conn.clock = lambda: T0
    conn.matches = {}
    conn.cams = SimpleNamespace(matched=set())
    # what follows the listeners is the notification path, which needs a whole connector: they have run by then
    try:
        conn.on_event(pa.ProtectEvent("ring", FRONT, "e", int(T0 * MS), int(T0 * MS) + 10, True))
    except Exception:  # noqa: BLE001
        pass
    assert seen == ["ring", "after"]
    assert any("event listener failed" in r.getMessage() for r in caplog.records)
    # a kind that is no notification kind ("face") is no row either: the connector never hears it
    seen.clear()
    conn.on_event(pa.ProtectEvent("face", FRONT, "e", int(T0 * MS), None, True))
    assert seen == []


STATES = {
    "binary_sensor.front_door_person_detected": "off", "camera.front_door_high": "idle",
}


def state_env(tmp_path, conn):
    """The state path too: Home Assistant's own person sensor of the front door, for the one-detection-one-row rule."""
    e = Env(tmp_path)
    e.hub.registry.load(AREAS, [{"id": "dev-front", "name": "Front Door", "area_id": "porch"}],
                        [{"entity_id": "camera.front_door_high", "device_id": "dev-front"},
                         {"entity_id": HA_OWN, "device_id": "dev-front", "original_device_class": "occupancy"}])
    e.tl.speaks_for = conn.speaks_for
    states = {k: {"s": s, "a": {"friendly_name": "Front Door " + k.split(".")[1]}, "lc": T0 - 3600, "lu": T0 - 3600}
              for k, s in STATES.items()}
    e.tl.tap(e.hub.store.replace_all({"a": states}))
    return e


def flip(e, eid, s, at):
    e.tl.tap(e.hub.store.apply_event({"c": {eid: {"+": {"s": s, "lc": at}}}}))


def test_one_detection_is_one_row_never_two_when_protect_speaks_for_the_camera(tmp_path):
    conn = connector(TAKES)
    e = state_env(tmp_path, conn)
    try:
        assert HA_OWN in e.tl.members and e.tl.members[HA_OWN].family == "detection"
        e.conn.cameras = {}                                            # (the tap's own camera list isn't needed here)
        e.send(e.ev("person", FRONT, "evt-1", T0))                      # Protect's event ...
        flip(e, HA_OWN, "on", T0 + 1)                                   # ... and Home Assistant's sensor of the same camera
        flip(e, HA_OWN, "off", T0 + 30)
        e.send(e.ev("person", FRONT, "evt-1", T0, T0 + 29, active=False))
        rows = e.rows()
        assert [r["src"] for r in rows] == ["pt:evt-1:person"] and rows[0]["ended"] == T0 + 29
    finally:
        e.db.close()


def test_when_the_events_socket_is_down_home_assistants_own_sensor_is_the_record(tmp_path):
    conn = connector(TAKES, connected=False)
    e = state_env(tmp_path, conn)
    try:
        flip(e, HA_OWN, "on", T0 + 1)
        flip(e, HA_OWN, "off", T0 + 30)
        (r,) = e.rows()
        assert r["src"].startswith("ha:binary_sensor.front_door_person_detected:") and r["kind"] == "person"
        assert r["entity"] == "camera.front_door_high" and r["ended"] == T0 + 30
    finally:
        e.db.close()


def test_mantels_own_detection_entities_are_never_members(tmp_path):
    e = Env(tmp_path)
    try:
        e.hub.registry.load(AREAS, [], [{"entity_id": MANTELS}, {"entity_id": HA_OWN, "original_device_class": "occupancy"}])
        e.tl.mine = lambda: [MANTELS]
        e.tl.tap(e.hub.store.replace_all({"a": {MANTELS: {"s": "off", "a": {}, "lc": 1.0, "lu": 1.0},
                                                HA_OWN: {"s": "off", "a": {}, "lc": 1.0, "lu": 1.0}}}))
        assert MANTELS not in e.tl.members and HA_OWN in e.tl.members
    finally:
        e.db.close()


def test_registering_wires_the_connector_and_the_catalog(tmp_path):
    e = Env(tmp_path)
    try:
        assert TP.register({}, e.tl) is None                            # no Protect: nothing to wire
        conn = connector(TAKES)
        conn.local = SimpleNamespace(mine={MANTELS: object()})
        app = {"protect": conn}
        tap = TP.register(app, e.tl)
        assert app["timeline_protect"] is tap and conn.listeners == [tap.on_event]
        assert e.tl.speaks_for == conn.speaks_for and e.tl.mine() == [MANTELS]
        assert TP.register({"protect": SimpleNamespace()}, e.tl) is None          # a connector with no listeners
    finally:
        e.db.close()


# -- the recorded events -----------------------------------------------------------------------------------------------
def recorded(name):
    return [json.dumps(json.loads(line)["msg"]) for line in (FIXTURES / name).read_text().splitlines() if line.strip()]


def replay(name):
    stream = pa.EventStream(None)
    return [e for line in recorded(name) for e in stream._ingest(line)]


@pytest.fixture
def house(tmp_path):
    """Every recorded camera, picked (the console's own list, sanitized)."""
    cams = [pa.Camera.from_api(d) for d in json.loads((FIXTURES / "v1_cameras.json").read_text())]
    sources = [source(c.id, c.name.lower().replace(" ", "_"), c.name, None) for c in cams]
    e = Env(tmp_path, cams, sources)
    yield e
    e.db.close()


@pytest.mark.parametrize("name", ["events.jsonl", "events2.jsonl"])
def test_every_recorded_ring_and_smart_detection_is_exactly_one_row(house, name):
    events = replay(name)
    assert events
    house.send(*events)
    rows = house.rows()
    recorded_kinds = {"ring", "person", "vehicle", "animal", "package"}
    want = {f"pt:{e.event_id}:{e.kind}" for e in events if e.kind in recorded_kinds and e.active}
    got = [r["src"] for r in rows]
    assert sorted(got) == sorted(want) and len(got) == len(set(got))
    assert not [r for r in rows if r["family"] == "motion"]            # every recorded camera has smart detection
    cams = {c.id: c for c in house.conn.cameras.values()}
    assert all(r["entity"] == f"camera.mantel_{cams[next(e.camera_id for e in events if f'pt:{e.event_id}:{e.kind}' == r['src'])].name.lower().replace(' ', '_')}"
               for r in rows)
    # the ends that arrived are on their rows
    ends = {f"pt:{e.event_id}:{e.kind}": e.end / MS for e in events if e.kind in recorded_kinds and not e.active
            and e.end is not None}
    by_src = {r["src"]: r for r in rows}
    for src, end in ends.items():
        if src in by_src and by_src[src]["family"] == "detection":
            assert by_src[src]["ended"] == end, src
    # a reconnect plays it all again: still one row each
    house.send(*events)
    assert sorted(r["src"] for r in house.rows()) == sorted(want)


def test_the_recorded_front_door_visit_is_a_person_a_ring_and_nothing_else(house):
    events = replay("events.jsonl")
    cams = {c.name: c.id for c in house.conn.cameras.values()}
    house.send(*[e for e in events if e.camera_id == cams["Front Door"]])
    rows = house.rows()
    assert sorted((r["family"], r["kind"]) for r in rows) == [("detection", "person"), ("doorbell", "ring")]
    person = next(r for r in rows if r["kind"] == "person")
    assert person["title"] == "Person at Front Door" and person["ended"] == 1793624203.406 and person["at"] == 1793624182.006
    ring = next(r for r in rows if r["kind"] == "ring")
    assert ring["title"] == "Someone rang Front Door" and ring["at"] == 1793624193.885
