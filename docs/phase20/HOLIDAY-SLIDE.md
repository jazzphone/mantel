# Phase 20: the Holiday slide (plan, 2026-11-08)

**Status: designed, not built.** The owner approved the look in a working mock-up. Four holidays have painted scenes: Christmas, Halloween, Thanksgiving and New Year's. Every other holiday uses an outdoor scene built from the sky's existing art. Nothing here has been on a real wall tablet.

- **Mock-up:** [mockup/holiday-slide.html](mockup/holiday-slide.html), with its art in [mockup/scenes/](mockup/scenes/) and screenshots beside it. To run it, serve the repository root with any static server and open `/docs/phase20/mockup/holiday-slide.html`: it loads `scenes/` beside it and the sky's sprites from `web/hk/sky/`. **It is the reference implementation**: every layout rule, shadow, effect and arrival in this plan is running code there. The functions named below are in it.
- **Art:** painted by Codex in four rounds, from [holiday-scenes](../artwork-handoff/holiday-scenes/ARTWORK-REQUEST.md) (Christmas and Halloween, with `ROUND-2.md` to `ROUND-4.md`) and [holiday-scenes-2](../artwork-handoff/holiday-scenes-2/ARTWORK-REQUEST.md) (Thanksgiving and New Year's). The full-size PNGs are git-ignored and live only on the owner's Mac (see "Shipping the art").
- **Line numbers** below are as of `0f08fe87`. `main` has moved since, so search for the names.

## The ask (the owner, 2026-11-08)

- Another slide for the screensaver: how many days until a holiday, such as Christmas.
- Themed for the holiday, with fun effects or animations.
- It works just like the Weather and Home Energy slides, so the clock, weather and date placement applies the same way.

What the owner settled while reviewing the mock-up:

- A holiday wears a **scene**, not just a backdrop: "a 90's living room" for Christmas, "a haunted house" for Halloween, then "thanksgiving and new years as well".
- **Depth and proportion:** objects at believable sizes, overlapping each other, nearer things bigger, the hero object forward, and nothing floating. Every object casts a shadow where it meets the floor.
- **Christmas:** a proper 90s entertainment center with the TV built in, its left tower running off the screen's left edge so the room shows. A garland and lights on it, the tree and a staggered pile of presents forward.
- **Thanksgiving:** the set table is the hero, brought forward and big. The chalkboard stands in front of the table's near end, and the hutch stays back against the wall.
- **New Year's:** the string lights really hang, from the board's corner to a pole.
- **A bigger window, so you can see outside**, in the rooms. This is for the build, and isn't in the mock-up.
- **Snow always falls** past Christmas's window, and **leaves always fall** past Thanksgiving's, whatever the real weather.
- **Clips on the TV:** later, not now (see "Later").

## The answer, in short

A fifth slide, `holiday`, built the way Weather is:

- **One layer for good:** it sits over what is there, fades in, and is never rebuilt. It loads only when a screen uses it.
- **No corner of its own:** it draws no time, date, weather or status. `SLIDES.holiday = { shows: ['holiday'] }` makes the **slide corner** add all four, so **Time Size** and the corner's switches apply without new corner code.
- **Inside the layer:** the holiday's scene, painted pieces placed by code on two canvases, then its live parts (the TV picture, the carved words, the chalk, the flip board), one effects canvas, and the row along the bottom.

Parts that already exist:

| Part | Already in the repo |
|---|---|
| The corner | `hk-saver.js` `slideCorner` / `cornerDraw`, `hk-saverlayout.js` `SLIDES` / `cornerFor` |
| Taking turns | `hk-saver-helpers.js` `slideOf`, `SLIDE_ORDER`, `extrasOf`, `EXTRA_ORDER` |
| Outdoor scenery | `web/hk/sky`: `land-<scene>-<day/dusk/night>.webp`, `*-lights.webp`, `holiday.json` (bulb, candle and balloon positions) |
| Sprites the effects use | `sleigh`, `bat1-3`, `leaf-*-f`, `sp-heart`, `sp-petal`, `sp-butterfly`, `moon-hallow`, `fog-wisp`, `web`, `stars.png` |
| The sky | `hkSky.scene(el, { skyOnly: true })`, as the Weather slide uses it |
| Light of day | `hkSky._land.light(elev)` gives day, dusk or night |
| Birthdays | `sky.birthdays` (`{ name, month, day }`), which the Day face already reads |
| US-only holidays | `US_ONLY_THEMES`, `place_sky_defaults()`; `hk-settings.js` `usThanksgiving` |
| The row along the bottom | Home Energy's `.enfoot` |

New: the holiday calendar, the slide and its scenes, its effects, its options page, and the art.

## The slide's frame (every scene)

All sizes are at 1280 x 800, scaled by `Z`. `Z` is Home Energy's own scale (`hk-saver-energy.js` `fitIn`): 1 at the wall tablet, `min(W/880, H/800)` when narrow, `min(W/800, H/1280)` upright, clamped 0.42 to 2.5. `M = 6 % of the shorter side` is the corner's margin.

- **The slide corner** at the top: the time and date at top left, House Status at top right, exactly as over Weather and Home Energy. Each painting keeps those areas calm.
- **The row along the bottom**, in Home Energy's `.enfoot` style:
  - **The Countdown:** Weeks ("6 and 5 days") and Weekends Left. It hides under 7 days.
  - **Coming Up:** the next three enabled holidays, with the days to each.
  - **Layout:** at narrow widths, two labeled lines; upright, stacked.
- **`foot`** is the top of the row, the scene's front edge. Nothing a scene draws may cross the row's words. `layout()` measures the row and gives each scene its `foot`.
- **Shapes:** `tall` when H > 1.05 W, `narrow` when not tall and W < 1000, `short` when H < 500. The checks cover five sizes: 1280 x 800 wall tablet, 880 x 800 beside the Side Pane, 820 x 1180 iPad upright, 390 x 844 phone, 844 x 390 phone sideways.
- **On the day itself,** the number gives way to a greeting ("Merry Christmas", "Happy Thanksgiving!", "2027 / HAPPY NEW YEAR!"), with the effects 35 % busier until midnight. Tomorrow reads "1 Day Until" or "Tomorrow".

## The scenes

Each scene is a list of painted pieces drawn back to front on a background canvas (`#paint`). Halloween also uses a front canvas (`#paint2`) for what stands in front of its fog. Its live parts are DOM placed over the canvases, and its moving parts go on the effects canvas. Every scene has the same live hooks: the number (`#num`), the arrival, the effects, and the quiet zones.

A **room** scene shares one layout, `room()` in the mock-up (`SCENES.paint`). The back wall's floor line is `floorY = foot - 96 Z` (34 upright). The chair rail is 118 Z above it, with a wallpaper border above the rail, so whatever stands against the wall is further away and smaller than what stands at `foot`. That difference is the depth.

### Christmas: a 90s living room at night (`roomReal`)

Back to front:

1. **The room:**
   - **Wall and floor:** the wallpaper tile above the border; the wainscot band, its border on top, between the border and the floor line; the carpet tile below. The tiles go at `Z` px per painted px of the half-size file.
   - **Window:** the night view `cover`ed into the panes, then the window's frame and drapes.
2. **The couch** against the wall, as big as a real couch beside the TV. Its near end runs behind the entertainment center (from `unit right - 140 Z`), its far end behind the tree, up to 560 Z wide. It has a wall shadow behind it (see "Shadows").
3. **The tree,** forward: its foot at `foot - 22 Z`, up to 640 Z tall, its top clear of House Status. Its 64 bulbs come from `room-tree-bulbs.json`, each listed in its painted color.
4. **The presents pile** at the tree's foot, in front of its skirt.
5. **The entertainment center,** nearest: 700 Z wide (72 % of W when narrow), 3:2, its foot on `foot`. At wide sizes **its left tower runs off the left edge** (`x = -0.1 w`). It is centered when upright and on the phone sideways, where the left edge would meet the time.
   - **The garland,** the unit's width, laid along its crown.
   - **The live parts:** the TV picture in the unit's screen opening, and 12:00 in the VCR's window.
6. **Light:** a warm glow from the tree, a vignette, and a slight evening dim.

- **The count:** on the CRT, as a VCR's blue on-screen display in VT323, with `▶ PLAY` and `SP` in its corners, a slow roll bar, scanlines and a glass sheen. The VCR's clock window flashes 12:00.
- **Arrival:** the TV powers on from a thin white line (`crton`), then the number rolls to its count.
- **Moving** (`roomStep`):
  - **The tree:** its lights chase in the four colors, the star glows, and tinsel glints.
  - **The garland:** its light string twinkles in step with the tree. Its bulbs are found by sampling the garland's lowest solid row in each column, then nudged up into the greenery.
  - **The TV:** its blue light plays on the wall.
  - **The window:** **snow always falls** behind the glass, with the frame redrawn over it. Now and then the sleigh crosses.
  - **In front of the cabinet:** none of the room's effects draw over the entertainment center.

### Halloween: a haunted house on a hill (`hauntReal`)

Back to front: the night sky (`cover`), the moon (`moon-hallow.webp`, already in the repo) with a halo, the bare tree, the house with its dark windows, the house's lit-window overlay, and the grounds strip (fence, graves, dead grass). Then come the effects canvas and fog. On the front canvas, in front of the fog: **the tombstone**, the grass strip across its foot, and two jack-o'-lanterns beside it.

- **The count:** carved into the stone in Cinzel: "Only / 13 / Days Until / HALLOWEEN / Sunday, October 31".
- **Moving** (`hauntStep`):
  - **The house:** the lit windows flicker, a figure crosses one window, and the painted shutter swings loose on another. Which windows are listed in `haunt-windows.json`.
  - **Bats:** they leave the attic and fly toward you.
  - **Ground:** the pumpkins flicker, and the fog drifts.
  - **Lightning:** soft, distant and rare.

### Thanksgiving: a 90s dining room at dusk (`thanksReal`)

The room's layout, with its own wall, wainscot, oak floor and plaid-draped window onto fall trees at dusk.

1. **The hutch,** against the back wall where the tree would be. It stays back: its place is the room's original tree place (`treeBack`), not the forward one. Its harvest row of pumpkins, gourds and apples sits at its foot.
2. **The table,** the hero, brought forward:
   - **Size and place:** up to 660 Z wide, its legs at `foot - 4 Z`, from 70 % of the way across the board.
   - **Upright:** centered and up to 720 Z. The board then covers its middle, which the owner accepted.
   - **Hot spots:** the candle wicks and steam origins come from `thanks-table.json`.
3. **The chalkboard** on its console, in front of the table's near end. The overlap is the depth.

- **The count:** chalk in Cabin Sketch: "Only / 18 / days 'til *Thanksgiving!* / Thursday, Nov. 26".
- **Arrival:** each line writes itself on in steps, left to right, one after another (`chalk.write`).
- **Moving** (`thanksStep`):
  - **The table:** the candles flicker, and steam rises from the hot food.
  - **The window:** **leaves always fall** behind the glass, with the bars redrawn over them.
  - **Hidden flames:** nothing draws where the board covers it, so a flame never shows through the board.

### New Year's: a rooftop party at midnight (`newyearReal`)

Back to front: the night sky, the invented skyline (a seamless strip, up to 62 % of the height, its foot at the floor line), and the rooftop (a parapet and the dark deck). Then come the light strands, the balloon bunch (forward, in the tree's place), the gold party table (in the couch's place), streamers and confetti on the deck at the balloons' foot, and the crates the board stands on.

- **The lights hang** (drawn in code, replacing the painted strip):
  - **The strands:** one long strand runs from the board's top right corner to a thin iron pole standing on the parapet at the right, mostly behind the balloons. A short run comes in from off the left edge to the board's top left corner.
  - **The curve:** each strand is a quadratic sag, its low point below both ends.
  - **The bulbs:** spaced about 34 Z along the curve, each a socket on the wire with a glass globe under it, twinkling (`newyearStep`).
- **The count:** a split-flap board in Oswald, three rows: the number large, then `DAYS UNTIL`, then `NEW YEAR'S`. On the day: `2027` in gold, then `HAPPY NEW`, then `YEAR!`.
- **Arrival:** every flap runs through the alphabet and settles left to right, about 70 ms apart (`flipTo`).
- **Moving:** fireworks rise from the skyline's horizon and burst, and gold confetti drifts.

### Every other holiday: outdoors

Valentine's Day, Easter, Mother's Day, Father's Day, the Fourth of July, birthdays and your own dates use the sky's landscapes (`land-<scene>-<light>`), following the house's sun. Each has a solid rounded number standing on the meadow, with its words beside it.

| Holiday | Scene | Effects |
|---|---|---|
| Valentine's Day | `winter` at dusk | hearts rising |
| Easter (computed), Mother's Day | `spring` | petals, butterflies |
| Father's Day | `summer` | butterflies |
| Fourth of July | `july4` | red, white and blue fireworks |
| Birthdays (`sky.birthdays`) | the season's, with the balloons and table from `holiday.json` | rising balloons, confetti |
| Your own date | the scene you pick | that scene's effects |

The four painted holidays also have an outdoor version: snow piling on the number, leaves landing on it, bats and fog, fireworks. Each holiday's Options can switch to it, and it is the fallback if a scene's art fails to load.

## Rules every scene follows

These came from the owner's review. The mock-up implements each one.

1. **Depth.** The hero object is forward, at `foot`, and big. Things against the wall stand on `floorY` and are smaller. Nearer things overlap farther ones, and the overlaps are deliberate: the couch behind the unit, the board in front of the table, the tree in front of the couch's end.
2. **Nothing floats: shadows** (`shadowFor`, `footOf`).
   - **Where the feet are:** a piece's feet are its lowest *solid* row (alpha over 200), measured once per image. Some paintings have empty space or a soft painted shadow below their feet; the couch has 7 % of its height.
   - **Against a wall** (couch, entertainment center, hutch): a soft shade on the wall behind it, and its floor shadow falls back toward the wall. Nothing spreads in front of its feet, and a thin dark line marks where it touches.
   - **Standing in the room** (tree, table, party table, balloons, crates): a soft shadow under and behind it, falling a little left, away from the room's light. It is clipped at the piece's front edge so it never spreads in front, plus a contact line.
   - **A pile** (presents, harvest): a small contact shadow along its bottom edge, column by column, so each gift meets the floor at its own depth.
   - **Shadows are part of the background picture,** drawn once per layout, with no cost per frame.
3. **A bigger window, so you can see outside** (new, not in the mock-up):
   - **Size:** about 1.4 times the mock-up's window, roughly the couch's width plus a third. Its sill stays hidden behind the couch's (or table's) back. At wide sizes its top runs off the screen's top edge, as a photo would crop it.
   - **House Status:** the window must stay clear of it at top right, or sit behind it. The checks prove the words are readable.
   - **The view:** the panes show more of the outside view, which needs no new art at these sizes.
   - **Wider art, optional:** a wider picture window, a double or triple sash, reads better than a square one stretched big. If wanted, ask Codex for `room-window-wide.png` and `thanks-window-wide.png`, about 2:1, with glass transparent and drapes the same fabric. Use the same request format as `ROUND-4.md`.
   - **Narrow and upright screens** keep the window whole, just under the corner, as the mock-up does.
