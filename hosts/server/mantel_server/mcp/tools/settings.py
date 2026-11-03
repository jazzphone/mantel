"""Settings: read a document, learn what a scope accepts, change it (planned first), its history, a restore.

Every change is the Settings page's own save (dispatch.save): ``hk_frontend/settings/set`` for the house,
``hk_frontend/board/set`` for a screen, ``hk_frontend/tablet/set`` for a wall tablet, the accessory saves for one
accessory, ``mantel/settings/restore`` for a restore. ``settings_schema`` is made from hk_core's own check tables
(changes.HOUSE, BOARD, TABLET) and defaults (model.DEFAULTS, BOARD_DEFAULTS, TABLET_DEFAULTS), so what it says a
key accepts is what the check accepts.
"""
from __future__ import annotations

from typing import Any

from ..dispatch import ToolError, change, read, save
from . import NO_ROUTE_RESTORE, NO_ROUTE_SAVE, Tool

SCOPE_KINDS = ("house", "board", "tablet", "user", "music")
CHANGES = {"type": "object", "description": "key -> new value (settings_schema lists the keys)"}


# -- the schema -----------------------------------------------------------------------------------------------------
def _strings(v: Any) -> list[str] | None:
    if isinstance(v, (tuple, list, frozenset, set)) and v and all(isinstance(x, str) for x in v):
        return sorted(v) if isinstance(v, (set, frozenset)) else list(v)
    return None


def describe_check(fn: Any) -> dict:
    """What one hk_core check accepts, read from the check itself (its kind and the values it closes over)."""
    qual = getattr(fn, "__qualname__", type(fn).__name__)
    kind = qual.split(".")[0].lstrip("_") or "value"
    if kind == "<lambda>":
        kind = "value"
    out: dict[str, Any] = {"kind": kind}
    for cell in getattr(fn, "__closure__", None) or ():
        try:
            v = cell.cell_contents
        except ValueError:
            continue
        opts = _strings(v)
        if opts is not None and "choices" not in out:
            out["domains" if kind in ("entity", "entities") else "choices"] = opts
        elif isinstance(v, int) and not isinstance(v, bool) and kind == "text":
            out["max_length"] = v
        elif isinstance(v, str) and kind in ("entity", "entities"):
            out.setdefault("domains", []).append(v)
        elif isinstance(v, bool) and kind == "choice":
            out["none_ok"] = v
    return out


def _default(scope: str, key: str) -> Any:
    from hk_core.settings import model as S
    if scope == "board":
        return S.BOARD_DEFAULTS.get(key)
    if scope == "tablet":
        return S.TABLET_DEFAULTS.get(key)
    section, _, name = key.partition(".")
    sec = S.DEFAULTS.get(section)
    return sec.get(name) if isinstance(sec, dict) else None


def schema(scope: str) -> dict:
    from hk_core.settings import changes as C
    table = {"house": C.HOUSE, "board": C.BOARD, "tablet": C.TABLET}[scope]
    keys = {}
    for key, fn in table.items():
        d = describe_check(fn)
        dv = _default(scope, key)
        if dv is not None and isinstance(dv, (str, int, float, bool, list)) and len(repr(dv)) < 300:
            d["default"] = dv
        keys[key] = d
    return keys


# -- tools -------------------------------------------------------------------------------------------------------
def _doc_args(args: dict) -> tuple[str, str]:
    scope, key = args["scope"], args.get("key")
    if scope == "music":
        return scope, "music"
    if scope == "house":
        return scope, key or "settings"
    if not key:
        raise ToolError("invalid_arguments", f"a {scope} needs its key (a screen's address, a tablet's id)",
                        {"key": "required"})
    return scope, key


async def settings_get(caller, args: dict) -> dict:
    scope, key = _doc_args(args)
    if scope == "music":
        return await read(caller, {"type": "hk_music/settings/get"})
    if scope == "user":
        key = caller.user.id if key in ("me", "") else key
    return await read(caller, {"type": "mantel/settings/get", "scope": scope, "key": key})


async def settings_schema(caller, args: dict) -> dict:
    scope = args["scope"]
    keys = schema(scope)
    prefix = args.get("prefix") or ""
    if prefix:
        keys = {k: v for k, v in keys.items() if k.startswith(prefix)}
    return {"scope": scope, "how": {"house": "settings_change {scope: house, changes: {'section.key': value}}",
                                    "board": "settings_change {scope: board, key: <screen>, changes: {key: value}}",
                                    "tablet": "settings_change {scope: tablet, key: <tablet id>, changes: {key: value}}"}
            [scope], "count": len(keys), "keys": keys}


def change_msg(scope: str, key: str, changes: dict, expect: int | None) -> dict:
    if scope == "house":
        msg = {"type": "hk_frontend/settings/set", "changes": changes}
    elif scope == "board":
        msg = {"type": "hk_frontend/board/set", "dashboard": key, "changes": changes}
    elif scope == "tablet":
        if expect is not None:
            raise ToolError("invalid_arguments", "a tablet's save takes no expect_version", {"expect_version": "unexpected"})
        msg = {"type": "hk_frontend/tablet/set", "tablet": key, "changes": changes}
    else:
        raise ToolError("invalid_arguments", "settings_change: scope house, board or tablet (music: music_* tools)",
                        {"scope": "choice"})
    if expect is not None:
        msg["expect_version"] = expect
    return msg


