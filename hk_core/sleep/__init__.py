"""Sleep Screen's decisions for each wall tablet, written once for every host (PLAN.md §0,
plan review).

  rules   the settings' shape (sleep_options), what counts as "on", the schedule, the
          brightness by day and night, and decide(): one moment's facts -> what the screen
          shows, and why; action(): sleep, wake or nothing
  engine  one screen's memory and decisions (Sleep): the facts read through the House, the
          presence that lingers, the power button's minute, a notification's while, the next
          moment to look again, the brightness to set and the display to turn off, the loop
          guard; the Kiosk Satellite devices and their parts

The surface is the host's: inside Home Assistant, sleep_engine.py (following the entities and
the clock, the sleep and the wake -- service calls with waits between them -- and the sensor)
with screensaver.py, which holds one engine per tablet.
"""
