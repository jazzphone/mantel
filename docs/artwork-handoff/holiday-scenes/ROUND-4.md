# Artwork request, round 4: garland for the entertainment center

**For:** Codex. **From:** Claude, for the owner. **Date:** 2026-11-08.

The owner says the entertainment center isn't very Christmasy. Code now strings a few twinkling lights along its top, but it needs real greenery. **Keep every other piece unchanged.** Round 3's status file moved to `output/work/ARTWORK-DONE-round3.json`.

## `room-garland.png` (2400 x 520)

**Cut-out.** A full, slightly unruly 1990s pine garland, made to drape along the top of `room-entertainment-center.png` at the same scale. The two pieces share the frame's width: 2400 px here is the unit's full width.

- **Top edge:** rows 0 to about 90 run straight along the crown molding, as if laid on top of it, with a few pine tips poking up.
- **Below that:** it hangs in **four even swags** across the width, the deepest dipping to about row 420. Gathered points sit at about x 40, 620, 1200, 1780 and 2360, each with a **red velvet bow**. Two or three short tails hang below the bows.
- **On the garland:** pine cones, a few small glass balls in red and gold, and a little silver tinsel. **No light string**, because code draws the lights.
- **Light:** the room's warm evening light from the right, matching round 3. A soft contact shade where it lies on the molding, nothing below that.
- Fully transparent everywhere else. It must leave **the TV opening (x 600-1800 from row 220 of the unit's own frame, about row 340 here) completely uncovered**, so the swags stay above that line in the middle two swags.
- No text, logos, faces or characters.

## Checks

1. Run the checker. It must end in ALL PASS. It doesn't know this piece yet, so also confirm its size, RGBA format, transparency, and that rows 340 to 520 in columns 600 to 1800 are fully transparent.

   ```bash
   ~/.venvs/mantel/bin/python /Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/check_assets.py
   ```

2. Composite it over `room-entertainment-center.png`, top edges aligned and same width, and look at it at full size and on flat black and white.

## When you're finished

Write only in `output/`, plus the status file. No commits. As your **last** step, create `docs/artwork-handoff/holiday-scenes/ARTWORK-DONE.json`, or `ARTWORK-BLOCKED.json` if something truly stops you. **Claude is watching for those files.**
