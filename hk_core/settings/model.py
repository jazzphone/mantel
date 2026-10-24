"""THE DASHBOARD SETTINGS: which entities the pages read, chosen in the UI -- the model.

The header's security line, the weather band, the sky, the idle-return timer
and the car viewport name no entity in their source: they read them from
here. The settings are chosen on the HK Settings page, stored in the entry's
options under "dashboard", and handed to every screen over
`hk_frontend/settings/subscribe` (hk-settings.js), now and again whenever
anything is edited. Each is documented on its topic's page in docs/.

The DEFAULTS assume no particular house. An unset entity is None and each page
has a generic fallback for it -- the first weather entity, the browser's clock,
the moon and the holiday season computed from the date -- so a fresh install
draws something sensible before anything is chosen. hk-settings.js carries the
same DEFAULTS; tests/py/test_settings.py keeps the two in step.

Written once for every host (hk_core; PLAN.md §0, plan review): the schema and its
DEFAULTS, every value's check, the older shapes lifted to the current ones (the *_lifted
migrations, settings_tidied), each screen resolved over All Screens, and what a screen is
handed (as_client). WHAT IS SAVED is plain data, a `Stored`: the options and the items (each
screen, tablet, pop-up, custom page and chip). A store only gets and puts it (to_dict /
from_dict); inside Home Assistant it is the config entry's options and subentries, and the
host's settings.py reads the entry into one.
"""
from __future__ import annotations

from collections.abc import Iterator, Mapping
import copy
from dataclasses import dataclass, field
import json
import re
from typing import Any

from ..house import House
# A time of day ("HH:MM") and Do Not Disturb's shape (a screen's and All Screens'): written once
# with the notifications' rules, read here by every settings check.
from ..notifications.dnd import DND_MAX, hhmm, notify_dnd  # noqa: F401
from ..sleep import rules as SR
from . import home_grid as HG
from . import kinds

CONF_DASHBOARD = "dashboard"


@dataclass(frozen=True)
class Item:
    """One saved item beside the options: a screen (SUBENTRY_DASHBOARD), a tablet, a pop-up, a
    custom page or a custom chip. `unique_id` is its key (a screen's url path, a tablet's
    id ...); `id` and `title` are the store's own (inside Home Assistant, the subentry's)."""
    type: str
    unique_id: str | None
    data: Mapping[str, Any] = field(default_factory=dict)
    title: str = ""
    id: str = ""


@dataclass(frozen=True)
class Stored:
    """EVERYTHING SAVED, as plain data: the options (`dashboard`, and the integration's own
    beside it) and the items, in the store's order. A store gets and puts this (to_dict /
    from_dict); nothing here knows where it lives."""
    options: Mapping[str, Any] = field(default_factory=dict)
    items: tuple[Item, ...] = ()

    def of(self, kind: str) -> Iterator[Item]:
        """The items of one type that have a key, in order."""
        return (it for it in self.items if it.type == kind and it.unique_id)

    def to_dict(self) -> dict[str, Any]:
        return {"options": copy.deepcopy(dict(self.options)),
                "items": [{"type": it.type, "unique_id": it.unique_id, "data": copy.deepcopy(dict(it.data)),
                           "title": it.title, "id": it.id} for it in self.items]}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any] | None) -> Stored:
        d = d or {}
        return cls(dict(d.get("options") or {}),
                   tuple(Item(str(i.get("type") or ""), i.get("unique_id"), dict(i.get("data") or {}),
                              str(i.get("title") or ""), str(i.get("id") or ""))
                         for i in d.get("items") or () if isinstance(i, Mapping)))

# The sky's themes: three holiday SEASONS and seven SURPRISES (hk-sky.js).
SEASONS = ("halloween", "thanksgiving", "christmas")
SURPRISES = ("birthday", "fourth-of-july", "valentines-day", "spring-garden",
             "winter-wonderland", "storybook-magic", "space-night")
THEMES = SEASONS + SURPRISES

# The sky's calendar, all MM-DD, None = built in:
#   halloween 09-22..10-31, thanksgiving 11-01..US Thanksgiving,
#   christmas 12-07..12-25 (the garland stays out of early December),
#   july4 06-28..07-04, valentines 02-08..02-14,
#   spring 03-20..06-20 and winter 12-21..03-19 (southern: six months on).
# A window may wrap the new year (12-20 .. 01-05).
SKY_DATES = tuple(f"{t}_{e}" for t in ("halloween", "thanksgiving", "christmas", "july4",
                                        "valentines", "spring", "winter")
                  for e in ("from", "to"))
# The built-in dates -- the same table as hk-settings.js BUILT_IN / SOUTH
# (tests/py/test_settings.py keeps the two in step). "thanksgiving" is US
# Thanksgiving Day.
SKY_BUILT_IN = {"halloween": ("09-22", "10-31"), "thanksgiving": ("11-01", "thanksgiving"),
                "christmas": ("12-07", "12-25"), "july4": ("06-28", "07-04"),
                "valentines": ("02-08", "02-14"), "spring": ("03-20", "06-20"),
                "winter": ("12-21", "03-19")}
SKY_SOUTH = {"spring": ("09-22", "12-20"), "winter": ("06-21", "09-21")}


def sky_built_in(theme: str, hemisphere: str) -> tuple[str, str]:
    return (hemisphere == "south" and SKY_SOUTH.get(theme)) or SKY_BUILT_IN[theme]


# THE HOUSE'S PLACE, for the defaults a house has not chosen: Home Assistant's latitude and country (each host
# hands them over once it has read its configuration: set_house_place). Latitude below zero is a southern house,
# and a country that is not the US leaves the US-only themes off. Anything unknown keeps the older defaults
# (north, every theme). A saved choice always wins (merged() lays the stored settings over these).
US_ONLY_THEMES = ("thanksgiving", "fourth-of-july")
_PLACE: dict[str, Any] = {"latitude": None, "country": None}


def set_house_place(latitude: Any = None, country: Any = None) -> None:
    lat = latitude if isinstance(latitude, (int, float)) and not isinstance(latitude, bool) else None
    _PLACE["latitude"] = lat
    _PLACE["country"] = country.strip().upper() if isinstance(country, str) and country.strip() else None


def place_sky_defaults() -> dict[str, Any]:
    """The sky's hemisphere and themes for a house that has not saved its own."""
    lat, country = _PLACE["latitude"], _PLACE["country"]
    themes = [t for t in THEMES if not (country and country != "US" and t in US_ONLY_THEMES)]
    return {"hemisphere": "south" if lat is not None and lat < 0 else "north", "themes": themes}


def sky_date(prefix: str, end: str, raw: Any, hemisphere: str) -> str | bool | None:
    """What one of the sky's date fields saves (`<prefix>_<end>`, end "from"
    or "to"): None when it is empty or the built-in date -- so the
    hemisphere can still move it -- a clean MM-DD when it is another date,
    False when it is not a date. Only Thanksgiving's last day may be the
    holiday itself ("Thanksgiving Day"). The settings page saves through
    this (changes.py)."""
    text = str(raw or "").strip()
    built = sky_built_in(prefix, hemisphere)[0 if end == "from" else 1]
    if not text:
        return None
    if text.lower() in ("thanksgiving", "thanksgiving day"):
        return None if built == "thanksgiving" else False
    v = parse_mmdd(text)
    if v is False:
        return False
    return None if v == built else v
# How often, None = built in ("sometimes" / once a month).
SEASON_OFTEN = ("every_day", "sometimes", "near_end")
SURPRISE_OFTEN = ("often", "sometimes", "rarely")
PER_MONTH = ("1", "2", "4")
SPOOKY_OFTEN = ("sometimes", "every_night", "never")
SKY_OFTEN = {"halloween_often": SEASON_OFTEN, "thanksgiving_often": SEASON_OFTEN,
             "christmas_often": SEASON_OFTEN, "spring_often": SURPRISE_OFTEN,
             "winter_often": SURPRISE_OFTEN, "storybook_per_month": PER_MONTH,
             "space_per_month": PER_MONTH, "spooky_often": SPOOKY_OFTEN}
# The sky's backdrops (HK Settings -> Sky / Background): a fixed all-day
# gradient instead of the live sky. "live" is the live sky itself; "custom"
# is the house's own stops (sky.gradient_custom below).
# Python owns the complete palette table; the panel receives it in choices.
# hk-settings.js mirrors it for the dashboard's first paint, before a server
# answer. The parity test compares labels and every stop as well as ids.
# Four stops top to horizon, at [0, .42, .72, 1]. The curated sets stay
# under the live sky's luminance cap; custom stops use its normal scrim.
SKY_BACKDROPS = (
    {"id": "live", "label": "Live Sky"},
    {"id": "dusk", "label": "Dusk",
     "day": ["#141f3d", "#26314f", "#5c4460", "#b06a4a"],
     "night": ["#0c1428", "#161d35", "#33263f", "#5e3730"]},
    {"id": "midnight", "label": "Midnight",
     "day": ["#0d2f57", "#154272", "#256192", "#5b93b8"],
     "night": ["#04070f", "#060a16", "#0a0f1f", "#111726"]},
    {"id": "fjord", "label": "Fjord",
     "day": ["#121634", "#183456", "#1e6e7c", "#579eaa"],
     "night": ["#0a0d22", "#0f2136", "#133f47", "#336163"]},
    {"id": "dune", "label": "Dune",
     "day": ["#171d12", "#3a4020", "#7a5a24", "#b07f38"],
     "night": ["#0d100a", "#1e2112", "#3f2e14", "#5e4522"]},
    {"id": "graphite", "label": "Graphite",
     "day": ["#080a0e", "#0f1219", "#171b23", "#222833"],
     "night": ["#040507", "#080a0d", "#0d1015", "#11141a"]},
    {"id": "plum", "label": "Plum",
     "day": ["#150e1f", "#2e1b42", "#5c2f76", "#9a6bb0"],
     "night": ["#0b0713", "#170e24", "#2e1a3f", "#4c3659"]},
    {"id": "ember", "label": "Ember",
     "day": ["#1c0e10", "#3c1a1e", "#7a2f34", "#b0605f"],
     "night": ["#100708", "#1e0d10", "#3d191c", "#5d3231"]},
    {"id": "mist", "label": "Mist",
     "day": ["#0d1a1c", "#173437", "#22646a", "#56a0a0"],
     "night": ["#080f10", "#0d1e21", "#12373d", "#325556"]},
    # THE CALM ONES (2026-10-16): the Calendar previews the user liked --
    # quiet, low-contrast moods (Sage Mist is the Calendar page's own)
    {"id": "lagoon", "label": "Lagoon",
     "day": ["#0c1d2b", "#14324a", "#1f5068", "#3f7f90"],
     "night": ["#070f18", "#0c1d2b", "#123346", "#244e5c"]},
    {"id": "lavender", "label": "Lavender Dusk",
     "day": ["#15142b", "#25244a", "#3b3a6a", "#68679a"],
     "night": ["#0b0a18", "#15142b", "#232245", "#3a3962"]},
    {"id": "sage", "label": "Sage Mist",
     "day": ["#0e1a18", "#18302b", "#284a42", "#4f7a6c"],
     "night": ["#08100e", "#0f1d1a", "#1a302b", "#2f4a42"]},
    {"id": "harbor", "label": "Harbor Slate",
     "day": ["#111a26", "#1c2b3e", "#2d4159", "#566e8a"],
     "night": ["#090e16", "#111a26", "#1b2a3c", "#2f4359"]},
    {"id": "rosewater", "label": "Rosewater",
     "day": ["#1c1418", "#33232b", "#523844", "#86626f"],
     "night": ["#100b0e", "#1c1418", "#2e1f26", "#4a343e"]},
    {"id": "driftwood", "label": "Driftwood",
     "day": ["#1a1712", "#2f2a21", "#4b4333", "#7c6f57"],
     "night": ["#0e0c09", "#1a1712", "#2a251c", "#443c2e"]},
    # Black (2026-10-13): what a screen with its Live Sky turned off showed
    # -- the views' own near-black -- as a color to choose
    {"id": "black", "label": "Black",
     "day": ["#05070e", "#05070e", "#05070e", "#05070e"],
     "night": ["#05070e", "#05070e", "#05070e", "#05070e"]},
    {"id": "custom", "label": "Custom"},
)
SKY_BACKDROP_IDS = tuple(p["id"] for p in SKY_BACKDROPS)
# THE BACKGROUND (2026-10-13, Sky / Background's first choice, for All
# Screens, a screen and a page): the live sky; a still Color (one of the
# backdrops but Live); or a Photo of your own, still. Color and Photo draw
# no sun, moon, stars, weather or decorations -- before this, a Backdrop
# color only recolored the live sky, and its stars still showed through.
# LANDSCAPES (2026-10-14): HK Frontend's own photos (frontend/landscapes, the
# screensaver clock's), still, as a Photo is -- a new one each day or hour,
# or one picked (SKY_LANDSCAPE).
SKY_BACKGROUNDS = ("live", "color", "photo", "landscapes")
SKY_COLOR_IDS = tuple(i for i in SKY_BACKDROP_IDS if i != "live")
# A PAGE'S BACKGROUND (Sky / Background -> Pages): its own color, any
# backdrop -- "live" among them, the live sky -- "photo" (its own photo,
# sky.page_photos, else the screen's) or "landscapes" (the screen's
# Landscape)
SKY_PAGE_MODES = ("own",) + SKY_BACKDROP_IDS + ("photo", "landscapes")
# A PHOTO'S ADDRESS: one uploaded to Home Assistant (image_upload, served
# without sign-in from this origin, so the sky can measure it), or a file in
# www (/local/...) or HK's own files folder (/hk/...)
SKY_PHOTO = re.compile(r"^/(api/image/serve/[0-9a-f]{32}/original|(local|hk)/[^\s\"'<>()\\]{1,200})$")
# WHICH LANDSCAPE, AND WHEN IT CHANGES (the owner's three): "wake" -- a new
# one each time the screen wakes (the screensaver or the black starts, or
# the page is hidden for a minute: it changes while nobody is looking);
# "every:<minutes>" -- on a schedule (SKY_LANDSCAPE_EVERY); or a file name
# in the landscapes folder's index.json -- Stay the Same, on that one (no
# folders: a name, never a path)
SKY_LANDSCAPE_EVERY = (15, 30, 60, 180, 360, 720, 1440)
SKY_LANDSCAPE_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$")
_MMDD = re.compile(r"^\s*(\d{1,2})-(\d{1,2})\s*$")


def parse_mmdd(text: str | None) -> str | bool | None:
    """'12-01' -> '12-01'; empty -> None; anything else -> False."""
    if not (text or "").strip():
        return None
    m = _MMDD.match(text)
    if not m or not (1 <= int(m.group(1)) <= 12 and 1 <= int(m.group(2)) <= 31):
        return False
    return f"{int(m.group(1)):02d}-{int(m.group(2)):02d}"


def board_headers(v: Any) -> dict[str, bool]:
    """A screen's own page headers: {page: False} for each header it turns
    off (a page with a header, HEADERS); anything else is dropped."""
    if not isinstance(v, Mapping):
        return {}
    return {k: False for k, on in v.items() if k in HEADERS and on is False}


