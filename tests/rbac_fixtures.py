"""Fictional house for the RBAC tests: floors, areas, devices, entities, people. No real data."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from mantel_server.rbac import Context, Subject
from mantel_server.registry import Registry
from mantel_server.state import StateStore

TZ = "America/Los_Angeles"
NOW = datetime(2026, 10, 14, 12, 0, tzinfo=ZoneInfo(TZ)).timestamp()  # a Wednesday, noon

FLOORS = [{"floor_id": "ground", "name": "Ground Floor"}, {"floor_id": "upstairs", "name": "Upstairs"}]
AREAS = [
    {"area_id": "kitchen", "name": "Kitchen", "floor_id": "ground"},
    {"area_id": "living_room", "name": "Living Room", "floor_id": "ground"},
    {"area_id": "garage", "name": "Garage", "floor_id": "ground"},
    {"area_id": "loft", "name": "Loft", "floor_id": "upstairs"},
    {"area_id": "cody_room", "name": "Cody's Room", "floor_id": "upstairs"},
    {"area_id": "guest_room", "name": "Guest Room", "floor_id": "upstairs"},
]
DEVICES = [
    {"id": "dev_front_lock", "area_id": "living_room"},
    {"id": "dev_loft_tv", "area_id": "loft"},
    {"id": "dev_phone", "area_id": None},
]
ENTITIES = [
    {"entity_id": "light.kitchen", "area_id": "kitchen"},
    {"entity_id": "light.loft", "area_id": "loft"},
    {"entity_id": "light.loft_lamp", "area_id": "loft"},
    {"entity_id": "light.cody", "area_id": "cody_room"},
    {"entity_id": "light.guest", "area_id": "guest_room"},
    {"entity_id": "media_player.loft_tv", "device_id": "dev_loft_tv"},
    {"entity_id": "media_player.cody_tv", "area_id": "cody_room"},
    {"entity_id": "climate.cody", "area_id": "cody_room"},
    {"entity_id": "sensor.kitchen_temp", "area_id": "kitchen"},
    {"entity_id": "lock.front_door", "device_id": "dev_front_lock"},          # area via its device
    {"entity_id": "lock.balcony", "area_id": "loft"},
    {"entity_id": "alarm_control_panel.house"},                                # no area
    {"entity_id": "cover.garage_door", "area_id": "garage", "original_device_class": "garage"},
    {"entity_id": "cover.side_gate", "area_id": "garage"},                     # device_class from state
    {"entity_id": "cover.loft_blind", "area_id": "loft", "device_class": "blind"},
    {"entity_id": "cover.guest_blind", "area_id": "guest_room"},
    {"entity_id": "valve.water_main", "area_id": "garage"},
    {"entity_id": "camera.doorbell", "area_id": "living_room"},
    {"entity_id": "person.jamie"},
    {"entity_id": "device_tracker.jamie_phone", "device_id": "dev_phone"},
    {"entity_id": "automation.night_mode"},
    {"entity_id": "script.goodnight"},
    {"entity_id": "vacuum.downstairs", "area_id": "kitchen"},
    {"entity_id": "scene.movie"},
]
GPS = {"latitude": 47.1, "longitude": -122.2, "gps_accuracy": 12, "friendly_name": "Jamie"}


def st(s="on", a=None, lc=1.0):
    return {"s": s, "a": dict(a or {}), "lc": lc, "lu": lc}


def registry() -> Registry:
    r = Registry()
    r.load(AREAS, DEVICES, ENTITIES, FLOORS)
    return r


def states() -> StateStore:
    store = StateStore()
    store.states = {e["entity_id"]: st("on") for e in ENTITIES}
    store.states["cover.side_gate"] = st("closed", {"device_class": "gate"})
    store.states["person.jamie"] = st("home", GPS)
    store.states["device_tracker.jamie_phone"] = st("home", {**GPS, "source_type": "gps"})
    return store


def ctx(now: float = NOW, tz: str = TZ, reg: Registry | None = None, store: StateStore | None = None) -> Context:
    return Context.from_registry(reg or registry(), now, tz, (store or states()).states)


# Fictional people and devices, and the areas their `@subject` grants mean.
def owner(**kw):
    return Subject(user_role="owner", user_id="olive", **kw)


def admin(**kw):
    return Subject(user_role="admin", user_id="arlo", **kw)


def adult(**kw):
    return Subject(user_role="adult", user_id="ada", **kw)


def child(**kw):
    kw.setdefault("user_areas", {"cody_room"})
    return Subject(user_role="child", user_id="cody", **kw)


def guest(**kw):
    kw.setdefault("user_areas", {"guest_room"})
    return Subject(user_role="guest", user_id="gwen", **kw)


def tablet(**kw):
    kw.setdefault("device_areas", {"loft"})
    return Subject(device_role="wall_tablet", device_id="loft_tablet", **kw)


def service(**kw):
    return Subject(user_role="service", user_id="svc_connect", **kw)
