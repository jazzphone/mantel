"""model.py's menus, accents and the older shapes lifted to the current ones (settings_tidied) (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import json
import re
from typing import Any
from .schema import (ACCENT_HEX, ACCENTS, CONF_DASHBOARD, DOCK_MIN, MENU_GLYPHS, STATUS_KINDS, STATUS_KINDS_ADDED,
    STATUS_ROWS, Stored, tab_position,)
from .defaults import DEFAULTS, KIOSK_ENGINES
from .pages_screen_rules import merged
from .side_pane_rules import pane_resolved
from .dashboard_rules import (board, BOARD_BUTTON_PHONE, BOARD_DEFAULTS, BOARD_HOME_ROOMS, BOARD_MENU_ROOMS,
    BOARD_MENUS, BOARD_NARROW, BOARD_PAGE_ROOMS, BOARD_PHONE_MENUS, BOARD_TAB_SIZES, BOARD_TIME, ENTITY_ID, HA_PLACES,
    kiosk_from_plugin, SCREEN_PRESETS, SUBENTRY_DASHBOARD, TAB_BAR_FOLD, tab_bar_glass, TAB_BAR_LABELS, TAB_BAR_MORE,
    TAB_BAR_POS, tab_bar_rooms, TAB_BAR_SCROLLS, TAB_BAR_SIZES, TAB_BAR_START, TAB_BAR_TABS_PHONE, tab_count,)


# A SCREEN'S ROOM SETTINGS and All Screens' (settings `rooms`) they follow
# unless the screen sets its own (rooms_custom)
ROOM_KEYS = {"room_order": "order", "home_rooms": "home", "menu_rooms": "menu", "page_rooms": "pages"}

# A SCREEN'S MENU KEYS and All Screens' (settings `menu`) they follow. `menu`
# is special: off and always open are the screen's own, and only a button's
# style follows (MENU_STYLES).
PAGE_HEADERS = ("current", "smart", "none")

MENU_KEYS = {"page_header": "page_header", "menu": "style", "tab_position": "tab_at", "tab_size": "tab_size",
             "tab_size_phone": "tab_size_phone", "dock_min": "open_min", "time_weather": "time_weather_at",
             "ha_row": "ha_row", "ha_place": "ha_at", "accent": "accent", "glyph": "glyph", "clock": "clock", "swipe": "swipe",
             "tab_bar_scroll": "bar_scroll", "tab_bar_rooms": "bar_rooms", "tab_bar_glass": "bar_glass",
             "tab_bar_more": "bar_more", "tab_bar_more_phone": "bar_more_phone", "tab_bar_pos": "bar_pos",
             "tab_bar_fold": "bar_fold", "tab_bar_start": "bar_start", "tab_bar_adjust": "bar_adjust",
             "tab_bar_scroll_phone": "bar_scroll_phone", "tab_bar_tabs": "bar_tabs",
             "tab_bar_tabs_rail": "bar_tabs_rail", "tab_bar_size": "bar_size", "tab_bar_labels": "bar_labels",
             "tab_bar_tabs_phone": "bar_tabs_phone", "tab_bar_strip": "bar_strip",
             "button_phone": "button_phone", "tab_bar_rooms_phone": "bar_rooms_phone"}

# a menu BUTTON's styles: not off, always open or the tab bar
MENU_STYLES = tuple(m for m in BOARD_MENUS if m not in ("off", "open", "tabbar"))


def page_accents(v: Any) -> dict[str, str] | None:
    """Each page's highlight as stored ({page kind: accent}); None when it
    can't be read. A key or color that isn't one is left out."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    out = {}
    for k, c in v.items():
        a = accent(c)
        if isinstance(k, str) and re.match(r"^[a-z][a-z_]{1,29}$", k) and a and a != "auto":
            out[k] = a
    return out


def accent(v: Any) -> str | None:
    """A menu highlight as stored: a name in ACCENTS, "auto" (each page its
    own color, hk-base.js PAGE_ACCENTS -- 2026-10-16) or "#rrggbb" (lower
    case); None for anything else."""
    t = str(v or "").strip().lower()
    return t if t in ACCENTS or t == "auto" or ACCENT_HEX.match(t) else None


