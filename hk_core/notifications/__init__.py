"""NOTIFICATIONS' RULES (hk_core): what a notification is and when it goes off, written once for
every host. The host watches, stores and delivers; everything it decides is decided here.

    rules.py        what a change means: an accessory's kind, its choices, fires(), its words
    const.py        the options, their choices and limits
    dnd.py          Do Not Disturb: its shape, and whether it is on now
    accessories.py  what a notification watches, found in the house: names, cameras, categories
    banner.py       what goes to the screens (build, build_action), and which changes set one off
                    -- Only When, Mute 1 Hour, Not Again For (goes_off)
    calendars.py    the calendars' look-ahead: which events are due, each sent once
    migrate.py      stored options moved forward (Tap Opens, Wakes the Screen)
    settings.py     the HK Settings page: what it shows, and its checks, refused by field

The house is asked only through the House port (hk_core/house.py). What stays with each host
(HA: hosts/ha/.../features/notifications/): following the accessories' states and the
registry, the clock that ticks the calendars, the calendars' events (a service with a
response), the snapshot, the channel to the screens, waking the screens, the feature's stored
options and the websocket commands and action that change them.
"""
