"""HIDDEN ACCESSORIES, worked out once for both hosts (phase 24's SHARED-REPORT, 2026-11-11: the two copies had drifted,
and HK Frontend's let a bad id in a hidden device or room, or an accessory entry that is not a dict, through).

What can hide what, and what is hidden: the PLACES an accessory can be hidden from, the snapshot ``hidden/get`` answers
(``snapshot_of``), what a kind shows on Status & Chips (``suggest``) and what an accessory could also be counted in
(``also_for``). Each host only says what it reads the house from -- HK Frontend Home Assistant itself
(``hk_frontend/kinds.candidates``, ``hiding._room_entities``), Mantel Server its hub's copies
(``mantel_server/hidden.Hiding``) -- and hands that here: the same inputs, so the same answer.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .kind_match import Candidate, automatic, legacy
from .kinds import KINDS, clean

# What a room's section and page draw a tile for (hk-strategy.js TILE; a button only when it is a Wake on LAN one, so
# not offered here).
ROOM_DOMAINS = ("light", "switch", "fan", "cover", "lock", "media_player", "climate", "water_heater",
                "humidifier", "vacuum", "valve", "alarm_control_panel")

# Each place: what it is called, and what it covers. The kinds' are the pages and chips that read that kind
# (hk-strategy.js, hk-chip.js).
PLACES: dict[str, tuple[str, str]] = {
    "home": ("Home", "The Home screen’s room sections"),
    "room": ("Room Page", "Its tile on its room’s own page"),
    "smoke": ("Smoke & CO", "The Smoke & CO chip"),
    "temperature": ("Temperature", "The Climate page’s temperature ranges"),
    "humidity": ("Humidity", "The Climate page’s humidity ranges"),
    "lights": ("Lights", "The Lights page and chip"),
    "fans": ("Fans", "The Climate page and chip"),
    "doors": ("Doors", "The Doors & Windows page and chip"),
    "windows": ("Windows", "The Doors & Windows page and chip"),
    "garage": ("Garage", "The Security page and the Doors & Windows chip"),
    "locks": ("Security", "Locks on the Security page and chip"),
    "blinds": ("Blinds", "The Blinds chip and the Climate page"),
    "leaks": ("Water", "Leak sensors on the Water page and chip"),
    "motion": ("Motion", "Rooms with motion, on status rows"),
    "occupancy": ("Occupancy", "Rooms with someone in them, on status rows"),
    "valves": ("Valves", "The Water page"),
    "thermostats": ("Climate", "Thermostats on the Climate page and chip"),
    "timers": ("Timers", "The Timers page and chip"),
    "vacuums": ("Vacuums", "The Vacuums page and chip"),
    "speakers": ("Speakers", "The Speakers chip"),
    "scenes": ("Scenes", "Scene blocks, rooms’ scene rows and Suggested Scene"),
}
assert set(PLACES) == {"home", "room", *KINDS}, "a kind with no place"
ORDER = list(PLACES)


def suggest(cands: list[Candidate], settings: Mapping[str, Any]) -> dict[str, dict[str, list[str]]]:
    """What the Status & Chips page shows for each kind: what was saved, else an old list turned into Leave out / Also
    count against what is found now (so saving it counts exactly what was counted), else nothing (automatic)."""
    auto = automatic(cands, settings.get("generated"))
    counts = settings.get("counts") or {}
    out: dict[str, dict[str, list[str]]] = {}
    for name in KINDS:
        saved = clean(counts.get(name))
        if saved is not None:
            out[name] = saved
            continue
        old = legacy(settings, name)
        if not old:
            out[name] = {"exclude": [], "include": []}
            continue
        keep, found = set(old), set(auto[name])
        out[name] = {"exclude": [e for e in auto[name] if e not in keep],
                     "include": [e for e in old if e not in found]}
    return out


def also_for(cands: list[Candidate], auto: Mapping[str, list[str]], want: set[str]) -> dict[str, list[str]]:
    """The kinds each of ``want`` could ALSO be counted in: its domain is one the kind's Also count offers, it isn't
    found there by itself -- and for a reading (temperature, humidity), it reports that reading. Hidden or disabled in
    Home Assistant are offered nothing; a group is offered what its domain could be (never found by itself, so only
    ever added by hand)."""
    out: dict[str, list[str]] = {}
    for c in cands:
        if c.entity_id not in want or not (c.shown or (c.group and c.listed)):
            continue
        domain = c.entity_id.split(".", 1)[0]
        ks = [k for k, kind in KINDS.items()
              if domain in kind.also and c.entity_id not in auto[k]
              and (not kind.reading or kind.reading in c.readings)]
        if ks:
            out[c.entity_id] = sorted(ks, key=ORDER.index)
    return out


def snapshot_of(cands: list[Candidate], room_entities: Iterable[str], settings: Mapping[str, Any],
                only: Iterable[str] | None = None) -> dict[str, Any]:
    """What can hide what, and what is hidden (``hidden/get``): ``cands`` the house's kind candidates, ``room_entities``
    the accessories a room's section and page draw, ``settings`` the house's (``accessories`` in it). ``only``: just these
    accessories, each given an answer, hideable or not."""
    auto = automatic(cands, None)
    offer = suggest(cands, settings)
    acc = (settings.get("accessories") or {}).get("entities") or {}
    gen = settings.get("generated") or {}
    can: dict[str, list[str]] = {eid: ["home", "room"] for eid in room_entities}
    added: dict[str, list[str]] = {}
    for k in KINDS:
        for eid in {*auto[k], *offer[k]["exclude"]}:
            can.setdefault(eid, []).append(k)
        for eid in offer[k]["include"]:
            if eid not in auto[k]:
                added.setdefault(eid, []).append(k)
    off: dict[str, list[str]] = {}
    for eid, keys in can.items():
        a = acc.get(eid) or {}
        if not isinstance(a, Mapping):
            a = {}
        hid = [k for k in keys if
               (k == "home" and a.get("home") is False) or (k == "room" and a.get("room") is False)
               or (k in KINDS and (eid in offer[k]["exclude"] or a.get("status") is False))]
        if hid:
            off[eid] = hid
    for eid in can:
        can[eid].sort(key=ORDER.index)
    everywhere = [e for e in gen.get("exclude_entities") or [] if isinstance(e, str)]
    also: dict[str, list[str]] = {}
    if only is not None:
        want = set(only)
        can = {e: v for e, v in can.items() if e in want}
        off = {e: v for e, v in off.items() if e in want}
        added = {e: v for e, v in added.items() if e in want}
        for e in want:
            can.setdefault(e, [])
        everywhere = [e for e in everywhere if e in want]
        also = also_for(cands, auto, want)
    return {
        "places": {k: list(v) for k, v in PLACES.items()},
        "order": list(ORDER),
        "can": can,
        "off": off,
        "everywhere": everywhere,
        "added": added,
        "also": also,
        "devices": [d for d in gen.get("exclude_devices") or [] if isinstance(d, str)],
        "areas": [a for a in gen.get("exclude_areas") or [] if isinstance(a, str)],
    }
