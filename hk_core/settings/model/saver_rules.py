"""model.py's screensaver options and what a screen is handed (as_client) (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from typing import Any
from .. import kinds
from .schema import discover_rows, Stored
from .pages_screen_rules import CARD_OPTIONS_MAX, merged


def saver_options(v: Any, legacy: Any = None) -> dict[str, Any] | None:
    from ..saver_designs import saver_options as read
    return read(v, legacy)


def card_options(v: Any) -> dict[str, Any] | None:
    """A card's options as stored ({} for none), or None when `v` is not a
    mapping of plain values (the form says so)."""
    import json
    if v in (None, "", {}):
        return {}
    if not isinstance(v, dict):
        return None
    try:
        text = json.dumps(v)
    except (TypeError, ValueError):
        return None
    return json.loads(text) if len(text) <= CARD_OPTIONS_MAX else None


def as_client(stored: Stored | None,
              found: dict[str, list[str]] | None = None,
              accessories: dict[str, Any] | None = None,
              extras: dict[str, Any] | None = None,
              switches: dict[str, str] | None = None,
              blacks: dict[str, str] | None = None) -> dict[str, Any]:
    """What a screen is handed. The same for every user: the house-wide
    sections, and `boards` -- each dashboard item's own menu settings, by
    url path.

    `kinds` (found): Status & Chips, resolved (kinds.py) -- each kind's entity
    ids. The raw Leave out / Also count stay here; a screen needs only the
    answer. The older lists the header and the generated dashboard read
    (security.locks ..., features.thermostats) are the same answer, for a
    screen still running older files."""
    from .chip_rules import custom_chips, custom_pages, popups
    from .menu_rules import boards, legacy_screens
    from .tablet_rules import tablets
    out = {"configured": stored is not None, **merged(stored.options if stored else None)}
    del out["counts"]
    items = boards(stored)
    out["boards"] = items
    # THE TABLETS (1.14): what a page needs to know it is one (hk-settings.js
    # tablet()) and to act as one -- its screen, user, idle, Black Screen, and
    # its own entities by their current ids (screensaver.py; a rename in the
    # UI keeps working). `switches` and `blacks` are keyed by tablet id.
    out["tablet_items"] = {tid: {
        "name": t["name"], "screen": t["screen"], "room": t["room"], "user": t["user"], "app": t["app"],
        "idle_return": t["idle_return"], "idle_time": t["idle_time"], "black_screen": t["black_screen"],
        "screensaver_switch": (switches or {}).get(tid), "black_switch": (blacks or {}).get(tid),
    } for tid, t in tablets(stored).items()}
    if items:
        for section, values in legacy_screens(items).items():
            out[section].update(values)
    # Browse Music's rows go out as the queries themselves, so a screen needs
    # no copy of SHELVES.
    out["browse"]["discover"] = discover_rows(out["browse"]["discover"])
    # Each accessory's settings and each room's tile order (accessories.py).
    out["accessories"] = accessories or {"entities": {}, "rooms": {}, "into": {}, "pages": {}}
    # The optional cards that are installed (the host finds them): url or None.
    out["extras"] = dict(extras or {})
    out["popups"] = popups(stored)
    out["custom_pages"] = custom_pages(stored)
    out["custom_chips"] = custom_chips(stored)
    out["kinds"] = found or {}
    if found:
        for kind, (section, key) in kinds.LEGACY.items():
            out[section][key] = list(found.get(kind) or [])
    return out
