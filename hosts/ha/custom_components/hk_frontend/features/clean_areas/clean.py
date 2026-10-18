"""CLEAN THESE AREAS -- one action, every vacuum, Home Assistant's own mapping.

`hk_frontend.clean_areas` takes area ids (what the vacuum area picker sends,
or an automation, or a voice sentence) and works out which robot cleans what,
from Home Assistant itself:

  * a vacuum with CLEAN_AREA and a room mapping (entity settings -> the map
    of HA areas to the robot's own rooms, stored in the entity registry as
    options.vacuum.area_mapping) gets `vacuum.clean_area` with the selected
    areas it covers -- one call per robot, all of its rooms at once;
  * a vacuum with CLEAN_AREA but NO mapping is skipped: it cannot be told
    where to go (typically a second integration's entity for the same robot);
  * a vacuum without CLEAN_AREA starts when its OWN area is selected -- a robot
    that cannot leave one room cleans that room by starting.

Which vacuums take part: Configure (default: all).
`dry_run: true` answers with the plan and sends nothing -- how to check the
plan without moving a robot.

No room lists are kept here: every answer is worked out from the registries.
The answer is {ok, plan: [{vacuum, action, areas}], unreachable: [areas]}.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import CONF_AREAS, CONF_VACUUMS

CLEAN_AREA = 16384          # VacuumEntityFeature.CLEAN_AREA


def _area_of(hass: HomeAssistant, entry: er.RegistryEntry | None) -> str | None:
    if entry is None:
        return None
    if entry.area_id:
        return entry.area_id
    if entry.device_id:
        dev = dr.async_get(hass).async_get(entry.device_id)
        return dev.area_id if dev else None
    return None


def plan(hass: HomeAssistant, areas: list[str], options: Mapping[str, Any] | None) -> dict[str, Any]:
    """Who cleans what, for these areas. Pure: reads state and registries."""
    chosen = list((options or {}).get(CONF_VACUUMS) or [])
    ids = chosen or sorted(s.entity_id for s in hass.states.async_all("vacuum"))
    reg = er.async_get(hass)
    wanted = list(dict.fromkeys(a for a in areas if a))
    covered: set[str] = set()
    out = []
    for eid in ids:
        st = hass.states.get(eid)
        if st is None or st.state in ("unavailable", "unknown"):
            continue
        entry = reg.async_get(eid)
        features = int(st.attributes.get("supported_features") or 0)
        if features & CLEAN_AREA:
            mapping = ((entry.options if entry else {}) or {}).get("vacuum", {}).get("area_mapping")
            if not mapping:
                continue
            mine = [a for a in wanted if a in mapping]
            if mine:
                out.append({"vacuum": eid, "action": "clean_area", "areas": mine})
                covered.update(mine)
        else:
            home = _area_of(hass, entry)
            if home and home in wanted:
                out.append({"vacuum": eid, "action": "start", "areas": [home]})
                covered.add(home)
    return {"plan": out, "unreachable": [a for a in wanted if a not in covered]}


def _features(hass: HomeAssistant, eid: str, entry: er.RegistryEntry | None) -> int | None:
    """What the robot can do: its state's, or -- offline, when a state has no
    attributes -- what the entity registry last recorded."""
    st = hass.states.get(eid)
    if st is not None and st.state not in ("unavailable", "unknown"):
        return int(st.attributes.get("supported_features") or 0)
    if entry is not None and entry.supported_features is not None:
        return int(entry.supported_features)
    return None


def coverage(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """EVERY VACUUM AND WHAT IT REACHES (for the HK Settings page and the
    area picker): [{vacuum, taking_part, how, areas}], `how` being
      map      cleans by area, with a room map (areas: the mapped ones)
      start    cannot clean by area; starts when its own area is chosen
      no_map   can clean by area but has no room map: sits out
      no_area  cannot clean by area and has no area of its own
    An offline robot still counts by its map: its rooms do not vanish from
    the picker while it is charging off the network."""
    chosen = list((options or {}).get(CONF_VACUUMS) or [])
    reg = er.async_get(hass)
    known = set(ar.async_get(hass).areas)
    ids = sorted({s.entity_id for s in hass.states.async_all("vacuum")} |
                 {e.entity_id for e in reg.entities.values() if e.domain == "vacuum" and not e.disabled_by})
    out = []
    for eid in ids:
        entry = reg.async_get(eid)
        feats = _features(hass, eid, entry)
        mapping = ((entry.options if entry else {}) or {}).get("vacuum", {}).get("area_mapping") or {}
        # a room map is only offered for a robot that cleans by area, so one
        # is proof enough -- an offline robot's features may not be known
        if mapping:
            how, areas = "map", [a for a in mapping if a in known]
        elif feats is not None and feats & CLEAN_AREA:
            how, areas = "no_map", []
        else:
            home = _area_of(hass, entry)
            how, areas = ("start", [home]) if home and home in known else ("no_area", [])
        out.append({"vacuum": eid, "taking_part": not chosen or eid in chosen, "how": how, "areas": areas})
    return out


def reachable(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[str]:
    """The areas some vacuum that takes part can clean."""
    out: list[str] = []
    for v in coverage(hass, options):
        if v["taking_part"]:
            out.extend(a for a in v["areas"] if a not in out)
    return out


def offered(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[str]:
    """The areas the picker shows: the chosen ones a vacuum still reaches, or
    (none chosen) every area one reaches."""
    can = reachable(hass, options)
    chosen = list((options or {}).get(CONF_AREAS) or [])
    return [a for a in chosen if a in can] if chosen else can


async def async_clean(hass: HomeAssistant, areas: list[str], options: Mapping[str, Any] | None,
                      dry_run: bool = False, context: Context | None = None) -> dict[str, Any]:
    p = plan(hass, areas, options)
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
                await hass.services.async_call("vacuum", "clean_area", {
                    "entity_id": step["vacuum"], "cleaning_area_id": step["areas"]},
                    blocking=True, context=context)
            else:
                await hass.services.async_call("vacuum", "start", {"entity_id": step["vacuum"]},
                                               blocking=True, context=context)
        except Exception as err:  # noqa: BLE001 -- one robot failing must not stop the rest
            failed.append({"vacuum": step["vacuum"], "error": str(err)})
    if failed:
        return {"ok": False, **p, "failed": failed,
                "message": "Some vacuums did not start: " + ", ".join(f["vacuum"] for f in failed)}
    return {"ok": True, **p}
