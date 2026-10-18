"""STORED OPTIONS MOVED FORWARD, once each (the host saves what comes back). A new Notifications
starts marked (TAPS_V, WAKE_V), so it has nothing to move."""
from __future__ import annotations

from typing import Any

from .const import CONF_ITEMS

# TAP OPENS, ITS MEANING MOVED (2026-10-12). It was what a tap on an opened
# banner's snapshot did; a tap now opens the accessory's sheet with the
# notification on it, and Tap Opens is what the banner itself opens. So a
# notification saved before keeps its sheet: "Nothing" (the picture did
# nothing) and "Live Camera" on an accessory that isn't what a camera sees
# (a garage door with its snapshot) become Its Sheet. Once: TAPS_V marks it.
TAPS_V = "taps_v"


def migrate_taps(opts: dict[str, Any]) -> dict[str, Any] | None:
    """The options with old Tap Opens moved over, or None when there is
    nothing to do. A new Notifications starts marked."""
    if opts.get(TAPS_V):
        return None
    cams = ("cameras", "packages", "doorbells")
    items = []
    for it in opts.get(CONF_ITEMS) or []:
        it = dict(it)
        if it.get("tap") == "none" or (it.get("tap") == "camera" and it.get("category") not in cams):
            it["tap"] = "sheet"
        items.append(it)
    return {**opts, CONF_ITEMS: items, TAPS_V: 2}


# WAKES THE SCREEN, ITS OWN OR ALL NOTIFICATIONS' (1.7.1). 1.7.0 saved
# `wake: False` on every notification it made, and any stored True or False
# is that notification's own choice -- so none of them followed All
# Notifications' Wakes the Screen. A stored False becomes "Same as All
# Notifications" (the key removed, as a new one has None); a True was chosen
# and stays. Once: WAKE_V marks it.
WAKE_V = "wake_v"


def migrate_wake(opts: dict[str, Any]) -> dict[str, Any] | None:
    """The options with 1.7.0's `wake: False` following All Notifications,
    or None when there is nothing to do. A new Notifications starts marked."""
    if opts.get(WAKE_V):
        return None
    items = []
    for it in opts.get(CONF_ITEMS) or []:
        it = dict(it)
        if it.get("wake") is False:
            it.pop("wake")
        items.append(it)
    return {**opts, CONF_ITEMS: items, WAKE_V: 1}


MIGRATIONS = (migrate_taps, migrate_wake)


def migrate(opts: dict[str, Any]) -> dict[str, Any] | None:
    """Every move the stored options still need, in order; None when there is none."""
    moved = None
    for step in MIGRATIONS:
        done = step(opts)
        if done is not None:
            opts = moved = done
    return moved
