"""THE ENERGY PAGE'S PLAN: what the page shows, worked out from Home
Assistant's own Energy settings and the feature's options.

Two halves, so the rules can be tested without a house:

    collect(hass, prefs, options) -> ctx    what the house has: the Energy
                                            settings, and for each entity the
                                            plan may name, its name, device,
                                            area, unit and source
    build(ctx, options)           -> plan   the page: the whole home, the
                                            readings row, the daily bars, the
                                            sections and their tiles

WHAT HOME ASSISTANT ALREADY KNOWS (Settings -> Dashboards -> Energy): the
grid meter (kWh) and its price, every device's meter, which device sits inside
which (`included_in_stat`), and -- since 2025.12 -- each device's power sensor
(`stat_rate`). The page needs a LIVE reading for each tile, and most houses
leave `stat_rate` empty, so a device's power sensor is found, in order:

    1. the feature's own choice for it (options.devices[key].power)
    2. Home Assistant's `stat_rate`
    3. the meter's source, followed: a Utility Meter counts an Integral
       (Riemann sum) sensor, which integrates a power sensor -- the source
       each helper was given, read from the helper itself
    4. a power sensor on the meter's own device (a smart plug's W beside its kWh)

and with none, the tile shows today's kWh instead of watts.

WHAT IT DOES NOT KNOW, and is guessed until the options say otherwise: which
SECTION a device belongs in (Heating & Cooling, Rooms, Appliances, Outlets,
Charging), its short NAME ("Office", not "Office Utility"), its GLYPH and
COLOR.

A device's KEY is its meter's statistic id; a device of the feature's own
(options.extra) has a key of its own; a battery's is its entity id.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .const import (CONF_PAGE, CONF_BATTERIES, CONF_COST, CONF_DETAIL, CONF_DEVICES, CONF_EXTRA, CONF_FOLLOW,
                    CONF_SECTIONS, CONF_TITLE, CONF_TOP, CONF_TOTAL, CONF_USAGES, COLORS, SECTIONS,
                    TOP_MAX, USAGES_MAX)

# ------------------------------------------------------------------ names
_SUFFIX = re.compile(r"\s+(utility|energy|consumption|kwh|meter|daily|monthly|total|power|usage|circuit|live|charging)$",
                     re.I)
_APOS = str.maketrans({"’": "'", "‘": "'", "`": "'"})


def short_name(name: str) -> str:
    """"Office Utility" -> "Office"; "Emma's Room Utility" -> "Emma's
    Room". Never empty: a name that is all suffix stays as it was."""
    n = str(name or "").strip()
    while True:
        m = _SUFFIX.search(n)
        if not m or m.start() == 0:
            return n
        n = n[:m.start()].strip()


def _fold(v: str) -> str:
    return re.sub(r"[^a-z0-9']+", " ", str(v or "").translate(_APOS).lower()).strip()


# ------------------------------------------------------------- the guesses
_HVAC = re.compile(r"\b(ac|a ?c|air ?con\w*|air handler|hvac|heat ?pump|furnace|mini ?split|condenser|"
                   r"compressor|heater core|boiler room)\b")
_CHARGING = re.compile(r"(charg|wall connector|\bev\b|evse|wallbox|vehicle|\bcar\b)")
_OUTLETS = re.compile(r"(outlet|\bplug|socket|receptacle|power strip)")
_ROOMISH = re.compile(r"\b(room|bedroom|kitchen|office|garage|basement|attic|loft|bath\w*|den|study|nursery|"
                      r"hall\w*|living|dining|foyer|patio|porch|deck|shed|workshop)\b")


def guess_section(name: str, areas: list[str]) -> str:
    """Which section a device's short name puts it in."""
    f = _fold(name)
    if _HVAC.search(f):
        return "hvac"
    if _CHARGING.search(f):
        return "charging"
    if _OUTLETS.search(f):
        return "outlets"
    names = {_fold(a) for a in areas}
    parts = [p.strip() for p in re.split(r"\s*(?:&|\band\b|\+|,|/)\s*", f) if p.strip()]
    if parts and all(p in names for p in parts):
        return "rooms"
    if parts and all(_ROOMISH.search(p) and len(p.split()) <= 3 for p in parts) and not _appliance(f):
        return "rooms"
    return "appliances"