def house_menu(menu: Mapping[str, Any] | None) -> dict[str, Any]:
    """All Screens' menu settings, each checked, as a screen's keys (`menu`
    is the button style)."""
    m = dict(menu or {})
    d = BOARD_DEFAULTS
    pick = lambda k, allowed, dflt: m.get(k) if m.get(k) in allowed else dflt  # noqa: E731
    t = tab_position(m.get("tab_at"))
    try:
        dock = int(min(max(float(m.get("open_min") or 1000), DOCK_MIN[0]), DOCK_MIN[1]))
    except (TypeError, ValueError):
        dock = d["dock_min"]
    return {"page_header": pick("page_header", PAGE_HEADERS, "current"),
            "menu": pick("style", MENU_STYLES, "auto"),
            "tab_position": t if t is not None else "",
            "tab_size": pick("tab_size", BOARD_TAB_SIZES, d["tab_size"]),
            "tab_size_phone": pick("tab_size_phone", BOARD_TAB_SIZES, d["tab_size_phone"]),
            "dock_min": dock,
            "time_weather": pick("time_weather_at", BOARD_TIME, d["time_weather"]),
            "ha_row": bool(m.get("ha_row", False)),
            "ha_place": pick("ha_at", HA_PLACES, d["ha_place"]),
            "accent": accent(m.get("accent")) or d["accent"],
            "glyph": pick("glyph", MENU_GLYPHS, d["glyph"]),
            "clock": m.get("clock") is not False,
            "swipe": m.get("swipe") is True,
            "tab_bar_scroll": pick("bar_scroll", TAB_BAR_SCROLLS, d["tab_bar_scroll"]),
            "tab_bar_rooms": tab_bar_rooms(m.get("bar_rooms")),
            "tab_bar_glass": tab_bar_glass(m.get("bar_glass")),
            "tab_bar_more": pick("bar_more", TAB_BAR_MORE, d["tab_bar_more"]),
            "tab_bar_more_phone": pick("bar_more_phone", TAB_BAR_MORE, d["tab_bar_more_phone"]),
            "tab_bar_pos": pick("bar_pos", TAB_BAR_POS, d["tab_bar_pos"]),
            "tab_bar_fold": pick("bar_fold", TAB_BAR_FOLD, d["tab_bar_fold"]),
            "tab_bar_start": pick("bar_start", TAB_BAR_START, d["tab_bar_start"]),
            "tab_bar_adjust": m.get("bar_adjust") is not False,
            "tab_bar_scroll_phone": pick("bar_scroll_phone", TAB_BAR_SCROLLS, d["tab_bar_scroll_phone"]),
            "tab_bar_tabs": tab_count(m.get("bar_tabs")), "tab_bar_tabs_rail": tab_count(m.get("bar_tabs_rail")),
            "tab_bar_tabs_phone": tab_count(m.get("bar_tabs_phone"), 3, TAB_BAR_TABS_PHONE),
            "tab_bar_size": pick("bar_size", TAB_BAR_SIZES, d["tab_bar_size"]),
            "tab_bar_labels": pick("bar_labels", TAB_BAR_LABELS, d["tab_bar_labels"]),
            "tab_bar_strip": m.get("bar_strip") is not False,
            "button_phone": pick("button_phone", BOARD_BUTTON_PHONE, d["button_phone"]),
            "tab_bar_rooms_phone": tab_bar_rooms(m.get("bar_rooms_phone"))}


AREA_ID = re.compile(r"^[a-z0-9_]+$")


def house_rooms(rooms: Mapping[str, Any] | None) -> dict[str, Any]:
    """All Screens' room settings, each checked, as a screen's keys."""
    r = dict(rooms or {})
    order = [a for a in r.get("order") or [] if isinstance(a, str) and AREA_ID.match(a)] \
        if isinstance(r.get("order"), list) else []
    return {"room_order": list(dict.fromkeys(order)),
            "home_rooms": r.get("home") if r.get("home") in BOARD_HOME_ROOMS else BOARD_DEFAULTS["home_rooms"],
            "menu_rooms": r.get("menu") if r.get("menu") in BOARD_MENU_ROOMS else BOARD_DEFAULTS["menu_rooms"],
            "page_rooms": r.get("pages") if r.get("pages") in BOARD_PAGE_ROOMS else BOARD_DEFAULTS["page_rooms"]}


