"""HOME GRID (docs/phase11/HOME-GRID.md): a screen's Home laid out on a grid of size classes, that never scrolls.

A screen's `home_style` is "generated" (Home as every screen builds it) or "grid", and its `home_grid` is the
layout: columns (6, 3 or 2) by rows (2-6), the frame the desktop editor draws it at, the top band, and the
blocks -- each a card from the Home Grid catalog, at a size that card has, at a cell, perhaps with pages that
swipe. The catalog is web/hk/cards/hk-grid-catalog.js; CATALOG here is its mirror (keys, sizes, page sources),
kept equal by a test, so a saved layout can't name a card HK doesn't have, a size it can't draw or a source it
can't page.

check() is the write's (changes.py): anything wrong is refused with a code the page words. layout() is the
read's (model.board()): a stored layout that no longer checks loses the blocks that don't, or is gone.
starter() fills a new layout from the house: concept A (Tap Weight) or C (Glance Up, Touch Down).
"""
from __future__ import annotations

import copy
import re
from typing import Any, Mapping

HOME_STYLES = ("generated", "grid")
VERSION = 1
# (4 and 5 since 2026-10-30, the owner: "I could easily do 4" -- square cells beside the Side Pane, mostly)
COLS = (6, 5, 4, 3, 2)
ROWS = (2, 6)                      # the fewest and the most
ROWS_DEFAULT = 4
# The frame is the editor's preview viewport. Fixed 196 x 150 tile units fit
# uniformly into the real viewport, centered with spare room around them.
FRAME = (1280, 800)
FRAME_W = (320, 3840)
FRAME_H = (320, 2160)
ITEMS_MAX = 24
# A CELL'S SHAPE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md "The numbers"): a tile, 196 x 150, or a square, 196 x 196
# (hk-grid-catalog.js CELLS). Stored only when square. A grid for a square SCREEN (`screen`, the Square screen
# type) reaches to 14 px of the glass and rounds its corner blocks' outer corners with the display's.
CELLS = ("tile", "square")
SCREENS = ("square",)
# a block's Tile Style (hk-settings-model.js TILE_STYLES; model.TILE_STYLES): absent, the screen's
TILE_STYLES = ("home", "centred")
# VIEWS (2026-10-24, StandBy's): up to four whole layouts on one screen's grid, a swipe apart
VIEWS_MAX = 4
PAGES_MAX = 12
LIST_MAX = 24                      # the most things one option lists (a scenes block's scenes)
# \Z, not $: `$` also matches before a final newline ("light.x\n" passed .match). An entity id is at most 255
# characters, Home Assistant's own limit.
ITEM_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,19}\Z")
ENTITY_ID = re.compile(r"^(?=.{3,255}\Z)[a-z0-9_]+\.[a-z0-9_]+\Z")
AREA_ID = re.compile(r"^[a-z0-9_]{1,80}\Z")
# The tablet's own room, as an option's value: the Wall Tablets room of the tablet showing the screen. Stored
# and checked here; the cards resolve it (G3, G4).
TABLET_ROOM = "tablet_room"

# Size classes: (columns, rows). F, Full (2026-10-30, the Cameras face): the view's whole grid -- 0 is "the grid's
# own" (span()) -- at [0, 0] only and so the only block in its view; offered for `cameras` alone
# C, Compact (2026-11-07, docs/phase11/HOME-GRID.md "Security's HomeView sizes"): three columns by one row, a size of its
# own -- never W or T read another way. Offered for Security's HomeView presentation alone (_security_size)
SIZES: dict[str, tuple[int, int]] = {"S": (1, 1), "W": (2, 1), "T": (1, 2), "L": (2, 2), "XL": (3, 2), "XXL": (6, 2),
                                     "F": (0, 0), "C": (3, 1)}
FULL = "F"


def span(size: str, cols: int, rows: int) -> tuple[int, int]:
    """A size's columns and rows on a grid of `cols` x `rows`: its own, or the whole grid's for F."""
    w, h = SIZES[size]
    return (w or cols, h or rows)

