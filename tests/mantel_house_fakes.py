"""The House port's contract on Mantel: run hk_core's own behavioural tests with MantelHouse underneath.

Each ``tests/test_hk_core_*.py`` builds its fictional house with a ``FakeHouse`` (port views kept in
``_states`` / ``_entities`` / ``_devices`` / ``_areas`` / ``_floors``). ``mantel_backed(FakeHouse)`` is a
subclass whose every read goes the way a real read goes on Mantel: the fake's data is written in
Home Assistant's WIRE shapes (a ``subscribe_entities`` event into a real ``StateStore``; the registry
list calls into a real ``Registry``) and read back through ``mantel_server.house.MantelHouse``. Service
calls pass through ``MantelHouse.call_service`` (its caller) to the fake's own recorder. So the same
expectations that pin HaHouse's semantics pin MantelHouse's.
"""
from __future__ import annotations

from datetime import datetime, timezone

from hk_core.house import Floor
from mantel_server.house import MantelHouse
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore


def state_wire(s) -> dict:
    out = {"s": s.state, "a": dict(s.attributes)}
    if s.last_changed is not None:
        out["lc"] = s.last_changed.timestamp()
    return out


def entity_wire(e) -> dict:
    """An entity registry entry as HA's list call has it; the three per-entity fields only when set
    (``config/entity_registry/get`` has them, the list does not)."""
    out = {"entity_id": e.entity_id, "area_id": e.area_id, "device_id": e.device_id, "options": dict(e.options or {}),
           "disabled_by": "user" if e.disabled else None, "hidden_by": "user" if e.hidden else None,
           "entity_category": e.entity_category, "platform": e.platform}
    for k in ("supported_features", "device_class", "original_device_class"):
        if getattr(e, k) is not None:
            out[k] = getattr(e, k)
    return out


def area_wire(fake) -> tuple[list[dict], list[dict]]:
    areas, floors = getattr(fake, "_areas", None) or {}, getattr(fake, "_floors", None) or {}
    out = []
    for aid in areas:
        v = areas[aid] if isinstance(areas, dict) else None
        if isinstance(v, tuple):
            out.append({"area_id": aid, "name": v[0], "floor_id": v[1]})
        else:
            out.append({"area_id": aid, "name": v})
    fl = [{"floor_id": f.id, "name": f.name, "level": f.level} for f in floors.values() if isinstance(f, Floor)]
    return out, fl


def mantel_house_of(fake, tz: str = "UTC", caller=None) -> MantelHouse:
    store, reg = StateStore(), Registry()
    store.apply_event({"a": {eid: state_wire(s) for eid, s in (getattr(fake, "_states", None) or {}).items()}})
    areas, floors = area_wire(fake)
    devices = [{"id": d.id, "area_id": d.area_id, "name": d.name} for d in (getattr(fake, "_devices", None) or {}).values()]
    reg.load(areas, devices, [entity_wire(e) for e in (getattr(fake, "_entities", None) or {}).values()], floors)

    def now() -> datetime:
        n = getattr(fake, "now", None)
        if isinstance(n, datetime):
            return n
        clock = getattr(fake, "clock", None)
        return clock() if callable(clock) else datetime.now(timezone.utc)
    return MantelHouse(store, reg, tz=tz, caller=caller, now=now)


def mantel_backed(Fake, tz: str | None = None):
    """``Fake`` with every House read (and ``local_time`` when ``tz`` is given) answered by MantelHouse."""

    class MantelBacked(Fake):
        def _mh(self) -> MantelHouse:
            async def via(domain, service, data, context):
                return await Fake.call_service(self, domain, service, data, context=context)
            return mantel_house_of(self, tz or "UTC", via)

        def state(self, entity_id):
            return self._mh().state(entity_id)

        def states(self, domain=None):
            return self._mh().states(domain)

        def entity(self, entity_id):
            return self._mh().entity(entity_id)

        def entities(self, domain=None):
            return self._mh().entities(domain)

        def device(self, device_id):
            return self._mh().device(device_id)

        def device_entities(self, device_id):
            return self._mh().device_entities(device_id)

        def area_ids(self):
            return self._mh().area_ids()

        def area_name(self, area_id):
            return self._mh().area_name(area_id)

        def area_floor(self, area_id):
            return self._mh().area_floor(area_id)

        async def call_service(self, domain, service, data, *, context=None):
            await self._mh().call_service(domain, service, data, context=context)

    if tz is not None:
        def local_time(self, when=None):
            return self._mh().local_time(when)
        MantelBacked.local_time = local_time
    MantelBacked.__name__ = f"MantelBacked{Fake.__name__}"
    return MantelBacked
