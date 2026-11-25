"""THE POWER PAGE FOR THE APP (2026-11-25, the owner, on the HomeView's CarPlay Home tab: "The Battery page should be Power
instead... with options to turn on and off the circuits! ... pretty informative of where the house batteries are, the
current circuits ... the data that's on the Power page").

  GET /api/app/power   -> the Power page now, as the person may see it (below); 409 energy_off, 404 power_off

What it reads is the Energy feature's plan (``plan["power"]``: hk_core.energy.power.build, the web Power page's own),
each entity's state now, and only the entities the person may view:

  readings    the house, the grid, the sun, what the grid takes back, what the battery backs: [{key, name, entity,
              value, unit}]
  grid_status {entity, state} -- on the grid or off it
  battery     {level, parts: [readings: charging, discharging, its power...], packs: [{name, level, temperature}],
              backs_up: some | all | none}
  mode        {entity, state, options: [{value, name}]} -- the battery's mode (a select), its own words if the page has
              them
  levels      [{entity, name, value, unit, min, max, step}] -- its levels (numbers: backup reserve, charge limit)
  status      [{entity, name, state}]
  cars        [{name, level, power, plugged, charge: {entity, on}, limit: {entity, value, min, max, step}}]
  circuits    [{key, name, section, entity, value, unit, control, on, backed, parent}] -- every device on the page, what
              it draws now and its switch (``control``) with its state

Nothing here acts: a switch, a mode or a level is a command the app sends (``/api/app/command``), through the gateway
as the person, audited.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from aiohttp import web

from ..identity.guards import WHY_APP, open_route
from ..identity.sessions import error, ok
from .app_api import _number, _principal, _visible
from .app_auth import app_route

READINGS = (("home", "Home"), ("grid", "Grid"), ("solar", "Solar"), ("grid_export", "To the Grid"),
            ("backed_power", "Backed Up"))
BATTERY_WORDS = {"level": "Charge", "charge": "Charging", "discharge": "Discharging", "power": "Power",
                 "reserve": "Backup Reserve", "energy": "Stored", "capacity": "Capacity", "temperature": "Temperature"}
CIRCUITS_MAX = 80
PATH = "/api/app/power"


def _st(states: Mapping[str, Any], eid: str) -> tuple[Any, dict]:
    st = states.get(eid) or {}
    return st.get("s"), st.get("a") or {}


def _reading(states: Mapping[str, Any], key: str, name: str, eid: Any, may: set) -> dict | None:
    if not isinstance(eid, str) or eid not in may:
        return None
    s, a = _st(states, eid)
    value = _number(s)
    if value is None:
        return None
    return {"key": key, "name": name, "entity": eid, "value": value, "unit": a.get("unit_of_measurement")}


def _name(states: Mapping[str, Any], eid: str, fallback: str | None = None) -> str:
    return fallback or _st(states, eid)[1].get("friendly_name") or eid


def _number_ctl(states: Mapping[str, Any], eid: Any, may: set, name: str | None = None) -> dict | None:
    if not isinstance(eid, str) or eid not in may:
        return None
    s, a = _st(states, eid)
    value = _number(s)
    if value is None:
        return None
    return {"entity": eid, "name": _name(states, eid, name), "value": value, "unit": a.get("unit_of_measurement"),
            "min": _number(a.get("min")), "max": _number(a.get("max")), "step": _number(a.get("step"))}


def _switch(states: Mapping[str, Any], eid: Any, may: set) -> dict | None:
    if not isinstance(eid, str) or eid not in may:
        return None
    s, _ = _st(states, eid)
    return {"entity": eid, "on": s == "on"} if s in ("on", "off") else None


def power_ids(power: Mapping[str, Any]) -> list[str]:
    """Every entity the Power page names (to ask once which the person may view)."""
    ids: list[str] = []

    def add(x: Any) -> None:
        if isinstance(x, str) and x not in ids:
            ids.append(x)
    for k, _ in READINGS:
        add(power.get(k))
    add(power.get("grid_status"))
    bat = power.get("battery") or {}
    for k, v in bat.items():
        if k == "packs":
            for p in v or []:
                add(p.get("level"))
                add(p.get("temperature"))
        else:
            add(v)
    add((power.get("mode") or {}).get("entity"))
    for x in (power.get("levels") or []) + (power.get("status") or []):
        add(x.get("entity"))
    for car in power.get("cars") or []:
        for k in ("level", "power", "charger", "plugged", "charge", "limit"):
            add(car.get(k))
    for s in power.get("sections") or []:
        for it in s.get("items") or []:
            add(it.get("power"))
            add(it.get("control"))
    return ids


def power_page(power: Mapping[str, Any], states: Mapping[str, Any], may: set) -> dict[str, Any]:
    """The Power page as the app draws it (see the module's docstring); ``may``: the entities the person may view."""
    out: dict[str, Any] = {"title": power.get("title") or "Power"}
    out["readings"] = [r for k, n in READINGS if (r := _reading(states, k, n, power.get(k), may))]
    gs = power.get("grid_status")
    out["grid_status"] = {"entity": gs, "state": _st(states, gs)[0]} if isinstance(gs, str) and gs in may else None

    bat = power.get("battery") or {}
    if bat:
        parts = [r for k, eid in bat.items() if k not in ("level", "packs")
                 if (r := _reading(states, k, BATTERY_WORDS.get(k, k.replace("_", " ").title()), eid, may))]
        packs = []
        for i, p in enumerate(bat.get("packs") or []):
            lv = _reading(states, "pack", p.get("name") or f"Pack {i + 1}", p.get("level"), may)
            if lv:
                t = _reading(states, "temperature", "Temperature", p.get("temperature"), may)
                packs.append({"name": lv["name"], "level": lv, "temperature": t})
        out["battery"] = {"level": _reading(states, "level", "Charge", bat.get("level"), may), "parts": parts,
                          "packs": packs, "backs_up": power.get("backs_up") or "none"}
    else:
        out["battery"] = None

    mode = power.get("mode") or {}
    me = mode.get("entity")
    if isinstance(me, str) and me in may:
        s, a = _st(states, me)
        opts = [{"value": o["value"], "name": o.get("name") or o["value"]} for o in mode.get("options") or [] if o.get("value")] \
            or [{"value": o, "name": o} for o in a.get("options") or [] if isinstance(o, str)]
        out["mode"] = {"entity": me, "name": _name(states, me), "state": s, "options": opts}
    else:
        out["mode"] = None

    out["levels"] = [x for lv in power.get("levels") or [] if (x := _number_ctl(states, lv.get("entity"), may, lv.get("name")))]
    out["status"] = [{"entity": st["entity"], "name": _name(states, st["entity"]), "state": _st(states, st["entity"])[0]}
                     for st in power.get("status") or [] if st.get("entity") in may]

    cars = []
    for car in power.get("cars") or []:
        level = _reading(states, "level", car.get("name") or "Car", car.get("level"), may)
        if level is None:
            continue
        plugged = car.get("plugged")
        cars.append({"name": car.get("name") or level["name"], "level": level,
                     "power": _reading(states, "power", "Charging", car.get("charger") or car.get("power"), may),
                     "plugged": (_st(states, plugged)[0] == "on") if isinstance(plugged, str) and plugged in may else None,
                     "charge": _switch(states, car.get("charge"), may),
                     "limit": _number_ctl(states, car.get("limit"), may, "Charge Limit")})
    out["cars"] = cars

    circuits = []
    for s in power.get("sections") or []:
        for it in s.get("items") or []:
            eid, ctl = it.get("power"), it.get("control")
            reading = _reading(states, "power", it.get("name") or "", eid, may) if eid else None
            sw = _switch(states, ctl, may)
            if reading is None and sw is None:
                continue
            circuits.append({"key": it.get("key"), "name": it.get("name") or eid or ctl, "section": s.get("name"),
                             "entity": reading["entity"] if reading else None,
                             "value": reading["value"] if reading else None, "unit": reading["unit"] if reading else None,
                             "control": sw["entity"] if sw else None, "on": sw["on"] if sw else None,
                             "backed": bool(it.get("backed")), "parent": it.get("parent")})
    out["circuits"] = circuits[:CIRCUITS_MAX]
    return out


@open_route("app_dpop", reads="feature:energy", why=WHY_APP)
@app_route
async def power(request: web.Request) -> web.Response:
    authz, host = request.app.get("authz"), request.app.get("features")
    principal = _principal(request)
    if authz is None or "feature:energy" not in authz.may_read(principal, "view", ["feature:energy"]):
        return error(403, "forbidden")
    plan = host.energy_cache if host is not None and host.on("energy") else None
    if not isinstance(plan, dict):
        return error(409, "energy_off", message="The Energy feature is off on this Mantel.")
    page = plan.get("power")
    if not isinstance(page, dict):
        return error(404, "power_off", message="The Power page is off on this Mantel.")
    states = request.app["hub"].store.states
    may = set(_visible(request, power_ids(page)))
    return ok({**power_page(page, states, may), "at": float(request.app["clock"]())})


def register(app: web.Application, hub=None) -> None:
    app.router.add_get(PATH, power)
    app.setdefault("public_paths", set()).add(PATH)
