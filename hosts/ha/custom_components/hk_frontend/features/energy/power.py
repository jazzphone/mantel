"""THE POWER PAGE'S PLAN (PLAN-2026-10-12-home-power): right now and the
controls -- the whole house, the grid, the sun, the house battery and its own
controls (its mode, its levels, its circuits), and the cars -- beside the
Energy page, which is over time. It is the Energy feature's second page: it
reads the same devices, and its settings are the feature's `power` option.

    build(ctx, options, energy_plan) -> {...} | None    None: the page is off

Everything is Automatic until the options say otherwise:

    home       the whole house's power: the Energy page's own (its Whole Home)
    grid       Home Assistant's grid power sensor, else the whole house's
    solar      the solar sources' power sensors (stat_rate) in Home
               Assistant's Energy settings
    battery    only what the options name (a battery's readings and controls
               differ by maker)
    cars       the cars the Energy page finds (a battery level on a device
               that reports a range), each one's parts found on its own
               device: where it is, its cable, its charger's power, its
               charge switch and limit. `car_opts` (by the car's level) can
               name one and say what reads its charging: a Wall Connector,
               a monitored circuit, or "car", the car's own reading
    backed     each device: on the battery's own device (its power sensor or
               its switch), a switch group of the battery's switches, or
               inside a backed-up circuit -- unless the device's own setting
               says Yes or No
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

# the house picture that ships (frontend/power-house, served at /hk/)
BUILT_IN_ART = "/hk/power-house/"

CONF_POWER = "power"
BACKS_UP = ("some", "all", "none")
GROUPS = ("type", "backup")


def _s(v: Any) -> str | None:
    return v if isinstance(v, str) and v else None


# ---------------------------------------------------------------- readings
def solar_rates(prefs: Mapping[str, Any] | None) -> list[str]:
    """The solar sources' power sensors in Home Assistant's Energy settings."""
    out = []
    for src in (prefs or {}).get("energy_sources") or []:
        if not isinstance(src, dict) or src.get("type") != "solar":
            continue
        rate = src.get("stat_rate") or (src.get("power_config") or {}).get("stat_rate")
        if isinstance(rate, str) and rate not in out:
            out.append(rate)
    return out


# -------------------------------------------------------------------- cars
def car_parts(ctx: Mapping[str, Any], level: str) -> dict[str, Any]:
    """A car's parts, found beside its battery level on its own device."""
    ents = ctx.get("entities") or {}
    dev = (ents.get(level) or {}).get("device")
    mates = {eid: e for eid, e in ents.items() if dev and e.get("device") == dev}

    def pick(pred, prefer=()):
        c = sorted(eid for eid, e in mates.items() if pred(eid, e))
        for p in prefer:
            for eid in c:
                if p in eid:
                    return eid
        return c[0] if c else None

    out = {"level": level,
           "name": re.sub(r"\s+battery( level)?$", "", str((ents.get(level) or {}).get("name") or level), flags=re.I),
           "home": pick(lambda i, e: i.startswith("device_tracker."), ("location",)),
           "power": pick(lambda i, e: i.startswith("sensor.") and (e.get("dc") == "power" or e.get("unit") in ("W", "kW")),
                         ("charger_power", "charging_power")),
           "plugged": pick(lambda i, e: i.startswith("binary_sensor.") and any(w in i for w in ("cable", "plug", "connected"))),
           "charge": pick(lambda i, e: i.startswith("switch.") and re.search(r"_charge$|_charging$", i) is not None),
           "limit": pick(lambda i, e: i.startswith("number.") and "limit" in i and "current" not in i),
           "range": (ents.get(level) or {}).get("range")}
    return {k: v for k, v in out.items() if v}


# ------------------------------------------------------------------ backed
def battery_device(ctx: Mapping[str, Any], battery: Mapping[str, Any]) -> str | None:
    ents = ctx.get("entities") or {}
    for k in ("level", "charge", "discharge", "backed_power"):
        dev = (ents.get(battery.get(k) or "") or {}).get("device")
        if dev:
            return dev
    return None


def is_backed(ctx: Mapping[str, Any], dev: Mapping[str, Any], bat_dev: str | None) -> tuple[bool, str]:
    """(backed up, why) for one device, before its parent is considered."""
    ents = ctx.get("entities") or {}
    if not bat_dev:
        return False, ""
    for k, what in (("power", "its power sensor"), ("control", "its switch")):
        e = ents.get(dev.get(k) or "") or {}
        if e.get("device") == bat_dev:
            return True, what + " is on the battery's device"
    members = (ents.get(dev.get("control") or "") or {}).get("members") or []
    if members and all((ents.get(m) or {}).get("device") == bat_dev for m in members):
        return True, "its switch is %d of the battery's circuits" % len(members) if len(members) > 1 else \
            "its switch is one of the battery's circuits"
    return False, ""


