"""model.py's wall tablets (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import copy
import re
from typing import Any
from ...sleep import rules as SR
from .schema import BLACK_SCREENS, CONF_DASHBOARD, Stored
from .pages_screen_rules import merged
from .menu_rules import AREA_ID


# ------------------------------------------------------------ wall tablets
# A TABLET (entry 1.14, Wall Tablets): an item of its own -- a subentry of
# type "tablet", keyed by its id (a slug, "living_room") -- apart from the
# screens: a tablet RUNS a screen, and a screen may run on several or none.
# Its own: its name (its device's, so its entities'), the screen, its room
# (an area), the user it signs in as, its kiosk app and that app's device,
# Return to Home When Idle and Idle Time (None: All Tablets'), and how it
# sleeps -- Black Screen and Sleep Screen (hk_core/sleep/rules.py; `sleep.kiosk` is
# always `device`). `uid` is the base of its entities' unique ids: a tablet
# lifted off a screen keeps that screen's path, so its entities keep their
# ids and history. docs/Wall-Tablets.md.
SUBENTRY_TABLET = "tablet"

# kiosk_satellite and fully: a device in Home Assistant (status, actions,
# Sleep Screen with Kiosk Satellite); wallpanel: WallPanel in the browser;
# browser: Just a Browser -- any browser the house says is a tablet
TABLET_APPS = ("kiosk_satellite", "fully", "wallpanel", "browser")

IDLE_TIMES = (30, 50, 60, 120, 300, 0)          # s; 0: never

DEVICE_ID = re.compile(r"^[0-9a-f]{32}$")

USER_NAME = re.compile(r"^[A-Za-z0-9_.@ -]{1,64}$")

RESTART_TIMES_MAX = 4

TABLET_DEFAULTS: dict[str, Any] = {
    "name": "", "screen": "", "room": "", "user": "", "app": "browser", "device": "",
    "idle_return": None, "idle_time": None,
    # Black Screen (asleep): kiosk -- Kiosk Satellite's Black screensaver;
    # hk -- HK Frontend's own black and backlight (switch.<tablet>_black_screen)
    "black_screen": "kiosk",
    # Sleep Screen: WHEN it sleeps and wakes (hk_core/sleep/rules.py SLEEP_DEFAULTS)
    "sleep": None,
    "uid": "",
}


def tablet(data: Mapping[str, Any] | None, tid: str = "") -> dict[str, Any]:
    """One tablet's settings over the defaults, each value checked."""
    out = copy.deepcopy(TABLET_DEFAULTS)
    d = dict(data or {})
    name = str(d.get("name") or "").strip()[:40]
    out["name"] = name or tid.replace("_", " ").title()
    screen = str(d.get("screen") or "").strip()
    out["screen"] = screen if re.fullmatch(r"[a-z0-9_-]{1,80}", screen) else ""
    room = str(d.get("room") or "").strip()
    out["room"] = room if AREA_ID.match(room) else ""
    user = str(d.get("user") or "").strip()
    out["user"] = user if USER_NAME.match(user) else ""
    out["app"] = d["app"] if d.get("app") in TABLET_APPS else TABLET_DEFAULTS["app"]
    dev = str(d.get("device") or "").strip()
    out["device"] = dev if DEVICE_ID.match(dev) else ""
    out["idle_return"] = d["idle_return"] if isinstance(d.get("idle_return"), bool) else None
    it = d.get("idle_time")
    out["idle_time"] = it if isinstance(it, int) and not isinstance(it, bool) and it in IDLE_TIMES else None
    out["black_screen"] = d["black_screen"] if d.get("black_screen") in BLACK_SCREENS else "kiosk"
    out["sleep"] = SR.sleep_options(d.get("sleep")) or SR.sleep_options(None)
    out["sleep"]["kiosk"] = out["device"] if out["app"] == "kiosk_satellite" else ""
    uid = str(d.get("uid") or "").strip()
    out["uid"] = uid if re.fullmatch(r"[a-z0-9_-]{1,80}", uid) else (f"tablet_{tid}" if tid else "")
    return out


def tablets(stored: Stored | None) -> dict[str, dict[str, Any]]:
    """Every tablet, by id, with All Tablets' Idle settings filled in where
    its own are None (`idle_return_own`, `idle_time_own`: what it says
    itself)."""
    out: dict[str, dict[str, Any]] = {}
    house = merged(stored.options if stored is not None else None)["tablets"]
    for sub in (stored.of(SUBENTRY_TABLET) if stored is not None else ()):
        t = tablet(sub.data, sub.unique_id)
        t["idle_return_own"], t["idle_time_own"] = t["idle_return"], t["idle_time"]
        if t["idle_return"] is None:
            t["idle_return"] = bool(house.get("idle_return", True))
        if t["idle_time"] is None:
            t["idle_time"] = house_idle_time(house)
        out[sub.unique_id] = t
    return out


def house_idle_time(house: Mapping[str, Any]) -> int:
    v = house.get("idle_time")
    return v if isinstance(v, int) and not isinstance(v, bool) and v in IDLE_TIMES else 50


def tablet_id(name: str, taken: set[str]) -> str:
    """A new tablet's id from its name: "Living Room" -> living_room, with
    _2, _3 ... when taken."""
    base = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")[:36] or "tablet"
    if not base[0].isalnum():
        base = "t" + base
    tid, n = base, 2
    while tid in taken:
        tid, n = f"{base}_{n}", n + 1
    return tid


def tablets_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]],
                   titles: Mapping[str, str], areas: set[str] | None = None
                   ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Entry 1.13 -> 1.14: each screen that was a wall tablet -- a Tablet
    User, or HK's screensaver with a Tablet Room -- becomes a tablet of its
    own, and the screen keeps only what it shows. Returns (new options or
    None, every screen's data, {tablet id: its data}).

    A tablet: the screen's title for its name, its Tablet Room for its id and
    (if that area exists) its room, its Tablet User, Kiosk Satellite when its
    Sleep Screen named a kiosk (that device), the screen's Return to Home When
    Idle, Black Screen and Sleep Screen, and the screen's path as its
    entities' base (their ids and history stay). All Tablets' Idle Time is
    50 s: the house's helpers said Auto, 10 s before the room's idle time --
    60 s by default."""
    out_items: dict[str, dict[str, Any]] = {}
    made: dict[str, dict[str, Any]] = {}
    for path, d in items.items():
        d = dict(d)
        user = str(d.get("tablet_user") or "").strip()
        room = str(d.get("idle_room") or "").strip()
        if user or (d.get("screensaver") and room):
            sl = SR.sleep_options(d.get("sleep")) or SR.sleep_options(None)
            dev = sl.get("kiosk") or ""
            tid = tablet_id(room or titles.get(path) or path, set(made))
            made[tid] = tablet({
                "name": titles.get(path) or path, "screen": path,
                "room": room if (areas is None or room in areas) else "",
                "user": user, "app": "kiosk_satellite" if dev else "browser", "device": dev,
                "idle_return": None if d.get("idle_return") else False, "idle_time": None,
                "black_screen": d.get("black_screen"), "sleep": sl, "uid": path}, tid)
        for k in ("tablet_user", "idle_room", "idle_return", "sleep", "black_screen"):
            d.pop(k, None)
        out_items[path] = d
    new_options = None
    if made:
        stored = dict((options or {}).get(CONF_DASHBOARD) or {})
        tabs = {**(stored.get("tablets") or {}), "idle_time": 50}
        new_options = {**(options or {}), CONF_DASHBOARD: {**stored, "tablets": tabs}}
    return new_options, out_items, made
