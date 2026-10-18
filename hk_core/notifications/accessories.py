"""WHAT A NOTIFICATION WATCHES, found in the house: an accessory's name and kind, the camera on
its device, a category's accessories, the Cameras category's pairs.

Alarm PIN's panels come from the host (they are HK's own settings, not the house's): `pins` is
a callable answering {panel: the alarm it stands in front of}, asked only when an alarm is
involved.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from ..house import Entity, House, State
from . import rules
from .const import OWN_PLATFORM

Pins = Callable[[], Mapping[str, str]]


def no_pins() -> Mapping[str, str]:
    return {}


def _device_name(house: House, entity_id: str) -> str | None:
    ent = house.entity(entity_id)
    if ent is None or not ent.device_id:
        return None
    dev = house.device(ent.device_id)
    return dev.name if dev else None


def name_of(house: House, entity_id: str) -> str:
    """The accessory's name for a banner: its friendly name -- or, for a
    detection a device names after itself ("Front Door Camera Person
    detected"), the device ("Front Door Camera")."""
    st = house.state(entity_id)
    full = str(st.name if st is not None else entity_id.split(".", 1)[-1].replace("_", " ").title())
    dev = _device_name(house, entity_id)
    if dev and full.lower().startswith(dev.lower() + " ") and entity_id.split(".")[0] in ("binary_sensor", "event", "camera"):
        return dev
    return full


def _rank(cam: str) -> tuple[int, str]:
    return (0 if "high" in cam else 2 if "low" in cam else 1, cam)


def camera_for(house: House, entity_id: str) -> str | None:
    """The camera on the same device (a camera's own detection sensor), the
    best channel first; None when there is none."""
    ent = house.entity(entity_id)
    if ent is None or not ent.device_id:
        return None
    cams = sorted((e.entity_id for e in house.device_entities(ent.device_id)
                   if e.domain == "camera" and not e.disabled), key=_rank)
    return cams[0] if cams else None


# THE CAMERAS CATEGORY: one row per camera device (its channels are one
# camera: the best is its live view), each with the sensor that sets it off
TRIGGER_KINDS = ("person", "doorbell", "motion", "presence", "vehicle", "animal", "package")


def usable(e: Entity) -> bool:
    """Shown by the house (not disabled, hidden or a device's diagnostic) and not HK's own."""
    return not (e.disabled or e.hidden or e.entity_category or e.platform == OWN_PLATFORM)


def camera_list(house: House) -> list[str]:
    """Every camera, one per device (its best channel), not HK Frontend's own
    (Live TV's channels)."""
    best: dict[str, str] = {}
    lone = []
    for e in house.entities("camera"):
        if not usable(e):
            continue
        if not e.device_id:
            lone.append(e.entity_id)
            continue
        cur = best.get(e.device_id)
        if cur is None or _rank(e.entity_id) < _rank(cur):
            best[e.device_id] = e.entity_id
    return sorted(set(best.values()) | set(lone))


def kind(house: House, entity_id: str, entry: Entity | None = None,
         states: Mapping[str, State] | None = None) -> str:
    """An accessory's kind, from its state's device class or (before it has
    a state -- the house starting) its registry entry's. `states`: the
    house's states already read, when many are asked at once."""
    domain, oid = entity_id.split(".", 1)
    st = states.get(entity_id) if states is not None else house.state(entity_id)
    dc = st.attributes.get("device_class") if st is not None else None
    if dc is None and entry is not None:
        dc = entry.device_class or entry.original_device_class
    return rules.kind_of(domain, dc, oid)


def trigger_for(house: House, camera: str) -> str | None:
    """The sensor a camera's notification goes off on, suggested: its own
    device's person detection, else its doorbell, motion or presence."""
    ent = house.entity(camera)
    if ent is None or not ent.device_id:
        return None
    found = []
    for e in house.device_entities(ent.device_id):
        if e.domain not in ("binary_sensor", "event") or not usable(e):
            continue
        k = kind(house, e.entity_id, e)
        if k in TRIGGER_KINDS and k != "package":
            # (a binary sensor before an event: it has an off as well)
            found.append((TRIGGER_KINDS.index(k), e.domain != "binary_sensor", e.entity_id))
    return min(found)[2] if found else None


def camera_pairs(house: House, item: dict[str, Any]) -> list[dict[str, Any]]:
    """A Cameras category's cameras: each with its trigger and its live view
    (what was chosen, else suggested), and whether it notifies."""
    chosen = {p.get("camera"): p for p in (item.get("pairs") or []) if isinstance(p, dict)}
    ex = set(item.get("exclude") or [])
    cams = camera_list(house)
    out = []
    for cam in cams + [c for c in chosen if c and c not in cams]:
        p = chosen.get(cam, {})
        suggested = trigger_for(house, cam)
        trig = p.get("trigger") or suggested
        out.append({"camera": cam, "view": p.get("view") or cam, "trigger": trig, "suggested": suggested,
                    "on": cam not in ex and bool(trig)})
    return out


def describe(house: House, entity_id: str) -> dict[str, Any]:
    """What a notification on this accessory is: its kind, choices, name,
    suggested camera."""
    st = house.state(entity_id)
    domain, oid = entity_id.split(".", 1)
    k = rules.kind_of(domain, st.attributes.get("device_class") if st else None, oid)
    cam = camera_for(house, entity_id) if domain != "camera" else entity_id
    name = name_of(house, entity_id)
    when = rules.default_when(k)
    title, message = rules.words(k, when, name, (when, {}), fired_on=when)
    icon, tint = rules.look(k)
    return {"entity": entity_id, "kind": k, "name": name, "choices": [list(c) for c in rules.choices(k)],
            "when": when, "camera": cam, "event": domain == "event", "title": title, "message": message,
            "icon": icon, "tint": tint, "important": k in rules.IMPORTANT,
            "missing": st is None}


def keypad_for(eid: str | None, pins: Pins = no_pins) -> str | None:
    """THE SHEET A TAP OPENS for an alarm with an Alarm PIN panel in front of
    it: the panel's, which asks for the PIN -- not the alarm's own, which
    arms and disarms for anyone (2026-10-13: a tap on the Lyric alarm's
    notification opened its plain Arm / Disarm sheet, not the keypad)."""
    if not eid or not eid.startswith("alarm_control_panel."):
        return eid
    for panel, alarm in pins().items():
        if alarm == eid:
            return panel
    return eid


def candidates(house: House, key: str, pins: Pins = no_pins) -> list[str]:
    """A category's accessories, found: every entity of its kinds that the
    house shows (not hidden, disabled or a device's diagnostic), not HK
    Frontend's own -- except an Alarm PIN panel, listed BESIDE the alarm it
    protects (2026-10-13, the user's call: both, the panel saying what it is
    -- settings.named). It mirrors that alarm, so with both ticked only
    one is watched (members); a tap on either opens the keypad (keypad_for)."""
    cat = rules.category(key)
    if cat is None:
        return []
    if key == "cameras":
        return camera_list(house)
    kinds = cat[2]
    panels = pins() if "alarm_panel" in kinds else {}
    states = {s.entity_id: s for s in house.states()}
    entities = house.entities()
    out = []
    for e in entities:
        if e.disabled or e.hidden or e.entity_category or (e.platform == OWN_PLATFORM and e.entity_id not in panels):
            continue
        if kind(house, e.entity_id, e, states) in kinds:
            out.append(e.entity_id)
    known = {e.entity_id for e in entities}
    for st in states.values():                  # an entity with no registry entry (YAML's)
        if st.entity_id not in known and kind(house, st.entity_id, None, states) in kinds:
            out.append(st.entity_id)
    return sorted(set(out))


def members(house: House, item: dict[str, Any], pins: Pins = no_pins) -> list[str]:
    """What a notification watches: its accessory, or its category's less
    those left out."""
    if item.get("category") == "cameras":
        return [p["trigger"] for p in camera_pairs(house, item) if p["on"]]
    if item.get("category"):
        ex = set(item.get("exclude") or [])
        got = [e for e in candidates(house, item["category"], pins) if e not in ex]
        # AN ALARM AND ITS PIN PANEL ARE ONE ALARM: both ticked, the alarm is
        # watched and the panel not -- one notification, opening the keypad
        if any(e.startswith("alarm_control_panel.") for e in got):
            panels = pins()
            got = [e for e in got if not (e in panels and panels[e] in got)]
        return got
    return [item["entity"]] if item.get("entity") else []


def about(house: House, item: dict[str, Any]) -> dict[str, Any]:
    """describe() for a notification: its accessory's, or its category's."""
    key = item.get("category")
    if not key:
        return describe(house, item["entity"])
    cat = rules.category(key) or ("", key, ("state",), {})
    k = cat[2][0]
    when = item.get("when") or cat[3].get("when") or rules.default_when(k)
    _t, message = rules.words(k, when, "", (when, {}), fired_on=when)
    title = "Each one’s name"
    if k == "calendar":
        title, message = "The event’s name", "When it is, and where"
    icon, tint = rules.look(k)
    return {"category": key, "kind": k, "name": cat[1], "choices": [list(c) for c in rules.choices(k)],
            "when": cat[3].get("when") or rules.default_when(k), "camera": None, "event": False,
            "title": title, "message": message, "icon": icon, "tint": tint,
            "important": bool(cat[3].get("important")), "missing": False}