_GLYPHS = (
    (r"fridge|refrigerator|freezer", "hk:fridge-outline"), (r"water heater|boiler", "hk:water-boiler"),
    (r"dishwasher", "hk:dishwasher"), (r"laundry|washer|washing", "hk:washing-machine"), (r"dryer", "hk:tumble-dryer"),
    (r"microwave", "hk:microwave"), (r"oven|stove|\brange\b|cooktop", "hk:stove"),
    (r"coffee|espresso", "hk:coffee-maker-outline"), (r"kettle", "hk:kettle"), (r"toaster", "hk:toaster"),
    (r"server|network|\brack\b|router", "hk:server-network"), (r"dehumidifier|humidifier", "hk:air-humidifier"),
    (r"air handler|blower|\bfan\b", "hk:fan"), (r"heat ?pump|furnace|heater", "hk:heat-pump-outline"),
    (r"\ba ?c\b|air ?con|condenser|compressor|mini ?split|hvac", "hk:air-conditioner"),
    (r"pool|spa\b|hot tub", "hk:pool"), (r"pump", "hk:pump"),
    (r"computer|\bpc\b|desk|office", "hk:desk"), (r"\btv\b|television|theater|theatre", "hk:television"),
    (r"treadmill|gym|bike", "hk:treadmill"), (r"light", "hk:lightbulb-outline"),
    (r"wall connector|tesla", "hk:ev-plug-tesla"), (r"charg|\bev\b|evse|wallbox|\bcar\b", "hk:ev-station"),
    (r"outlet|plug|socket|receptacle", "hk:power-socket-us"), (r"garage", "hk:garage"),
    (r"kitchen", "hk:silverware-fork-knife"), (r"bed", "hk:bed-outline"), (r"living|family|sofa", "hk:sofa-outline"),
)
_APPLIANCE = re.compile("|".join(p for p, _ in _GLYPHS[:17]))


def _appliance(f: str) -> bool:
    return bool(_APPLIANCE.search(f))


def guess_icon(name: str, area_icon: str | None = None) -> str:
    f = _fold(name)
    for pat, icon in _GLYPHS:
        if re.search(pat, f):
            return icon
    return area_icon or "hk:lightning-bolt"


_SECTION_COLORS = {"hvac": ["blue"], "rooms": ["orange", "purple", "blue", "pink", "teal", "mint", "green", "yellow"],
                   "appliances": ["mint", "red", "blue", "cyan", "green", "orange", "purple", "pink"],
                   "outlets": ["yellow"], "charging": ["cyan", "green"], "other": ["teal"]}


def guess_color(section: str, index: int) -> str:
    cycle = _SECTION_COLORS.get(section) or ["teal"]
    return cycle[index % len(cycle)]


# ---------------------------------------------------------------- reading
def _num(v: Any) -> float | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def is_power(e: Mapping[str, Any] | None) -> bool:
    if not e:
        return False
    return e.get("dc") == "power" or str(e.get("unit") or "") in ("W", "kW", "MW")


def is_energy(e: Mapping[str, Any] | None) -> bool:
    if not e:
        return False
    return e.get("dc") == "energy" or str(e.get("unit") or "") in ("Wh", "kWh", "MWh")


def follow_source(ctx: Mapping[str, Any], stat: str, hops: int = 4) -> str | None:
    """A meter's power sensor through its helpers' sources (Utility Meter ->
    Integral -> W). None when the chain does not reach one."""
    ents = ctx.get("entities") or {}
    seen, cur = set(), stat
    for _ in range(hops):
        e = ents.get(cur)
        src = e and e.get("source")
        if not src or src in seen:
            return None
        seen.add(src)
        if is_power(ents.get(src)):
            return src
        cur = src
    return None


