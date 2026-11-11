"""model.py's defaults: DEFAULTS and the Pages screen, screensaver and side pane tables it is built from (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import copy
import re
from typing import Any
from .. import kinds
from ..saver_designs import FACES as SAVER_DESIGN_FACES, HOLIDAYS as SAVER_HOLIDAYS, TIMERS as SAVER_TIMERS
from .schema import (FLAT_COLORS_DEFAULT, FLAT_FADE, FLAT_TINT_AMOUNT, HEADERS, PHOTO_LOOK_DEFAULTS, RADAR_DEFAULTS,
    SKY_DATES, SKY_OFTEN, STATUS_KINDS, STATUS_ROWS, THEMES, WALLPAPER_LEGACY, WALLPAPERS, WEATHER_PAGE_DEFAULTS,
    WOODLAND_SEASONS,)


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
            # WALLPAPER (2026-10-30): which one (WALLPAPERS) and when its night
            # version shows (WALLPAPER_NIGHT); a screen's sky_wallpaper /
            # sky_wallpaper_night are its own
            "wallpaper": "ribbons", "wallpaper_night": "auto", "wallpaper_motion": "off",
            # ...and its colour (WALLPAPER_COLORS, or "#rrggbb"; 2026-10-31 a
            # theme's, 2026-11-01 every wallpaper's): the pair is read
            # together (wallpaper_choice) and always stored together
            # (house_stored), so Ribbons in Rose -- the twelve's default --
            # is what nothing stored means
            "wallpaper_color": "rose",
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
    "features": {"vacuum_script": None, "alarm_bad_code": None, "laundry": [], "laundry_clear": 4, "tv_sets": [], "tv_apps": [], "tv_show": "recent", "tv_icons": True,   # (Laundry, TVs: hk_core)
                 # thermostats: the older list Status & Chips replaced
                 # (kinds.LEGACY) -- read only while "thermostats" is unsaved.
                 # temperature: the indoor temperature the Climate chip shows
                 # (else the first thermostat's); power: the house's power
                 # draw, for the Energy chip. Both on the Status & Chips page.
                 "thermostats": [], "temperature": None, "power": None,
                 # The Timers page's "House timers": the timers people start
                 # themselves (a nap, bedtime), in order, one tap each.
                 "house_timers": [], "timer_sound": "bell", "timer_ring_for": 60, "timer_tablet": True, "timer_speaker": True, "timer_also": [], "timer_phone": "", "timer_volume": 40,
                     "timer_wake": True, "timer_include": [], "timer_ignore": []},
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
             # (menu_own: since entry 1.17 one setting at a time). MENU_KEYS
             # maps them onto a screen's keys. (The
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
             # Phones' Tabs in Bar (TAB_BAR_TABS_PHONE): Home, three pages and More, as before it was a setting
             "bar_tabs_phone": 3,
             # Labels: the tabs' names, or icons only (TAB_BAR_LABELS)
             "bar_labels": "show",
             # Use the Side Strip (2026-10-30): on a phone with a strip of
             # system controls down one side (iPhone Duo), the tab bar is a
             # rail in the strip's empty part (hk-tabbar.js stripSide)
             "bar_strip": True,
             # Swipe Between Pages (SWIPE_PAGES): a screen's swipe_pages, when
             # set, is its own
             "swipe_pages": "auto"},
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
             # BRIGHT GLASS (2026-10-30): bright -- its Strength, how much of
             # the white wash and the lift (50 as designed), capped where
             # white text would fall under 4.5:1 (hk-settings.js brightCap)
             "bright": 50,
             # ...and its Dim (2026-11-01, the owner: like the Side Pane's):
             # a shade over the glass and the bars, 0 to BRIGHT_DIM_MAX %
             "bright_dim": 0,
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
             "flat_colors": dict(FLAT_COLORS_DEFAULT), "flat_page_colors": {},
             # TILE STYLE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase B): the Home Grid's tiles and the room
             # pages' Tall pills in the Home app's layout, or Centred (the glyph above the name and room, HomeView's)
             "tile_style": "auto", "tile_icons": "auto", "thermostat_style": "dial", "bright_pages": "home"},
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

# ------------------------------------------------------------ the Pages screen
# THE PAGES SCREEN (docs/phase11/HOMEVIEW-LOOK.md, Phase J; decision 15, 2026-10-30): an iPad-style home screen of
# the screen's own pages, right after Home in the swipe order, so a screen can be got around without a nav bar
# (web/hk/cards/hk-pages-screen.js draws it). All Screens' `pages_screen` has every field; a screen's is None (Same
# as All Screens) or only the fields it sets, each its own and the rest All Screens' (pages_screen_resolved).
#   show     "off" | "on": the page at all (/pages, right after Home)
#   icons    "menu": the screen's menu pages, in its order; or a list of view paths of its own, in its order
#   rooms    "folder": one Rooms icon that opens them; "each": an icon per room; "none"
#   widgets  Side Pane sections among the icons (Phase A2): [{kind, size, place}] -- size "less" (2 x 1) or
#            "more" (2 x 2), place "right" or "left" of the first Pages screen, from the top
#   pill     the Home pill at the foot: "auto" (where the screen shows no tab bar), "on", "off"
PAGES_SCREEN_SHOW = ("off", "on")

PAGES_SCREEN_ROOMS = ("folder", "each", "none")

PAGES_SCREEN_PILL = ("auto", "on", "off")

# the time, large and faint, behind the icons (HomeView's; 2026-10-30, the owner: "why is there a huge clock in the
# background?" -- Off unless chosen)
PAGES_SCREEN_CLOCK = ("off", "on")

# the Side Pane's twelve sections (Phase A2's PANE_SECTIONS, in its order): one list once both are in
PAGES_SCREEN_WIDGETS = ("clock", "weather", "calendar", "now_playing", "security", "camera", "timers", "energy",
                        "climate", "people", "todo", "notifications")

PAGES_SCREEN_SIZES = ("less", "more")

PAGES_SCREEN_PLACES = ("right", "left")

PAGES_SCREEN_WIDGETS_MAX = 4

PAGES_SCREEN_ICONS_MAX = 60

PAGES_SCREEN_PATH = re.compile(r"^[A-Za-z0-9_.-]{1,60}$")

PAGES_SCREEN_DEFAULTS: dict[str, Any] = {"show": "off", "icons": "menu", "rooms": "folder", "widgets": [],
                                         "pill": "auto", "clock": "off"}

DEFAULTS["pages_screen"] = copy.deepcopy(PAGES_SCREEN_DEFAULTS)

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
    # the Today face's line of what's playing under its weather (2026-11-01, the owner: "I don't see a place to
    # actually turn this off"): on as it always was
    "clock_today_music": True,
    # ...and its weather under the time (2026-11-02, the owner: "There also isn't a way to remove the weather from the
    # Today Clock. It should be a toggle like What's Playing"): on as it always was
    "clock_today_weather": True,
    # A WALLPAPER BEHIND THE CLOCK (2026-10-31, the owner: "offer the current backgrounds and the new backgrounds
    # from the HomeView screen in the Clock Screensaver Background selection"): clock_bg "wallpaper" -- one of
    # WALLPAPERS, the twelve drawn ones or a motion theme in its colour (WALLPAPER_COLORS or "#rrggbb"); its
    # motion is the background's Speed below
    "clock_wallpaper": "aurora", "clock_wallpaper_color": "blue",
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
    # THE SLIDES' OWN SETTINGS (2026-11-02, the owner: "some configuration to the slide pages... I wouldn't mind the
    # clock being bigger"): the slide corner's time size (100 to 250 % of its usual) and what it leaves out
    # (SAVER_CORNER_PARTS, over every slide); what Music Full Screen leaves out (SAVER_MUSIC_PARTS)
    "corner_time_size": 100, "corner_hide": [], "music_hide": [],
}

MOSAIC_COLORS = ("black", "white", "gray", "charcoal", "cream", "navy")

SAVER_CLOCK_STYLES = ("today", "classic", "serif", "neon", "lcd", "flip", "analog", "numbers", "words", "arc", "nixie", "poster",
                      "dots", "ring", "glass", "type")

SAVER_CLOCK_BGS = ("black", "grain", "gradient", "aurora", "ink", "sky", "lowpoly", "topo", "constellation", "forecast", "skyonly", "photos",
                   "landscapes", "wallpaper")

SAVER_CHOICES = {"clock_over": ("corner", "large"), "clock_style": SAVER_CLOCK_STYLES,
                 "clock_bg": SAVER_CLOCK_BGS, "clock_motion": ("slow", "still"), "clock_wallpaper": WALLPAPERS + tuple(WALLPAPER_LEGACY),
                 "photo_layout": ("single", "mosaic"), "mosaic_gap": ("none", "thin", "rounded"),
                 "mosaic_change": ("one", "all"), "clock_night": ("off", "night", "always"),
                 "mosaic_color": MOSAIC_COLORS}

SAVER_MOSAIC = (2, 5)

SAVER_WEATHER_PARTS = ("rain", "wind", "hours", "days")

SAVER_CORNER_PARTS = ("time", "date", "weather", "status")

SAVER_MUSIC_PARTS = ("room", "album", "progress", "buttons", "volume", "next")

SAVER_ENERGY_PARTS = ("cost", "water", "solar", "gas", "power", "battery", "yday", "month", "pace")

SAVER_RANGES = {"blur": (0, 100), "dim": (0, 80), "zoom": (100, 200)}

SAVER_FOCUS = {"x": ("left", "center", "right"), "y": ("top", "center", "bottom")}

SAVER_ORDERS = ("random", "sorted")

SAVER_SHOWS = ("photos", "both", "forecast", "clock")

# THE HOMEVIEW-STYLE FACES (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): three more Shows -- Glance (the
# date, a clock, what's playing and the weather), Month (the month, today circled) and Day (the weekday and the
# date with HK's own occasion art; its look light or dark, or by the time of day) -- drawn by hk-saverfaces.js;
# three more clock faces (hk-saverclock.js: Liquid, Giant Numerals, Scattered Numerals); the Forecast's Layout
# (Big: Big Weather); and for the photos, Titles (the album's name and the year) and Time Behind (the time behind
# the photo's subject: Mantel Photos only, which cuts each photo out on its server). Each new option's default is
# how the screensaver drew before, so a screen saved earlier draws exactly as it did.
SAVER_SHOWS += ("glance", "month", "day")

SAVER_CLOCK_STYLES += ("liquid", "giant", "scattered")

SAVER_CLOCK_STYLES += ("planted",) + SAVER_DESIGN_FACES

SAVER_FORECAST_LAYOUTS = ("classic", "big")

SAVER_DAY_LOOKS = ("auto", "light", "dark")

SAVER_DEFAULTS.update({"forecast_layout": "classic", "photo_titles": False, "time_behind": False, "day_look": "auto"})

SAVER_CHOICES.update({"clock_style": SAVER_CLOCK_STYLES, "forecast_layout": SAVER_FORECAST_LAYOUTS,
                      "day_look": SAVER_DAY_LOOKS})

# BIG WEATHER'S NUMBER AND TIME BEHIND'S PLACE (2026-10-31, the owner): Big Weather draws the temperature or the time
# huge, standing on the landscape's ground (forecast_big); Time Behind's figures are tb_size % of the screen's shorter
# side, tb_top % down from the top, and the photo under them darkened tb_dim % (Show: Photos and Both -- on Clock the
# photos' own Darken, clock_photo_dim, does it). The defaults are how they drew before.
SAVER_FORECAST_BIG = ("temp", "clock")

SAVER_DEFAULTS.update({"forecast_big": "temp", "tb_size": 24, "tb_top": 6, "tb_dim": 0})

SAVER_CHOICES.update({"forecast_big": SAVER_FORECAST_BIG}, **SAVER_HOLIDAYS.CHOICES, **SAVER_TIMERS.CHOICES)

# BIG WEATHER'S PLANTED NUMERALS (2026-11-01, the owner): the time as ivory figures standing in the meadow, their
# shadows cast by the scene's sun, grass in front of their feet (hk-saverfaces.js plant()). On by the owner's choice
# -- unlike the options above, it changes how a saved screen draws; off draws the time as before.
SAVER_DEFAULTS.update({"forecast_planted": True})

# THE SCREENSAVER'S LAYOUT (2026-11-01, the owner: "Lets do the editor!"; docs/phase12/SCREENSAVER-EDITOR.md): None
# draws as each Show always has; the Screensaver editor saves one big element and the widgets in zones
# (saver_layout.py). Read tolerantly here -- a layout this build can only partly draw keeps what it can, never
# costing the screen its other options; the write checks it strictly (changes._saver_options).
SAVER_DEFAULTS.update({"layout": None, "designs": [], "active_design": "", "clock_options": {}}, **SAVER_HOLIDAYS.DEFAULTS, **SAVER_TIMERS.DEFAULTS)

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
              "extra_every": (1, 60), "extra_for": (10, 300), "tb_size": (12, 40), "tb_top": (0, 50), "tb_dim": (0, 80),
              "corner_time_size": (100, 250)}

# ------------------------------------------------------------ the side pane
# THE SIDE PANE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md "Phase A2"): one
# pane per screen, of sections the person picks and orders, beside the
# Dashboard (Home only, or every page) and in the screensaver
# (hk-sidepane.js draws it). All Screens' is the house section `side_pane`;
# a screen's own is a sparse object of the same groups (`side_pane`, None:
# Same as All Screens), each group resolving on its own: the screen's, else
# All Screens'. It takes over the screensaver's Calendar / Music pane
# (look.saver's calendar, calendar_days, music_pane) and Now Playing's Show
# As: Side Pane (now_playing.style / .side, a screen's np_style / np_side),
# moved over once by side_pane_lifted. A Status (2026-11-06): pane_status.py.
PANE_SECTIONS = ("clock", "weather", "calendar", "now_playing", "security", "camera", "timers", "energy",
                 "climate", "people", "todo", "notifications", "status")

# a section's Size: one line, the gist, the whole section, and the whole
# section taking the room the pane has left (one Full at a time); absent is More
PANE_SIZES = ("tiny", "less", "more", "full")

# Always, or When There's Something (music playing, a timer running, ...);
# absent is Always
PANE_WHEN = ("always", "active")

# WHERE A SECTION SITS (2026-10-30, the owner: "I'd like the music player widget to be at the bottom"): the top of the
# pane, in order, or its foot; and WHAT A TAP ON IT DOES: Automatic (its page where the screen has one, else its
# detail sheet), its page, its sheet, or nothing. Top and Automatic are what absent means.
PANE_PLACES = ("top", "bottom")

PANE_TAPS = ("auto", "page", "sheet", "none")

# Now Playing's own two (2026-10-31, the owner's item 44): the Speakers / Volume / Queue / Browse panel opens in
# place over the pane, or the section flips over to it as the screensaver's player turns
PANE_TAPS_OWN: dict[str, tuple[str, ...]] = {"now_playing": ("panel", "flip")}

# a kind's own choice, its first value what absent means: the Camera's Name (2026-10-31, the owner's item 42), as
# the Home Grid's camera block has it (Automatic, Show, Hide) but Hide by default -- the pane's still is a plain picture
PANE_CHOICES: dict[str, dict[str, tuple[str, ...]]] = {
    "camera": {"name": ("hide", "auto", "show")},
    # THE CLOCK'S LOOK (2026-10-31, the owner's item 43; the "Side Pane clock styles" board): the face, where it sits
    # in the pane, its type's size (`scale`: the section's own `size` is Tiny..Full) and weight, how much date, and
    # a second line under it -- Automatic is today's (the date with the sunset beside it at More). Each first value
    # is what draws today's clock, so a clock that sets none of them is unchanged.
    "clock": {"face": ("digital", "stacked", "analog"), "align": ("left", "center", "right"),
              "scale": ("medium", "small", "large"), "weight": ("semibold", "light", "regular", "bold"),
              "date": ("full", "short", "off"), "line": ("auto", "none", "sunset", "weather"),
              # ...and the weather beside the time, as the menu's header has it (2026-10-31, the owner)
              # ...in the look the owner chose (2026-11-01: "give the user the choice"): Large (two thirds of the
              # time, its weight), Quiet (half, regular), a Chip, or on the Date Line at the date's size
              "beside": ("none", "weather", "quiet", "chip", "date"),
              # ...and under the time at More, a strip the clock's width (2026-10-31, the owner): Automatic is today's
              # sunset beside the date; the next hours, the sun's day, the moon or the conditions
              "below": ("auto", "hours", "sun", "moon", "conditions")}}

# options that are on unless set off, stored only when off: the clock's AM/PM (it shows only on a 12-hour clock)
# ...and Now Playing's Album Art Background (item 41): the song's art blurred behind the whole pane
PANE_FLAGS_ON: dict[str, tuple[str, ...]] = {"clock": ("ampm",), "now_playing": ("art",)}

PANE_SIDES = ("right", "left")

PANE_WIDTHS = {"narrow": 360, "standard": 400, "wide": 480}

# DIM (2026-11-01, the owner: "with this background, it's just a bit too light to see the text"): a shade over the
# pane's glass, under its words, on the Dashboard (the screensaver's pane is on the saver's own ground) -- how much,
# 0 to PANE_DIM_MAX percent (a slider: the owner, the same day, "why isn't this a slider?"). It was Off / Low / Medium
# / High for its first hours: those read as their percentages. "glass" (2026-11-01, the default since: the owner,
# linked with an opt-out): Same as the Glass -- Bright Glass's Dim (look.bright_dim) where the page wears it.
PANE_DIM_MAX = 60

PANE_DIM_GLASS = "glass"

PANE_DIM_WORDS = {"none": 0, "low": 16, "medium": 30, "high": 45}

# On the Dashboard: Off, Home Only, Every Page; in the screensaver: Off,
# Same as the Dashboard's sections, Its Own Sections
PANE_SHOWS = ("off", "home", "all")

PANE_SAVER_SHOWS = ("off", "same", "own")

PANE_MAX = 8

# headings (2026-10-30): a small title over each section but the Clock and the Weather (they say what they are)
PANE_GROUPS = ("side", "width", "dashboard", "saver", "doorbell", "headings", "dim")

# each kind's own options: the calendar's days (1-7), the camera's and the
# to-do list's entity, the to-do list's Show Completed
# (the clock's Flashing Colon: off unless set)
PANE_OPTIONS: dict[str, dict[str, Any]] = {"calendar": {"days": SAVER_CAL_DAYS}, "camera": {"entity": "camera"},
                                           "todo": {"entity": "todo", "completed": bool}, "clock": {"colon": bool}}

SIDE_PANE_DEFAULTS: dict[str, Any] = {
    "side": "right", "width": "standard",
    "dashboard": {"show": "off", "sections": [{"kind": "weather"}, {"kind": "calendar"},
                                              {"kind": "now_playing", "when": "active"}]},
    "saver": {"show": "off", "sections": [{"kind": "clock", "size": "tiny"}, {"kind": "calendar"},
                                          {"kind": "now_playing", "size": "less", "when": "active"}]},
    "doorbell": True,
    "headings": True,
    "dim": PANE_DIM_GLASS,
}

DEFAULTS["side_pane"] = copy.deepcopy(SIDE_PANE_DEFAULTS)
