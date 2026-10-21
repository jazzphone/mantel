"""HIDDEN ACCESSORIES, MANTEL SERVER'S SIDE: what ``hk_frontend/hidden/get`` answers, worked out from
Mantel's own copies instead of Home Assistant's.

HK's ``hk_frontend/hidden/get`` (``hosts/ha/custom_components/hk_frontend/hiding.py`` ``snapshot``)
says, for every accessory that can be hidden from anything, which PLACES it can be hidden from
(``can``), which it is hidden from (``off``), which accessories are hidden everywhere, which are
counted in a kind only because they were added (``added``), what each asked-about accessory could
ALSO be counted in (``also``), and the devices and rooms hidden whole. Nothing of it is a setting
of its own: the stored parts live where they always did, and all of them are already in Mantel's
settings store from the one-time import (P3.5, ``docs/phase3/SETTINGS.md``):

    everywhere    house/settings  generated.exclude_entities (exclude_devices, exclude_areas)
    home / room   house/accessories  entities.<id>.home / .room is False
    <kind>        house/settings  counts.<kind>.exclude (and .include: Also count)
    status off    house/accessories  entities.<id>.status is False (every kind it is in)

The rest is worked out from the house: what each kind finds by itself (HA's ``kinds.candidates`` /
``automatic`` / ``suggest``) and what a room shows (``hiding._room_entities``). Here that reads the
hub's StateStore (every HA state) and Registry (HA's area / device / entity list calls) -- the same
inputs, so the same answer. Ported line for line from HA's ``kinds.py`` and ``hiding.py``; the
kinds themselves (``KINDS``, ``LEGACY``, ``clean``) are hk_core's, shared with HA.

Pure: no RBAC here (readproxy.register filters what a person may see), nothing written, nothing
sent to Home Assistant. ``plan`` / ``also_plan`` (hidden/set and hidden/also) work out what to change;
settings_store.SettingsService writes it (audited, versioned), never Home Assistant.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import re
from typing import Any

from hk_core.settings.kinds import KINDS, LEGACY, Kind, clean

ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")         # HA's accessories.ENTITY
MAX_IDS = 500                                           # HA's hiding.MAX_IDS

# What a room's section and page draw a tile for (hiding.ROOM_DOMAINS).
ROOM_DOMAINS = ("light", "switch", "fan", "cover", "lock", "media_player", "climate", "water_heater",
                "humidifier", "vacuum", "valve", "alarm_control_panel")

# Each place: what it is called, and what it covers (hiding.PLACES).
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
}
assert set(PLACES) == {"home", "room", *KINDS}, "a kind with no place"
ORDER = list(PLACES)
READINGS = ("temperature", "humidity")


@dataclass(frozen=True)
class Candidate:
    """kinds.Candidate: one entity a kind could find or be added to."""
    entity_id: str
    device_class: str | None
    shown: bool
    device_id: str | None
    area_id: str | None
    readings: tuple[str, ...] = ()
    automatic_readings: tuple[str, ...] = ()
    group: bool = False
    listed: bool = True


def matches(kind: Kind, cand: Candidate) -> bool:
    domain = cand.entity_id.split(".", 1)[0]
    if domain not in kind.domains:
        return False
    if kind.reading:
        return kind.reading in cand.readings
    if cand.device_class in kind.not_classes:
        return False
    if kind.classes is None:
        return True
    if cand.device_class is None and domain == "binary_sensor":
        return False
    return cand.device_class in kind.classes


def automatic(cands: Iterable[Candidate], leave_out: Mapping[str, Any] | None) -> dict[str, list[str]]:
    lo = leave_out or {}
    x_ent = set(lo.get("exclude_entities") or [])
    x_dev = set(lo.get("exclude_devices") or [])
    x_area = set(lo.get("exclude_areas") or [])
    out: dict[str, list[str]] = {k: [] for k in KINDS}
    for c in cands:
        if not c.shown or c.entity_id in x_ent or (c.device_id and c.device_id in x_dev) \
                or (c.area_id and c.area_id in x_area):
            continue
        for name, kind in KINDS.items():
            if matches(kind, c) and (not kind.reading or kind.reading in c.automatic_readings):
                out[name].append(c.entity_id)
    for v in out.values():
        v.sort()
    return out


def legacy(settings: Mapping[str, Any], kind: str) -> list[str]:
    where = LEGACY.get(kind)
    if not where:
        return []
    v = (settings.get(where[0]) or {}).get(where[1])
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def suggest(cands: list[Candidate], settings: Mapping[str, Any]) -> dict[str, dict[str, list[str]]]:
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


def resolve(cands: list[Candidate], settings: Mapping[str, Any]) -> dict[str, list[str]]:
    """kinds.resolve: every kind's entities, automatic, adjusted by what was saved (Leave out / Also count) or,
    for a kind with nothing saved, its older list (LEGACY) where there is one; then what each accessory says."""
    present = {c.entity_id for c in cands}
    auto = automatic(cands, settings.get("generated"))
    counts = settings.get("counts") or {}
    out: dict[str, list[str]] = {}
    for name in KINDS:
        saved = clean(counts.get(name))
        if saved is None:
            old = legacy(settings, name)
            out[name] = [e for e in old if e in present] if old else auto[name]
            continue
        drop = set(saved["exclude"])
        ids = [e for e in auto[name] if e not in drop]
        seen = set(ids)
        ids += sorted(e for e in saved["include"] if e in present and e not in seen and e not in drop)
        out[name] = ids
    return accessories_over(out, present, settings.get("accessories"))


# kinds.SHOW_AS_KIND: "Show as" a light or a fan counts it there; a switch or an outlet takes it out of both
SHOW_AS_KIND = {"light": "lights", "fan": "fans"}


def accessories_over(out: dict[str, list[str]], present: set[str],
                     acc: Mapping[str, Any] | None) -> dict[str, list[str]]:
    """kinds.accessories_over: "Include in status" off takes an accessory out of every kind; "Show as" moves it."""
    ents = (acc or {}).get("entities") or {}
    if not ents:
        return out
    res = {k: list(v) for k, v in out.items()}
    for eid, a in ents.items():
        if not isinstance(a, Mapping):
            continue
        if a.get("status") is False:
            for k in res:
                res[k] = [e for e in res[k] if e != eid]
            continue
        show = a.get("show_as")
        if show in ("switch", "outlet", "light", "fan"):
            for k in ("lights", "fans"):
                if k != SHOW_AS_KIND.get(show):
                    res[k] = [e for e in res[k] if e != eid]
            k = SHOW_AS_KIND.get(show)
            if k and eid in present and eid not in res[k]:
                res[k] = res[k] + [eid]
    return res


def _also(cands: list[Candidate], auto: Mapping[str, list[str]], want: set[str]) -> dict[str, list[str]]:
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


class Hiding:
    """The snapshot over the hub's StateStore (``.states``: id -> {s, a, lc, lu}) and Registry
    (``.entries``, ``.device_entries``, ``.area_entries``: HA's list shapes). One per server: it
    remembers each thermostat's readings while it is unavailable, as HA's ``candidates`` does."""

    def __init__(self, store: Any, registry: Any) -> None:
        self._store = store
        self._registry = registry
        self._seen: dict[str, frozenset[str]] = {}

    @property
    def ready(self) -> bool:
        """Whether there is a house to work it out from (a hub with states and registries)."""
        return self._store is not None and self._registry is not None

    def _device_area(self) -> dict[str, str | None]:
        return {d["id"]: d.get("area_id") for d in self._registry.device_entries
                if isinstance(d, Mapping) and d.get("id")}

    def candidates(self) -> list[Candidate]:
        entries: Mapping[str, Mapping[str, Any]] = self._registry.entries
        dev_area = self._device_area()
        areas = {a["area_id"]: a for a in self._registry.area_entries if isinstance(a, Mapping) and a.get("area_id")}
        nominated = {k: {a.get(k + "_entity_id") for a in areas.values()} for k in READINGS}
        wanted = {d for k in KINDS.values() for d in k.domains + k.also}
        out = []
        for eid, st in list(self._store.states.items()):
            domain = eid.split(".", 1)[0]
            if domain not in wanted:
                continue
            attrs = st.get("a") or {}
            entry = entries.get(eid)
            group = any(isinstance(attrs.get(k), list) for k in ("entity_id", "group_entities"))
            listed = True
            device_id = area_id = None
            if entry is not None:
                listed = not (entry.get("hidden_by") or entry.get("disabled_by") or entry.get("entity_category"))
                device_id = entry.get("device_id")
                area_id = entry.get("area_id")
                if area_id is None and device_id:
                    area_id = dev_area.get(device_id)
            if domain == "climate":
                had = self._seen.get(eid, frozenset())
                self._seen[eid] = had | {k for k in READINGS if "current_" + k in attrs}
            readings = tuple(k for k in READINGS if
                             (domain == "sensor" and attrs.get("device_class") == k)
                             or (domain == "climate" and k in self._seen[eid]))
            area = areas.get(area_id) if area_id else None
            auto = tuple(k for k in readings if eid in nominated[k]
                         or (domain == "climate" and area is not None and not area.get(k + "_entity_id")))
            out.append(Candidate(eid, attrs.get("device_class"), listed and not group, device_id, area_id,
                                 readings, auto, group, listed))
        return out

    def room_entities(self) -> set[str]:
        dev_area = self._device_area()
        states = self._store.states
        out = set()
        for eid, e in self._registry.entries.items():
            if eid.split(".", 1)[0] not in ROOM_DOMAINS or e.get("hidden_by") or e.get("disabled_by") \
                    or e.get("entity_category"):
                continue
            if eid not in states:
                continue
            area = e.get("area_id") or (dev_area.get(e.get("device_id")) if e.get("device_id") else None)
            if area:
                out.add(eid)
        return out

    def found(self, settings: Mapping[str, Any]) -> dict[str, list[str]]:
        """kinds.resolve over the house: what each kind counts now (the chips, the pages' status rows)."""
        return resolve(self.candidates(), settings)

    def counts(self, settings: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
        """panel._counts: Status & Chips kind by kind -- what it finds by itself (``auto``), what it counts now
        (``found``), the saved Leave out / Also count (or the older list turned into them), whether anything
        is saved, and the domains Also count may add."""
        cands = self.candidates()
        auto = automatic(cands, settings.get("generated"))
        found = resolve(cands, settings)
        offer = suggest(cands, settings)
        saved = settings.get("counts") or {}
        return {k: {"auto": auto[k], "found": found[k], "exclude": offer[k]["exclude"],
                    "include": offer[k]["include"], "saved": saved.get(k) is not None,
                    "domains": list(KINDS[k].domains), "also": list(KINDS[k].also)}
                for k in KINDS}

    def snapshot(self, settings: Mapping[str, Any], only: Iterable[str] | None = None) -> dict[str, Any]:
        """hiding.snapshot: ``settings`` is the house's (house/settings) with ``accessories``
        (house/accessories) in it. ``only``: just these accessories, each given an answer."""
        cands = self.candidates()
        auto = automatic(cands, None)
        offer = suggest(cands, settings)
        acc = (settings.get("accessories") or {}).get("entities") or {}
        gen = settings.get("generated") or {}
        can: dict[str, list[str]] = {eid: ["home", "room"] for eid in self.room_entities()}
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
            also = _also(cands, auto, want)
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

    # -- the saves (hiding.plan / also_plan): what to write, worked out here; settings_store writes it ----------
    def plan(self, settings: Mapping[str, Any], ids: list[str], everywhere: bool,
             places: Mapping[str, bool]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        """hiding.plan: the house settings changes (settings/set paths) and the accessory changes that set
        ``ids`` to Everywhere, or to exactly the ``places`` that are True (each only where it can be).
        Everywhere clears the places, so showing it again shows it in every one."""
        can = self.snapshot(settings)["can"]
        gen = settings.get("generated") or {}
        changes: dict[str, Any] = {}
        old_ex = [e for e in gen.get("exclude_entities") or [] if isinstance(e, str)]
        ex = [e for e in old_ex if everywhere or e not in ids] + [e for e in ids if everywhere and e not in old_ex]
        if ex != old_ex:
            changes["generated.exclude_entities"] = ex
        offer = suggest(self.candidates(), settings)
        for k in KINDS:
            cur = list(offer[k]["exclude"])
            new = list(cur)
            for eid in ids:
                if k not in can.get(eid, []):
                    continue
                want = not everywhere and bool(places.get(k))
                if want and eid not in new:
                    new.append(eid)
                elif not want and eid in new:
                    new.remove(eid)
            if new != cur:
                changes[f"counts.{k}"] = {"exclude": new, "include": list(offer[k]["include"])}
        acc = (settings.get("accessories") or {}).get("entities") or {}
        acc_changes: dict[str, dict[str, Any]] = {}
        for eid in ids:
            a = acc.get(eid) or {}
            mine = can.get(eid, [])
            want = {"home": False if not everywhere and "home" in mine and places.get("home") else None,
                    "room": False if not everywhere and "room" in mine and places.get("room") else None,
                    "status": None}                    # Include in Status off is now its kinds' places
            have = {k: (False if a.get(k) is False else None) for k in want}
            if want != have:
                acc_changes[eid] = want
        return changes, acc_changes

    def also_plan(self, settings: Mapping[str, Any], ids: list[str], wanted: Mapping[str, bool]) -> dict[str, Any]:
        """hiding.also_plan: the settings changes that count ``ids`` in (True) or no longer in (False) each kind
        named, only where it could be, or is already added. Counted in again, it is no longer left out there."""
        cands = self.candidates()
        auto = automatic(cands, None)
        offer = suggest(cands, settings)
        possible = _also(cands, auto, set(ids))
        changes: dict[str, Any] = {}
        for k, on in wanted.items():
            inc, ex = list(offer[k]["include"]), list(offer[k]["exclude"])
            for eid in ids:
                if on and k in possible.get(eid, []):
                    if eid not in inc:
                        inc.append(eid)
                    if eid in ex:
                        ex.remove(eid)
                elif not on and eid in inc:
                    inc.remove(eid)
            if inc != offer[k]["include"] or ex != offer[k]["exclude"]:
                changes[f"counts.{k}"] = {"exclude": ex, "include": inc}
        return changes

    # -- what a person may see of it --------------------------------------------------------------
    def entity_ids_in(self, snap: Mapping[str, Any]) -> set[str]:
        """Every entity id the snapshot names (to ask RBAC about all of them at once)."""
        ids: set[str] = set(snap.get("everywhere") or [])
        for key in ("can", "off", "added", "also"):
            ids |= set(snap.get(key) or {})
        return ids

    def members(self) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
        """(device id -> its entity ids, area id -> its entity ids, through the device's area too)."""
        dev_area = self._device_area()
        by_dev: dict[str, set[str]] = {}
        by_area: dict[str, set[str]] = {}
        for eid, e in self._registry.entries.items():
            dev = e.get("device_id")
            if dev:
                by_dev.setdefault(dev, set()).add(eid)
            area = e.get("area_id") or (dev_area.get(dev) if dev else None)
            if area:
                by_area.setdefault(area, set()).add(eid)
        return by_dev, by_area

    def only_visible(self, snap: dict[str, Any], visible: set[str], asked: list[str] | None) -> dict[str, Any]:
        """The snapshot cut down to the entities in ``visible``. An asked-about entity the person may
        not see is answered exactly as one that does not exist (``can: []`` and nothing else); a
        hidden device or room is named only when it holds an entity the person may see."""
        out = dict(snap)
        for key in ("can", "off", "added", "also"):
            out[key] = {e: v for e, v in (snap.get(key) or {}).items() if e in visible}
        out["everywhere"] = [e for e in snap.get("everywhere") or [] if e in visible]
        if asked is not None:
            for e in asked:
                out["can"].setdefault(e, [])
        by_dev, by_area = self.members()
        out["devices"] = [d for d in snap.get("devices") or [] if by_dev.get(d, set()) & visible]
        out["areas"] = [a for a in snap.get("areas") or [] if by_area.get(a, set()) & visible]
        return out
