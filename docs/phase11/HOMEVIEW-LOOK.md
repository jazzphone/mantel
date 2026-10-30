# Phase 11: a HomeView-style look for the Home Grid and the rest of HK (design, 2026-10-30)

**Status: a design for the owner's approval. Nothing here is built yet.** The mock-ups are a private claude.ai
artifact: https://claude.ai/artifact/BK42uk5cAm7k1PCXFVTSvy (interactive; light and dark). Its wallpapers, clock, icons and
camera scenes are drawn for it. No image of Apple's is used, and the look is described as "inspired by" Apple's
HomeView at most.

The ask: how close can the Home Grid ([HOME-GRID.md](HOME-GRID.md)) come to the look of Apple's HomeView smart
display? The Home Grid already has the grid itself, blocks in several sizes, swipeable views, nightstand starters,
an analog clock, Night Mode, Glass and Frosted, and camera, calendar, weather, music and scene blocks. What it lacks
is mostly the look:

- tiles with the icon centred above the name and room;
- a "big number" thermostat;
- a bright glass over vivid wallpapers that tint the tiles;
- square cells, and a square screen;
- a camera face with up to nine feeds;
- more detail as someone comes near;
- a swipe from page to page, with the tab bar following.

## Decisions already made (the owner, 2026-10-30)

| # | Question | Answer |
|---|---|---|
| 1 | Square cells on wide tablets? | **Yes, on their existing layouts.** The 3 × 3 Square type is only for a screen that really is square |
| 2 | A landscape starter? | **"Home with Pane":** a 3 × 3 grid beside the screensaver's Calendar / Music pane, with **Pane Side: Left or Right**, one setting for Home and the screensaver. The recommended landscape starter |
| 3 | Where does the new look reach? | **Every surface** (sheets, menus, the tab bar) **except HK Settings**, which stays iOS Settings |
| 4 | What first? | **Swipe Between Pages** |
| 5 | Defaults | **Everything is an option.** A screen looks as it does today until someone picks the new style |
| 6 | Out of scope | Face and voice recognition, and an Intercom tile |

## Rules for every phase

- **Options only.** No default changes. A layout saved today draws exactly as it does now: every new key is absent
  until chosen, and absent means today's behaviour.
- **Both products.** Mantel and HK Frontend's Home Grid get every phase: it is shared JS (`web/hk`) and one checker
  (`hk_core/settings`).
- **Per screen, with All Screens.** A screen setting is `None` for "Same as All Screens" and a value for its own,
  with "Reset to All Screens", as `camera_live_video` and `sky_animations` are (`hk_core/settings/model.py`,
  `hk-settings.js` "Just This Screen" / "Same as All Screens").
- **Both catalogs, one test.** A Home Grid catalog change is made in `web/hk/cards/hk-grid-catalog.js` and its mirror
  `hk_core/settings/home_grid.py`; `tests/test_hk_core_home_grid.py` (sizes, sources) and
  `tests/test_hk_core_home_grid_cards.py` (options) keep them equal.
- **HK Settings stays iOS Settings** (DESIGN.md, 2026-10-12). Bright Glass never reaches it.
- **Our own art.** Wallpapers, clock faces, icons and sample camera scenes are drawn by us. Apple's fonts and glyphs
  never ship ([Rules 5](../development/Rules.md)).

## The numbers: what a square cell is

Today a cell is **196 × 150** logical px (`C.TILE`; the grid's rows in `HkHomeGridView._place`, hk-layout.js
~1905), and the whole canvas is scaled uniformly to fit the screen (`_measure`, ~1966: never above 1 unless Fill
the Screen).

**A square cell is 196 × 196 logical px.** The width stays, so every card's width-based layout holds; only the
row grows from 150 to 196. The canvas still scales as a whole, so the cell's size on the glass depends on the
screen. Measured for a 1180 × 820 landscape tablet, a 72 px tab bar with its margins (84 px of room) and the
27.2 px page gutter:

| Layout | Logical canvas | Scale | Cell on screen | Tile text |
|---|---|---|---|---|
| Today: 6 × 4 tiles, top band on | 1280 × 754 | 0.92 | 181 × 138 | 13.8 px |
| 6 × 4 square, band off, tab bar at the bottom | 1280 × 868 | 0.85 | **166** | 12.7 px |
| 6 × 4 square, band off, no tab bar | 1280 × 868 | 0.92 | **181** | 13.8 px |
| **Home with Pane:** 3 × 3 square, Fill the Screen, tab bar under the grid | 662 × 662 | 1.11 | **218** | 16.7 px |
| Home with Pane, no tab bar | 662 × 662 | 1.24 | 243 | 18.6 px |
| Square screen, 3 × 3, 800 × 800, no tab bar | 662 × 662 | 1.21 | 237 | 18.1 px |

So the full 6 × 4 of square cells is about 166–181 px a cell, and its text is smaller than today's. Home with
Pane's 218 px cells are the HomeView proportion, which is why it is the recommended landscape starter.

## Phase 0. Swipe Between Pages (Phase 1 of the work)

