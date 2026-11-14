"""NOTIFICATIONS ON THE APPLE TVS (phase 31, docs/phase31/PLAN.md), the decision in plain data.

A notification goes to the Apple TVs as a picture: the host draws it, and a HomeKit camera shows it in the corner of
every Apple TV (Home Assistant's HomeKit Bridge, the camera's motion sensor turned on for a moment). This module says

    goes(house, opts, payload)      whether a notification goes to the TVs
    card(house, opts, payload)      what its picture says: look, title, line, caption, glyph, color, snapshot
    darken(color)                   Color's rule: how much a light color is darkened for white type
    test_card(house, opts)          Send Test's card

and the host draws the card (Mantel: cameras/tv_card.py). Nothing here reads a file or draws a pixel.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from ..house import House, area_of
from . import rules
from .const import CONF_DND, CONF_TV, TV_LOOKS
from .dnd import dnd_on
from .settings import tv_options

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
# characters XML 1.0 refuses (an entity's name or an automation's words may carry one): the drawing would fail whole
NOT_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
# white type on Color's gradient: 3:1 at its lightest stop (large text, WCAG), the owner's choice (decision 8)
WHITE_RATIO = 3.0
TITLE_MAX = 40
LINE_MAX = 80


def goes(house: House, opts: Mapping[str, Any], payload: Mapping[str, Any], now: datetime | None = None) -> bool:
    """Whether this notification goes to the Apple TVs: the TVs on, its own Apple TV switch on, and -- while Follows
    Do Not Disturb is on -- not during Do Not Disturb unless it is Important."""
    tv = tv_options(opts.get(CONF_TV))
    if not tv["on"] or payload.get("type") != "notification" or not payload.get("tv"):
        return False
    if tv["dnd"] and not payload.get("important") and dnd_on(house, opts.get(CONF_DND), now):
        return False
    return True


def clock(when: datetime) -> str:
    """6:42 PM, as the Home app writes a time."""
    h = when.hour % 12 or 12
    return "%d:%02d %s" % (h, when.minute, "AM" if when.hour < 12 else "PM")


def room(house: House, entity_id: str | None) -> str:
    """The room an accessory is in, or ""."""
    if not entity_id:
        return ""
    area = area_of(house, house.entity(entity_id))
    return (house.area_name(area) or "") if area else ""


def color_of(tint: Any) -> str:
    return tint.upper() if isinstance(tint, str) and HEX.match(tint) else rules.BLUE.upper()


def clean(text: Any) -> str:
    """One line of words a picture can carry: no characters XML refuses, spaces collapsed."""
    return " ".join(NOT_XML.sub("", str(text or "")).split())


def _short(text: Any, limit: int) -> str:
    s = clean(text)
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0].rstrip(" ,.;:·-")
    return (cut or s[:limit]) + "…"


def card(house: House, opts: Mapping[str, Any], payload: Mapping[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """What the picture says. `look` is the notification's own, else the house's; `caption` its room and time
    ("Critical" first for an Important leak, smoke, CO or alarm); `snapshot` whether the camera's picture is drawn
    (Use Camera Picture on, and the notification has a camera)."""
    tv = tv_options(opts.get(CONF_TV))
    look = payload.get("tv_look") if payload.get("tv_look") in TV_LOOKS else tv["look"]
    kind = str(payload.get("kind") or "state")
    critical = bool(payload.get("important")) and kind in rules.IMPORTANT
    when = house.local_time(now)
    caption = " · ".join(p for p in ("Critical" if critical else "", clean(room(house, payload.get("entity"))), clock(when)) if p)
    icon = payload.get("icon")
    return {
        "look": look,
        "title": _short(payload.get("title"), TITLE_MAX) or "Notification",
        "line": _short(payload.get("message"), LINE_MAX),
        "caption": caption,
        "glyph": icon if isinstance(icon, str) and icon.startswith(("hk:", "mdi:")) else rules.look(kind)[0],
        "kind": kind,
        "color": color_of(payload.get("tint")),
        "critical": critical,
        "snapshot": bool(tv["camera"] and payload.get("camera")),
        "camera": payload.get("camera") or None,
        "snap": payload.get("snap") or None,
    }


def test_card(house: House, opts: Mapping[str, Any], look: str | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Send Test's card: the house's look (or the one asked for), Mantel's bell."""
    tv = tv_options(opts.get(CONF_TV))
    return {"look": look if look in TV_LOOKS else tv["look"], "title": "Apple TV", "line": "Notifications work here",
            "caption": clock(house.local_time(now)), "glyph": "hk:bell", "kind": "event", "color": rules.BLUE.upper(),
            "critical": False, "snapshot": False, "camera": None, "snap": None}


# ---------------------------------------------------------------- Color's rule
def _channel(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = (_channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rgb(color: str) -> tuple[int, int, int]:
    n = int(color_of(color)[1:], 16)
    return n >> 16, (n >> 8) & 255, n & 255


def shade(color: str, k: float) -> str:
    """`color` mixed toward black by `k` (0..1), as #RRGGBB."""
    return "#%02X%02X%02X" % tuple(round(c * (1 - k)) for c in rgb(color))


def contrast_white(color: str) -> float:
    return 1.05 / (luminance(rgb(color)) + 0.05)


def darken(color: str, ratio: float = WHITE_RATIO) -> float:
    """How far toward black Color's gradient starts so white type holds `ratio` against it (0: the color as it is)."""
    k = 0.0
    while k < 0.9 and contrast_white(shade(color, k)) < ratio:
        k = round(k + 0.02, 2)
    return k