# THE CATALOG'S MIRROR: key -> its sizes, the page sources it swipes through besides `list` (every card has
# `list`), and its options (name -> kind, OPTION_KINDS).
CATALOG: dict[str, dict[str, Any]] = {
    "accessory": {"sizes": ("S", "W", "T"), "sources": (), "opts": {"entity": "entity", "secondary": "secondary", "color": "boolean"}},
    "accessories": {"sizes": ("W", "T", "L", "XL", "XXL"), "sources": ("accessories",), "opts": {"accessories": "accessories", "title": "title", "surface": "surface",
                                                                              "height": "tile_height", "color": "boolean"}},
    "scene": {"sizes": ("S", "W"), "sources": (), "opts": {"scene": "scene", "color": "boolean"}},
    "scenes": {"sizes": ("W", "T", "L", "XL", "XXL"), "sources": ("scenes",), "opts": {"scenes": "scenes", "surface": "surface", "height": "tile_height", "color": "boolean"}},
    "now_playing": {"sizes": ("S", "W", "T", "L", "XL"), "sources": ("speakers",), "opts": {"speaker": "speaker", "background": "np_background", "tap": "tap_target"}},
    # style (2026-10-30): the dial, or Big Number (docs/phase11/HOMEVIEW-LOOK.md, Phase C)
    "thermostat": {"sizes": ("S", "W", "T", "L", "XL"), "sources": ("thermostats",), "opts": {"entity": "climate", "style": "thermostat_style", "tap": "tap_target"}},
    # (S, 2026-10-31, the owner: "a small option to the camera": one still in a cell)
    "camera": {"sizes": ("S", "W", "T", "L", "XL"), "sources": ("cameras",),
               # follow (2026-10-24): swiping all cameras, turn to the one a selector or the latest motion picks
               "opts": {"entity": "camera", "follow": "camera_follow", "follow_select": "select",
                        # name (2026-10-31, the owner): the camera's name at the foot -- Automatic shows it on a
                        # tile cell and leaves it off HomeView's square cells; Show or Hide either way
                        "name": "name_tag"}},
    # THE CAMERAS FACE (2026-10-30): up to nine stills at once, arranged to the block; Full is the whole view.
    # cameras: the ones shown (none: all, in Cameras' order); refresh: s between stills
    "cameras": {"sizes": ("XL", "XXL", "F"), "sources": (), "opts": {"cameras": "cameras", "refresh": "refresh"}},
    # Large and Extra Large (2026-10-24): the alarm's keypad. presentation (2026-11-07): "homeview", the five HomeView
    # compositions (Small, Wide, Compact, Large, Extra Large) -- absent, the block as it always was, keypads and all;
    # members: the locks and garage doors it shows, in order (absent: the house's, automatically)
    "security": {"sizes": ("S", "W", "C", "T", "L", "XL"), "sources": (),
                 "opts": {"entity": "alarm", "tap": "tap_target", "presentation": "security_presentation",
                          "members": "security_members", "height": "tile_height"}},
    "timers": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    "weather": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"entity": "weather", "sky": "boolean", "big": "boolean", "tap": "tap_target"}},
    "calendar": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"calendars": "calendars", "days": "days", "month": "boolean", "tap": "tap_target"}},
    "battery": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    "people": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    # Large and Extra Large (2026-10-24): its controls with Clean Areas
    "vacuum": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"entity": "vacuum", "tap": "tap_target"}},
    "clock": {"sizes": ("S", "W", "T", "L", "XL", "XXL"), "sources": (), "opts": {"clock_style": "clock_style", "bare": "boolean", "tap": "tap_target"}},
    "power": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    # show (2026-10-31, the owner): what it shows -- Recently Played (none stored), the Music page's playlists (presets), or
    # one playlist, named by `playlist` (its name in Music's settings)
    # tap (2026-11-01, the owner): When Tapped's choices, and Choose a Playlist -- every playlist in the Music page's
    # sheet, so the block is one button to start any of them
    "music": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"show": "music_show", "playlist": "music_playlist", "speaker": "music_speaker", "tap": "music_tap"}},
    "doors": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    # channel (2026-10-31, the owner): one channel of the guide fills the block; none, as many as the size holds
    "live_tv": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"channel": "tv_channel", "tap": "tap_target"}},
    "water": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target"}},
    # the new cards (G3)
    "room": {"sizes": ("S", "W", "T", "L", "XL", "XXL"), "sources": ("rooms",), "opts": {"area": "area", "surface": "surface", "accessory_display": "room_display", "tap": "tap_target"}},
    "scene_suggested": {"sizes": ("S", "W", "T", "L"), "sources": (), "opts": {"windows": "windows"}},
    # `area`: the room an action keeps to (All Lights Off in one room); the others ignore it
    "action": {"sizes": ("S", "W"), "sources": (), "opts": {"action": "action", "area": "area", "color": "boolean"}},
    "everything": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target", "more": "everything_more"}},
    # THE WIDGET BLOCKS (2026-10-31, docs/phase11/HOMEVIEW-LOOK.md "Blocks as widgets"): what is on now, a to-do
    # list, and the Energy page's rings over a period of the block's own
    "on_now": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"tap": "tap_target", "open": "on_now_open"}},
    "todo": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"entity": "todo", "tap": "tap_target"}},
    "energy_rings": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"period": "period", "tap": "tap_target"}},
    # THE INTERCOM (2026-11-03, docs/phase17/INTERCOM.md): a button that opens its sheet; Wide also shows the last rooms
    # picked. Always the sheet, so no When Tapped
    "intercom": {"sizes": ("S", "W"), "sources": (), "opts": {}},
    # RECENT (2026-11-03, docs/phase19/HOUSE-TIMELINE.md "The views"): the House Timeline's last rows. Mantel's own: a
    # host with no Timeline (Home Assistant) never offers it and draws a stand-in for a layout that has one. show:
    # Automatic (the morning summary from 5 to 11 AM, the rows after), Latest Events, or Morning Summary
    "timeline": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"show": "timeline_show", "tap": "tap_target"}},
    # HOUSE STATUS (2026-11-07, docs/phase11/HOUSE-STATUS.md): this screen's status chips as sections, each a tap to its
    # chip's page, the rest in a sheet. No options: what it shows is the screen's Status Chips (chips, chips_quiet,
    # chips_extra, chips_custom), drawn whether or not the screen shows its chip row. No When Tapped: each section
    # opens its own place
    "house_status": {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {}},
}
SOURCES = ("list", "rooms", "cameras", "thermostats", "speakers", "scenes", "accessories")
# the sources that can open on the tablet's own room (or its speaker)
STARTS = ("rooms", "thermostats", "speakers")
# an action block's jobs, besides any scene or script
ACTIONS = ("lock_up", "lights_off", "garage")
# A suggested scene's time windows: at most this many, each {start, end, scene, label?}. Times are "HH:MM"; a
# window may run past midnight (22:00-05:00). Without windows the card uses its own (Morning, Day, Evening,
# Night), each finding its scene by name.
WINDOWS_MAX = 8
LABEL_MAX = 24
CLOCK = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]\Z")