def sky_pages(v: Any) -> dict[str, str] | None:
    """Each page's background as stored: {page kind or custom page address:
    a SKY_PAGE_MODES value}; None when it cannot be read. An unknown page or
    mode is left out (a page removed, a backdrop retired)."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    return {str(k): m for k, m in v.items()
            if isinstance(k, str) and re.match(r"^[a-z0-9][a-z0-9_-]{0,39}$", k) and m in SKY_PAGE_MODES}


# FLAT'S BACKGROUNDS (2026-10-16). Flat (look.flat) draws no live sky, so it
# keeps backgrounds of its own and the Glass looks' Sky / Background stays as
# it was for when Flat is left: a Color, a Photo or Landscapes (the same photo
# and landscape choices the Glass looks use), a Fade over a photo, and each
# page's own. A color is "auto" (the page's own ground -- Climate's sage,
# Lights' beige ... -- else the theme's), one of FLAT_COLORS, which has a
# Light and a Dark tone each, or "#rrggbb", the same in both themes.
# hk-base.js FLAT_COLORS mirrors this table (tests/py/test_flat.py).
FLAT_BACKGROUNDS = ("color", "photo", "landscapes")
FLAT_COLORS = (
    {"id": "stone", "label": "Stone", "light": "#EEECE6", "dark": "#17181A"},
    {"id": "paper", "label": "Paper", "light": "#F7F6F2", "dark": "#232427"},
    {"id": "sand", "label": "Sand", "light": "#F1ECE3", "dark": "#1D1A16"},
    {"id": "sage", "label": "Sage", "light": "#EAF0ED", "dark": "#151C1B"},
    {"id": "mist", "label": "Mist", "light": "#E9EDF0", "dark": "#171B20"},
    {"id": "sky", "label": "Sky", "light": "#E6EEF5", "dark": "#141C26"},
    {"id": "lavender", "label": "Lavender", "light": "#EEEBF1", "dark": "#1C1821"},
    {"id": "blush", "label": "Blush", "light": "#F4EAE7", "dark": "#211718"},
    # (in Light, the deepest stone: "Black" there would be a gray)
    {"id": "black", "label": "Black", "light_label": "Pebble", "light": "#E2E1DC", "dark": "#000000"},
)
FLAT_COLOR_IDS = ("auto",) + tuple(c["id"] for c in FLAT_COLORS)
FLAT_FADE = 50
FLAT_TINT_AMOUNT = 60      # a photo's Tint: how far the photo is turned to its color


def flat_color(v: Any) -> str | None:
    """A Flat color as stored ("auto", a FLAT_COLORS id or "#rrggbb"), or None."""
    if not isinstance(v, str):
        return None
    if v in FLAT_COLOR_IDS:
        return v
    return v.upper() if ACCENT_HEX.fullmatch(v) else None


def flat_pages(v: Any) -> dict[str, str] | None:
    """Each page's Flat background ({page: a Flat color, "photo" or
    "landscapes"}); None when it can't be read. An unknown page or value is
    left out."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    out = {}
    for k, m in v.items():
        if not (isinstance(k, str) and re.match(r"^[a-z0-9][a-z0-9_-]{0,39}$", k)):
            continue
        m = m if m in ("photo", "landscapes") else flat_color(m)
        if m:
            out[k] = m
    return out


# FLAT COLORS (2026-10-17, hk_house/docs/PLAN-2026-10-17-flat-appearance-colors.md):
# Flat's own palette, two fields resolved each on its own --
#   accent    "auto" | an ACCENTS name | "#rrggbb": the seed that colors an
#             Automatic background, the current page's highlight and a
#             Match Accent tint
#   off_tint  "auto" | "accent" | an ACCENTS name | "#rrggbb": the wash on
#             pills that are off ("accent" a binding to the final accent,
#             never a copy of it)
#   pages     "accent" | "own" (2026-10-17, the user): whether the pages
#             that have a color of their own (Climate blue, Lights
#             yellow...) take an accent chosen for the whole screen, or keep
#             theirs as Automatic does -- Home and the rooms take it either
#             way. All Screens and a screen only: a page's own accent is
#             always its own.
# at four levels: All Screens (look.flat_colors, both fields always there),
# All Screens' pages (look.flat_page_colors), a screen (flat_colors) and a
# screen's pages (flat_page_colors). A field missing below All Screens is
# Same as / inherited; "auto" stops there. Pages are keyed as Flat's
# backgrounds are (home, a page kind, rooms, room-<slug>, a custom page's
# address). hk-settings.js resolveFlatColors reads them.
FLAT_COLOR_FIELDS = ("accent", "off_tint", "pages")
FLAT_PAGE_FIELDS = ("accent", "off_tint")
FLAT_PAGES_MODES = ("accent", "own")
FLAT_COLORS_DEFAULT = {"accent": "auto", "off_tint": "auto", "pages": "accent"}
FLAT_PAGE_KEY = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
FLAT_PAGES_MAX = 200


def flat_field(field: str, v: Any) -> str | None:
    """One Flat Colors field as stored, or None when it isn't one."""
    if field == "pages":
        return v if v in FLAT_PAGES_MODES else None
    a = accent(v)
    if field == "off_tint" and str(v or "").strip().lower() == "accent":
        return "accent"
    return a


def flat_colors(v: Any, strict: bool = False, fields: tuple = FLAT_COLOR_FIELDS) -> dict[str, str] | None:
    """A sparse Flat Colors object ({accent?, off_tint?}) as stored. Read
    (strict False): what can't be read is left out. Strict: None for an
    unknown key or a bad value -- nothing is half saved."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    out = {}
    for k, x in v.items():
        if k not in fields:
            if strict:
                return None
            continue
        if x is None:
            continue
        got = flat_field(k, x)
        if got is None:
            if strict:
                return None
            continue
        out[k] = got
    return out


def flat_page_colors(v: Any, strict: bool = False) -> dict[str, dict[str, str]] | None:
    """Each page's Flat Colors ({page: FlatColors}); an empty page is left
    out. Strict as flat_colors()."""
    if v is None:
        return {}
    if not isinstance(v, Mapping) or (strict and len(v) > FLAT_PAGES_MAX):
        return None
    out = {}
    for k, x in v.items():
        ok = isinstance(k, str) and FLAT_PAGE_KEY.match(k)
        got = flat_colors(x, strict, FLAT_PAGE_FIELDS) if ok else None
        if got is None:
            if strict:
                return None
            continue
        if got:
            out[k] = got
    return dict(list(out.items())[:FLAT_PAGES_MAX])


def flat_tint(v: Any) -> str | None:
    """A Flat photo's or landscape's Tint (2026-10-17): "none", "accent"
    (the page's accent) or "#rrggbb" -- the photo turned to that color, its
    own light and dark kept; None for anything else."""
    t = str(v or "").strip().lower()
    return t if t in ("none", "accent") or ACCENT_HEX.fullmatch(t) else None


# Sparse v2 photo treatment. No stored mode means legacy rendering: old
# strength/brightness numbers never silently acquire new meanings.
FLAT_IMAGE_DEFAULTS = {"mode": "legacy", "color": "accent", "strength": 80,
                       "depth": 40, "brightness": 0, "fade": 35}


def flat_image_look(v: Any, strict: bool = False) -> dict[str, Any] | None:
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    out = {}
    for k, x in v.items():
        if k not in FLAT_IMAGE_DEFAULTS:
            if strict:
                return None
            continue
        if x is None:
            continue
        if k == "mode":
            good = isinstance(x, str) and x in ("legacy", "original", "tinted")
        elif k == "color":
            x = x.strip().lower() if isinstance(x, str) else x
            good = isinstance(x, str) and (x == "accent" or bool(ACCENT_HEX.fullmatch(x)))
        else:
            good = (isinstance(x, (int, float)) and not isinstance(x, bool)
                    and (-50 if k == "brightness" else 0) <= x <= (50 if k == "brightness" else 100)
                    and int(x) == x)
        if not good:
            if strict:
                return None
            continue
        out[k] = x if k in ("mode", "color") else int(x)
    return out


def flat_page_image_looks(v: Any, strict: bool = False) -> dict[str, Any] | None:
    if v is None:
        return {}
    if not isinstance(v, Mapping) or (strict and len(v) > FLAT_PAGES_MAX):
        return None
    out = {}
    for k, x in v.items():
        got = flat_image_look(x, strict) if isinstance(k, str) and FLAT_PAGE_KEY.fullmatch(k) else None
        if got is None:
            if strict:
                return None
            continue
        if got:
            out[k] = got
    return dict(list(out.items())[:FLAT_PAGES_MAX])


CHIP_SHOWS = ("always", "active")


def chips_custom_show(v: Any) -> dict[str, str] | None:
    """Each custom chip's Show on a screen ({key: always | active}); None when
    it can't be read. A key or value that isn't one is left out."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    return {k: m for k, m in v.items() if isinstance(k, str) and CHIP_KEY.match(k) and m in CHIP_SHOWS}


def sky_photo(v: Any) -> str | None:
    """A background photo's address as stored, or None (none, or one this
    can't show)."""
    return v if isinstance(v, str) and SKY_PHOTO.match(v) else None


# SKY / BACKGROUND'S RESET TO DEFAULTS (2026-10-14): every setting on the
# page goes back -- but not the Pages (pages, page_photos, page_looks), the
# photo and custom colors you made (photo, gradient_custom: kept for next
# time), or Advanced's dates, hemisphere and sources. A screen's reset is
# SKY_RESET_BOARD to None: Same as All Screens.
SKY_RESET = ("background", "color", "landscape", "photo_look", "landscape_look", "image_look", "flat_background", "flat_color", "flat_image_look", "flat_fade", "flat_tint", "flat_tint_amount", "flat_tint_light",
             "animations", "focus_pause", "moving", "weather", "precipitation",
             "cloud_style", "daytime", "gradient", "decorations", "decoration_style",
             "woodland", "themes", "liveliness_all", "liveliness", "liveliness_custom")
SKY_RESET_BOARD = ("sky_background", "sky_color", "sky_landscape", "sky_photo_look", "sky_landscape_look", "sky_image_look",
                   "sky_flat_background", "sky_flat_color", "sky_flat_image_look", "sky_flat_fade", "sky_flat_tint", "sky_flat_tint_amount", "sky_flat_tint_light",
                   "sky_animations", "sky_focus_pause", "sky_moving", "sky_weather", "sky_precipitation",
                   "sky_cloud_style", "sky_daytime", "sky_gradient", "sky_decorations", "sky_decoration_style",
                   "sky_liveliness", "sky_liveliness_occ", "sky_liveliness_custom", "sky_calm_empty")


def sky_landscape(v: Any) -> str | None:
    """Which landscape, as stored: "wake", "every:<minutes>" or a file
    name; None when it isn't one."""
    if not isinstance(v, str):
        return None
    if v == "wake" or SKY_LANDSCAPE_FILE.match(v):
        return v
    m = re.match(r"^every:(\d{1,4})$", v)
    return v if m and int(m.group(1)) in SKY_LANDSCAPE_EVERY else None


def sky_page_photos(v: Any) -> dict[str, str] | None:
    """Each page's own photo: {page: address}; None when it cannot be read.
    A page or address that isn't one is left out."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    return {str(k): u for k, u in v.items()
            if isinstance(k, str) and re.match(r"^[a-z0-9][a-z0-9_-]{0,39}$", k) and sky_photo(u)}


# A BACKGROUND PHOTO'S LOOK (2026-10-13, Sky / Background -> Photo -> Look):
# blur (0-100 %, up to 40 px), dim (0-80 %), saturation (0-200 %, 100 as
# taken), and a color tint -- one of the Color backdrops washed over it at
# tint_amount (0-80 %); "" no tint. A page's photo has its screen's look.
PHOTO_LOOK_DEFAULTS = {"blur": 0, "dim": 0, "saturation": 100, "tint": "", "tint_amount": 35}
PHOTO_LOOK_RANGES = {"blur": (0, 100), "dim": (0, 80), "saturation": (0, 200), "tint_amount": (0, 80)}


def photo_look(v: Any) -> dict[str, Any] | None:
    """A photo's look as stored -- every key, each in range -- or None when it
    can't be read. A key missing is its default."""
    if not isinstance(v, Mapping) or set(v) - set(PHOTO_LOOK_DEFAULTS):
        return None
    out = dict(PHOTO_LOOK_DEFAULTS)
    for k, (lo, hi) in PHOTO_LOOK_RANGES.items():
        if k in v:
            n = v[k]
            if isinstance(n, bool) or not isinstance(n, (int, float)) or not lo <= n <= hi:
                return None
            out[k] = int(round(n))
    if "tint" in v:
        if v["tint"] not in ("", None) and v["tint"] not in SKY_COLOR_IDS:
            return None
        out["tint"] = v["tint"] or ""
    return out


def page_looks(v: Any) -> dict[str, dict[str, Any]] | None:
    """Each page's own photo look: {page: photo_look}; None when it cannot be
    read. A page or look that isn't one is left out."""
    if v is None:
        return {}
    if not isinstance(v, Mapping):
        return None
    out = {}
    for k, look in v.items():
        got = photo_look(look) if isinstance(k, str) and re.match(r"^[a-z0-9][a-z0-9_-]{0,39}$", k) else None
        if got is not None:
            out[k] = got
    return out


def sky_stops(v: Any) -> dict[str, list[str]] | None:
    """A custom backdrop's stops, as stored: {day: ["#rrggbb" x 4],
    night: [...]}, lowercased; None when it is None or says nothing else."""
    if v is None:
        return None
    if not isinstance(v, Mapping):
        return None
    out: dict[str, list[str]] = {}
    for k in ("day", "night"):
        s = v.get(k)
        if not isinstance(s, (list, tuple)) or len(s) != 4 \
                or not all(isinstance(x, str) and ACCENT_HEX.fullmatch(x) for x in s):
            return None
        out[k] = [x.lower() for x in s]
    return out


# The menu (docs/Menu.md): its button's picture -- the iPad sidebar glyph, or
# three lines.
MENU_GLYPHS = ("sidebar", "lines")
# THE MENU'S HIGHLIGHT (its icons and the current page's row): one of Apple's
# system colours by name (hk-menu.js ACCENTS has their values), or "#rrggbb".
ACCENTS = ("orange", "yellow", "green", "mint", "teal", "cyan", "blue", "indigo", "purple", "pink", "red")
ACCENT_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
# A dashboard item's Menu -> Tab position: a distance from the top of the page, or a share
# of its height. A bare number is px.
TAB_POSITION = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$")


DOCK_MIN = (700, 3000)      # a screen's Menu -> "Keep Open Down To", px


def tab_position(text: object) -> str | None:
    """"" for automatic, "140px" / "20%" normalized, None when it is neither."""
    t = str(text or "").strip()
    if not t or t.lower() in ("auto", "automatic"):
        return ""
    m = TAB_POSITION.match(t)
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2) or "px"
    if (unit == "%" and n > 100) or (unit == "px" and n > 4000):
        return None
    return f"{n:g}{unit}"


# What a room page's status row may show, in the order it shows them by
# default: the Home app's own (a room there, 2026-10-04) -- readings, the
# security system, the accessories, the sensors, and what is playing. The
# saved list (rooms.status) is in the house's own order.
STATUS_KINDS = ("temperature", "humidity", "security", "tvs", "lights", "outlets", "blinds", "fans",
                "windows", "doors", "locks", "garage", "valves", "motion", "occupancy", "leaks", "speakers")
# ...those added in entry 1.10 (HK Frontend 1.5), which a list saved before is given
STATUS_KINDS_ADDED = ("security", "tvs", "lights", "valves", "speakers")

