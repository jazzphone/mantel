"""THE ENERGY PAGE inside Home Assistant: the plan itself is shared (hk_core/energy/plan.py);
`collect` -- what the house has, read from HA's state machine, registries and the sensor
component -- is HA's side and lives here."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...hk_core.energy.plan import *  # noqa: F401,F403
from ...hk_core.energy.plan import grid_of  # noqa: F401 -- used by collect
from .const import *  # noqa: F401,F403


# ----------------------------------------------------------------- sources
def source_of(comp: Any, eid: str) -> str | None:
    """The entity a helper sensor counts or integrates (a Utility Meter's source sensor, an Integral's
    power sensor), from the sensor's own object: HA keeps it in a private field no state shows."""
    if comp is None or not eid.startswith("sensor."):
        return None
    obj = comp.get_entity(eid)
    src = getattr(obj, "_sensor_source_id", None) or getattr(obj, "_source_entity", None)
    return src if isinstance(src, str) and "." in src else None


def sources(hass: Any) -> dict[str, str]:
    """{sensor: its source} for every sensor that has one -- what collect() reads of the sensors it looks
    at, for a host that cannot read the objects (Mantel; hk_energy/sources). Read only."""
    try:
        from homeassistant.components.sensor import DATA_COMPONENT
        comp = hass.data.get(DATA_COMPONENT)
    except ImportError:          # pragma: no cover -- every supported release has it
        return {}
    out: dict[str, str] = {}
    for eid in hass.states.async_entity_ids("sensor"):
        src = source_of(comp, eid)
        if src:
            out[eid] = src
    return out


