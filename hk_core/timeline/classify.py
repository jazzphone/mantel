"""WHAT THE HOUSE TIMELINE RECORDS, without a host (hk_core; tested on its own):

    family_of(domain, object_id, device_class)   an entity's family (and detection word), or None
    candidate(...)                               may a registry entry be recorded at all
    member(entity_id, ...)                       the Member an entity becomes, or None
    change(family, domain, old, new)             the kind a state change is, or None (not recorded)
    level(family, kind)                          "info" or "warning"

Built on notifications.rules.kind_of, so a door sensor is a door the same way it is for notifications.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from ..notifications import rules

FAMILIES = ("door", "window", "lock", "garage", "alarm", "arrival", "doorbell", "detection", "motion", "safety",
            "system", "refused")
DEFAULT_ON = frozenset(FAMILIES) - {"window"}
MANAGER_ONLY = frozenset({"system", "refused"})
# the wall tablet's limited view
WALL_FAMILIES = ("door", "lock", "garage", "alarm", "doorbell", "detection")
CAMERA_FAMILIES = frozenset({"doorbell", "detection", "motion"})
DETECTIONS = ("person", "vehicle", "animal", "package")

# the families an entity can be in (system and refused come from elsewhere)
_ENTITY_FAMILIES = frozenset(FAMILIES) - MANAGER_ONLY
_GONE = ("unavailable", "unknown", "", None)
_ARMED = ("armed_away", "armed_home", "armed_night", "armed_vacation", "armed_custom_bypass")
_SAFETY_WORDS = ("leak", "smoke", "co", "gas")


@dataclass(frozen=True)
class Member:
    family: str
    label: str                      # the name shown ("Back Door", "Garage", "Emma", "Driveway")
    area: str | None                # area id
    camera: str | None              # the camera entity of a camera's row (doorbell/detection/motion), else None
    detection: str | None = None    # family "detection": person|vehicle|animal|package; "safety": leak|smoke|co|gas


def family_of(domain: str, object_id: str, device_class: str | None, *,
              motion_only: bool = False) -> tuple[str, str | None] | None:
    """(family, detection-or-safety word) of an entity, or None when the timeline doesn't care about it.
    `motion_only`: a camera with no smart detection, whose motion sensor is then recorded."""
    dc = (device_class or "").lower()
    kind = rules.kind_of(domain, dc, object_id)
    if domain == "binary_sensor":
        if kind in DETECTIONS:
            return ("detection", kind)
        if kind == "doorbell":
            return ("doorbell", None)
        if kind == "door":
            return ("door", None)
        if kind == "window":
            return ("window", None)
        if kind == "motion":
            return ("motion", None) if motion_only else None
        if dc == "moisture":
            return ("safety", "leak")
        if dc == "smoke":
            return ("safety", "smoke")
        if dc == "gas":
            return ("safety", "gas")
        if dc == "carbon_monoxide":
            return ("safety", "co")
        return None
    if domain == "event":
        if kind == "doorbell":
            return ("doorbell", None)
        if kind in DETECTIONS:
            return ("detection", kind)
        return None
    if domain in ("lock", "valve"):
        return ("lock", None)
    if domain == "cover":
        return ("garage", None) if kind == "garage" else None
    if domain == "alarm_control_panel":
        return ("alarm", None)
    if domain == "person":
        return ("arrival", None)
    return None


def candidate(*, disabled: bool = False, hidden: bool = False, entity_category: str | None = None,
              mine: bool = False) -> bool:
    """An entity may be recorded when it isn't disabled or hidden, has no entity category (diagnostic, config),
    and isn't one of Mantel's own detection entities (the Protect tap speaks for those)."""
    return not (disabled or hidden or entity_category or mine)


def member(entity_id: str, *, device_class: str | None, label: str, area: str | None, camera: str | None,
           disabled: bool = False, hidden: bool = False, entity_category: str | None = None, mine: bool = False,
           motion_only: bool = False, override: Mapping | None = None,
           families: Mapping[str, bool] | None = None) -> Member | None:
    """What an entity is to the timeline, or None (not recorded). `override` is the Owner's
    {record: bool, family?: str, label?: str}; `families` the per-family switch (a missing one is DEFAULT_ON)."""
    override = override if isinstance(override, Mapping) else {}
    record = override.get("record")
    if record is False or disabled:
        return None
    domain, _, object_id = entity_id.partition(".")
    found = family_of(domain, object_id, device_class, motion_only=motion_only)
    word = found[1] if found else None
    family = found[0] if found else None
    if record is True:
        wanted = override.get("family")
        if isinstance(wanted, str) and wanted in _ENTITY_FAMILIES:
            if wanted != family:
                word = None
            family = wanted
        elif family is None and domain == "binary_sensor":
            family = "door"
        if family is None:
            return None
    else:
        if family is None or not candidate(disabled=disabled, hidden=hidden, entity_category=entity_category,
                                           mine=mine):
            return None
        if not (families or {}).get(family, family in DEFAULT_ON):
            return None
    custom = override.get("label")
    custom = custom.strip()[:64].strip() if isinstance(custom, str) else ""
    return Member(family, custom or label, area, camera if family in CAMERA_FAMILIES else None, word)


def _event(old: str | None) -> bool:
    # an event entity's state is the time of its last event: the first one after a start (no old state) or after
    # the device was unavailable is not an event
    return old is not None and old != "unavailable"


def change(family: str, domain: str, old: str | None, new: str | None, *, detection: str | None = None) -> str | None:
    """The kind a state change old -> new is, or None (not recorded). An unavailable or unknown new state never
    is one; an old that is None or gone counts as 'from nothing' (a catch-up row), except for event entities."""
    if new in _GONE or old == new:
        return None
    if family in ("door", "window"):
        return "opened" if new == "on" else "closed" if new == "off" else None
    if family == "lock":
        if domain == "valve":
            return "opened" if new == "open" else "closed" if new == "closed" else None
        if new == "locked":
            return "locked"
        if new == "jammed":
            return "jammed"
        if new in ("unlocked", "open"):
            return None if old in ("unlocked", "open") else "unlocked"
        return None
    if family == "garage":
        return "opened" if new == "open" else "closed" if new == "closed" else None
    if family == "alarm":
        return new if new in _ARMED or new in ("disarmed", "triggered") else None
    if family == "arrival":
        if new == "home":
            return "arrived"
        if old == "home":
            return "left"
        return None
    if family == "doorbell":
        if domain == "event":
            return "ring" if _event(old) else None
        return "ring" if new == "on" else None
    if family == "detection":
        if domain == "event":
            return detection if _event(old) else None
        return detection if new == "on" else "end" if new == "off" else None
    if family == "motion":
        return "motion" if new == "on" else "end" if new == "off" else None
    if family == "safety":
        return detection if new == "on" else "clear" if new == "off" else None
    return None


def level(family: str, kind: str) -> str:
    """"warning" for a jammed lock, a triggered alarm and anything safety raises; else "info"."""
    if (family == "lock" and kind == "jammed") or (family == "alarm" and kind == "triggered"):
        return "warning"
    if family == "safety" and kind in _SAFETY_WORDS:
        return "warning"
    return "info"
