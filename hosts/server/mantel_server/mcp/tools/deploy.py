"""Making deploying easy (docs/phase12/MCP-SERVER.md "Making deploying easy"): several changes as one reviewed
batch, a screen as a file (export, and import with the house's own entities matched by name and room), screens
from templates, a wall tablet set up end to end, and a preview of a screen the assistant's own browser opens."""
from __future__ import annotations

import copy
import re
from typing import Any

from ..dispatch import ToolError, change, in_batch, read, save
from . import Tool, check_args
from .house import name_of, visible

EXPORT_VERSION = 1
ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+\Z")
BATCH_MAX = 20
BATCHABLE = ("settings_change", "accessory_set", "screen_create", "screen_rename", "screen_move", "screen_remove",
             "grid_set", "grid_place", "grid_remove", "music_playlist_save", "music_preset_save", "music_item_remove",
             "music_pills_order", "music_settings_set", "settings_restore")


# -- settings_apply ------------------------------------------------------------------------------------------------
async def settings_apply(caller, args: dict) -> dict:
    from . import all_tools
    tools = {t.name: t for t in all_tools()}
    steps = []
    for n, s in enumerate(args["steps"]):
        name = s.get("tool") if isinstance(s, dict) else None
        if name not in BATCHABLE:
            raise ToolError("invalid_arguments", f"steps[{n}].tool: one of {list(BATCHABLE)}", {f"steps[{n}].tool": "choice"})
        tool = tools[name]
        if not caller.has(tool.needs):
            raise ToolError("forbidden", f"steps[{n}]: {name} needs the {tool.needs!r} scope")
        sargs = dict(s.get("arguments") or {})
        if "dry_run" in sargs or "plan" in sargs:
            raise ToolError("invalid_arguments", f"steps[{n}]: the batch is planned and applied as one: no dry_run "
                                                 "or plan in a step")
        steps.append((name, tool, check_args(tool, sargs)))
    service = caller.app["settings"]

    async def run():
        landed = []
        for n, (name, tool, sargs) in enumerate(steps):
            before = service.versions()
            try:
                got = await in_batch(lambda: tool.handler(caller, sargs))
            except ToolError as exc:
                if args.get("dry_run", True) is False:
                    raise ToolError("batch_stopped", f"step {n} ({name}) was refused: {exc.message}; the steps before it "
                                                     "were applied (undo them with settings_restore)",
                                    exc.fields, step=n, landed=landed, refused=exc.body()) from None
                raise ToolError(exc.code, f"step {n} ({name}): {exc.message}", exc.fields, step=n) from None
            after = service.versions()
            landed.append({"step": n, "tool": name,
                           "changed": [{"doc": k, "version": v, "previous": before.get(k, 0)}
                                       for k, v in after.items() if before.get(k, 0) != v and "/" in k],
                           "result": got if not (isinstance(got, dict) and got.get("planned")) else None})
        return {"steps": landed}
    return await change(caller, "settings_apply", args, run)


# -- export / import -----------------------------------------------------------------------------------------------
def _walk_ids(v: Any, out: set[str]) -> None:
    if isinstance(v, str):
        if ENTITY.match(v):
            out.add(v)
    elif isinstance(v, dict):
        for k, x in v.items():
            _walk_ids(k, out)
            _walk_ids(x, out)
    elif isinstance(v, list):
        for x in v:
            _walk_ids(x, out)


def _replace_ids(v: Any, mapping: dict[str, str]) -> Any:
    if isinstance(v, str):
        return mapping.get(v, v)
    if isinstance(v, dict):
        return {mapping.get(k, k): _replace_ids(x, mapping) for k, x in v.items()}
    if isinstance(v, list):
        return [_replace_ids(x, mapping) for x in v]
    return v