**What you see.** A sideways swipe anywhere on a page takes you to the next or previous page. The page follows
your finger, the next page comes in beside it, and the tab bar's highlight slides along with it, so it is always
under the page you are about to land on. The wallpaper or sky stays still behind; only the plates move.

- **Order.** The tab bar's tabs, left to right (Home first), as the bar shows them. Pages under More are reached
  from More, not by swiping. With no tab bar, the side menu's order (Home, then its Categories). On a room page
  opened from Rooms, a swipe goes to the next room in Room Order.
- **A Home Grid's views go first.** With two or more views, a swipe turns the views (as today), and a swipe past
  the last view goes on to the next page. A swipe back from the next page lands on the last view.
- **What keeps its own swipe.** Anything that moves sideways itself: the scenes row, a camera strip,
  `hk-pager-card` with more than one page (hk-layout.js ~2034), sliders, the thermostat's ring, inputs, and
  anything marked `data-hk-control`. The same list `_swipeViews` (hk-layout.js ~1805) already uses, moved into one
  shared test.
- **Edges stay clear.** A swipe that starts within 24 px of a side is not a page swipe: the left edge is the side
  menu's (`swipe`), and in Safari either edge is the browser's back and forward.
- **Off in Edit mode**, in the editor's preview, with a detail sheet or a pop-up open, and while the screensaver
  shows.
- **Thresholds**, as the grid's views: it starts past 10 px of sideways travel at 1.4 times the vertical; it lands
  past a fifth of the width, or on a flick over 0.5 px/ms. Past the first and last page it gives a third of the
  travel and springs back.
