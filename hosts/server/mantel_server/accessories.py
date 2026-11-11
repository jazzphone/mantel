"""ACCESSORY SETTINGS, MANTEL'S SIDE: how one thing shows up on the screens (a detail sheet's gear, HK Settings ->
Accessories), kept in Mantel's settings store as ``house/accessories`` (imported once from HK Frontend's
``.storage/hk_frontend.accessories`` with the rest of HK's settings, P3.5) and changed here, never in Home
Assistant (docs/phase9/MANTEL-LINK.md "Parity": HK Frontend can be removed).

Ported line for line from HK Frontend's ``accessories.py`` (its checks and its five changes), without Home
Assistant: the document is the same ``{entities, rooms, into, pages, scenes}``, each value checked the same way, so
a screen draws exactly what it drew from HA's feed. The saves themselves (shape, RBAC ``configure`` on settings, a
new version with who and why) are settings_store.SettingsService's; this module only works out the new document.

Pure: nothing here is written, sent, or read from Home Assistant.
"""
from __future__ import annotations

import copy
from typing import Any
# What a field may say is shared with Home Assistant (hk_core/settings/accessory_fields.py).
from hk_core.settings.accessory_fields import (  # noqa: F401 -- shared
    ANIMS, AREA, ATTR, COLORS, ENTITY, FAV_WITH_MAX, FIELDS, ICON, PAGE_ORDERS, PATH, SHOW_AS, SIZES, _ids, blank, clean_entity)

IDS_MAX = 500
# each field's own check as HK Frontend's websocket schema had it (accessory/set): (kind, limit or choices)
_SCHEMA: dict[str, tuple[str, Any]] = {
    "name": ("text", 60), "icon": ("match", ICON), "show_as": ("in", SHOW_AS), "size": ("in", SIZES),
    "anim": ("in", ANIMS), "status": ("bool", None), "home": ("bool", None), "room": ("bool", None),
    "color": ("in", COLORS), "when": ("text", 60), "label": ("text", 40), "attribute": ("match", ATTR),
    "fav_name": ("text", 60), "fav_icon": ("match", ICON), "fav_with": ("ids", FAV_WITH_MAX),
    "fav_room": ("text", 40), "on_text": ("text", 30), "off_text": ("text", 30), "ha_name": ("bool", None),
}


def clean(data: Any) -> dict[str, Any]:
    """The whole document, checked (accessories.clean)."""
    data = data if isinstance(data, dict) else {}
    ents = {}
    for eid, v in (data.get("entities") or {}).items():
        if isinstance(eid, str) and ENTITY.match(eid):
            c = clean_entity(v)
            if c:
                ents[eid] = c
    rooms = {}
    for area, ids in (data.get("rooms") or {}).items():
        if isinstance(area, str) and AREA.match(area) and isinstance(ids, list):
            seen = _ids(ids)
            if seen:
                rooms[area] = seen
    into = {a: b for a, b in (data.get("into") or {}).items()
            if isinstance(a, str) and isinstance(b, str) and AREA.match(a) and AREA.match(b) and a != b}
    # one level only: a room shown inside one that is itself inside another goes straight to the outer one
    into = {a: into.get(b, b) for a, b in into.items() if into.get(b, b) != a}
    pages = {k: _ids(v) for k, v in (data.get("pages") or {}).items() if k in PAGE_ORDERS}
    pages = {k: v for k, v in pages.items() if v}
    # a room's scenes row: its own list, kept EMPTY too (an empty list is "no row", not "automatic")
    scenes = {a: _ids(v) for a, v in (data.get("scenes") or {}).items()
              if isinstance(a, str) and AREA.match(a) and isinstance(v, list)}
    return {"entities": ents, "rooms": rooms, "into": into, "pages": pages, "scenes": scenes}


class Refused(ValueError):
    """A change HK Frontend's schema would have refused: ``fields`` {field: code}."""

    def __init__(self, fields: dict[str, str]) -> None:
        super().__init__(", ".join(f"{k}: {v}" for k, v in fields.items()))
        self.fields = fields


def _entity(v: Any, field: str = "entity_id") -> str:
    if not isinstance(v, str) or not ENTITY.match(v):
        raise Refused({field: "invalid"})
    return v


def _area(v: Any, field: str = "area_id") -> str:
    if not isinstance(v, str) or not AREA.match(v):
        raise Refused({field: "invalid"})
    return v


def _entity_list(v: Any, field: str = "entities") -> list[str]:
    if not isinstance(v, list) or len(v) > IDS_MAX or not all(isinstance(i, str) and ENTITY.match(i) for i in v):
        raise Refused({field: "invalid"})
    return list(v)


