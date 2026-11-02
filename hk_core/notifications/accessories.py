"""WHAT A NOTIFICATION WATCHES, found in the house: an accessory's name and kind, the camera on
its device, a category's accessories, the Cameras category's pairs.

A camera that is on a Home Assistant device finds its sensors there (its own person or motion
detection, its doorbell press). A Mantel DIRECT camera (an RTSP camera set up in Mantel Settings,
docs/phase13/CAMERAS-DIRECT.md phase 6) has no device, so the person who set it up LINKS its sensors
(Motion, Person, Doorbell: any binary sensor or event, Frigate's for one) and the house reports them
as ``camera_links``. That one mapping stands in for the device wherever the code below would have
asked "what is on this sensor's device": ``camera_for`` (a sensor's camera: its snapshot, its live
sheet), ``trigger_for`` (a camera's sensor), ``kind`` (a linked sensor is that kind whatever its
device class says: a Doorbell link rings the Doorbells notification, with its pop-up). Nothing else
changed: the rules read kinds and cameras from here, as they did.

Alarm PIN's panels come from the host (they are HK's own settings, not the house's): `pins` is
a callable answering {panel: the alarm it stands in front of}, asked only when an alarm is
involved.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

from ..house import Entity, House, State
from . import rules
from .const import OWN_PLATFORM

Pins = Callable[[], Mapping[str, str]]

# a linked sensor's role -> the kind it counts as (rules.kind_of's words)
LINK_KINDS = {"motion": "motion", "person": "person", "doorbell": "doorbell"}


def links(house: House) -> Mapping[str, tuple[str, str]]:
    """The house's camera links, {sensor: (camera, role)}; {} where it has none (a House written before they
    were, or Home Assistant's, whose cameras have devices)."""
    got = getattr(house, "camera_links", None)
    if not callable(got):
        return {}
    out = got()
    return out if isinstance(out, Mapping) else {}


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
    best channel first; the camera a sensor is linked to (a direct camera has no
    device); None when there is none."""
    linked = links(house).get(entity_id)
    if linked is not None and house.entity(linked[0]) is not None:
        return linked[0]                        # told so: a direct camera has no device
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
    linked = links(house).get(entity_id)
    if linked is not None and linked[1] in LINK_KINDS:
        return LINK_KINDS[linked[1]]
    st = states.get(entity_id) if states is not None else house.state(entity_id)
    dc = st.attributes.get("device_class") if st is not None else None
    if dc is None and entry is not None:
        dc = entry.device_class or entry.original_device_class
    return rules.kind_of(domain, dc, oid)


def trigger_for(house: House, camera: str) -> str | None:
    """The sensor a camera's notification goes off on, suggested: its own
    device's person detection, else its doorbell, motion or presence (a direct
    camera: the same order among the sensors linked to it)."""
    told = [(TRIGGER_KINDS.index(LINK_KINDS[role]), not eid.startswith("binary_sensor."), eid)
            for eid, (cam, role) in links(house).items() if cam == camera and role in LINK_KINDS]
    if told:
        return min(told)[2]
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
    told = links(house).get(entity_id)
    if told is not None and told[1] in LINK_KINDS:
        k = LINK_KINDS[told[1]]
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


# SUGGESTING A DIRECT CAMERA'S SENSORS: it has no device to find them on, so they are found by name -- the sensors
# whose name begins with the camera's ("Driveway" -> Frigate's "Driveway Person Occupancy"), by what each is.
LINK_ROLES = ("motion", "person", "doorbell")
_ROLE_OF_KIND = {"person": "person", "doorbell": "doorbell", "motion": "motion", "presence": "motion"}


def suggest_links(house: House, camera_name: str, taken: Mapping[str, str] | None = None) -> dict[str, str | None]:
    """For a camera named `camera_name`: the sensor to suggest for each role (Motion, Person, Doorbell), or None.
    A sensor qualifies when it is a binary sensor or an event the house shows (``usable``) whose name begins with
    the camera's, as a whole word, and none already linked to another camera (`taken`: {sensor: the camera it is
    linked to}). A binary sensor is preferred to an event (it has an off as well), as ``trigger_for`` does."""
    want = " ".join(str(camera_name or "").lower().split())
    out: dict[str, str | None] = {r: None for r in LINK_ROLES}
    if not want:
        return out
    found: dict[str, list[tuple[bool, str]]] = {r: [] for r in LINK_ROLES}
    for e in house.entities():
        if e.domain not in ("binary_sensor", "event") or not usable(e) or (taken or {}).get(e.entity_id):
            continue
        st = house.state(e.entity_id)
        names = {" ".join(name_of(house, e.entity_id).lower().split())}
        if st is not None:
            names.add(" ".join(str(st.name).lower().split()))
        if not any(n == want or n.startswith(want + " ") for n in names):
            continue
        dc = (st.attributes.get("device_class") if st is not None else None) or e.device_class or e.original_device_class
        oid = e.entity_id.split(".", 1)[1]
        role = _ROLE_OF_KIND.get(rules.kind_of(e.domain, dc, oid))
        # Frigate's person sensor is an occupancy sensor ("Driveway Person Occupancy"): by the device class alone it
        # is presence, so the words of its name say what it senses
        words = set(re.split(r"[^a-z0-9]+", (oid + " " + " ".join(names)).lower()))
        if role in (None, "motion") and words & {"person", "people"}:
            role = "person"
        elif role is None and "motion" in words:
            role = "motion"
        if role:
            found[role].append((e.domain != "binary_sensor", e.entity_id))
    for role, got in found.items():
        if got:
            out[role] = min(got)[1]
    return out