class GridInvalid(ValueError):
    """A layout that can't be saved: `code` says why (changes.Invalid carries it to the page)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _domain(*domains: str, room: bool = False):
    def check(v: Any) -> str:
        if room and v == TABLET_ROOM:
            return v
        if not isinstance(v, str) or not ENTITY_ID.match(v) or (domains and v.split(".")[0] not in domains):
            raise GridInvalid("grid_option")
        return v
    return check


def _list(one):
    def check(v: Any) -> list[str]:
        if not isinstance(v, list) or not 0 < len(v) <= LIST_MAX:
            raise GridInvalid("grid_option")
        return list(dict.fromkeys(one(x) for x in v))
    return check


def _area(v: Any) -> str:
    if v == TABLET_ROOM or (isinstance(v, str) and AREA_ID.match(v)):
        return v
    raise GridInvalid("grid_option")


def _window(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"start", "end", "scene", "label"}:
        raise GridInvalid("grid_option")
    start, end = v.get("start"), v.get("end")
    if not isinstance(start, str) or not CLOCK.match(start) or not isinstance(end, str) or not CLOCK.match(end) \
            or start == end:
        raise GridInvalid("grid_option")
    scene = v.get("scene")
    if not isinstance(scene, str) or not ENTITY_ID.match(scene) or scene.split(".")[0] not in ("scene", "script"):
        raise GridInvalid("grid_option")
    out = {"start": start, "end": end, "scene": scene}
    label = v.get("label")
    if label is not None:
        if not isinstance(label, str) or not 0 < len(label.strip()) <= LABEL_MAX:
            raise GridInvalid("grid_option")
        out["label"] = label.strip()
    return out


def _windows(v: Any) -> list[dict[str, str]]:
    if not isinstance(v, list) or not 0 < len(v) <= WINDOWS_MAX:
        raise GridInvalid("grid_option")
    return [_window(w) for w in v]


def _action(v: Any) -> str:
    if v in ACTIONS or (isinstance(v, str) and ENTITY_ID.match(v) and v.split(".")[0] in ("scene", "script")):
        return v
    raise GridInvalid("grid_option")


def _surface(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"color", "opacity", "blur"}:
        raise GridInvalid("grid_option")
    color, opacity, blur = v.get("color", "#808080"), v.get("opacity", 30), v.get("blur", "screen")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise GridInvalid("grid_option")
    if isinstance(opacity, bool) or not isinstance(opacity, int) or not 0 <= opacity <= 100:
        raise GridInvalid("grid_option")
    if blur not in ("screen", "none", "light", "medium", "heavy"):
        raise GridInvalid("grid_option")
    return {"color": color.lower(), "opacity": opacity, "blur": blur}


def _boolean(v: Any) -> bool:
    if not isinstance(v, bool):
        raise GridInvalid("grid_option")
    return v


def _title(v: Any) -> str:
    if not isinstance(v, str) or not 0 < len(v.strip()) <= 60:
        raise GridInvalid("grid_option")
    return v.strip()


def _secondary(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"mode", "attribute", "unit"}:
        raise GridInvalid("grid_option")
    mode = v.get("mode")
    if mode not in ("auto", "state", "brightness", "attribute", "none"):
        raise GridInvalid("grid_option")
    out = {"mode": mode}
    if mode == "attribute":
        attribute = v.get("attribute")
        if not isinstance(attribute, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]{0,79}", attribute):
            raise GridInvalid("grid_option")
        out["attribute"] = attribute
        if "unit" in v:
            if not isinstance(v["unit"], str) or len(v["unit"]) > 20:
                raise GridInvalid("grid_option")
            out["unit"] = v["unit"]
    elif set(v) - {"mode"}:
        raise GridInvalid("grid_option")
    return out


def _accessories(v: Any) -> list[dict[str, Any]]:
    if not isinstance(v, list) or not 0 < len(v) <= LIST_MAX:
        raise GridInvalid("grid_option")
    out, seen = [], set()
    for entry in v:
        if not isinstance(entry, dict) or set(entry) - {"entity", "secondary"}:
            raise GridInvalid("grid_option")
        eid = _domain()(entry.get("entity"))
        if eid in seen:
            raise GridInvalid("grid_option")
        seen.add(eid)
        row = {"entity": eid}
        if "secondary" in entry:
            row["secondary"] = _secondary(entry["secondary"])
        out.append(row)
    return out


def _camera_follow(v: Any) -> str:
    if v not in ("selector", "motion"):
        raise GridInvalid("grid_option")
    return v


def _room_display(v: Any) -> str:
    if v not in ("summary", "scroll"):
        raise GridInvalid("grid_option")
    return v


# a Clock block's face (hk-grid-catalog.js CLOCK_FACES; "" is HK's own clock, stored as no option). "numbers"
# (2026-10-30): Analog Numbers, HomeView's kind of face
CLOCK_FACES = ("analog", "classic", "serif", "flip", "lcd", "neon", "nixie", "dots", "arc", "numbers")
# a Thermostat block's style (hk-grid-catalog.js THERMOSTAT_STYLES): the dial, or Big Number
THERMOSTAT_STYLES = ("dial", "big")
# ...and the HomeView-style faces (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase I), each on its own colour
CLOCK_FACES += ("liquid", "giant", "scattered")


# Scenes and Accessories (2026-10-31): Full, HomeView's square tile, or Half, the shorter button; an Energy Rings
# block's period
TILE_HEIGHTS = ("full", "half")
PERIODS = ("day", "week", "month")
# a camera block's name at its foot
NAME_TAGS = ("auto", "show", "hide")


def _tile_height(v: Any) -> str:
    if v not in TILE_HEIGHTS:
        raise GridInvalid("grid_option")
    return v


def _period(v: Any) -> str:
    if v not in PERIODS:
        raise GridInvalid("grid_option")
    return v


def _name_tag(v: Any) -> str:
    if v not in NAME_TAGS:
        raise GridInvalid("grid_option")
    return v


# WHEN TAPPED (2026-10-31, the owner on 0.1.94: "it would great if the user had an option as well... like Detail Sheet or
# Page"), a block's tap on its plate as the Side Pane's is (settings.py PANE_TAPS): Automatic, its page where the
# screen has one else its sheet; Page or Detail Sheet, that one, else the other; Nothing. Controls inside keep theirs.
TAP_TARGETS = ("auto", "page", "sheet", "none")
# ...and a Music block's own (2026-11-01, the owner): Choose a Playlist, the house's playlists in a sheet
MUSIC_TAPS = ("playlists",)


# A LIVE TV BLOCK'S CHANNEL, by its guide number ("4.1": hk_tv/channels), as the Live TV page names it. Whether the
# house still tunes it is for the card to say (a channel gone from the guide draws the automatic ones).
TV_CHANNEL = re.compile(r"^[0-9]{1,4}(\.[0-9]{1,3})?\Z")


def _tv_channel(v: Any) -> str:
    if not isinstance(v, str) or not TV_CHANNEL.match(v):
        raise GridInvalid("grid_option")
    return v


MUSIC_SHOWS = ("recent", "presets", "playlist")


def _music_show(v: Any) -> str:
    if v not in MUSIC_SHOWS:
        raise GridInvalid("grid_option")
    return v


TIMELINE_SHOWS = ("auto", "latest", "digest")


def _timeline_show(v: Any) -> str:
    if v not in TIMELINE_SHOWS:
        raise GridInvalid("grid_option")
    return v


def _music_playlist(v: Any) -> str:
    # a playlist is named as Music's settings name it; whether the house still has it is the card's to say
    if not isinstance(v, str) or not 0 < len(v.strip()) <= 60 or v != v.strip():
        raise GridInvalid("grid_option")
    return v


# A PRESET as a music block's Plays On (2026-11-01): since presets became Mantel's own lists of rooms they are offered
# by their id ("preset:<key>", hk_core/music/config.py PRESET_ID), never a media_player of their own
MUSIC_PRESET = re.compile(r"^preset:[A-Za-z0-9_-]{1,128}\Z")


def _music_speaker(v: Any) -> str:
    if isinstance(v, str) and MUSIC_PRESET.match(v):
        return v
    return _domain("media_player")(v)


SECURITY_PRESENTATIONS = ("homeview",)
# what a Security block may list as its entries: locks and garage doors (covers)
SECURITY_DOMAINS = ("lock", "cover")


def _security_presentation(v: Any) -> str:
    if v not in SECURITY_PRESENTATIONS:
        raise GridInvalid("grid_option")
    return v


def _security_members(v: Any) -> list[str]:
    """Ordered, each once: the order is the block's and never moves when one unlocks."""
    return _list(_domain(*SECURITY_DOMAINS))(v)


def _tap_target(v: Any) -> str:
    if v not in TAP_TARGETS:
        raise GridInvalid("grid_option")
    return v


def _music_tap(v: Any) -> str:
    if v not in TAP_TARGETS + MUSIC_TAPS:
        raise GridInvalid("grid_option")
    return v


def _np_background(v: Any) -> str:
    """Now Playing's background: the blurred album (`album`, the default) or the card every other block has (`card`)."""
    if v not in ("album", "card"):
        raise GridInvalid("grid_option")
    return v


# ON NOW'S CATEGORIES (2026-11-08, the owner: "Each category should either show a pop up or go to those pages... users
# decisions"): a tapped kind shows its sheet (the default) or goes to its page
ON_NOW_OPENS = ("sheet", "page")
# EVERYTHING'S REST (2026-11-08, the owner: "scroll within the card or go to the page with the + button"): the last
# place, "+N", opens the page (the default, as before) or the places scroll in the block
EVERYTHING_MORE = ("page", "scroll")


def _on_now_open(v: Any) -> str:
    if v not in ON_NOW_OPENS:
        raise GridInvalid("grid_option")
    return v


def _everything_more(v: Any) -> str:
    if v not in EVERYTHING_MORE:
        raise GridInvalid("grid_option")
    return v


def _clock_style(v: Any) -> str:
    if v not in CLOCK_FACES:
        raise GridInvalid("grid_option")
    return v


def _thermostat_style(v: Any) -> str:
    if v not in THERMOSTAT_STYLES:
        raise GridInvalid("grid_option")
    return v


OPTION_KINDS = {
    "room_display": _room_display,
    "clock_style": _clock_style,
    "thermostat_style": _thermostat_style,
    "tile_height": _tile_height,
    "period": _period,
    "name_tag": _name_tag,
    "tap_target": _tap_target,
    "music_tap": _music_tap,
    "np_background": _np_background,
    "on_now_open": _on_now_open,
    "everything_more": _everything_more,
    "security_presentation": _security_presentation,
    "security_members": _security_members,
    "tv_channel": _tv_channel,
    "music_show": _music_show,
    "timeline_show": _timeline_show,
    "music_playlist": _music_playlist,
    # where a music block's tap plays (2026-10-31, the owner): a speaker or a speaker group, else this screen's music
    "music_speaker": _music_speaker,
    "todo": _domain("todo"),
    "camera_follow": _camera_follow,
    "select": _domain("input_select", "select"),
    "boolean": _boolean,
    "title": _title,
    "secondary": _secondary,
    "accessories": _accessories,
    "entity": _domain(),
    "scene": _domain("scene"),
    "scenes": _list(_domain("scene")),
    "speaker": _domain("media_player", room=True),
    "climate": _domain("climate", room=True),
    "alarm": _domain("alarm_control_panel"),
    "camera": _domain("camera"),
    "weather": _domain("weather"),
    "vacuum": _domain("vacuum"),
    "calendars": _list(_domain("calendar")),
    "cameras": _list(_domain("camera")),
    "days": lambda v: _whole(v, 1, 7, "grid_option"),
    "refresh": lambda v: _whole(v, 5, 60, "grid_option"),
    "area": _area,
    "action": _action,
    "windows": _windows,
    "surface": _surface,
}


