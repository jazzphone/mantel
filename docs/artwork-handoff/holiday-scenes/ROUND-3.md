# Artwork request, round 3: an entertainment center and a pile of presents

**For:** Codex. **From:** Claude, for the owner. **Date:** 2026-11-08.

The owner loves the 90s look of round 2. After seeing it in motion, the owner asked for two changes, and both need new art.

1. **The entertainment center.** A TV sitting on a long, thin shelf looks strange. Paint a proper 1990s oak entertainment center instead, with the TV and VCR built in.
2. **The presents.** A single straight row looks flat. Paint a staggered, overlapping pile instead.

**Keep every other piece unchanged.** The room has been re-laid out around them, in `references/placements.json` and `references/annotated/room-*.png`. The couch is now much larger, there is a big picture window behind it, and the tree stands in front of the couch's far end. Look at the annotated pictures: `unit` and `pile` are the boxes for your two new pieces.

Round 2's status file moved to `output/work/ARTWORK-DONE-round2.json`. All rules in `ARTWORK-REQUEST.md` still apply: style, light, never-anywhere, and technical rules.

## 1. `room-entertainment-center.png` (2400 x 1600)

**Cut-out.** A classic 1990s honey-oak entertainment center seen straight on, standing on the bottom edge of its frame. A family's pride in 1996.

- **The middle:** a large built-in CRT TV in its own cubby, a heavy, dark molded case like `room-tv.png`. **Its screen opening is fully transparent across x 600-1800, y 220-1130, with elliptical corners 108 px across and 100 px down; the case fills those corners.** Paint a soft inner lip shadow on the case at the opening's edge, and nothing inside the opening: no glass, reflection or picture.
- **Under the TV:** an open shelf with a black VCR. Its **clock window, x 1000-1260, y 1290-1360, is solid black and blank**, because code draws 12:00 there. Beside it, a few VHS tapes in plain sleeves with blank labels.
- **Either side:** tall towers with glass or louvered doors. Behind the glass, a stereo stack with no brands, readable labels or lit displays. On top or on shelves: a small plant, a framed photo seen from the back or too small to show anyone, a couple of knick-knacks. **No people, faces, text or logos.**
- **At the bottom:** a plinth or drawers. Crown molding on top.
- **Light:** the room's warm evening light from the right, as in round 1, with soft shadows inside the cubbies.
- The TV must dominate. Its screen is half the unit's width, and code puts the count there, so the cubby frames it and never crowds it.

## 2. `room-presents-pile.png` (1600 x 720)

**Cut-out.** A generous, staggered heap of 9 to 12 wrapped gifts in two or three rows. They come in varied sizes, from small cubes to one long flat box, a tall box, and one leaning against another. They overlap and are partly hidden behind each other.

- Same papers, ribbons and blank tags as `room-presents.png`, plus a few new 90s patterns: plaid, foil, a candy-stripe.
- The front row is lowest and largest, the back row higher and smaller, peeking over.
- Its foot is on the bottom edge, with a soft contact shadow. It sits under the tree and in front of the tree skirt, so its top edge is uneven, with no flat line across it.
- Blank tags, and no words or names anywhere.

## Checks

1. Run the checker. Today it fails only these two files, because they are MISSING, and it must end in **ALL PASS**:

   ```bash
   ~/.venvs/mantel/bin/python /Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/check_assets.py
   ```

   Once your pieces exist, its previews draw the entertainment center instead of the TV and stand, and the pile instead of the row.

2. Look at all ten previews at full size. Does the entertainment center look like it belongs in that room and that decade, with the TV clearly the hero? Does the pile look like real presents under a real tree?
3. View both pieces on flat black and white at 200 %. Read them for accidental text, logos, faces or brand shapes, looking hardest at the stereo, the tapes and the tags.

## When you're finished

Do not change anything outside `output/`, except for the status file. No commits. As your **last** step, create `docs/artwork-handoff/holiday-scenes/ARTWORK-DONE.json`, or `ARTWORK-BLOCKED.json` if something truly stops you, in the format in section 8 of `ARTWORK-REQUEST.md`. **Claude is watching for those files.**
