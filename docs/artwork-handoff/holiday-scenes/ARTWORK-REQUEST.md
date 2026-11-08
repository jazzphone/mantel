# Artwork request: the Holiday slide's first two scenes

**For:** Codex. **From:** Claude, for the owner (Mantel). **Date:** 2026-11-08.
**This folder:** `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/`

Everything you need is in this folder and the two files named below. You should not need any other conversation.

## Where things go

| What | Where |
|---|---|
| Every finished image and JSON file | `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/output/` |
| Your working files | `output/work/` |
| **When everything is finished and checked** | `ARTWORK-DONE.json` in this folder (section 8) |
| **If you cannot finish** | `ARTWORK-BLOCKED.json` in this folder (section 8) |

**Claude is watching for those two files.** Create one of them as your very last step, and nothing before that. Files appearing in `output/` mean nothing until then.

## 1. What this is for

Mantel's wall tablets show a screensaver, with slides that come now and then. The Holiday slide counts the days to the next holiday. The plan is `docs/phase20/HOLIDAY-SLIDE.md` (read its "Themed scenes" section). The owner has seen and likes two rough ideas:

- **Christmas: a 90s living room at night.** The count is on a CRT TV.
- **Halloween: a haunted house on a hill.** The count is carved into a tombstone in the foreground.

Run the mock-up to see them move: serve `docs/phase20/mockup/holiday-slide.html` or open its pictures in `references/mock/`. **Those drawings show placement and idea only. They are not the quality bar: your paintings replace them.** The owner rejected an earlier piece of art for looking cheap, and a room shows weak art more than a meadow does. Quality matters most here. A scene should make someone stop and smile from across a kitchen.

**You paint the pieces. Code does the rest.** Code draws these live, so **do not paint them**: the numbers and every word, the TV picture, the time, date, weather and status, falling snow, the sleigh, the bats, fog, the moon, every glow and flicker, a figure in a window, and lightning.

## 2. How the pieces are used

Every piece is separate, because code places them differently on each screen: 1280 x 800 wall tablet, 880 x 800 beside a side pane, 820 x 1180 iPad upright, 390 x 844 phone, 844 x 390 phone sideways.

- `references/placements.json` gives each piece's box, in screen px, at each size.
- `references/annotated/*.png` draws those boxes with their names on the mock-up. Look at all ten.
- `references/mock/*.png` shows the same pictures without the boxes.

Pieces overlap in that order, so paint each one complete behind where another covers it. A piece must look right alone, and beside any other. Upright screens drop the couch and presents, and the tree stands behind the TV.

## 3. The style, for both scenes

- **Match Mantel's existing art:** painterly and near-photographic, with soft natural detail. Look at `web/hk/sky/land-christmas-night.webp`, `land-christmas-dusk.webp` and `land-halloween-night.webp`, plus `web/hk/sky/moon-hallow.webp`. Not cartoon, vector, clip art or plastic 3D.
- **A warm memory, not a catalog.** Lived-in, a little imperfect, believable.
- **One camera:** straight on, from about seated eye height, with little perspective. Verticals stay vertical. Furniture is seen straight on or nearly so, so the pieces sit together in any arrangement.
- **One light per scene** (below), painted into every piece, so nothing looks pasted in.
- **Never anywhere:** people or faces, animals, characters from any show, film, game or book. Brand names, logos or real products. Real places or landmarks. Words, numbers, letters, signatures, watermarks, frames. Baked-in drop shadows outside a piece, except where this request asks for a soft contact shadow.
- **Everything original.** No stock photos or third-party images.
- **American 1990s, middle-class home**, not a parody of one.

### Technical rules

- PNG, RGBA, 8 bits per channel, sRGB, **exactly the listed size**.
- Cut-outs have a genuinely transparent background: no matte, no checkerboard. Use straight alpha, with each edge pixel's color bled from the object itself, so there is no dark or light halo on any background.
- If your image generator cannot make real transparency, generate on a flat color that appears nowhere in the object, cut it out carefully, and remove the color spill.
- "Seamless" means it repeats with no visible seam and no feature that shows a rhythm.

## 4. Christmas: the 90s living room

**Light:** night. A warm lamp and the tree's glow from the right of the room, gentle falloff, deep soft shadows on the left. The wall stays dark enough for white text. Think of 9 PM on a December evening with the big light off.