def device_power(ctx: Mapping[str, Any], stat: str, hops: int = 4) -> str | None:
    """A power sensor on the meter's own device -- or on the device of the
    sensor it counts (a Utility Meter over a smart plug's own kWh); of
    several, the one whose name shares the most words with the meter's."""
    ents = ctx.get("entities") or {}
    me = ents.get(stat) or {}
    cur, dev, seen = stat, me.get("device"), {stat}
    for _ in range(hops):
        if dev:
            break
        src = (ents.get(cur) or {}).get("source")
        if not src or src in seen:
            return None
        seen.add(src)
        cur, dev = src, (ents.get(src) or {}).get("device")
    if not dev:
        return None
    cands = [eid for eid, e in ents.items() if e.get("device") == dev and eid not in seen and is_power(e)
             and not e.get("category") and eid.startswith("sensor.")]
    if not cands:
        return None
    words = set(_fold(me.get("name") or "").split())
    return sorted(cands, key=lambda eid: (-len(words & set(_fold(ents[eid].get("name") or "").split())), eid))[0]


def device_switch(ctx: Mapping[str, Any], power: str | None) -> str | None:
    """The switch on the power sensor's device: a smart plug's own on/off."""
    ents = ctx.get("entities") or {}
    dev = (ents.get(power or "") or {}).get("device")
    if not dev:
        return None
    sw = sorted(eid for eid, e in ents.items() if e.get("device") == dev and eid.startswith("switch.")
                and not e.get("category"))
    return sw[0] if len(sw) == 1 else None


def resolve_power(ctx: Mapping[str, Any], stat: str | None, rate: str | None = None,
                  own: str | None = None) -> tuple[str | None, str]:
    """(power sensor, how it was found): own | energy | source | device | ''"""
    if own:
        return own, "own"
    if rate:
        return rate, "energy"
    if stat:
        src = follow_source(ctx, stat)
        if src:
            return src, "source"
        dp = device_power(ctx, stat)
        if dp:
            return dp, "device"
    return None, ""


# ------------------------------------------------------------- the devices
def grid_of(prefs: Mapping[str, Any] | None) -> dict[str, Any]:
    """The first grid connection's import meter, cost, price and power
    sensor -- whichever shape the settings are in (2026.3's one object per
    connection, or the older flow_from list)."""
    for src in (prefs or {}).get("energy_sources") or []:
        if src.get("type") != "grid":
            continue
        frm = src.get("stat_energy_from")
        flow = (src.get("flow_from") or [{}])[0] if not frm else src
        frm = frm or flow.get("stat_energy_from")
        if not frm:
            continue
        rate = src.get("stat_rate")
        pc = src.get("power_config") or {}
        if not rate:
            rate = pc.get("stat_rate") or pc.get("stat_rate_from")
        if not rate and src.get("power"):
            p0 = (src.get("power") or [{}])[0]
            rate = p0.get("stat_rate") or (p0.get("power_config") or {}).get("stat_rate")
        return {"stat": frm, "cost": flow.get("stat_cost"), "rate": rate,
                "price": flow.get("entity_energy_price") or flow.get("number_energy_price")}
    return {}


def battery_of(prefs: Mapping[str, Any] | None) -> dict[str, Any]:
    for src in (prefs or {}).get("energy_sources") or []:
        if src.get("type") == "battery":
            return {"soc": src.get("stat_soc"), "capacity": src.get("capacity"),
                    "charge": src.get("stat_energy_to"), "discharge": src.get("stat_energy_from")}
    return {}