# THE PAGES' STATUS ROWS (hk-room.js pageItems): the row under a category
# page's title, as Climate's. Each page: (what it may show, what it shows by
# default, in order). Saved as status_rows.<page> = {status, exclude_areas}.
STATUS_ROWS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "climate": (("temperature", "humidity", "blinds", "fans"),
                ("temperature", "humidity", "blinds", "fans")),
    "lights": (("lights", "outlets"), ("lights", "outlets")),
    "doors_windows": (("doors", "windows", "garage", "motion", "occupancy"),
                      ("doors", "windows", "motion", "occupancy")),
    "water": (("leaks", "valves"), ("leaks", "valves")),
    "security": (("security", "locks", "garage", "doors", "windows", "leaks", "motion", "occupancy"),
                 ("security", "locks", "garage", "doors", "windows", "leaks")),
    # (2026-10-16, Pages): the utility pages' rows, as hk-room.js PAGE_ROWS
    "vacuums": (("vacuums", "vacuum_battery"), ("vacuums", "vacuum_battery")),
    "timers": (("timers",), ("timers",)),
}

# THE PAGE HEADERS' settings, per page (settings.headers.<page>): show the
# header, and the few things a page's cards cannot always guess.
#   climate.thermostats: the thermostats counted (None: every one that reports
#     heating and cooling)
#   lights.rooms: how many rooms Lighting Through the Day lists (2-5)
#   lights.left_on / lights.tonight: the right-hand card's two halves
#   lights.exclude_areas: rooms Left On never names (None: outdoor-sounding
#     areas and those the page's status row leaves out)
#   lights.after_min: how long a room is empty before its light is "left on"
#   lights.automations: the automations Tonight lists (None: every one that
#     switches the page's lights at a time or the sun)
#   lights.sky_follow: the page's amber backdrop takes the color temperature
#     of the light outside now (hk-sky.js sunKelvin)
#   lights.sky_source: the Adaptive Lighting switch it reads (None: the
#     first one found; none at all: the sun's elevation)
#   security.callouts: the labels on the house picture
#   security.front_door / back_door / garage: the lock, contact or garage
#     door each label reads (None: found by name)
#   security.low_battery: Device Care's low battery, percent
#   water.meter: the water meter the day's usage reads (None: the Energy
#     settings' water source, else the first water meter)
#   water.supply: the main supply valve the header controls (None: the valve
#     named main/supply/shut-off, else the house's only non-irrigation valve)
#   timers.presets: Quick Start's durations, minutes (1-6 of them)
#   timers.names: Quick Start's name chips (up to 6)
#   vacuums.counters: the mission counters the header reads (None: each
#     vacuum's own successful/failed/canceled sensors, found by name)
HEADERS: dict[str, dict[str, Any]] = {
    "climate": {"show": True, "thermostats": None},
    "lights": {"show": True, "rooms": 3, "left_on": True, "tonight": True, "exclude_areas": None,
               "after_min": 10, "automations": None, "sky_follow": True, "sky_source": None},
    "security": {"show": True, "callouts": True, "front_door": None, "back_door": None, "garage": None,
                 "low_battery": 20},
    "water": {"show": True, "meter": None, "supply": None},
    "timers": {"show": True, "presets": [5, 10, 15, 20, 30, 60],
               "names": ["Pasta", "Oven", "Laundry", "Tea", "Kids", "Break"]},
    "vacuums": {"show": True, "counters": None},
}
HEADER_ROOMS = (2, 5)
HEADER_PRESETS = (1, 6)          # how many quick durations
HEADER_PRESET_MIN = (1, 720)     # each, in minutes
HEADER_NAMES = 6                 # how many name chips
HEADER_NAME_LEN = 16
HEADER_AFTER = (5, 120)
HEADER_BATTERY = (5, 50)

# The clouds' looks (sky.cloud_style, a screen's sky_cloud_style)
CLOUD_STYLES = ("classic", "realistic")
# Moving Things: where the sky's moving things are drawn (sky.moving)
SKY_MOVING = ("behind", "front")
# Notifications on a screen's screensaver: every one, only the Important ones,
# none (a notification set to Wakes the Screen wakes it whatever this says)
NOTIFY_SAVERS = ("all", "important", "off")
# NOW PLAYING (2026-10-15): where the music playing shows -- a side pane
# beside the page (the screensaver's own music pane) or the bar along the
# bottom or the top. Tablets & computers choose; a phone always has the bar,
# and so does a screen where the pane does not fit.
NP_STYLES = ("pane", "bar")
NP_SIDES = ("right", "left")
NP_BARS = ("bottom", "top")
# ...and how long it stays once the music is paused or stopped (seconds),
# the bar, the pane and the screensaver's music alike -- longer while it is
# being used (Speakers / Browse open, a touch on it)
NP_GRACES = (10, 20, 30, 60, 120)

# The daytime sky (sky.daytime, a screen's sky_daytime): how bright the midday
# blue runs -- natural (a real midday sky), balanced, or deep (the dusky blue
# the palette was first authored as). hk-sky.js raises its luminance cap with
# it, so the cards stay readable at all three. Dusk and night are the same.
DAYTIME_SKIES = ("natural", "balanced", "deep")

# The seasons whose woodland New Decorations shows between occasions (sky.woodland)
WOODLAND_SEASONS = ("spring", "summer", "fall", "winter")

# LIVELINESS (hk-sky.js lvOf; docs/Sky-Liveliness.md): how many of the little
# moving things there are and how often the ones that cross come by. A KNOB is
# one setting of one effect: its kind -- what a screen's own Custom scales --
# and its type: "many" a count, "often" a crossing's cycle (Off: it never
# comes), "show" on or off. A knob's step is 0-4: Off, Few, Normal, Lots, Max.
# hk-sky.js LV_KNOBS and hk-settings-model.js LIVELY carry the same table
# (tests/test_liveliness.js holds the three together).
LIVELY_KNOBS: dict[str, tuple[str, str]] = {
    "bats": ("flying", "many"), "bats_often": ("flying", "often"), "swarm": ("flying", "many"),
    "witch": ("flying", "often"), "geese": ("flying", "often"), "sleigh": ("flying", "often"),
    "flyby": ("flying", "often"), "balloons": ("flying", "show"),
    "leaves": ("falling", "many"), "swirl": ("falling", "many"), "petals": ("falling", "many"),
    "snow": ("falling", "many"), "particles": ("falling", "many"), "mist": ("falling", "show"),
    "fireflies": ("glowing", "many"), "glints": ("glowing", "many"), "lights": ("glowing", "show"),
    "owl": ("glowing", "show"), "rainbow": ("glowing", "show"),
    "stars": ("night", "many"), "meteors": ("night", "often"), "fireworks": ("night", "often"),
    "aurora": ("night", "often"),
}
# LIVELINESS, THE SAME AT EVERY LEVEL (2026-10-09): one choice for every
# occasion (sky.liveliness_all; a screen's sky_liveliness, None: Same as All
# Screens) -- a preset, or "custom": then each occasion its own preset or
# Custom knobs (sky.liveliness / sky.liveliness_custom; a screen's
# sky_liveliness_occ / sky_liveliness_custom)
LIVELY_PRESETS = ("subtle", "classic", "festive", "party", "custom")
# EACH OCCASION'S KNOBS (each theme, each woodland season, and "night": the
# screensaver's stars), with the decoration style that draws each: "new",
# "old" or "both". HK Settings shows only the knobs of a style in use.
LIVELY_OCCASIONS: dict[str, tuple[tuple[str, str], ...]] = {
    "halloween": (("bats", "both"), ("bats_often", "new"), ("swarm", "new"), ("witch", "both"),
                  ("owl", "new"), ("mist", "both"), ("leaves", "both"), ("lights", "both")),
    "thanksgiving": (("leaves", "both"), ("swirl", "new"), ("geese", "new")),
    "christmas": (("snow", "old"), ("sleigh", "both"), ("glints", "new"), ("aurora", "new"), ("lights", "both")),
    "fourth-of-july": (("fireworks", "both"), ("fireflies", "new"), ("particles", "old"), ("lights", "new")),
    "valentines-day": (("particles", "old"),),
    "spring-garden": (("petals", "both"), ("flyby", "both"), ("rainbow", "new")),
    "winter-wonderland": (("particles", "old"), ("glints", "new"), ("aurora", "new")),
    "storybook-magic": (("particles", "old"), ("flyby", "old")),
    "space-night": (("particles", "old"), ("flyby", "old")),
    "birthday": (("particles", "both"), ("balloons", "new"), ("lights", "new")),
    "spring": (("petals", "new"), ("flyby", "new"), ("rainbow", "new")),
    "summer": (("fireflies", "both"), ("rainbow", "new"), ("lights", "new")),
    "fall": (("leaves", "new"), ("swirl", "new"), ("geese", "new")),
    "winter": (("glints", "new"), ("aurora", "new")),
    "night": (("stars", "both"), ("meteors", "both")),
}


def lively(v: Any) -> dict[str, str] | None:
    """Each occasion's Liveliness preset ({occasion: preset}); None when it
    does not parse. An occasion left out is Classic."""
    if not isinstance(v, dict):
        return None
    if any(k not in LIVELY_OCCASIONS or p not in LIVELY_PRESETS for k, p in v.items()):
        return None
    return dict(v)


def lively_custom(v: Any) -> dict[str, dict[str, int]] | None:
    """Custom occasions' knobs ({occasion: {knob: 0-4}}), each knob one its
    occasion has; None when it does not parse."""
    if not isinstance(v, dict):
        return None
    out: dict[str, dict[str, int]] = {}
    for occ, knobs in v.items():
        own = {k for k, _style in LIVELY_OCCASIONS.get(occ, ())}
        if not own or not isinstance(knobs, dict):
            return None
        for k, step in knobs.items():
            if k not in own or isinstance(step, bool) or not isinstance(step, int) or not 0 <= step <= 4:
                return None
        out[occ] = dict(knobs)
    return out



# THE WEATHER PAGE (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md):
# what the page shows, in `weather.page`, and its own radar map, in
# `weather.radar_native` -- two typed objects of the weather section, each
# read over its own defaults (weather_page / radar_native below), so a
# partly stored one is still whole. The weather service and its sensors stay
# the section's other keys, shared with the header, Climate and the
# screensaver; these two are the Weather page's alone.
WEATHER_DETAILS = ("wind", "sun", "uv", "humidity", "moon", "pressure")
WEATHER_HOURS = (6, 12, 24)
WEATHER_DAYS = (5, 8, 10)
WEATHER_METRICS = ("temperature", "rain", "wind")
WEATHER_PAGE_DEFAULTS: dict[str, Any] = {
    "show_current": True, "show_hourly": True, "show_daily": True, "show_alerts": True,
    "hours": 12, "days": 8, "hourly_metric": "temperature",
    "details": list(WEATHER_DETAILS), "load_animation": True,
}
# THE NATIVE RADAR (hk-radar.js): off on a new house; a house that showed the
# Weather Radar Card is moved over once (radar_lifted, entry 1.16).
RADAR_PROVIDERS = ("auto", "noaa", "rainviewer")
RADAR_BASEMAPS = ("osm",)
RADAR_CENTERS = ("home", "zone")
RADAR_ZOOM = (4, 10)
RADAR_HISTORY = (30, 60, 120)
RADAR_SPEEDS = ("slow", "normal", "fast")
RADAR_OPACITY = (20, 100)
RADAR_DEFAULTS: dict[str, Any] = {
    "version": 1, "enabled": False, "provider": "auto", "basemap": "osm", "center": "home", "zone": None,
    "zoom": 5, "marker": True, "history_minutes": 60, "playback_speed": "normal", "autoplay": True,
    "interactive": True, "playback_controls": True, "opacity": 75,
}
ZONE_ID = re.compile(r"^zone\.[a-z0-9_]+$")


def _whole(v: Any, lo: int, hi: int) -> int | None:
    """A whole number lo..hi (an integral float too), never a boolean."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    if int(v) != v or not lo <= v <= hi:
        return None
    return int(v)


def _one_of(v: Any, options: tuple[Any, ...]) -> Any:
    if isinstance(v, bool) or v not in options:
        return None
    return v


def _flag(v: Any) -> bool | None:
    return v if isinstance(v, bool) else None


WEATHER_PAGE_CHECKS: dict[str, Any] = {
    "show_current": _flag, "show_hourly": _flag, "show_daily": _flag, "show_alerts": _flag,
    "load_animation": _flag,
    "hours": lambda v: _one_of(v, WEATHER_HOURS), "days": lambda v: _one_of(v, WEATHER_DAYS),
    "hourly_metric": lambda v: _one_of(v, WEATHER_METRICS),
    "details": lambda v: list(v) if isinstance(v, list) and len(set(v)) == len(v)
    and all(isinstance(x, str) and x in WEATHER_DETAILS for x in v) else None,
}
RADAR_CHECKS: dict[str, Any] = {
    "version": lambda v: 1 if v == 1 and not isinstance(v, bool) else None,
    "enabled": _flag, "marker": _flag, "autoplay": _flag, "interactive": _flag, "playback_controls": _flag,
    "provider": lambda v: _one_of(v, RADAR_PROVIDERS), "basemap": lambda v: _one_of(v, RADAR_BASEMAPS),
    "center": lambda v: _one_of(v, RADAR_CENTERS),
    "zoom": lambda v: _whole(v, *RADAR_ZOOM), "opacity": lambda v: _whole(v, *RADAR_OPACITY),
    "history_minutes": lambda v: _one_of(v, RADAR_HISTORY),
    "playback_speed": lambda v: _one_of(v, RADAR_SPEEDS),
}


def _typed(v: Any, defaults: Mapping[str, Any], checks: Mapping[str, Any], strict: bool) -> dict[str, Any] | None:
    """`v` over `defaults`, each key through its check. strict (a save): any
    unknown key or bad value refuses the whole object (None). Not strict
    (what is stored, read back): a bad key keeps its default."""
    out = copy.deepcopy(dict(defaults))
    if v is None:
        return out
    if not isinstance(v, Mapping):
        return None if strict else out
    for k, x in v.items():
        if k not in checks:
            if strict:
                return None
            continue
        if k == "zone":
            got: Any = x if x is None or (isinstance(x, str) and ZONE_ID.match(x)) else False
            if got is False:
                if strict:
                    return None
                continue
            out[k] = got
            continue
        got = checks[k](x)
        if got is None:
            if strict:
                return None
            continue
        out[k] = got
    return out


def weather_page(v: Any, strict: bool = True) -> dict[str, Any] | None:
    """The Weather page's composition (weather.page) over its defaults."""
    return _typed(v, WEATHER_PAGE_DEFAULTS, WEATHER_PAGE_CHECKS, strict)


def radar_native(v: Any, strict: bool = True) -> dict[str, Any] | None:
    """The native radar's settings (weather.radar_native) over its defaults."""
    return _typed(v, RADAR_DEFAULTS, {**RADAR_CHECKS, "zone": None}, strict)


# The Weather Radar Card's options the native radar takes over (radar_lifted);
# anything else in weather.radar has no native meaning and is kept, unused.
RADAR_LEGACY_MAPPED = ("data_source", "zoom_level", "static_map", "show_playback", "markers")


def radar_from_legacy(legacy: Mapping[str, Any] | None, enabled: bool) -> dict[str, Any]:
    """The native radar for a house that showed the Weather Radar Card: its
    stored options (weather.radar) where they have a native meaning, the
    native defaults for the rest."""
    out = copy.deepcopy(RADAR_DEFAULTS)
    out["enabled"] = bool(enabled)
    lg = legacy if isinstance(legacy, Mapping) else {}
    src = str(lg.get("data_source") or "").lower()
    if src in ("noaa", "rainviewer"):
        out["provider"] = src
    z = lg.get("zoom_level")
    if isinstance(z, (int, float)) and not isinstance(z, bool) and z == z:
        out["zoom"] = int(min(RADAR_ZOOM[1], max(RADAR_ZOOM[0], round(z))))
    if isinstance(lg.get("static_map"), bool):
        out["interactive"] = not lg["static_map"]
    if isinstance(lg.get("show_playback"), bool):
        out["playback_controls"] = lg["show_playback"]
    return out