| File | Size | What it is |
|---|---|---|
| `room-wall.png` | 1024 x 1024 | **Seamless tile, opaque.** Hunter green striped wallpaper with faint texture. Mean brightness 85 of 255 or less. Even light: code adds falloff. |
| `room-wainscot.png` | 2048 x 400 | **Seamless left to right, opaque.** From the top: a burgundy and gold wallpaper border, about 55 px tall, with a small repeating swag. A chair rail. Honey oak panels. A baseboard at the very bottom, where the floor meets it. |
| `room-carpet.png` | 1024 x 1024 | **Seamless tile, opaque.** Oatmeal berber: a pale, flecked cream and tan loop pile, fine in scale. Mean brightness 95 to 140 of 255. Even light: code adds falloff. |
| `room-window-outside.png` | 1000 x 920 | **Opaque.** Through the window at night: snowy yard, dark trees, a neighbor's small house with warm lit windows, deep blue sky, no moon. No falling snow. Keep the upper half calm: snow and the sleigh pass there. |
| `room-window.png` | 1160 x 1136 | **Cut-out.** Cream window frame with crossed bars, burgundy drapes either side, and a swag valance with gold trim. **The glass is fully transparent** across x 180-980, y 120-880 except the bars, which cross near its center (the drapes may reach just inside those edges). |
| `room-couch.png` | 1240 x 656 | **Cut-out.** A worn plaid couch in burgundy, green and cream, seen straight on, with a throw pillow or an afghan. A soft contact shadow under it. |
| `room-tree.png` | 1348 x 2152 | **Cut-out.** A full store-bought tree with its stand and skirt: dense branches, silver tinsel, gold garland, glass ball ornaments, some handmade ones, a star on top. Star points may touch but not cross the top rows. **Light strings on it, bulbs unlit:** code lights them. It should feel loved and a little overloaded. |
| `room-tree-bulbs.json` | | The bulbs in `room-tree.png`: `[{"x": 640, "y": 900, "color": "red"}, ...]`, 60 to 110 entries, in that image's px, with color `red`, `green`, `gold` or `blue` and about equal numbers of each. Each must be on an actual painted bulb, and its color must be that bulb's own painted tint. |
| `room-presents.png` | 1400 x 272 | **Cut-out.** A low row of wrapped gifts, in 90s paper with bows. Blank tags. Soft contact shadow. |
| `room-tv.png` | 2000 x 1515 | **Cut-out.** A chunky CRT TV case seen straight on, in dark charcoal or wood-grain. **The screen's opening spans x 76-1924, y 76-1295 and is fully transparent, with elliptical corners 166 px across and 134 px down; the case fills those corners.** Code draws the picture to the same shape. Below it: a speaker grille, knobs or buttons, a small unlit LED at the right. No brand name. The case is lit softly from the right. |
| `room-tv-antenna.png` | 908 x 288 | **Cut-out.** Rabbit ears with a small base, the base centered along the bottom edge. |
| `room-stand.png` | 2004 x 232 | **Cut-out.** A long, low oak TV stand with an open shelf. On the shelf at the left a black VCR, and to the right about eight VHS tapes in plain sleeves with blank labels. The VCR has a **blank, black clock window at x 420-700, y 70-162**: code draws 12:00 there. A soft contact shadow. |

## 5. Halloween: the haunted house

**Light:** a cold, full moon, high behind the house to the left. Silver rims on the roofs and the stone, deep purple-blue shadow everywhere else. Spooky-fun, for a family's kitchen: a storybook haunted house, not gore or horror.

