"""MantelHouse (mantel_server/house.py): the House port over the hub's StateStore and Registry, fed the
shapes Home Assistant actually sends (subscribe_entities' compressed events, the registry list calls).
Fictional house only. hk_core's own behavioural suites run against it too
(tests/test_mantel_house_contract_*.py)."""
import asyncio
from datetime import datetime, timezone

import pytest

from hk_core.house import Device, Entity, Floor, State, area_of
from mantel_server.house import HouseCommandsDisabled, MantelHouse
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore

LC = 1_760_000_000.5
AREAS = [{"area_id": "kitchen", "name": "Kitchen", "floor_id": "ground"},
         {"area_id": "loft", "name": "Loft", "floor_id": None}, {"area_id": "nameless", "name": None}]
FLOORS = [{"floor_id": "ground", "name": "Ground Floor", "level": 0}]
DEVICES = [{"id": "dev1", "area_id": "kitchen", "name": "Plug", "name_by_user": "Coffee Plug"},
           {"id": "dev2", "area_id": None, "name": "Kiosk"}]
ENTITIES = [  # config/entity_registry/list's fields (no supported_features / device_class there)
    {"entity_id": "switch.coffee", "device_id": "dev1", "area_id": None, "platform": "tplink", "options": {},
     "disabled_by": None, "hidden_by": None, "entity_category": None},
    {"entity_id": "sensor.coffee_power", "device_id": "dev1", "area_id": None, "platform": "tplink",
     "options": {"sensor": {"display_precision": 1}}, "disabled_by": None, "hidden_by": None,
     "entity_category": "diagnostic"},
    {"entity_id": "sensor.coffee_off", "device_id": "dev1", "platform": "tplink", "disabled_by": "user"},
    {"entity_id": "vacuum.robot", "area_id": "loft", "platform": "roborock", "hidden_by": "user",
     "options": {"vacuum": {"area_mapping": {"loft": ["3"]}}}},
]


def make(tz="America/New_York", caller=None):
    store, reg = StateStore(), Registry()
    store.replace_all({"a": {
        "switch.coffee": {"s": "on", "a": {"friendly_name": "Coffee"}, "lc": LC},
        "sensor.coffee_power": {"s": "12.5", "a": {"unit_of_measurement": "W"}, "lc": LC, "lu": LC + 9},
        "light.no_registry": {"s": "off", "a": {}, "lc": LC},
    }})
    reg.load(AREAS, DEVICES, ENTITIES, FLOORS)
    now = datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)
    return store, reg, MantelHouse(store, reg, tz=tz, caller=caller, now=lambda: now)


def test_states_are_plain_copies_with_when_they_last_changed():
    store, _, h = make()
    s = h.state("switch.coffee")
    assert s == State("switch.coffee", "on", {"friendly_name": "Coffee"})
    assert s.last_changed == datetime.fromtimestamp(LC, timezone.utc) and s.last_changed.tzinfo is not None
    assert h.state("light.missing") is None
    assert sorted(x.entity_id for x in h.states("sensor")) == ["sensor.coffee_power"]
    assert len(h.states()) == 3
    s.attributes["friendly_name"] = "changed"            # a view never reaches the hub
    assert store.states["switch.coffee"]["a"]["friendly_name"] == "Coffee"
    store.apply_event({"c": {"switch.coffee": {"+": {"s": "off", "lc": LC + 60}}}})
    later = h.state("switch.coffee")
    assert later.state == "off" and (later.last_changed - s.last_changed).total_seconds() == 60
    store.apply_event({"c": {"switch.coffee": {"+": {"a": {"x": 1}, "lu": LC + 90}}}})
    assert h.state("switch.coffee").last_changed == later.last_changed, "an attribute change is not a state change"


