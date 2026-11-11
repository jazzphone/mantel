"""model.py's dashboards (a screen's settings and their checks) (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
import copy
import re
from typing import Any
from ...notifications.dnd import notify_dnd
from .. import home_grid as HG
from ..looks import IDS as LOOK_IDS
from .schema import (AMOUNT, board_headers, board_wallpaper, BRIGHT_DIM_MAX, BRIGHT_GLASS, BRIGHT_PAGES,
    chips_custom_show, CLOUD_STYLES, DAYTIME_SKIES, DOCK_MIN, FLAT_BACKGROUNDS, flat_color, flat_colors,
    flat_image_look, flat_page_colors, flat_page_image_looks, flat_pages, flat_tint, lively, lively_custom,
    LIVELY_PRESETS, MENU_GLYPHS, NOTIFY_SAVERS, NP_BARS, NP_SIDES, NP_STYLES, page_looks, photo_look, RETIRED_GLASS,
    SKY_BACKDROP_IDS, SKY_BACKGROUNDS, SKY_COLOR_IDS, sky_landscape, SKY_MOVING, sky_page_photos, sky_pages,
    sky_photo, sky_stops, tab_position, TILE_ICONS, TILE_STYLES, WALLPAPER_MOTION, WALLPAPER_NIGHT, WELLS,)
from .defaults import KIOSK_ENGINES, SAVER_DEFAULTS, SAVER_ENGINES
from .pages_screen_rules import pages_screen_own
from .saver_rules import card_options, saver_options
from .side_pane_rules import side_pane_own


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
              "timers", "vacuums", "laundry", "speakers", "water", "energy")

CHIPS_QUIET = ["weather_alert", "doors_windows", "blinds", "laundry", "water"]

# THE PAGES a generated dashboard can have (hk-strategy.js), in menu order.
# Energy: the Energy feature's page (features/energy), while it is added.
PAGE_KINDS = ("weather", "calendar", "cameras", "live_tv", "security", "doors_windows", "climate", "lights",
              "timers", "vacuums", "music", "water", "energy", "power", "timeline", "rooms")

# A DASHBOARD'S PAGE ORDER: the kinds above, plus Browse Music as a place of
# its own (it comes with Play Music -- never on its own -- and follows it
# unless placed), plus the house's custom pages by address, so every page in
# the menu can be reordered.
PAGE_BROWSE = "browse"

PAGE_ORDER = (PAGE_KINDS[:PAGE_KINDS.index("music") + 1] + (PAGE_BROWSE,)
              + PAGE_KINDS[PAGE_KINDS.index("music") + 1:])

BOARD_GLASS = ("house", "clear", "frosted", "tinted", "blur", "blur_pre", "blur_each")   # house: the shared look

BOARD_GLASS = BOARD_GLASS + BRIGHT_GLASS

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

# what a phone shows at the top of Home: the clock and weather header, or the one-line weather strip (generated screens)
BOARD_PHONE = ("header", "strip")

# the menu's edge tab: its size on a tablet or wider (tab_size), and on a phone (tab_size_phone, under 640 px), each
# the screen's own -- hk-menu.js. A phone starts with the standard one, which already lies over the first column.
BOARD_TAB_SIZES = ("standard", "large", "xl")

# THE TAB BAR (hk-tabbar.js, docs/Tab-Bar.md): iOS's floating tab bar, the
# menu's other form. A screen's `menu` "tabbar" is the bar at every width
# and no side menu; its `narrow` "tabbar" is the side menu (a button, or
# always open) on wide screens and the bar where that menu would fold. The
# two never show together. How the bar behaves while the page scrolls, its
# Rooms button and its glass are menu settings (MENU_KEYS): All Screens'
# unless the screen sets its own (menu_own, one setting at a time).
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

# ...and Bright Glass's bar (2026-10-30): its light blur and rim, the page
# you're on a white pill
TAB_BAR_GLASS = TAB_BAR_GLASS + ("bright",)

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

# SWIPE BETWEEN PAGES (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase 0): a
# sideways swipe on a page goes to the next or the previous one, in the tab
# bar's order (hk-pageswipe.js). auto: where a tab bar shows (or the screen's
# Pages screen is on); on: everywhere, the side menu's order with no bar; off.
# All Screens' menu.swipe_pages; a screen's swipe_pages, None: Same as All Screens
SWIPE_PAGES = ("auto", "on", "off")

# how many PAGES a bar (bottom / top) and a rail (left / right) show at
# most, Home and More not counted (6: eight tabs in all) -- a phone never
# more than 3, what fits its width
TAB_BAR_TABS = (2, 8)

# a phone's: at most six tabs on a 402 px iPhone, Home and More among them (hk-tabbar.js fit)
TAB_BAR_TABS_PHONE = (2, 4)


def tab_count(v: Any, default: int = 6, span: tuple[int, int] = TAB_BAR_TABS) -> int:
    """A Tabs setting as stored: a whole number in `span` (TAB_BAR_TABS, a
    phone's TAB_BAR_TABS_PHONE), else the default."""
    if isinstance(v, bool):
        return default
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if span[0] <= n <= span[1] else default


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
    # menu_own (entry 1.17, 2026-10-29): which of the menu settings in
    # MENU_KEYS are this screen's own, one by one -- the rest are All
    # Screens' (settings `menu`, filled in by resolved()), as Appearance
    # follows them. `menu` itself is the screen's own whenever it is off,
    # always open or the tab bar; listed, a button's style is its own too.
    # (menu_custom, all or nothing, before 1.17: menu_per_setting.)
    "menu_own": [], "page_header": "current", "accent": "orange", "glyph": "sidebar", "clock": True,
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
    "tab_bar_tabs_phone": 3,
    # Use the Side Strip (2026-10-30): the tab bar as a rail in a phone's
    # side strip of system controls, where it has one (iPhone Duo)
    "tab_bar_strip": True,
    # Swipe Between Pages, this screen's own (None: All Screens'); the page a swipe right on Home goes to (None: none)
    "swipe_pages": None, "swipe_left": None,
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
    # Bright Glass's Strength, this screen's own (None: All Screens'), and its Dim
    "bright": None, "bright_dim": None,
    # its own Tile Style and Centered tiles' icons (TILE_STYLES, TILE_ICONS; None: All Screens')
    "tile_style": None, "tile_icons": None,
    "bright_pages": None,
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
    # ...and its own Wallpaper and Night Version (None: All Screens')
    "sky_wallpaper": None, "sky_wallpaper_night": None, "sky_wallpaper_motion": None, "sky_wallpaper_color": None,
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

# THE PAGES SCREEN, a screen's own (pages_screen_own: only the fields it sets); None is Same as All Screens
BOARD_DEFAULTS["pages_screen"] = None

# THE SIDE PANE, this screen's own groups (side_pane_own; None: Same as All
# Screens in everything -- settings `side_pane`, each group filled in by
# resolved())
BOARD_DEFAULTS["side_pane"] = None

# A LOOK'S UNDO (looks.py): the Look last applied here and this screen's own values before it; None: nothing to undo
BOARD_DEFAULTS["look_undo"] = None

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


# The pages a scene pill can open (Home -> Scenes -> Pills that open a page), and the Intercom (a pill, and a chip in
# chips_extra, that a screen adds from More where the page has the Intercom).
SCENE_PAGES = tuple(k for k in PAGE_KINDS if k != "rooms") + ("intercom",)

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


def bright_dim_or_none(v: Any) -> int | None:
    """Bright Glass's Dim (0-BRIGHT_DIM_MAX %), or None: not set, follow All Screens'."""
    n = amount_or_none(v)
    return None if n is None else min(n, BRIGHT_DIM_MAX)


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
    from .custom_page_rules import page_order, PAGE_PATH
    from .chip_rules import CHIP_KEY, CHIP_TOKEN
    from .menu_rules import accent, menu_own, PAGE_HEADERS
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
    out["menu_own"] = menu_own(d)
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
    out["tab_bar_strip"] = d.get("tab_bar_strip") is not False
    out["swipe_pages"] = d.get("swipe_pages") if d.get("swipe_pages") in SWIPE_PAGES else None
    out["swipe_left"] = d["swipe_left"] if isinstance(d.get("swipe_left"), str) and VIEW_PATH.match(d["swipe_left"]) else None
    out["tab_bar_tabs_rail"] = tab_count(d.get("tab_bar_tabs_rail"))
    out["tab_bar_tabs_phone"] = tab_count(d.get("tab_bar_tabs_phone"), 3, TAB_BAR_TABS_PHONE)
    out["tab_bar_scroll_phone"] = pick("tab_bar_scroll_phone", TAB_BAR_SCROLLS)
    out["menu_phone"] = d.get("menu_phone") if d.get("menu_phone") in BOARD_PHONE_MENUS else None
    out["button_phone"] = pick("button_phone", BOARD_BUTTON_PHONE)
    out["tab_bar_rooms_phone"] = tab_bar_rooms(d.get("tab_bar_rooms_phone"))
    strs = lambda v: [str(x) for x in v if x] if isinstance(v, list) else None  # noqa: E731
    for k in ("categories", "room_order", "cameras", "scenes", "favorites", "chips_extra"):
        out[k] = strs(d.get(k)) or []
    # chips: the kinds AND the dashboard's own chips (entities), in one order;
    # which entities are chips at all is chips_extra's to say
    out["chips"] = [k for k in (strs(d.get("chips")) or []) if k in CHIP_KINDS or k == "intercom" or ENTITY_ID.match(k)
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
    out["scenes_pages"] = [k for k in (strs(d.get("scenes_pages")) or []) if k in SCENE_PAGES]
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
    out["bright"] = amount_or_none(d.get("bright"))
    out["bright_dim"] = bright_dim_or_none(d.get("bright_dim"))
    out["tile_style"] = d.get("tile_style") if d.get("tile_style") in TILE_STYLES else None
    out["tile_icons"] = d.get("tile_icons") if d.get("tile_icons") in TILE_ICONS else None
    out["bright_pages"] = d.get("bright_pages") if d.get("bright_pages") in BRIGHT_PAGES else None
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
    out["sky_wallpaper"], out["sky_wallpaper_color"] = board_wallpaper(d.get("sky_wallpaper"), d.get("sky_wallpaper_color"))
    out["sky_wallpaper_night"] = d.get("sky_wallpaper_night") if d.get("sky_wallpaper_night") in WALLPAPER_NIGHT else None
    out["sky_wallpaper_motion"] = d.get("sky_wallpaper_motion") if d.get("sky_wallpaper_motion") in WALLPAPER_MOTION else None
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
    # THE PAGES SCREEN, this screen's own fields (pages_screen_own); none: Same as All Screens
    out["pages_screen"] = pages_screen_own(d.get("pages_screen")) or None
    out["side_pane"] = side_pane_own(d.get("side_pane"))
    lu = d.get("look_undo")
    out["look_undo"] = lu if (isinstance(lu, dict) and lu.get("look") in LOOK_IDS and isinstance(lu.get("was"), dict)) else None
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
