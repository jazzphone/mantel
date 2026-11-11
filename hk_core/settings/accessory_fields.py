"""What an accessory's saved settings may hold, once: the words and patterns each field is checked against, and the
cleaning of one entity's entry.

Shared by HK Frontend (hk_frontend/accessories.py, which stores them in Home Assistant) and Mantel Server
(accessories.py, which stores them in its settings document). The two hosts store and answer differently; the rules
for what a field may say are these.
"""
from __future__ import annotations

import re
from typing import Any

SHOW_AS = ("light", "fan", "switch", "outlet")
SIZES = ("regular", "tall")
ANIMS = ("spin", "none")
COLORS = ("white", "yellow", "orange", "red", "pink", "purple", "blue", "teal", "mint", "green")
ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
ICON = re.compile(r"^(hk|mdi):[a-z0-9-]+$")
AREA = re.compile(r"^[a-z0-9_]+$")
PATH = re.compile(r"^[a-z0-9_-]+$")
PAGE_ORDERS = ("vacuums", "security")
ATTR = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,59}$")
FIELDS = ("name", "icon", "show_as", "size", "anim", "status", "home", "room", "color", "when", "label", "attribute",
          "fav_name", "fav_icon", "fav_with", "fav_room", "on_text", "off_text", "ha_name")
FAV_WITH_MAX = 8


def blank() -> dict[str, Any]:
    return {"entities": {}, "rooms": {}, "into": {}, "pages": {}, "scenes": {}}


def _ids(v: Any) -> list[str]:
    seen: list[str] = []
    for i in v if isinstance(v, list) else []:
        if isinstance(i, str) and ENTITY.match(i) and i not in seen:
            seen.append(i)
    return seen


def clean_entity(v: Any) -> dict[str, Any]:
    """One accessory's stored settings, each value checked; empty ones gone."""
    v = v if isinstance(v, dict) else {}
    out: dict[str, Any] = {}
    name = v.get("name")
    if isinstance(name, str) and name.strip():
        out["name"] = name.strip()[:60]
    icon = v.get("icon")
    if isinstance(icon, str) and ICON.match(icon):
        out["icon"] = icon
    if v.get("show_as") in SHOW_AS:
        out["show_as"] = v["show_as"]
    if v.get("size") in SIZES:
        out["size"] = v["size"]
    if v.get("anim") in ANIMS:
        out["anim"] = v["anim"]
    if v.get("color") in COLORS:
        out["color"] = v["color"]
    for k, n in (("when", 60), ("label", 40), ("on_text", 30), ("off_text", 30), ("fav_room", 40)):
        if isinstance(v.get(k), str) and v[k].strip():
            out[k] = v[k].strip()[:n]
    # as a chip: an attribute shown in place of the state
    if isinstance(v.get("attribute"), str) and ATTR.match(v["attribute"].strip()):
        out["attribute"] = v["attribute"].strip()
    for k in ("status", "home", "room"):
        if v.get(k) is False:
            out[k] = False
    # ALSO RENAME IN HOME ASSISTANT: kept only while on
    if v.get("ha_name") is True:
        out["ha_name"] = True
    fav_name = v.get("fav_name")
    if isinstance(fav_name, str) and fav_name.strip():
        out["fav_name"] = fav_name.strip()[:60]
    fav_icon = v.get("fav_icon")
    if isinstance(fav_icon, str) and ICON.match(fav_icon):
        out["fav_icon"] = fav_icon
    fav_with = v.get("fav_with")
    if isinstance(fav_with, list):
        ids: list[str] = []
        for i in fav_with:
            if isinstance(i, str) and ENTITY.match(i) and i not in ids and len(ids) < FAV_WITH_MAX:
                ids.append(i)
        if ids:
            out["fav_with"] = ids
    names = v.get("names")
    if isinstance(names, dict):
        n = {p: s.strip()[:60] for p, s in names.items()  # type: ignore[assignment]
             if isinstance(p, str) and PATH.match(p) and isinstance(s, str) and s.strip()}
        if n:
            out["names"] = n
    return out