def test_entities_from_the_registry_list():
    _, _, h = make()
    assert h.entity("switch.coffee") == Entity("switch.coffee", device_id="dev1", platform="tplink")
    p = h.entity("sensor.coffee_power")
    assert p.entity_category == "diagnostic" and p.options == {"sensor": {"display_precision": 1}}
    assert p.supported_features is None and p.device_class is None, "not in HA's list call"
    assert h.entity("sensor.coffee_off").disabled is True
    v = h.entity("vacuum.robot")
    assert v.hidden and v.area_id == "loft" and v.options["vacuum"]["area_mapping"] == {"loft": ["3"]}
    assert h.entity("light.no_registry") is None
    assert [e.entity_id for e in h.entities("vacuum")] == ["vacuum.robot"]
    assert len(h.entities()) == 4, "disabled ones too, as HaHouse"


def test_devices_areas_and_floors():
    store, reg, h = make()
    assert h.device("dev1") == Device("dev1", "kitchen", "Coffee Plug"), "the user's name first"
    assert h.device("dev2") == Device("dev2", None, "Kiosk") and h.device("nope") is None
    assert sorted(e.entity_id for e in h.device_entities("dev1")) == \
        ["sensor.coffee_off", "sensor.coffee_power", "switch.coffee"], "disabled ones too, `disabled` says"
    assert h.device_entities("dev2") == []
    assert h.area_ids() == {"kitchen", "loft", "nameless"}
    assert h.area_name("kitchen") == "Kitchen" and h.area_name("nameless") == "nameless" and h.area_name("x") is None
    assert h.area_floor("kitchen") == Floor("ground", "Ground Floor", 0)
    assert h.area_floor("loft") is None and h.area_floor("x") is None
    assert area_of(h, h.entity("switch.coffee")) == "kitchen", "an entity's device's area"
    # a reloaded registry is read at once (the index follows the replaced list)
    reg.update(devices=[{"id": "dev1", "area_id": "loft", "name": "Plug"}])
    assert h.device("dev1") == Device("dev1", "loft", "Plug")
    reg.update(entities=[])
    assert h.device_entities("dev1") == [] and h.entity("switch.coffee") is None


def test_local_time_is_the_houses():
    _, _, h = make()
    assert h.local_time().isoformat() == "2026-10-18T12:00:00-04:00", "now, in the house's zone"
    utc = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
    assert h.local_time(utc).isoformat() == "2026-01-01T07:00:00-05:00"
    assert h.local_time(datetime(2026, 1, 1, 7, 0)).isoformat() == "2026-01-01T07:00:00-05:00", \
        "a naive time is the house's"
    zone = ["UTC"]
    h2 = MantelHouse(StateStore(), Registry(), tz=lambda: zone[0])
    assert h2.local_time(utc).utcoffset().total_seconds() == 0
    zone[0] = "Europe/Paris"                              # HA's get_config arrived: read at every call
    assert h2.local_time(utc).isoformat() == "2026-01-01T13:00:00+01:00"
    zone[0] = "Not/AZone"
    assert h2.local_time(utc).utcoffset().total_seconds() == 0, "an unknown zone reads as UTC, never a crash"


async def test_service_calls_go_to_the_caller_or_are_refused():
    _, _, h = make()
    with pytest.raises(HouseCommandsDisabled) as e:
        await h.call_service("light", "turn_on", {"entity_id": "light.x"})
    assert e.value.code == "commands_disabled"
    seen = []

    async def caller(domain, service, data, context):
        seen.append((domain, service, data, context))
    h.caller = caller
    data = {"entity_id": "switch.coffee"}
    await h.call_service("switch", "turn_off", data, context="sleep:hall")
    assert seen == [("switch", "turn_off", {"entity_id": "switch.coffee"}, "sleep:hall")]
    assert seen[0][2] is not data, "the caller gets its own copy"


def test_it_satisfies_the_port():
    from hk_core import house as port
    names = [n for n in vars(port.House) if not n.startswith("_")]
    assert all(callable(getattr(MantelHouse, n, None)) for n in names)
    assert asyncio.iscoroutinefunction(MantelHouse.call_service)
