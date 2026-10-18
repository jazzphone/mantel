"""CLEAN THESE AREAS -- one action, every vacuum, the house's own mapping.

The first feature moved into hk_core (PLAN.md §0, plan review: feature by feature). Given area
ids (what the vacuum area picker sends, or an automation, or a voice sentence), it works out
which robot cleans what, from the house itself:

  * a vacuum with CLEAN_AREA and a room mapping (entity settings -> the map of the house's
    areas to the robot's own rooms, stored in the entity registry as
    options.vacuum.area_mapping) gets `vacuum.clean_area` with the selected areas it covers --
    one call per robot, all of its rooms at once;
  * a vacuum with CLEAN_AREA but NO mapping is skipped: it cannot be told where to go
    (typically a second integration's entity for the same robot);
  * a vacuum without CLEAN_AREA starts when its OWN area is selected -- a robot that cannot
    leave one room cleans that room by starting.

Which vacuums take part: Configure (default: all). `dry_run` answers with the plan and sends
nothing -- how to check the plan without moving a robot.

No room lists are kept here: every answer is worked out from the registries.
The answer is {ok, plan: [{vacuum, action, areas}], unreachable: [areas]}.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .house import Entity, House, area_of

CONF_VACUUMS = "vacuums"      # which vacuums take part; empty = every vacuum
CONF_AREAS = "areas"          # which areas the picker offers; empty = every area a vacuum reaches
CLEAN_AREA = 16384            # VacuumEntityFeature.CLEAN_AREA


def _mapping(entry: Entity | None) -> Mapping[str, Any]:
    return ((entry.options if entry else {}) or {}).get("vacuum", {}).get("area_mapping") or {}


def plan(house: House, areas: list[str], options: Mapping[str, Any] | None) -> dict[str, Any]:
    """Who cleans what, for these areas. Pure: reads state and registries."""
    chosen = list((options or {}).get(CONF_VACUUMS) or [])
    ids = chosen or sorted(s.entity_id for s in house.states("vacuum"))
    wanted = list(dict.fromkeys(a for a in areas if a))
    covered: set[str] = set()
    out = []
    for eid in ids:
        st = house.state(eid)
        if st is None or st.state in ("unavailable", "unknown"):
            continue
        entry = house.entity(eid)
        features = int(st.attributes.get("supported_features") or 0)
        if features & CLEAN_AREA:
            mapping = _mapping(entry)
            if not mapping:
                continue
            mine = [a for a in wanted if a in mapping]
            if mine:
                out.append({"vacuum": eid, "action": "clean_area", "areas": mine})
                covered.update(mine)
        else:
            home = area_of(house, entry)
            if home and home in wanted:
                out.append({"vacuum": eid, "action": "start", "areas": [home]})
                covered.add(home)
    return {"plan": out, "unreachable": [a for a in wanted if a not in covered]}


def _features(house: House, eid: str, entry: Entity | None) -> int | None:
    """What the robot can do: its state's, or -- offline, when a state has no attributes --
    what the entity registry last recorded."""
    st = house.state(eid)
    if st is not None and st.state not in ("unavailable", "unknown"):
        return int(st.attributes.get("supported_features") or 0)
    if entry is not None and entry.supported_features is not None:
        return int(entry.supported_features)
    return None


def coverage(house: House, options: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """EVERY VACUUM AND WHAT IT REACHES (for the HK Settings page and the area picker):
    [{vacuum, taking_part, how, areas}], `how` being
      map      cleans by area, with a room map (areas: the mapped ones)
      start    cannot clean by area; starts when its own area is chosen
      no_map   can clean by area but has no room map: sits out
      no_area  cannot clean by area and has no area of its own
    An offline robot still counts by its map: its rooms do not vanish from the picker while
    it is charging off the network."""
    chosen = list((options or {}).get(CONF_VACUUMS) or [])
    known = house.area_ids()
    ids = sorted({s.entity_id for s in house.states("vacuum")} |
                 {e.entity_id for e in house.entities("vacuum") if not e.disabled})
    out = []
    for eid in ids:
        entry = house.entity(eid)
        feats = _features(house, eid, entry)
        mapping = _mapping(entry)
        # a room map is only offered for a robot that cleans by area, so one is proof
        # enough -- an offline robot's features may not be known
        if mapping:
            how, found = "map", [a for a in mapping if a in known]
        elif feats is not None and feats & CLEAN_AREA:
            how, found = "no_map", []
        else:
            home = area_of(house, entry)
            how, found = ("start", [home]) if home and home in known else ("no_area", [])
        out.append({"vacuum": eid, "taking_part": not chosen or eid in chosen, "how": how, "areas": found})
    return out


def reachable(house: House, options: Mapping[str, Any] | None) -> list[str]:
    """The areas some vacuum that takes part can clean."""
    out: list[str] = []
    for v in coverage(house, options):
        if v["taking_part"]:
            out.extend(a for a in v["areas"] if a not in out)
    return out


def offered(house: House, options: Mapping[str, Any] | None) -> list[str]:
    """The areas the picker shows: the chosen ones a vacuum still reaches, or (none chosen)
    every area one reaches."""
    can = reachable(house, options)
    chosen = list((options or {}).get(CONF_AREAS) or [])
    return [a for a in chosen if a in can] if chosen else can


async def async_execute(house: House, p: dict[str, Any], dry_run: bool = False,
                        context: Any = None) -> dict[str, Any]:
    """Carry out a plan (from `plan`): one call per robot, in the caller's context."""
    if not p["plan"]:
        return {"ok": False, **p,
                "message": "No vacuum can reach the selected areas. Map each vacuum's rooms "
                           "in its entity settings."}
    if dry_run:
        return {"ok": True, "dry_run": True, **p}
    failed = []
    for step in p["plan"]:
        try:
            if step["action"] == "clean_area":
                await house.call_service("vacuum", "clean_area", {
                    "entity_id": step["vacuum"], "cleaning_area_id": step["areas"]}, context=context)
            else:
                await house.call_service("vacuum", "start", {"entity_id": step["vacuum"]}, context=context)
        except Exception as err:  # noqa: BLE001 -- one robot failing must not stop the rest
            failed.append({"vacuum": step["vacuum"], "error": str(err)})
    if failed:
        return {"ok": False, **p, "failed": failed,
                "message": "Some vacuums did not start: " + ", ".join(f["vacuum"] for f in failed)}
    return {"ok": True, **p}


async def async_clean(house: House, areas: list[str], options: Mapping[str, Any] | None,
                      dry_run: bool = False, context: Any = None) -> dict[str, Any]:
    return await async_execute(house, plan(house, areas, options), dry_run, context)
