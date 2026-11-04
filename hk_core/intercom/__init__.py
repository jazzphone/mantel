"""The Intercom's decisions (docs/phase17/INTERCOM.md), written once for every host.

  config   the house's Intercom settings (the settings document ``house/intercom``): checked, with its defaults,
           the limits of each mode, the address Music Assistant fetches from, each room's own settings
  rooms    which rooms a broadcast plays in and which it leaves out, and why: enabled, allowed, available, quiet
           hours, the sender's own room, THE GROUP CHECK (a room leading other rooms' music would play the broadcast
           on all of them), stereo and virtual pairs, and Live or after-you-finish per room

The steps (the audio socket, the one-time link, Music Assistant's calls) are the host's: Mantel's ``intercom``
package. Nothing here does I/O.
"""
