"""model.py's pop-ups (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import copy
import re
from typing import Any


# ------------------------------------------------------------ the pop-ups
# POP-UPS ARE ITEMS TOO: a subentry of type "popup" each, listed
# under Pop-ups on the integration's page. A pop-up is a hash -- `#doorbell`
# on any dashboard's URL opens it, which is how an automation that loads
# `<dashboard>/0#doorbell` on a tablet works -- and what it shows:
#   camera       a camera's sheet, the picture to every edge, with its speaker
#                for talk-back (the doorbell)
#   alarm        the alarm keypad sheet
#   accessories  a sheet of several accessories, the way a room's are shown
#   cards        CUSTOM: the house's own cards, in YAML, on the
#                same sheet -- a narrow one (460) or a wide one (820), with
#                its own glyph in the header
# on every dashboard, or only those listed. A YAML hk-popup-card on the page
# that claims the same hash wins (the card over the house).
SUBENTRY_POPUP = "popup"

POPUP_KINDS = ("camera", "alarm", "accessories", "cards")

POPUP_WIDTHS = ("narrow", "wide")

POPUP_CARDS_MAX = 100000

POPUP_HASH = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")

POPUP_DEFAULTS: dict[str, Any] = {
    "name": "", "kind": "camera", "entity": "", "speaker": "", "stream": "",
    "entities": [], "dashboards": [], "close_after": 60, "cards": [], "icon": "", "width": "narrow"}


def popup_cards(v: Any) -> list[dict[str, Any]] | None:
    """A custom pop-up's cards as stored: a list of cards (a single card, or
    a view's `cards:`, is taken as that list), not huge; None when it is not
    one."""
    import json
    if isinstance(v, dict):
        v = v.get("cards") if isinstance(v.get("cards"), list) and "type" not in v else [v] if v else []
    if v is None or v == "":
        v = []
    if not isinstance(v, list) or not all(isinstance(c, dict) and isinstance(c.get("type"), str) for c in v):
        return None
    try:
        text = json.dumps(v)
    except (TypeError, ValueError):
        return None
    return json.loads(text) if len(text) <= POPUP_CARDS_MAX else None


def slug(text: str) -> str:
    """A pop-up's hash from its name: "Front Door" -> front-door."""
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower().replace("'", "").replace("\u2019", "")).strip("-")
    return s[:40]


def popup(data: Mapping[str, Any] | None, hash_: str = "") -> dict[str, Any]:
    """One pop-up's settings over the defaults, each value checked."""
    out = copy.deepcopy(POPUP_DEFAULTS)
    d = dict(data or {})
    out["hash"] = hash_ if POPUP_HASH.match(hash_ or "") else slug(d.get("name") or "")
    out["name"] = str(d.get("name") or "").strip()[:60]
    out["kind"] = d.get("kind") if d.get("kind") in POPUP_KINDS else "camera"
    ent = lambda v, dom: v if isinstance(v, str) and re.fullmatch(rf"({dom})\.[a-z0-9_]+", v) else ""  # noqa: E731
    out["entity"] = ent(d.get("entity"), "camera" if out["kind"] == "camera" else "alarm_control_panel")
    out["speaker"] = ent(d.get("speaker"), "media_player")
    out["stream"] = ent(d.get("stream"), "camera")
    out["entities"] = [e for e in (d.get("entities") or []) if isinstance(e, str) and "." in e]
    out["dashboards"] = [p for p in (d.get("dashboards") or []) if isinstance(p, str) and p]
    if out["kind"] == "cards":
        out["cards"] = popup_cards(d.get("cards")) or []
        icon = d.get("icon")
        out["icon"] = icon if isinstance(icon, str) and re.fullmatch(r"(mdi|hk):[a-z0-9-]+", icon) else ""
        out["width"] = d.get("width") if d.get("width") in POPUP_WIDTHS else "narrow"
    try:
        out["close_after"] = int(min(max(float(d.get("close_after", 60)), 10), 3600))
    except (TypeError, ValueError):
        pass
    return out
