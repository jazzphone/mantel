# Artwork request, round 2: three small redos

**For:** Codex. **From:** Claude, for the owner. **Date:** 2026-11-08.

Round 1 was very good. **Keep everything not listed here unchanged**: the house, couch, window, presents, stand, tree shape, stone, pumpkins, sky, grounds and the rest. Your two blockers were faults in my spec, not your work, and both are fixed:

- **The TV opening:** `check_assets.py` and `ARTWORK-REQUEST.md` now agree: a rounded opening, with the case in its corners.
- **The upright tree:** `references/placements.json` now stands the tree on the floor behind the TV. The full centered skirt is right, so keep it. Your round 1 status file moved to `output/work/ARTWORK-BLOCKED-round1.json`.

I also made the TV stand and the Halloween grounds fit upright screens. That needs nothing from you.

## What to redo

### 1. `room-tv.png` (2000 x 1515)

The case is too plain and thin beside the rest of the scene, the opening's corners are square, and there are black notches along the opening's top and bottom edges where it was cut out.

- **Opening:** x 76-1924, y 76-1295, fully transparent, with elliptical corners 166 px across and 134 px down. The case fills the corners. The edge is smooth and clean all the way round, with no notches or steps.
- **Make it read as a heavy 1990s CRT:** molded plastic with real weight, a deep recessed lip around the tube (a soft inner shadow on the case at the opening's edge, so the screen feels set back), rounded outer corners, and fine plastic texture and wear. Keep the speaker grille, knobs or buttons and small unlit LED. It is lit softly from the right. No brand name or label.
- Do not paint anything in the opening: no glass, reflection or picture.

### 2. `room-carpet.png` (1024 x 1024)

It reads as dark brown bark or soil. Make it **oatmeal berber**: a pale, flecked cream and tan loop pile, fine in scale, mean brightness 95 to 140 of 255, seamless both ways, even light. At the wall tablet it shows about 512 px wide, so individual loops should be small.

### 3. `room-tree.png` and `room-tree-bulbs.json` (1348 x 2152)

Change only these two things, and keep the tree otherwise:

- **Replace the six-pointed straw star ornament** near the upper right. It reads as a religious symbol nobody asked for. Use a different handmade ornament, such as a five-pointed or eight-pointed straw star or a small wooden sled. Check the rest of the tree for any other symbol.
- **Each bulb's `color` must be that bulb's painted tint.** Round 1 assigned colors independently, so a painted red bulb would light up blue: only 29 of 64 match. List the real tint of each painted bulb, keeping about equal numbers of each color. Repaint some bulbs' tints if the balance needs it. At least 85 % must match by the checker's sampling, and aim for all of them.

Bulb positions must stay on real bulbs. If `room-tree.png` moves anything, re-measure.

## Checks

1. Run the checker. It must end in **ALL PASS**. Today it fails exactly these three items.

   ```bash
   ~/.venvs/mantel/bin/python /Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/check_assets.py
   ```

2. Look at all ten `output/preview-*.png` at full size, the TV on flat black and flat white at 200 %, the carpet repeated 3 x 3, and a copy of the tree with each bulb's listed color drawn on it.

## When you're finished

Do not change anything outside `output/`, except for the status file. No commits. As your **last** step, create one of these, in the format in section 8 of `ARTWORK-REQUEST.md`, covering all pieces with real measured numbers:

- `docs/artwork-handoff/holiday-scenes/ARTWORK-DONE.json`
- `docs/artwork-handoff/holiday-scenes/ARTWORK-BLOCKED.json`, only if something truly stops you.

Claude is watching for those files.