4. **Always falling.** Snow behind Christmas's glass and leaves behind Thanksgiving's fall whatever the real weather says. They are decoration, as the sky's own Christmas snow is. With Effects Off or Reduce Motion, one still frame shows them mid-fall, so the window is never empty.
5. **Effects stay where they belong.**
   - **Windows:** what falls outside is clipped to the window's glass, and the frame and bars are redrawn over it, only within the glass, so nothing in front of the window is covered.
   - **Cabinets:** nothing draws over the entertainment center.
   - **The corner and the row:** a quiet zone fades the effects out behind them (`quietZones`).
6. **The live parts take their size from the painted piece.** The TV picture fills the unit's opening (x 600-1800, y 220-1130 of 2400 x 1600). The chalk sits in the board's face, the flaps in the board's opening, and the carving in the stone's face. Their type is in units of the piece's width (`--t`), so it scales with it.
7. **Night only.** Each scene is painted at night, or dusk for Thanksgiving. The room's light is warm from the right, and the vignette darkens the corners.

## The rules for the effects

The existing rules for slides still apply (`DESIGN.md` Motion, `hk-saver-energy.js` "what it costs a wall tablet"). These effects are the first thing on a slide to keep moving by design, other than Weather's sky, so these rules are firm:

1. **One effects canvas,** sized once, device scale capped at 1.5. No DOM per particle, no `backdrop-filter`, and no compositor animation per particle. Glows are a pre-drawn radial gradient per color, stamped (`glowOf`, `stamp`).
2. **A fixed budget:** at most about 90 flakes, 46 window flakes, 16 leaves or hearts, 9 window leaves, and 260 sparks. 30 frames a second at Full, 20 at Gentle with under half the particles.
3. **Only while it is up.** The loop starts in `draw`, stops once the fade out is done, and stops while the page is hidden. Nothing wakes itself.
4. **One layer for good,** hidden by opacity, as `.en` and `.wx` are. No `visibility:hidden`, and no remove and add at each turn.
5. **A still picture** under Effects Off, Reduce Motion, Flat or Sky Animations off: the scene and one frame of its effects. After that, no timers but the slide's own clock tick.
6. **Backgrounds are drawn once per layout,** cached by size and scene (`SCENES.paint` keys on scene, W, H, `foot` and scale). Only the effects canvas redraws.
7. **Images are loaded in `prep`,** so the first turn has them. Until a scene's pieces have all loaded, it shows its outdoor version. A sprite that has not loaded is skipped, never waited for.
8. **Arrival happens once,** as the slide lands (`arrived()`): the TV powering on, the chalk, the flaps, or the number rolling. Never on a redraw.