def radar_lifted(options: Mapping[str, Any] | None, installed: bool) -> dict[str, Any] | None:
    """Entry 1.16: the Weather page's radar becomes HK's own. A house with no
    radar_native yet that showed the Weather Radar Card (installed: the card's
    file is there, which is what drew it) gets the native radar on, with its
    old options where they map (radar_from_legacy); weather.radar itself is
    kept untouched. None when nothing changes -- already moved, or no card
    (a new house's radar stays off, its default)."""
    opts = dict(options or {})
    dash = opts.get(CONF_DASHBOARD) if isinstance(opts.get(CONF_DASHBOARD), Mapping) else {}
    w = dash.get("weather") if isinstance(dash.get("weather"), Mapping) else {}
    if "radar_native" in w or not installed:
        return None
    native = radar_from_legacy(w.get("radar"), True)
    return {**opts, CONF_DASHBOARD: {**dash, "weather": {**w, "radar_native": native}}}


DEFAULTS: dict[str, dict[str, Any]] = {
    # the pages' status rows: what each shows, in its order, and the rooms it
    # leaves out (an outdoor area's temperature, a shed's leak sensor)
    "status_rows": {p: {"status": list(d), "exclude_areas": []} for p, (_k, d) in STATUS_ROWS.items()},
    # THE PAGE HEADERS (2026-10-15, hk-headers.js): the cards between a
    # category page's status row and its accessories. Each works itself out
    # from the house; these are only where a guess can be wrong. None:
    # Automatic (the card's own guess).
    "headers": copy.deepcopy(HEADERS),
    # The header's right-hand line: "Disarmed · 2 Doors Open" / "Home Secured".
    "security": {"alarm": None, "garage": [], "locks": [], "doors": [], "windows": []},
    # The header clock. Home Assistant's Time & Date integration; the page
    # falls back to the browser's own clock when these do not exist.
    "clock": {"time": "sensor.time", "date": "sensor.date"},
    # The weather band and strip. Unset sensors fall back to the weather
    # entity's own attributes; unset forecasts to weather/subscribe_forecast.
    "weather": {"entity": None, "feels_like": None, "humidity": None, "wind": None, "gust": None,
                "uv": None, "forecast_daily": None, "forecast_hourly": None,
                "alerts": None, "place": None, "outside": None,
                # the Weather Radar Card's own options (YAML), kept as they
                # were: the generated Weather page draws HK's own radar since
                # 1.16 (radar_native), which took over what maps
                "radar": {},
                # the Weather page's composition and its radar (above)
                "page": copy.deepcopy(WEATHER_PAGE_DEFAULTS),
                "radar_native": copy.deepcopy(RADAR_DEFAULTS)},
    # The live sky. moon: a 0..1 phase-fraction sensor (else computed);
    # holidays: a sensor whose state is Halloween / Thanksgiving / Christmas
    # during each season (else computed); seasonal: an on/off gate.
    # decorations: the integration's own on/off (switch.<...>_seasonal_decorations,
    # switch.py); seasonal: optionally, an entity of the house's that must also be on.
    "sky": {"moon": None, "holidays": None, "seasonal": None, "birthdays": [],
            "decorations": True, "decoration_style": "old",
            # Moving Things (2026-10-11): the rain and snow, falling leaves,
            # bats and birds, flybys and confetti drawn "behind" the cards
            # (the sky) or "front" over them -- touch passes through either
            # way (hk-sky.js FRONT). Fireworks, fog, clouds and the
            # scenery stay behind.
            "moving": "behind",
            # the clouds' look: "classic" (the drifting noise decks) or
            # "realistic" (photographic cloud cut-outs, tools/sky/cloud_art.py)
            "cloud_style": "classic",
            # the daytime sky's brightness (DAYTIME_SKIES)
            "daytime": "natural",
            # New Decorations' woodland on days with no holiday or birthday,
            # season by season -- its own choice, not the holidays' Show
            "woodland": list(WOODLAND_SEASONS),
            # The sky's own look (Sky / Background): animations -- the moving
            # parts (drifting clouds, falling rain and snow, the seasons);
            # weather -- the clouds, rain, snow and fog (the sun, moon and
            # stars stay when it is off); precipitation -- the falling rain
            # and snow alone (Rain & Snow, 2026-10-10: off, the clouds and
            # fog still move; never drawn while animations are off, where it
            # could only hang still); focus_pause -- Pause When Not in Focus
            # (2026-10-10: on a computer, the sky's and the cards' animations
            # hold while another window has the focus); gradient -- "live" or
            # a backdrop id (SKY_BACKDROPS); gradient_custom -- its own
            # stops, for "custom". Each screen may set its own (the board's
            # sky_animations ... sky_custom keys, None = follow these).
            "animations": True, "weather": True, "precipitation": True, "focus_pause": True,
            "gradient": "live", "gradient_custom": None,
            # THE BACKGROUND (SKY_BACKGROUNDS): "live", "color" (a still
            # SKY_COLOR_IDS color: color; "custom" is gradient_custom's
            # stops) or "photo" (photo, an address SKY_PHOTO takes). It is
            # what Home, the room pages and every page without a color of its
            # own show; gradient above is the Live Sky's own colors.
            "background": "live", "color": "midnight", "photo": None,
            # the photo's look (PHOTO_LOOK_DEFAULTS: blur, dim, saturation,
            # a tint); a screen's sky_photo_look is its own
            "photo_look": dict(PHOTO_LOOK_DEFAULTS),
            # LANDSCAPES (2026-10-14): which one and when it changes ("wake",
            # "every:<minutes>" or a file name: sky_landscape) and its own
            # look, as a photo's; a screen's sky_landscape /
            # sky_landscape_look are its own
            "landscape": "every:1440", "landscape_look": dict(PHOTO_LOOK_DEFAULTS),
            # EACH PAGE'S BACKGROUND (sky_pages below): page kind or custom
            # page address -> "own" (its own color), "live" (the live sky,
            # with this look), a backdrop id (a still color) or "photo"
            # (page_photos' for it, else the screen's photo). Missing:
            # Automatic -- a page with a color of its own keeps it, the rest
            # show the background.
            "pages": {}, "page_photos": {},
            # FLAT'S OWN (FLAT_BACKGROUNDS above): its background, color, how
            # far the theme's ground fades a photo (0-100) and its pages
            "flat_background": "color", "flat_color": "auto", "flat_fade": FLAT_FADE, "flat_pages": {},
            # the Fade's color over a photo (2026-10-17, flat_tint()): "none"
            # the theme's own ground, "accent" the page's accent, "#rrggbb"
            "flat_tint": "none",
            # ...how strong it is (0-100 %: the photo turned to the color,
            # its own light and dark kept) and how bright (50 as the photo is)
            "flat_tint_amount": FLAT_TINT_AMOUNT, "flat_tint_light": 50,
            "flat_image_look": {}, "flat_page_image_looks": {},
            # THE GLASS LOOKS' IMAGE LOOK (2026-10-24, the owner): Flat's
            # treatment (flat_image_look's fields) for the other looks' Photo
            # and Landscapes, kept apart from Flat's; {} is Off ("legacy"),
            # the photo with its Photo Look alone
            "image_look": {},
            # a page's own photo look (page_looks: {page: photo_look}); a
            # page missing has its screen's. A room page's key is its
            # address (room-kitchen), and one not set follows "rooms".
            "page_looks": {},
            # LIVELINESS: one preset for every occasion (LIVELY_PRESETS), or
            # "custom" -- then each occasion's preset (missing = classic) and
            # a Custom one's knobs ({occasion: {knob: 0-4}})
            "liveliness_all": "classic", "liveliness": {}, "liveliness_custom": {},
            # Which themes may run (all by default) and the hemisphere, which
            # flips the spring and winter surprise windows. (christmas_from is
            # one of SKY_DATES below: None = the built-in 12-07.)
            "themes": list(THEMES), "hemisphere": "north",
            # WHEN each theme may run and HOW OFTEN (docs/Seasonal-Decorations.md). None
            # is the built-in value, which the screens know (hk-settings.js
            # skyWindow): the dates below, the hemisphere's spring and winter,
            # and US Thanksgiving.
            **{k: None for k in SKY_DATES}, **{k: None for k in SKY_OFTEN}},
    # Return to the dashboard's first view when a page is left untouched.
    # dashboards: where it applies; rooms: dashboard -> room slug, which names
    # that tablet's own entities (binary_sensor.<room>_tablet_in_use,
    # input_select.<room>_tablet_idle_return, input_number.<room>_tablet_room_idle).
    "idle": {"dashboards": [], "rooms": {}, "default": None},
    # ALL TABLETS (Wall Tablets, entry 1.14): what a tablet does unless its
    # own page says otherwise -- back to Home when left alone, after
    # idle_time s (0: never) -- the alerts sent through Notifications, the
    # scheduled restart (Kiosk Satellite: clear the cache, then restart the
    # device, at each of restart_times), and the suggestions dismissed
    # (tablets.py). The tablets themselves are items (SUBENTRY_TABLET).
    "tablets": {"idle_return": True, "idle_time": 50,
                "alert_offline": True, "alert_restart": True, "alert_charging": True,
                "restart": False, "restart_times": ["00:02", "15:00"], "dismissed": []},
    # Dashboards opened in a car browser: the viewport is pinned (tesla-viewport.js).
    "car": {"dashboards": [], "widths": {}},
    # The generated dashboards (custom:hk-dashboard): what to leave out (also
    # out of Status & Chips, everywhere) and what to add. A dashboard's own YAML
    # options add to these. (Which parts a screen shows -- chips, pages, sky,
    # rooms -- is each screen's own, and a dashboard's YAML can say
    # `chips: false` and the like.)
    "generated": {"exclude_areas": [], "exclude_devices": [], "exclude_entities": [],
                  "include_entities": []},
    # STATUS & CHIPS (kinds.py): each kind's Leave out / Also count, by kind;
    # None = nothing saved, so the kind is automatic (or its older list,
    # kinds.LEGACY).
    "counts": kinds.blank(),
    # Entities single cards fall back to when their config does not name one.
    "features": {"vacuum_script": None, "alarm_bad_code": None,
                 # thermostats: the older list Status & Chips replaced
                 # (kinds.LEGACY) -- read only while "thermostats" is unsaved.
                 # temperature: the indoor temperature the Climate chip shows
                 # (else the first thermostat's); power: the house's power
                 # draw, for the Energy chip. Both on the Status & Chips page.
                 "thermostats": [], "temperature": None, "power": None,
                 # The Timers page's "House timers": the timers people start
                 # themselves (a nap, bedtime), in order, one tap each.
                 "house_timers": []},
    # The menu of pages and rooms. OFF on every dashboard until one is
    # listed here, so a house that never sets it up sees no change.
    # docked: the dashboards whose menu is always shown beside the page (with
    # room for it), with no button; everywhere else it stays hidden until
    # opened. tab_position: "" (level with the date line), "140px" or "20%".
    # categories: the view paths listed under Categories; empty = the pages
    # the Home view's chips open. ha_sidebar: the dashboards whose menu has a
    # "Home Assistant" row that opens Home Assistant's own sidebar -- over the
    # page, even where kiosk mode hides it. Per dashboard: a wall tablet
    # everyone uses may not want it.
    # dock_min: the narrowest the dashboard may be and keep a docked menu open;
    # narrower, it folds into the dashboard's button (an iPad mini upright, a
    # phone). time_weather: the dashboards whose DOCKED menu carries the time,
    # date and weather at its top, the Home header giving its space back.
    "menu": {"glyph": "sidebar", "clock": True,
             # ALL SCREENS' MENU (entry 1.9, 2026-10-02): every screen's menu
             # settings but whether it has one (its `menu`: off, a button,
             # always open), for each screen that doesn't set its own
             # (menu_custom). MENU_KEYS maps them onto a screen's keys. (The
             # house-wide lists before 1.9 -- dashboards, docked, ... -- went
             # in entry 1.12, settings_tidied.)
             "style": "auto", "tab_at": "", "tab_size": "large",
             "tab_size_phone": "standard", "open_min": 1000, "time_weather_at": "page",
             "ha_row": False, "accent": "orange", "swipe": False, "ha_at": "rooms",
             # the tab bar (2026-10-05): while scrolling, its Rooms button,
             # its glass
             "bar_scroll": "shrink", "bar_rooms": "more", "bar_glass": "house", "bar_more": "icons",
             "bar_more_phone": "list", "bar_pos": "bottom", "bar_fold": "start", "bar_start": "full",
             # Adjust Content: the page makes room for the bar (on), or the
             # bar floats over it everywhere (off)
             "bar_adjust": True, "page_header": "current",
             # PHONES' OWN (2026-10-08; each its own value since entry 1.12):
             # While Scrolling, a menu button's style (BOARD_BUTTON_PHONE) and
             # More's rooms -- on a phone and wherever a tablet's own menu
             # doesn't fit (hk-base.js phoneForm)
             "bar_scroll_phone": "shrink", "button_phone": "chip", "bar_rooms_phone": "more",
             # Tabs in Bar / Tabs in Rail (TAB_BAR_TABS)
             "bar_tabs": 6, "bar_tabs_rail": 6, "bar_size": "medium",
             # Labels: the tabs' names, or icons only (TAB_BAR_LABELS)
             "bar_labels": "show"},
    # The room pages: whether room headings on Home open them, and what the
    # status row shows.
    # ROOMS, for every screen that doesn't set its own (a screen's
    # rooms_custom): the order of the rooms and which are on Home (`order`,
    # `home` -- empty: floor by floor, then A to Z), the menu's rooms A to Z or
    # in that order (`menu`), and the pages that group by room by floor or in
    # it (`pages`). Before 2026-10-01 each screen held its own copy.
    "rooms": {"headings": True, "status": list(STATUS_KINDS), "order": [], "home": "as_is", "menu": "az",
              "pages": "floor"},
    # THE CAMERAS, for every screen that doesn't set its own (a screen's
    # cameras_custom): which cameras its Home strip and Cameras page show and
    # in what order -- and a room page's cameras, in that order (`order`;
    # empty: Automatic, one of every camera). Before 2026-10-09 each screen
    # held its own copy. live: the Home strip's first tile plays live video
    # (off: a snapshot like the others, lighter on the device -- 2026-10-10);
    # a screen's camera_live_video, when set, is its own. focus_pause: on a
    # computer, live cameras rest while another window has the focus (off:
    # they keep playing -- a window of cameras beside your work; 2026-10-21).
    # Behind the screensaver they always rest, whatever this says.
    "cameras": {"order": [], "live": True, "focus_pause": True},
    # How the glass surfaces look (hk-settings.js applies it; hk-glass.js draws
    # the shared blur): clear -- the original plate, the status chips blur
    # themselves; frosted -- a frosted material, no blur at all; blur -- ONE
    # blur layer per scroller behind every glass surface; blur_pre -- the
    # same layers holding a picture of the sky blurred once (hk-glass.js
    # PRE-RENDERED, 2026-10-10: no live blur); blur_each -- every
    # surface blurs itself (phones, iPads, computers: too heavy for a wall
    # tablet); tinted -- the Home app's flat dark plate with no blur
    # anywhere on the page (2026-10-12). frost: how milky Frosted is; blur:
    # how strong both blurs are; tint: how dark Tinted is (50 is 75 %)
    # -- each 0-100 %, 50 (the middle) as designed: 20 px of blur. well:
    # Tinted's icon circles, dark (Apple's) or light.
    # frost_tint: Frosted takes the color behind each card (the page's sky
    # at its height, the scenery's ground below) in place of one gray
    # (hk-frosttint.js), held at one darkness so white text reads the same.
    # docs/ (each setting on its topic's page).
    "look": {"flat": False, "flat_theme": "dark", "glass": "clear", "frost": 50, "blur": 50, "tint": 50, "well": "dark", "frost_tint": False,
             # The detail sheets (hk-detail.js), after the Home app's, in
             # place of HA's more-info dialog on the dashboards, and the view
             # a speaker's sheet opens with "Browse Music" (a view path on the
             # same dashboard; empty = no Browse button).
             "details": True, "browse_view": "music-browse",
             # A generated dashboard's live sky follows this switch (off: no
             # sky anywhere), and its photo screensaver shows this folder.
             "sky_switch": None, "photos": "media-source://media_source/local/photos",
             # A PAGE PILL'S LOOK: the scenes row's pills that open a page,
             # kind -> {name, icon, color}; empty is each pill's own
             # ("Play Music" can read "Apple Music")
             "page_pills": {},
             # EACH PAGE'S HIGHLIGHT (2026-10-17): page kind -> an accent
             # (ACCENTS or "#rrggbb"), the current page's color when a
             # screen's Highlight Color is Automatic; missing: hk-base.js
             # PAGE_ACCENTS' default for it
             "page_accents": {},
             # FLAT COLORS (2026-10-17, flat_colors() above): All Screens'
             # two fields, and each page's own
             "flat_colors": dict(FLAT_COLORS_DEFAULT), "flat_page_colors": {}},
    # THE CALENDAR (the Calendar page, hk-calendar.js, and the screensaver's
    # calendar pane): the calendar entities shown, in order (empty: every
    # calendar the house has), and each one's colour -- entity -> a page pill
    # colour (changes.PILL_COLORS); one left out takes the next of the
    # palette by its place in the list.
    # keywords: [{word, color}] -- an event whose title has the word takes
    # its color (the first that matches); event_colors: an event's own color
    # picked on its sheet (hk_frontend/calendar/color, open to every user:
    # a family member colors an event as they would edit it), by its series
    # ("uid:<uid>") or, with no uid, its title ("title:<lowercase title>").
    "calendar": {"entities": [], "colors": {}, "keywords": [], "event_colors": {}},
    # Browse Music: the categories its first page leaves out, and its
    # Discover rows in the order shown. Every
    # hk-library-card without its own `hide:` / `discover:` reads these.
    # NOW PLAYING's place on every screen that doesn't choose its own (the
    # board's np_* keys, None = these): style (NP_STYLES) and its side for
    # tablets & computers, the bar's place where the bar shows (and where the
    # pane doesn't fit), the bar's place on phones
    "now_playing": {"style": "bar", "side": "right", "bar": "bottom", "bar_phone": "bottom", "grace": 30},
    "browse": {"hide": [], "discover": ["recently_played", "favourite_playlists", "most_played",
                                        "recently_added", "favourite_radio"]},
}
GLASS = ("clear", "frosted", "tinted", "blur", "blur_pre", "blur_each")
# Tinted's icon circles (look.well, a screen's well): Apple's dark, or light
WELLS = ("dark", "light")
# Looks that were tried and taken out, read as the one that replaced them:
# Baked (blur_baked, each surface its own slice of the picture) cost more
# than it saved and went on 2026-10-10 -- Pre-rendered is the same picture.
RETIRED_GLASS = {"blur_baked": "blur_pre"}
BLACK_SCREENS = ("kiosk", "hk")    # a screen's Black Screen (BOARD_DEFAULTS)
AMOUNT = (0, 100)                  # look.frost, look.blur and look.tint, in %; 50 is the default

