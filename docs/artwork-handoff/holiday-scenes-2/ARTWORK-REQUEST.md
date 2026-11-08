# Artwork request: Thanksgiving and New Year's

**For:** Codex. **From:** Claude, for the owner (Mantel). **Date:** 2026-11-08.
**This folder:** `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes-2/`

The owner loved the first batch and asked for these two next. This is the same job, with the same rules, in a separate folder.

## Where things go

| What | Where |
|---|---|
| Every finished image and JSON file | `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes-2/output/` |
| Your working files | `output/work/` |
| **When everything is finished and checked** | `ARTWORK-DONE.json` in this folder |
| **If you cannot finish** | `ARTWORK-BLOCKED.json` in this folder |

**Claude is watching for those two files in this folder.** Create one as your very last step, and nothing before that. Use the formats in section 8 of `../holiday-scenes/ARTWORK-REQUEST.md`.

**Do not change anything in `../holiday-scenes/`**, which may still be in use. Read it only.

## 1. Read first

- `../holiday-scenes/ARTWORK-REQUEST.md`: sections 1, 2 and 3. **Its style, "never anywhere" and technical rules all apply here unchanged.** That includes no people, animals, characters, brands, real landmarks, words, numbers, letters, signatures or watermarks.
- `../holiday-scenes/output/room-couch.png`, `room-tree.png`, `room-window.png`, `haunt-house.png`: **the quality bar and the hand to match.** These two scenes belong to the same series.
- `references/placements.json` and `references/annotated/*.png`: every piece's box at each of the five screen sizes.

**Code draws live, so do not paint:** the numbers and every word, the flaps on the board, flames and their glow, steam, falling leaves, geese, fireworks, confetti in the air, stars twinkling, and every glow.

Some pieces do not appear on narrow screens, where the box in `placements.json` is `null`.

## 2. Thanksgiving: a 90s dining room at dusk

**The count is written in chalk on a big framed chalkboard, propped on a low console, as a family writes the day's menu.** Beyond it, a set table and a loaded china hutch. Through the window, fall trees at dusk.

**Light:** the last warm dusk through the window, with a soft amber lamp and candlelight in the room, and the corners falling into shadow. Cozy, full, and a little too much food. American, 1990s, middle-class: hunter and rust colors, oak, a good tablecloth brought out once a year.

| File | Size | What it is |
|---|---|---|
| `thanks-wall.png` | 1024 x 1024 | **Seamless tile, opaque.** Deep rust or burgundy-brown wallpaper with a faint tone-on-tone pattern. Mean brightness 85 of 255 or less: white words go over it. Even light. |
| `thanks-wainscot.png` | 2048 x 400 | **Seamless left to right, opaque.** From the top: a harvest-toned paper border, about 55 px tall, with a small repeating leaf or vine. A chair rail. Oak panels. A baseboard at the very bottom. Warmer and lighter than the green room's. |
| `thanks-floor.png` | 1024 x 1024 | **Seamless tile, opaque.** Warm oak strip flooring, a low-angle view, with planks running left to right. Mean brightness 60 to 120. No visible repeat. |
| `thanks-window-outside.png` | 1000 x 920 | **Opaque.** Fall maples and oaks in full color at dusk, a pink and violet sky, leaves on the lawn. Keep the upper half fairly open: leaves and geese pass there. |
| `thanks-window.png` | 1160 x 1136 | **Cut-out.** Cream frame with crossed bars, tan and rust plaid drapes, and a matching valance. **The glass is fully transparent** across x 180-980, y 120-880, except the bars. Same structure as `room-window.png`, different fabric. |
| `thanks-table.png` | 1240 x 656 | **Cut-out.** A dining table seen straight on with a cream cloth and runner: **a roast turkey on a platter at the center**, pie, rolls, cranberry, gravy boat, good plates, glasses, two tall unlit candles, a low gourd centerpiece, two chair backs. Mouth-watering. |
| `thanks-table.json` | | `{"candles": [{"x": 300, "y": 120}], "steam": [{"x": 620, "y": 210}]}`, in that image's px: each candle wick, and 2 to 5 points where steam rises from hot food. |
| `thanks-hutch.png` | 1348 x 2152 | **Cut-out.** A tall oak china hutch filling its frame, seen straight on: blue and white plates on the shelves, glassware, gourds, a wicker cornucopia on top, and on its lower counter **a pumpkin pie and a pie-laden tray**. It stands in for the table on upright screens, so it must say Thanksgiving by itself. Its foot is on the bottom edge. |
| `thanks-harvest.png` | 1400 x 272 | **Cut-out.** A low row along the floor: pumpkins, gourds, corn shocks, a wicker basket of apples. Soft contact shadow. |
| `thanks-board.png` | 2000 x 1515 | **Cut-out.** The hero: a big chalkboard in a chunky, worn oak frame, seen straight on. **Its face is blank:** across x 120-1880, y 120-1395 it is smooth, smudged charcoal slate, mean brightness 60 or less and very even (faint old chalk ghosting only), with **no writing or drawing**. Light chalk dust along the frame's ledge is welcome. |
| `thanks-console.png` | 2004 x 232 | **Cut-out.** The long, low oak console the board stands on, seen straight on, with a folded linen runner and a few small gourds at its far ends only. Nothing in the middle, where the board stands. Soft contact shadow. |