def check_fields(changes: dict[str, Any]) -> None:
    """accessory/set's fields as HK Frontend's schema checked them: each None (back to automatic) or of its kind."""
    bad: dict[str, str] = {}
    for k, v in changes.items():
        kind, arg = _SCHEMA[k]
        if v is None:
            continue
        ok = ((kind == "text" and isinstance(v, str) and len(v) <= arg)
              or (kind == "match" and isinstance(v, str) and bool(arg.match(v)))
              or (kind == "in" and v in arg)
              or (kind == "bool" and isinstance(v, bool))
              or (kind == "ids" and isinstance(v, list) and len(v) <= arg
                  and all(isinstance(i, str) and ENTITY.match(i) for i in v)))
        if not ok:
            bad[k] = "invalid"
    if bad:
        raise Refused(bad)


# -- the five changes (accessories.Accessories), each on a copy of the document -----------------------------------
def set_one(doc: Any, entity_id: Any, changes: dict[str, Any], screen: Any = None) -> tuple[dict, dict]:
    """(the new document, the accessory's new settings). A key set to None (or True for status/home/room) goes back
    to automatic; ``screen`` with ``name``: the name on that dashboard only."""
    eid = _entity(entity_id)
    if screen is not None and (not isinstance(screen, str) or not PATH.match(screen)):
        raise Refused({"screen": "invalid"})
    check_fields(changes)
    data = clean(copy.deepcopy(doc))
    cur = dict(data["entities"].get(eid) or {})
    for k, v in changes.items():
        if k == "name" and screen:
            names = dict(cur.get("names") or {})
            if isinstance(v, str) and v.strip():
                names[screen] = v
            else:
                names.pop(screen, None)
            cur["names"] = names
        elif k in FIELDS:
            if k == "fav_with" and isinstance(v, list):
                v = [x for x in v if x != eid]          # never with itself
            if v is None or (k in ("status", "home", "room") and v is True) or (k == "ha_name" and v is not True):
                cur.pop(k, None)
            else:
                cur[k] = v
    new = clean_entity(cur)
    if new:
        data["entities"][eid] = new
    else:
        data["entities"].pop(eid, None)
    return data, new


def set_many(doc: Any, changes: dict[str, dict[str, Any]]) -> dict:
    """Several accessories at once (Hidden Accessories), one new document."""
    data = clean(copy.deepcopy(doc))
    for eid, ch in changes.items():
        data, _ = set_one(data, eid, ch)
    return data


def order(doc: Any, area_id: Any, entities: Any) -> tuple[dict, list[str]]:
    """A room's tiles in this order (an empty list: the automatic order)."""
    area, ids = _area(area_id), _entity_list(entities)
    data = clean(copy.deepcopy(doc))
    ids = clean({"rooms": {area: ids}})["rooms"].get(area, [])
    if ids:
        data["rooms"][area] = ids
    else:
        data["rooms"].pop(area, None)
    return data, ids


def into(doc: Any, area_id: Any, target: Any) -> tuple[dict, dict[str, str]]:
    """Show ``area_id`` as part of ``target`` (None: its own room again)."""
    area = _area(area_id)
    if target is not None:
        _area(target, "into")
    data = clean(copy.deepcopy(doc))
    cur = dict(data.get("into") or {})
    if target and target != area:
        cur[area] = target
    else:
        cur.pop(area, None)
    data["into"] = clean({"into": cur})["into"]
    return data, data["into"]


def page_order(doc: Any, page: Any, entities: Any) -> tuple[dict, list[str]]:
    """A category page's order (an empty list: automatic, A to Z)."""
    if page not in PAGE_ORDERS:
        raise Refused({"page": "choice"})
    ids = _ids(_entity_list(entities))
    data = clean(copy.deepcopy(doc))
    pages = dict(data.get("pages") or {})
    if ids:
        pages[page] = ids
    else:
        pages.pop(page, None)
    data["pages"] = pages
    return data, ids


def room_scenes(doc: Any, area_id: Any, entities: Any) -> tuple[dict, list[str] | None]:
    """A room's scenes row: these, in this order ([]: no row), or None: Automatic again."""
    area = _area(area_id)
    data = clean(copy.deepcopy(doc))
    cur = dict(data.get("scenes") or {})
    if entities is None:
        cur.pop(area, None)
    else:
        cur[area] = _ids(_entity_list(entities))
    data["scenes"] = cur
    return data, cur.get(area)
