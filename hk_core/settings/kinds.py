"""STATUS & CHIPS' KINDS: what each kind finds, and the shape of what is saved for it.

The settings read this (DEFAULTS["counts"], the older lists a kind replaced, a saved kind's
check); finding the house's entities of each kind is the host's (inside Home Assistant,
kinds.py: the registries, the readings by room, the tracker).
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Kind:
    """domains/classes: what is found. classes None = any device class;
    a None INSIDE classes = an entity with no device class. not_classes: left
    out of the domain. also: the domains Also count offers. reading: a
    sensor's device class (or a thermostat's current_<reading>) -- the Climate
    page's kinds, matched by that and found by room (candidates())."""
    domains: tuple[str, ...]
    also: tuple[str, ...]
    classes: tuple[str | None, ...] | None = None
    not_classes: tuple[str, ...] = ()
    reading: str | None = None


# The order is the page's, and the chip row's.
KINDS: dict[str, Kind] = {
    # The Smoke & CO chip, first in every row: a smoke or carbon monoxide
    # alarm. A gas detector, a camera that hears an alarm -- Also count.
    "smoke": Kind(("binary_sensor",), classes=("smoke", "carbon_monoxide"), also=("binary_sensor",)),
    "temperature": Kind(("sensor", "climate"), also=("sensor", "climate"), reading="temperature"),
    "humidity": Kind(("sensor", "climate"), also=("sensor", "climate"), reading="humidity"),
    "lights": Kind(("light",), also=("light", "switch")),
    "fans": Kind(("fan",), also=("fan", "switch")),
    "doors": Kind(("binary_sensor",), classes=("door",), also=("binary_sensor", "cover")),
    "windows": Kind(("binary_sensor",), classes=("window",), also=("binary_sensor", "cover")),
    # The garage DOOR is usually a cover; a garage_door contact is its sensor.
    "garage": Kind(("cover", "binary_sensor"), classes=("garage", "gate", "garage_door"),
                   also=("cover", "binary_sensor")),
    "locks": Kind(("lock",), also=("lock",)),
    # What the Home app calls window coverings. Not dampers, doors, garage doors or
    # gates; a cover with no device class is most likely a blind.
    "blinds": Kind(("cover",), classes=("awning", "blind", "curtain", "shade", "shutter",
                                        "window", None), also=("cover",)),
    "leaks": Kind(("binary_sensor",), classes=("moisture",), also=("binary_sensor",)),
    # Pages' status rows only, not a chip (Doors & Windows, Water, Security):
    # the room it is detected in, and a water valve -- not a gas one.
    "motion": Kind(("binary_sensor",), classes=("motion", "moving"), also=("binary_sensor",)),
    "occupancy": Kind(("binary_sensor",), classes=("occupancy", "presence"), also=("binary_sensor",)),
    "valves": Kind(("valve",), classes=("water", None), also=("valve", "switch")),
    "thermostats": Kind(("climate",), also=("climate", "water_heater")),
    "timers": Kind(("timer",), also=("timer",)),
    "vacuums": Kind(("vacuum",), also=("vacuum",)),
    # Speakers, not screens: a TV and an AV receiver are left out.
    "speakers": Kind(("media_player",), not_classes=("tv", "receiver"), also=("media_player",)),
}

# The older lists Status & Chips replaced (an entry from an older version may
# hold them): kind -> (section, key).
LEGACY = {"locks": ("security", "locks"), "doors": ("security", "doors"),
          "windows": ("security", "windows"), "garage": ("security", "garage"),
          "thermostats": ("features", "thermostats")}


def blank() -> dict[str, None]:
    """settings.DEFAULTS["counts"]: None = nothing saved for that kind."""
    return {k: None for k in KINDS}


def clean(value: Any) -> dict[str, list[str]] | None:
    """One kind's saved adjustments, each value checked."""
    if not isinstance(value, Mapping):
        return None
    ids = lambda v: [str(x) for x in v if isinstance(x, str) and "." in x] \
        if isinstance(v, list) else []  # noqa: E731
    return {"exclude": ids(value.get("exclude")), "include": ids(value.get("include"))}