def _whole(v: Any, lo: int, hi: int, code: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise GridInvalid(code)
    return v


def _opts(card: str, v: Any) -> dict[str, Any]:
    if v is None:
        return {}
    kinds = CATALOG[card]["opts"]
    if not isinstance(v, dict) or set(v) - set(kinds):
        raise GridInvalid("grid_option")
    return {k: OPTION_KINDS[kinds[k]](x) for k, x in v.items()}


def _pages(card: str, v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"source", "start", "list"}:
        raise GridInvalid("grid_pages")
    src = v.get("source")
    if src not in SOURCES:
        raise GridInvalid("grid_pages")
    if src != "list" and src not in CATALOG[card]["sources"]:
        raise GridInvalid("grid_source")
    out: dict[str, Any] = {"source": src}
    if v.get("start") is not None:
        if v["start"] != TABLET_ROOM or src not in STARTS:
            raise GridInvalid("grid_pages")
        out["start"] = TABLET_ROOM
    if src == "list":
        pages = v.get("list")
        if not isinstance(pages, list) or not 1 <= len(pages) <= PAGES_MAX:
            raise GridInvalid("grid_pages")
        out["list"] = []
        for p in pages:
            if not isinstance(p, dict) or set(p) - {"opts"}:
                raise GridInvalid("grid_pages")
            out["list"].append({"opts": _opts(card, p.get("opts"))})
    elif "list" in v:
        raise GridInvalid("grid_pages")
    return out


# The frontend mirrors these named, bounded conditions; no templates or executable expressions.
# "time" (2026-10-24): from "HH:MM" until "HH:MM" in the house's zone, past midnight too; "alarm_disarmed": the
# alarm (the condition's, else the house's) is disarmed.
CONDITIONS = ("music_playing", "timer_running", "alarm_armed", "alarm_disarmed", "doorbell", "after_sunset",
              "entity_state", "time")
# A BLOCK'S RULES (2026-10-24, the owner: "a default card, and certain cards in the same slot when a condition is
# met"): the block's own card by default, and up to RULES_MAX rules, each its card when ALL of its conditions (up to
# ALL_MAX) hold -- the first rule that matches wins. A block's older `when` + `fallback` still reads.
RULES_MAX = 4
ALL_MAX = 3


def condition(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or set(v) - {"kind", "entity", "state", "from", "to"} or v.get("kind") not in CONDITIONS:
        raise GridInvalid("grid_condition")
    kind = v["kind"]
    out = {"kind": kind}
    if "entity" in v:
        if kind == "time":
            raise GridInvalid("grid_condition")
        out["entity"] = _domain()(v["entity"])
    if kind == "entity_state":
        if "entity" not in out or not isinstance(v.get("state"), str) or not 0 < len(v["state"]) <= 80:
            raise GridInvalid("grid_condition")
        out["state"] = v["state"]
    elif "state" in v:
        raise GridInvalid("grid_condition")
    if kind == "time":
        start, end = v.get("from"), v.get("to")
        if not (isinstance(start, str) and CLOCK.match(start) and isinstance(end, str) and CLOCK.match(end)) or start == end:
            raise GridInvalid("grid_condition")
        out["from"], out["to"] = start, end
    elif "from" in v or "to" in v:
        raise GridInvalid("grid_condition")
    return out


def conditions(v: Any) -> dict[str, list[dict[str, str]]]:
    """A rule's conditions, all of which must hold: {"all": [condition, ...]} (a single condition reads as one)."""
    if isinstance(v, dict) and "all" in v:
        if set(v) != {"all"} or not isinstance(v["all"], list) or not 0 < len(v["all"]) <= ALL_MAX:
            raise GridInvalid("grid_condition")
        return {"all": [condition(c) for c in v["all"]]}
    return {"all": [condition(v)]}


def rules(v: Any, size: str) -> list[dict[str, Any]]:
    """A block's rules: each {when, card, opts?, pages?}, its card coming in the block's size."""
    if not isinstance(v, list) or not 0 < len(v) <= RULES_MAX:
        raise GridInvalid("grid_condition")
    out = []
    for r in v:
        if not isinstance(r, dict) or "when" not in r:
            raise GridInvalid("grid_condition")
        got = variant({k: x for k, x in r.items() if k != "when"}, size)
        out.append({"when": conditions(r["when"]), **got})
    return out


# ------------------------------------------------------------ a block's Custom Detail Sheet
# CUSTOM DETAIL SHEET (2026-11-07, docs/phase11/HOME-GRID.md "Custom Detail Sheet"): any block may open a sheet of
# accessories of its own choosing instead of what its card opens. It is the block's, not one card's: it stays while
# rules, a fallback or pages change what the block shows, and goes with the block through a move, a resize, a copy and
# a duplicate. `interaction.tap`: "default" -- the card's own tap (a populated sheet kept as a draft) -- or
# "custom_sheet". The sheet: a title, a header icon, a tile style and its entries, in order; each entry an accessory
# and its look IN THIS SHEET alone (a name, an icon, a color, a tile style, the line under its name). The same
# accessory may be in a sheet twice (two readouts of it); each entry has an id of its own. hk-grid-catalog.js SHEET is
# the frontend's copy of these numbers (a test holds them equal).
INTERACTION_TAPS = ("default", "custom_sheet")
SHEET_VERSION = 1
SHEET_TITLE_MAX = 60
SHEET_NAME_MAX = 60
# the sheet's tile style: absent "Same as Screen"; an entry's: absent "Same as Sheet"
SHEET_TILE_STYLES = TILE_STYLES
# the line under an entry's name: the accessories' modes (_secondary) and its room
ENTRY_SECONDARY = ("auto", "state", "room", "brightness", "attribute", "none")
ENTRY_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}\Z")
# an icon by name, as the icon fields take one: a set and a glyph ("mdi:lock", "hk:garage-open"); never a URL or markup
ICON_NAME = re.compile(r"^[a-z0-9_-]{1,12}:[a-z0-9_-]{1,64}\Z")
# a color: one of the named accents (hk-base.js ACCENTS, and gray), or #rrggbb
ACCENT_NAMES = ("orange", "yellow", "green", "mint", "teal", "cyan", "blue", "indigo", "purple", "pink", "red", "gray")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}\Z")


def _icon_name(v: Any) -> str:
    if not isinstance(v, str) or not ICON_NAME.match(v):
        raise GridInvalid("grid_sheet")
    return v


def _color(v: Any) -> str:
    if isinstance(v, str) and (v in ACCENT_NAMES or HEX_COLOR.match(v)):
        return v.lower()
    raise GridInvalid("grid_sheet")


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str) or not 0 < len(v.strip()) <= most or any(ord(c) < 32 for c in v):
        raise GridInvalid("grid_sheet")
    return v.strip()


