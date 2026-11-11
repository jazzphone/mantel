"""model.py's schema: the sky, wallpaper, flat color, lively and weather settings, and the radar's (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Iterator, Mapping
import copy
from dataclasses import dataclass, field
import re
from typing import Any
from .. import home_grid as HG


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
SKY_BACKGROUNDS = ("live", "color", "photo", "landscapes", "wallpaper")

# WALLPAPERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase E): our own art,
# drawn by hk-wallpapers.js -- four shapes (ribbons, petals, shards, pinwheel)
# in six colour families, each with a darker night version. A wallpaper is a
# still, as a Color is, and publishes its four stops as the sky's, so Frosted's
# Tint from Background, the Flat image tint and Bright Glass read them. Which
# version shows (WALLPAPER_NIGHT): "auto" the night one after sunset, or always
# "day" / "night".
# THE MOTION THEMES (2026-10-31, the owner on 0.1.94: more moving backgrounds, one that takes any colour, with
# presets): six more wallpapers, each drawn by hk-wallpapers.js from one colour (WALLPAPER_COLOR) -- a still
# ground and a few layers its Motion moves.
WALLPAPER_THEMES = ("aurora", "blobs", "waves", "dots", "beams", "meteors")

# THE ARTS IN ANY COLOUR (2026-11-01, item 45: the owner's one combined picker): the four shapes, each drawn in the
# colour chosen (WALLPAPER_COLOR, the themes' own), so a wallpaper is an art or a theme plus a colour.
WALLPAPER_ARTS = ("ribbons", "petals", "shards", "pinwheel")

WALLPAPERS = WALLPAPER_ARTS + WALLPAPER_THEMES

# ...and the twelve as they were stored before (hk-wallpapers.js LEGACY mirrors this, in its order): an art in a
# preset. Still read and accepted, and drawn as they always were -- "ribbons_rose" is Ribbons in Rose, whatever
# colour was stored beside it (it was a theme's alone then)
WALLPAPER_LEGACY = {
    "ribbons_rose": ("ribbons", "rose"), "petals_rose": ("petals", "rose"), "petals_violet": ("petals", "violet"),
    "shards_violet": ("shards", "violet"), "shards_blue": ("shards", "blue"), "ribbons_blue": ("ribbons", "blue"),
    "pinwheel_teal": ("pinwheel", "teal"), "ribbons_teal": ("ribbons", "teal"), "pinwheel_amber": ("pinwheel", "amber"),
    "petals_amber": ("petals", "amber"), "shards_graphite": ("shards", "graphite"), "pinwheel_graphite": ("pinwheel", "graphite"),
}

WALLPAPER_NIGHT = ("auto", "day", "night")

# A WALLPAPER'S MOTION (2026-10-30, the owner: "animated slowly with a speed setting... an option to turn the
# animation off or on"): off, or a slow drift at one of three speeds -- transform only, on the drawn picture
# (a theme's layers each move their own way, at the same three speeds)
WALLPAPER_MOTION = ("off", "slow", "medium", "fast")

# A THEME'S COLOUR (2026-10-31): one of the presets, one tap each (hk-wallpapers.js COLORS mirrors this, in
# its order), or "#rrggbb", any colour. Only its hue and how vivid it is are used: how light the theme's shades
# run is set by hk-wallpapers.js, so any colour keeps white text readable.
WALLPAPER_COLORS = (
    {"id": "rose", "label": "Rose", "hex": "#e0457b"},
    {"id": "coral", "label": "Coral", "hex": "#f0644a"},
    {"id": "amber", "label": "Amber", "hex": "#f59e0b"},
    {"id": "green", "label": "Green", "hex": "#34c759"},
    {"id": "teal", "label": "Teal", "hex": "#14b8a6"},
    {"id": "blue", "label": "Blue", "hex": "#2f7bf6"},
    {"id": "violet", "label": "Violet", "hex": "#7a5cff"},
    {"id": "graphite", "label": "Graphite", "hex": "#8a94a6"},
)

WALLPAPER_COLOR_IDS = tuple(c["id"] for c in WALLPAPER_COLORS)


def wallpaper_color(v: Any) -> str | None:
    """A theme's colour as stored (a WALLPAPER_COLORS id, or "#rrggbb" in lower case), or None."""
    if not isinstance(v, str):
        return None
    if v in WALLPAPER_COLOR_IDS:
        return v
    return v.lower() if ACCENT_HEX.fullmatch(v) else None