**Not measured yet:** this budget has not run on a house tablet. Slice 4 measures it, and the numbers in rule 2 come down if needed.

## Which holiday, and counting

- **Which one shows:** among enabled holidays within **Starts** days (default 60), **Next Up** takes the soonest, **Take Turns** takes each in turn, and **One Holiday** takes the one picked. With none in range, `holidayReady()` is false and the slide does not come, as Home Energy without data does not. The other slides carry on.
- **Counting:** whole calendar days in the house's time zone (`hkStats.tz`), from the date parts, never by dividing milliseconds, so a clock change cannot move the count. A slide showing at midnight rolls over on its next tick.

## Settings

Added to `SAVER_DEFAULTS` (`hk_core/settings/model.py`, beside `weather_slide`):

| Key | Values | Default |
|---|---|---|
| `holiday_slide` | bool | `False` |
| `holiday_pick` | `next`, `turns`, `one` | `next` |
| `holiday_one` | a holiday id | `christmas` |
| `holiday_days` | 30, 60, 90 | 60 |
| `holiday_off` | list of holiday ids | `[]`, plus US-only ones outside the US |
| `holiday_own` | up to 12 `{name, month, day, year?, scene}` | `[]` |
| `holiday_fx` | `full`, `gentle`, `off` | `full` |
| `holiday_outdoors` | list of holiday ids shown outdoors instead of their scene | `[]` |
| `holiday_hide` | subset of `SAVER_HOLIDAY_PARTS = ("count", "next")` | `[]` |