async def screen_export(caller, args: dict) -> dict:
    key = args["screen"]
    got = await read(caller, {"type": "mantel/settings/get", "scope": "board", "key": key})
    if not got.get("version"):
        raise ToolError("not_found", f"no screen {key!r}", {"screen": "unknown"})
    board = copy.deepcopy(got.get("body") or {})
    acc = await read(caller, {"type": "mantel/settings/get", "scope": "house", "key": "accessories"})
    names = {}
    for eid, v in ((acc.get("body") or {}).get("entities") or {}).items():
        n = (v or {}).get("names") if isinstance(v, dict) else None
        if isinstance(n, dict) and key in n:
            names[eid] = n[key]
    hub = caller.app["hub"]
    reg = hub.registry
    ids: set[str] = set()
    _walk_ids(board, ids)
    ids |= set(names)
    known = set(hub.store.states) | set(reg.entries)
    seen = set(visible(caller, [i for i in ids if i in known]))
    entities = {i: {"name": name_of(hub, i), "area": reg.areas.get(reg.entity_area.get(i) or ""),
                    "domain": i.split(".", 1)[0]} for i in sorted(seen)}
    return {"mantel_screen": EXPORT_VERSION, "title": board.pop("title", None), "board": board,
            "names": names, "entities": entities}


def match_entities(caller, entities: dict[str, dict], mapping: dict[str, str]) -> tuple[dict[str, str], list[dict]]:
    """Each exported entity: kept (this house has it), mapped (``mapping``, else one of the same domain with the
    same name and room, else the same name alone), or not found."""
    hub = caller.app["hub"]
    reg = hub.registry
    here = set(visible(caller, set(hub.store.states) | set(reg.entries)))
    index: dict[tuple, list[str]] = {}
    for eid in here:
        dom = eid.split(".", 1)[0]
        nm = name_of(hub, eid).casefold()
        area = (reg.areas.get(reg.entity_area.get(eid) or "") or "").casefold()
        index.setdefault((dom, nm, area), []).append(eid)
        index.setdefault((dom, nm), []).append(eid)
    out, missing = {}, []
    for eid, info in entities.items():
        if eid in mapping:
            if mapping[eid] not in here:
                missing.append({"entity_id": eid, "why": f"mapping: {mapping[eid]} is not in this house"})
            else:
                out[eid] = mapping[eid]
            continue
        if eid in here:
            continue
        dom = eid.split(".", 1)[0]
        nm = str((info or {}).get("name") or "").casefold()
        area = str((info or {}).get("area") or "").casefold()
        hits = index.get((dom, nm, area)) or index.get((dom, nm)) or []
        if len(hits) == 1:
            out[eid] = hits[0]
        else:
            missing.append({"entity_id": eid, "name": (info or {}).get("name"), "area": (info or {}).get("area"),
                            "why": "no match" if not hits else f"{len(hits)} of that name: give a mapping"})
    return out, missing


async def screen_import(caller, args: dict) -> dict:
    exp = args["export"]
    if exp.get("mantel_screen") != EXPORT_VERSION or not isinstance(exp.get("board"), dict):
        raise ToolError("invalid_arguments", "export: a screen_export answer (mantel_screen: 1)", {"export": "invalid"})
    mapping, missing = match_entities(caller, exp.get("entities") or {}, dict(args.get("mapping") or {}))
    if missing and not args.get("allow_unmatched"):
        raise ToolError("unmatched", "some of the screen's entities are not in this house: give a `mapping`, or "
                                     "`allow_unmatched: true` to keep them as they are", missing=missing,
                        matched=mapping)
    from hk_core.settings import changes as C
    board = _replace_ids(exp["board"], mapping)
    settings = {k: v for k, v in board.items() if k in C.BOARD and k not in ("where", "title")}
    dropped = sorted(k for k in board if k not in settings and k not in ("where", "title"))
    names = {mapping.get(e, e): n for e, n in (exp.get("names") or {}).items()}
    title = args.get("title") or exp.get("title") or "Imported Screen"
    from ... import screens as SCREENS
    from .screens import _screens_call
    key = SCREENS.free_key(caller.app["settings"].store, title)

    async def run():
        made = await _screens_call(caller, lambda: SCREENS.add(caller.app, caller.principal,
                                                               {"title": title, "where": "mantel"},
                                                               changes=settings or None))
        for eid, nm in sorted(names.items()):
            await save(caller, {"type": "hk_frontend/accessory/set", "entity_id": eid, "name": nm, "screen": key})
        return made
    out = await change(caller, "screen_import", args, run)
    out.update(key=key, matched=mapping, unmatched=missing, dropped_settings=dropped)
    return out