# Music Assistant's own categories on Browse Music's first page, by the id
# browse_media gives each (media_content_id), in MA's order.
BROWSE_CATEGORIES = ("artists", "albums", "tracks", "playlists", "radio", "podcasts", "audiobooks")

# THE DISCOVER ROWS a house can pick from. Each is one
# `music_assistant.get_library` call -- a media type and an order, or the
# favorites -- because that is what the page can ask without Music
# Assistant's own token; MA's streaming-curated rows ("Stations for You") are
# not reachable that way. Titles are what the row's heading says.
SHELVES: dict[str, dict[str, Any]] = {
    "recently_played": {"title": "Recently played", "media_type": "track",
                        "order_by": "last_played_desc"},
    "recent_albums": {"title": "Recently played albums", "media_type": "album",
                      "order_by": "last_played_desc"},
    "recent_playlists": {"title": "Recently played playlists", "media_type": "playlist",
                         "order_by": "last_played_desc"},
    "recent_artists": {"title": "Recently played artists", "media_type": "artist",
                       "order_by": "last_played_desc"},
    "recent_podcasts": {"title": "Recently played podcasts", "media_type": "podcast",
                        "order_by": "last_played_desc"},
    "favourite_playlists": {"title": "Favorite playlists", "media_type": "playlist", "favorite": True},
    "favourite_songs": {"title": "Favorite songs", "media_type": "track", "favorite": True},
    "favourite_albums": {"title": "Favorite albums", "media_type": "album", "favorite": True},
    "favourite_artists": {"title": "Favorite artists", "media_type": "artist", "favorite": True},
    "favourite_radio": {"title": "Favorite radio", "media_type": "radio", "favorite": True},
    "favourite_podcasts": {"title": "Favorite podcasts", "media_type": "podcast", "favorite": True},
    "most_played": {"title": "Most played", "media_type": "album", "order_by": "play_count_desc"},
    "most_played_songs": {"title": "Most played songs", "media_type": "track",
                          "order_by": "play_count_desc"},
    "most_played_playlists": {"title": "Most played playlists", "media_type": "playlist",
                              "order_by": "play_count_desc"},
    "most_played_artists": {"title": "Most played artists", "media_type": "artist",
                            "order_by": "play_count_desc"},
    "recently_added": {"title": "Recently added", "media_type": "album",
                       "order_by": "timestamp_added_desc"},
    "recently_added_playlists": {"title": "Recently added playlists", "media_type": "playlist",
                                 "order_by": "timestamp_added_desc"},
    "recently_added_songs": {"title": "Recently added songs", "media_type": "track",
                             "order_by": "timestamp_added_desc"},
    "newest_albums": {"title": "Newest albums", "media_type": "album", "order_by": "year_desc"},
    "random_albums": {"title": "Albums at random", "media_type": "album", "order_by": "random"},
}


def discover_rows(keys: list[str] | None) -> list[dict[str, Any]]:
    """The picked Discover rows as the queries a screen runs, in order."""
    return [{"key": k, **SHELVES[k]} for k in (keys or []) if k in SHELVES]



