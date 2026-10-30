"""LOOKS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md "Looks"): whole, themed setups a screen takes in one step.

The owner asked for starters that set "all the necessary settings", not only the layout -- "Flat, Performance,
Holiday Whimsy, Active Weather, Calming Backgrounds..." -- and the colours with them ("accent/highlight color").
A Look is the screen settings it sets (its style and colours, its background and sky, the tab bar's glass, the
Tile Style, the Side Pane, swiping between pages, the screensaver), and the layout it starts from: square cells
or tiles, and the editor's starters it prefers, the first one that fits the screen type winning.

Shown in two places (hk-settings.js): a screen's Looks page (the settings alone, its layout kept) and the Home Grid
editor's Layout + Look starters (the layout too). Applied per screen, never All Screens', after a sheet that says
what will change; the screen's own values before are kept as `look_undo`, so one Undo puts them back.

This is the one list: hk-settings-model.js LOOKS mirrors it (test_hk_core_looks.py reads both and compares).
Every value is checked as a screen's settings are (changes.apply_board), so a Look can never write what a
screen could not hold.
"""
from __future__ import annotations

from typing import Any

# THE KEYS A LOOK MAY SET (a screen's settings) -- and so the ones its Undo keeps; the Layout + Look starters also
# keep home_style and home_grid
SET_KEYS = ("flat", "flat_theme", "glass", "accent", "tab_bar_glass", "tile_style",
            "sky", "sky_background", "sky_color", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion",
            "sky_animations", "sky_weather", "sky_precipitation", "sky_moving", "sky_decorations", "sky_liveliness",
            "swipe_pages", "side_pane", "screensaver", "screensaver_options", "camera_live_video")
UNDO_KEYS = SET_KEYS + ("home_style", "home_grid")

PANE_HOME = {"side": "right", "dashboard": {"show": "home", "sections": [
    {"kind": "weather", "size": "more"}, {"kind": "calendar", "size": "more"},
    {"kind": "now_playing", "size": "more", "when": "active"}]}}
PANE_WEATHER = {"side": "right", "dashboard": {"show": "home", "sections": [
    {"kind": "weather", "size": "full"}, {"kind": "calendar", "size": "less"}]}}
PANE_OFF = {"dashboard": {"show": "off", "sections": []}}