# -- templates -----------------------------------------------------------------------------------------------------
# a template is a starter recipe (hk_core.settings.home_grid.starter), filled from THIS house when it is used, so a
# kitchen template is the house's own kitchen screen, not someone else's entities
TEMPLATES = {
    "kitchen": {"title": "Kitchen", "concept": "A", "about": "Tap Weight: the scene for now, the room and its speaker "
                                                             "big; scenes, cameras, the thermostat and timers below"},
    "hallway": {"title": "Hallway", "concept": "S", "about": "Security & Cameras: the cameras large, the alarm, who's "
                                                             "home, Lock Up and the garage"},
    "family": {"title": "Family", "concept": "F", "about": "Family Hub: clock, weather, who's home, the calendar"},
    "nightstand": {"title": "Nightstand", "concept": "Q", "about": "Essentials: a calm few, the scene for now, the "
                                                                   "room and its thermostat"},
    "guest_room": {"title": "Guest Room", "concept": "R", "about": "Room Focus: the room large, its thermostat and "
                                                                   "speaker beside it"},
    "living_room": {"title": "Living Room", "concept": "M", "about": "Music & Scenes: the speaker and the scenes "
                                                                     "across the top"},
}


async def screen_templates(caller, args: dict) -> dict:
    return {"templates": [{"template": k, **v} for k, v in TEMPLATES.items()]}


async def screen_from_template(caller, args: dict) -> dict:
    t = TEMPLATES.get(args["template"])
    if t is None:
        raise ToolError("invalid_arguments", f"template: one of {list(TEMPLATES)}", {"template": "choice"})
    hub = caller.app["hub"]
    reg = hub.registry
    seen = visible(caller, set(hub.store.states) | set(reg.entries))
    room = reg.resolve_area(args["room"]) if args.get("room") else None
    if args.get("room") and room is None:
        raise ToolError("not_found", f"no room called {args['room']!r}", {"room": "unknown"})
    pick = lambda d: sorted(i for i in seen if i.startswith(d + "."))     # noqa: E731
    options = {"concept": t["concept"], "scenes": pick("scene")[:24], "cameras": pick("camera")[:9],
               "climate": pick("climate")[:6], "rooms": sorted(reg.areas)[:24]}
    if room:
        options["tablet_room"] = room
    grid = (await read(caller, {"type": "hk_frontend/grid/starter", "options": options}))["grid"]
    from ... import screens as SCREENS
    from .screens import _screens_call
    title = args.get("title") or t["title"]

    async def run():
        return await _screens_call(caller, lambda: SCREENS.add(caller.app, caller.principal,
                                                               {"title": title, "where": "mantel"},
                                                               changes={"home_style": "grid", "home_grid": grid}))
    out = await change(caller, "screen_from_template", args, run)
    out["home_grid"] = grid
    return out


# -- a wall tablet, end to end ------------------------------------------------------------------------------------
def base_url(caller) -> str:
    cfg = caller.app.get("cfg")
    req = caller.request
    if req is not None:
        from ...proxy_trust import public_origin
        return public_origin(req)
    return (getattr(cfg, "public_url", "") or "").rstrip("/")


async def tablet_setup(caller, args: dict) -> dict:
    """The tablet's screen (a planned tablet/set), and the one step that stays a person's: enrolling the device."""
    panel = await read(caller, {"type": "hk_frontend/panel/get"})
    tablets = panel.get("tablets") or {}
    tid, screen = args["tablet"], args.get("screen")
    if tid not in tablets:
        raise ToolError("not_found", f"no wall tablet {tid!r} (house_summary lists them; add one in Mantel Settings "
                                     "→ Wall Tablets)", {"tablet": "unknown"}, tablets=sorted(tablets))
    base = base_url(caller)
    steps = {"enrol": {"who": "a person, at the tablet: enrolling trusts a device, so no assistant does it",
                       "open": f"{base}/settings#/mantel/devices/enroll/{tid}",
                       "then": "sign in there as an Owner or Admin and choose Sign In This Browser as the tablet"}}
    if screen is None:
        return {"tablet": tid, "screen": (tablets[tid] or {}).get("screen"), "steps": steps}
    msg = {"type": "hk_frontend/tablet/set", "tablet": tid, "changes": {"screen": screen}}
    out = await change(caller, "tablet_setup", args, lambda: save(caller, msg))
    out["steps"] = steps
    return out