def merged(options: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    """The stored settings over the defaults, section by section."""
    out = copy.deepcopy(DEFAULTS)
    out["sky"].update(place_sky_defaults())
    stored = (options or {}).get(CONF_DASHBOARD) or {}
    for section, values in stored.items():
        if section in out and isinstance(values, dict):
            out[section].update({k: v for k, v in values.items() if k in out[section]})
    out["look"]["saver"] = saver_options(out["look"].get("saver")) or dict(SAVER_DEFAULTS)
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
    if out["look"].get("well") not in WELLS:
        out["look"]["well"] = DEFAULTS["look"]["well"]
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
    # each over its own defaults: a partly stored object is still whole, and
    # a stored false stays false
    wx = out["weather"]
    wx["page"] = weather_page(wx.get("page"), strict=False)
    wx["radar_native"] = radar_native(wx.get("radar_native"), strict=False)
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


# ------------------------------------------------------------ the screensaver
# THE PHOTO SCREENSAVER'S OPTIONS (a generated wall tablet's Screensaver
# Options page; hk-saver.js draws it). HK Frontend's own screensaver since
# 1.3.0 -- WallPanel (HACS) is only a fallback a screen can choose
# (screensaver_engine), with its own wallpanel_options.
SAVER_DEFAULTS: dict[str, Any] = {
    "starts_after": 180,     # s untouched (the switch can start it sooner)
    "each_photo": 30,        # s
    "order": "random",       # random: every photo once before any repeats
    "fill": True,            # a landscape photo fills the screen (else whole)
    "zoom": False,           # Slow Zoom -- a frame per refresh; off by default
    "clock": True, "weather": True, "music": True, "timers": True,
    "status": True,          # Home Status, top right (hk-screensaver-status-card)
    # photos: the photos, and the forecast whenever there are none to show;
    # both: the photos with the forecast as a slide every `forecast_every`
    # photos; forecast: always the forecast (the live sky over the land)
    "show": "photos",
    "forecast_every": 5,
    # THE FORECAST DETAILS (today, the hours, the days, along the bottom): on
    # the forecast (Forecast, the Photos & Forecast slide, the no-photos
    # fallback), and over the photos
    "band": True, "band_photos": False,
    # with Show: photos and no photos to show -- the forecast (True) or a dark
    # screen, as before 1.3 (False)
    "fallback": True,
    # THE CALENDAR PANE (1.4): the coming events down the right of the
    # screen, the photos (or the forecast) beside it; and how many days it
    # lists -- today, tomorrow, and so on
    "calendar": False, "calendar_days": 2,
    # THE MUSIC: what plays, big -- a slide among the photos every
    # `forecast_every` photos (taking turns with the forecast), or over the
    # forecast while music plays; and in the pane down the right (under the
    # calendar when both are on)
    "music_slide": False, "music_pane": False,
    # MUSIC FIRST: while music plays it fills the screen (over the photos or
    # the forecast) until 20 s after it stops
    "music_first": False,
    # BACK TO THE DASHBOARD: how long the screensaver takes to fade away, ms
    # (0: at once), after the dashboard has been drawn underneath it
    "fade_back": 500,
    # PORTRAIT AND LANDSCAPE PHOTOS, each their own (2026-10-13): shown whole
    # or filling the screen (a landscape one's is `fill` above); the blurred
    # copy behind a whole one -- its blur and dim, 0-100 / 0-80 % (50 / 20
    # are how it always looked); a zoom, 100-200 %; and the focus: which part
    # stays when it is cropped, or where a whole one sits -- left / center /
    # right and top / center / bottom
    "portrait_fill": False, "portrait_blur": 50, "portrait_dim": 20, "portrait_zoom": 100,
    "portrait_x": "center", "portrait_y": "center",
    "landscape_blur": 50, "landscape_dim": 20, "landscape_zoom": 100,
    "landscape_x": "center", "landscape_y": "center",
    # THE CLOCKS (2026-10-13; hk-saverclock.js): show "clock" is a full-screen
    # clock; over the photos or the forecast the clock is the corner one (as
    # always) or a "large" one -- `clock` above still turns it off. One style
    # for both (SAVER_CLOCK_STYLES); behind Show: Clock, a background
    # (SAVER_CLOCK_BGS) that moves slowly or changes once a minute (still)
    "clock_over": "corner", "clock_style": "classic", "clock_bg": "gradient", "clock_motion": "slow",
    "clock_24": False,
    # each face's color (hk-saverclock.js COLORS): {style: color id}; a face
    # missing is its own first color
    "clock_colors": {},
    # how fast the background behind the clock moves (0: still; 35 as
    # designed) and how strong its effect is (clock_motion "still" was
    # Speed 0 before 2026-10-13, and is still read)
    "clock_speed": 35, "clock_depth": 50,
    # NIGHT MODE (2026-10-13): a dim red clock on black -- off, "night"
    # (from .. to, across midnight) or "always" -- as StandBy has it
    "clock_night": "off", "clock_night_from": "22:00", "clock_night_to": "07:00",
    # THE MOSAIC (2026-10-13): Layout "mosaic" shows mosaic_count photos at
    # once (2-5) in a layout chosen at random -- portraits in the tall cells,
    # each cropped as its shape's Focus and Zoom say; Spacing none / thin /
    # rounded; Changes one cell at a time, or the whole mosaic
    "photo_layout": "single", "mosaic_count": 3, "mosaic_gap": "thin", "mosaic_change": "one",
    # ...its lines (2026-10-13): their thickness in px (0: Spacing's own --
    # Thin 3, Rounded 12) and color (MOSAIC_COLORS); Up To: a new number of
    # photos (1 to mosaic_count) every mosaic_every minutes
    "mosaic_line": 0, "mosaic_color": "black", "mosaic_random": False, "mosaic_every": 10,
    # PHOTOS BEHIND THE CLOCK (2026-10-13, the user: as the Photo
    # Screensaver has them, not blurred): the photos themselves, laid out by
    # the Photos settings above (one at a time or a mosaic, portraits and
    # landscapes), darkened by clock_photo_dim %; clock_photo_soft: the
    # blurred, dimmed copies as before. And the clock's text over them: its
    # shadow and outline, 0-100
    "clock_photo_soft": False, "clock_photo_dim": 35, "clock_text_shadow": 40, "clock_text_outline": 0,
    # HOME ENERGY (2026-10-14; hk-saver-energy.js): today so far against a
    # usual day, the Energy page's own sums -- a slide among the photos (taking
    # turns with the forecast and the music, every `forecast_every` photos),
    # or one of the ADDITIONAL SCREENS over the forecast or the clock
    "energy_slide": False,
    # ...the other additional screens: the music (only while something
    # plays; Music First covers it) and, on Show: Clock, the forecast. One
    # every `extra_every` minutes, for `extra_for` seconds, taking turns
    "extra_music": False, "extra_forecast": False, "extra_every": 5, "extra_for": 30,
    # what Home Energy leaves out (SAVER_ENERGY_PARTS): its rings, the
    # readings along the bottom, the month and where its cost is heading
    "energy_hide": [],
    # WEATHER (2026-10-14; hk-saver-weather.js): today's weather at a glance
    # over the Live Sky (Sky Only), laid out as Home Energy -- a slide among
    # the photos, or an additional screen over the clock (over the forecast
    # it is the weather already); and what it leaves out (SAVER_WEATHER_PARTS)
    "weather_slide": False, "weather_hide": [],
}
MOSAIC_COLORS = ("black", "white", "gray", "charcoal", "cream", "navy")
SAVER_CLOCK_STYLES = ("today", "classic", "serif", "neon", "lcd", "flip", "analog", "words", "arc", "nixie", "poster",
                      "dots", "ring", "glass", "type")
SAVER_CLOCK_BGS = ("black", "grain", "gradient", "aurora", "ink", "sky", "lowpoly", "topo", "constellation", "forecast", "skyonly", "photos",
                   "landscapes")
SAVER_CHOICES = {"clock_over": ("corner", "large"), "clock_style": SAVER_CLOCK_STYLES,
                 "clock_bg": SAVER_CLOCK_BGS, "clock_motion": ("slow", "still"),
                 "photo_layout": ("single", "mosaic"), "mosaic_gap": ("none", "thin", "rounded"),
                 "mosaic_change": ("one", "all"), "clock_night": ("off", "night", "always"),
                 "mosaic_color": MOSAIC_COLORS}
SAVER_MOSAIC = (2, 5)
SAVER_WEATHER_PARTS = ("rain", "wind", "hours", "days")
SAVER_ENERGY_PARTS = ("cost", "water", "solar", "gas", "power", "battery", "yday", "month", "pace")
SAVER_RANGES = {"blur": (0, 100), "dim": (0, 80), "zoom": (100, 200)}
SAVER_FOCUS = {"x": ("left", "center", "right"), "y": ("top", "center", "bottom")}
SAVER_ORDERS = ("random", "sorted")
SAVER_SHOWS = ("photos", "both", "forecast", "clock")
# ALL SCREENS' screensaver options (All Screens -> Screensaver): a screen
# whose own `screensaver_options` is null uses these (resolved()).
DEFAULTS["look"]["saver"] = dict(SAVER_DEFAULTS)
SAVER_FC_EVERY = (2, 100)
SAVER_CAL_DAYS = (1, 7)
SAVER_FADE_BACK = (0, 5000)
SAVER_ENGINES = ("hk", "wallpanel")
# WHO HIDES HOME ASSISTANT'S HEADER AND SIDEBAR on a screen with Hide Home
# Assistant Header & Sidebar: HK Frontend itself (hk-kiosk.js, 1.3), or the
# Kiosk Mode plugin (HACS) with the screen's kiosk_options.
KIOSK_ENGINES = ("hk", "kiosk_mode")
SAVER_STARTS = (15, 3600)
SAVER_EACH = (5, 600)


SAVER_INTS = {"starts_after": SAVER_STARTS, "each_photo": SAVER_EACH, "forecast_every": SAVER_FC_EVERY,
              "calendar_days": SAVER_CAL_DAYS, "fade_back": SAVER_FADE_BACK, "mosaic_count": SAVER_MOSAIC,
              "clock_speed": (0, 100), "clock_depth": (0, 100), "mosaic_line": (0, 24), "mosaic_every": (1, 120),
              "clock_photo_dim": (0, 80), "clock_text_shadow": (0, 100), "clock_text_outline": (0, 100),
              "extra_every": (1, 60), "extra_for": (10, 300)}


def saver_options(v: Any, legacy: Any = None) -> dict[str, Any] | None:
    """The screensaver's options over the defaults, or None when `v` is not a
    mapping or holds a value that cannot be used (the form says so). With no
    options of its own yet, a screen's old WallPanel choices carry over:
    idle_time, display_time, media_order, image_fit_landscape and
    image_animation_ken_burns are the ones its page ever set."""
    out = dict(SAVER_DEFAULTS)
    if v in (None, "", {}):
        w = legacy if isinstance(legacy, dict) else {}
        v = {}
        for src, dst in (("idle_time", "starts_after"), ("display_time", "each_photo")):
            if isinstance(w.get(src), (int, float)) and not isinstance(w.get(src), bool):
                v[dst] = w[src]
        if w.get("media_order") in SAVER_ORDERS:
            v["order"] = w["media_order"]
        if w.get("image_fit_landscape") in ("cover", "contain"):
            v["fill"] = w["image_fit_landscape"] == "cover"
        if isinstance(w.get("image_animation_ken_burns"), bool):
            v["zoom"] = w["image_animation_ken_burns"]
        # an out-of-range old value is clamped rather than refused: it was
        # accepted once, and the screen must keep working
        for k, (lo, hi) in (("starts_after", SAVER_STARTS), ("each_photo", SAVER_EACH)):
            if k in v:
                v[k] = int(min(max(v[k], lo), hi))
    if not isinstance(v, dict):
        return None
    for k, val in v.items():
        if k not in SAVER_DEFAULTS:
            return None
        if k in SAVER_INTS:
            lo, hi = SAVER_INTS[k]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not lo <= val <= hi:
                return None
            out[k] = int(val)
        elif k in ("order", "show"):
            if val not in (SAVER_ORDERS if k == "order" else SAVER_SHOWS):
                return None
            out[k] = val
        elif k in ("clock_night_from", "clock_night_to"):
            m = re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", val) if isinstance(val, str) else None
            if not m:
                return None
            out[k] = val
        elif k == "clock_colors":
            if not isinstance(val, dict) or any(s not in SAVER_CLOCK_STYLES or not isinstance(c, str) or not re.match(r"^[a-z]{1,16}$", c)
                                                for s, c in val.items()):
                return None
            out[k] = dict(val)
        elif k in ("energy_hide", "weather_hide"):
            parts = SAVER_ENERGY_PARTS if k == "energy_hide" else SAVER_WEATHER_PARTS
            if not isinstance(val, list) or any(x not in parts for x in val):
                return None
            out[k] = [x for x in parts if x in val]
        elif k in SAVER_CHOICES:
            if val not in SAVER_CHOICES[k]:
                return None
            out[k] = val
        elif k.split("_", 1)[-1] in SAVER_RANGES and k.startswith(("portrait_", "landscape_")):
            lo, hi = SAVER_RANGES[k.split("_", 1)[1]]
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not lo <= val <= hi:
                return None
            out[k] = int(val)
        elif k.split("_", 1)[-1] in SAVER_FOCUS and k.startswith(("portrait_", "landscape_")):
            if val not in SAVER_FOCUS[k.split("_", 1)[1]]:
                return None
            out[k] = val
        else:
            if not isinstance(val, bool):
                return None
            out[k] = val
    return out


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


# ------------------------------------------------------------ the dashboards
# EACH DASHBOARD ITS OWN ITEM: a subentry of type "dashboard", keyed by its
# url path, listed under Dashboards on the integration's page with its own
# settings -- the menu, where the time and weather sit, the Home Assistant
# row, its categories -- and its rooms, All Screens' (HK Settings -> Rooms)
# unless it sets its own (rooms_custom). The menu's icon and the clock tap are
# shared by every screen (HK Settings -> Menu). docs/Menu.md, docs/Rooms.md
# and docs/Screens.md.
SUBENTRY_DASHBOARD = "dashboard"
# menu: off, a button (automatic / the pinned chip / the edge tab), or open
# (always beside the page, folding to the automatic button when narrower
# than dock_min).
# chip_scroll: the chip, and the edge tab slides in while it is scrolled out
# of sight; chip_home: that on Home, the tab on every other page. none: no
# button at all, the swipe from the left edge opens it -- only with `swipe`
# on (hk-base.js treats it as auto without it).
# tabbar: no side menu at all -- the tab bar (hk-tabbar.js), at every width.
BOARD_MENUS = ("off", "auto", "chip", "chip_scroll", "chip_home", "tab", "none", "open", "tabbar")
BOARD_TIME = ("page", "menu")          # the time and weather: header or menu
BOARD_MENU_ROOMS = ("az", "order")     # rooms in the menu: A to Z / room order
# rooms on Home: as written / in room order / only the rooms in room order
BOARD_HOME_ROOMS = ("as_is", "order", "only")
# rooms on a generated dashboard's pages (Lights, Climate, Water ...):
# floor by floor, A to Z within each / in room order
BOARD_PAGE_ROOMS = ("floor", "order")
# THE CHIPS (hk-chip.js KIND_ORDER): which a dashboard shows, in its order.
CHIP_KINDS = ("weather_alert", "security", "doors_windows", "climate", "lights", "blinds",
              "timers", "vacuums", "speakers", "water", "energy")
CHIPS_QUIET = ["weather_alert", "doors_windows", "blinds", "water"]
# THE PAGES a generated dashboard can have (hk-strategy.js), in menu order.
# Energy: the Energy feature's page (features/energy), while it is added.
PAGE_KINDS = ("weather", "calendar", "cameras", "live_tv", "security", "doors_windows", "climate", "lights",
              "timers", "vacuums", "music", "water", "energy", "power", "rooms")
# A DASHBOARD'S PAGE ORDER: the kinds above, plus Browse Music as a place of
# its own (it comes with Play Music -- never on its own -- and follows it
# unless placed), plus the house's custom pages by address, so every page in
# the menu can be reordered.
PAGE_BROWSE = "browse"
PAGE_ORDER = (PAGE_KINDS[:PAGE_KINDS.index("music") + 1] + (PAGE_BROWSE,)
              + PAGE_KINDS[PAGE_KINDS.index("music") + 1:])
BOARD_GLASS = ("house", "clear", "frosted", "tinted", "blur", "blur_pre", "blur_each")   # house: the shared look
# ON NARROW SCREENS: the button under 1,024 px and while an
# always-open menu is folded -- the chip, the chip then the edge tab once
# scrolled past, the edge tab, or none (the swipe alone; the chip without
# it) -- hk-base.js narrowStyle
# ...or the tab bar in its place (hk-tabbar.js)
# (the narrow choice retired in entry 1.12: Phones' menu shows wherever the
# tablets' doesn't fit; read only by the migrations, from stored data)
BOARD_NARROW = ("chip", "chip_scroll", "tab", "none", "tabbar")
# PHONES' OWN MENU (menu_phone, 2026-10-08): a phone -- a window under 640
# px, or a phone's screen held sideways -- and, since 2026-10-09, a tablet
# whose own menu doesn't fit (an always-open menu under Keep Open Down To, a
# button under 1,024 px: hk-base.js phoneForm) show the screen's Phones menu:
# none, a button, or the tab bar; never always open. None: what a phone
# showed before it had one (phone_menu()). Its button's style (button_phone):
# the chip, the chip then the tab, the tab, or no button (the swipe alone).
BOARD_PHONE_MENUS = ("off", "button", "tabbar")
BOARD_BUTTON_PHONE = ("chip", "chip_scroll", "tab", "none")
# what a phone shows at the top of Home: the clock and weather header, or the
# one-line weather strip (a generated screen; a YAML one draws its own)
BOARD_PHONE = ("header", "strip")
# the menu's edge tab: its size on a tablet or wider (tab_size), and on a phone
# (tab_size_phone, under 640 px), each the screen's own -- hk-menu.js. A phone
# starts with the standard one, which already lies over the first column.
BOARD_TAB_SIZES = ("standard", "large", "xl")
# THE TAB BAR (hk-tabbar.js, docs/Tab-Bar.md): iOS's floating tab bar, the
# menu's other form. A screen's `menu` "tabbar" is the bar at every width
# and no side menu; its `narrow` "tabbar" is the side menu (a button, or
# always open) on wide screens and the bar where that menu would fold. The
# two never show together. How the bar behaves while the page scrolls, its
# Rooms button and its glass are menu settings (MENU_KEYS): All Screens'
# unless the screen sets its own menu (menu_custom).
# shrink: folds into a small round button while scrolling down; hide: slides
# away; stay: never moves. Both come back on any scroll up, at the page's
# ends and on a page change.
TAB_BAR_SCROLLS = ("shrink", "hide", "stay")
# WHERE THE HOME ASSISTANT SECTION SITS, in the side menu and in the tab bar's
# More alike: right under Home (More: first), above Categories (More: between
# the top pages and the rest), above Rooms, or after them
HA_PLACES = ("top", "categories", "rooms", "bottom")
# house: the screen's glass (its own or All Screens'); tinted: a near-solid
# tint -- a see-through bar cannot be read over the tiles (measured
# 2026-10-05); stored as "clear" before entry 1.12 (tab_bar_glass)
TAB_BAR_GLASS = ("house", "tinted", "frosted", "blur")
# the rooms: a section of More (under its pages), a round button of their own
# beside the tabs, or not in the bar at all
TAB_BAR_ROOMS = ("more", "button", "off")
# More's look: a grid of icons (wide on a tablet), or a list like the side
# menu's (about a phone's width everywhere) -- on a tablet or wider
# (tab_bar_more) and on a phone, under 640 px (tab_bar_more_phone), as the
# edge tab's two sizes are
TAB_BAR_MORE = ("icons", "list")
# where the bar sits: along the bottom or the top, or a rail down the left or
# the right (tablets and wider -- a phone keeps it at the bottom)
TAB_BAR_POS = ("bottom", "top", "left", "right")
# where Shrink folds the bar to, along it: its start (a bar's left, a rail's
# top) or its end (right / bottom)
TAB_BAR_FOLD = ("start", "end")
# with Shrink: the bar rests full (and folds as the page scrolls), or rests
# small -- a tap opens it, scrolling or a page change folds it again
TAB_BAR_START = ("full", "small")
# the bar's size: its thickness (a rail's width), icons and labels together
TAB_BAR_SIZES = ("small", "medium", "large")
# TAB BAR LABELS (2026-10-24, the owner): each tab's name under its icon, or icons only -- a slimmer bar or rail
TAB_BAR_LABELS = ("show", "icons")
# how many PAGES a bar (bottom / top) and a rail (left / right) show at
# most, Home and More not counted (6: eight tabs in all) -- a phone never
# more than 3, what fits its width
TAB_BAR_TABS = (2, 8)


def tab_count(v: Any, default: int = 6) -> int:
    """A Tabs setting as stored: a whole number in TAB_BAR_TABS, else the
    default."""
    if isinstance(v, bool):
        return default
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if TAB_BAR_TABS[0] <= n <= TAB_BAR_TABS[1] else default


def tab_bar_glass(v: Any) -> str:
    """The tab bar's glass as stored; "clear" (before entry 1.12) is Tinted,
    a name Appearance's glass uses for its see-through look."""
    if v == "clear":
        return "tinted"
    return v if v in TAB_BAR_GLASS else "house"


def tab_bar_rooms(v: Any) -> str:
    """The Rooms setting as stored; a boolean from before 2026-10-05
    evening: True is In More."""
    if v is False:
        return "off"
    return v if v in TAB_BAR_ROOMS else "more"
VIEW_PATH = re.compile(r"^[A-Za-z0-9_.-]{1,60}$")
# WHERE A SCREEN IS DRAWN (decision 29, Mantel's docs/phase9/TWO-PRODUCTS.md "one place per screen"): by Mantel,
# or by HK Frontend's dashboard of the same address in Home Assistant. HK in Home Assistant alone never reads it.
BOARD_WHERE = ("mantel", "ha")
TITLE_MAX = 60
# a screen's own identity, set by the host's screens (add, move, split), never by a screen's page or Copy Settings
BOARD_OWN = ("where", "title")

BOARD_DEFAULTS: dict[str, Any] = {
    # where it is drawn, and its own name (empty: the dashboard's, or its address made readable). Neither is a
    # setting a screen's page changes: Mantel's screens (add, move, split) set them
    "where": "mantel", "title": "",
    # the menu
    "menu": "auto", "dock_min": 1000, "time_weather": "page", "ha_row": False, "ha_place": "rooms",
    "categories": [], "tab_position": "", "tab_size": "large", "tab_size_phone": "standard", "room_order": [],
    "menu_rooms": "az", "home_rooms": "as_is", "page_rooms": "floor",
    # rooms_custom: the four room settings above are this screen's own; off,
    # they are All Screens' (settings `rooms`, filled in by resolved())
    "rooms_custom": False,
    # cameras_custom: `cameras` is this screen's own; off, it is All Screens'
    # (settings `cameras`, filled in by resolved())
    "cameras_custom": False,
    # menu_custom: the menu settings in MENU_KEYS are this screen's own; off,
    # they are All Screens' (settings `menu`, filled in by resolved()) -- all
    # but `menu` itself, whose button style alone follows
    "menu_custom": False, "page_header": "current", "accent": "orange", "glyph": "sidebar", "clock": True,
    # swipe: a drag right from the left edge opens the menu, at every width,
    # beside whatever button there is (hk-menu.js wireEdge)
    "swipe": False,
    # the tab bar (menu or narrow "tabbar"): while scrolling, its Rooms
    # button, its glass -- menu settings (MENU_KEYS)
    "tab_bar_scroll": "shrink", "tab_bar_rooms": "more", "tab_bar_glass": "house", "tab_bar_more": "icons",
    "tab_bar_more_phone": "list", "tab_bar_pos": "bottom", "tab_bar_fold": "start", "tab_bar_start": "full",
    "tab_bar_adjust": True,
    # Phones' While Scrolling (each its own since entry 1.12)
    "tab_bar_scroll_phone": "shrink",
    "tab_bar_tabs": 6, "tab_bar_tabs_rail": 6, "tab_bar_size": "medium", "tab_bar_labels": "show",
    # PHONES' OWN (BOARD_PHONE_MENUS): the menu, the screen's own as `menu`
    # is (None: as before phones had their own, phone_menu()); the button's
    # style and More's rooms, menu settings (MENU_KEYS)
    "menu_phone": None, "button_phone": "chip", "tab_bar_rooms_phone": "more",
    # menu_top: the view paths at the top of the menu, right under Home --
    # empty is the views' own `menu: top`
    "menu_top": [], "phone_header": "header", "chips_custom": [],
    # each custom chip's Show on this screen (2026-10-13): {key: "always" |
    # "active"}; a chip missing shows as written (a conditional one While
    # Active, the rest Always)
    "chips_custom_show": {},
    # Home: the chips -- empty = every kind the house has; quiet = only when
    # there is something to report; extra = entities as chips of their own
    # -- then the camera strip, the scenes row and the favorites.
    # chips_row: the row itself.
    "chips_row": True, "chips": [], "chips_quiet": list(CHIPS_QUIET), "chips_extra": [],
    # camera_live: an input_select/select whose option names the live camera
    # (an automation picks one -- from person detection, say);
    # camera_live_video: whether that first tile plays live at all (None:
    # Same as All Screens, settings cameras.live)
    "camera_strip": True, "cameras": [], "camera_live": "", "camera_live_video": None,
    "scenes_row": True, "scenes": [], "scenes_pages": [],
    "favorites": [],
    # Pages (generated dashboards): empty = every page the house has.
    "pages": [],
    # Screen: frost, blur, tint: this screen's own amounts (0-100 %) -- None
    # follows the shared look (HK Settings -> Appearance); frost_tint: its own
    # Tint from Background, well: its own Tinted icon circles, None follows
    # All Screens.
    "flat": None, "flat_theme": None,
    "glass": "house", "frost": None, "blur": None, "tint": None, "well": None, "frost_tint": None, "sky": True, "car": False,
    # ...and in a car's browser (car on): car_layout, which Home the screen
    # generates there -- "home" the whole Home every screen has, "car" the
    # car's own (CAR_LAYOUTS); car_width, the layout width the car's window
    # is zoomed to hold (tesla-viewport.js), None its default (CAR_WIDTH).
    "car_layout": "home", "car_width": None,
    # (Return to Home When Idle, the Tablet Room, Black Screen and Sleep
    # Screen were a screen's until entry 1.14: they are each tablet's own now,
    # TABLET_DEFAULTS)
    # Sky / Background, this screen's own: None for each follows All
    # Screens (the house's sky animations / weather / decorations, and the
    # house's backdrop -- sky_gradient: a SKY_BACKDROPS id, sky_custom: its
    # stops, for "custom").
    "sky_animations": None, "sky_weather": None, "sky_precipitation": None, "sky_focus_pause": None,
    "sky_decorations": None, "sky_decoration_style": None, "sky_moving": None,
    "sky_cloud_style": None, "sky_daytime": None, "sky_gradient": None, "sky_custom": None,
    # the screen's own Background (SKY_BACKGROUNDS; None: Same as All
    # Screens), its own Color and Photo (None: All Screens')
    "sky_background": None, "sky_color": None, "sky_photo": None, "sky_photo_look": None,
    # ...and its own Landscape and its look (None: All Screens')
    "sky_landscape": None, "sky_landscape_look": None,
    # Liveliness, this screen's own, as All Screens' is: one preset for every
    # occasion or "custom" (None: Same as All Screens), then each occasion's
    # preset and Custom knobs; calm_empty -- Calm When Nobody's Around (the
    # screen's idle room empty: hk-sky.js roomQuiet)
    "sky_liveliness": None, "sky_liveliness_occ": {}, "sky_liveliness_custom": {}, "sky_calm_empty": False,
    # each page's background, this screen's own: {page: mode}; a page
    # missing follows All Screens' (sky.pages). A page's own photo, for
    # "photo": sky_page_photos (missing: All Screens' for it, else the
    # screen's photo)
    "sky_pages": {}, "sky_page_photos": {}, "sky_page_looks": {},
    # FLAT'S OWN (sky.flat_*): None / {} follow All Screens
    "sky_flat_background": None, "sky_flat_color": None, "sky_flat_fade": None, "sky_flat_pages": {}, "sky_flat_tint": None, "sky_flat_tint_amount": None, "sky_flat_tint_light": None,
    "sky_flat_image_look": {}, "sky_flat_page_image_looks": {},
    # the Glass looks' Image Look, this screen's own fields ({} follows All Screens: sky.image_look)
    "sky_image_look": {},
    # FLAT COLORS, this screen's own (settings.flat_colors): a field missing
    # follows All Screens; each page's own over them (flat_page_colors)
    "flat_colors": {}, "flat_page_colors": {},
    # headers (2026-10-16, Pages): the page headers this screen turns off,
    # {page: False}; a page missing is Same as All Screens (headers.<page>.show)
    "headers": {},
    # kiosk: the screen hides Home Assistant's header and sidebar -- HK
    # Frontend itself (hk-kiosk.js), any screen, generated or not. Which of
    # the two (kiosk_header, kiosk_sidebar), and whether for admins too
    # (kiosk_admins). kiosk_engine "kiosk_mode": the Kiosk Mode plugin (HACS)
    # does it instead, with kiosk_options -- a generated screen only.
    "kiosk": False, "kiosk_header": True, "kiosk_sidebar": True, "kiosk_admins": True,
    "kiosk_engine": "hk",
    # popups: this dashboard answers the house's pop-ups (Pop-ups) -- off for
    # a screen that must never be covered (a car's)
    "popups": True,
    # NOTIFICATIONS (Features -> Notifications): notify, the screen shows
    # their banners at all; notify_saver, over its screensaver (None: as All
    # Screens -- the feature's own `saver`); notify_dnd, its Do Not Disturb
    # (None: as All Screens; else its own, notify_dnd())
    "notify": True, "notify_saver": None, "notify_dnd": None,
    # a GENERATED wall tablet's own: the now-playing bar, and the photo
    # screensaver for the tablet's HA user (HK Frontend's own, hk-saver.js;
    # or WallPanel if the screen chooses it) -- the sky and the cards pause
    # behind it
    # the docked bar's two parts: the player (Now Playing Bar) and the running
    # quick timers (Timer Bar; unset, a screen saved before it -- it follows
    # its Now Playing Bar, which had the timers in it)
    "now_playing": False, "timer_bar": False, "screensaver": False,
    # ...on every page, not Home alone (the bar is carried from page to page)
    "bar_all_pages": False,
    # ...and where it shows (None: Same as All Screens, settings now_playing)
    "np_style": None, "np_side": None, "np_bar": None, "np_bar_phone": None,
    # null: the settings for All Screens (resolved() fills them in)
    "screensaver_options": None, "screensaver_engine": "hk",
    # a GENERATED dashboard's third-party cards' own options (YAML), over the
    # tuned settings: WallPanel's and Kiosk Mode's
    "wallpanel_options": {}, "kiosk_options": {},
    # the house's CUSTOM PAGES this generated dashboard shows (their
    # addresses, in this order), after its category pages and before the
    # rooms
    "custom_pages": [],
    # HOME PAGE: off, a generated screen is only the pages it lists
    # (`only_pages`: any page kind or custom page, in order) and opens on the
    # first -- an Energy display, a Security panel. Its own list, apart from
    # the whole screen's `pages`, so turning Home back on finds the whole
    # screen as it was. Listing none (a screen set up before 2026-10-04):
    # only its custom pages, `energy` among them the Energy feature's page
    "home_page": True, "only_pages": [],
    # ...and on, WHICH Home: "" the generated one, or the address of one of
    # the house's custom pages -- a car's own first page over the generated
    # category pages
    "home_view": "",
    # HOME STYLE (Home Grid, docs/phase11/HOME-GRID.md): "generated", Home as
    # every screen builds it, or "grid" -- Home is this screen's own layout,
    # home_grid (home_grid.py; None: none yet, and Home is generated)
    "home_style": "generated", "home_grid": None}
# A CAR'S BROWSER (a screen's car_layout / car_width): which Home it
# generates there -- the whole one, or the car's own (the weather and the
# house's status in a line, the chips, Scenes, Security and Favorites: no clock, the car
# has one, and no rooms) -- and the layout width the car's window is zoomed
# to hold: the presets the settings offer, any width between the bounds.
CAR_LAYOUTS = ("home", "car")
CAR_WIDTH = 1200
CAR_WIDTHS = (1000, 1200, 1400)
CAR_WIDTH_MIN, CAR_WIDTH_MAX = 600, 2400


def car_width(v: Any) -> int | None:
    """A car's layout width in px, or None (CAR_WIDTH)."""
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return None
    try:
        n = int(round(float(v)))
    except ValueError:
        return None
    return n if CAR_WIDTH_MIN <= n <= CAR_WIDTH_MAX else None


# The pages a scene pill can open (Home -> Scenes -> Pills that open a page).
SCENE_PAGES = tuple(k for k in PAGE_KINDS if k != "rooms")
SCENE_PAGE = "page:"                   # such a pill's place in the scenes order
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")

# WHAT A NEW DASHBOARD ITEM STARTS FROM (Add dashboard -> "What is this
# screen?"): the settings that differ by the kind of screen, the
# rest are the defaults. "custom" starts from the defaults (the menu off for a
# hand-written dashboard). A preset is a starting point, not a mode: nothing
# remembers it, and every value can be changed on the gear afterwards.
SCREEN_PRESETS: dict[str, dict[str, Any]] = {
    # on a wall: the menu always open with the time and weather in it, back to
    # Home when left alone, no Home Assistant chrome
    "wall_tablet": {"menu": "open", "time_weather": "menu", "kiosk": True},
    # phones and iPads: the menu behind a button, the time in the header
    "personal": {"menu": "auto", "time_weather": "page"},
    # a desk or a laptop: the menu open beside the page
    "computer": {"menu": "open", "time_weather": "page"},
    # a car's browser: no menu, the car's viewport, no chrome
    "car": {"menu": "off", "car": True, "car_layout": "car", "kiosk": True},
    # an energy display: only the Energy page (the Energy feature's), no
    # menu, no Home Assistant chrome -- a screen beside the electrical panel
    "energy": {"menu": "off", "home_page": False, "only_pages": ["energy"], "kiosk": True},
    "custom": {},
}


def amount_or_none(v: Any) -> int | None:
    """A look amount (0-100 %), or None: not set, follow the house's."""
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return max(AMOUNT[0], min(AMOUNT[1], n))


_MISSING = object()


def board(data: Mapping[str, Any] | None) -> dict[str, Any]:
    """One dashboard's settings over the defaults, each value checked: what
    is stored can predate a choice being removed."""
    out = copy.deepcopy(BOARD_DEFAULTS)
    d = dict(data or {})
    pick = lambda k, allowed: d[k] if d.get(k) in allowed else out[k]  # noqa: E731
    out["where"] = pick("where", BOARD_WHERE)
    out["title"] = str(d.get("title") or "").strip()[:TITLE_MAX] if isinstance(d.get("title"), str) else ""
    out["menu"] = pick("menu", BOARD_MENUS)
    out["time_weather"] = pick("time_weather", BOARD_TIME)
    out["menu_rooms"] = pick("menu_rooms", BOARD_MENU_ROOMS)
    out["home_rooms"] = pick("home_rooms", BOARD_HOME_ROOMS)
    out["page_rooms"] = pick("page_rooms", BOARD_PAGE_ROOMS)
    out["phone_header"] = pick("phone_header", BOARD_PHONE)
    try:
        out["dock_min"] = int(min(max(float(d.get("dock_min") or 1000), DOCK_MIN[0]), DOCK_MIN[1]))
    except (TypeError, ValueError):
        pass
    out["ha_row"] = bool(d.get("ha_row", False))
    out["ha_place"] = pick("ha_place", HA_PLACES)
    out["rooms_custom"] = bool(d.get("rooms_custom", False))
    out["cameras_custom"] = bool(d.get("cameras_custom", False))
    out["menu_custom"] = bool(d.get("menu_custom", False))
    out["page_header"] = pick("page_header", PAGE_HEADERS)
    out["accent"] = accent(d.get("accent")) or out["accent"]
    out["glyph"] = pick("glyph", MENU_GLYPHS)
    out["clock"] = bool(d.get("clock", True))
    out["swipe"] = d.get("swipe") is True
    out["tab_bar_scroll"] = pick("tab_bar_scroll", TAB_BAR_SCROLLS)
    out["tab_bar_rooms"] = tab_bar_rooms(d.get("tab_bar_rooms"))
    out["tab_bar_glass"] = tab_bar_glass(d.get("tab_bar_glass"))
    out["tab_bar_more"] = pick("tab_bar_more", TAB_BAR_MORE)
    out["tab_bar_more_phone"] = pick("tab_bar_more_phone", TAB_BAR_MORE)
    out["tab_bar_pos"] = pick("tab_bar_pos", TAB_BAR_POS)
    out["tab_bar_fold"] = pick("tab_bar_fold", TAB_BAR_FOLD)
    out["tab_bar_start"] = pick("tab_bar_start", TAB_BAR_START)
    out["tab_bar_adjust"] = d.get("tab_bar_adjust") is not False
    out["tab_bar_tabs"] = tab_count(d.get("tab_bar_tabs"))
    out["tab_bar_size"] = pick("tab_bar_size", TAB_BAR_SIZES)
    out["tab_bar_labels"] = pick("tab_bar_labels", TAB_BAR_LABELS)
    out["tab_bar_tabs_rail"] = tab_count(d.get("tab_bar_tabs_rail"))
    out["tab_bar_scroll_phone"] = pick("tab_bar_scroll_phone", TAB_BAR_SCROLLS)
    out["menu_phone"] = d.get("menu_phone") if d.get("menu_phone") in BOARD_PHONE_MENUS else None
    out["button_phone"] = pick("button_phone", BOARD_BUTTON_PHONE)
    out["tab_bar_rooms_phone"] = tab_bar_rooms(d.get("tab_bar_rooms_phone"))
    strs = lambda v: [str(x) for x in v if x] if isinstance(v, list) else None  # noqa: E731
    for k in ("categories", "room_order", "cameras", "scenes", "favorites", "chips_extra"):
        out[k] = strs(d.get(k)) or []
    # chips: the kinds AND the dashboard's own chips (entities), in one order;
    # which entities are chips at all is chips_extra's to say
    out["chips"] = [k for k in (strs(d.get("chips")) or []) if k in CHIP_KINDS or ENTITY_ID.match(k)
                    or (k.startswith(CHIP_TOKEN) and CHIP_KEY.match(k[len(CHIP_TOKEN):]))]
    out["chips_custom"] = [k for k in (strs(d.get("chips_custom")) or []) if CHIP_KEY.match(k)]
    out["chips_custom_show"] = chips_custom_show(d.get("chips_custom_show")) or {}
    quiet = strs(d.get("chips_quiet"))
    out["chips_quiet"] = list(CHIPS_QUIET) if quiet is None else [k for k in quiet if k in CHIP_KINDS]
    out["pages"] = page_order(strs(d.get("pages")) or [])
    out["only_pages"] = page_order(strs(d.get("only_pages")) or [])
    # scenes: scene entities and "page:<kind>" -- a pill that opens a page,
    # placed among them; which pages have a pill at all is scenes_pages' to
    # say
    out["scenes"] = [k for k in out["scenes"] if ENTITY_ID.match(k) or
                     (k.startswith(SCENE_PAGE) and k[len(SCENE_PAGE):] in SCENE_PAGES)]
    out["scenes_pages"] = [k for k in (strs(d.get("scenes_pages")) or []) if k in PAGE_KINDS and k != "rooms"]
    out["custom_pages"] = [k for k in (strs(d.get("custom_pages")) or []) if PAGE_PATH.match(k)]
    out["car_layout"] = d.get("car_layout") if d.get("car_layout") in CAR_LAYOUTS else BOARD_DEFAULTS["car_layout"]
    out["car_width"] = car_width(d.get("car_width"))
    hv = str(d.get("home_view") or "").strip()
    out["home_view"] = hv if PAGE_PATH.match(hv) else ""
    out["home_style"] = pick("home_style", HG.HOME_STYLES)
    out["home_grid"] = HG.layout(d.get("home_grid"))
    out["menu_top"] = list(dict.fromkeys(k for k in (strs(d.get("menu_top")) or []) if VIEW_PATH.match(k)))
    t = tab_position(d.get("tab_position"))
    out["tab_position"] = t if t is not None else ""
    out["tab_size"] = pick("tab_size", BOARD_TAB_SIZES)
    out["tab_size_phone"] = pick("tab_size_phone", BOARD_TAB_SIZES)
    out["glass"] = RETIRED_GLASS.get(d.get("glass")) or pick("glass", BOARD_GLASS)
    out["flat"] = d.get("flat") if isinstance(d.get("flat"), bool) else None
    out["flat_theme"] = d.get("flat_theme") if d.get("flat_theme") in ("light", "dark") else None
    for k in ("frost", "blur", "tint"):
        out[k] = amount_or_none(d.get(k))
    out["well"] = d.get("well") if d.get("well") in WELLS else None
    out["frost_tint"] = d.get("frost_tint") if isinstance(d.get("frost_tint"), bool) else None
    # The screen's own Sky / Background: each flag stored as anything but a
    # boolean is not set (follow All Screens), as a backdrop id not in
    # SKY_BACKDROPS and stops that do not parse are (sky_stops()).
    for k in ("sky_animations", "sky_weather", "sky_precipitation", "sky_focus_pause", "sky_decorations",
              "camera_live_video"):
        out[k] = d.get(k) if isinstance(d.get(k), bool) else None
    out["sky_decoration_style"] = d.get("sky_decoration_style") if d.get("sky_decoration_style") in ("old", "new") else None
    out["sky_moving"] = d.get("sky_moving") if d.get("sky_moving") in SKY_MOVING else None
    out["sky_cloud_style"] = d.get("sky_cloud_style") if d.get("sky_cloud_style") in CLOUD_STYLES else None
    out["sky_daytime"] = d.get("sky_daytime") if d.get("sky_daytime") in DAYTIME_SKIES else None
    out["sky_gradient"] = d.get("sky_gradient") if d.get("sky_gradient") in SKY_BACKDROP_IDS else None
    out["sky_custom"] = sky_stops(d.get("sky_custom"))
    out["sky_pages"] = sky_pages(d.get("sky_pages")) or {}
    out["headers"] = board_headers(d.get("headers"))
    out["sky_background"] = d.get("sky_background") if d.get("sky_background") in SKY_BACKGROUNDS else None
    out["sky_color"] = d.get("sky_color") if d.get("sky_color") in SKY_COLOR_IDS else None
    out["sky_photo"] = sky_photo(d.get("sky_photo"))
    out["sky_photo_look"] = photo_look(d.get("sky_photo_look")) if d.get("sky_photo_look") is not None else None
    out["sky_landscape"] = sky_landscape(d.get("sky_landscape"))
    out["sky_landscape_look"] = photo_look(d.get("sky_landscape_look")) if d.get("sky_landscape_look") is not None else None
    out["sky_page_photos"] = sky_page_photos(d.get("sky_page_photos")) or {}
    out["sky_page_looks"] = page_looks(d.get("sky_page_looks")) or {}
    out["sky_flat_background"] = d.get("sky_flat_background") if d.get("sky_flat_background") in FLAT_BACKGROUNDS else None
    out["sky_flat_color"] = flat_color(d.get("sky_flat_color"))
    out["sky_flat_fade"] = amount_or_none(d.get("sky_flat_fade"))
    out["sky_flat_tint"] = flat_tint(d.get("sky_flat_tint"))
    out["sky_flat_tint_amount"] = amount_or_none(d.get("sky_flat_tint_amount"))
    out["sky_flat_tint_light"] = amount_or_none(d.get("sky_flat_tint_light"))
    out["sky_flat_pages"] = flat_pages(d.get("sky_flat_pages")) or {}
    out["sky_flat_image_look"] = flat_image_look(d.get("sky_flat_image_look")) or {}
    out["sky_image_look"] = flat_image_look(d.get("sky_image_look")) or {}
    out["sky_flat_page_image_looks"] = flat_page_image_looks(d.get("sky_flat_page_image_looks")) or {}
    out["flat_colors"] = flat_colors(d.get("flat_colors")) or {}
    out["flat_page_colors"] = flat_page_colors(d.get("flat_page_colors")) or {}
    out["sky_liveliness"] = d.get("sky_liveliness") if d.get("sky_liveliness") in LIVELY_PRESETS else None
    out["sky_liveliness_occ"] = lively(d.get("sky_liveliness_occ")) or {}
    # (before 2026-10-09 a screen's Custom was by kind -- {flying: 2, ...}:
    # that reads as nothing)
    out["sky_liveliness_custom"] = lively_custom(d.get("sky_liveliness_custom")) or {}
    out["sky_calm_empty"] = d.get("sky_calm_empty") is True
    out["notify_saver"] = d.get("notify_saver") if d.get("notify_saver") in NOTIFY_SAVERS else None
    out["notify_dnd"] = notify_dnd(d.get("notify_dnd"))
    for k, allowed in (("np_style", NP_STYLES), ("np_side", NP_SIDES), ("np_bar", NP_BARS), ("np_bar_phone", NP_BARS)):
        out[k] = d.get(k) if d.get(k) in allowed else None
    for k in ("chips_row", "camera_strip", "scenes_row", "sky", "car", "kiosk", "popups", "notify",
              "now_playing", "bar_all_pages", "screensaver", "home_page", "kiosk_header", "kiosk_sidebar", "kiosk_admins"):
        out[k] = bool(d.get(k, BOARD_DEFAULTS[k]))
    out["timer_bar"] = bool(d.get("timer_bar", out["now_playing"]))
    for k in ("wallpanel_options", "kiosk_options"):
        out[k] = card_options(d.get(k)) or {}
    # A SCREEN'S SCREENSAVER OPTIONS, AS STORED: its own (a mapping), or null
    # -- the settings for All Screens, filled in on reading (resolved()). A
    # screen that never had any keeps its old WallPanel choices as its own
    # (1.2 -> 1.3), or follows All Screens.
    own = d.get("screensaver_options", _MISSING)
    if own is None:
        out["screensaver_options"] = None
    elif isinstance(own, dict) and own:
        out["screensaver_options"] = saver_options(own) or saver_options(None, out["wallpanel_options"])
    else:
        legacy = saver_options(None, out["wallpanel_options"])
        out["screensaver_options"] = legacy if legacy != SAVER_DEFAULTS else None
    out["screensaver_engine"] = d.get("screensaver_engine") if d.get("screensaver_engine") in SAVER_ENGINES else "hk"
    # WHO HIDES THE HEADER: HK Frontend, unless the screen chose the Kiosk
    # Mode plugin (a 1.2 screen's choice is written down by settings_tidied)
    out["kiosk_engine"] = d.get("kiosk_engine") if d.get("kiosk_engine") in KIOSK_ENGINES else "hk"
    live = str(d.get("camera_live") or "").strip()
    out["camera_live"] = live if re.fullmatch(r"(input_select|select)\.[a-z0-9_]+", live) else ""
    return out


def kiosk_from_plugin(o: Mapping[str, Any] | None) -> dict[str, bool] | None:
    """A 1.2 screen's Kiosk Mode Options, as HK Frontend's own kiosk
    settings -- or None when they say something HK Frontend can't (any
    other option of the plugin's, or admins seeing only part of what is
    hidden). The 1.2 page wrote hide_header, hide_sidebar and
    admin_settings; a screen that only ever used those moves over as it was."""
    o = dict(o or {})
    if set(o) - {"hide_header", "hide_sidebar", "admin_settings"}:
        return None
    header, sidebar = o.get("hide_header", True), o.get("hide_sidebar", True)
    admin = o.get("admin_settings", {})
    if not isinstance(header, bool) or not isinstance(sidebar, bool) or not isinstance(admin, dict) \
            or set(admin) - {"hide_header", "hide_sidebar"}:
        return None
    if not admin:
        return {"kiosk_header": header, "kiosk_sidebar": sidebar, "kiosk_admins": True}
    # admins: all of it shown (HK's For Admins Too off), or the same as everyone
    shown = {"hide_header": header, "hide_sidebar": sidebar}
    if all(admin.get(k, shown[k]) is False or not shown[k] for k in shown):
        return {"kiosk_header": header, "kiosk_sidebar": sidebar, "kiosk_admins": False}
    if all(admin.get(k, shown[k]) == shown[k] for k in shown):
        return {"kiosk_header": header, "kiosk_sidebar": sidebar, "kiosk_admins": True}
    return None


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
            "tab_bar_size": pick("bar_size", TAB_BAR_SIZES, d["tab_bar_size"]),
            "tab_bar_labels": pick("bar_labels", TAB_BAR_LABELS, d["tab_bar_labels"]),
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
             menu: Mapping[str, Any] | None = None, cameras: list[str] | None = None) -> dict[str, Any]:
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
    out["menu_house"] = not b.get("menu_custom")
    if out["menu_house"]:
        hm = house_menu(merged(options)["menu"] if menu is None else menu)
        style = hm.pop("menu")
        out.update(hm)
        if out.get("menu") in MENU_STYLES:
            out["menu"] = style
    return out