A one-off date (with `year`) drops off once it has passed. Names go through `esc`, up to 40 characters.

**Editor:** a **Holidays** row in `slidesGroups`, with **See It**, the corner line from `cornerWords('holiday')`, and a **Holiday Options** page. Add it to `SLIDE_KINDS`, to the `any` test, and to the reset list at line 507. The mock-up's lower panels show the rows and the Options page.

## Every place a slide is wired

Missing one of these is how a slide silently never comes ("they just keep showing photos", `saver_shows_check.py`). Search each file for `weather_slide`, `wxShowing`, `wxslide` and `'weather'`, and treat that as the checklist.

**Python**
- `hk_core/settings/model.py`: defaults, `SAVER_HOLIDAY_PARTS`, `SAVER_CHOICES`.
- `hk_core/settings/saver_designs.py:156`: the `*_hide` validation, and the new keys' validation.
- `hk_core/settings/looks.py`: Holiday Whimsy turns it on (decision 3).

**The settings' mirrors, which must stay in step**
- `web/hk/modules/hk-settings.js:204` and `web/hk/panels/hk-settings-model.js:2126`, with its summary at 2264-2266.
- `web/hk/cards/hk-strategy.js:2909`: the strategy drops any key it does not list.
- `web/hk/saver/hk-saver-helpers.js`: `readCfg` (132), `SLIDE_ORDER` and `slideOf` (276-283), `EXTRA_ORDER` and `extrasOf` (295-305).

