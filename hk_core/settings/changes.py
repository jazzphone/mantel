"""THE SETTINGS PAGE'S WRITES: one change, checked, saved.

The HK Settings page (panels/hk-settings.js) is laid out as the Home app's
settings are -- every control saves as it changes -- so it cannot submit a
config flow's form (a form saves every field it holds, and one it does not
show would have to be sent whole). It sends only what changed instead:

    hk_frontend/settings/set  {"changes": {"look.glass": "blur", ...}}
    hk_frontend/board/set     {"dashboard": "dashboard-kitchen", "changes": {"menu": "open"}}

Each value is checked here with the same model.py functions the flows and
the settings feed use (board(), tab_position(), card_options(), sky_date(),
kinds.clean() ...) and refused with the field's name when it is not one it
could be, rather than quietly turned into a default. Nothing is written
unless every change in the call is good. The storage is the entry's own (its
options and its dashboard items), so the page and the flows can be used side
by side.

Written once for every host (hk_core): these take the options or an item's data and give
them back changed, and never save -- the host does (inside Home Assistant, settings_api.py
under its old name, with the websocket commands in panel.py and the entry as the store). The
integration's own options beside `dashboard` (`TOP`) are the host's to add to: Home
Assistant's adds HK as its own sidebar panel (`hk_panel`).
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
import copy
import re
from typing import Any

from ..sleep import rules as SR
from . import home_grid as HG
from . import kinds as K
from . import model as S

ENTITY = re.compile(r"^([a-z0-9_]+)\.[a-z0-9_]+$")


class Invalid(ValueError):
    """A value that cannot be saved: `code` says why (the page words it)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ------------------------------------------------------------ the checks
def _entity(*domains: str) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if v in (None, ""):
            return None
        m = ENTITY.match(v) if isinstance(v, str) else None
        if not m or (domains and m.group(1) not in domains):
            raise Invalid("entity")
        return v
    return check


def _entities(*domains: str) -> Callable[[Any], list[str]]:
    one = _entity(*domains)

    def check(v: Any) -> list[str]:
        if v in (None, ""):
            return []
        if not isinstance(v, list):
            raise Invalid("list")
        out: list[str] = []
        for x in v:
            e = one(x)
            if e and e not in out:
                out.append(e)
        return out
    return check


def _ids(v: Any) -> list[str]:
    """Area or device ids: plain strings, each once."""
    if v in (None, ""):
        return []
    if not isinstance(v, list) or not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9_-]+", x) for x in v):
        raise Invalid("list")
    return list(dict.fromkeys(v))


def _bool(v: Any) -> bool:
    if not isinstance(v, bool):
        raise Invalid("bool")
    return v


def _choice(options: tuple[str, ...] | list[str], none: bool = False) -> Callable[[Any], Any]:
    def check(v: Any) -> Any:
        if none and v in (None, ""):
            return None
        if v not in options:
            raise Invalid("choice")
        return v
    return check


def _subset(options: tuple[str, ...]) -> Callable[[Any], list[str]]:
    """Some of `options`, kept in THEIR order whatever order they came in."""
    def check(v: Any) -> list[str]:
        if not isinstance(v, list) or any(x not in options for x in v):
            raise Invalid("choice")
        return [k for k in options if k in v]
    return check


def _status_row(page: str) -> Callable[[Any], dict[str, Any]]:
    """A page's status row (settings.STATUS_ROWS): {status: what it shows, in
    its order; exclude_areas: the rooms it leaves out}. A key left out keeps
    its default."""
    kinds, default = S.STATUS_ROWS[page]
    status = _ordered(kinds)
    def check(v: Any) -> dict[str, Any]:
        if not isinstance(v, Mapping) or set(v) - {"status", "exclude_areas"}:
            raise Invalid("choice")
        return {"status": status(v.get("status", list(default))), "exclude_areas": _ids(v.get("exclude_areas"))}
    return check


def _header(page: str) -> Callable[[Any], dict[str, Any]]:
    """A page header's settings (settings.HEADERS): the whole page's dict,
    each key checked; a key left out keeps its default."""
    default = S.HEADERS[page]

    def ids_or_none(v: Any, *domains: str) -> list[str] | None:
        if v is None:
            return None
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise Invalid("list")
        if any(x.split(".", 1)[0] not in domains for x in v):
            raise Invalid("entity")
        return _entities(*domains)(v)

    def within(v: Any, lo_hi: tuple[int, int]) -> int:
        if isinstance(v, bool) or not isinstance(v, int) or not lo_hi[0] <= v <= lo_hi[1]:
            raise Invalid("range")
        return v

    def one_or_none(v: Any, *domains: str) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str) or not S.ENTITY_ID.match(v) or v.split(".", 1)[0] not in domains:
            raise Invalid("entity")
        return v

    def presets(v: Any) -> list[int]:
        lo, hi = S.HEADER_PRESETS
        if not isinstance(v, list) or not lo <= len(v) <= hi:
            raise Invalid("list")
        out = [within(x, S.HEADER_PRESET_MIN) for x in v]
        if len(set(out)) != len(out):
            raise Invalid("list")
        return out

    def names(v: Any) -> list[str]:
        if not isinstance(v, list) or len(v) > S.HEADER_NAMES:
            raise Invalid("list")
        if not all(isinstance(x, str) and 0 < len(x.strip()) <= S.HEADER_NAME_LEN for x in v):
            raise Invalid("text")
        return [x.strip() for x in v]

    def check(v: Any) -> dict[str, Any]:
        if not isinstance(v, Mapping) or set(v) - set(default):
            raise Invalid("choice")
        out = copy.deepcopy(default)
        for k, val in v.items():
            d = default[k]
            if k in ("show", "left_on", "tonight", "callouts", "sky_follow"):
                out[k] = _bool(val)
            elif k == "rooms":
                out[k] = within(val, S.HEADER_ROOMS)
            elif k == "after_min":
                out[k] = within(val, S.HEADER_AFTER)
            elif k == "low_battery":
                out[k] = within(val, S.HEADER_BATTERY)
            elif k == "thermostats":
                out[k] = ids_or_none(val, "climate")
            elif k == "automations":
                out[k] = ids_or_none(val, "automation")
            elif k == "sky_source":
                out[k] = ids_or_none(val, "switch")
            elif k == "exclude_areas":
                out[k] = None if val is None else _ids(val)
            elif k in ("front_door", "back_door", "garage"):
                out[k] = ids_or_none(val, "lock", "binary_sensor", "cover")
            elif k == "meter":
                out[k] = one_or_none(val, "sensor")
            elif k == "supply":
                out[k] = one_or_none(val, "valve", "switch")
            elif k == "counters":
                out[k] = ids_or_none(val, "sensor")
            elif k == "presets":
                out[k] = presets(val)
            elif k == "names":
                out[k] = names(val)
            else:  # pragma: no cover -- every key above
                out[k] = d
        return out
    return check