def house_cameras(order: Any) -> list[str]:
    """All Screens' cameras, checked, as a screen's `cameras`."""
    if not isinstance(order, list):
        return []
    return list(dict.fromkeys(str(x) for x in order if isinstance(x, str) and ENTITY_ID.match(x)))


def resolved(b: Mapping[str, Any], options: Mapping[str, Any] | None,
             house: Mapping[str, Any] | None = None, rooms: Mapping[str, Any] | None = None,
             menu: Mapping[str, Any] | None = None, cameras: list[str] | None = None,
             pane: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """A screen's settings as READ: a null screensaver_options filled in with
    All Screens' (`house`, or read from `options`), and `screensaver_house`
    saying which it is; its rooms, All Screens' (`rooms`, or read from
    `options`) unless it sets its own, `rooms_house` saying which; and its
    menu settings the same way (`menu`, `menu_house`) -- off and always open
    staying the screen's own; and its cameras, All Screens' (`cameras`, or
    read from `options`) unless it sets its own, `cameras_house` saying
    which."""
    out = dict(b)
    own = b.get("screensaver_options")
    if own is None and house is None:
        house = merged(options)["look"]["saver"]
    out["screensaver_house"] = own is None
    out["screensaver_options"] = dict(house) if own is None else own
    out["rooms_house"] = not b.get("rooms_custom")
    if out["rooms_house"]:
        out.update(house_rooms(merged(options)["rooms"] if rooms is None else rooms))
    out["cameras_house"] = not b.get("cameras_custom")
    if out["cameras_house"]:
        out["cameras"] = house_cameras(merged(options)["cameras"]["order"] if cameras is None else cameras)
    # THE MENU, ONE SETTING AT A TIME (entry 1.17): each key the screen
    # doesn't list in menu_own is All Screens'; menu_house says it follows
    # All Screens in everything
    own = set(menu_own(b))
    out["menu_house"] = not own
    hm = house_menu(merged(options)["menu"] if menu is None else menu)
    style = hm.pop("menu")
    out.update({k: v for k, v in hm.items() if k not in own})
    if "menu" not in own and out.get("menu") in MENU_STYLES:
        out["menu"] = style
    # THE SIDE PANE AS READ (side_pane_read): each group the screen's own or
    # All Screens' (`pane`, or read from `options`), its `own` saying which;
    # side_pane stays the screen's own, as stored
    out["side_pane_read"] = pane_resolved(merged(options)["side_pane"] if pane is None else pane, b.get("side_pane"))
    return out


def menu_own(d: Mapping[str, Any] | None) -> list[str]:
    """Which of a screen's menu settings are its own (MENU_KEYS order), as
    stored: its menu_own; a screen still stored with menu_custom (before
    entry 1.17, not moved yet -- menu_per_setting) owns them all, as it
    did."""
    d = d or {}
    v = d.get("menu_own")
    if isinstance(v, list):
        return [k for k in MENU_KEYS if k in v]
    return list(MENU_KEYS) if d.get("menu_custom") is True else []


def menu_per_setting(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                     ) -> dict[str, dict[str, Any]]:
    """THE MENU FOLLOWS ALL SCREENS ONE SETTING AT A TIME (entry 1.17,
    2026-10-29), as Appearance does. A screen that had its own menu
    (menu_custom) keeps as its own only the settings that differ from All
    Screens'; those equal to All Screens' follow them again. A screen that
    followed keeps following. A menu setting a screen doesn't own isn't
    kept (HA's resolved answer baked All Screens' into them), and
    menu_custom goes. Nothing any screen shows changes. -> {path: new item
    data}."""
    house = house_menu(merged(options)["menu"])
    out = {}
    for p, d in items.items():
        data = dict(d)
        custom = data.pop("menu_custom", None) is True
        listed = d.get("menu_own") if isinstance(d.get("menu_own"), list) else None
        if listed is not None and set(listed) != set(MENU_KEYS):
            own = [k for k in MENU_KEYS if k in listed]
        elif custom or listed is not None:
            # (every one listed: menu_custom as an older entry's 1.15 trim
            # wrote it down -- compared the same way)
            b = board(data)
            own = [k for k in MENU_KEYS
                   if (b[k] in MENU_STYLES and b[k] != house[k] if k == "menu"
                       else json.dumps(b[k]) != json.dumps(house[k]))]
        else:
            own = []
        for k in MENU_KEYS:
            if k != "menu" and k not in own:
                data.pop(k, None)
        data.pop("menu_own", None)
        if own:
            data["menu_own"] = own
        out[p] = data
    return out


def preset_menu(data: Mapping[str, Any], preset: Mapping[str, Any],
                options: Mapping[str, Any] | None) -> dict[str, Any]:
    """A new screen from a preset (SCREEN_PRESETS): it follows All Screens'
    menu, but each menu setting the preset chooses that All Screens' differs
    on (a wall tablet's time and weather in the menu) starts as its own
    (menu_own). Whether it has a menu is its own either way."""
    house = house_menu(merged(options)["menu"])
    keys = [k for k in MENU_KEYS if k in preset and k != "menu" and json.dumps(data[k]) != json.dumps(house[k])]
    return {**data, "menu_own": keys}


def new_board(kind: str, options: Mapping[str, Any] | None) -> dict[str, Any]:
    """A new screen's settings, as Add Screen's "Shown On" starts it: the
    preset over the defaults, following All Screens' menu (preset_menu). An
    unknown kind starts from the defaults ("custom"). Its pages are empty, so
    the strategy builds it from the house's rooms and devices."""
    preset = dict(SCREEN_PRESETS.get(kind) or {})
    return preset_menu(board(preset), preset, options)


def phone_menu(b: Mapping[str, Any]) -> str:
    """A screen's menu on a phone: its own menu_phone, else what a phone
    showed before there was one -- the screen's Menu when that is off or the
    tab bar, else the tab bar when its narrow choice (stored before 1.12;
    the migrations hand it over) was, else a button (hk-base.js phoneMenu)."""
    if b.get("menu_phone") in BOARD_PHONE_MENUS:
        return b["menu_phone"]
    if b.get("menu") in ("off", "tabbar"):
        return b["menu"]
    return "tabbar" if b.get("narrow") == "tabbar" else "button"


def button_phone(narrow: Any) -> str:
    """A phone's button style, from before phones had their own: the narrow
    choice when it is a button style, else the chip."""
    return narrow if narrow in BOARD_BUTTON_PHONE else "chip"


def phones_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                  ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """PHONES GET THEIR OWN MENU (entry 1.11, 2026-10-08): each screen's
    menu on a phone, and All Screens' (and each screen with its own menu
    settings') button style on a phone, written down as a phone shows them
    now -- so that changing a tablet's menu from here on leaves phones as
    they are. Nothing on any screen changes. Returns (new options or None:
    unchanged, {path: new item data})."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    menu = dict(stored.get("menu") or {})
    new_options = None
    if menu.get("button_phone") not in BOARD_BUTTON_PHONE:
        menu["button_phone"] = button_phone(_narrow(menu))
        new_options = {**(options or {}), CONF_DASHBOARD: {**stored, "menu": menu}}
    house_narrow = _narrow(menu)
    out = {}
    for p, d in items.items():
        b = resolved(board(d), None, house={}, rooms={}, menu=menu, cameras=[])
        data = dict(d)
        if data.get("menu_phone") not in BOARD_PHONE_MENUS:
            narrow = _narrow(d) if d.get("menu_custom") else house_narrow
            data["menu_phone"] = phone_menu({**b, "menu_phone": None, "narrow": narrow})
        if data.get("menu_custom") and data.get("button_phone") not in BOARD_BUTTON_PHONE:
            data["button_phone"] = button_phone(_narrow(d))
        out[p] = data
    return new_options, out


def _narrow(d: Mapping[str, Any] | None) -> str:
    """The narrow choice as stored before entry 1.12 (a screen's, or All
    Screens' menu), for the migrations."""
    v = (d or {}).get("narrow")
    return v if v in BOARD_NARROW else "chip"


# THE HOUSE-WIDE MENU LISTS before entry 1.9, which every save still wrote
# back until 1.12
_OLD_MENU_LISTS = ("dashboards", "docked", "dock_min", "time_weather", "button", "tab_position",
                   "order", "categories", "ha_sidebar")


def settings_tidied(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                    ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """ONE SET OF PHONES' SETTINGS, NO NARROW CHOICE (entry 1.12,
    2026-10-09). Phones' menu now shows wherever the tablets' doesn't fit,
    so the narrow choice (On Narrow Screens / When Folded) goes: a screen's
    menu on phones is written down if it isn't yet (as phones_lifted), and
    each "Same as Tablets" phone setting -- While Scrolling, More's rooms,
    the button's style -- becomes its own, the value it showed. The tab
    bar's Tinted glass is stored as "tinted" ("clear" is Appearance's
    see-through look), the house-wide menu lists from before 1.9 go, and a
    1.2 screen's header and sidebar choice (kiosk_from_plugin, read every
    time until now) is written down.
    Nothing a phone or a tablet with room shows changes. Returns (new
    options or None: unchanged, {path: new item data})."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    menu = dict(stored.get("menu") or {})
    before = dict(menu)
    house_narrow = _narrow(menu)

    # All Screens': the keys as stored (bar_*)
    for phone_key, tablet_key in (("bar_scroll_phone", "bar_scroll"), ("bar_rooms_phone", "bar_rooms")):
        if menu.get(phone_key) in (None, ""):
            menu[phone_key] = menu.get(tablet_key) if menu.get(tablet_key) is not None else DEFAULTS["menu"][phone_key]
    if menu.get("button_phone") not in BOARD_BUTTON_PHONE:
        menu["button_phone"] = button_phone(house_narrow)
    if menu.get("bar_glass") == "clear":
        menu["bar_glass"] = "tinted"
    menu.pop("narrow", None)
    for k in _OLD_MENU_LISTS:
        menu.pop(k, None)
    new_options = None if menu == before else {**(options or {}), CONF_DASHBOARD: {**stored, "menu": menu}}

    out = {}
    for p, d in items.items():
        data = dict(d)
        narrow = _narrow(d) if d.get("menu_custom") else house_narrow
        if data.get("menu_phone") not in BOARD_PHONE_MENUS:
            b = board(d)
            data["menu_phone"] = phone_menu({**b, "menu_phone": None, "narrow": narrow})
        if data.get("menu_custom"):
            for phone_key, tablet_key in (("tab_bar_scroll_phone", "tab_bar_scroll"), ("tab_bar_rooms_phone", "tab_bar_rooms")):
                if data.get(phone_key) in (None, ""):
                    data[phone_key] = data.get(tablet_key) if data.get(tablet_key) is not None else BOARD_DEFAULTS[phone_key]
            if data.get("button_phone") not in BOARD_BUTTON_PHONE:
                data["button_phone"] = button_phone(narrow)
        if data.get("tab_bar_glass") == "clear":
            data["tab_bar_glass"] = "tinted"
        data.pop("narrow", None)
        # a 1.2 screen still tuned for the Kiosk Mode plugin: HK Frontend's
        # own kiosk when its options say only what that can (1.3's rule,
        # read every time until now), else the plugin
        if data.get("kiosk_engine") not in KIOSK_ENGINES:
            same = kiosk_from_plugin(data.get("kiosk_options") if isinstance(data.get("kiosk_options"), dict) else None)
            data["kiosk_engine"] = "hk" if same is not None else "kiosk_mode"
            for k, v in (same or {}).items():
                data.setdefault(k, v)
        out[p] = data
    return new_options, out


# Which of a screen's menu keys show at all, by its menu: a button never
# docks, an always-open menu has no button style; off shows none. The edge
# tab's only where the screen shows it (hk-settings-model.js showsTab).
_MENU_SHOWN = {"button": ("menu", "narrow", "ha_row"),
               "open": ("dock_min", "narrow", "time_weather", "ha_row")}

_MENU_TAB = ("tab_position", "tab_size", "tab_size_phone")

_TAB_STYLES = ("auto", "chip_scroll", "chip_home", "tab")


def _menu_shown(b: Mapping[str, Any]) -> tuple[str, ...]:
    kind = "button" if b["menu"] in MENU_STYLES else b["menu"]
    keys = _MENU_SHOWN.get(kind, ())
    tab = (kind == "button" and b["menu"] in _TAB_STYLES) or b.get("narrow") in ("tab", "chip_scroll")
    return keys + _MENU_TAB if keys and tab else keys


def menu_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """THE MENU MOVES TO ALL SCREENS (entry 1.9, 2026-10-02), as the rooms
    did. Each of a screen's menu settings becomes All Screens' as most of the
    screens it SHOWS on have it (a button's style among the buttons, Keep
    Open Down To among the always-open, ...; ties: the first screen's); the
    icon and the clock tap were All Screens' already. A screen whose own
    match on everything it shows follows All Screens from now on; one that
    differs keeps its own (menu_custom). Returns (new options or None:
    unchanged, {path: new item data}). A house that already has All Screens'
    menu style is left alone."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    if "style" in (stored.get("menu") or {}):
        return None, {}
    boards_ = {p: {**board(d), "narrow": _narrow(d)} for p, d in items.items()}
    shown = {p: _menu_shown(b) for p, b in boards_.items()}
    picked: dict[str, Any] = {}
    for k in ("menu", "narrow", "tab_position", "tab_size", "tab_size_phone", "dock_min", "time_weather", "ha_row"):
        seen = [json.dumps(b[k]) for p, b in boards_.items() if k in shown[p]]
        picked[k] = json.loads(max(dict.fromkeys(seen), key=seen.count)) if seen else BOARD_DEFAULTS.get(k, "chip")
    if picked["menu"] not in MENU_STYLES:
        picked["menu"] = "auto"
    old = dict(stored.get("menu") or {})
    menu = {**old, **{{**MENU_KEYS, "narrow": "narrow"}[k]: v for k, v in picked.items()}}
    new_options = {**(options or {}), CONF_DASHBOARD: {**stored, "menu": menu}}
    out = {}
    for p, d in items.items():
        b = boards_[p]
        differs = any(json.dumps(b[k]) != json.dumps(picked[k]) for k in shown[p])
        out[p] = {**d, "menu_custom": differs}
        if differs:
            # its own copy starts from what it showed: the shared look too
            out[p].update({"glyph": old.get("glyph", "sidebar") if old.get("glyph") in MENU_GLYPHS else "sidebar",
                           "clock": old.get("clock") is not False})
    return new_options, out


def status_lifted(options: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """THE STATUS ROWS (entry 1.10, 2026-10-04): the Climate page's row
    (`climate`, 1.4.6) becomes one of the pages' (status_rows.climate), and a
    room status row saved before gains what the row can show now -- the
    security system, TVs, lights, valves and speakers. A list saved before was
    always in the house order, so the new kinds go in their places in it.
    Returns the new options, or None: unchanged."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    changed = False
    old = stored.pop("climate", None)
    if isinstance(old, dict):
        rows = dict(stored.get("status_rows") or {})
        rows.setdefault("climate", {"status": old.get("status", list(STATUS_ROWS["climate"][1])),
                                    "exclude_areas": old.get("exclude_areas", [])})
        stored["status_rows"] = rows
        changed = True
    elif old is not None:
        changed = True
    rooms = dict(stored.get("rooms") or {})
    if isinstance(rooms.get("status"), list):
        saved = rooms["status"]
        rooms["status"] = [k for k in STATUS_KINDS if k in saved or k in STATUS_KINDS_ADDED]
        stored["rooms"] = rooms
        changed = changed or rooms["status"] != saved
    if not changed:
        return None
    return {**(options or {}), CONF_DASHBOARD: stored}


def rooms_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                 ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """THE ROOMS MOVE TO ALL SCREENS (entry 1.8, 2026-10-01). Before, each
    screen held its own room order, Home's rooms, the menu's and the pages'
    -- a house with five tablets kept five copies of one order. The room
    settings the most screens chose (counting only screens that chose any)
    become All Screens'; a screen with exactly those, or with none of its
    own, follows All Screens from now on; one that differs keeps its own
    (rooms_custom). Returns (new options or None: unchanged, {path: new
    item data}). A house that already has All Screens' order is left alone."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    if "order" in (stored.get("rooms") or {}):
        return None, {}
    keys = tuple(ROOM_KEYS)
    defaults = tuple(json.dumps(BOARD_DEFAULTS[k]) for k in keys)
    sig = {p: tuple(json.dumps(board(d)[k]) for k in keys) for p, d in items.items()}
    chosen = [s for s in sig.values() if s != defaults]
    if not chosen:
        return None, {p: {**d, "rooms_custom": False} for p, d in items.items()}
    top = max(dict.fromkeys(chosen), key=chosen.count)         # ties: the first screen's
    picked = {k: json.loads(v) for k, v in zip(keys, top)}
    rooms = {**(stored.get("rooms") or {}), **{ROOM_KEYS[k]: picked[k] for k in keys}}
    new_options = {**(options or {}), CONF_DASHBOARD: {**stored, "rooms": rooms}}
    return new_options, {p: {**d, "rooms_custom": sig[p] not in (top, defaults)} for p, d in items.items()}


def cameras_lifted(options: Mapping[str, Any] | None, items: Mapping[str, Mapping[str, Any]]
                   ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]]]:
    """THE CAMERAS MOVE TO ALL SCREENS (entry 1.13, 2026-10-09), as the rooms
    did (rooms_lifted): each screen held its own camera list -- a house with
    six screens kept six copies of one order. The list the most screens chose
    (counting only screens that chose one) becomes All Screens'; a screen
    with exactly that list, or with none of its own (Automatic), follows All
    Screens from now on; one that differs keeps its own (cameras_custom).
    Returns (new options or None: unchanged, {path: new item data}). A house
    that already has All Screens' cameras is left alone."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    if (stored.get("cameras") or {}).get("order"):
        return None, {}
    lists = {p: tuple(board(d)["cameras"]) for p, d in items.items()}
    chosen = [v for v in lists.values() if v]
    if not chosen:
        return None, {p: {**d, "cameras_custom": False} for p, d in items.items()}
    top = max(dict.fromkeys(chosen), key=chosen.count)         # ties: the first screen's
    cams = {**(stored.get("cameras") or {}), "order": list(top)}
    new_options = {**(options or {}), CONF_DASHBOARD: {**stored, "cameras": cams}}
    return new_options, {p: {**d, "cameras_custom": lists[p] not in (top, ())} for p, d in items.items()}


def boards(stored: Stored | None) -> dict[str, dict[str, Any]]:
    """Every dashboard item's settings, by url path (as read: resolved()),
    with the tablets that run it (`tablets`, their ids) and the first one's
    room (`idle_room`: where the screen's Calm When Nobody's Around looks, and
    a WallPanel screen's helper)."""
    from .tablet_rules import tablets
    out: dict[str, dict[str, Any]] = {}
    m = merged(stored.options if stored is not None else None)
    house, rooms, menu, cams = m["look"]["saver"], m["rooms"], m["menu"], m["cameras"]["order"]
    for sub in (stored.of(SUBENTRY_DASHBOARD) if stored is not None else ()):
        out[sub.unique_id] = resolved(board(sub.data), None, house, rooms, menu, cams, pane=m["side_pane"])
    on = tablets(stored)
    for path, b in out.items():
        mine = [tid for tid, t in on.items() if t["screen"] == path]
        b["tablets"] = mine
        b["idle_room"] = next((on[tid]["room"] for tid in mine if on[tid]["room"]), "")
    return out


def legacy_screens(items: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """The car viewport's list, read off the items. NOT a shim:
    tesla-viewport.js reads only `car.dashboards`. (The idle return's lists
    were read off the items too until the tablets had their own, 1.14.)"""
    return {"car": {"dashboards": [p for p, b in items.items() if b["car"]],
                    "widths": {p: b["car_width"] for p, b in items.items() if b["car"] and b.get("car_width")}}}
