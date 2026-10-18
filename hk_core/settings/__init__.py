"""HK's settings, written once for every host (PLAN.md §0, plan review).

  model    the schema and its DEFAULTS (All Screens', a screen's, a tablet's, a pop-up's, a
           custom page's and chip's), every value's check, the older shapes lifted to the
           current ones (the *_lifted migrations, settings_tidied, radar_lifted), each screen
           resolved over All Screens (resolved, boards), what a screen is handed (as_client),
           and WHAT IS SAVED: `Stored`, the options and the items as plain data -- a store only
           gets and puts it (to_dict / from_dict)
  changes  the settings page's writes: one change at a time, checked, refused by name
           (apply_house, apply_board, apply_tablet)
  kinds    Status & Chips' kinds: what each finds, DEFAULTS["counts"], the older lists, a
           saved kind's shape

The storage is the host's: inside Home Assistant, the config entry's options and subentries
(settings.py reads the entry into a `Stored`; settings_api.py, panel.py and the flows write
it), the websocket commands and the signals that tell every screen. Mantel keeps the same
dict in SQLite.
"""