def wallpaper_choice(w: Any, c: Any) -> tuple[str, str]:
    """All Screens' Wallpaper as stored -> (art or theme, colour). An old id (WALLPAPER_LEGACY) is its art in its
    own preset; an art or theme with no colour stored is in Blue (the themes' colour before 2026-11-01); nothing
    stored, or a value no longer known, is Ribbons in Rose -- the default the twelve had."""
    if isinstance(w, str) and w in WALLPAPER_LEGACY:
        return WALLPAPER_LEGACY[w]
    if w in WALLPAPERS:
        return w, wallpaper_color(c) or "blue"
    return "ribbons", "rose"


def board_wallpaper(w: Any, c: Any) -> tuple[str | None, str | None]:
    """A screen's own Wallpaper and colour as stored -> (art or theme or None, colour or None): None is Same as
    All Screens. An old id is its art in its own preset, as All Screens' is."""
    if isinstance(w, str) and w in WALLPAPER_LEGACY:
        return WALLPAPER_LEGACY[w]
    return (w if w in WALLPAPERS else None), wallpaper_color(c)


SKY_COLOR_IDS = tuple(i for i in SKY_BACKDROP_IDS if i != "live")

# A PAGE'S BACKGROUND (Sky / Background -> Pages): its own color, any
# backdrop -- "live" among them, the live sky -- "photo" (its own photo,
# sky.page_photos, else the screen's), "landscapes" (the screen's
# Landscape) or "wallpaper" (the screen's Wallpaper, 2026-10-30)
SKY_PAGE_MODES = ("own",) + SKY_BACKDROP_IDS + ("photo", "landscapes", "wallpaper")

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
    from .menu_rules import accent
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
    from .chip_rules import CHIP_KEY
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
SKY_RESET = ("background", "color", "landscape", "wallpaper", "wallpaper_night", "wallpaper_motion", "wallpaper_color","photo_look", "landscape_look", "image_look", "flat_background", "flat_color",
    "flat_image_look", "flat_fade", "flat_tint", "flat_tint_amount", "flat_tint_light",
             "animations", "focus_pause", "moving", "weather", "precipitation",
             "cloud_style", "daytime", "gradient", "decorations", "decoration_style",
             "woodland", "themes", "liveliness_all", "liveliness", "liveliness_custom")

SKY_RESET_BOARD = ("sky_background", "sky_color", "sky_landscape", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion", "sky_wallpaper_color", "sky_photo_look", "sky_landscape_look",
    "sky_image_look",
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
    "vacuums": {"show": True, "counters": None, "water_tank": True, "water_clear": 24},
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


GLASS = ("clear", "frosted", "tinted", "blur", "blur_pre", "blur_each")

# BRIGHT GLASS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase D): the sixth
# look -- clear glass, a light blur and a bright rim, for vivid backgrounds --
# in the Blur look's three Blur Modes, one stored value each as Blur's are:
# bright (Shared Layer), bright_pre (Pre-rendered), bright_each (Each Card)
BRIGHT_GLASS = ("bright", "bright_pre", "bright_each")

GLASS = GLASS + BRIGHT_GLASS

# Tinted's icon circles (look.well, a screen's well): Apple's dark, or light
WELLS = ("dark", "light")

# Tile Style (look.tile_style, a screen's tile_style; a Home Grid block's `tile`, home_grid.TILE_STYLES).
# Automatic (2026-10-30, the default; the owner: "maybe it could be linked to the Square Setting?"): Centred on a
# Home Grid of square cells, Home on 196 x 150 tiles and the room pages -- Home and Centred stay to choose outright.
TILE_STYLES = ("auto",) + HG.TILE_STYLES

# (2026-11-07) Centered tiles' glyphs off (look.tile_icons; Automatic: white on Bright Glass); Climate's thermostats' style
TILE_ICONS, THERMOSTAT_STYLES = ("auto", "color", "white"), HG.THERMOSTAT_STYLES

# BRIGHT GLASS ON (look.bright_pages, a screen's bright_pages; 2026-10-30, the owner: "should we only use Bright
# Glass on the main page?"): Home only (the default), the other pages in its Blur; or every page
BRIGHT_PAGES = ("home", "all")

# Bright Glass's Dim (look.bright_dim, a screen's bright_dim): 0 to this, in %, as the Side Pane's (PANE_DIM_MAX)
BRIGHT_DIM_MAX = 60

# Looks that were tried and taken out, read as the one that replaced them:
# Baked (blur_baked, each surface its own slice of the picture) cost more
# than it saved and went on 2026-10-10 -- Pre-rendered is the same picture.
RETIRED_GLASS = {"blur_baked": "blur_pre"}

BLACK_SCREENS = ("kiosk", "hk")    # a screen's Black Screen (BOARD_DEFAULTS)

AMOUNT = (0, 100)                  # look.frost, look.blur, look.tint and look.bright, in %; 50 is the default

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