**The screensaver, `web/hk/modules/hk-saver.js`**
- `holidayModule`, `holidayPrep`, `holidayReady`, `holidayLayout`, `showHolidaySlide`, `hideHolidaySlide` and `leaveHoliday`, modeled on the Weather block (2639-2722).
- `slideNow` (1528), `fcVisible` (1663), the band test (1733).
- `underCards`' class list (2587).
- `cornerDraw`'s `sl`, so the corner clears the slide's words.
- The turn paths: 1054, 1084-1089 (`slideOf`), 1415, 1476, 2740-2765 (`exNext`, `exShow`, `exHide`), 3169, 3922.
- The client hand-off: 641.
- The preview: `previewSlide` (4317), `previewStatus`, and the kinds it accepts.
- The status: 4427. The tests' export: 4452-4458.

**Elsewhere**
- `web/hk/saver/hk-saver-css.js`: every `[wxslide]` rule gets `[hlslide]` (113, 119-127, 606-610).
- `web/hk/modules/hk-saverlayout.js:338`: `SLIDES.holiday`.
- `web/hk/panels/hk-saver-editor.js:187, 507, 1283-1292`.
- `web/hk/settings/hk-settings-screen-pages.js:1130, 1229-1263` and `hk-settings-screen.js:303`: the older Settings pages, and the Options page.
- `tools/headless/saver_shows_check.cjs:385`: the layer it looks for.
- `tests/fixtures/ts_check.json`, `tools/typecheck/baseline.json`, the CSS snapshot, `tools/split_manifests/saver.json` and the route table (`tools/route_table.py --write`) if the art is served from a new path.