def _entry_secondary(v: Any) -> dict[str, str]:
    if not isinstance(v, dict) or v.get("mode") not in ENTRY_SECONDARY:
        raise GridInvalid("grid_sheet")
    if v["mode"] == "room":
        if set(v) != {"mode"}:
            raise GridInvalid("grid_sheet")
        return {"mode": "room"}
    try:
        return _secondary(v)
    except GridInvalid:
        raise GridInvalid("grid_sheet") from None


def _entry(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"id", "entity", "name", "icon", "color", "tile_style", "secondary"}:
        raise GridInvalid("grid_sheet")
    eid = v.get("id")
    if not isinstance(eid, str) or not ENTRY_ID.match(eid):
        raise GridInvalid("grid_sheet")
    entity = v.get("entity")
    if not isinstance(entity, str) or not ENTITY_ID.match(entity):
        raise GridInvalid("grid_sheet")
    out: dict[str, Any] = {"id": eid, "entity": entity}
    if v.get("name") is not None:
        out["name"] = _text(v["name"], SHEET_NAME_MAX)
    if v.get("icon") is not None:
        out["icon"] = _icon_name(v["icon"])
    if v.get("color") is not None:
        out["color"] = _color(v["color"])
    if v.get("tile_style") is not None:
        if v["tile_style"] not in SHEET_TILE_STYLES:
            raise GridInvalid("grid_sheet")
        out["tile_style"] = v["tile_style"]
    if v.get("secondary") is not None:
        sec = _entry_secondary(v["secondary"])
        if sec != {"mode": "auto"}:
            out["secondary"] = sec
    return out


def custom_sheet(v: Any) -> dict[str, Any]:
    """A Custom Detail Sheet as written, checked: {v, title?, icon?, tile_style?, entries}. At most LIST_MAX entries,
    each id once; none is a draft (a sheet that is ON with none is refused by interaction())."""
    if not isinstance(v, dict) or set(v) - {"v", "title", "icon", "tile_style", "entries"}:
        raise GridInvalid("grid_sheet")
    ver = v.get("v", SHEET_VERSION)
    if type(ver) is not int or ver != SHEET_VERSION:
        raise GridInvalid("grid_sheet")
    out: dict[str, Any] = {"v": SHEET_VERSION}
    if v.get("title") is not None:
        out["title"] = _text(v["title"], SHEET_TITLE_MAX)
    if v.get("icon") is not None:
        out["icon"] = _icon_name(v["icon"])
    if v.get("tile_style") is not None:
        if v["tile_style"] not in SHEET_TILE_STYLES:
            raise GridInvalid("grid_sheet")
        out["tile_style"] = v["tile_style"]
    entries = v.get("entries", [])
    if not isinstance(entries, list):
        raise GridInvalid("grid_sheet")
    if len(entries) > LIST_MAX:
        raise GridInvalid("grid_sheet_full")
    out["entries"] = [_entry(e) for e in entries]
    ids = [e["id"] for e in out["entries"]]
    if len(set(ids)) != len(ids):
        raise GridInvalid("grid_sheet")
    return out


def interaction(v: Any) -> dict[str, Any]:
    """A block's When Tapped, as written: {tap, custom_sheet?}. "custom_sheet" needs a sheet with an entry."""
    if not isinstance(v, dict) or set(v) - {"tap", "custom_sheet"} or v.get("tap") not in INTERACTION_TAPS:
        raise GridInvalid("grid_sheet")
    out: dict[str, Any] = {"tap": v["tap"]}
    if v.get("custom_sheet") is not None:
        out["custom_sheet"] = custom_sheet(v["custom_sheet"])
    if out["tap"] == "custom_sheet" and not (out.get("custom_sheet") or {}).get("entries"):
        raise GridInvalid("grid_sheet_empty")
    return out


def _security_size(v: Mapping[str, Any], size: Any) -> None:
    """Compact is Security's HomeView presentation's alone: a block (or a rule's card) at C says so."""
    if size == "C" and (v.get("card") != "security" or v.get("opts", {}).get("presentation") != "homeview"):
        raise GridInvalid("grid_size")


def _capacity(v: Mapping[str, Any], size: str) -> None:
    if v.get("card") != "accessories":
        return
    per = {"W": 2, "T": 2, "L": 4, "XL": 6, "XXL": 12}[size]
    # (Half height, 2026-10-31: the shorter button, two rows in each of Full's)
    if v.get("opts", {}).get("height") == "half":
        per *= 2
    base = v.get("opts", {}).get("accessories", [])
    pages = v.get("pages", {})
    if pages.get("source") == "accessories":
        return
    sets = [p.get("opts", {}).get("accessories", base) for p in pages.get("list", [])] or [base]
    if any(len(entries) > per for entries in sets):
        raise GridInvalid("grid_option")


def variant(v: Any, size: str) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"card", "opts", "pages"}:
        raise GridInvalid("grid_fallback")
    card = v.get("card")
    if not isinstance(card, str) or card not in CATALOG or size not in CATALOG[card]["sizes"]:
        raise GridInvalid("grid_fallback")
    out = {"card": card}
    opts = _opts(card, v.get("opts"))
    if opts:
        out["opts"] = opts
    if v.get("pages") is not None:
        out["pages"] = _pages(card, v["pages"])
    _capacity(out, size)
    _security_size(out, size)
    return out


def item(v: Any, cols: int, rows: int) -> dict[str, Any]:
    """One block, checked against a grid of `cols` x `rows` (its place, not its neighbours)."""
    if not isinstance(v, dict) or set(v) - {"id", "card", "size", "at", "opts", "pages", "when", "fallback", "rules", "bare", "view",
                                              "tile", "interaction"}:
        raise GridInvalid("grid_item")
    if not isinstance(v.get("id"), str) or not ITEM_ID.match(v["id"]):
        raise GridInvalid("grid_item")
    card = v.get("card")
    if not isinstance(card, str) or card not in CATALOG:     # a list or an object is no name (and isn't hashable)
        raise GridInvalid("grid_card")
    size = v.get("size")
    if size not in CATALOG[card]["sizes"]:
        raise GridInvalid("grid_size")
    w, h = span(size, cols, rows)
    if w > cols or h > rows:
        raise GridInvalid("grid_fit")
    at = v.get("at")
    if not isinstance(at, list) or len(at) != 2:
        raise GridInvalid("grid_place")
    c, r = (_whole(x, 0, 99, "grid_place") for x in at)
    if c + w > cols or r + h > rows:
        raise GridInvalid("grid_place")
    out = {"id": v["id"], "card": card, "size": size, "at": [c, r]}
    opts = _opts(card, v.get("opts"))
    if opts:
        out["opts"] = opts
    if v.get("pages") is not None:
        out["pages"] = _pages(card, v["pages"])
    if v.get("when") is not None:
        out["when"] = condition(v["when"])
        out["fallback"] = variant(v.get("fallback"), size)
    elif "fallback" in v:
        raise GridInvalid("grid_condition")
    if v.get("rules") is not None:
        if "when" in out:                         # one way or the other, never both
            raise GridInvalid("grid_condition")
        out["rules"] = rules(v["rules"], size)
    # VIEWS (2026-10-24): the screen's view the block is in, 0 (the first) unless it says
    if "view" in v:
        view = _whole(v["view"], 0, VIEWS_MAX - 1, "grid_item")
        if view:
            out["view"] = view
    # HIDE BOX (2026-10-24): the block's card without its plate, on the background
    if "bare" in v:
        if not isinstance(v["bare"], bool):
            raise GridInvalid("grid_option")
        if v["bare"]:
            out["bare"] = True
    # TILE STYLE (2026-10-30): the block's own, Home or Centred; absent, the screen's
    if "tile" in v:
        if v["tile"] not in TILE_STYLES:
            raise GridInvalid("grid_option")
        out["tile"] = v["tile"]
    # WHEN TAPPED, the block's (2026-11-07): its own Custom Detail Sheet, or the card's tap with a sheet kept as a draft
    if v.get("interaction") is not None:
        out["interaction"] = interaction(v["interaction"])
    _capacity(out, size)
    _security_size(out, size)
    return out


