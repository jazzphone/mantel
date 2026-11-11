"""model.py's custom pages (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any
from .dashboard_rules import PAGE_BROWSE, PAGE_KINDS


# ------------------------------------------------------------ custom pages
# A CUSTOM PAGE: a page the house writes itself -- its cards in YAML -- kept
# by the integration as an item of its own (like a pop-up) and shown by any
# generated dashboard that lists it on its Pages page. An Energy page, say,
# lives here rather than in a hand-written dashboard, so no screen depends on
# a YAML file. Its address is the view
# path (and the item's unique id): not one a generated page uses itself, not a
# room page's.
SUBENTRY_PAGE = "page"

PAGE_PATH = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

PAGE_RESERVED = ("home", "weather", "calendar", "cameras", "live-tv", "security", "doors-windows", "climate", "lights",
                 "timers", "vacuums", "playmusic", "music-browse", "water")

PAGE_VIEW_MAX = 300000

PAGE_OWN_KEYS = ("title", "path", "icon")


def page_path_ok(path: str) -> bool:
    return bool(PAGE_PATH.match(path or "")) and path not in PAGE_RESERVED and not path.startswith("room-")


def page_order(keys: list[str]) -> list[str]:
    """A dashboard's page list: page kinds, Browse Music and custom page
    addresses, each once, in the order given."""
    out: list[str] = []
    for k in keys:
        if k in out:
            continue
        if k in PAGE_KINDS or k == PAGE_BROWSE or page_path_ok(k):
            out.append(k)
    return out


def page_view(v: Any) -> dict[str, Any] | None:
    """A page's view as stored -- a mapping, not huge -- less what the page
    keeps itself (its title, address and icon); None when it is not one."""
    import json
    if v in (None, "", {}):
        return {"cards": []}
    if not isinstance(v, dict):
        return None
    try:
        text = json.dumps(v)
    except (TypeError, ValueError):
        return None
    if len(text) > PAGE_VIEW_MAX:
        return None
    out = json.loads(text)
    for k in PAGE_OWN_KEYS:
        out.pop(k, None)
    return out


def custom_page(data: Mapping[str, Any] | None, path: str) -> dict[str, Any]:
    d = dict(data or {})
    icon = d.get("icon")
    return {"path": path, "title": str(d.get("title") or path).strip()[:40],
            "icon": icon if isinstance(icon, str) and re.fullmatch(r"(mdi|hk):[a-z0-9-]+", icon) else "",
            "view": page_view(d.get("view")) or {"cards": []}}
