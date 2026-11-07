"""A SIDE PANE STATUS (2026-11-06; the owner: "a custom side pane widget like we have for the custom chip").

The Mail chip on the house is a custom:hk-status-chip-card under a conditional card: an entity, a glyph in a color, a
name and a label, shown only while the mailbox says the mail came. A Status section is that, in the pane
(web/hk/modules/hk-sidepane.js SEC.status): its own options are checked here, the rest of the section (size, place,
tap) as every section's in model.pane_section.

    entity  the entity it says (any domain)
    id      tells two apart -- the same entity, another rule (model.pane_sections: no section twice)
    icon    the glyph's name, "mdi:mailbox", "hk:mailbox-up"; absent, the entity's own
    color   a name from the chips' palette (hkCards.PALETTE.icon); absent, the text's
    name    absent, the entity's name
    label   absent, its state
    show    its rule, the Screensaver's Shows When (saver_layout.py SHOW_OPS): {entity, op, value}, op is / not /
            above / below; absent, whenever the entity can be read. Hidden whenever it doesn't hold.
"""
from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

# no Full: there is nothing more to show
SIZES: dict[str, tuple[str, ...]] = {"status": ("tiny", "less", "more")}
COLORS = ("gray", "white", "yellow", "orange", "red", "pink", "purple", "blue", "cyan", "teal", "mint", "green", "brown")
OPS = ("is", "not", "above", "below")
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
ID = re.compile(r"^[a-z0-9]{1,12}$")
ICON = re.compile(r"^[a-z0-9_-]{1,12}:[a-z0-9_-]{1,64}$")
TEXT = {"name": 40, "label": 64}
OPTIONS = ("entity", "id", "icon", "color", "name", "label", "show")


def show(v: Any) -> dict[str, Any] | None:
    """Its rule, {entity, op, value}, as stored; None when it isn't one."""
    if not isinstance(v, Mapping) or set(v) != {"entity", "op", "value"} or not isinstance(v["entity"], str) \
            or not ENTITY_ID.match(v["entity"]) or v["op"] not in OPS:
        return None
    val = v["value"]
    if isinstance(val, str) and 0 < len(val) <= 64:
        return {"entity": v["entity"], "op": v["op"], "value": val}
    if isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val):
        return {"entity": v["entity"], "op": v["op"], "value": val}
    return None


def option(kind: str, k: str, val: Any) -> Any:
    """One of a Status's own options as stored, or None: not a Status's, or a value it can't use."""
    if kind != "status" or k not in OPTIONS:
        return None
    if k == "entity":
        return val if isinstance(val, str) and ENTITY_ID.match(val) else None
    if k == "id":
        return val if isinstance(val, str) and ID.match(val) else None
    if k == "icon":
        return val if isinstance(val, str) and ICON.match(val) else None
    if k == "color":
        return val if val in COLORS else None
    if k in TEXT:
        t = val.strip() if isinstance(val, str) else ""
        return t if 0 < len(t) <= TEXT[k] and not any(ord(ch) < 32 for ch in t) else None
    return show(val)


def key(s: Mapping[str, Any]) -> tuple[str, str]:
    """What makes a section the same section twice: its kind and entity -- a Status's id, where it has one."""
    return (s["kind"], (s.get("id") if s["kind"] == "status" else None) or s.get("entity", ""))