def cells(it: Mapping[str, Any], cols: int = COLS[0], rows: int = ROWS_DEFAULT) -> set[tuple[int, int, int]]:
    """The cells a checked block covers on a `cols` x `rows` grid, in its view (blocks overlap only within one):
    a Full block, all of them."""
    (c, r), (w, h), view = it["at"], span(it["size"], cols, rows), it.get("view", 0)
    return {(view, c + x, r + y) for x in range(w) for y in range(h)}


def _frame(v: Any) -> list[int]:
    if v is None:
        return list(FRAME)
    if not isinstance(v, list) or len(v) != 2:
        raise GridInvalid("grid_frame")
    return [_whole(v[0], *FRAME_W, "grid_frame"), _whole(v[1], *FRAME_H, "grid_frame")]


NIGHT_MODES = ("off", "night", "always")
# THE TOP BAND'S PARTS AND WHERE EACH SITS (2026-11-01, the owner: "the time on the Left, Chips in the Middle, and
# Weather on the Right"): an ordered list -- the order is left to right within a place -- each part at most once;
# a part left out is not shown. Absent: the clock and the weather on the left (header_clock / header_weather say
# whether), the status chips on the right.
HEADER_PARTS = ("clock", "weather", "chips")
HEADER_PLACES = ("left", "center", "right")


def _header(v: Any) -> list[dict[str, str]]:
    if not isinstance(v, list) or len(v) > len(HEADER_PARTS):
        raise GridInvalid("grid")
    out, seen = [], set()
    for x in v:
        if (not isinstance(x, dict) or set(x) != {"k", "at"} or x["k"] not in HEADER_PARTS or x["at"] not in HEADER_PLACES
                or x["k"] in seen):
            raise GridInvalid("grid")
        seen.add(x["k"])
        out.append({"k": x["k"], "at": x["at"]})
    return out


def _night(v: Any) -> dict[str, Any]:
    """NIGHT MODE (2026-10-24, StandBy's): the screen one dim red -- "night" between `from` and `to` (across
    midnight), or "always"."""
    if not isinstance(v, dict) or set(v) - {"mode", "from", "to"} or v.get("mode") not in NIGHT_MODES:
        raise GridInvalid("grid")
    out: dict[str, Any] = {"mode": v["mode"]}
    for key, default in (("from", "22:00"), ("to", "07:00")):
        t = v.get(key, default)
        if not isinstance(t, str) or not CLOCK.match(t):
            raise GridInvalid("grid")
        out[key] = t
    if out["from"] == out["to"]:
        raise GridInvalid("grid")
    return out


def _shape(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict) or set(v) - {"v", "cols", "rows", "frame", "band", "header_clock", "header_weather", "scale", "boxes", "grow",
                                              "header", "night", "views", "items", "cell", "screen"}:
        raise GridInvalid("grid")
    ver = v.get("v", VERSION)
    if type(ver) is not int or ver != VERSION:         # not True, not 1.0: == alone takes both
        raise GridInvalid("grid")
    cols = v.get("cols", COLS[0])
    if type(cols) is not int or cols not in COLS:
        raise GridInvalid("grid_cols")
    rows = _whole(v.get("rows", ROWS_DEFAULT), *ROWS, "grid_rows")
    band = v.get("band", True)
    if not isinstance(band, bool):
        raise GridInvalid("grid")
    items = v.get("items", [])
    if not isinstance(items, list):
        raise GridInvalid("grid")
    if len(items) > ITEMS_MAX:
        raise GridInvalid("grid_items")
    out = {"v": VERSION, "cols": cols, "rows": rows, "frame": _frame(v.get("frame")), "band": band,
           "items": items}
    if "scale" in v:
        out["scale"] = _whole(v["scale"], 50, 100, "grid")
    if "night" in v:
        out["night"] = _night(v["night"])
    if "header" in v:
        out["header"] = _header(v["header"])
    if "views" in v:
        views = _whole(v["views"], 1, VIEWS_MAX, "grid")
        if views > 1:
            out["views"] = views
    # cell: square (2026-10-30) -- tile, the default, is no key; screen: square, the Square screen type's
    if "cell" in v:
        if v["cell"] not in CELLS:
            raise GridInvalid("grid")
        if v["cell"] == "square":
            out["cell"] = "square"
    if "screen" in v:
        if v["screen"] not in SCREENS:
            raise GridInvalid("grid")
        out["screen"] = v["screen"]
    # boxes: False -- every block without its plate (Hide Box, the screen's); grow: True -- the grid may scale past
    # its own size to fill the screen (a phone on its side)
    for key in ("header_clock", "header_weather", "boxes", "grow"):
        if key in v:
            if not isinstance(v[key], bool):
                raise GridInvalid("grid")
            out[key] = v[key]
    return out


def check(v: Any) -> dict[str, Any] | None:
    """A layout as written (None: no layout), every part checked, or GridInvalid."""
    if v is None:
        return None
    out = _shape(v)
    taken: set[tuple[int, int]] = set()
    ids: set[str] = set()
    items = []
    for raw in out["items"]:
        it = item(raw, out["cols"], out["rows"])
        if it["id"] in ids or it.get("view", 0) >= out.get("views", 1):
            raise GridInvalid("grid_item")
        here = cells(it, out["cols"], out["rows"])
        if here & taken:
            raise GridInvalid("grid_overlap")
        ids.add(it["id"])
        taken |= here
        items.append(it)
    out["items"] = items
    return out


def layout(v: Any) -> dict[str, Any] | None:
    """A layout as READ: what is stored can predate a change to the catalog. A block that no longer checks is
    left out (and one that overlaps a block before it); a grid that doesn't is no layout."""
    if v is None:
        return None
    try:
        out = _shape(v)
    except (GridInvalid, TypeError, KeyError):      # read, never raise: one stored screen never stops every feed
        return None
    taken: set[tuple[int, int]] = set()
    ids: set[str] = set()
    items = []
    for raw in out["items"]:
        try:
            it = item(raw, out["cols"], out["rows"])
        except (GridInvalid, TypeError, KeyError):
            continue
        here = cells(it, out["cols"], out["rows"])
        if it["id"] in ids or here & taken or it.get("view", 0) >= out.get("views", 1):
            continue
        ids.add(it["id"])
        taken |= here
        items.append(it)
    out["items"] = items
    return out


# ------------------------------------------------------------ what a person may see of a layout
# The settings feed sends every person every screen's layout. A block names the things it shows (a camera, a
# thermostat, the scenes a block lists); a person who may not view one of them (a Child and the porch camera) must
# not be told it exists by the layout (third audit pass, SRV-4). `only_viewable` cuts a layout down to the entities
# `ok` holds, so the block arrives without the entity instead of breaking the grid: its option is left out and the
# card does what it does with none (the first camera, no scenes row, its automatic place). Pure.
_ENTITY_KINDS = frozenset({"entity", "scene", "speaker", "climate", "alarm", "camera", "weather", "vacuum", "todo",
                           "select", "music_speaker"})
_LIST_KINDS = frozenset({"scenes", "calendars", "cameras", "security_members"})