`tests/test_file_sizes.py` keeps a ratchet on `hk-saver.js`. If the wiring pushes it over, move the block to `web/hk/saver/` through the split manifest (`tools/split_js.py`). Never raise the ratchet.

## New files

- `web/hk/modules/hk-holidays.js`: pure dates, no DOM. `hkHolidays.list(now, opts)` returns `[{id, name, date, days, scene, fx, hello}]`. It replaces the mock-up's `HOL` table and date helpers.
- `web/hk/modules/hk-saver-holiday.js`: the slide, with the same API as `hkSaverWeather`: `create`, `ready`, `draw`, `arrived`, `layout`, `setClient`, `setHide`, `leave`, `destroy`. The frame, the row, the outdoor hero and the live parts' markup (`tvHtml`, `stoneHtml`, `chalkHtml`, `flapHtml`).
- `web/hk/modules/hk-saver-holiday-scenes.js`: the four scenes' layouts and painting. This is the mock-up's `SCENES`, with the rough-drawing code removed: only the measurements it makes (`data.place`) stay, and the painted pieces draw from them. Loaded with the slide.
- `web/hk/modules/hk-saver-holiday-fx.js`: the effects, from the mock-up's `FX`. Loaded only by the slide.
- `web/hk/holiday/`: the art (below), with bulb, window, candle and string positions as one `scenes.json`.
- **Fonts,** bundled locally (the house serves no Google Fonts): VT323, Cinzel, Cabin Sketch and Oswald, all under the SIL Open Font License. Only the glyphs used, as WOFF2 subsets, loaded only when their scene shows. Confirm each license and keep its text beside the font.

Outdoor scenes go over the Live Sky: `hkSky.scene(el, { skyOnly: true })`, then the land image (the art's top is transparent), the wash and the effects canvas. Under Flat, a gradient and no scene. The mock-up fakes this sky with a gradient.

Tapping the slide only wakes the screen, as any other tap does. It has no page to open.

## Shipping the art

- **The source:** the paintings are full-size PNGs, git-ignored, on the owner's Mac in `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes/output/` (Christmas and Halloween: 23 pieces, the garland, the entertainment center and the pile) and `/Volumes/data/mantel/docs/artwork-handoff/holiday-scenes-2/output/` (Thanksgiving and New Year's: 19 pieces). A worktree has none of them, so read them from those paths.
- **Unused pieces:** the mock-up no longer uses `room-tv.png`, `room-tv-antenna.png`, `room-stand.png` or `room-presents.png` (replaced by the entertainment center and the pile), nor `ny-string-lights.png` (code draws the strands).
- **What ships:** WebP at half size, exactly as `docs/phase20/mockup/scenes/` has them (`quality=86, method=6, exact=True`): about 2.5 MB for all four scenes, each loaded only when its holiday shows. Half size covers a 1920 x 1200 screen. Write the conversion as a small script in `tools/` that reads the PNGs and writes `web/hk/holiday/`, so a repainted piece is one command.
- **Positions:** fold `room-tree-bulbs.json`, `haunt-windows.json` and `thanks-table.json` into `web/hk/holiday/scenes.json`, in full-size px, as the files have them.
- **Keep a backup** of the full-size originals outside the repository; the owner chooses where.

## Slices

Each slice ends with its tests and `tools/ci.py quick`. Run `tools/ci.py full` from a local-disk worktree before each push.

1. **Dates.** `hk-holidays.js` and `test_holidays.js`.
2. **Settings.** The keys, mirrors, strategy, `readCfg` and validation. The slide is still absent.
3. **The slide, outdoors.** The layer, the outdoor hero, the row, the corner, all sizes, no effects. Then wire it in everywhere on the checklist.
4. **One scene, Christmas, with its effects:**
   - **The art:** the conversion script, `web/hk/holiday/`, and the fonts.
   - **The scene:** its layout from the mock-up, the bigger window (rule 3), shadows, and the live TV.
   - **Measure first:** the frame cost under CPU throttling (LoAF at CPU 4, as `swipe_motion_check.py` does), and on a real tablet if the owner can check one. Adjust the budget before the rest.