## 3. New Year's: a rooftop party over a city at midnight

**The count is on a big split-flap board, the kind old train stations had, standing on a party rooftop.** Behind it is a glittering, made-up city at night. Code flips the digits and fires the fireworks.

**Light:** deep blue-black night, warm string lights overhead, city glow from below. Glamorous, fun, a little 1999. **The city is invented**: no recognizable skyline, landmark, or tower from a real place, and no signs that can be read.

| File | Size | What it is |
|---|---|---|
| `ny-sky.png` | 2560 x 1600 | **Opaque.** Deep night, near-black blue above, warming to a hazy city-lit violet at the bottom. Fine stars, thin cloud. No fireworks, no moon, no buildings. Top-left (x 0-900, y 0-520) dark and calm for white words, and the top-right band dark. |
| `ny-skyline.png` | 3200 x 900 | **Cut-out, seamless left to right.** A dense invented skyline of varied towers with thousands of small lit windows, some rooftop lights, soft haze at its foot. Top 40 rows fully clear. Bottom rows solid. It should look rich at any width from 800 to 3200 px, with no giant hero tower. Bottom 60 rows may fade to a dark city haze. |
| `ny-rooftop.png` | 3200 x 520 | **Cut-out, seamless left to right.** The party's rooftop: a low brick parapet along the top, with a dark railing on it, then the dark roof deck. Top 20 rows fully clear. Bottom 60 rows solid and very dark: words go over them. No objects standing on it. |
| `ny-string-lights.png` | 3200 x 300 | **Cut-out, seamless left to right.** A swagged string of round bulbs on a dark wire. Unlit: code lights them. Nothing else. |
| `ny-string-lights.json` | | `[{"x": 120, "y": 96}, ...]`, 30 to 70 entries, in that image's px, one on each bulb. Each must sit on a real bulb. |
| `ny-board.png` | 2000 x 1515 | **Cut-out.** The hero: a split-flap board's heavy housing in dark painted steel and aged brass, with rivets and a little wear, seen straight on. **Its opening is fully transparent across x 110-1890, y 150-1345**, a plain rectangle with crisp straight edges and a soft inner shadow painted on the housing at the edge. Code draws the flaps there. No text, numbers, clock or logo on it. |
| `ny-crate.png` | 2004 x 232 | **Cut-out.** What the board stands on: a low, wide base of old wooden crates with no stencils or printing, a few gold streamers across it. Soft contact shadow. |
| `ny-party.png` | 1240 x 656 | **Cut-out.** A round high-top table with a shimmering gold cloth: an unlabeled champagne bottle in an ice bucket, coupes, party hats, noisemakers, a small clock with **no numbers on its face**. No food. |
| `ny-balloons.png` | 1348 x 2152 | **Cut-out.** A tall, generous bunch of gold, silver, black and pearl balloons rising from a weight on the bottom edge, with curling ribbons. Plain balloons, no numbers or letters. Light from the strings above and the city below. It stands in for the party table on upright screens. |
| `ny-streamers.png` | 1400 x 272 | **Cut-out.** A low drift along the floor: fallen gold and silver streamers, confetti, a party hat, a popped noisemaker. Soft contact shadow. Sparse enough to see the deck through. |

## 4. Checks before you call it done

1. **Run the checker.** Every line must say PASS, ending in ALL PASS. It also writes `output/preview-<scene>-<screen>.png`:

   ```bash
   ~/.venvs/mantel/bin/python /Volumes/data/mantel/docs/artwork-handoff/holiday-scenes-2/check_assets.py
   ```

2. **Look at all ten previews at full size.** Do these look like the same series as the living room and the haunted house? One hand, one light? Is the count readable at a glance, including on the phone? Do things stand on the floor? Would the owner stop and smile?
3. **Check every cut-out** on flat black and flat white at 200 % for halos.
4. **Check the tiles and strips** repeated side by side for seams and rhythm.
5. **Read every piece for accidental writing, logos, signs, faces or real landmarks.** Look hardest at the chalkboard, the board, the skyline, the bottle, the clock and the plates.

Redo anything that fails. If a checker rule and this request ever seem to disagree, follow the request's intent, say so in your status file's `notes`, and do not treat that alone as a reason to block.
