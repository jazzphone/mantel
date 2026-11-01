"""Reading the house: what is there, where, and how it is now. Only what the person may ``view`` (RBAC, the same
policy a page's socket filters with: authz.may_read), never a secret, never an address of the house's network."""
from __future__ import annotations

from typing import Any

from ..dispatch import ToolError, read
from . import Tool

MAX_STATES = 200
# the attributes worth an assistant's attention; everything else stays on the page
ATTRS = ("friendly_name", "device_class", "unit_of_measurement", "brightness", "color_mode", "current_temperature",
         "temperature", "target_temp_low", "target_temp_high", "hvac_action", "hvac_modes", "preset_mode",
         "current_position", "media_title", "media_artist", "source", "volume_level", "is_volume_muted",
         "battery_level", "supported_features", "options", "icon")


def _hub(caller):
    hub = caller.app.get("hub")
    if hub is None:
        raise ToolError("unavailable", "Mantel is not connected to the house yet")
    return hub


def visible(caller, ids) -> list[str]:
    authz = caller.app["authz"]
    return authz.may_read(caller.principal, "view", sorted(set(ids)))


def name_of(hub, eid: str) -> str:
    e = hub.registry.entries.get(eid) or {}
    st = hub.store.states.get(eid) or {}
    return e.get("name") or (st.get("a") or {}).get("friendly_name") or e.get("original_name") or eid


def entity_brief(hub, eid: str) -> dict:
    reg = hub.registry
    area = reg.entity_area.get(eid)
    st = hub.store.states.get(eid) or {}
    return {"entity_id": eid, "name": name_of(hub, eid), "domain": eid.split(".", 1)[0],
            "area": reg.areas.get(area) if area else None, "area_id": area, "state": st.get("s")}


async def house_summary(caller, args: dict) -> dict:
    hub = _hub(caller)
    reg = hub.registry
    seen = set(visible(caller, set(hub.store.states) | set(reg.entries)))
    rooms: dict[str, int] = {}
    domains: dict[str, int] = {}
    for eid in seen:
        a = reg.entity_area.get(eid)
        if a:
            rooms[a] = rooms.get(a, 0) + 1
        d = eid.split(".", 1)[0]
        domains[d] = domains.get(d, 0) + 1
    floors = [{"floor_id": f, "name": n, "rooms": sorted(a for a, fl in reg.area_floor.items() if fl == f)}
              for f, n in sorted(reg.floors.items(), key=lambda x: x[1].lower())]
    from ...about import about
    info = about(caller.app)
    out: dict[str, Any] = {
        "mantel": {"version": info.get("version"), "install": info.get("install"),
                   "home_assistant_connected": info["home_assistant"]["connected"],
                   "music_assistant_configured": info["music_assistant"]["configured"],
                   "house_commands": caller.app.get("gateway") is not None},
        "you": {"name": caller.user.name or caller.user.username, "role": caller.user.role,
                "assistant": caller.grant.name, "scopes": sorted(caller.scopes)},
        "floors": floors,
        "rooms": [{"area_id": a, "name": reg.areas.get(a, a), "floor_id": reg.area_floor.get(a), "entities": n}
                  for a, n in sorted(rooms.items(), key=lambda x: reg.areas.get(x[0], x[0]).lower())],
        "entities": {"visible": len(seen), "by_domain": dict(sorted(domains.items()))},
    }
    try:
        panel = await read(caller, {"type": "hk_frontend/panel/get"})
        out["screens"] = [{"key": d["path"], "title": d["title"],
                           "where": ((d.get("where") or {}).get("where") or "mantel")} for d in panel.get("dashboards") or []]
        out["tablets"] = [{"id": k, "name": t.get("name") or k, "screen": t.get("screen"), "room": t.get("room")}
                          for k, t in sorted((panel.get("tablets") or {}).items())]
    except ToolError as exc:
        out["screens"] = out["tablets"] = None
        out["settings_unavailable"] = exc.message
    return out