- **Reduce Motion:** the page cross-fades (`DUR.fade`) instead of sliding; the highlight jumps.
- **VoiceOver:** nothing new to learn: the tab bar is still the way to move, and the swipe is an addition (a
  three-finger swipe stays VoiceOver's).

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Swipe Between Pages (All Screens) | `menu.swipe_pages` | `auto`, `on`, `off` | `auto`: on where a tab bar shows, off otherwise | HK Settings → Menu |
| Swipe Between Pages (a screen) | `swipe_pages` (board) | `None` (Same as All Screens), `auto`, `on`, `off` | `None` | HK Settings → Screens → the screen → Menu Settings, beside the tab bar's settings |

**Code.**

- `web/hk/shell/hk-view-host.js`: the gesture and the slide. The host already keeps Home, the last four pages and
  the current one (`cache`, `KEEP_RECENT = 4`, `letGo()`); the neighbour's cached view slides in beside the
  current one. A neighbour not in the cache shows its page's ground and title while it is built, and builds as the
  swipe commits (never during the drag).
- `web/hk/modules/hk-tabbar.js`: a `follow(fraction)` that places the highlight between two tabs while the finger
  moves (the `::before` of `.tab.here`, set through `--hx`), then lands it with the existing `slide()` on the
  spring (`cubic-bezier(.34,1.24,.42,1)`, .46 s).
- `web/hk/modules/hk-drag.js`: `hkDrag.press` already classifies a press as `press`, `drag` or `scroll`; the page
  swipe uses it with `axis: 'x'`.
- `web/hk/cards/hk-layout.js`: `_swipeViews` hands a swipe past its last view to the host (an event,
  `hk-swipe-past`, with the remaining travel).
- `hk_core/settings/model.py`, `changes.py`, `hk-settings-model.js` and `hk-settings.js`: the setting.

**Performance.** Only `transform` moves, on the two pages' roots. With Blur's Shared Layer, two backdrop layers live
for the length of a swipe (the current page's and the neighbour's), then one. The sky is fixed and does not move.
On a tablet the slow-tablet ladder has flagged, the neighbour slides in as a plain plate (its ground colour, no
blur) and gets its glass when it lands.

**Checks.**

- jsc: `test_tabbar.js` (the follow and the order), a new `test_pageswipe.js` (the classifier, the edges, the
  thresholds, views first, the order with and without a bar, rooms), `test_homegrid.js` (views past the last).
- Headless: a new `page_swipe_check.py` in Chrome and WebKit at 1180 × 820, 820 × 1180, 390 × 844 and 844 × 390,
  with touch: a swipe on a tile turns the page; one on the scenes row, a slider or a pager block does not; one
  from the left 24 px opens the menu; the highlight's position matches the page after each swipe.
- Frame timing on the slowest wall tablet with `hk-fps.js` (stays above `SLOW_FPS` = 45 during a swipe).
- `tools/ci.py full`.

**Risks.**

- Vertical scrolling pages (Lights, Climate) must still scroll freely: the 1.4 ratio and `touch-action: pan-y` keep
  a mostly-vertical drag the browser's. To check on the iPad, where Safari is quickest to claim a pan.
- A wall tablet's WebView has about one screen of tile memory to spare on Home (hk-popup.js notes). Two pages
  composited at once may cost a blink on the oldest tablets; the plain-plate fallback above is the answer if it does.
- A swipe that starts on a card's own control must never move the page. Every card that adds a sideways control
  later must carry `data-hk-control`. The shared test lists them.

## Phase A. Square cells and HomeView-style starters (Phase 2)

**What you see.** A Home Grid can have square cells. A new screen type, **Square (3 × 3)**, is for a screen that is
square. Each screen type gets HomeView-style starters filled from the house.

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Cell Shape | `home_grid.cell` | `tile` (196 × 150), `square` (196 × 196) | absent = `tile` | Editor → Screen → Grid |
| Screen Type: Square | `SCREEN_TYPES` | `['square', 'Square', 3, 3, false, [800, 800], 'square']` | — | Editor → Screen → Screen Type |

Screen types gain a seventh field, the cell shape; the existing six keep `tile`. Choosing Square sets 3 × 3, band
off, square cells and Fill the Screen. Changing Cell Shape on any type keeps its blocks where they are (the cells
change shape, not position).

**Starters** (hand-written like `NIGHTSTAND`, hk-grid-editor.js ~131, filled from the house: the screen's room's
thermostat, the front door lock, the house's scenes):

| Screen type | Starter | Blocks |
|---|---|---|
| Tablet, Landscape | **Home with Pane** (Phase A2, recommended) | thermostat L in Big Number, Numbers clock S bare, a scene, the front door lock, the room's lights; the pane on Calendar with Music |
| Tablet, Landscape | **Square, 6 × 4** | thermostat L Big Number, Numbers clock S bare, cameras L, weather W, then centred S tiles: two scenes, the lock, lights, a fan |
| Tablet, Portrait | **Square, 3 × 5** | the landscape set re-flowed, the pane as a band (A2) |
| Phone, Portrait | **Square, 2 × 4** | thermostat T Big Number, clock S, lock, lights, a scene |
| Square | **HomeView-style** | thermostat L Big Number, Numbers clock S bare, then scene, lock and lights S |

**Schema.**

- `home_grid.py` `_shape`: accept `cell` in `("tile", "square")`, stored only when `square`. `rows` stays 2–6.
- `hk-grid-catalog.js`: nothing per card; `hk-base.js` `HOME_GRID` gains `square: 196` (the test reading its size
  string gains it too).
- `HkHomeGridView._place`: rows are `repeat(rows, 196px)` for square; `_measure` uses 196 in its height;
  `--hk-cell-h` becomes 196. The editor's `scaleAt()` (hk-grid-editor.js ~154), which hard-codes 150, reads the
  same table.

**Every card at square heights.** Cards learn their class from `size` and `--hk-cell-w/-h` and lay out with
container queries, so most follow. Each card × size is checked at its square height (S 196 × 196, W 402 × 196,
T 196 × 402, L 402 × 402, XL 608 × 402, XXL 1226 × 402). Expected work: the room card and accessory groups (their
row count is height-driven: more rows show), the calendar (more events), now playing (the art grows), the security
and timers keys (centre their content vertically).

**Files.** `hk-layout.js`, `hk-grid-editor.js`, `hk-base.js`, `home_grid.py`, the cards whose container queries
need a square case (`hk-grid-cards.js`, `hk-tile.js`), `tests/test_hk_core_home_grid.py`.

**Checks.** `test_homegrid.js` (square rows, the measure), `test_grideditor.js` (the type, the starters, Cell Shape
keeps positions), `tests/test_hk_core_home_grid.py` (`cell`), `grid_blocks_check.py` at square heights for every
card and size, `home_grid_visual_check.py` for each new starter in Chrome and WebKit at iPad and phone sizes.

**Risks.** A 6 × 4 of square cells draws text at 12.7 px on a landscape tablet (the table above): legible at arm's
length, small across a room. The starters say so in their description, and Home with Pane is the one offered first.

## Phase A2. Home with a Side Pane (Phase 2)

**What you see.** On a wide tablet, a 3 × 3 grid of 218 px square tiles beside a full-height pane: the
screensaver's own Calendar and Music pane. **Pane Side** puts the pane on the left or the right; it moves on the
Home screen and in the screensaver together.

**The pane is the screensaver's** (hk-saver.js ~1037, "THE PANE": `.pane`, `PANE_W` = 400, the calendar list and
the music view). The Music half is already a card, `hk-music-pane-card` (hk-saver.js ~3640), which the Now Playing
side pane uses, scaled 0.85–1.3 by its width and already drawn for a left side (`:host([side="left"])`, ~3617). The
Calendar half becomes a card of the same kind, `hk-calendar-pane-card`, cut from the screensaver's list so both
draw the one code. Code reused, not copied.

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Side Pane | `home_grid.pane` | absent, or `{content: "calendar" \| "music" \| "both", days: 1–7}` | absent (no pane); a new pane is `both`, 2 days | Editor → Screen → Side Pane |
| Pane Side (All Screens) | `screensaver.pane_side` | `right`, `left` | `right` | HK Settings → Screensaver → Options → Side Pane |
| Pane Side (a screen) | `screensaver_options.pane_side` | as the screen's other screensaver options: `None` follows All Screens | `None` | HK Settings → Screens → the screen → Screensaver Options → Side Pane |

- **Calendar with Music** (`both`) is the screensaver's: the calendar, with the music under it while something
  plays (or is paused, within Hide After a Pause).
- **One side for the whole screen.** The Home Grid reads the screen's Pane Side. The Now Playing pane
  (`np_side`, Show As: Side Pane) follows it while its own is unset, so one choice moves all three panes. A screen
  whose Now Playing side was set on its own keeps it.
- **No pane twice.** While Home shows its own pane with music in it, the Now Playing pane and bar stay closed on
  Home (they still open on the other pages).
- **A pane needs 3 columns.** hk_core refuses `pane` on a 6- or 2-column grid (`grid`); the editor offers Side Pane
  only on a 3-column grid, and the Home with Pane starter sets 3 × 3, square, Fill the Screen and band off.

**Layout.**

| Screen | The pane |
|---|---|
| Landscape tablet, 1180 × 820 | full height, 444 px wide beside a 736 px grid; the tab bar centred under the grid, not the pane |
| Landscape, no tab bar | 360 px beside an 820 px grid (the pane's own scale, 0.9) |
| Portrait tablet, 820 × 1180 | a band under the grid, 276 px tall, the grid 820 px square above it |
| iPad, 1194 × 834 / 1366 × 1024 | as the landscape tablet: 444 px / 426 px of pane, cells 227 / 278 px; portrait, a band |
| Phone (under 640 px) | no pane; the grid alone |
| iPhone Duo, folded (382 × 678 of page, the 84 pt strip at the side) | no pane |
| iPhone Duo, open (669 × 951) | a 198 px band: the calendar's next two events, or the mini player while music plays |

**Schema.** `home_grid.py` `_shape`: `pane` (`content` in `PANE_CONTENT = ("calendar", "music", "both")`, `days`
1–7, needs `cols == 3`). `model.py`: `pane_side` in the screensaver's defaults and `PANE_SIDES = ("right", "left")`,
checked in the screen's `screensaver_options`. The JS mirror in `hk-settings-model.js` and the parity test.

**Files.** `hk-layout.js` (`HkHomeGridView` lays the grid beside the pane, sizes it for 3 columns, publishes
`--hk-pane-l/-r` as hk-popup.js's `publishPane` does, so the tab bar keeps clear), `hk-saver.js` (Pane Side for the
screensaver's pane: the CSS's `right:0`, `border-left`, the photo's width and the `.fc` offsets, mirrored;
`hk-calendar-pane-card`), `hk-popup.js` (`placeFor`: no Now Playing pane on a Home that has one; `np_side`
follows), `hk-grid-editor.js` (Side Pane group, the starter), `hk-settings.js` (Pane Side), `model.py`,
`home_grid.py`.

**Checks.** `test_homegrid.js` (pane placement, both sides, the band in portrait, none on a phone),
`tests/test_hk_core_home_grid.py` (`pane` refused off 3 columns), `tests/test_hk_core_screensaver.py`
(`pane_side`); headless screenshots of the pane on each side on the Home screen and in the screensaver, the music
pane while something plays, the portrait band, and a WebKit run at iPad size.

**Risks.**

- The screensaver's pane was written for one place. Its photo width, the forecast's offsets and the clock's
  `right:` all assume the right; each needs a left case. The checks above look at each.
- Two copies of the calendar list (screensaver and Home) drawn at once would double its updates; the card shares
  one source.

## Phase B. Centred tiles (Phase 2)

**What you see.** A **Tile Style** of **Centred**: the icon in the top half, then the name and the room (or the
state) under it, all centred. Lit tiles keep HK's rule: a white plate, the glyph in its colour in its circle, dark
text. Off tiles: the glyph bare, in its own colour (in Bright Glass, white).

**Applies to:** the Home Grid's accessory, scene, action and lock tiles (`hk-grid-entity-card` → `hk-tile.js` in
its tall layout; `HkGridKey`, hk-grid-cards.js ~739, `KEY_CSS` ~718), and the room pages' Tall pills. Regular
(short) pills stay as they are: a wide, short pill with everything centred reads badly.

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Tile Style (All Screens) | `look.tile_style` | `home`, `centred` | `home` | HK Settings → Appearance |
| Tile Style (a screen) | `tile_style` (board) | `None`, `home`, `centred` | `None` | HK Settings → Screens → the screen → Appearance |
| Tile Style (a block) | home_grid item `tile` | absent (Same as Screen), `home`, `centred` | absent | Editor → the block → Appearance |

**Design.** In a 196 × 196 cell: the glyph 30 px (bare) or the 42 px well (lit), its centre at 38 % of the
height; the name 15 / 600 and the room 13 / 500 in `ink-2`, 18.6 px apart, centred, the name's baseline at 74 %;
two lines at most, the name ellipsed. In a 196 × 150 cell the same, the glyph's centre at 34 %.

**Code.** A layout variant of the existing tiles, keyed by an attribute (`tile="centred"` on the card's host,
read by CSS only), so taps, holds, states and the press animation are the same code. `hk-tile.js`,
`hk-grid-cards.js`, `hk-strategy.js` (room pages' Tall pills), `home_grid.py` (`tile` on an item), `model.py`.

**Checks.** `test_gridcards.js` (the attribute reaches each tile kind), `test_pillgeom.js` (the centred geometry,
and Home's unchanged), `home_grid_visual_check.py` with both styles; `test_csssnapshot` (the new CSS only).

**Risks.** Long names: "Living Room Floor Lamp" in 196 px wraps to two lines and pushes the room out. The rule
above (two lines, the name first) keeps the room on longer names only when it fits.

## Phase C. Big Number thermostat (Phase 2)

**What you see.** The thermostat block's **Style: Big Number**: the target temperature very large, ↓ and ↑ at the
bottom corners, the name and room centred between them. In heat-and-cool, the two targets side by side at 0.62 of
the size; a tap picks one (underlined), and the arrows step the picked one. A press and hold on the number opens
the modes; a tap on the name opens the thermostat's sheet. While it heats or cools, a small status line over the
number: "Heating to 68° · 66° now".

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Style | thermostat `opts.style` | `dial`, `big` | absent = `dial` | Editor → the thermostat block |

Sizes T and L (XL stays the climate sheet).

**Design.** The number follows the weather block's Big Temperature (hk-weather.js ~1535): container units,
`min(46cqh, 40cqw)`, weight 500, tabular figures, letter-spacing −0.04 em; in T, `min(30cqh, 52cqw)`. The arrows
are 44 px targets. A step is the entity's `target_temp_step` (else 1 °F / 0.5 °C), sent through the gateway after
a 600 ms pause, as the dial sends.

**Code.** `hk-control.js` beside `_climate` (~522), sharing its service calls; `hk-grid-catalog.js` and
`home_grid.py` (`style` with `THERMOSTAT_STYLES = ("dial", "big")` as an enum option kind, like `clock_style`).

**Checks.** `test_gridcards.js` (the option, the range, the step), `tests/test_hk_core_home_grid_cards.py`,
`grid_blocks_check.py` at T and L in both cell shapes.

## Phase D. Bright Glass (Phase 3)

**What you see.** A new Appearance Style, **Bright Glass**: a lighter, clearer plate over a stronger blur that
boosts the colours behind it, a light rim brighter at the top left, and a soft inner glow. Over a vivid wallpaper
the tiles take its colour. Off glyphs are white; lit tiles stay white plates.

| Part | Today's Glass (Blur) | Bright Glass |
|---|---|---|
| Plate | `linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.07))` | `linear-gradient(150deg, rgba(255,255,255,.30), rgba(255,255,255,.12))`, 18 % of the background's light colour mixed in |
| Blur | `blur(20px) saturate(1.4) brightness(0.82)` | `blur(28px) saturate(2) brightness(1.06)` |
| Rim | `1px solid rgba(255,255,255,.13)` | `inset 1px 1px 0 rgba(255,255,255,.55), inset -1px -1px 0 rgba(255,255,255,.14)` (two inset shadows: no mask, no extra layer) |
| Glow | — | `inset 0 0 28px rgba(255,255,255,.10)` |
| Shadow | `0 8px 22px rgba(0,0,0,.12)` | `0 10px 30px rgba(0,0,0,.14)` |
| Off glyph | its own colour | white, 0.94 |
| Text | `ink`, `ink-2` | the same, with a 0 1px 2px rgba(0,0,0,.18) text shadow on the plate |

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Appearance Style | `look.glass` / a screen's `glass` | adds `bright` | unchanged | HK Settings → Appearance → Appearance Style |
| Strength | `look.bright` / a screen's `bright` | 0–100 | 50 | the same page, under Bright Glass |
| Blur Mode | `look.glass` `blur`, `blur_pre`, `blur_each` | Bright Glass uses the Blur look's modes | Shared Layer | the same page |
| Tab Bar | `tab_bar_glass` | adds `bright` | `house` | the screen's Menu Settings |

**Schema.** `model.py`: `GLASS`, `BOARD_GLASS` and `TAB_BAR_GLASS` gain `bright`; `look.bright` and the screen's
`bright` beside `frost`, `blur` and `tint`. `hk-settings-model.js` `GLASS_STYLES` gains
`['bright', 'Bright Glass', 'A light, clear glass that brings out the colours behind it. Best over a wallpaper.']`.
`hk-settings.js` `LOOKS.bright` sets the look's variables (`--hk-glass-plate`, `--hk-blur-filter`,
`--hk-look-edge`, `--hk-look-shadow`, `--hk-look-well`, `--hk-glass-plate-sheet`, `--hk-float-plate`).

**Performance.** Bright Glass is a blur style: `HEAVY_LOOKS` (hk-settings-model.js ~1057) gains `bright`, so the
slow-tablet ladder's first step offers Glass (`clear`) to a tablet under 45 fps, as it does for Blur, Frosted and
Tinted. The rim and glow are inset shadows, which cost nothing per frame once painted; the blur is the look's one
backdrop (Shared Layer) as in Blur. `saturate(2)` adds a little to the blur pass; to measure on the slowest wall
tablet before release.

**Checks.** `test_glass.js`, `test_glass_behaviour.js`, `test_glass_hostview.js` (the look's variables), `test_ladder.js`
(`bright` is heavy), `test_settingsmodel.js`, `tests/py/test_settings.py` / `test_theme_values.py`, `test_blur`
(the new tier), `test_csssnapshot`.

**Risks.** White text on a very light part of a wallpaper. The plate's brightness is capped so the text keeps
4.5:1 against the plate as drawn over each wallpaper's lightest stop (a check per wallpaper in the test).

## Phase D2. The look everywhere (Phase 3)

Most surfaces already follow the Appearance Style through the look's variables: detail sheets
(`--hk-glass-plate-sheet`, hk-detail.js ~687, hk-popup.js ~1236), chips, the header, the side menu and the tab bar.
Bright Glass and the wallpapers are tuned surface by surface:

| Surface | In Bright Glass |
|---|---|
| Room pages' pills | the tile plate; off glyphs white |
| Chips and the header | the chip plate, lighter; the clock keeps its glow |
| The tab bar, the side menu, More | `bright` tier, the rim; the page you're on a white pill with the accent's text |
| The 34 detail sheets and the pop-ups | a sheet plate of `rgba(255,255,255,.22)` over `blur(34px) saturate(2)` with the rim; controls set into it are `rgba(255,255,255,.14)` |
| The Edit mode bar | the tab bar's plate |
| The screensaver's controls | the sheet's plate |
| HK Settings | **unchanged** (iOS Settings) |

**Checks.** `sheet_review.py` at all 8 sizes (34 sheets; the contact sheets looked at by eye; headless WebKit draws
no backdrop blur, so the review's opaque stand-in is the Bright Glass plate over the wallpaper's mid colour);
screenshots of every page kind in WebKit at iPad and phone sizes; `detail_flat_e2e.py`'s look list gains Bright
Glass.

## Phase E. Wallpapers that tint the tiles (Phase 3)

**What you see.** A new Background kind, **Wallpaper**, beside Live Sky, Color, Photo and Landscapes. Twelve
wallpapers of our own: soft folded ribbons, petals, glass shards and pinwheels, in six colour families (Rose,
Violet, Blue, Teal, Amber, Graphite), each with a darker night version. A picker with previews.

| Family | Wallpapers |
|---|---|
| Rose | Ribbons, Petals |
| Violet | Petals, Shards |
| Blue | Shards, Ribbons |
| Teal | Pinwheel, Ribbons |
| Amber | Pinwheel, Petals |
| Graphite | Shards, Pinwheel |

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Background | `sky.background` / a screen's `sky_background` | adds `wallpaper` | unchanged | Sky / Background |
| Wallpaper | `sky.wallpaper` / `sky_wallpaper` | `ribbons_rose`, `petals_rose`, … (12) | `ribbons_rose` | Sky / Background → Wallpaper |
| Night Version | `sky.wallpaper_night` / `sky_wallpaper_night` | `auto` (after sunset), `day`, `night` | `auto` | the same page |

Any page that can take a Background can take a Wallpaper, not only the Home Grid.

**How the tint works.** Each wallpaper names its palette: four stops, top to bottom, as a Color backdrop has. The
wallpaper publishes them as the sky's `--sk0`..`--sk3` on `#hk-sky`, so `hk-frosttint.js` (Frosted's Tint from
Background), the Flat image tint and Bright Glass's plate mix all read them unchanged.

**Code.** A new `web/hk/modules/hk-wallpapers.js`: the twelve as SVG builders and their palettes (content, not
design: DESIGN.md rule 4). `hk-sky.js` draws a wallpaper as a still (painted once at the screen's size, as
`paintStatic` does; no live filter), crossfading day and night at sunset. `SKY_BACKGROUNDS` in
`hk-settings-model.js` and `model.py`; the picker in `hk-settings.js` (thumbnails drawn by the same builders).

**Performance.** SVG drawn once into a bitmap: no per-frame cost. Twelve SVGs are under 40 kB together, minified.
The sky's animations (rain, birds) stay off over a wallpaper.

**Checks.** `test_sky.js` (the kind, the stops), `test_frosttint.js` (reads a wallpaper's stops),
`tests/py/test_settings.py` (keys, each wallpaper's stops under the sky's luma caps), the contrast check of Phase D
per wallpaper, a picker screenshot.

## Phase F. A numbered analog face (Phase 2)

**What you see.** A clock face, **Analog Numbers**: white 1–12, white hour and minute hands, a slim second hand in
the face's colour (orange by default), no date, on a faint disc. Bare, it fills an S block.

**Settings.** `CLOCK_FACES` gains `['numbers', 'Analog Numbers']` (hk-grid-catalog.js ~33, and its Python mirror);
the screensaver's Clock Style list gains it too. Its colour variants are the analog face's (`--ckh`, `--ckm`).

**Code.** `FACES.numbers` in `hk-saverclock.js` beside `FACES.analog` (~405): the same SVG (`viewBox -100 -100
200 200`), hands and ticking second hand; numerals in place of the date lines.

**Checks.** `test_saverclock.js` (the face draws, no date), `grid_panels_check.py` (bare in S, boxed in L).

## Phase G. A Cameras face (Phase 4)

**What you see.** A **Cameras** block: all cameras, or the ones you pick, as a grid of up to nine stills. A tap
opens that camera live. A doorbell ring makes the doorbell's tile live in place.

| Size | Feeds |
|---|---|
| XL (3 × 2) | up to 6 (3 × 2) |
| XXL (6 × 2) | up to 8 (4 × 2) |
| **Full** (a new size: the whole view) | up to 9, arranged to the view's shape (3 × 3; 2 × 4 on a phone) |

**Settings.** Catalog `cameras`: sizes `XL`, `XXL`, `F`; opts `{cameras: 'cameras' (a list; empty = all, in
Cameras' order), refresh: 5–60 s (10)}`. The new size `F` is the view's whole grid, at `[0, 0]` only, the view's
only block; offered for `cameras` alone.

**Load.** Stills refreshed at their cell's size, shared between tablets through Phase 6's still cache. **One live
feed at a time** per tablet (hk-cameras.js's own note on nine feeds); the face never opens nine streams.

**Code.** `hk-grid-cards.js` (`HkGridCamerasCard`), `hk-grid-catalog.js`, `home_grid.py` (`F` in `SIZES` with its
own rule), `hk-layout.js` (`F` spans the grid).

**Checks.** `tests/test_hk_core_home_grid.py` (`F` alone in its view), `test_gridcards.js` (counts per size),
`grid_blocks_check.py`, a still-cache load test with nine cameras.

## Phase H. More When Near (Phase 4)

**What you see.** A face that shows a big clock from across the room and its controls when you walk up.

Two ways to build it:

1. **A Near View** on the grid: when someone comes near, the grid turns to a chosen view (the controls); when no one
   has been near for a while, it turns back to the first (the big clock). This is the HomeView behaviour, and
   reuses Views.
2. **A Show When condition, Someone's Near**, for a block's rules: one block swaps its card in place (a clock
   becomes a thermostat).

**What "near" means:** any of the screen's presence entities (the Sleep Screen's `presence` list, `hk_core/sleep`),
plus the tablet's own motion where its kiosk app reports it (a new `motion` part in `hk_core/tablets/kiosk.py`
`PARTS`, for Kiosk Satellite and Fully where their integrations expose it; to be checked per app).

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Near View | `home_grid.near` | absent, or `{view: 1–3, after: 10–300 s}` | absent; a new one is view 2, 30 s | Editor → Screen → Views |
| Someone's Near | `CONDITIONS` | adds `near` | — | Editor → the block → Show When |

**Code.** `home_grid.py` (`near`, the condition), `hk-grid-catalog.js` / `hk-grid-editor.js` (`CONDITION_NAMES`),
`hk-layout.js` (turn the view), `hk_core/tablets/kiosk.py` (`motion`), the gateway's state feed for the tablet's
presence.

**Checks.** `tests/test_hk_core_home_grid.py`, `test_homegrid.js` (near turns the view and back after `after`; a
touch keeps it near), `grid_panels_check.py` with a fake presence entity.

**Risks.** A presence sensor that flickers would flip the face. `after` holds it; touching the screen counts as
near.

## How it behaves on each screen

| | Landscape tablet 1180 × 820 | Portrait tablet 820 × 1180 | Phone 390 × 844 | iPad (11", 13") | iPhone Duo |
|---|---|---|---|---|---|
| 0 Swipe | on with the bar; 24 px edges | the same | the bar's 5 tabs; More's pages by More | as a tablet; Safari's edge swipes kept | folded: as a phone, edges measured from the page (the 84 pt strip is not the page's); open: as a tablet |
| A Square cells | 166–181 px (6 × 4) | 3 × 5 square: 200 px | 2 × 4 square: about 150 px | 6 × 4: 169 / 196 px | folded 2 × 4: about 130 px; open 3 × 4: 196 px |
| A2 Pane | full height, 444 px | band under, 276 px | none | full height (444 / 426 px; cells 227 / 278 px); portrait a band | folded none; open a 198 px band |
| B Centred | yes | yes | yes | yes | yes |
| C Big Number | T and L | T and L | T (2 × 2 cells are L) | T and L | as a phone / tablet |
| D Bright Glass | Shared Layer; ladder offers Glass on a slow tablet | the same | the same | the same | the same |
| E Wallpaper | drawn once at the screen's size | redrawn on rotation | the same | the same | redrawn on fold |
| F Numbers clock | S bare | S bare | S bare | S bare | S bare |
| G Cameras | Full: 3 × 3 at 16:9 | Full: 3 × 3 | Full: 2 × 4 | Full: 3 × 3 | folded Full: 2 × 4; open Full: 3 × 3 |
| H Near | presence + kiosk motion | the same | presence only | presence only | presence only |

## Order and checks

| Work phase | Design phases | Why first |
|---|---|---|
| 1 | 0 Swipe Between Pages | the owner's first pick; touches only the shell and the tab bar |
| 2 | A, A2, B, C, F | the HomeView layout: cells, the pane, tiles, thermostat, clock |
| 3 | D, D2, E | the material and the wallpapers, everywhere |
| 4 | G, H | new behaviour: cameras face, near |

Each work phase:

- jsc tests (`test_gridcards.js`, `test_homegrid.js`, `test_grideditor.js`, `test_glass*.js`, `test_frosttint.js`,
  `test_tabbar.js`, `test_ladder.js`) and the Python catalog parity;
- the headless grid checks (`grid_blocks_check.py`, `home_grid_visual_check.py`, `grid_panels_check.py`);
- the slow-tablet ladder's tests for Bright Glass;
- screenshots of the Square starter in every new style at iPad and phone sizes in WebKit, looked at before release;
- `tools/ci.py full`;
- then a release to the house and GitHub, with the owner's OK, and the owner tries it on the iPad and a wall
  tablet.

## Open questions for the owner

1. **Now Playing's Pane Side** follows the new Pane Side unless set on its own (A2). Or keep them separate?
2. **Rooms by swipe:** on a room page, a swipe goes to the next room (Phase 0). Or only the tab bar's pages?
3. **Near View** (H, way 1) is an addition to the plan, beside the Someone's Near condition. Build both?
4. **The 6 × 4 square grid's text** is 12.7 px on a landscape tablet with the tab bar. Keep the starter, or offer
   only Home with Pane on landscape?

## Proposed changes to the house DESIGN.md

To apply to `hk_house/docs/DESIGN.md` only with the owner's yes. Shown as text to add, by section.

**The scales → Blur**, a row:

| tier | value | where |
|---|---|---|
| bright | blur(28px) saturate(2) brightness(1.06) | Bright Glass: plates (Shared Layer), the tab bar, the menu, chips; its sheets take `blur(34px) saturate(2)` |

**The scales → Spacing**, in the tiles tier: "a Home Grid's square cell 196 × 196 (`HOME_GRID.square`); a centred
tile: the glyph's centre at 38 % (34 % in a 150 tall cell), the name's baseline at 74 %, name → room 18.6 apart".

**The scales → Type roles**, a row:

| role | size / weight / tracking |
|---|---|
| display | min(46cqh, 40cqw) / 500 / −0.04 em, tabular (the Big Number thermostat; the weather block's Big Temperature is the same rule) |

**The scales → Motion**, a paragraph: "**A page swipe** follows the finger; let go, it lands on `standard` (.34 s)
and the tab bar's highlight on `spring` (.42 s), placed between two tabs by the swipe's fraction while it moves.
Reduce Motion: a cross-fade (`fade`, .2 s), the highlight jumps."

**A new section, after Flat: "Bright Glass (2026-10-30)"**

> The sixth look: a lighter, clearer plate over a stronger blur, for vivid backgrounds (the Wallpapers). One more
> Appearance Style (`look.glass: bright`, a screen's `glass`), with a Strength (`look.bright`, 50) and the Blur
> look's three Blur Modes.
>
> | role | value |
> |---|---|
> | plate | linear-gradient(150deg, rgba(255,255,255,.30), rgba(255,255,255,.12)), the background's light stop mixed in at 18 % |
> | rim | inset 1px 1px 0 rgba(255,255,255,.55), inset -1px -1px 0 rgba(255,255,255,.14) |
> | glow | inset 0 0 28px rgba(255,255,255,.10) |
> | shadow | 0 10px 30px rgba(0,0,0,.14) |
> | sheet | rgba(255,255,255,.22) over blur(34px) saturate(2), the rim |
> | set into a sheet | rgba(255,255,255,.14) |
> | off glyph | white 0.94 (the background supplies the colour) |
> | lit tile | unchanged: a white plate, the glyph in its colour in its well |
> | the menu's and bar's page | a white pill, the accent's text |
>
> - It counts as a blur style for the slow-tablet ladder (`HEAVY_LOOKS`).
> - Text keeps 4.5:1 against the plate drawn over each wallpaper's lightest stop; Strength is capped to hold it.
> - HK Settings never wears it.

**Rules**, rule 4 gains: "Wallpapers (`hk-wallpapers.js`) are content: their shapes and palettes stay where they
are, as the sky's do." Rule 5 gains: "Square cells and Centred tiles are options beside the measured geometry, not
replacements: a screen that doesn't choose them keeps 196 × 150 and the Home layout."

**Decisions**, an entry:

> - 2026-10-30 (a HomeView-style look, docs/phase11/HOMEVIEW-LOOK.md in the Mantel repo): everything an option,
>   existing screens unchanged until chosen; square cells (196 × 196) on any screen type and a Square (3 × 3) type;
>   Home with a Side Pane, the screensaver's pane, with one Pane Side for Home and the screensaver; Centred tiles
>   for the Home Grid and the room pages' Tall pills, not regular pills; a Big Number thermostat; Bright Glass
>   (the sixth look, a blur style for the ladder); twelve wallpapers of our own that tint the tiles; the look
>   reaches every surface except HK Settings. Out of scope: face recognition, an Intercom tile.

**Guards**, a line: "`test_blur` holds the `bright` tier; `test_type` the `display` role; a wallpaper contrast check
in `tests/py/test_settings.py`."
