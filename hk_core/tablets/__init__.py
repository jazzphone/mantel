"""Wall tablets' decisions, written once for every host (PLAN.md §0, plan review).

  kiosk        a kiosk app's entities by role (Kiosk Satellite's, Fully Kiosk's), the kiosk
               apps' devices, the screen a kiosk shows, the checks against what HK needs and
               the calls that fix its own screensaver
  suggestions  what may be a wall tablet that isn't one yet
  alerts       offline, not charging, didn't come back after a restart; the scheduled
               restart's times and what it presses
  setup        Setup Check's line for the tablets

The tablets themselves (their settings) are the host's to read and hand in; so are the
timers, the button presses, the notifications and the store of browsers seen. Inside Home
Assistant that is tablets.py.
"""