def _opt_ids(card: str, opts: Any) -> set[str]:
    out: set[str] = set()
    kinds = (CATALOG.get(card) or {}).get("opts") or {}
    for name, value in (opts if isinstance(opts, dict) else {}).items():
        kind = kinds.get(name)
        if kind in _ENTITY_KINDS and isinstance(value, str) and ENTITY_ID.match(value):
            out.add(value)
        elif kind in _LIST_KINDS and isinstance(value, list):
            out |= {v for v in value if isinstance(v, str) and ENTITY_ID.match(v)}
        elif kind == "accessories" and isinstance(value, list):
            out |= {e["entity"] for e in value if isinstance(e, dict) and isinstance(e.get("entity"), str)}
    return out


def _cut_opts(card: str, opts: Any, ok: Any) -> dict[str, Any]:
    kinds = (CATALOG.get(card) or {}).get("opts") or {}
    out: dict[str, Any] = {}
    for name, value in (opts if isinstance(opts, dict) else {}).items():
        kind = kinds.get(name)
        if kind in _ENTITY_KINDS and isinstance(value, str) and ENTITY_ID.match(value):
            if value in ok:
                out[name] = value
        elif kind in _LIST_KINDS and isinstance(value, list):
            kept = [v for v in value if not (isinstance(v, str) and ENTITY_ID.match(v)) or v in ok]
            if kept:
                out[name] = kept
        elif kind == "accessories" and isinstance(value, list):
            kept = [e for e in value if not isinstance(e, dict) or e.get("entity") in ok]
            if kept:
                out[name] = kept
        else:
            out[name] = value
    return out


def _variant_parts(v: Mapping[str, Any]) -> list[tuple[str, Any]]:
    """The (card, opts) pairs of a block or variant: its own, and each page of its list."""
    card = v.get("card")
    pages = v.get("pages") if isinstance(v.get("pages"), dict) else {}
    return [(card, v.get("opts"))] + [(card, p.get("opts")) for p in pages.get("list") or [] if isinstance(p, dict)]


def _conditions_of(when: Any) -> list[dict[str, Any]]:
    if isinstance(when, dict) and isinstance(when.get("all"), list):
        return [c for c in when["all"] if isinstance(c, dict)]
    return [when] if isinstance(when, dict) else []


def entity_ids(grid: Any) -> set[str]:
    """Every entity a layout names: blocks' options, their pages', fallbacks', rules', and conditions'."""
    out: set[str] = set()
    for it in (grid.get("items") if isinstance(grid, dict) else None) or []:
        if not isinstance(it, dict):
            continue
        variants = [it] + ([it["fallback"]] if isinstance(it.get("fallback"), dict) else []) + \
            [r for r in it.get("rules") or [] if isinstance(r, dict)]
        for v in variants:
            for card, opts in _variant_parts(v):
                out |= _opt_ids(card, opts)
        for when in [it.get("when")] + [r.get("when") for r in it.get("rules") or [] if isinstance(r, dict)]:
            out |= {c["entity"] for c in _conditions_of(when) if isinstance(c.get("entity"), str)}
        out |= {e["entity"] for e in _sheet_entries(it) if isinstance(e.get("entity"), str)}
    return out