def preset_menu(data: Mapping[str, Any], preset: Mapping[str, Any],
                options: Mapping[str, Any] | None) -> dict[str, Any]:
    """A new screen from a preset (SCREEN_PRESETS): it follows All Screens'
    menu unless the preset chooses a menu setting All Screens' differs on
    (a wall tablet's time and weather in the menu), when it starts with its
    own (menu_custom). Whether it has a menu is its own either way."""
    house = house_menu(merged(options)["menu"])
    keys = [k for k in preset if k in MENU_KEYS and k != "menu"]
    return {**data, "menu_custom": any(json.dumps(data[k]) != json.dumps(house[k]) for k in keys)}


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
    out: dict[str, dict[str, Any]] = {}
    m = merged(stored.options if stored is not None else None)
    house, rooms, menu, cams = m["look"]["saver"], m["rooms"], m["menu"], m["cameras"]["order"]
    for sub in (stored.of(SUBENTRY_DASHBOARD) if stored is not None else ()):
        out[sub.unique_id] = resolved(board(sub.data), None, house, rooms, menu, cams)
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


# ------------------------------------------------------------ what is stored
# ONLY WHAT WAS SET (2026-10-14, the user's choice): a setting is stored when
# it differs from its default, and every read fills the rest in (merged(),
# board(), tablet()). Saving one setting used to store its whole section --
# every default with it, frozen at that day's value -- so a default changed
# in a later version never reached a screen that had ever been saved. Now it
# does, for anything left at its default. Entry 1.15 (settings_trimmed)
# tidies what was stored before.
def only_set(values: Mapping[str, Any], defaults: Mapping[str, Any],
             keep: tuple[str, ...] = ()) -> dict[str, Any]:
    """`values` less those equal to their default (`keep`: always stored)."""
    return {k: v for k, v in values.items() if k in keep or k not in defaults or v != defaults[k]}