def _ordered(options: tuple[str, ...] | list[str]) -> Callable[[Any], list[str]]:
    """Some of `options`, each once, in the order given (the page's order)."""
    def check(v: Any) -> list[str]:
        if not isinstance(v, list) or any(x not in options for x in v):
            raise Invalid("choice")
        return list(dict.fromkeys(v))
    return check


def _text(limit: int, empty: Any = None) -> Callable[[Any], Any]:
    def check(v: Any) -> Any:
        if v is None:
            return empty
        if not isinstance(v, str) or len(v) > limit:
            raise Invalid("text")
        return v.strip() or empty
    return check


def _amount(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not S.AMOUNT[0] <= v <= S.AMOUNT[1]:
        raise Invalid("amount")
    return int(round(v))


def _saver_options(v: Any) -> dict[str, Any]:
    got = S.saver_options(v)
    if got is None:
        raise Invalid("saver_options")
    return got


def _sleep(v: Any) -> dict[str, Any]:
    got = SR.sleep_options(v)
    if got is None:
        raise Invalid("sleep")
    return got


def _saver_engine(v: Any) -> str:
    if v not in S.SAVER_ENGINES:
        raise Invalid("choice")
    return v


def _card_options(v: Any) -> dict[str, Any]:
    got = S.card_options(v)
    if got is None:
        raise Invalid("card_options")
    return got


def _weather_page(v: Any) -> dict[str, Any]:
    """The Weather page's composition (settings.weather_page), whole: any
    unknown key, wrong type or value refuses it."""
    got = S.weather_page(v)
    if got is None:
        raise Invalid("choice")
    return got


def _radar_native(v: Any) -> dict[str, Any]:
    """The native radar's settings (settings.radar_native), whole, as above."""
    got = S.radar_native(v)
    if got is None:
        raise Invalid("choice")
    return got


def _birthdays(v: Any) -> list[dict[str, Any]]:
    if not isinstance(v, list):
        raise Invalid("list")
    out = []
    for b in v:
        if not isinstance(b, Mapping):
            raise Invalid("birthday")
        name = str(b.get("name") or "").strip()
        try:
            month, day = int(b.get("month")), int(b.get("day"))
        except (TypeError, ValueError):
            raise Invalid("birthday") from None
        if not name or len(name) > 40 or not (1 <= month <= 12 and 1 <= day <= 31):
            raise Invalid("birthday")
        out.append({"name": name, "month": month, "day": day})
    return sorted(out, key=lambda b: (b["month"], b["day"], b["name"].lower()))


def _browse_view(v: Any) -> str:
    t = _text(60, "")(v)
    t = t.strip("/")
    if t and not re.fullmatch(r"[A-Za-z0-9_-]+", t):
        raise Invalid("path")
    return t


def _photos(v: Any) -> str:
    t = _text(300, "")(v)
    return t or S.DEFAULTS["look"]["photos"]


def _count(v: Any) -> dict[str, list[str]] | None:
    """One kind of Status & Chips: {exclude, include}, or None -- automatic."""
    if v is None:
        return None
    got = K.clean(v)
    if got is None:
        raise Invalid("count")
    return {k: _entities()(got[k]) for k in ("exclude", "include")}


def _board_headers(v: Any) -> dict[str, bool]:
    """A screen's own page headers (settings.board_headers): {page: False}
    for each it turns off; a page with no header, or any other value, is
    refused rather than dropped."""
    if not isinstance(v, Mapping) or any(k not in S.HEADERS or x is not False for k, x in v.items()):
        raise Invalid("choice")
    return S.board_headers(v)


def _sky_pages(v: Any) -> dict[str, str]:
    """Each page's background ({page: mode}); a page set to "" or None goes
    back to Automatic (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("choice")
    clean = {k: m for k, m in v.items() if m not in (None, "")}
    got = S.sky_pages(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("choice")
    return got


def _flat_color(none: bool) -> Callable[[Any], Any]:
    def check(v: Any) -> Any:
        if none and v in (None, ""):
            return None
        got = S.flat_color(v)
        if got is None:
            raise Invalid("choice")
        return got
    return check


def _flat_tint(v: Any, none: bool) -> str | None:
    if none and v in (None, ""):
        return None
    got = S.flat_tint(v)
    if got is None:
        raise Invalid("choice")
    return got


def _flat_image_look(v: Any) -> dict[str, Any]:
    got = S.flat_image_look(v, strict=True)
    if got is None:
        raise Invalid("choice")
    return got


def _flat_page_image_looks(v: Any) -> dict[str, Any]:
    got = S.flat_page_image_looks(v, strict=True)
    if got is None:
        raise Invalid("choice")
    return got


def image_patch(current: Mapping[str, Any], patch: Any) -> dict[str, Any]:
    """Patch only the edited fields over the current store, including removals."""
    if patch is None:
        return {}
    got = _flat_image_look(patch)
    out = dict(current)
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = got[k]
    return out


def image_pages_patch(current: Mapping[str, Any], key: str, patch: Any) -> dict[str, Any]:
    out = dict(current)
    got = image_patch(out.get(key, {}), patch)
    if got:
        out[key] = got
    else:
        out.pop(key, None)
    if len(out) > S.FLAT_PAGES_MAX:
        raise Invalid("choice")
    return out


def _flat_pages(v: Any) -> dict[str, str]:
    """Each page's Flat background ({page: color | photo | landscapes}); a
    page set to "" or None follows again (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("choice")
    clean = {k: m for k, m in v.items() if m not in (None, "")}
    got = S.flat_pages(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("choice")
    return got


# FLAT COLORS (settings.flat_colors): a whole object or map replaces what
# is stored (Copy Settings, a reset); a PATCH names its place --
#   look.flat_colors.accent / .off_tint          All Screens' one field
#   look.flat_page_colors.<page>                 {field: value | None}
#   flat_colors.accent, flat_page_colors.<page>  a screen's (board/set)
# and is made over the store as it is now, so two editors' changes to
# different pages, or to the other field, never undo each other. None
# removes a field (All Screens': back to Automatic), a page left empty goes.
def _flat_colors(v: Any) -> dict[str, str]:
    got = S.flat_colors(v, strict=True)
    if got is None:
        raise Invalid("accent")
    return got


def _flat_page_colors(v: Any) -> dict[str, dict[str, str]]:
    got = S.flat_page_colors(v, strict=True)
    if got is None:
        raise Invalid("accent")
    return got


def _flat_field(field: str, v: Any) -> str | None:
    if v in (None, ""):
        return None
    got = S.flat_field(field, v)
    if got is None:
        raise Invalid("accent")
    return got


def flat_patch(colors: Mapping[str, Any], patch: Any, fields: tuple = S.FLAT_COLOR_FIELDS) -> dict[str, str]:
    """`colors` (a sparse FlatColors) with `patch` made: each field set, or
    gone for None. Raises Invalid for a field or value that isn't one."""
    if not isinstance(patch, Mapping):
        raise Invalid("accent")
    out = dict(colors)
    for k, v in patch.items():
        if k not in fields:
            raise Invalid("accent")
        got = _flat_field(k, v)
        if got is None:
            out.pop(k, None)
        else:
            out[k] = got
    return out


def flat_pages_patch(pages: Mapping[str, Any], key: str, patch: Any) -> dict[str, dict[str, str]]:
    """Each page's Flat Colors with one page's `patch` made (None: the page
    follows again)."""
    if not S.FLAT_PAGE_KEY.match(key):
        raise Invalid("accent")
    out = {k: dict(v) for k, v in pages.items()}
    got = {} if patch is None else flat_patch(out.get(key, {}), patch, S.FLAT_PAGE_FIELDS)
    if got:
        out[key] = got
    else:
        out.pop(key, None)
    if len(out) > S.FLAT_PAGES_MAX:
        raise Invalid("accent")
    return out


def _chips_custom_show(v: Any) -> dict[str, str]:
    """Each custom chip's Show on a screen ({key: always | active}); "" or
    None: as written (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("choice")
    clean = {k: m for k, m in v.items() if m not in (None, "")}
    got = S.chips_custom_show(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("choice")
    return got


def _sky_photo(none: bool = True) -> Callable[[Any], Any]:
    """A background photo's address (settings.SKY_PHOTO), or None / "": none."""
    def check(v: Any) -> Any:
        if v in (None, ""):
            return None
        got = S.sky_photo(v)
        if got is None:
            raise Invalid("photo")
        return got
    return check


def _landscape(none: bool) -> Callable[[Any], Any]:
    """Which landscape (settings.sky_landscape); for a screen, None follows
    All Screens'."""
    def check(v: Any) -> Any:
        if v in (None, "") and none:
            return None
        got = S.sky_landscape(v)
        if got is None:
            raise Invalid("choice")
        return got
    return check


def _photo_look(none: bool) -> Callable[[Any], Any]:
    """A background photo's look (settings.photo_look); for a screen, None
    follows All Screens'."""
    def check(v: Any) -> Any:
        if v is None:
            if none:
                return None
            return dict(S.PHOTO_LOOK_DEFAULTS)
        got = S.photo_look(v)
        if got is None:
            raise Invalid("choice")
        return got
    return check


def _page_looks(v: Any) -> dict[str, dict[str, Any]]:
    """Each page's own photo look ({page: look}); a page set to "" or None
    has its screen's (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("choice")
    clean = {k: u for k, u in v.items() if u not in (None, "")}
    got = S.page_looks(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("choice")
    return got


def _sky_page_photos(v: Any) -> dict[str, str]:
    """Each page's own photo ({page: address}); a page set to "" or None
    has none (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("photo")
    clean = {k: u for k, u in v.items() if u not in (None, "")}
    got = S.sky_page_photos(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("photo")
    return got


def _parsed(parse: Callable[[Any], Any], empty: Any) -> Callable[[Any], Any]:
    """A value settings.py parses whole (Liveliness): None or {} is `empty`,
    anything it cannot parse refused."""
    def check(v: Any) -> Any:
        if v is None or v == {}:
            return empty
        got = parse(v)
        if got is None:
            raise Invalid("choice")
        return got
    return check


def _sky_stops(v: Any) -> dict[str, list[str]] | None:
    """A custom backdrop's stops ({day, night}: four "#rrggbb" each), or
    None: no stops of its own."""
    if v is None:
        return None
    got = S.sky_stops(v)
    if got is None:
        raise Invalid("stops")
    return got


# EVERY HOUSE SETTING THE PAGE CAN WRITE: "section.key" -> its check. (The
# sky's dates are checked against the hemisphere in apply_house.)
SENSOR = _entity("sensor")
PILL_COLORS = ("white", "yellow", "orange", "red", "pink", "purple", "blue", "teal", "mint", "green")


def _page_accents(v: Any) -> dict[str, str]:
    """Each page's highlight ({page: accent}); a page set to "" or None
    goes back to its default (left out)."""
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise Invalid("choice")
    clean = {k: c for k, c in v.items() if c not in (None, "")}
    got = S.page_accents(clean)
    if got is None or len(got) != len(clean):
        raise Invalid("accent")
    return got


def _page_pills(v: Any) -> dict[str, dict[str, str]]:
    """kind -> {name, icon, color}, each optional; an empty look is dropped."""
    if not isinstance(v, dict):
        raise Invalid("list")
    out: dict[str, dict[str, str]] = {}
    for kind, look in v.items():
        if kind not in S.SCENE_PAGES or not isinstance(look, dict) or set(look) - {"name", "icon", "color"}:
            raise Invalid("choice")
        one: dict[str, str] = {}
        name = str(look.get("name") or "").strip()
        if len(name) > 40:
            raise Invalid("text")
        if name:
            one["name"] = name
        icon = str(look.get("icon") or "").strip()
        if icon and not re.fullmatch(r"(mdi|hk):[a-z0-9-]+", icon):
            raise Invalid("icon")
        if icon:
            one["icon"] = icon
        color = look.get("color") or ""
        if color and color not in PILL_COLORS:
            raise Invalid("choice")
        if color:
            one["color"] = color
        if one:
            out[kind] = one
    return out


def _calendar_colors(v: Any) -> dict[str, str]:
    """calendar entity -> a pill colour; an empty colour is dropped."""
    if not isinstance(v, dict):
        raise Invalid("list")
    one = _entity("calendar")
    out: dict[str, str] = {}
    for ent, color in v.items():
        ent = one(ent)
        if color in (None, ""):
            continue
        if color not in PILL_COLORS:
            raise Invalid("choice")
        out[ent] = color
    return out


CAL_KEYWORDS = 30
CAL_EVENT_COLORS = 500


def _calendar_keywords(v: Any) -> list[dict[str, str]]:
    """[{word, color}]: a word (1-40 characters) and a pill colour each."""
    if not isinstance(v, list) or len(v) > CAL_KEYWORDS:
        raise Invalid("list")
    out: list[dict[str, str]] = []
    for one in v:
        if not isinstance(one, dict) or set(one) - {"word", "color"}:
            raise Invalid("choice")
        word, color = one.get("word"), one.get("color")
        if not isinstance(word, str) or not 0 < len(word.strip()) <= 40:
            raise Invalid("text")
        if color not in PILL_COLORS:
            raise Invalid("choice")
        out.append({"word": word.strip(), "color": color})
    return out


def calendar_event_colors(v: Any) -> dict[str, str]:
    """an event's key ("uid:..." / "title:...") -> a pill colour."""
    if not isinstance(v, dict) or len(v) > CAL_EVENT_COLORS:
        raise Invalid("list")
    out: dict[str, str] = {}
    for k, color in v.items():
        if not isinstance(k, str) or not k.startswith(("uid:", "title:")) or len(k) > 240:
            raise Invalid("choice")
        if color not in PILL_COLORS:
            raise Invalid("choice")
        out[k] = color
    return out


HOUSE: dict[str, Callable[[Any], Any]] = {
    "security.alarm": _entity("alarm_control_panel"),
    "features.temperature": SENSOR,
    "features.power": SENSOR,
    "features.house_timers": _entities("timer"),
    "features.vacuum_script": _entity("script"),
    "features.alarm_bad_code": _entity("input_boolean", "binary_sensor"),
    "clock.time": SENSOR,
    "clock.date": SENSOR,
    "weather.entity": _entity("weather"),
    "weather.place": _text(60),
    **{f"weather.{k}": SENSOR for k in ("feels_like", "humidity", "wind", "gust", "uv", "forecast_daily",
                                        "forecast_hourly", "alerts", "outside")},
    "weather.radar": _card_options,
    "weather.page": _weather_page,
    "weather.radar_native": _radar_native,
    "calendar.entities": _entities("calendar"),
    "calendar.colors": _calendar_colors,
    "calendar.keywords": _calendar_keywords,
    "calendar.event_colors": calendar_event_colors,
    "look.glass": _choice(S.GLASS),
    "look.flat": _bool,
    "look.flat_theme": _choice(("light", "dark")),
    "look.frost": _amount,
    "look.frost_tint": _bool,
    "look.blur": _amount,
    "look.tint": _amount,
    "look.bright": _amount,
    "look.well": _choice(S.WELLS),
    "look.tile_style": _choice(S.TILE_STYLES),
    "look.details": _bool,
    "look.sky_switch": _entity("input_boolean", "switch"),
    "look.photos": _photos,
    "look.saver": _saver_options,
    "look.browse_view": _browse_view,
    "look.page_pills": _page_pills,
    "look.page_accents": _page_accents,
    "look.flat_colors": lambda v: {**S.FLAT_COLORS_DEFAULT, **_flat_colors(v)},
    "look.flat_page_colors": _flat_page_colors,
    "menu.glyph": _choice(S.MENU_GLYPHS),
    "menu.clock": _bool,
    # All Screens' menu (settings.MENU_KEYS): every screen that doesn't set its own
    "menu.style": _choice(S.MENU_STYLES),
    "menu.page_header": _choice(S.PAGE_HEADERS),
    "menu.tab_at": lambda v: _tab_position(v),
    "menu.tab_size": _choice(S.BOARD_TAB_SIZES),
    "menu.tab_size_phone": _choice(S.BOARD_TAB_SIZES),
    "menu.open_min": lambda v: _dock_min(v),
    "menu.time_weather_at": _choice(S.BOARD_TIME),
    "menu.ha_row": _bool,
    "menu.ha_at": _choice(S.HA_PLACES),
    "menu.swipe": _bool,
    "menu.accent": lambda v: _accent(v),
    # ...and its tab bar's
    "menu.bar_scroll": _choice(S.TAB_BAR_SCROLLS),
    "menu.bar_rooms": lambda v: _rooms_place(v),
    "menu.bar_glass": _choice(S.TAB_BAR_GLASS),
    "menu.bar_more": _choice(S.TAB_BAR_MORE),
    "menu.bar_more_phone": _choice(S.TAB_BAR_MORE),
    "menu.bar_pos": _choice(S.TAB_BAR_POS),
    "menu.bar_fold": _choice(S.TAB_BAR_FOLD),
    "menu.bar_start": _choice(S.TAB_BAR_START),
    "menu.bar_adjust": _bool,
    "menu.bar_scroll_phone": _choice(S.TAB_BAR_SCROLLS),
    "menu.bar_tabs": lambda v: _tabs(v),
    "menu.bar_size": _choice(S.TAB_BAR_SIZES),
    "menu.bar_labels": _choice(S.TAB_BAR_LABELS),
    "menu.bar_strip": _bool,
    "menu.bar_tabs_rail": lambda v: _tabs(v),
    "menu.bar_tabs_phone": lambda v: _tabs(v, S.TAB_BAR_TABS_PHONE),
    # Swipe Between Pages, All Screens' (a screen's swipe_pages over it)
    "menu.swipe_pages": _choice(S.SWIPE_PAGES),
    # ...and Phones' own (None: as before phones had their own)
    "menu.button_phone": _choice(S.BOARD_BUTTON_PHONE),
    "menu.bar_rooms_phone": lambda v: _rooms_place(v),
    "rooms.headings": _bool,
    "rooms.status": _ordered(S.STATUS_KINDS),
    **{f"status_rows.{p}": _status_row(p) for p in S.STATUS_ROWS},
    **{f"headers.{p}": _header(p) for p in S.HEADERS},
    "rooms.order": _ids,
    # All Screens' cameras (settings.resolved): every screen that doesn't set its own
    "cameras.order": _entities("camera"),
    "cameras.live": _bool,
    "cameras.focus_pause": _bool,
    "rooms.home": _choice(S.BOARD_HOME_ROOMS),
    "rooms.menu": _choice(S.BOARD_MENU_ROOMS),
    "rooms.pages": _choice(S.BOARD_PAGE_ROOMS),
    "now_playing.style": _choice(S.NP_STYLES),
    "now_playing.side": _choice(S.NP_SIDES),
    "now_playing.bar": _choice(S.NP_BARS),
    "now_playing.bar_phone": _choice(S.NP_BARS),
    "now_playing.grace": lambda v: _choice(S.NP_GRACES)(None if isinstance(v, bool) else v),
    "browse.hide": _subset(S.BROWSE_CATEGORIES),
    "browse.discover": _ordered(list(S.SHELVES)),
    "generated.exclude_areas": _ids,
    "generated.exclude_devices": _ids,
    "generated.exclude_entities": _entities(),
    "generated.include_entities": _entities(),
    "sky.decorations": _bool,
    "sky.decoration_style": _choice(("old", "new")),
    "sky.moving": _choice(S.SKY_MOVING),
    "sky.cloud_style": _choice(S.CLOUD_STYLES),
    "sky.daytime": _choice(S.DAYTIME_SKIES),
    "sky.woodland": _subset(S.WOODLAND_SEASONS),
    "sky.animations": _bool,
    "sky.weather": _bool,
    "sky.precipitation": _bool,
    "sky.focus_pause": _bool,
    "sky.gradient": _choice(S.SKY_BACKDROP_IDS),
    "sky.pages": _sky_pages,
    "sky.gradient_custom": _sky_stops,
    "sky.background": _choice(S.SKY_BACKGROUNDS),
    "sky.color": _choice(S.SKY_COLOR_IDS),
    "sky.photo": _sky_photo(),
    "sky.page_photos": _sky_page_photos,
    "sky.photo_look": _photo_look(False),
    "sky.landscape": _landscape(False),
    "sky.landscape_look": _photo_look(False),
    "sky.wallpaper": _choice(S.WALLPAPERS),
    "sky.wallpaper_night": _choice(S.WALLPAPER_NIGHT),
    "sky.page_looks": _page_looks,
    "sky.flat_background": _choice(S.FLAT_BACKGROUNDS),
    "sky.flat_color": _flat_color(False),
    "sky.flat_fade": _amount,
    "sky.flat_tint": lambda v: _flat_tint(v, False),
    "sky.flat_tint_amount": _amount,
    "sky.flat_tint_light": _amount,
    "sky.flat_pages": _flat_pages,
    "sky.flat_image_look": _flat_image_look,
    "sky.flat_page_image_looks": _flat_page_image_looks,
    "sky.image_look": _flat_image_look,
    "sky.themes": _subset(S.THEMES),
    "sky.hemisphere": _choice(("north", "south")),
    "sky.moon": SENSOR,
    "sky.holidays": SENSOR,
    "sky.seasonal": _entity("input_boolean", "switch"),
    "sky.birthdays": _birthdays,
    "sky.liveliness_all": _choice(S.LIVELY_PRESETS),
    "sky.liveliness": _parsed(S.lively, empty={}),
    "sky.liveliness_custom": _parsed(S.lively_custom, empty={}),
    **{f"sky.{k}": _choice(v, none=True) for k, v in S.SKY_OFTEN.items()},
    **{f"counts.{k}": _count for k in K.KINDS},
}
HOUSE.update({
    # ALL TABLETS (settings DEFAULTS["tablets"])
    "tablets.idle_return": _bool,
    "tablets.idle_time": lambda v: _idle_time(v, none=False),
    "tablets.alert_offline": _bool,
    "tablets.alert_restart": _bool,
    "tablets.alert_charging": _bool,
    "tablets.restart": _bool,
    "tablets.restart_times": lambda v: _restart_times(v),
    "tablets.dismissed": lambda v: _keys(v),
})
# THE SIDE PANE (settings.side_pane): All Screens' groups, each whole -- a
# Dashboard or Screensaver group is what it shows and its sections together
def _pane_group(name: str) -> Callable[[Any], Any]:
    def check(v: Any) -> Any:
        got = S.pane_group(name, v, strict=True)
        if got is None:
            raise Invalid("choice" if name in ("side", "width") else "bool" if name == "doorbell" else "side_pane")
        return got
    return check


HOUSE.update({f"side_pane.{g}": _pane_group(g) for g in S.PANE_GROUPS})
# (a patch of Flat's image look, the Glass looks' (image_look), or one page's Flat image look)
IMAGE_HOUSE = re.compile(r"^sky\.(flat_image_look|image_look)\.patch$|^sky\.flat_page_image_looks\.([a-z0-9][a-z0-9_-]{0,39})$")
FLAT_HOUSE = re.compile(r"^look\.flat_colors\.(accent|off_tint|pages)$|^look\.flat_page_colors\.([a-z0-9][a-z0-9_-]{0,39})$")
SKY_DATE = re.compile(r"^sky\.(" + "|".join(S.SKY_BUILT_IN) + r")_(from|to)$")


# Options of the integration itself, beside `dashboard` (a host adds its own: apply_house's `top`).
TOP: dict[str, Callable[[Any], Any]] = {"sidebar": _bool}


def apply_house(options: Mapping[str, Any], changes: Mapping[str, Any],
                checks: Mapping[str, Callable[[Any], Any]] | None = None
                ) -> tuple[dict[str, Any], dict[str, str]]:
    """The options with `changes` made, and any refusals (path -> code).
    Nothing is made when anything is refused. `checks`: the integration's own
    options beside `dashboard` (default TOP)."""
    own = TOP if checks is None else checks
    errors: dict[str, str] = {}
    now = S.merged(options)
    dash = {k: dict(v) if isinstance(v, Mapping) else v
            for k, v in (options.get(S.CONF_DASHBOARD) or {}).items()}
    top: dict[str, Any] = {}
    hemi = changes.get("sky.hemisphere", now["sky"].get("hemisphere") or "north")
    if hemi not in ("north", "south"):
        hemi = "north"
    for path, value in changes.items():
        try:
            if path in own:
                top[path] = own[path](value)
                continue
            # SKY / BACKGROUND'S RESET TO DEFAULTS: its settings (S.SKY_RESET)
            # leave the store, so each is its default again; the Pages stay
            if path == "sky.reset":
                if value is not True:
                    raise Invalid("choice")
                cur = dash.get("sky") if isinstance(dash.get("sky"), dict) else {}
                dash["sky"] = S.house_stored("sky", {k: v for k, v in cur.items()
                                                     if k in now["sky"] and k not in S.SKY_RESET})
                continue
            im = IMAGE_HOUSE.fullmatch(path)
            if im:
                # Include earlier whole-object, legacy, or reset edits in
                # this same transaction, not just the pre-transaction view.
                sk = dict(S.merged({**dict(options), S.CONF_DASHBOARD: dash})["sky"])
                field = im.group(1) or "flat_page_image_looks"
                sk[field] = image_pages_patch(sk[field], im.group(2), value) if im.group(2) else image_patch(sk[field], value)
                now["sky"] = sk
                dash["sky"] = S.house_stored("sky", sk)
                continue
            # FLAT COLORS' PATCHES (flat_patch): made over the store as it is
            fm = FLAT_HOUSE.match(path)
            if fm:
                lk = dash.get("look") if isinstance(dash.get("look"), dict) else {}
                lk = {**now["look"], **{k: v for k, v in lk.items() if k in now["look"]}}
                if fm.group(1):
                    lk["flat_colors"] = {**S.FLAT_COLORS_DEFAULT,
                                         **flat_patch(lk["flat_colors"], {fm.group(1): value})}
                else:
                    lk["flat_page_colors"] = flat_pages_patch(lk["flat_page_colors"], fm.group(2), value)
                now["look"] = lk
                dash["look"] = S.house_stored("look", lk)
                continue
            m = SKY_DATE.match(path)
            if m:
                got = S.sky_date(m.group(1), m.group(2), value, hemi)
                if got is False:
                    raise Invalid("date")
            elif path in HOUSE:
                got = HOUSE[path](value)
            else:
                raise Invalid("unknown")
        except Invalid as err:
            errors[path] = err.code
            continue
        section, key = path.split(".", 1)
        # the section as merged (so every key is there), then this key; a
        # stored key the settings no longer have (from an older version) goes
        # (only what differs from its default is stored: settings.only_set)
        cur = dash.get(section) if isinstance(dash.get(section), dict) else {}
        dash[section] = S.house_stored(section, {**{k: v for k, v in cur.items() if k in now[section]}, key: got})
        if section == "counts":
            # A kind saved now is no longer read from its older list
            # (kinds.LEGACY): keeping it would be a second answer nobody
            # reads, so it is emptied.
            where = K.LEGACY.get(key)
            if where and got is not None:
                old = dash.get(where[0]) if isinstance(dash.get(where[0]), dict) else {}
                dash[where[0]] = S.house_stored(where[0], {**{k: v for k, v in old.items() if k in now[where[0]]}, where[1]: []})
    if errors:
        return dict(options), errors
    return {**options, **top, S.CONF_DASHBOARD: dash}, {}


# ------------------------------------------------------------ one screen
def _tabs(v: Any, span: tuple[int, int] = S.TAB_BAR_TABS) -> int:
    """Tabs in Bar / Rail: pages, a whole number from 2 to 8 (a phone's: `span`, TAB_BAR_TABS_PHONE)."""
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        raise Invalid("choice")
    try:
        n = int(v)
    except ValueError as err:
        raise Invalid("choice") from err
    if n != float(v) or not span[0] <= n <= span[1]:
        raise Invalid("choice")
    return n


def _rooms_place(v: Any) -> str:
    """The tab bar's Rooms: In More, a button of their own, or off (a
    boolean, from the first form, is read as the settings read it)."""
    if isinstance(v, bool) or v in S.TAB_BAR_ROOMS:
        return S.tab_bar_rooms(v)
    raise Invalid("choice")


def _tab_position(v: Any) -> str:
    t = S.tab_position(v)
    if t is None:
        raise Invalid("tab_position")
    return t


def _accent(v: Any) -> str:
    t = S.accent(v)
    if t is None:
        raise Invalid("accent")
    return t


def _dock_min(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not S.DOCK_MIN[0] <= v <= S.DOCK_MIN[1]:
        raise Invalid("dock_min")
    return int(v)


def _room(v: Any) -> str:
    t = str(v or "").strip().lower()
    if t and not re.fullmatch(r"[a-z0-9_]+", t):
        raise Invalid("bad_room")
    return t


def _user(v: Any) -> str:
    t = str(v or "").strip()
    if t and not re.fullmatch(r"[A-Za-z0-9_.@ -]{1,64}", t):
        raise Invalid("user")
    return t


def _amount_or_none(v: Any) -> int | None:
    return None if v is None else _amount(v)


def _bool_or_none(v: Any) -> bool | None:
    return None if v is None else _bool(v)


def _chip_keys(v: Any) -> list[str]:
    """The custom chips a screen shows (their keys)."""
    if not isinstance(v, list) or not all(isinstance(x, str) and S.CHIP_KEY.match(x) for x in v):
        raise Invalid("list")
    return list(dict.fromkeys(v))


def _views(v: Any) -> list[str]:
    """View paths (the menu's pages)."""
    if not isinstance(v, list) or not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", x) for x in v):
        raise Invalid("list")
    return list(dict.fromkeys(v))


def _chips(v: Any) -> list[str]:
    if not isinstance(v, list) or any(not (x in S.CHIP_KINDS or (isinstance(x, str) and ENTITY.match(x))
                                           or (isinstance(x, str) and x.startswith(S.CHIP_TOKEN)
                                               and S.CHIP_KEY.match(x[len(S.CHIP_TOKEN):])))
                                      for x in v):
        raise Invalid("choice")
    return list(dict.fromkeys(v))


def _scenes(v: Any) -> list[str]:
    ok = lambda x: isinstance(x, str) and (ENTITY.match(x) or (  # noqa: E731
        x.startswith(S.SCENE_PAGE) and x[len(S.SCENE_PAGE):] in S.SCENE_PAGES))
    if not isinstance(v, list) or not all(ok(x) for x in v):
        raise Invalid("choice")
    return list(dict.fromkeys(v))


def _pages(v: Any) -> list[str]:
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise Invalid("list")
    got = S.page_order(v)
    if len(got) != len(dict.fromkeys(v)):
        raise Invalid("choice")
    return got


def _home_view(v: Any) -> str:
    """A screen's Home: "" (the generated one) or a custom page's address."""
    if v in (None, ""):
        return ""
    if not isinstance(v, str) or not S.PAGE_PATH.match(v):
        raise Invalid("choice")
    return v


def _car_width(v: Any) -> int | None:
    """A car's layout width (settings.car_width); None: the default."""
    if v in (None, ""):
        return None
    got = S.car_width(v)
    if got is None:
        raise Invalid("car_width")
    return got


def _custom_pages(v: Any) -> list[str]:
    if not isinstance(v, list) or not all(isinstance(x, str) and S.PAGE_PATH.match(x) for x in v):
        raise Invalid("list")
    return list(dict.fromkeys(v))


def _dnd(v: Any) -> dict[str, Any] | None:
    """Do Not Disturb hours (settings.notify_dnd); None follows All Screens."""
    if v is None:
        return None
    if not isinstance(v, dict) or set(v) - {"schedule", "from", "to", "while"}:
        raise Invalid("unknown")
    if any(v.get(k) not in (None, "") and S.hhmm(v.get(k)) is None for k in ("from", "to")):
        raise Invalid("time")
    w = v.get("while") or []
    if not isinstance(w, list) or len(w) > S.DND_MAX or not all(isinstance(x, str) and S.ENTITY_ID.match(x) for x in w):
        raise Invalid("entity")
    return S.notify_dnd(v)


def _home_grid(v: Any) -> dict[str, Any] | None:
    """A screen's Home Grid layout (home_grid.check), written whole; None takes it away."""
    try:
        return HG.check(v)
    except HG.GridInvalid as err:
        raise Invalid(err.code) from None


BOARD: dict[str, Callable[[Any], Any]] = {
    "menu": _choice(S.BOARD_MENUS),
    "home_style": _choice(HG.HOME_STYLES),
    "home_grid": _home_grid,
    "phone_header": _choice(S.BOARD_PHONE),
    "chips_custom": _chip_keys,
    "chips_custom_show": _chips_custom_show,
    "menu_top": _views,
    "dock_min": _dock_min,
    "time_weather": _choice(S.BOARD_TIME),
    "ha_row": _bool,
    "ha_place": _choice(S.HA_PLACES),
    "categories": _views,
    "tab_position": _tab_position,
    "tab_size": _choice(S.BOARD_TAB_SIZES),
    "tab_size_phone": _choice(S.BOARD_TAB_SIZES),
    "room_order": _ids,
    "menu_rooms": _choice(S.BOARD_MENU_ROOMS),
    "home_rooms": _choice(S.BOARD_HOME_ROOMS),
    "rooms_custom": _bool,
    "cameras_custom": _bool,
    # (before entry 1.17: all of the menu or none; an older page's write is
    # read as all or none of menu_own -- apply_board)
    "menu_custom": _bool,
    "menu_own": lambda v: _menu_own(v),
    "page_header": _choice(S.PAGE_HEADERS),
    "accent": _accent,
    "glyph": _choice(S.MENU_GLYPHS),
    "clock": _bool,
    "swipe": _bool,
    "tab_bar_scroll": _choice(S.TAB_BAR_SCROLLS),
    "tab_bar_rooms": lambda v: _rooms_place(v),
    "tab_bar_glass": _choice(S.TAB_BAR_GLASS),
    "tab_bar_more": _choice(S.TAB_BAR_MORE),
    "tab_bar_more_phone": _choice(S.TAB_BAR_MORE),
    "tab_bar_pos": _choice(S.TAB_BAR_POS),
    "tab_bar_fold": _choice(S.TAB_BAR_FOLD),
    "tab_bar_start": _choice(S.TAB_BAR_START),
    "tab_bar_adjust": _bool,
    "tab_bar_scroll_phone": _choice(S.TAB_BAR_SCROLLS),
    "tab_bar_tabs": _tabs,
    "tab_bar_size": _choice(S.TAB_BAR_SIZES),
    "tab_bar_labels": _choice(S.TAB_BAR_LABELS),
    "tab_bar_strip": _bool,
    "tab_bar_tabs_rail": _tabs,
    "tab_bar_tabs_phone": lambda v: _tabs(v, S.TAB_BAR_TABS_PHONE),
    # Swipe Between Pages, this screen's own; None: Same as All Screens
    "swipe_pages": _choice(S.SWIPE_PAGES, none=True),
    "menu_phone": _choice(S.BOARD_PHONE_MENUS, none=True),
    "button_phone": _choice(S.BOARD_BUTTON_PHONE),
    "tab_bar_rooms_phone": lambda v: _rooms_place(v),
    "page_rooms": _choice(S.BOARD_PAGE_ROOMS),
    "chips_row": _bool,
    "chips": _chips,
    "chips_quiet": _subset(S.CHIP_KINDS),
    "chips_extra": _entities(),
    "camera_strip": _bool,
    "cameras": _entities("camera"),
    "camera_live": lambda v: _entity("input_select", "select")(v) or "",
    "scenes_row": _bool,
    "scenes": _scenes,
    "scenes_pages": _ordered(S.SCENE_PAGES),
    "favorites": _entities(),
    "pages": _pages,
    "only_pages": _pages,
    "custom_pages": _custom_pages,
    "home_page": _bool,
    "home_view": _home_view,
    "glass": _choice(S.BOARD_GLASS),
    "flat": _bool_or_none,
    "flat_theme": _choice(("light", "dark"), none=True),
    "frost": _amount_or_none,
    "frost_tint": _bool_or_none,
    "blur": _amount_or_none,
    "tint": _amount_or_none,
    "bright": _amount_or_none,
    "well": _choice(S.WELLS, none=True),
    "tile_style": _choice(S.TILE_STYLES, none=True),
    "sky": _bool,
    # this screen's own Sky / Background; None: follow All Screens
    "sky_animations": _bool_or_none,
    "sky_weather": _bool_or_none,
    "sky_precipitation": _bool_or_none,
    "sky_focus_pause": _bool_or_none,
    "camera_live_video": _bool_or_none,
    "sky_decorations": _bool_or_none,
    "sky_decoration_style": _choice(("old", "new"), none=True),
    "sky_moving": _choice(S.SKY_MOVING, none=True),
    "sky_cloud_style": _choice(S.CLOUD_STYLES, none=True),
    "sky_daytime": _choice(S.DAYTIME_SKIES, none=True),
    "sky_gradient": _choice(S.SKY_BACKDROP_IDS, none=True),
    "sky_pages": _sky_pages,
    "headers": _board_headers,
    "sky_custom": _sky_stops,
    "sky_background": _choice(S.SKY_BACKGROUNDS, none=True),
    "sky_color": _choice(S.SKY_COLOR_IDS, none=True),
    "sky_photo": _sky_photo(),
    "sky_page_photos": _sky_page_photos,
    "sky_photo_look": _photo_look(True),
    "sky_landscape": _landscape(True),
    "sky_landscape_look": _photo_look(True),
    "sky_wallpaper": _choice(S.WALLPAPERS, none=True),
    "sky_wallpaper_night": _choice(S.WALLPAPER_NIGHT, none=True),
    "sky_flat_background": _choice(S.FLAT_BACKGROUNDS, none=True),
    "sky_flat_color": _flat_color(True),
    "sky_flat_fade": _amount_or_none,
    "sky_flat_tint": lambda v: _flat_tint(v, True),
    "sky_flat_tint_amount": _amount_or_none,
    "sky_flat_tint_light": _amount_or_none,
    "sky_flat_pages": _flat_pages,
    "sky_flat_image_look": _flat_image_look,
    "sky_flat_page_image_looks": _flat_page_image_looks,
    "sky_image_look": _flat_image_look,
    "flat_colors": _flat_colors,
    "flat_page_colors": _flat_page_colors,
    "sky_page_looks": _page_looks,
    "sky_liveliness": _choice(S.LIVELY_PRESETS, none=True),
    "sky_liveliness_occ": _parsed(S.lively, empty={}),
    "sky_liveliness_custom": _parsed(S.lively_custom, empty={}),
    "sky_calm_empty": _bool,
    "car": _bool,
    "car_layout": _choice(S.CAR_LAYOUTS),
    "car_width": _car_width,
    "kiosk": _bool,
    "kiosk_header": _bool,
    "kiosk_sidebar": _bool,
    "kiosk_admins": _bool,
    "kiosk_engine": _choice(S.KIOSK_ENGINES),
    "popups": _bool,
    "notify": _bool,
    "notify_saver": _choice(S.NOTIFY_SAVERS, none=True),
    "notify_dnd": _dnd,
    "now_playing": _bool,
    "timer_bar": _bool,
    "bar_all_pages": _bool,
    "np_style": _choice(S.NP_STYLES, none=True),
    "np_side": _choice(S.NP_SIDES, none=True),
    "np_bar": _choice(S.NP_BARS, none=True),
    "np_bar_phone": _choice(S.NP_BARS, none=True),
    "screensaver": _bool,
    "wallpanel_options": _card_options,
    "kiosk_options": _card_options,
    # null: follow the settings for All Screens
    "screensaver_options": lambda v: None if v is None else _saver_options(v),
    "screensaver_engine": _saver_engine,
}


# THE PAGES SCREEN (model.pages_screen, Phase J): All Screens' a field at a time; a screen's whole -- the fields it
# sets, or None (Same as All Screens)
def _pages_field(field: str) -> Callable[[Any], Any]:
    def check(v: Any) -> Any:
        got = S.PAGES_SCREEN_CHECKS[field](v)
        if got is None:
            raise Invalid("choice")
        return got
    return check


def _pages_screen(v: Any) -> dict[str, Any] | None:
    if v is None:
        return None
    got = S.pages_screen_own(v, strict=True)
    if got is None:
        raise Invalid("choice")
    return got or None


HOUSE.update({f"pages_screen.{k}": _pages_field(k) for k in S.PAGES_SCREEN_DEFAULTS})
BOARD["pages_screen"] = _pages_screen


# A SCREEN'S SIDE PANE: its own groups, whole (settings.side_pane_own); null,
# or an object setting none, is Same as All Screens in everything
def _side_pane_own(v: Any) -> dict[str, Any] | None:
    try:
        return S.side_pane_own(v, strict=True)
    except ValueError:
        raise Invalid("side_pane") from None


BOARD["side_pane"] = _side_pane_own


# ------------------------------------------------------------ a wall tablet
def _idle_time(v: Any, none: bool = True) -> int | None:
    if v is None and none:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or v not in S.IDLE_TIMES:
        raise Invalid("choice")
    return v


def _restart_times(v: Any) -> list[str]:
    if not isinstance(v, list) or not 1 <= len(v) <= S.RESTART_TIMES_MAX:
        raise Invalid("list")
    out = []
    for t in v:
        hm = S.hhmm(t)
        if hm is None:
            raise Invalid("time")
        out.append(hm)
    return sorted(dict.fromkeys(out))


def _keys(v: Any) -> list[str]:
    if not isinstance(v, list) or len(v) > 200 or not all(isinstance(k, str) and 0 < len(k) <= 200 for k in v):
        raise Invalid("list")
    return list(dict.fromkeys(v))


def _tablet_name(v: Any) -> str:
    t = str(v or "").strip()
    if not t or len(t) > 40:
        raise Invalid("name_needed")
    return t


def _screen(v: Any) -> str:
    t = str(v or "").strip()
    if t and not re.fullmatch(r"[a-z0-9_-]{1,80}", t):
        raise Invalid("choice")
    return t


def _device(v: Any) -> str:
    t = str(v or "").strip()
    if t and not S.DEVICE_ID.match(t):
        raise Invalid("device")
    return t


def _bool_none(v: Any) -> bool | None:
    if v is None:
        return None
    return _bool(v)


TABLET: dict[str, Callable[[Any], Any]] = {
    "name": _tablet_name,
    "screen": _screen,
    "room": _room,
    "user": _user,
    "app": _choice(S.TABLET_APPS),
    "device": _device,
    "idle_return": _bool_none,
    "idle_time": _idle_time,
    "black_screen": _choice(S.BLACK_SCREENS),
    "sleep": _sleep,
}


def apply_tablet(data: Mapping[str, Any], changes: Mapping[str, Any], tid: str
                 ) -> tuple[dict[str, Any], dict[str, str]]:
    """One tablet's settings with `changes` made (then settings.tablet()),
    and any refusals."""
    errors: dict[str, str] = {}
    clean: dict[str, Any] = {}
    for key, value in changes.items():
        try:
            if key not in TABLET:
                raise Invalid("unknown")
            clean[key] = TABLET[key](value)
        except Invalid as err:
            errors[key] = err.code
    if errors:
        return S.tablet(data, tid), errors
    return S.tablet({**dict(data), **clean}, tid), {}


IMAGE_BOARD = re.compile(r"^(sky_flat_image_look|sky_image_look)\.patch$|^sky_flat_page_image_looks\.([a-z0-9][a-z0-9_-]{0,39})$")
FLAT_BOARD = re.compile(r"^flat_colors\.(accent|off_tint|pages)$|^flat_page_colors\.([a-z0-9][a-z0-9_-]{0,39})$")


def _menu_own(v: Any) -> list[str]:
    """Which menu settings a screen owns (settings.MENU_KEYS), in their order."""
    if not isinstance(v, list) or not all(isinstance(k, str) and k in S.MENU_KEYS for k in v):
        raise Invalid("choice")
    return [k for k in S.MENU_KEYS if k in v]


def apply_board(data: Mapping[str, Any], changes: Mapping[str, Any]
                ) -> tuple[dict[str, Any], dict[str, str]]:
    """One screen's settings with `changes` made (then settings.board(), as
    every write of an item), and any refusals."""
    errors: dict[str, str] = {}
    clean: dict[str, Any] = {}
    now = S.board(data)
    for key, value in changes.items():
        try:
            im = IMAGE_BOARD.fullmatch(key)
            if im:
                field = im.group(1) or "sky_flat_page_image_looks"
                current = clean.get(field, now[field])
                clean[field] = image_pages_patch(current, im.group(2), value) if im.group(2) else image_patch(current, value)
                continue
            fm = FLAT_BOARD.match(key)
            if fm:
                # a patch (flat_patch), over this call's earlier changes
                if fm.group(1):
                    clean["flat_colors"] = flat_patch(clean.get("flat_colors", now["flat_colors"]), {fm.group(1): value})
                else:
                    clean["flat_page_colors"] = flat_pages_patch(clean.get("flat_page_colors", now["flat_page_colors"]),
                                                                 fm.group(2), value)
                continue
            if key not in BOARD:
                raise Invalid("unknown")
            clean[key] = BOARD[key](value)
        except Invalid as err:
            errors[key] = err.code
    if errors:
        return S.board(data), errors
    if "menu_custom" in clean:
        # an older page's Same as All Screens switch: every menu setting, or none
        clean.setdefault("menu_own", list(S.MENU_KEYS) if clean.pop("menu_custom") else [])
    out = S.board({**dict(data), **clean})
    if "home_grid" not in clean and "home_grid" in data:
        # a save that doesn't touch the grid keeps it as stored: board() reads it the tolerant way (a block or
        # option this build doesn't know is left out), and storing THAT would delete it for good
        out["home_grid"] = data["home_grid"]
    return out, {}
