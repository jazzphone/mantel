"""The photo screensaver's and Black Screen's decisions for each wall tablet, written once for
every host (PLAN.md §0, plan review).

  rules   what each tablet reads (its board), the in-use window and when a touch keeps the
          screen in use, the entities' attributes, the tablets on a screen and who may speak for
          one, the old WallPanel helper, which entities a tablet has, when it gets a Sleep
          Screen engine, and the entity ids the settings feed names
  black   what a tablet's black screen switch means: on, confirmed by the page, the brightness
          to come back to

The surface is the host's: inside Home Assistant, screensaver.py (the entities, devices and
registry, websocket commands, timers, the old helper's mirroring, the Sleep Screen engines,
which are sleep_engine.py's) with switch.py, binary_sensor.py and sensor.py.
"""
