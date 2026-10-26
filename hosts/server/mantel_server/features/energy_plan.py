"""The Energy page's inputs on Mantel: ``energy_context`` (HA's Energy settings and the house, in the shape
``hk_core.energy.plan.build`` takes), ``found_thermostats`` and ``energy_house``."""
from __future__ import annotations

from typing import Any, Mapping

from hk_core.energy import plan as EP
from hk_core.energy.const import CONF_BATTERIES, CONF_DEVICES, CONF_EXTRA, CONF_TOP, CONF_TOTAL, CONF_USAGES


# ------------------------------------------------------------------------------------- energy
def energy_context(house: Any, prefs: Mapping[str, Any] | None, options: Mapping[str, Any] | None,
                   settings: Mapping[str, Any] | None = None,
                   sources: Mapping[str, str] | None = None) -> dict[str, Any]:
    """What ``hk_core.energy.plan.build`` reads, from Mantel's house (HA's ``collect`` over the port).
    A helper's source (a Utility Meter's Integral, and its power sensor): `sources`, HK's read in HA
    (``hk_energy/sources``: HA's own collect() reads the sensors' objects, which Utility Meters need -- they
    publish no `source` attribute), else the state's `source` attribute (an Integral sensor has one)."""
    options = dict(options or {})
    settings = dict(settings or {})
    entities: dict[str, dict[str, Any]] = {}

    def info(eid: Any) -> dict[str, Any] | None:
        if not isinstance(eid, str) or "." not in eid:
            return None
        if eid in entities:
            return entities[eid]
        st, ent = house.state(eid), house.entity(eid)
        attrs = st.attributes if st else {}
        # A HELPER'S SOURCE: a Utility Meter and an Integral (Riemann sum) sensor say what they count in
        # their `source` attribute; HA's collect() reads it from the sensor's own object. Without it the
        # chain meter -> Integral -> power sensor was never followed here, every device lost its watts and
        # the Energy page's "Where it's going now" drew 0 W everywhere (the house, 2026-10-18).
        src = (sources or {}).get(eid) or (attrs.get("source") if eid.startswith("sensor.") else None)
        entities[eid] = {"name": attrs.get("friendly_name") or eid, "device": ent.device_id if ent else None,
                         "dc": attrs.get("device_class") or (ent and (ent.device_class or ent.original_device_class)),
                         "unit": attrs.get("unit_of_measurement"), "state": st.state if st else None,
                         "source": src if isinstance(src, str) and "." in src else None,
                         "category": bool(ent and ent.entity_category), "platform": ent.platform if ent else None}
        return entities[eid]

    def device_mates(eid: str, domains=("sensor", "switch")) -> None:
        e = info(eid)
        if e and e.get("device"):
            for x in house.device_entities(e["device"]):
                if x.entity_id.split(".")[0] in domains and not x.disabled:
                    info(x.entity_id)

    stats: list[str] = []
    for src in (prefs or {}).get("energy_sources") or []:
        stats += [src[k] for k in ("stat_energy_from", "stat_cost", "stat_rate", "stat_soc", "entity_energy_price")
                  if isinstance(src.get(k), str)]
        for f in src.get("flow_from") or []:
            stats += [f[k] for k in ("stat_energy_from", "stat_cost", "entity_energy_price") if isinstance(f.get(k), str)]
    for d in (prefs or {}).get("device_consumption") or []:
        stats += [d[k] for k in ("stat_consumption", "stat_rate", "included_in_stat") if isinstance(d.get(k), str)]
    for x in options.get(CONF_EXTRA) or []:
        stats += [x[k] for k in ("stat", "power") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in (options.get(CONF_DEVICES) or {}).values():
        stats += [x[k] for k in ("power", "control") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in options.get(CONF_USAGES) or []:
        stats += [x[k] for k in ("entity", "stat") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in options.get(CONF_BATTERIES) or []:
        stats += [x[k] for k in ("entity", "label") if isinstance(x, dict) and isinstance(x.get(k), str)]
    stats += [v for v in (options.get(CONF_TOTAL) or {}).values() if isinstance(v, str) and v]
    stats += [v for v in (options.get(CONF_TOP) or []) if isinstance(v, str)]
    stats += [t for t in settings.get("thermostats") or [] if isinstance(t, str)]
    stats += [settings[k] for k in ("outside", "power") if isinstance(settings.get(k), str)]
    for s in stats:
        e = info(s)
        device_mates(s)
        # the source chain, followed now so build() can walk it (as HA's collect does): each sensor in it,
        # and what sits on its device (a smart plug's watts beside the kWh a Utility Meter counts)
        hops = 0
        while e and e.get("source") and hops < 4:
            device_mates(e["source"])
            e = info(e["source"])
            hops += 1
    grid = EP.grid_of(prefs)
    if grid.get("stat") and house.state(f"{grid['stat']}_cost") is not None:
        info(f"{grid['stat']}_cost")
    vehicles: list[str] = []
    for st in house.states("sensor"):
        if st.attributes.get("device_class") != "battery":
            continue
        ent = house.entity(st.entity_id)
        if not ent or not ent.device_id or ent.entity_category or ent.hidden or ent.disabled:
            continue
        rng = [x.entity_id for x in house.device_entities(ent.device_id)
               if x.entity_id.startswith("sensor.") and "range" in x.entity_id and not x.disabled
               and house.state(x.entity_id) is not None
               and house.state(x.entity_id).attributes.get("device_class") == "distance"]
        if rng:
            vehicles.append(st.entity_id)
            info(st.entity_id)["range"] = sorted(rng, key=len)[0]
            info(sorted(rng, key=len)[0])
    for eid in [e for e in list(entities) if e.startswith("switch.")]:
        st = house.state(eid)
        mem = st.attributes.get("entity_id") if st else None
        if isinstance(mem, (list, tuple)) and mem:
            entities[eid]["members"] = [m for m in mem if isinstance(m, str)]
            for m in entities[eid]["members"]:
                info(m)
    soc = EP.battery_of(prefs).get("soc")
    if soc and info(soc) and info(soc).get("device"):
        for x in house.device_entities(info(soc)["device"]):
            st = house.state(x.entity_id)
            if st and st.attributes.get("device_class") == "energy_storage":
                info(soc)["stored"] = x.entity_id
                info(x.entity_id)
                break
    areas = {a: {"name": house.area_name(a), "icon": None} for a in sorted(house.area_ids())}
    return {"prefs": dict(prefs or {}), "entities": entities, "areas": areas,
            "thermostats": [t for t in settings.get("thermostats") or [] if isinstance(t, str)],
            "outside": settings.get("outside") or None, "house_power": settings.get("power") or None,
            "vehicles": sorted(vehicles)}


def found_thermostats(house: Any, settings: Mapping[str, Any]) -> list[str]:
    """Status & Chips' thermostats as HA's kinds.resolve finds them (hk_frontend/kinds.py), for the
    Energy page's plan: every climate entity, less hidden, disabled, config/diagnostic ones and groups,
    less Leave out (``generated``: entities, devices, areas); then a saved ``counts.thermostats``
    (exclude / include), else the older ``features.thermostats`` list; then an accessory whose
    "Include in status" is off is taken out."""
    from hk_core.house import area_of
    from hk_core.settings.kinds import clean
    states = {s.entity_id: s for s in house.states("climate")}
    lo = settings.get("generated") if isinstance(settings.get("generated"), Mapping) else {}
    x_ent, x_dev, x_area = (set(lo.get(k) or []) for k in ("exclude_entities", "exclude_devices", "exclude_areas"))
    auto = []
    for eid, st in sorted(states.items()):
        ent = house.entity(eid)
        if ent is not None and (ent.hidden or ent.disabled or ent.entity_category):
            continue
        if any(isinstance(st.attributes.get(k), list) for k in ("entity_id", "group_entities")):
            continue
        area = area_of(house, ent)
        if eid in x_ent or (ent and ent.device_id in x_dev) or (area and area in x_area):
            continue
        auto.append(eid)
    saved = clean((settings.get("counts") or {}).get("thermostats") if isinstance(settings.get("counts"), Mapping) else None)
    if saved is None:
        old = (settings.get("features") or {}).get("thermostats") if isinstance(settings.get("features"), Mapping) else None
        old = [e for e in old if isinstance(e, str)] if isinstance(old, list) else []
        out = [e for e in old if e in states] if old else auto
    else:
        drop = set(saved["exclude"])
        out = [e for e in auto if e not in drop]
        out += sorted(e for e in saved["include"] if e in states and e not in out and e not in drop)
    acc = ((settings.get("accessories") or {}).get("entities") or {}) if isinstance(settings.get("accessories"), Mapping) else {}
    return [e for e in out if not (isinstance(acc.get(e), Mapping) and acc[e].get("status") is False)]


def energy_house(house: Any, settings: Mapping[str, Any]) -> dict[str, Any]:
    """What HA's plan borrows from the house's settings (features/energy house()): Status & Chips'
    thermostats, the outside temperature and Power Use."""
    feats = settings.get("features") if isinstance(settings.get("features"), Mapping) else {}
    weather = settings.get("weather") if isinstance(settings.get("weather"), Mapping) else {}
    return {"thermostats": found_thermostats(house, settings), "outside": weather.get("outside"),
            "power": feats.get("power")}