| File | Size | What it is |
|---|---|---|
| `haunt-sky.png` | 2560 x 1600 | **Opaque.** Deep night, near-black blue at the top falling to dusty violet at the bottom, with fine stars and thin drifting cloud. **No moon**: code places it. No land. Keep the top-left (x 0-900, y 0-520) dark and calm for white words, and the top-right band dark. It covers every screen from the bottom center, so its interest stays low and central. |
| `haunt-house.png` | 2368 x 2048 | **Cut-out.** A tall, crooked Victorian house on no ground: a tower with a witch-hat roof on the left, leaning chimney, broken gables, a sagging porch, loose boards. **All windows dark.** Standing on the bottom edge of its frame, about centered. Dark overall, mean brightness 75 or less, with moon rims and enough detail to read as a real house. No ghost, no face in the windows. |
| `haunt-house-lit.png` | 2368 x 2048 | **Overlay, same frame.** Only the lit windows' glass, in warm candle-amber, with mullions left out, exactly over 4 to 10 of the windows in `haunt-house.png`. Everything else fully transparent. |
| `haunt-windows.json` | | The lit windows: `{"windows": [{"x": 200, "y": 300, "w": 180, "h": 260}, ...], "figure": 2, "shutter": 3}`, in that frame's px. `figure` and `shutter` are two different windows: a figure crosses one, the other has the loose shutter, so pick an obvious, large window for each. Each window's center must be lit. |
| `haunt-shutter.png` | 180 x 380 | **Cut-out.** One slatted, weathered shutter, flat on, its hinge side at the right edge. Code swings it. |
| `haunt-tree.png` | 936 x 1328 | **Cut-out.** A bare, twisted tree with its base on the bottom edge. Dark, moon-rimmed. |
| `haunt-grounds.png` | 3200 x 780 | **Cut-out, seamless left to right.** From the top: top 40 rows fully clear. A rolling hilltop line with low dark far ground. A wrought-iron fence running across, some bars bent. Small weathered graves, with blank faces, scattered and not in rows. Dead grass. Bottom 40 rows fully solid and very dark. |
| `haunt-stone.png` | 1640 x 1700 | **Cut-out.** The hero. A big, old, round-topped upright tombstone, lit from the upper left, seen straight on. **Code carves the words, so keep its face blank and clean**: x 15-85 %, y 18-92 %. Light gray (mean 115 to 205 of 255), very gentle mottling, no cracks, moss or words there. Moss, chips, lichen and a crack belong around the edge and the top. Its base is on the bottom edge. It must read at phone size and at 410 px wide. |
| `haunt-grass.png` | 2048 x 184 | **Cut-out, seamless left to right.** Dark dead grass in front of the stone's foot: blades and tufts, an irregular top and dense bottom. No straight edge at the top. |
| `haunt-pumpkin-large.png` | 480 x 480 | **Cut-out.** A carved jack-o'-lantern, lit from inside. A friendly-scary grin, and a soft contact shadow. Do not paint a glow outside the pumpkin: code adds it. |
| `haunt-pumpkin-small.png` | 480 x 480 | **Cut-out.** A different, smaller-looking pumpkin with a different face. Same rules. |

## 6. Leave these alone

Write only inside `output/`, plus the single status file in section 8. Do not edit `references/`, `ARTWORK-REQUEST.md`, `check_assets.py` or `make_references.cjs`. Do not change anything in `web/`, `hk_core/`, `hosts/`, `tools/`, or `docs/phase20/`. Do not commit, branch or push: anything in git stays as it is.

## 7. Checks before you call it done

1. **Run the checker** from this folder. Every line must say PASS, ending in ALL PASS. It also writes `output/preview-<scene>-<screen>.png`, the pieces at every screen size:

   ```bash
   ~/.venvs/mantel/bin/python /Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/check_assets.py
   ```

2. **Look at all ten previews yourself**, at full size. The previews use plain stand-in words and have no glows. Ask:
   - Would you hang this on your wall? Does it look painted by one hand, with one light?
   - Does the room feel like a real 1990s room at night, and the house like a storybook haunted house?
   - Can you read the count and the corner's words at a glance?
   - Do the pieces meet the floor and each other, or do they float?
3. **Check every cut-out on flat black and flat white** at 200 %, for halos and fringes.
4. **Check the tiles and bands** repeated 3 x 3 for seams and rhythm.
5. **Compare bulb and window positions** against the pictures by eye, drawn on a copy.
6. **Read every piece for accidental text, logos, faces and brand shapes.** Image generators invent them: look at the TV, VCR, tapes, presents, tags, and graves especially.

Redo anything that fails any of these. Getting one scene right matters more than speed.

## 8. When you're finished: the status file

Only after all pieces exist, the checker says ALL PASS, and you have looked at every preview, create this as your **last** step:

`/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/ARTWORK-DONE.json`

```json
{
  "status": "complete",
  "request": "docs/artwork-handoff/holiday-scenes/ARTWORK-REQUEST.md",
  "assets": [{"path": "output/room-wall.png", "width": 1024, "height": 1024, "sha256": "..."}],
  "previews": ["output/preview-room-wall.png"],
  "checks": ["check_assets.py: ALL PASS", "what you looked at"],
  "notes": "Anything Claude should know: limits, choices, weak spots, what you would redo with more time. Be honest."
}
```

Put one entry in `assets` for every delivered file, with real measured numbers.

**If you cannot finish**, because a tool is unavailable, image generation is refused or the quality isn't there, do not create that file. Create this instead:

`/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/ARTWORK-BLOCKED.json`

```json
{"status": "blocked", "done": ["output/room-wall.png"], "remaining": ["..."], "why": "What stopped you, and what would unblock it."}
```

Never create both. Never create either early. A finished scene plus a blocked one is a `BLOCKED` file that lists what is done.