def devices(ctx: Mapping[str, Any], options: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every device the page could show: HA's Energy devices (unless the
    options say not to follow them), then the feature's own. Each one:
    key, stat, power, found (how its power was found), name, raw (HA's name
    for it), parent, children, section (guessed), icon, color, control,
    hidden, rank (its meter's reading now, for "the biggest")."""
    prefs = ctx.get("prefs") or {}
    ents = ctx.get("entities") or {}
    own = options.get(CONF_DEVICES) or {}
    areas = [a.get("name") for a in (ctx.get("areas") or {}).values()]
    area_icons = {_fold(a.get("name")): a.get("icon") for a in (ctx.get("areas") or {}).values()}
    out: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    if options.get(CONF_FOLLOW, True):
        for d in prefs.get("device_consumption") or []:
            if d.get("stat_consumption"):
                rows.append({"key": d["stat_consumption"], "stat": d["stat_consumption"], "rate": d.get("stat_rate"),
                             "name": d.get("name"), "parent": d.get("included_in_stat")})
    have = {r["key"] for r in rows}
    for x in options.get(CONF_EXTRA) or []:
        key = str(x.get("key") or x.get("stat") or x.get("power") or "")
        if key and key not in have:
            have.add(key)
            rows.append({"key": key, "stat": x.get("stat") or None, "rate": None, "name": x.get("name"),
                         "parent": None, "extra": True, "own_power": x.get("power") or None})
    for r in rows:
        mine = own.get(r["key"]) or {}
        power, found = resolve_power(ctx, r["stat"], r.get("rate"), mine.get("power") or r.get("own_power"))
        e_stat = ents.get(r["stat"] or "") or {}
        e_pow = ents.get(power or "") or {}
        raw = r.get("name") or e_stat.get("name") or e_pow.get("name") or r["key"]
        # the guesses read Home Assistant's own name, so a name of your own
        # ("Crawl Space") keeps the glyph and section its meter's suggests
        auto = short_name(raw)
        name = mine.get("name") or auto
        section = guess_section(auto, areas)
        out.append({
            "key": r["key"], "stat": r["stat"], "power": power, "found": found, "raw": raw, "name": name,
            "parent": r.get("parent"), "children": [], "section": section,
            "icon": mine.get("icon") or guess_icon(auto, area_icons.get(_fold(auto))),
            "color": mine.get("color") or None, "control": mine.get("control") or device_switch(ctx, power),
            "hidden": bool(mine.get("hidden")), "extra": bool(r.get("extra")),
            # its daily runtime (an AC's hours), chosen here; the page also
            # links a daily bar of runtime named after the device by itself
            "runtime": mine.get("runtime") or None,
            "rank": _num(e_stat.get("state")) or 0.0})
    by = {d["key"]: d for d in out}
    for d in out:
        if d["parent"] in by:
            by[d["parent"]]["children"].append(d["key"])
    return out


def batteries(ctx: Mapping[str, Any], options: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The batteries the Charging section shows: the options' list, or --
    automatically -- the house battery's level (HA's Energy settings), and
    every car's: a battery level on a device that also reports a range."""
    ents = ctx.get("entities") or {}
    chosen = options.get(CONF_BATTERIES)
    if isinstance(chosen, list):
        rows = [dict(b) for b in chosen if isinstance(b, dict) and b.get("entity")]
    else:
        rows = []
        soc = battery_of(ctx.get("prefs")).get("soc")
        if soc:
            rows.append({"entity": soc, "house": True})
        rows += [{"entity": eid} for eid in ctx.get("vehicles") or []]
    out = []
    for b in rows:
        eid = b["entity"]
        e = ents.get(eid) or {}
        label = b.get("label") or (e.get("range") if not b.get("house") else e.get("stored"))
        le = ents.get(label or "") or {}
        if b.get("label_suffix") is not None:
            suffix = b["label_suffix"]
        elif label and le.get("dc") == "distance" or "range" in str(label or ""):
            suffix = " " + str(le.get("unit") or "mi") + " range"
        elif label:
            suffix = " " + str(le.get("unit") or "kWh") + " stored"
        else:
            suffix = ""
        name = b.get("name") or short_name(re.sub(r"\s+battery( level)?$", "", str(e.get("name") or eid), flags=re.I))
        # `house` said, not left to the glyph: HK Settings' Batteries list
        # reads it (it guessed from the icon, which a custom icon breaks)
        out.append({"key": eid, "kind": "battery", "entity": eid, "name": name or eid,
                    "house": bool(b.get("house")),
                    "icon": b.get("icon") or ("hk:home-battery-outline" if b.get("house") else "hk:battery-high"),
                    "label": label or None, "label_suffix": suffix,
                    "label_decimals": b.get("label_decimals", 1 if "stored" in suffix else 0)})
    return out


# ------------------------------------------------------------------- build
def sections(devs: list[dict[str, Any]], bats: list[dict[str, Any]],
             options: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The sections in page order, each with its items' keys. The options'
    sections, with any device they do not place added to the section its
    guess names (or Other); automatically, the guessed sections that have
    something in them."""
    names = dict(SECTIONS)
    chosen = options.get(CONF_SECTIONS)
    out: list[dict[str, Any]] = []
    if isinstance(chosen, list):
        for s in chosen:
            if isinstance(s, dict) and s.get("id"):
                out.append({"id": str(s["id"]), "name": str(s.get("name") or names.get(s["id"]) or s["id"]),
                            "items": [k for k in (s.get("items") or []) if isinstance(k, str)],
                            "link": s.get("link") if isinstance(s.get("link"), dict) else None,
                            "color": s.get("color") or None})
    placed = {k for s in out for k in s["items"]}
    by_id = {s["id"]: s for s in out}
    auto = not isinstance(chosen, list)
    for d in devs:
        if d["key"] in placed:
            continue
        sid = d["section"] if (auto or d["section"] in by_id) else "other"
        if sid not in by_id:
            by_id[sid] = {"id": sid, "name": names.get(sid, sid), "items": [], "link": None}
            out.append(by_id[sid])
        by_id[sid]["items"].append(d["key"])
    for b in bats:
        if b["key"] in placed:
            continue
        sid = "charging"
        if sid not in by_id:
            by_id[sid] = {"id": sid, "name": names[sid], "items": [], "link": None}
            out.append(by_id[sid])
        by_id[sid]["items"].append(b["key"])
    if auto:
        order = [s for s, _ in SECTIONS]
        out.sort(key=lambda s: order.index(s["id"]) if s["id"] in order else len(order))
    return out


def build(ctx: Mapping[str, Any], options: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The plan a screen draws the Energy page from (hk-strategy.js
    energyPage). Plain values only."""
    options = dict(options or {})
    ents = ctx.get("entities") or {}
    prefs = ctx.get("prefs") or {}
    grid = grid_of(prefs)
    tot = dict(options.get(CONF_TOTAL) or {})
    total_stat = tot.get("stat") or grid.get("stat")
    total_power, _ = resolve_power(ctx, total_stat, grid.get("rate"), tot.get("power") or ctx.get("house_power"))
    cost = tot.get("cost") or grid.get("cost") or (f"{grid['stat']}_cost" if grid.get("stat") and
                                                    f"{grid['stat']}_cost" in ents else None)
    total = {"name": "Whole Home", "power": total_power, "stat": total_stat, "cost": cost,
             "price": grid.get("price") if not cost else None}

    devs = devices(ctx, options)
    bats = batteries(ctx, options)
    by = {d["key"]: d for d in devs}
    bats_by = {b["key"]: b for b in bats}
    secs = sections(devs, bats, options)

    # each section's items, colored in turn where the options name none
    out_secs = []
    for s in secs:
        items = []
        for i, key in enumerate(s["items"]):
            if key in by:
                d = by[key]
                if d["hidden"]:
                    continue
                it = {"key": key, "kind": "device", "name": d["name"], "icon": d["icon"],
                      "color": d["color"] or guess_color(s["id"], len(items)),
                      "power": d["power"], "stat": d["stat"], "control": d["control"]}
                if d.get("runtime"):
                    it["runtime"] = d["runtime"]
                items.append(it)
            elif key in bats_by:
                items.append(dict(bats_by[key]))
        if items:
            sec = {"id": s["id"], "name": s["name"], "link": s["link"], "items": items}
            if s.get("color"):
                sec["color"] = s["color"]
            out_secs.append(sec)

    # the readings row: Today's Cost, then the house's thermostats and the
    # outside temperature (or the options' own list)
    top: list[dict[str, Any]] = []
    if options.get(CONF_COST, True) and total_stat:
        top.append({"kind": "cost"})
    chosen = options.get(CONF_TOP)
    ids = chosen if isinstance(chosen, list) else (list(ctx.get("thermostats") or [])[:2] +
                                                   ([ctx["outside"]] if ctx.get("outside") else []))
    for eid in ids:
        if len(top) >= TOP_MAX:
            break
        e = ents.get(eid) or {}
        kind = "climate" if eid.startswith("climate.") else ("temp" if e.get("dc") == "temperature" else "value")
        name = e.get("name") or eid
        if kind == "climate":
            name = re.sub(r"\s+(ecobee\s+)?thermostat$", "", name, flags=re.I)
        elif eid == ctx.get("outside"):
            name = "Outside"
        top.append({"kind": kind, "entity": eid, "name": short_name(name)})

    # the daily bars: the options' own, or the whole home and the biggest
    # devices (by what their meters read now)
    usages: list[dict[str, Any]] = []
    chosen_u = options.get(CONF_USAGES)
    if isinstance(chosen_u, list):
        for u in chosen_u[:USAGES_MAX]:
            if not isinstance(u, dict) or not u.get("entity"):
                continue
            d = by.get(u.get("stat") or "") or next((x for x in devs if x["power"] == u["entity"]), None)
            e = ents.get(u["entity"]) or {}
            runtime = e.get("dc") == "duration" or str(e.get("unit") or "") in ("h", "min")
            usages.append({"entity": u["entity"], "stat": u.get("stat") or (d and d["stat"]) or u["entity"],
                           "name": u.get("name") or (d and d["name"]) or short_name(e.get("name") or u["entity"]),
                           "color": u.get("color") or "orange", "runtime": runtime})
    else:
        if total_stat:
            usages.append({"entity": total_power or total_stat, "stat": total_stat, "name": "Whole Home",
                           "color": "orange", "runtime": False})
        top_devs = sorted([d for d in devs if not d["parent"] and not d["hidden"] and d["stat"]],
                          key=lambda d: -d["rank"])[:5]
        cyc = ["blue", "green", "purple", "red", "teal"]
        for i, d in enumerate(top_devs):
            usages.append({"entity": d["power"] or d["stat"], "stat": d["stat"], "name": d["name"],
                           "color": cyc[i % len(cyc)], "runtime": False})

    # WHAT THE HOUSE HAS, for the page's layout: the generated page is built
    # before any statistics load, and Your Day's width depends on whether the
    # house battery and water (or gas) sit beside it
    kinds = {str(x.get("type")) for x in prefs.get("energy_sources") or [] if isinstance(x, dict)}
    sources = {"battery": "battery" in kinds, "water": "water" in kinds, "gas": "gas" in kinds,
               "solar": "solar" in kinds, "cost": bool(cost or total.get("price"))}

    # for a detail sheet: what each power sensor (and meter) is part of
    lookup = {}
    for d in devs:
        rec = {"key": d["key"], "name": d["name"], "stat": d["stat"], "power": d["power"], "control": d["control"],
               "parent": d["parent"] if d["parent"] in by else None, "children": d["children"]}
        for k in (d["power"], d["stat"]):
            if k and k not in lookup:
                lookup[k] = rec
    out = {
        "title": str(options.get(CONF_TITLE) or "Energy")[:40],
        "total": total, "top": top, "usages": usages, "sections": out_secs,
        "detail": bool(options.get(CONF_DETAIL, False)) and bool(prefs.get("energy_sources") or
                                                                  prefs.get("device_consumption")),
        "sources": sources,
        "page": dict(options.get(CONF_PAGE) or {}),
        # the daily bars are the house's own choice (shown as their own row)
        # or automatic (each device's sheet has them)
        "usages_auto": not isinstance(chosen_u, list),
        "devices": lookup,
        "names": {d["key"]: d["name"] for d in devs},
    }
    # THE POWER PAGE: the same devices, right now (power.py)
    from . import power as _power
    out["power"] = _power.build(ctx, options, out)
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
        src = None
        if comp is not None and eid.startswith("sensor."):
            obj = comp.get_entity(eid)
            src = getattr(obj, "_sensor_source_id", None) or getattr(obj, "_source_entity", None)
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