# ------------------------------------------------------------------- build
def build(ctx: Mapping[str, Any], options: Mapping[str, Any], energy: Mapping[str, Any]) -> dict[str, Any] | None:
    """The Power page, or None while it is off."""
    o = (options or {}).get(CONF_POWER)
    if not isinstance(o, dict) or o.get("on") is False:
        return None
    prefs = ctx.get("prefs") or {}
    total = energy.get("total") or {}
    from .plan import grid_of   # the same reading of the grid as the Energy page
    grid = grid_of(prefs)
    home = _s(o.get("home")) or total.get("power")
    battery = {k: v for k, v in dict(o.get("battery") or {}).items() if v not in (None, "", [])}
    bat_dev = battery_device(ctx, {**battery, "backed_power": o.get("backed_power")})
    backs_up = o.get("backs_up") if o.get("backs_up") in BACKS_UP else ("some" if bat_dev else "none")

    # every device the Energy page has, each said backed up or not
    overrides = o.get("backed") or {}
    info = (energy.get("devices") or {})
    by_key = {}
    for rec in info.values():
        by_key.setdefault(rec["key"], rec)
    why: dict[str, tuple[bool, str]] = {}

    def backed(key: str, seen=()) -> tuple[bool, str]:
        if key in why:
            return why[key]
        if key in overrides and isinstance(overrides[key], bool):
            why[key] = (overrides[key], "chosen")
            return why[key]
        if backs_up == "all":
            why[key] = (True, "the battery backs up the whole house")
            return why[key]
        if backs_up == "none":
            why[key] = (False, "")
            return why[key]
        rec = by_key.get(key) or {}
        got = is_backed(ctx, rec, bat_dev)
        if not got[0] and rec.get("parent") and rec["parent"] not in seen:
            up = backed(rec["parent"], seen + (key,))
            if up[0]:
                got = (True, "it is inside " + str((by_key.get(rec["parent"]) or {}).get("name") or "a backed-up circuit"))
        why[key] = got
        return got

    sections = []
    for s in energy.get("sections") or []:
        items = []
        for it in s.get("items") or []:
            if it.get("kind") != "device":
                continue
            b, w = backed(it["key"])
            rec = by_key.get(it["key"]) or {}
            items.append({**it, "backed": b, "why": w, "parent": rec.get("parent")})
        if items:
            sections.append({"id": s["id"], "name": s["name"], "color": s.get("color"), "items": items})

    # the cars: the options' own, or every car the Energy page found
    chosen = o.get("cars")
    if isinstance(chosen, list):
        cars = [dict(c) for c in chosen if isinstance(c, dict) and c.get("level")]
    else:
        cars = [car_parts(ctx, lvl) for lvl in ctx.get("vehicles") or []]
    # each car's own settings: its name, and what reads its charging
    for car in cars:
        co = (o.get("car_opts") or {}).get(car["level"]) or {}
        car["found_name"] = car.get("name") or car["level"]
        if co.get("name"):
            car["name"] = co["name"]
        if co.get("charger") == "car":
            if car.get("power"):
                car["charger"] = car["power"]
        elif co.get("charger"):
            car["charger"] = co["charger"]

    mode = o.get("mode") if isinstance(o.get("mode"), dict) and _s((o.get("mode") or {}).get("entity")) else None
    levels = [dict(x) for x in o.get("levels") or [] if isinstance(x, dict) and _s(x.get("entity"))]
    return {
        "title": str(o.get("title") or "Power")[:40],
        "path": str(o.get("path") or "power"),
        # THE HOUSE PICTURE (2026-10-14: one ships, frontend/power-house -- a
        # made-up house, the owner's call): a picture folder of one's own
        # (art.json and its layers, in your files) takes its place; "chart"
        # is the flow chart instead
        "art": str(o.get("art") or BUILT_IN_ART),
        "picture": o.get("picture") != "chart",
        "home": home,
        "grid": _s(o.get("grid")) or grid.get("rate") or home,
        "grid_export": _s(o.get("grid_export")),
        "grid_status": _s(o.get("grid_status")),
        "solar": _s(o.get("solar")) or (solar_rates(prefs) or [None])[0],
        "backed_power": _s(o.get("backed_power")),
        "battery": battery or None,
        "backs_up": backs_up,
        "mode": mode,
        "levels": levels,
        "status": [dict(x) for x in o.get("status") or [] if isinstance(x, dict) and _s(x.get("entity"))],
        "cars": cars,
        "groups": o.get("groups") if o.get("groups") in GROUPS else "type",
        "sections": sections,
    }