5. **The other three scenes,** and the outdoor effects for the other holidays.
6. **The editor and Holiday Options.** See It, the Options page, Add a Date, and Outdoors per holiday.
7. **Docs and screenshots.** `docs/guide/Screensaver.md`, `CHANGELOG.md` under Unreleased, and this plan's status and Build log.

## Tests

- **`hosts/ha/custom_components/hk_frontend/tests/test_holidays.js` (new):**
  - **Dates:** Easter for 2024-2035 against known dates; Thanksgiving, Mother's Day and Father's Day.
  - **The count:** across both clock changes; in a time zone unlike the browser's; today is 0, tomorrow 1, and the day after rolls to next year.
  - **Edge cases:** New Year's across the year's end; February 29 birthdays, shown on the 28th in other years.
  - **Picking:** Next Up, Take Turns, One Holiday; nothing in range; `holiday_off`; one-off dates that have passed.
- **`test_saver.js`:** `readCfg` defaults and rejects; `slideOf` and `extrasOf` with `holiday`; the `SLIDE_ORDER` turn.
- **`test_saverlayouts.js`:** `cornerFor('holiday')` is all four, and `corner_hide` removes them.
- **`test_settings.py` / `test_screensaver.py`:** defaults, the mirrors in step, and validation that refuses unknown ids, parts and bad dates.
- **A scene placement test** (new, headless, both engines), at each of the five sizes, each scene, a count, tomorrow and the day, with the corner at 100 % and 250 %:
  - **The words:** the live words stay inside their piece, the corner and the row meet nothing, and no live word is off screen.
  - **The window:** it doesn't hide House Status.
  - **The floor:** every floor-standing piece's feet sit at or above `foot`.
  - **The mock-up already checks this:** `docs/phase20/mockup/check_mockup.cjs` does it for the mock-up. Port its idea, not its code.