async def house_find(caller, args: dict) -> dict:
    hub = _hub(caller)
    reg = hub.registry
    q = (args.get("query") or "").strip().lower()
    want_domain = args.get("domain")
    want_area = reg.resolve_area(args["area"]) if args.get("area") else None
    if args.get("area") and want_area is None:
        raise ToolError("not_found", f"no room called {args['area']!r}", {"area": "unknown"})
    words = [w for w in q.split() if w]
    found = []
    for eid in visible(caller, set(hub.store.states) | set(reg.entries)):
        if want_domain and not eid.startswith(want_domain + "."):
            continue
        area = reg.entity_area.get(eid)
        if want_area and area != want_area:
            continue
        hay = " ".join(filter(None, [eid, name_of(hub, eid), reg.areas.get(area or "", ""),
                                     ((reg.entries.get(eid) or {}).get("original_device_class") or "")])).lower()
        # every word of the query somewhere (plurals forgiven: "lights" finds light.*)
        if all(w in hay or w.rstrip("s") in hay for w in words):
            found.append(entity_brief(hub, eid))
    found.sort(key=lambda e: (e["area"] or "~", e["name"].lower()))
    limit = args.get("limit", 50)
    return {"count": len(found), "entities": found[:limit], "truncated": len(found) > limit}


async def house_states(caller, args: dict) -> dict:
    hub = _hub(caller)
    asked = list(dict.fromkeys(args["entity_ids"]))
    ok = set(visible(caller, asked))
    out, missing = [], []
    for eid in asked:
        st = hub.store.states.get(eid)
        if eid not in ok or st is None:
            missing.append(eid)          # one answer for "no such entity" and "not yours to see"
            continue
        attrs = st.get("a") or {}
        out.append({**entity_brief(hub, eid), "attributes": {k: attrs[k] for k in ATTRS if k in attrs},
                    "last_changed": st.get("lc")})
    return {"states": out, "not_found": missing}


async def rooms_list(caller, args: dict) -> dict:
    hub = _hub(caller)
    reg = hub.registry
    seen = set(visible(caller, set(hub.store.states) | set(reg.entries)))
    rooms = []
    for a, name in sorted(reg.areas.items(), key=lambda x: (reg.floors.get(reg.area_floor.get(x[0]) or "", "~"),
                                                            x[1].lower())):
        ids = sorted(i for i in reg.by_area.get(a, ()) if i in seen)
        if not ids and not args.get("empty"):
            continue
        rooms.append({"area_id": a, "name": name, "floor": reg.floors.get(reg.area_floor.get(a) or ""),
                      "accessories": [{"entity_id": i, "name": name_of(hub, i), "domain": i.split(".", 1)[0]}
                                      for i in ids]})
    return {"rooms": rooms}


ENTITY_IDS = {"type": "array", "items": {"type": "string", "maxLength": 255}, "maxItems": MAX_STATES}
TOOLS = [
    Tool("house_summary", "House summary",
         "The house at a glance: floors, rooms (with how many things each has), what kinds of things there are, "
         "the screens and wall tablets, Mantel's version and what it is connected to, and who you are acting for. "
         "Start here.", {}, house_summary, idempotent=True),
    Tool("house_find", "Find things in the house",
         "Find entities by words (name, room, kind: 'kitchen lights', 'front door'), by domain (light, switch, "
         "climate, media_player, camera, scene...) and/or by room. Only what this person may see.",
         {"query": {"type": "string", "maxLength": 200}, "domain": {"type": "string", "maxLength": 64},
          "area": {"type": "string", "maxLength": 120, "description": "a room's id or name"},
          "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 50}}, house_find),
    Tool("house_states", "Current states",
         "The current state of up to 200 entities, with the attributes that matter (brightness, temperature, "
         "what is playing...).", {"entity_ids": ENTITY_IDS}, house_states, required=("entity_ids",)),
    Tool("rooms_list", "Rooms and their accessories",
         "Every room (floor by floor) with the accessories in it. `empty: true` lists rooms with nothing in them too.",
         {"empty": {"type": "boolean", "default": False}}, rooms_list),
]