async def settings_change(caller, args: dict) -> dict:
    scope, key = _doc_args(args)
    if not args["changes"]:
        raise ToolError("invalid_arguments", "changes: at least one key", {"changes": "required"})
    if "home_grid" in args["changes"] and scope == "board" and not caller.has("screens"):
        raise ToolError("forbidden", "a Home Grid is the `screens` scope's (grid_* tools)")
    msg = change_msg(scope, key, dict(args["changes"]), args.get("expect_version"))
    return await change(caller, "settings_change", args, lambda: save(caller, msg))


async def settings_history(caller, args: dict) -> dict:
    scope, key = _doc_args(args)
    if scope == "music":
        scope, key = "house", "music"
    got = await read(caller, {"type": "mantel/settings/history", "scope": scope, "key": key,
                              "limit": args.get("limit", 20), "bodies": False})
    return got


async def settings_restore(caller, args: dict) -> dict:
    scope, key = _doc_args(args)
    if scope == "music":
        scope, key = "house", "music"
    msg = {"type": "mantel/settings/restore", "scope": scope, "key": key, "version": args["version"]}
    return await change(caller, "settings_restore", args, lambda: save(caller, msg))


ACC_FIELDS = ("name", "icon", "show_as", "size", "anim", "status", "home", "room", "color", "when", "label",
              "attribute")


async def accessory_set(caller, args: dict) -> dict:
    eid = args["entity_id"]
    fields = dict(args.get("fields") or {})
    bad = sorted(set(fields) - set(ACC_FIELDS))
    if bad:
        raise ToolError("invalid_arguments", f"fields: unknown {bad} (one of {list(ACC_FIELDS)})", {"fields": "unexpected"})
    steps: list[dict] = []
    if fields:
        msg = {"type": "hk_frontend/accessory/set", "entity_id": eid, **fields}
        if args.get("screen"):
            msg["screen"] = args["screen"]
        steps.append(msg)
    if "hidden" in args:
        steps.append({"type": "hk_frontend/hidden/set", "entity_ids": [eid], "everywhere": bool(args["hidden"])})
    if "favorite" in args:
        fav = args["favorite"]
        steps.append({"type": "hk_frontend/board/favorite", "dashboard": fav["screen"], "entity_id": eid,
                      "favorite": bool(fav["on"])})
    if not steps:
        raise ToolError("invalid_arguments", "say what to change: fields, hidden or favorite")

    async def run():
        return [await save(caller, m) for m in steps]
    return await change(caller, "accessory_set", args, run)


DOC = {"scope": {"type": "string", "enum": list(SCOPE_KINDS)},
       "key": {"type": "string", "maxLength": 120,
               "description": "board: the screen's address; tablet: its id; house: settings (default), "
                              "accessories, popups, custom_pages, custom_chips, setup; user: me"}}
TOOLS = [
    Tool("settings_get", "Read settings",
         "One settings document as stored, with its version: the house's (`house`, key settings/accessories/...), a "
         "screen's (`board`, key = its address), a wall tablet's (`tablet`), your own (`user`, key me), or Music's "
         "(`music`). A screen's whole settings as drawn: screen_get.", DOC, settings_get, required=("scope",)),
    Tool("settings_schema", "What settings accept",
         "Every key a scope's settings_change accepts, with its kind, its allowed values (`choices`), entity domains "
         "and default: made from Mantel's own checks. `prefix` narrows it (house: 'look.', 'clock.'...).",
         {"scope": {"type": "string", "enum": ["house", "board", "tablet"]},
          "prefix": {"type": "string", "maxLength": 80}}, settings_schema, required=("scope",)),
    Tool("settings_change", "Change settings",
         "Change some keys of the house's, a screen's or a wall tablet's settings, checked exactly as Mantel Settings "
         "checks them. Plans first (dry_run): the answer is the diff and a plan; apply with dry_run false and the "
         "plan. A refused key comes back with its field and reason. `expect_version` (house, board): the version you "
         "read; changed meanwhile is a conflict.",
         {**DOC, "scope": {"type": "string", "enum": ["house", "board", "tablet"]}, "changes": CHANGES,
          "expect_version": {"type": "integer", "minimum": 0}},
         settings_change, needs="settings", required=("scope", "changes"), write=True,
         no_route=NO_ROUTE_SAVE),
    Tool("settings_history", "Settings history",
         "A document's versions, newest first: who (and through which assistant), when, the save, and the diff.",
         {**DOC, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
         settings_history, needs="audit", required=("scope",)),
    Tool("settings_restore", "Restore settings",
         "Make a new version of a document from an older one (the undo of any change: each applied change answers "
         "the version it replaced). Planned first.",
         {**DOC, "version": {"type": "integer", "minimum": 1}}, settings_restore, needs="restore",
         required=("scope", "version"), write=True, destructive=True,
         no_route=NO_ROUTE_RESTORE),
    Tool("accessory_set", "Change an accessory",
         "One accessory's settings: `fields` (name, icon, show_as, size, room, color, status, home...; `screen` makes "
         "the name that screen's only), hide it everywhere (`hidden`), or add it to or take it off a screen's "
         "Favorites (`favorite: {screen, on}`). Planned first.",
         {"entity_id": {"type": "string", "maxLength": 255}, "fields": {"type": "object"},
          "screen": {"type": "string", "maxLength": 80}, "hidden": {"type": "boolean"},
          "favorite": {"type": "object", "properties": {"screen": {"type": "string", "maxLength": 80},
                                                        "on": {"type": "boolean"}},
                       "required": ["screen", "on"], "additionalProperties": False}},
         accessory_set, needs="settings", required=("entity_id",), write=True,
         no_route=NO_ROUTE_SAVE),
]