- **`saver_shows_check.py`:** add `holiday_slide=True` to the slide runs with a pinned clock (Playwright's clock, so a holiday is in range). A slide from saved settings must reach the screen, with the corner clear of its words at 100 % and 200 %.
- **`saver_editor_check.py`:** the row, See It, Holiday Options, and a Save that round-trips.
- **A leak check:** after 20 turns, canvas sizes and layer count are unchanged, and no animation frame is pending once the slide has left.
- **An art check:** every file `scenes.json` names exists in `web/hk/holiday/`, and each scene's pieces load.

## Definition of done

- A saved `holiday_slide` brings the slide among photos and over a clock, and it takes turns with the others.
- Time, date, weather and status are the slide corner at every size, in the Look's face, and follow Time Size and the switches.
- The four scenes match the mock-up, plus the bigger window. Every floor-standing piece has its shadow, and nothing floats. Snow and leaves fall in their windows.
- Nothing overlaps at 1280 x 800, beside the Side Pane, iPad upright, phone and phone sideways, checked by eye in WebKit first: 1280 x 800 first, equal margins, ink lined up.
- Effects Off, Reduce Motion and Flat give one still picture and no running loop.
- `tools/ci.py full` passes, and the diff is grepped for American English.
- **No house release unless the owner says so.**

## Decisions for the owner

Each has a recommendation, and the build uses it unless the owner says otherwise.

1. **The VCR's flashing 12:00** stays. It is a small joke on a screen that also tells the real time, and easy to remove.
2. **Effects default:** Full, because a slide comes only now and then.
3. **On by default:** off, like the other slides, and on in the Holiday Whimsy Look.
4. **The list:** as in the tables, with Hanukkah, Diwali, Lunar New Year and others added through Your Own Date for now. Those dates move every year, so a house would re-enter them.
5. **The window of days:** Next Up, 60 days. In November that means Thanksgiving first, then Christmas from November 27. For Christmas the whole time, choose One Holiday.
6. **Greetings:** as in the mock-up.
7. **The outdoor number's rounded figures** come from Apple's `ui-rounded`. Other browsers fall back to a plain bold. Accept this.
8. **The wider window art** (rule 3): optional, after the build shows the scaled window. Recommended: try the scaled window first.

## Later

- **Your own clips on the TV** (the owner, 2026-11-08: "it would be cool, but the thought of finding clips... is daunting"). Not now. If it comes:
  - **Takes turns:** the TV shows a clip, then cuts to the count with a static flicker, like changing channels, and back.
  - **The format:** short muted MP4s, not GIFs.
  - **Where they live:** on the house, like the photos, never in the repository.
  - **The cost is small:** the TV is already a live element.
- **Scenes for the other holidays**, the same system:

  | Holiday | Scene | Where the number goes |
  |---|---|---|
  | Valentine's Day | a candlelit table by a rain-streaked window | a neon heart sign |
  | Easter | a spring garden after an egg hunt | painted on a big egg |
  | Fourth of July | a lake dock at dusk | a hand-painted wooden sign |
  | Birthdays | a 90s kid's party | number candles on the cake |

- **Day and dusk versions** of the rooms, following the house's sun as the outdoor scenes do.

## Prompt for the build session

```text
Build the Holiday slide for Mantel's screensaver in /Volumes/data/mantel. The design is finished and approved; your
job is to build it, faithfully, as production code.

Read first, in full:
- docs/phase20/HOLIDAY-SLIDE.md: the plan. Its decisions stand. It names every place a slide is wired and every rule
  each scene follows.
- docs/phase20/mockup/holiday-slide.html: the reference implementation the owner approved. Serve the repository root
  with any static server and open /docs/phase20/mockup/holiday-slide.html (it loads scenes/ beside it and the sky's
  sprites from web/hk/sky/); try each holiday at each screen size. Its layouts, shadows, effects and arrivals are the
  spec. Port its behavior into the plan's new files; do not copy its rough-drawing code or its demo controls.
- web/hk/modules/hk-saver-weather.js and hk-saver-energy.js: the two slides to model it on.
- CONTRIBUTING.md and docs/development/Building-and-Testing.md.

Build it slice by slice as the plan lists them. Three things matter most:
1. The slide draws no time, date, weather or status of its own: the slide corner does (SLIDES.holiday), so Time Size
   and the corner's switches apply unchanged. Use "Every place a slide is wired" as a checklist; a missed place makes
   the slide silently never appear.
2. Depth and grounding: the scenes' rules (depth, shadows at the real feet, the bigger window, snow and leaves always
   falling, effects clipped to where they belong) are what the owner reviewed hardest. Check each by eye at all five
   sizes.
3. The effects' rules: one canvas, the fixed budget, running only while the slide is up, one layer hidden by opacity,
   one still picture under Effects Off, Reduce Motion, Flat or Sky Animations off. In slice 4, measure Christmas's
   frame cost before building the rest, and record it in the plan's Build log.

The art: the full-size paintings are git-ignored on this Mac in docs/artwork-handoff/holiday-scenes/output/ and
docs/artwork-handoff/holiday-scenes-2/output/ under /Volumes/data/mantel (read them by that absolute path from your
worktree). Ship them as the plan's "Shipping the art" says, through a conversion script.

Rules of this repo:
- American English everywhere; grep the diff before committing.
- Work in a worktree on local disk (/private/tmp/...), not on the SMB checkout. Set PYTHONPATH to the worktree, and set
  NODE, PLAYWRIGHT_PATH and CI_JOBS, or browser checks are skipped. tools/ci.py full must pass before each push.
- Run HK_PRIVATE_FILE=~/.config/mantel/private-words python3 tools/check_private.py before each push. Fetch and merge
  origin/main first, never force-push, and push to main when a slice is finished and its checks pass.
- Do not raise the file-size ratchet (tests/test_file_sizes.py); split through tools/split_js.py instead. Since phase
  18, Mantel won't start with an undeclared route: run tools/route_table.py --write if you serve anything new.
- Screenshots in WebKit at 1280x800 first, then beside the Side Pane, iPad upright, phone and phone sideways. Look at
  them; line things up by ink and baseline.
- Do not play any sound. Do not release to the house, tag, or touch the house: the owner decides that.
- Models: you run as Opus 5.5 at Medium effort; agents you start run as Sonnet 5.5 at High effort.

Done means the plan's "Definition of done". If something unforeseen comes up, take the safest choice consistent with
the plan, write it in the plan's Build log, and keep going. Ask the owner only for what only they can do. Finish by
reporting what was built, what passed, and what still needs a real tablet.
```

## Build log

- 2026-11-08: design finished. Four painted scenes approved in the mock-up after four art rounds. Plan refreshed for the build.