# ------------------------------------------------------------------ settle
_ENT = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def _ent(v: Any) -> bool:
    return isinstance(v, str) and bool(_ENT.match(v))


def check(v: Any) -> dict[str, Any] | None:
    """The `power` option, cleaned; None when it is not one."""
    if not isinstance(v, dict):
        return None
    out: dict[str, Any] = {}
    for k in ("home", "grid", "grid_export", "grid_status", "solar", "backed_power"):
        if v.get(k) in (None, ""):
            continue
        if not _ent(v[k]):
            return None
        out[k] = v[k]
    for k in ("title",):
        if v.get(k) not in (None, ""):
            if not isinstance(v[k], str) or len(v[k].strip()) > 40:
                return None
            out[k] = v[k].strip()
    if v.get("path") not in (None, ""):
        if not isinstance(v["path"], str) or not re.match(r"^[a-z0-9-]{1,40}$", v["path"]):
            return None
        out["path"] = v["path"]
    if v.get("art") not in (None, ""):
        if not isinstance(v["art"], str) or not v["art"].startswith("/"):
            return None
        out["art"] = v["art"]
    for k, allowed in (("backs_up", BACKS_UP), ("groups", GROUPS), ("picture", ("house", "chart"))):
        if v.get(k) not in (None, ""):
            if v[k] not in allowed:
                return None
            out[k] = v[k]
    if "on" in v:
        if not isinstance(v["on"], bool):
            return None
        out["on"] = v["on"]
    if v.get("battery") is not None:
        b = v["battery"]
        if not isinstance(b, dict):
            return None
        bat = {}
        for k, x in b.items():
            if k == "packs":
                if not isinstance(x, list) or not all(isinstance(p, dict) and _ent(p.get("level")) for p in x):
                    return None
                bat[k] = [{f: p[f] for f in ("name", "level", "temperature") if p.get(f)} for p in x]
            elif x in (None, ""):
                continue
            elif not _ent(x):
                return None
            else:
                bat[k] = x
        if bat:
            out["battery"] = bat
    if v.get("mode") is not None:
        m = v["mode"]
        if not isinstance(m, dict) or not _ent(m.get("entity")):
            return None
        opts = m.get("options")
        if opts is not None and not (isinstance(opts, list) and all(isinstance(x, dict) and isinstance(x.get("value"), str) for x in opts)):
            return None
        out["mode"] = {"entity": m["entity"], **({"options": [{f: x[f] for f in ("value", "name", "description") if x.get(f)} for x in opts]} if opts else {})}
    for k, fields in (("levels", ("entity", "name", "icon", "color")), ("status", ("entity", "kind")),
                      ("cars", ("name", "level", "power", "home", "plugged", "charge", "limit", "range"))):
        if v.get(k) is None:
            continue
        if not isinstance(v[k], list):
            return None
        rows = []
        for x in v[k]:
            if not isinstance(x, dict):
                return None
            row = {f: x[f] for f in fields if x.get(f)}
            if any(f != "name" and f not in ("icon", "color", "kind") and not _ent(row[f]) for f in row):
                return None
            if not row.get("entity" if k != "cars" else "level"):
                return None
            rows.append(row)
        out[k] = rows
    if v.get("car_opts") is not None:
        co = v["car_opts"]
        if not isinstance(co, dict) or not all(_ent(k) and isinstance(x, dict) for k, x in co.items()):
            return None
        cars: dict[str, Any] = {}
        for k, x in co.items():
            row = {}
            if x.get("name") not in (None, ""):
                if not isinstance(x["name"], str) or len(x["name"].strip()) > 40:
                    return None
                row["name"] = x["name"].strip()
            if x.get("charger") not in (None, ""):
                if x["charger"] != "car" and not _ent(x["charger"]):
                    return None
                row["charger"] = x["charger"]
            if row:
                cars[k] = row
        if cars:
            out["car_opts"] = cars
    if v.get("backed") is not None:
        if not isinstance(v["backed"], dict) or not all(isinstance(x, bool) for x in v["backed"].values()):
            return None
        out["backed"] = dict(v["backed"])
    return out
