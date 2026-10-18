"""hk_core.clean_areas against a fake House: the rules run once here, for every host.

The HA build runs the same code through hosts/ha's HaHouse (tests/py/test_feature_clean_areas.py).
"""
import asyncio

from hk_core import clean_areas as ca
from hk_core.house import Device, Entity, State

MAPPED = ca.CLEAN_AREA


class FakeHouse:
    def __init__(self, states=(), entities=(), devices=(), areas=()):
        self._states = {s.entity_id: s for s in states}
        self._entities = {e.entity_id: e for e in entities}
        self._devices = {d.id: d for d in devices}
        self._areas = set(areas)
        self.calls = []
        self.fail = set()

    def state(self, entity_id):
        return self._states.get(entity_id)

    def states(self, domain):
        return [s for s in self._states.values() if s.domain == domain]

    def entity(self, entity_id):
        return self._entities.get(entity_id)

    def entities(self, domain=None):
        return [e for e in self._entities.values() if domain is None or e.domain == domain]

    def device(self, device_id):
        return self._devices.get(device_id)

    def area_ids(self):
        return set(self._areas)

    async def call_service(self, domain, service, data, *, context=None):
        if data.get("entity_id") in self.fail:
            raise RuntimeError("robot stuck")
        self.calls.append((domain, service, dict(data), context))


def house():
    return FakeHouse(
        states=[State("vacuum.roborock", "docked", {"supported_features": MAPPED}),
                State("vacuum.roomba", "docked", {"supported_features": 0}),
                State("vacuum.second", "docked", {"supported_features": MAPPED}),
                State("vacuum.gone", "unavailable", {})],
        entities=[Entity("vacuum.roborock", options={"vacuum": {"area_mapping": {"kitchen": ["16"], "den": ["17"]}}}),
                  Entity("vacuum.roomba", device_id="dev1"),
                  Entity("vacuum.second"),
                  Entity("vacuum.gone", supported_features=MAPPED,
                         options={"vacuum": {"area_mapping": {"office": ["3"]}}}),
                  Entity("vacuum.off", disabled=True)],
        devices=[Device("dev1", area_id="bedroom")],
        areas=["kitchen", "den", "bedroom", "office"])


def test_plan_maps_areas_to_robots():
    p = ca.plan(house(), ["kitchen", "bedroom", "garage", "kitchen"], None)
    assert p["plan"] == [{"vacuum": "vacuum.roborock", "action": "clean_area", "areas": ["kitchen"]},
                         {"vacuum": "vacuum.roomba", "action": "start", "areas": ["bedroom"]}]
    assert p["unreachable"] == ["garage"]


def test_only_the_chosen_vacuums_take_part():
    p = ca.plan(house(), ["kitchen", "bedroom"], {ca.CONF_VACUUMS: ["vacuum.roomba"]})
    assert [s["vacuum"] for s in p["plan"]] == ["vacuum.roomba"]
    assert p["unreachable"] == ["kitchen"]


def test_coverage_counts_an_offline_robot_by_its_map_and_skips_disabled():
    cov = {v["vacuum"]: v for v in ca.coverage(house(), None)}
    assert cov["vacuum.roborock"]["how"] == "map" and cov["vacuum.roborock"]["areas"] == ["kitchen", "den"]
    assert cov["vacuum.roomba"]["how"] == "start" and cov["vacuum.roomba"]["areas"] == ["bedroom"]
    assert cov["vacuum.second"]["how"] == "no_map"
    assert cov["vacuum.gone"]["how"] == "map" and cov["vacuum.gone"]["areas"] == ["office"]
    assert "vacuum.off" not in cov


def test_offered_follows_the_chosen_areas():
    h = house()
    assert ca.offered(h, None) == ["office", "kitchen", "den", "bedroom"]   # by vacuum id
    assert ca.offered(h, {ca.CONF_AREAS: ["den", "garage"]}) == ["den"]


def test_clean_calls_each_robot_once_in_the_callers_context():
    h = house()
    res = asyncio.run(ca.async_clean(h, ["kitchen", "den", "bedroom"], None, context="ctx"))
    assert res["ok"] is True
    assert h.calls == [("vacuum", "clean_area", {"entity_id": "vacuum.roborock", "cleaning_area_id": ["kitchen", "den"]}, "ctx"),
                       ("vacuum", "start", {"entity_id": "vacuum.roomba"}, "ctx")]


def test_dry_run_sends_nothing_and_a_failure_does_not_stop_the_rest():
    h = house()
    assert asyncio.run(ca.async_clean(h, ["kitchen"], None, dry_run=True))["dry_run"] is True
    assert h.calls == []
    h.fail.add("vacuum.roborock")
    res = asyncio.run(ca.async_clean(h, ["kitchen", "bedroom"], None))
    assert res["ok"] is False and res["failed"][0]["vacuum"] == "vacuum.roborock"
    assert [c[2]["entity_id"] for c in h.calls] == ["vacuum.roomba"]


def test_nothing_reachable_is_an_answer_not_a_call():
    h = house()
    res = asyncio.run(ca.async_clean(h, ["garage"], None))
    assert res["ok"] is False and "No vacuum" in res["message"] and h.calls == []