async def screen_preview(caller, args: dict) -> dict:
    from ..preview import make_link
    got = await read(caller, {"type": "mantel/settings/get", "scope": "board", "key": args["screen"]})
    if not got.get("version"):
        raise ToolError("not_found", f"no screen {args['screen']!r}", {"screen": "unknown"})
    return make_link(caller, args["screen"], args.get("width", 1280), args.get("height", 800))


SCREEN = {"type": "string", "maxLength": 80}
TOOLS = [
    Tool("settings_apply", "Several changes as one",
         "Up to 20 changes (each {tool, arguments}: settings_change, accessory_set, screen_*, grid_*, music_*...) "
         "planned together, shown together, applied in order with one plan. Each is planned against the house as "
         "it is now (a new screen's settings and Home Grid go in its screen_create). A refusal while applying stops "
         "the batch and answers what landed and how to undo it.",
         {"steps": {"type": "array", "maxItems": BATCH_MAX,
                    "items": {"type": "object", "properties": {"tool": {"type": "string", "maxLength": 40},
                                                               "arguments": {"type": "object"}},
                              "required": ["tool"], "additionalProperties": False}}},
         settings_apply, needs="settings", required=("steps",), write=True),
    Tool("screen_export", "Export a screen",
         "One screen as a file: its settings, Home Grid, its own accessory names, and every entity it names (with "
         "their names and rooms, for matching in another house). screen_import makes a screen from it.",
         {"screen": SCREEN}, screen_export, needs="screens", required=("screen",)),
    Tool("screen_import", "Import a screen",
         "A new Mantel screen from a screen_export answer. Entities this house doesn't have are matched by name and "
         "room (same domain), or by `mapping` {old: new}; unmatched ones refuse it unless `allow_unmatched`. Planned "
         "first: the plan answer lists what matched, what didn't and settings left out.",
         {"export": {"type": "object"}, "title": {"type": "string", "maxLength": 60},
          "mapping": {"type": "object"}, "allow_unmatched": {"type": "boolean", "default": False}},
         screen_import, needs="screens", required=("export",), write=True),
    Tool("screen_templates", "Screen templates",
         "The template library: kitchen, hallway, family, nightstand, guest room, living room. Each is a Home Grid "
         "recipe filled from this house when used (screen_from_template).", {}, screen_templates, needs="screens"),
    Tool("screen_from_template", "Screen from a template",
         "A new Home Grid screen from a template, filled from this house's scenes, cameras, thermostats and rooms, "
         "for a tablet in `room`. Planned first: the answer shows the layout.",
         {"template": {"type": "string", "maxLength": 40}, "title": {"type": "string", "maxLength": 60},
          "room": {"type": "string", "maxLength": 120}},
         screen_from_template, needs="screens", required=("template",), write=True),
    Tool("tablet_setup", "Set up a wall tablet",
         "A wall tablet's screen (planned first, when `screen` is given), and the link a person opens ON the tablet "
         "to enrol it (an assistant never enrols a device).",
         {"tablet": {"type": "string", "maxLength": 80}, "screen": SCREEN}, tablet_setup, needs="settings",
         required=("tablet",), write=True),
    Tool("screen_preview", "Preview a screen",
         "A one-time link (five minutes) that opens the screen as this person sees it, read-only, in a browser: "
         "open it in your own browser at `width` x `height` to look at what you built. It changes nothing.",
         {"screen": SCREEN, "width": {"type": "integer", "minimum": 320, "maximum": 3840, "default": 1280},
          "height": {"type": "integer", "minimum": 320, "maximum": 2160, "default": 800}},
         screen_preview, needs="screens", required=("screen",)),
]