def _sheet_entries(it: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A block's Custom Detail Sheet's entries (on or a draft), however it was stored."""
    act = it.get("interaction")
    sheet = act.get("custom_sheet") if isinstance(act, dict) else None
    entries = sheet.get("entries") if isinstance(sheet, dict) else None
    return [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []


def _cut_interaction(act: Any, ok: Any) -> Any:
    """The block's sheet without the entries a person may not view -- the entry and its own name, icon and color all
    go, so neither its id nor what the Owner calls it, nor how many there were, reaches them. A sheet left with
    none still opens, to say so (the editor never shows such a person the sheet's settings)."""
    if not isinstance(act, dict):
        return act
    out = copy.deepcopy(act)
    sheet = out.get("custom_sheet")
    if isinstance(sheet, dict) and isinstance(sheet.get("entries"), list):
        sheet["entries"] = [e for e in sheet["entries"] if isinstance(e, dict) and e.get("entity") in ok]
    return out


def _cut_variant(v: Mapping[str, Any], ok: Any) -> dict[str, Any]:
    out = {k: copy.deepcopy(x) for k, x in v.items() if k not in ("opts", "pages")}
    card = v.get("card")
    opts = _cut_opts(card, v.get("opts"), ok)
    if opts:
        out["opts"] = opts
    if isinstance(v.get("pages"), dict):
        pages = copy.deepcopy(v["pages"])
        if isinstance(pages.get("list"), list):
            pages["list"] = [{**p, "opts": _cut_opts(card, p.get("opts"), ok)} if isinstance(p, dict) else p
                             for p in pages["list"]]
        out["pages"] = pages
    return out


def only_viewable(grid: Any, ok: Any) -> Any:
    """The layout with every entity not in ``ok`` taken out (a copy). A condition naming one can never hold for a
    person who cannot see it: a block's older ``when`` shows its fallback, and a rule with such a condition is left
    out. A block that was only that entity arrives with its options gone, not removed: the grid keeps its place."""
    if not isinstance(grid, dict) or not isinstance(grid.get("items"), list):
        return grid
    out = {k: copy.deepcopy(v) for k, v in grid.items() if k != "items"}
    items = []
    for it in grid["items"]:
        if not isinstance(it, dict):
            items.append(it)
            continue
        hidden_when = any(isinstance(c.get("entity"), str) and c["entity"] not in ok
                          for c in _conditions_of(it.get("when")))
        if hidden_when and isinstance(it.get("fallback"), dict):
            new = {k: copy.deepcopy(v) for k, v in it.items() if k not in ("card", "opts", "pages", "when", "fallback")}
            new.update(_cut_variant(it["fallback"], ok))
        else:
            new = _cut_variant(it, ok)
            if isinstance(it.get("fallback"), dict):
                new["fallback"] = _cut_variant(it["fallback"], ok)
            if isinstance(it.get("rules"), list):
                kept = [_cut_variant(r, ok) for r in it["rules"] if isinstance(r, dict) and not any(
                    isinstance(c.get("entity"), str) and c["entity"] not in ok for c in _conditions_of(r.get("when")))]
                if kept:
                    new["rules"] = kept
                else:
                    new.pop("rules", None)
        if "interaction" in it:
            new["interaction"] = _cut_interaction(it["interaction"], ok)
        items.append(new)
    out["items"] = items
    return out


# ------------------------------------------------------------ the starter layouts
# A Tap Weight, C Glance Up, Touch Down, R Room Focus, M Music & Scenes, S Security & Cameras, F Family Hub,
# Q Essentials (the editor's names and descriptions: hk-grid-editor.js STARTERS)
STARTERS = ("A", "C", "R", "M", "S", "F", "Q")


def _chunks(xs: list[str], n: int) -> list[list[str]]:
    return [xs[i:i + n] for i in range(0, len(xs), n)][:PAGES_MAX]


def _scenes_block(iid: str, size: str, at: list[int], scenes: list[str]) -> dict[str, Any]:
    """A scenes block holding the house's scenes: one page of them, or pages that swipe."""
    per = {"W": 2, "T": 2, "L": 4, "XL": 6, "XXL": 12}[size]
    pages = _chunks(scenes[:LIST_MAX * PAGES_MAX], per)
    out: dict[str, Any] = {"id": iid, "card": "scenes", "size": size, "at": at}
    if len(pages) == 1:
        out["opts"] = {"scenes": pages[0]}
    else:
        out["pages"] = {"source": "list", "list": [{"opts": {"scenes": p}} for p in pages]}
    return out


def starter(concept: str, scenes: list[str] | None = None, rooms: list[str] | None = None,
            cameras: list[str] | None = None, climate: list[str] | None = None,
            tablet_room: str | None = None, tab_bar: bool = True) -> dict[str, Any]:
    """A 6 x 4 layout to start from, filled from the house: its scenes, rooms (area ids, in the screen's order),
    cameras and climate entities, and the room of the tablet it is for (None: no tablet yet -- the blocks open
    on their first page). A block with nothing in the house to show is left out. `tab_bar`: the screen shows its
    tab bar, which already opens the pages and the menu -- so no Everything block (an All Lights Off in its place).

    A, Tap Weight: what is tapped most is biggest -- the scene for the time of day, the tablet's room and its
    speaker across the top; scenes, cameras, the thermostat, timers and one-tap jobs below; the top band on.
    C, Glance Up, Touch Down: the glance cards (clock, weather, timers, security) along the top in place of the
    band; the room, thermostat and cameras in the middle; scenes, the speaker and one-tap jobs at the bottom,
    where a hand reaches.
    R, Room Focus: the tablet's room large, its thermostat and speaker beside it; scenes and a camera below.
    M, Music & Scenes: the speaker, the scenes and the scene for the time of day across the top; the room,
    climate and weather below.
    S, Security & Cameras: the cameras large, the alarm, who's home, Lock Up and the garage beside them; the
    room, scenes and the speaker below.
    F, Family Hub: the clock, weather and who's home along the top in place of the band; the calendar, the room
    and the speaker; scenes and one-tap jobs at the bottom.
    Q, Essentials: a calm few -- the scene for now, the room and its thermostat; scenes and the weather."""
    if concept not in STARTERS:
        raise GridInvalid("grid")
    scenes = [s for s in (scenes or []) if ENTITY_ID.match(s) and s.startswith("scene.")]
    rooms = [r for r in (rooms or []) if AREA_ID.match(r)]
    cameras = [c for c in (cameras or []) if ENTITY_ID.match(c) and c.startswith("camera.")]
    climate = [c for c in (climate or []) if ENTITY_ID.match(c) and c.startswith("climate.")]
    here = bool(tablet_room)
    p = concept.lower()
    items: list[dict[str, Any]] = []

    def add(card: str, size: str, at: list[int], **more: Any) -> None:
        items.append({"id": f"{p}{len(items) + 1}", "card": card, "size": size, "at": at, **more})

    def room(size: str, at: list[int]) -> None:
        # a new room block scrolls through all its accessories (the owner's choice, 2026-10-24)
        if rooms:
            add("room", size, at, opts={"accessory_display": "scroll"},
                pages={"source": "rooms", **({"start": TABLET_ROOM} if here else {})})

    def speaker(size: str, at: list[int]) -> None:
        add("now_playing", size, at, **({"opts": {"speaker": TABLET_ROOM}} if here else {}))

    def thermostat(at: list[int]) -> None:
        if climate:
            add("thermostat", "T", at, pages={"source": "thermostats", **({"start": TABLET_ROOM} if here else {})})

    def camera(size: str, at: list[int]) -> None:
        if cameras:
            add("camera", size, at, pages={"source": "cameras"})

    def everything(at: list[int]) -> None:
        if tab_bar:
            add("action", "S", at, opts={"action": "lights_off"})
        else:
            add("everything", "S", at)

    def scene_row(size: str, at: list[int]) -> None:
        if scenes:
            b = _scenes_block(f"{p}{len(items) + 1}", size, at, scenes)
            items.append(b)

    if concept == "A":
        if scenes:
            add("scene_suggested", "L", [0, 0])
        room("L", [2, 0])
        speaker("L", [4, 0])
        scene_row("W", [0, 2])
        camera("L", [2, 2])
        thermostat([4, 2])
        add("timers", "S", [5, 2])
        add("security", "S", [0, 3])
        everything([1, 3])
        add("action", "S", [5, 3], opts={"action": "lock_up"})
        band = True
    elif concept == "R":
        room("XL", [0, 0])
        thermostat([3, 0])
        speaker("T", [4, 0])
        add("timers", "S", [5, 0])
        add("action", "S", [5, 1], opts={"action": "lock_up"})
        scene_row("XL", [0, 2])
        camera("L", [3, 2])
        add("security", "S", [5, 2])
        everything([5, 3])
        band = True
    elif concept == "M":
        speaker("L", [0, 0])
        scene_row("L", [2, 0])
        if scenes:
            add("scene_suggested", "L", [4, 0])
        room("L", [0, 2])
        thermostat([2, 2])
        add("timers", "S", [3, 2])
        everything([3, 3])
        add("weather", "L", [4, 2])
        band = True
    elif concept == "S":
        camera("XL", [0, 0])
        add("security", "W", [3, 0])
        add("action", "S", [5, 0], opts={"action": "lock_up"})
        add("people", "W", [3, 1])
        add("action", "S", [5, 1], opts={"action": "garage"})
        room("L", [0, 2])
        scene_row("L", [2, 2])
        speaker("W", [4, 2])
        add("timers", "S", [4, 3])
        everything([5, 3])
        band = True
    elif concept == "F":
        add("clock", "W", [0, 0])
        add("weather", "W", [2, 0])
        add("people", "W", [4, 0])
        add("calendar", "L", [0, 1])
        room("L", [2, 1])
        speaker("L", [4, 1])
        scene_row("W", [0, 3])
        add("timers", "S", [2, 3])
        add("security", "S", [3, 3])
        add("action", "S", [4, 3], opts={"action": "lock_up"})
        everything([5, 3])
        band = False
    elif concept == "Q":
        if scenes:
            add("scene_suggested", "L", [0, 0])
        room("XL", [2, 0])
        thermostat([5, 0])
        scene_row("XL", [0, 2])
        add("weather", "L", [3, 2])
        add("timers", "S", [5, 2])
        everything([5, 3])
        band = True
    else:
        add("clock", "W", [0, 0])
        add("weather", "W", [2, 0])
        add("timers", "S", [4, 0])
        add("security", "S", [5, 0])
        room("XL", [0, 1])
        thermostat([3, 1])
        camera("L", [4, 1])
        scene_row("W", [0, 3])
        speaker("W", [2, 3])
        add("action", "S", [4, 3], opts={"action": "lock_up"})
        everything([5, 3])
        band = False
    out = check({"v": VERSION, "cols": 6, "rows": ROWS_DEFAULT, "frame": list(FRAME), "band": band,
                 "items": items})
    assert out is not None
    return out


def starter_request(data: Any) -> dict[str, Any]:
    """Read-only editor request. Both hosts use this bounded, checked input."""
    if not isinstance(data, dict) or set(data) - {"concept", "scenes", "rooms", "cameras", "climate", "tablet_room", "tab_bar"}:
        raise GridInvalid("grid")
    if data.get("concept") not in STARTERS or not isinstance(data.get("tab_bar", True), bool):
        raise GridInvalid("grid")
    for key, one in (("scenes", _domain("scene")), ("rooms", _area),
                     ("cameras", _domain("camera")), ("climate", _domain("climate"))):
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 512:
            raise GridInvalid("grid_option")
        for value in values:
            one(value)
    if data.get("tablet_room") is not None:
        _area(data["tablet_room"])
    return starter(**data)