# ----------------------------------------------------------------- collect
def collect(hass: Any, prefs: Mapping[str, Any] | None, options: Mapping[str, Any] | None,
            house: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """What build() reads, from the running house. `house`: {thermostats,
    outside, power} -- the house's Status & Chips thermostats and its
    outside-temperature and Power Use settings."""
    from homeassistant.helpers import area_registry as ar
    from homeassistant.helpers import entity_registry as er

    options = dict(options or {})
    house = dict(house or {})
    ereg = er.async_get(hass)
    try:
        from homeassistant.components.sensor import DATA_COMPONENT
        comp = hass.data.get(DATA_COMPONENT)
    except ImportError:          # pragma: no cover -- every supported release has it
        comp = None
    entities: dict[str, dict[str, Any]] = {}

    def info(eid: str | None) -> dict[str, Any] | None:
        if not eid or not isinstance(eid, str) or "." not in eid:
            return None
        if eid in entities:
            return entities[eid]
        st = hass.states.get(eid)
        ent = ereg.async_get(eid)
        attrs = st.attributes if st else {}
        src = source_of(comp, eid)
        entities[eid] = {
            "name": attrs.get("friendly_name") or (ent and (ent.name or ent.original_name)) or eid,
            "device": ent.device_id if ent else None, "dc": attrs.get("device_class") or (
                ent and (ent.device_class or ent.original_device_class)),
            "unit": attrs.get("unit_of_measurement"), "state": st.state if st else None,
            "source": src if isinstance(src, str) else None,
            "category": bool(ent and ent.entity_category), "platform": ent.platform if ent else None}
        return entities[eid]

    def device_mates(eid: str) -> None:
        e = info(eid)
        dev = e and e.get("device")
        if not dev:
            return
        for x in er.async_entries_for_device(ereg, dev):
            if x.entity_id.split(".")[0] in ("sensor", "switch"):
                info(x.entity_id)

    stats: list[str] = []
    for src in (prefs or {}).get("energy_sources") or []:
        for k in ("stat_energy_from", "stat_cost", "stat_rate", "stat_soc", "entity_energy_price"):
            if isinstance(src.get(k), str):
                stats.append(src[k])
        for f in src.get("flow_from") or []:
            stats += [f[k] for k in ("stat_energy_from", "stat_cost", "entity_energy_price") if isinstance(f.get(k), str)]
    for d in (prefs or {}).get("device_consumption") or []:
        stats += [d[k] for k in ("stat_consumption", "stat_rate", "included_in_stat") if isinstance(d.get(k), str)]
    for x in options.get(CONF_EXTRA) or []:
        stats += [x[k] for k in ("stat", "power") if isinstance(x.get(k), str)]
    for x in (options.get(CONF_DEVICES) or {}).values():
        stats += [x[k] for k in ("power", "control") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in options.get(CONF_USAGES) or []:
        if isinstance(x, dict):
            stats += [x[k] for k in ("entity", "stat") if isinstance(x.get(k), str)]
    for x in options.get(CONF_BATTERIES) or []:
        if isinstance(x, dict):
            stats += [x[k] for k in ("entity", "label") if isinstance(x.get(k), str)]
    tot = options.get(CONF_TOTAL) or {}
    stats += [v for v in tot.values() if isinstance(v, str) and v]
    # THE POWER PAGE'S OWN READINGS, and each car's parts on its device
    pwr = options.get("power") if isinstance(options.get("power"), dict) else {}
    for k in ("home", "grid", "grid_export", "grid_status", "solar", "backed_power"):
        if isinstance(pwr.get(k), str):
            stats.append(pwr[k])
    for k, x in (pwr.get("battery") or {}).items():
        if isinstance(x, str):
            stats.append(x)
    stats += [v for v in (options.get(CONF_TOP) or []) if isinstance(v, str)]
    stats += list(house.get("thermostats") or []) + [house.get("outside"), house.get("power")]
    for s in stats:
        e = info(s)
        # the source chain, followed now so build() can walk it
        cur, hops = e, 0
        device_mates(s)
        while cur and cur.get("source") and hops < 4:
            # each sensor in the chain, and what sits on its device (a smart
            # plug's watts beside the kWh a Utility Meter counts)
            device_mates(cur["source"])
            cur = info(cur["source"])
            hops += 1
    grid = grid_of(prefs)
    if grid.get("stat"):
        info(f"{grid['stat']}_cost")
        if not hass.states.get(f"{grid['stat']}_cost"):
            entities.pop(f"{grid['stat']}_cost", None)

    # THE CARS: a battery level on a device that also reports a range
    vehicles: list[str] = []
    for st in hass.states.async_all("sensor"):
        if st.attributes.get("device_class") != "battery":
            continue
        ent = ereg.async_get(st.entity_id)
        if not ent or not ent.device_id or ent.entity_category or ent.hidden_by or ent.disabled_by:
            continue
        rng = [x.entity_id for x in er.async_entries_for_device(ereg, ent.device_id)
               if x.entity_id.startswith("sensor.") and "range" in x.entity_id and not x.disabled_by
               and (hass.states.get(x.entity_id) and
                    hass.states.get(x.entity_id).attributes.get("device_class") == "distance")]
        if rng:
            vehicles.append(st.entity_id)
            info(st.entity_id)["range"] = sorted(rng, key=len)[0]
            info(sorted(rng, key=len)[0])
    # THE POWER PAGE: a car's parts sit on its own device; a switch group's
    # members tell whether a device's switch is the battery's own circuits
    if pwr:
        for lvl in vehicles + [c.get("level") for c in pwr.get("cars") or [] if isinstance(c, dict)]:
            e = info(lvl)
            if e and e.get("device"):
                for x in er.async_entries_for_device(ereg, e["device"]):
                    if x.entity_id.split(".")[0] in ("sensor", "switch", "binary_sensor", "device_tracker", "number") \
                            and not x.disabled_by:
                        info(x.entity_id)
        for eid in [e for e in list(entities) if e.startswith("switch.")]:
            st = hass.states.get(eid)
            mem = st.attributes.get("entity_id") if st else None
            if isinstance(mem, (list, tuple)) and mem:
                entities[eid]["members"] = [m for m in mem if isinstance(m, str)]
                for m in entities[eid]["members"]:
                    info(m)
    # a house battery's stored energy, beside its level
    soc = battery_of(prefs).get("soc")
    if soc and info(soc) and info(soc).get("device"):
        for x in er.async_entries_for_device(ereg, info(soc)["device"]):
            st = hass.states.get(x.entity_id)
            if st and st.attributes.get("device_class") == "energy_storage":
                info(soc)["stored"] = x.entity_id
                info(x.entity_id)
                break

    areas = {a.id: {"name": a.name, "icon": a.icon} for a in ar.async_get(hass).areas.values()}
    return {"prefs": dict(prefs or {}), "entities": entities, "areas": areas,
            "thermostats": [t for t in house.get("thermostats") or [] if isinstance(t, str)],
            "outside": house.get("outside") or None, "house_power": house.get("power") or None,
            "vehicles": sorted(vehicles)}