# [id, name, what it is, its preview's colours (top, middle, bottom, accent), its layout, its settings, its
# screensaver's options (a patch over the screen's)]. The layout: {cell, starters} -- the editor's starter keys
# (hk-grid-editor.js SQUARE_STARTERS, NIGHTSTAND, STARTERS) in the order it tries them for the screen's type.
LOOKS: tuple[dict[str, Any], ...] = (
    {"id": "homeview", "name": "HomeView",
     "about": "Square tiles, centred, over a slow-moving wallpaper in Bright Glass, with the Side Pane and the "
              "Analog Numbers clock.",
     "art": ["#1f4b8d", "#375b91", "#0b285d", "#ff9500"],
     "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]},
     "settings": {"flat": False, "glass": "bright", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto",
                  "sky": True, "sky_background": "wallpaper", "sky_wallpaper": "ribbons_blue", "sky_wallpaper_night": "auto",
                  "sky_wallpaper_motion": "slow", "swipe_pages": "on", "side_pane": PANE_HOME, "screensaver": True},
     "saver": {"show": "clock", "clock_style": "numbers", "clock_bg": "gradient", "clock_motion": "slow"}},
    {"id": "flat", "name": "Flat",
     "about": "Clean and solid: no blur, high contrast, the cards on one dark colour.",
     "art": ["#1c1c1e", "#1c1c1e", "#1c1c1e", "#0a84ff"],
     "layout": {"cell": "tile", "starters": ["A"]},
     "settings": {"flat": True, "flat_theme": "dark", "accent": "blue", "tab_bar_glass": "tinted", "tile_style": "home",
                  "swipe_pages": "auto", "screensaver": True},
     "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still"}},
    {"id": "performance", "name": "Performance",
     "about": "The lightest setup for a slow wall tablet: Glass, no rain or snow, nothing moving in front of the "
              "cards, no live camera, and a still screensaver.",
     "art": ["#2b3140", "#3a4152", "#202531", "#ff9500"],
     "layout": {"cell": "tile", "starters": ["Q"]},
     "settings": {"flat": False, "glass": "clear", "accent": "orange", "tab_bar_glass": "tinted", "tile_style": "home",
                  "sky_animations": False, "sky_precipitation": False, "sky_moving": "behind", "sky_decorations": False,
                  "sky_wallpaper_motion": "off", "camera_live_video": False, "screensaver": True},
     "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "zoom": False}},
    {"id": "holiday", "name": "Holiday Whimsy",
     "about": "The live sky with the season's scenery and decorations, a festive bustle, the Day face with its "
              "occasion art, and Scattered Numerals.",
     "art": ["#2a1450", "#7a3b1c", "#1b0f24", "#ff9f0a"],
     "layout": {"cell": "tile", "starters": ["F", "A"]},
     "settings": {"flat": False, "glass": "blur", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto",
                  "sky": True, "sky_background": "live", "sky_animations": True, "sky_decorations": True,
                  "sky_liveliness": "festive", "sky_moving": "front", "swipe_pages": "auto", "screensaver": True},
     "saver": {"show": "day", "clock_style": "scattered", "day_look": "auto"}},
    {"id": "weather", "name": "Active Weather",
     "about": "The live sky with its weather moving -- clouds, rain and snow -- the weather large in the Side Pane "
              "and Big Weather in the screensaver.",
     "art": ["#3a6ea8", "#7fa6c9", "#2c4a6b", "#32ade6"],
     "layout": {"cell": "tile", "starters": ["C", "A"]},
     "settings": {"flat": False, "glass": "blur", "accent": "cyan", "tab_bar_glass": "house", "tile_style": "auto",
                  "sky": True, "sky_background": "live", "sky_animations": True, "sky_weather": True,
                  "sky_precipitation": True, "sky_moving": "behind", "swipe_pages": "auto", "side_pane": PANE_WEATHER,
                  "screensaver": True},
     "saver": {"show": "forecast", "forecast_layout": "big"}},
    {"id": "calm", "name": "Calming Backgrounds",
     "about": "Soft violet petals drifting slowly in Bright Glass, muted colours, and the Liquid clock.",
     "art": ["#3c3283", "#524999", "#211a5e", "#5e5ce6"],
     "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]},
     "settings": {"flat": False, "glass": "bright", "accent": "indigo", "tab_bar_glass": "house", "tile_style": "auto",
                  "sky": True, "sky_background": "wallpaper", "sky_wallpaper": "petals_violet", "sky_wallpaper_night": "auto",
                  "sky_wallpaper_motion": "slow", "swipe_pages": "on", "screensaver": True},
     "saver": {"show": "clock", "clock_style": "liquid", "clock_bg": "gradient", "clock_motion": "slow"}},
    {"id": "night", "name": "Night & Bedside",
     "about": "Dark and quiet for a bedroom: a deep colour, the big clock a swipe from the weather, and a dim red "
              "clock at night.",
     "art": ["#0b1026", "#121a3a", "#05070f", "#ff453a"],
     "layout": {"cell": "tile", "starters": ["n_standby", "n_clock"]},
     "settings": {"flat": False, "glass": "tinted", "accent": "red", "tab_bar_glass": "tinted", "tile_style": "home",
                  "sky": True, "sky_background": "color", "sky_color": "midnight", "sky_animations": False,
                  "swipe_pages": "on", "side_pane": PANE_OFF, "screensaver": True},
     "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "clock_night": "night"}},
    {"id": "photos", "name": "Photo Frame",
     "about": "The landscapes behind the cards, and your photos soon after you stop -- their titles, the time "
              "behind their subject where it can be.",
     "art": ["#4a6a3a", "#8aa070", "#2a3a22", "#ff375f"],
     "layout": {"cell": "tile", "starters": ["Q", "A"]},
     "settings": {"flat": False, "glass": "blur", "accent": "pink", "tab_bar_glass": "house", "tile_style": "auto",
                  "sky": True, "sky_background": "landscapes", "swipe_pages": "auto", "screensaver": True},
     "saver": {"show": "photos", "starts_after": 60, "photo_titles": True, "time_behind": True}},
)
IDS = tuple(x["id"] for x in LOOKS)
BY_ID = {x["id"]: x for x in LOOKS}


def look(look_id: Any) -> dict[str, Any] | None:
    return BY_ID.get(look_id) if isinstance(look_id, str) else None
