"""What a kind finds in the house, once (Status & Chips): the candidates, the automatic lists, the old lists and what a
saved kind resolves to.

Shared by HK Frontend (hk_frontend/kinds.py, from Home Assistant's registries) and Mantel Server (hidden.py, from
Mantel's own copies of them). Pure: it is handed the candidates and the saved settings, and touches neither.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .kinds import KINDS, LEGACY, Kind, clean


@dataclass(frozen=True)
class Candidate:
    entity_id: str
    device_class: str | None
    shown: bool          # not hidden, disabled, config/diagnostic, or a group
    device_id: str | None
    area_id: str | None
    readings: tuple[str, ...] = ()            # the reading kinds it can be counted for
    automatic_readings: tuple[str, ...] = ()  # ...and those it is counted for by itself
    # A GROUP never counts by itself (its members would count twice), but it
    # can be added by hand -- Also Count As: a "Motion - Kitchen" helper
    # counted as the kitchen's motion (2026-10-13). `listed`: not hidden,
    # disabled, or a config/diagnostic entity in Home Assistant.
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
    # A binary sensor with no class is not a door; a cover with none is a blind.
    if cand.device_class is None and domain == "binary_sensor":
        return False
    return cand.device_class in kind.classes


def automatic(cands: Iterable[Candidate], leave_out: Mapping[str, Any] | None
              ) -> dict[str, list[str]]:
    """What each kind finds by itself."""
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


def resolve(cands: list[Candidate], settings: Mapping[str, Any]) -> dict[str, list[str]]:
    """Every kind's entities: automatic, adjusted by what was saved -- or, for
    a kind with nothing saved, its older list (LEGACY) where there is one."""
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


# WHAT AN ACCESSORY SAYS IT IS (accessories.py) over what was
# found: "Include in status" off takes it out of every kind; "Show as" a light
# or a fan counts it there (a coffee maker is not a light; a lamp on an outlet
# is), and as a switch or an outlet takes it out of lights and fans.
SHOW_AS_KIND = {"light": "lights", "fan": "fans"}


def accessories_over(out: dict[str, list[str]], present: set[str],
                     acc: Mapping[str, Any] | None) -> dict[str, list[str]]:
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
            k = SHOW_AS_KIND.get(show)  # type: ignore[assignment]
            if k and eid in present and eid not in res[k]:
                res[k] = res[k] + [eid]
    return res
