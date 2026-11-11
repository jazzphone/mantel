"""model.py's Pages screen checks, and merged() (the stored settings laid over DEFAULTS) (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import copy
from typing import Any
from ..saver_designs import HOLIDAYS as SAVER_HOLIDAYS
from .schema import (_one_of, _PLACE, _typed, BRIGHT_PAGES, CONF_DASHBOARD, FLAT_BACKGROUNDS, flat_color, flat_colors,
    FLAT_COLORS_DEFAULT, FLAT_FADE, flat_image_look, flat_page_colors, flat_page_image_looks, flat_pages, flat_tint,
    FLAT_TINT_AMOUNT, GLASS, NP_BARS, NP_GRACES, NP_SIDES, NP_STYLES, photo_look, PHOTO_LOOK_DEFAULTS,
    place_sky_defaults, radar_native, RETIRED_GLASS, sky_landscape, THERMOSTAT_STYLES, TILE_ICONS, TILE_STYLES,
    wallpaper_choice, WALLPAPER_MOTION, WALLPAPER_NIGHT, weather_page, WELLS,)
from .defaults import (DEFAULTS, PAGES_SCREEN_CLOCK, PAGES_SCREEN_DEFAULTS, PAGES_SCREEN_ICONS_MAX, PAGES_SCREEN_PATH,
    PAGES_SCREEN_PILL, PAGES_SCREEN_PLACES, PAGES_SCREEN_ROOMS, PAGES_SCREEN_SHOW, PAGES_SCREEN_SIZES,
    PAGES_SCREEN_WIDGETS, PAGES_SCREEN_WIDGETS_MAX, SAVER_DEFAULTS, SIDE_PANE_DEFAULTS,)


def _pages_icons(v: Any) -> str | list[str] | None:
    """"menu", or view paths, each once (None: neither)."""
    if v == "menu":
        return v
    if not isinstance(v, list) or len(v) > PAGES_SCREEN_ICONS_MAX:
        return None
    if not all(isinstance(x, str) and PAGES_SCREEN_PATH.match(x) for x in v) or len(set(v)) != len(v):
        return None
    return list(v)


def _pages_widgets(v: Any) -> list[dict[str, str]] | None:
    """[{kind, size, place}]: a section each at most once, a size and a place (absent: More, Right)."""
    if not isinstance(v, list) or len(v) > PAGES_SCREEN_WIDGETS_MAX:
        return None
    out: list[dict[str, str]] = []
    for w in v:
        if not isinstance(w, Mapping) or set(w) - {"kind", "size", "place"}:
            return None
        kind, size, place = w.get("kind"), w.get("size", "more"), w.get("place", "right")
        if _one_of(kind, PAGES_SCREEN_WIDGETS) is None or _one_of(size, PAGES_SCREEN_SIZES) is None \
                or _one_of(place, PAGES_SCREEN_PLACES) is None or any(x["kind"] == kind for x in out):
            return None
        out.append({"kind": kind, "size": size, "place": place})
    return out


PAGES_SCREEN_CHECKS: dict[str, Any] = {
    "show": lambda v: _one_of(v, PAGES_SCREEN_SHOW), "icons": _pages_icons,
    "rooms": lambda v: _one_of(v, PAGES_SCREEN_ROOMS), "widgets": _pages_widgets,
    "pill": lambda v: _one_of(v, PAGES_SCREEN_PILL),
    "clock": lambda v: _one_of(v, PAGES_SCREEN_CLOCK),
}


def pages_screen(v: Any, strict: bool = False) -> dict[str, Any] | None:
    """All Screens' Pages Screen: `v` over its defaults, each field checked (strict, a save: a bad field refuses the
    whole, None; stored, read back: a bad field keeps its default)."""
    return _typed(v, PAGES_SCREEN_DEFAULTS, PAGES_SCREEN_CHECKS, strict)


def pages_screen_own(v: Any, strict: bool = False) -> dict[str, Any] | None:
    """A screen's own Pages Screen: only the fields it sets, each checked ({} sets none: Same as All Screens).
    strict: anything but a mapping, or an unknown or bad field, refuses the whole (None); otherwise it is left out."""
    if not isinstance(v, Mapping):
        return None if strict else {}
    out: dict[str, Any] = {}
    for k, x in v.items():
        check = PAGES_SCREEN_CHECKS.get(k)
        got = check(x) if check else None
        if got is None:
            if strict:
                return None
            continue
        out[k] = got
    return out


def pages_screen_resolved(house: Any, own: Any) -> dict[str, Any]:
    """A screen's Pages Screen as it shows: each field the screen's own, else All Screens'
    (hk-settings.js pagesScreen() is the page's copy)."""
    return {**(pages_screen(house) or copy.deepcopy(PAGES_SCREEN_DEFAULTS)), **(pages_screen_own(own) or {})}


def merged(options: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    """The stored settings over the defaults, section by section."""
    from .saver_rules import saver_options
    from .side_pane_rules import side_pane
    from .dashboard_rules import amount_or_none, bright_dim_or_none, SWIPE_PAGES
    from .menu_rules import page_accents
    out = copy.deepcopy(DEFAULTS)
    out["sky"].update(place_sky_defaults())
    stored = (options or {}).get(CONF_DASHBOARD) or {}
    for section, values in stored.items():
        if section in out and isinstance(values, dict):
            out[section].update({k: v for k, v in values.items() if k in out[section]})
    out["look"]["saver"] = saver_options(SAVER_HOLIDAYS.placed(out["look"].get("saver"), stored, _PLACE["country"])) or dict(SAVER_DEFAULTS)
    if out["menu"].get("swipe_pages") not in SWIPE_PAGES:
        out["menu"]["swipe_pages"] = DEFAULTS["menu"]["swipe_pages"]
    np = out["now_playing"]
    for k, allowed in (("style", NP_STYLES), ("side", NP_SIDES), ("bar", NP_BARS), ("bar_phone", NP_BARS),
                       ("grace", NP_GRACES)):
        if isinstance(np.get(k), bool) or np.get(k) not in allowed:
            np[k] = DEFAULTS["now_playing"][k]
    g = RETIRED_GLASS.get(out["look"].get("glass"), out["look"].get("glass"))
    out["look"]["glass"] = g if g in GLASS else DEFAULTS["look"]["glass"]
    out["look"]["flat"] = out["look"].get("flat") is True
    if out["look"].get("flat_theme") not in ("light", "dark"):
        out["look"]["flat_theme"] = "dark"
    for k, choices in (("well", WELLS), ("bright_pages", BRIGHT_PAGES), ("tile_style", TILE_STYLES), ("tile_icons", TILE_ICONS),
                       ("thermostat_style", THERMOSTAT_STYLES)):
        out["look"][k] = out["look"].get(k) if out["look"].get(k) in choices else DEFAULTS["look"][k]
    out["sky"]["photo_look"] = photo_look(out["sky"].get("photo_look")) or dict(PHOTO_LOOK_DEFAULTS)
    out["sky"]["landscape_look"] = photo_look(out["sky"].get("landscape_look")) or dict(PHOTO_LOOK_DEFAULTS)
    out["sky"]["landscape"] = sky_landscape(out["sky"].get("landscape")) or DEFAULTS["sky"]["landscape"]
    out["look"]["page_accents"] = page_accents(out["look"].get("page_accents")) or {}
    out["look"]["flat_colors"] = {**FLAT_COLORS_DEFAULT, **(flat_colors(out["look"].get("flat_colors")) or {})}
    out["look"]["flat_page_colors"] = flat_page_colors(out["look"].get("flat_page_colors")) or {}
    sk = out["sky"]
    if sk.get("flat_background") not in FLAT_BACKGROUNDS:
        sk["flat_background"] = "color"
    sk["flat_color"] = flat_color(sk.get("flat_color")) or "auto"
    fade = sk.get("flat_fade")
    sk["flat_fade"] = int(fade) if isinstance(fade, (int, float)) and not isinstance(fade, bool) and 0 <= fade <= 100 else FLAT_FADE
    sk["flat_tint"] = flat_tint(sk.get("flat_tint")) or "none"
    ta = sk.get("flat_tint_amount")
    sk["flat_tint_amount"] = int(ta) if isinstance(ta, (int, float)) and not isinstance(ta, bool) and 0 <= ta <= 100 else FLAT_TINT_AMOUNT
    tl = sk.get("flat_tint_light")
    sk["flat_tint_light"] = int(tl) if isinstance(tl, (int, float)) and not isinstance(tl, bool) and 0 <= tl <= 100 else 50
    sk["flat_pages"] = flat_pages(sk.get("flat_pages")) or {}
    sk["flat_image_look"] = flat_image_look(sk.get("flat_image_look")) or {}
    sk["image_look"] = flat_image_look(sk.get("image_look")) or {}
    sk["flat_page_image_looks"] = flat_page_image_looks(sk.get("flat_page_image_looks")) or {}
    # (the Wallpaper and its colour from what is stored, an old id among them: wallpaper_choice)
    raw_sky = stored.get("sky") if isinstance(stored.get("sky"), dict) else {}
    sk["wallpaper"], sk["wallpaper_color"] = wallpaper_choice(raw_sky.get("wallpaper"), raw_sky.get("wallpaper_color"))
    if sk.get("wallpaper_night") not in WALLPAPER_NIGHT:
        sk["wallpaper_night"] = "auto"
    if sk.get("wallpaper_motion") not in WALLPAPER_MOTION:
        sk["wallpaper_motion"] = "off"
    br = amount_or_none(out["look"].get("bright"))
    out["look"]["bright"] = DEFAULTS["look"]["bright"] if br is None else br
    out["look"]["bright_dim"] = bright_dim_or_none(out["look"].get("bright_dim")) or 0
    # each over its own defaults: a partly stored object is still whole, and
    # a stored false stays false
    wx = out["weather"]
    wx["page"] = weather_page(wx.get("page"), strict=False)
    wx["radar_native"] = radar_native(wx.get("radar_native"), strict=False)
    # the Pages screen, over its defaults (pages_screen() above)
    out["pages_screen"] = pages_screen(out.get("pages_screen"))
    # the Side Pane, each group over its default
    out["side_pane"] = side_pane(out.get("side_pane")) or copy.deepcopy(SIDE_PANE_DEFAULTS)
    return out


# OPTIONAL CARDS FROM HACS: a page that can use one draws it
# only when it is installed -- the Weather page's radar map. key -> (HACS
# repository folder, file). Looked for under www/community, where HACS keeps
# them and serves them as /hacsfiles/<folder>/<file>; the file's time goes on
# the URL, so an update is fetched afresh.
THIRD_PARTY: dict[str, dict[str, Any]] = {
    "wallpanel": {"name": "WallPanel", "folder": "lovelace-wallpanel", "file": "wallpanel.js", "resource": True,
                  "what": "photo screensaver on a wall tablet"},
    "kiosk": {"name": "Kiosk Mode", "folder": "kiosk-mode", "file": "kiosk-mode.js", "resource": True,
              "what": "full-window dashboard, with Home Assistant's header and sidebar hidden"},
    "radar": {"name": "Weather Radar Card", "folder": "weather-radar-card", "file": "weather-radar-card.js",
              "resource": False, "what": "radar map on the Weather page"},
}

OPTIONAL_CARDS = {k: (v["folder"], v["file"]) for k, v in THIRD_PARTY.items()}

# A card's own options (YAML) as the user writes them: kept only when they are
# a mapping of plain values, and not huge. Merged over the dashboards' tuned
# settings key by key (hk-strategy.js); `key: null` removes one.
CARD_OPTIONS_MAX = 20000
