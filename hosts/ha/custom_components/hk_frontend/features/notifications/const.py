"""Notifications' constants: its option keys, choices and limits."""
from __future__ import annotations

DATA = "hk_notifications"          # hass.data: the watcher, the snapshots, the last times

# the feature's options
CONF_ITEMS = "items"               # the notifications, in their order
CONF_STAY = "stay"                 # seconds a banner stays (each can set its own)
CONF_SAVER = "saver"               # over a screensaver: all / important / off
CONF_CHIME = "chime"               # a soft chime on wall tablets and computers
CONF_DND = "dnd"                   # Do Not Disturb for All Screens (settings.notify_dnd)
CONF_WAKE = "wake"                 # Wakes the Screen, for every notification that doesn't set its own
OPTION_KEYS = (CONF_STAY, CONF_SAVER, CONF_CHIME, CONF_DND, CONF_WAKE)

STAYS = (10, 30, 60, 120, 300)     # Stays On Screen; an item's 0 is Until Dismissed
STAY_DEFAULT = 30
SAVERS = ("all", "important", "off")
SAVER_DEFAULT = "important"
DEFAULTS = {CONF_STAY: STAY_DEFAULT, CONF_SAVER: SAVER_DEFAULT, CONF_CHIME: True, CONF_WAKE: False,
            CONF_DND: {"schedule": False, "from": "22:00", "to": "07:00", "while": []}}

# one notification's fields
ITEM_FIELDS = ("entity", "category", "exclude", "pairs", "when", "only", "cooldown", "title", "message", "important", "wake", "stay",
               "pop", "snap", "camera", "tap", "page", "go", "allday")
ONLY = ("always", "home", "away", "night")
COOLDOWNS = (0, 60, 300, 900, 3600)
# Tap Opens: its sheet (the notification at its top), the live camera, a
# page of the screen's (`page`), or nothing
TAPS = ("sheet", "camera", "page", "none")
# Go To on its sheet: Automatic (None -- the page the screen shows it on, else
# its room's), "none", or a page's path
GO_NONE = "none"
PAGE_RE = r"^[a-z0-9][a-z0-9_-]{0,63}$"
# Mute 1 Hour (a sheet's button): that notification -- for a category, that
# accessory -- quiet on every screen
MUTE_S = 3600
ITEMS_MAX = 60
TITLE_MAX = 40
MESSAGE_MAX = 120

# snapshots: kept this long, at most this many (the oldest go first)
SNAP_TTL_S = 600
SNAP_MAX = 30
SNAP_TIMEOUT_S = 6
# a screen woken for a notification stays awake this long at least (or as
# long as the banner stays, up to WAKE_MAX_S; Until Dismissed: WAKE_MAX_S)
WAKE_MIN_S = 60
WAKE_MAX_S = 300
