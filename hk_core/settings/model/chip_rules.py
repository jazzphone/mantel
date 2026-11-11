"""model.py's custom chips (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any
from .schema import Stored
from .dashboard_rules import CHIP_KINDS
from .popup_rules import popup, SUBENTRY_POPUP
from .custom_page_rules import custom_page, SUBENTRY_PAGE


# ------------------------------------------------------------ custom chips
# A CUSTOM CHIP: a status chip the house writes itself -- its card in YAML,
# anything a chip row can hold (an hk-status-chip-card, or one inside a
# conditional that shows it only sometimes) -- kept as an item of its own and
# shown by any screen that lists it (the board's chips_custom). It sits after
# a kind (`after`), at the start or the end, unless a screen's own chip order
# places it (the token "chip:<key>"). It is what `extra:` on a YAML chip row
# does (a house battery or mail chip, say), written once for every screen.
SUBENTRY_CHIP = "chip"


def taken_ids(stored: Stored, exclude: str | None = None) -> set[str]:
    """Every item's unique id, of EVERY type: Home Assistant refuses a new
    item whose unique id any other item of the entry has, whatever its type.
    Checked per type, a chip named "Energy" beside the Energy page -- or a
    pop-up #alarm beside the Alarm PIN's item -- got a raw already_configured
    ("Couldn't save.") instead of a place of its own."""
    return {s.unique_id for s in stored.items if s.unique_id and s.unique_id != exclude}


CHIP_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

CHIP_TOKEN = "chip:"

CHIP_CARD_MAX = 20000


def chip_card(v: Any) -> dict[str, Any] | None:
    """A custom chip's card as stored -- a mapping with a type, not huge."""
    import json
    if not isinstance(v, dict) or not isinstance(v.get("type"), str) or not v["type"]:
        return None
    try:
        text = json.dumps(v)
    except (TypeError, ValueError):
        return None
    return json.loads(text) if len(text) <= CHIP_CARD_MAX else None


def custom_chip(data: Mapping[str, Any] | None, key: str) -> dict[str, Any]:
    d = dict(data or {})
    after = d.get("after")
    return {"key": key, "name": str(d.get("name") or key).strip()[:40],
            "after": after if after in ("start", "end") or after in CHIP_KINDS else "end",
            "card": chip_card(d.get("card")) or {"type": "custom:hk-status-chip-card", "name": str(d.get("name") or key)}}


def custom_chips(stored: Stored | None) -> list[dict[str, Any]]:
    """Every custom chip, by name."""
    out = [custom_chip(sub.data, sub.unique_id or "")
           for sub in (stored.of(SUBENTRY_CHIP) if stored is not None else ())]
    return sorted(out, key=lambda c: c["name"].lower())


def custom_pages(stored: Stored | None) -> list[dict[str, Any]]:
    """Every custom page, by title."""
    out = [custom_page(sub.data, sub.unique_id or "")
           for sub in (stored.of(SUBENTRY_PAGE) if stored is not None else ())]
    return sorted(out, key=lambda p: p["title"].lower())


def popups(stored: Stored | None) -> list[dict[str, Any]]:
    """Every pop-up, by name."""
    out = [popup(sub.data, sub.unique_id or "")
           for sub in (stored.of(SUBENTRY_POPUP) if stored is not None else ())]
    return sorted(out, key=lambda p: (p["name"] or p["hash"]).lower())
