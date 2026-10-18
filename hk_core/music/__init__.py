"""Whole-home music's decisions, written once for every host (PLAN.md §0, plan review).

  config     the configuration model: rooms (named and floored from the house), presets,
             playlists, and what a screen is handed
  engine     what a request decides before and between its steps: which rooms it claims,
             what is in the way, who leads, what is left behind, the refusals, the volume
  checks     the speakers, preset and playlist checks every form shares
  settings   the HK Settings page's changes and saves, checked and shaped
  warm       Keep Playlists Ready's rounds, against Music Assistant's own client
  queue      a queue item, as the Music page reads it
  announcements  which service calls are announcements, and which players they hide

The steps themselves (service calls, waiting on states, the locks, notifications, timers) are
the host's: inside Home Assistant, features/music/. In Mantel the engine talks to Music
Assistant directly (PLAN.md §3, §10) and asks these same rules.
"""