def house_stored(section: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """A house section as stored: what differs from its default."""
    return only_set(values, merged(None).get(section) or {})


def board_stored(data: Mapping[str, Any] | None) -> dict[str, Any]:
    """A screen's item as stored: its settings, checked, less the defaults."""
    return only_set(board(data), board(None))


# a tablet's name and id are its identity (its item's title, its entities'
# ids): stored even when they read as the defaults would
TABLET_KEEP = ("name", "uid")


def tablet_stored(data: Mapping[str, Any] | None, tid: str = "") -> dict[str, Any]:
    """A tablet's item as stored: its settings, checked, less the defaults."""
    return only_set(tablet(data, tid), tablet(None, tid), TABLET_KEEP)


def settings_trimmed(options: Mapping[str, Any] | None, boards_: Mapping[str, Mapping[str, Any]],
                     tablets_: Mapping[str, Mapping[str, Any]]
                     ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Entry 1.15: everything stored before 1.15, less what equals today's
    defaults. -> (options or None when unchanged, boards, tablets) -- each
    item as it should be stored now."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    now = merged(options)
    dash = {}
    for section, values in stored.items():
        if isinstance(values, Mapping) and section in now:
            # (a key the settings no longer have goes too, as on every save)
            dash[section] = house_stored(section, {k: now[section][k] for k in values if k in now[section]})
        else:
            dash[section] = values
    opts = None if dash == stored else {**dict(options or {}), CONF_DASHBOARD: dash}
    return (opts, {p: board_stored(d) for p, d in boards_.items()},
            {t: tablet_stored(d, t) for t, d in tablets_.items()})


# ------------------------------------------------------------ text fields
# Two settings are small tables. The UI edits them as plain text, one row per
# line, because a list-of-objects selector does not exist -- and a format
# a person can read back is better than one only a form can.
_BIRTHDAY = re.compile(r"^\s*(.+?)\s+(\d{1,2})-(\d{1,2})\s*$")
_ROOM = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=\s*([a-z0-9_]+)\s*$")


def parse_birthdays(text: str) -> list[dict[str, Any]] | None:
    """'Name MM-DD' per line -> [{name, month, day}], or None if a line is bad."""
    out = []
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        m = _BIRTHDAY.match(line)
        if not m:
            return None
        month, day = int(m.group(2)), int(m.group(3))
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return None
        out.append({"name": m.group(1), "month": month, "day": day})
    return out


def format_birthdays(rows: list[dict[str, Any]]) -> str:
    return "\n".join(f"{b['name']} {b['month']:02d}-{b['day']:02d}" for b in rows or [])


def parse_rooms(text: str) -> dict[str, str] | None:
    """'dashboard-kitchen = kitchen' per line -> {dashboard: room}, or None."""
    out = {}
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        m = _ROOM.match(line)
        if not m:
            return None
        out[m.group(1)] = m.group(2)
    return out


def format_rooms(rooms: dict[str, str]) -> str:
    return "\n".join(f"{d} = {r}" for d, r in (rooms or {}).items())


def suggestions(house: House) -> dict[str, Any]:
    """What a house that has never saved Status & Chips probably wants: every
    lock, every door and window contact, every garage door -- a garage_door
    contact or a garage/gate COVER (the door itself is usually a cover; a
    contact named "Garage Door" is often the door INTO the garage, and its
    device_class says door, so it is offered as one). Offered as the
    form's starting point only -- nothing is saved until the form is."""
    doors, windows, garage, locks = [], [], [], []
    alarm = None
    for st in sorted(house.states(), key=lambda s: s.entity_id):
        eid, dc = st.entity_id, st.attributes.get("device_class")
        if eid.startswith("lock."):
            locks.append(eid)
        elif eid.startswith("alarm_control_panel.") and alarm is None:
            alarm = eid
        elif eid.startswith("binary_sensor.") and dc == "door":
            doors.append(eid)
        elif eid.startswith("binary_sensor.") and dc == "window":
            windows.append(eid)
        elif eid.startswith("binary_sensor.") and dc == "garage_door":
            garage.append(eid)
        elif eid.startswith("cover.") and dc in ("garage", "gate"):
            garage.append(eid)
    return {"alarm": alarm, "locks": locks, "doors": doors, "windows": windows,
            "garage": garage}
