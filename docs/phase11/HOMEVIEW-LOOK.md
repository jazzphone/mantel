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
- (ours, not HomeView's) a Side Pane beside the page, of sections you choose;
- a swipe from page to page, with the tab bar following;
- more screensaver faces.

## Decisions already made (the owner, 2026-10-30)

| # | Question | Answer |
|---|---|---|
| 1 | Square cells on wide tablets? | **Yes, on their existing layouts.** The 3 × 3 Square type is only for a screen that really is square |
| 2 | A landscape starter? | **"Home with Pane":** a 3 × 3 grid beside the Side Pane, with **Pane Side: Left or Right**. The recommended landscape starter |
| 3 | Where does the new look reach? | **Every surface** (sheets, menus, the tab bar) **except HK Settings**, which stays iOS Settings |
| 4 | What first? | **Swipe Between Pages** |
| 5 | Defaults | **Everything is an option.** A screen looks as it does today until someone picks the new style |
| 6 | Out of scope | Face and voice recognition, and an Intercom tile |
| 7 | The pane (2026-10-30, second review) | **One Side Pane per screen**, of sections the person chooses (weather, the time, security, and more): HomeView has no such area, so it is where HK can be more useful. One Side Pane settings page for All Screens and for each screen, holding the Dashboard's pane (Off, Home Only, Every Page) and the Screensaver's. It replaces the screensaver's Side Pane group, Now Playing's Show As: Side Pane, and a pane of the Home Grid's own |
| 8 | What a swipe moves through | **The tab bar's pages only** |
| 9 | More When Near | **Through the Sleep Screen and the screensaver**, not a new grid feature: a sensor that sees the space in front of the tablet ends the screensaver; the tablet's camera is never used (it costs the tablet too much) |
| 10 | The 6 × 4 square starter | **Kept, listed after Home with Pane**, its description saying the text is smaller |
| 11 | The gap on square cells | **HomeView's: 13 px** (6.7 % of a cell); 196 × 150 tiles keep 10 |
| 12 | Corners | **34 px on every square-cell block; the concentric 72 px at the screen's corners on the Square type only** ("hopefully not a huge uplift": it is a radius token and four corner classes) |
| 13 | To-do in the pane | **Yes**, reading Home Assistant's to-do lists |
| 14 | Photo, Time Behind | **Yes**: the cut-out made on the server, on import and by a backfill |

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

Square cells also take **HomeView's gap: 13 px**, 6.7 % of a cell, as measured (the owner, 2026-10-30); 196 × 150
tiles keep HK's 10.

| Layout | Logical canvas | Scale | Cell on screen | Centred name (21) / Home-style text (15) |
|---|---|---|---|---|
| Today: 6 × 4 tiles, top band on | 1280 × 754 | 0.92 | 181 × 138 | — / 13.8 px |
| 6 × 4 square, band off, tab bar at the bottom | 1295 × 877 | 0.84 | **164** | 17.6 / 12.6 px |
| 6 × 4 square, band off, no tab bar | 1295 × 877 | 0.91 | **179** | 19.1 / 13.7 px |
| **Home with Pane:** 3 × 3 square, Fill the Screen, tab bar under the grid | 668 × 668 | 1.10 | **216** | 23.1 / 16.5 px |
| Home with Pane, no tab bar | 668 × 668 | 1.23 | 240 | 25.8 / 18.4 px |
| Square screen, 3 × 3, 800 × 800 (its 14 px edge), no tab bar | 642 × 642 | 1.25 | 244 | 26.2 / 18.7 px |

So the full 6 × 4 of square cells is about 164–179 px a cell. With Centred tiles its names are larger than today's
tile text; in the Home style they are a little smaller. Home with Pane's 216 px cells are the HomeView proportion,
which is why it is the recommended landscape starter.

## Phase 0. Swipe Between Pages (Phase 1 of the work)

**What you see.** A sideways swipe anywhere on a page takes you to the next or previous page. The page follows
your finger, the next page comes in beside it, and the tab bar's highlight slides along with it, so it is always
under the page you are about to land on. The wallpaper or sky stays still behind; only the plates move.

- **Order.** The tab bar's tabs, left to right (Home first), as the bar shows them (the owner, 2026-10-30). On a page
  that isn't in the bar (a room, a page under More) there is no page swipe. With no tab bar, the side menu's order
  (Home, then its Categories).
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

Screen types gain a seventh field, the cell shape; the existing six keep `tile`. The Square type's edge is 14 px, not
the page gutter's 27.2, as the screenshot's tiles sit about a gap from the glass. Choosing Square sets 3 × 3, band
off, square cells and Fill the Screen. Changing Cell Shape on any type keeps its blocks where they are (the cells
change shape, not position).

**Corners.** Square cells take HomeView's corners, measured off the screenshot as circular arcs (fitted to within
half a pixel), on corners away from the display's edge: **one radius for every block**, 21 px on a 120 px tile and
on the 248 px 2 × 2 alike, so **34 px** in a 196 cell (today's tiles: 23.5). On the **Square** screen type a block's
outer corner at the screen's corner is concentric with the display's own: 45 px on the screenshot, **72 px** here.
196 × 150 tiles keep 23.5. `hkCards.R` gains `square` (34) and `square-screen` (72). The uplift is small: the grid
already marks each cell (`.cell`), so a square grid sets one radius variable for its blocks' plates, and on the
Square type the four corner cells get one class each for their outer corner.

**Starters** (hand-written like `NIGHTSTAND`, hk-grid-editor.js ~131, filled from the house: the screen's room's
thermostat, the front door lock, the house's scenes):

| Screen type | Starter | Blocks |
|---|---|---|
| Tablet, Landscape | **Home with Pane** (Phase A2, recommended, listed first) | thermostat L in Big Number, Numbers clock S bare, a scene, the front door lock, the room's lights; it turns the screen's Side Pane on for Home with Weather, Calendar and Now Playing (when playing), unless the screen already has a pane |
| Tablet, Landscape | **Square, 6 × 4** (listed second; its description says the text is smaller than today's) | thermostat L Big Number, Numbers clock S bare, cameras L, weather W, then centred S tiles: two scenes, the lock, lights, a fan |
| Tablet, Portrait | **Square, 3 × 5** | the landscape set re-flowed, the pane as a band (A2) |
| Phone, Portrait | **Square, 2 × 4** | thermostat T Big Number, clock S, lock, lights, a scene |
| Square | **HomeView-style** | thermostat L Big Number, Numbers clock S bare, then scene, lock and lights S |

**Schema.**

- `home_grid.py` `_shape`: accept `cell` in `("tile", "square")`, stored only when `square`. `rows` stays 2–6.
- `hk-grid-catalog.js`: nothing per card; `hk-base.js` `HOME_GRID` gains `square: 196` (the test reading its size
  string gains it too).
- `HkHomeGridView._place`: rows are `repeat(rows, 196px)` and the gap 13 for square; `_measure` uses 196 and 13;
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

**Risks.** A 6 × 4 of square cells in the Home style draws text at 12.6 px on a landscape tablet (the table above);
Centred tiles' names are 17.6 px. The starter uses Centred tiles, and Home with Pane is the one offered first.

## Phase A2. The Side Pane (Phase 2)

HomeView has no such area, so this is where HK can do more than it (the owner, 2026-10-30). **One Side Pane per
screen**, made of sections the person picks and orders, shown beside the Dashboard (on Home only or on every page)
and in the screensaver. It takes over three panes that exist today, each with its own settings:

- the screensaver's **Side Pane** group (Calendar, Days, Music; `calendar`, `calendar_days`, `music_pane`,
  hk-saver.js ~1037, "THE PANE");
- **Now Playing → Show As: Side Pane** with its own **Pane Side** (`np_style`, `np_side`; hk-popup.js `placeFor`),
  which slides the music in down one side on any page while something plays;
- the Home Grid pane of the first draft of this plan (`home_grid.pane`), which is dropped: the grid simply lays
  itself beside the screen's pane.

### What you see

**Home with Pane** on a wide tablet: a 3 × 3 grid of 216 px square tiles beside a full-height pane. **Pane Side**
puts it on the left or the right, everywhere it shows. On **Every Page**, each page is narrowed by the pane's width
(as the Now Playing pane narrows it today).

**Sections, each drawn for the pane** (the owner: purpose-built, not page cards squeezed in), at four **Sizes**:

- **Tiny**: one line, its glyph, the fact and a value ("54° Clear · H:62° L:48°").
- **Less**: the gist in two or three lines.
- **More**: the whole section.
- **Full**: More and then some, and it takes whatever room the pane has left (one Full section at a time).

| Section | Tiny | Less | More | Full | Data from |
|---|---|---|---|---|---|
| Clock | time · date | time (48) and date | time (72), date, sunset | the Analog Numbers face, large | the house clock |
| Weather | now · H / L | now, condition, H / L | + the next five hours | + the next three days | the weather entity (`hk-weather.js`'s data) |
| Calendar | the next event | today's next two | four events | five, across days | the calendar entities (`hk-calendar.js`) |
| Now Playing | song · pause | cover, song, artist, pause | cover, progress, transport | large cover, progress, transport | the screen's music (`hk-saver.js` music) |
| Security | state · locks | state, one summary line | + each lock and the windows | + the garage, the last change and who | the Security chip's facts |
| Camera | name · age of the still | a short still | 16:9 still | 4:3 still | the still cache |
| Timers | the soonest | each on a line | each with its bar | + start presets | `sensor.running_quick_timers` |
| Energy | use now · solar | use, solar, battery | + today's totals | + solar by the hour | the Energy feature |
| Climate | a room · its state | two rooms | four rooms | every room and outside | the climate entities |
| Who's Home | home · away counts | avatars | + where the away are | a row each, with travel time | `person.*` |
| To-do | the list · item count | two items | four items | six items, and Add | `todo.*` (new to HK, below) |
| Notifications | the latest | the latest with its time | three | five | `hk_core/notifications` |

All of them live in `hk-sidepane.js` and read the same data as the pages, so the Dashboard's pane and the
screensaver's draw the same thing.

**To-do (decided 2026-10-30).** A to-do list's items aren't in its entity's state (that is only a count), so HK
reads them through Home Assistant's `todo.get_items` (and follows changes by the list's state). It goes through the
`House` port (`hk_core`, Rule 2), so both hosts get it: Home Assistant's own call in HK Frontend, the gateway in
Mantel. A tap on an item's circle checks it off (`todo.update_item`, status completed); that is a house command,
classified and audited as every command is (Rule 3), and the list's section shows it struck through until the list
updates. The section's options: which list (`entity`), and Show Completed (off).

- **Always, or When There's Something.** Each section is either always shown or only while it has something: music
  playing (or paused within Hide After a Pause), a timer running, the alarm armed, an open door, a notification. A
  pane whose sections are all "When There's Something" and all quiet steps aside: that is today's Now Playing pane
  exactly.
- **The doorbell.** With **Show the Doorbell** on, a ring puts the doorbell's camera at the top of the pane, live, for
  as long as the camera's pop-up would show.
- **It never scrolls.** Sections keep their Size while they fit; when they don't, sizes step down from the bottom
  (Full, More, Less, Tiny), then the last sections are left out and the pane's foot says how many ("+2 more"). At
  most 8 sections.

### Settings

**Settings → Side Pane** (All Screens) and **Settings → Screens → the screen → Side Pane**, one page in HK Settings
(iOS Settings in style). On a screen, each group says whose it is ("Same as All Screens", "Just This Screen") and
has its own Reset, as Flat Colors do.

| Group | Setting | Values | Default |
|---|---|---|---|
| Where | Pane Side | Left, Right | Right |
| | Width | Narrow (360), Standard (400), Wide (480) | Standard |
| On the Dashboard | Show | Off, Home Only, Every Page | Off |
| | Sections | the list above, ordered; each with its Size (Tiny, Less, More, Full) and Always / When There's Something | Weather (More), Calendar (More), Now Playing (More, When There's Something) |
| In the Screensaver | Show | Off, Same as the Dashboard, Its Own Sections | Off |
| | Sections | as above, when Its Own | Clock (Tiny), Calendar (More), Now Playing (Less, When There's Something) |
| Doorbell | Show the Doorbell When It Rings | on, off | on |

The places that had their own pane become links to this page, so nothing is set in two places: the Screensaver
Options' Side Pane row ("Side Pane: Calendar, Now Playing ›"), Now Playing's Show As (Bar, or "In the Side Pane ›"),
and the Home Grid editor's Screen → Side Pane row ("Home Only, Right ›").

**Schema** (`hk_core/settings/model.py`, mirrored in `hk-settings-model.js`, checked by `changes.py`):

```json
"side_pane": {
  "side": "right", "width": "standard",
  "dashboard": {"show": "off", "sections": [{"kind": "weather", "size": "more"}, {"kind": "calendar", "size": "more"},
                                            {"kind": "now_playing", "size": "more", "when": "active"}]},
  "saver": {"show": "off", "sections": []},
  "doorbell": true
}
```

- House: `side_pane` with these defaults. A screen: `side_pane: None`, or a sparse object whose groups (`side`,
  `width`, `dashboard`, `saver`, `doorbell`) each resolve on their own, first found: the screen, All Screens.
- `kind` in `PANE_SECTIONS` (12, above); `size` in `("tiny", "less", "more", "full")`, absent = more, at most one
  `full`; `when` in `("always", "active")`, absent = always; per-kind options
  (`days` for the calendar, `entity` for a camera or a to-do list). At most 8.
- **Migration**, once, so every screen looks as it did: the screensaver's `calendar` / `music_pane` become
  `saver: {show: "own", sections: [calendar(more, days), now_playing(more, active)]}`; Now Playing's `np_style: "pane"` becomes
  `dashboard: {show: "all", sections: [now_playing(active)]}` and `np_side` becomes `side`. The old keys are read for
  one release, then dropped.

### Layout

| Screen | The pane |
|---|---|
| Landscape tablet, 1180 × 820 | full height, 444 px beside the 3 × 3 grid (it takes what the square grid leaves); on other pages its Width |
| Landscape, no tab bar | 360 px beside an 820 px grid |
| Portrait tablet, 820 × 1180 | a band under the page, 276 px tall, its sections side by side |
| iPad, 1194 × 834 / 1366 × 1024 | as the landscape tablet; portrait, a band |
| Phone (under 640 px) | never |
| iPhone Duo, folded (382 × 678 of page) | never |
| iPhone Duo, open (669 × 951) | a 198 px band: two compact sections |

The tab bar centres under the page beside the pane, not under the pane.

### Files

- `web/hk/modules/hk-sidepane.js` (new): the pane host, its sections, the fit (full, compact, left out), and the
  room it takes (`--hk-pane-l/-r` and `html[hk-pane]`, as hk-popup.js's `publishPane` does today).
- The section cards above; `hk-calendar-pane-card` cut from `hk-saver.js`.
- `hk-saver.js`: the screensaver's pane reads the resolved `saver` group; Pane Side for its CSS (`right:0`,
  `border-left`, the photo's width and the `.fc` offsets, mirrored).
- `hk-popup.js`: Now Playing's pane retired into the Side Pane (`placeFor` keeps the bar).
- `hk-layout.js`: the Home Grid lays itself beside the pane.
- `hk-settings.js`: the Side Pane page and the three links; `hk-settings-model.js`; `model.py`, `changes.py`.

### Checks

- Python: the shape, the resolution (screen, All Screens), the migration of each old key, the section cap.
- jsc: `test_sidepane.js` (new: the fit, When There's Something, the doorbell), `test_homegrid.js` (the grid beside
  the pane on each side), `test_settingsmodel.js`.
- Headless: the pane on each side on Home, on Every Page, and in the screensaver; with music playing; every section
  alone and all eight together; the portrait band; WebKit at iPad size.

### Risks

- **Every Page on a wall tablet** leaves 780 px for the page at Standard: Energy and the page headers drop from
  three columns to two, and Calendar and Music re-lay. Each page kind is screenshotted with the pane on.
- The screensaver's pane was written for the right; its photo width, the forecast's offsets and the clock's `right:`
  each need a left case.
- One data source per section, shared by the Dashboard's pane and the screensaver's, so nothing updates twice.

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

**Design.** Measured off a HomeView screenshot (the owner's, 2026-10-30) and matched to it side by side, in units
of a 196 × 196 cell:

| Part | Value | Measured |
|---|---|---|
| Glyph | the accessory's own **hk: glyph** (the home's SF Symbols, the same glyph Mantel draws today), 66 px box (about 55 px of ink), white; lit: 40 px in a 64 px well of its colour | 28 % of the tile tall |
| Glyph centre | 33 % down | 33 % |
| Name | **SF Pro** 21 / 600, −0.3 px, on a 27 px line, one line, ellipsed | centred at 65 % |
| Room | SF Pro 20 / 400, the wallpaper's light colour 30 % into white 0.78 (`--sub`) | centred at 78 % |
| Text block | its top at 57.7 % | |

In a 196 × 150 cell: the glyph's box 50 px (30 px in a 50 px well) at 31 %, the name 17 / 600 and the room
16 / 400 on 22 px lines from 55 %. Home-style tiles keep the measured 42 px well and 23 px glyph. The font and the
glyphs are Mantel's own: SF Pro (`hkCards.T['font-body']`, the home's `SF-Pro.woff2`) and the hk: iconset; nothing
new ships.

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
the modes; a tap on the name opens the thermostat's sheet. Nothing else is on the tile: the mode and the current
temperature are in the sheet.

**Settings.**

| Setting | Key | Values | Default | Where |
|---|---|---|---|---|
| Style | thermostat `opts.style` | `dial`, `big` | absent = `dial` | Editor → the thermostat block |

Sizes T and L (XL stays the climate sheet).

**Design.** Measured off the same screenshot, in an L block (402 × 402): the number SF Pro 500, `min(44cqh, 44cqw)`
(31 % of the block tall, half its width for two digits), tabular, −0.03 em, centred at 42.7 % down. The foot is
centred at 86 % down, 7 % in from each side: the chevrons (`chevron.down` / `up` at 58 px, about 32 px of ink, 8 % of
the block, at 14 % and 86 % across) level with the name (21 / 600) and room (20 / 400), as on the tiles. In T,
`min(25cqh, 50cqw)` at 40 %, 38 px chevrons and 17 / 16 text, the foot at 88 %. A step is the entity's
`target_temp_step` (else 1 °F / 0.5 °C), sent through the gateway after a 600 ms pause, as the dial sends.

**Code.** `hk-control.js` beside `_climate` (~522), sharing its service calls; `hk-grid-catalog.js` and
`home_grid.py` (`style` with `THERMOSTAT_STYLES = ("dial", "big")` as an enum option kind, like `clock_style`).

**Checks.** `test_gridcards.js` (the option, the range, the step), `tests/test_hk_core_home_grid_cards.py`,
`grid_blocks_check.py` at T and L in both cell shapes.

## Phase D. Bright Glass (Phase 3)

**What you see.** A new Appearance Style, **Bright Glass**: clear glass. The screenshot shows the wallpaper's
edges crisply through the tiles, so the blur is light (4 px); a white wash brighter at the top left, a thin bright
rim, and a slight lift in brightness do the work. Off glyphs are white; lit tiles stay white plates.

| Part | Today's Glass (Blur) | Bright Glass |
|---|---|---|
| Plate | `linear-gradient(145deg, rgba(255,255,255,.16), rgba(255,255,255,.07))` | `linear-gradient(160deg, rgba(255,255,255,.24) 0%, rgba(255,255,255,.09) 45%, rgba(255,255,255,.05))`, 7 % of the background's light colour mixed in |
| Blur | `blur(20px) saturate(1.4) brightness(0.82)` | `blur(4px) saturate(1.3) brightness(1.08)` |
| Rim | `1px solid rgba(255,255,255,.13)` | `inset 0 0 0 1.5px rgba(255,255,255,.22), inset 0 1.5px 0 rgba(255,255,255,.30)` (inset shadows: no mask, no extra layer) |
| Glow | — | `inset 0 0 24px rgba(255,255,255,.06)` |
| Shadow | `0 8px 22px rgba(0,0,0,.12)` | `0 6px 20px rgba(40,0,60,.10)` |
| Off glyph | its own colour | white, 0.94 |
| Text | `ink`, `ink-2` | `ink`; the second line `--sub` (the wallpaper's light colour 30 % into white 0.78); a 0 1px 2px rgba(0,0,0,.18) text shadow |

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

**What you see.** A clock face, **Analog Numbers**, matched to the screenshot side by side: SF Pro 500 numerals
(23 units of a 200 face) at 71 % of the radius; 60 ticks at the rim, the hours' longer (86–95.5) and heavier (2.0,
white 0.9) than the minutes' (90.5–95.5, 1.3, white 0.62); white hour and minute hands (52 % and 89 % of the
radius, 6.4 and 5.6 wide) on a thin neck at the centre, with a soft shadow; a slim white second hand with a tail; a
faint dark disc with a thin rim (white 0.28) that fills its cell; no date. Its colour variants colour the second
hand.

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

**What you see.** From across the room the tablet shows the screensaver (its clock, the photos, its Side Pane);
when someone walks up to it, the dashboard comes up before they touch it; when they walk away, the screensaver
returns sooner than Starts After would bring it.

**How.** The Sleep Screen already decides this from presence (`hk_core/sleep/rules.py`): somebody in the room wakes
the tablet to the photos, a touch brings the dashboard, nobody darkens it. "Near" is one more list and one more
rule, not a new grid feature:

| Rule (in the Sleep Screen's order) | Shows |
|---|---|
| … 9 In use (touched within the window) | the dashboard |
| **9a Somebody near the screen** (new) | **the dashboard** |
| 10 Somebody in the room (Presence) | the screensaver |
| 11 Nobody | dark |

**What "near" means:** a sensor that sees the space in front of the tablet: an mmWave sensor's zone, or a distance
sensor under a set distance. **Never the tablet's camera**: camera motion detection costs the tablet too much (the
owner, 2026-10-30); the kiosk `motion` part of the first draft is dropped.

**Settings** (the screen's Sleep Screen page):

| Setting | Key | Values | Default |
|---|---|---|---|
| Near the Screen | `sleep.near` | entities (binary sensors, or a number sensor with a distance) | none |
| …closer than | `sleep.near_cm` | 30–300 cm, for a distance sensor | 120 |
| Back to the Screensaver | `sleep.near_linger` | 10–300 s with nobody near and no touch | 30 |

It needs the Sleep Screen to be decided by HK (`decided_by: "hk"`); the page says so when it is still the
automation's.

**Code.** `hk_core/sleep/rules.py` (`near` in `LISTS`, the rule), `engine.py` (the facts), the host's sleep engine,
`hk-settings.js` (the Sleep Screen page). No Home Grid change.

**Checks.** `tests/test_hk_core_sleep.py` (the rule's place in the order, the linger, a distance under and over),
the history replay, `hk-saver.js`'s leave-on-near.

**Risks.** A sensor that flickers at the zone's edge would flip the screen; the linger holds it, and a touch always
counts as near.

## Phase I. Screensaver faces (Phase 4)

The owner, 2026-10-30, from Apple's set of HomeView screensavers: "we can probably add these to the existing setups
we have now". HK's screensaver already has Shows (`SAVER_SHOWS`: photos, both, forecast, clock) and 15 clock faces
(`hk-saverclock.js` `FACES`: today, classic, serif, neon, lcd, flip, analog, words, arc, nixie, poster, dots, ring,
glass, type), plus occasion art in the sky (holidays, birthdays, the woodland seasons). Nine new faces, our own
versions of the kinds HomeView offers, each drawn for a wall tablet and able to sit beside the screensaver's Side
Pane:

| Face | What you see | Where it goes |
|---|---|---|
| **Glance** | the date large, the Analog Numbers clock, what's playing (cover, song, Play), the weather (place, temperature, condition, H / L), on a calm colour | a new Show, `glance` |
| **Big Weather** | the temperature very large over the live sky, the condition and H / L, the time, then sunset, wind, humidity and air quality | a new Forecast layout, `big` |
| **Month** | the month with today circled, the date drawn very large in red behind the grid, the time | a new Show, `month` (the calendar block's Month View, full screen) |
| **Day** | the weekday and a big date with HK's own occasion art (pumpkins at Halloween, birthdays, the seasons), light or dark | a new Show, `day` |
| **Photo, Time Behind** | the photo, with the time drawn behind the person or thing in it | a photo option, Time Behind |
| **Photo Titles** | photos with their album's name and year | a photo option, Titles |
| **Liquid** | soft, glossy numerals drifting slowly over a pastel gradient | a clock face, `liquid` |
| **Giant Numerals** | an analog clock with 12, 3, 6 and 9 drawn huge on a strong colour, the date in a corner | a clock face, `giant` (colour variants) |
| **Scattered Numerals** | a quiet analog face whose numerals lean and fade, on a soft colour | a clock face, `scattered` (colour variants) |

**Not copied.** Apple's Snoopy faces are Peanuts characters under licence; the Day face uses HK's own occasion art
instead. Every face is drawn for HK; no Apple artwork.

**Photo, Time Behind (decided 2026-10-30)** needs a cut-out of each photo's subject. Mantel already has the place
for it: Mantel Photos processes each upload in its own image worker, and that worker already runs an ONNX model on
the CPU (YuNet, the face finder behind Keep in View; `faces.py`, `image_work.py`, docs/phase4/PHOTOS.md), with a
backfill for photos stored before. The cut-out is a second model in that same worker.

- **When.** On import, right after the faces, on the screen-sized copy; and a backfill (as `FaceBackfill` does) for
  the photos already in the library: one at a time, newest first, resting between, waiting while an import runs, and
  carrying on after a restart. A photo that changes is looked at again; a later, better model can redo them all
  (stored with the model's name, as `faces_by` is).
- **The model.** A salient-object model in ONNX, vendored with its licence and SHA-256 like YuNet: U²-Net's small
  form (`u2netp`, about 5 MB, Apache-2.0) to start, or ISNet's general model (about 170 MB, Apache-2.0) if the small
  one's edges aren't good enough. Run on the CPU, one thread, so it never starves the server. MODNet is left out (a
  non-commercial licence).
- **What is stored.** The cut-out as an 8-bit mask the size of the screen copy (a PNG of roughly 20–80 KB), its
  confidence, and where the time goes (`depth_box`), in new columns beside `faces`. It counts against the photo
  quota; nothing leaves the house.
- **Reliability: only where it works.** It works well on a clear subject (a portrait, a pet, a person against the
  sky, a plant on a plain wall) and badly on group shots spread across the frame, busy scenes and landscapes with no
  subject. So each photo is checked once and marked **usable** only when: the subject covers 8–60 % of the frame, the
  mask is confident (few half-sure pixels), and the subject overlaps the time's place by 10–40 % (enough to look
  behind it, never enough to hide it). The photo's faces, already known, help: a subject with a face is placed with
  the time behind the head. A photo that fails shows the time in front, as today, so the face never looks broken. In
  Photos, a "Time Behind" badge shows which photos qualify, and the album can be set to show only those.
- **Resources (to measure on the house's machine before release).** The worker already exists, so the new cost is
  the model: memory of tens of MB (u2netp) to a few hundred (ISNet) while the worker is up, and it stops after 5
  idle minutes as now. Time per photo, roughly: a fraction of a second (u2netp) to a few seconds (ISNet) on a modern
  x86 core, several times that on an ARM board. A library of 2,000 photos is minutes to an hour on x86, a night at
  worst on ARM: in the background, never on a tablet. Setup Check says if the model can't run on the platform, as it
  does for faces.
- **HK Frontend inside Home Assistant** has no image worker, so the face is offered only where the photos come from
  Mantel Photos.

**Settings.** `SAVER_SHOWS` gains `glance`, `month`, `day`; the Forecast gains a Layout (Classic, Big); photos gain
Time Behind (off, on) and Titles (off, on); `CLOCK_FACES` and `hk-saverclock.js` `FACES` gain `liquid`, `giant`,
`scattered` (and Phase F's `numbers`). All in the screensaver's options, All Screens and per screen as today.

**Files.** `hk-saverclock.js` (the three faces), `hk-saver.js` (the Shows, the photo options), `hk-weather.js` (the
Big layout's data), the server's photo pipeline (the cut-out), `model.py` (`SAVER_SHOWS`, the options),
`hk-settings.js` (previews in Clock Style and Show).

**Performance.** Liquid's drift is a slow transform of a pre-drawn layer, never a live SVG filter on a wall tablet;
Reduce Motion and Flat hold it still. The other faces repaint once a minute.

**Checks.** `test_saverclock.js` (each face draws, at every size the Clock block offers), `tests/test_hk_core_screensaver.py`
(the new options), screenshots of every face at the eight sheet-review sizes.

## How it behaves on each screen

| | Landscape tablet 1180 × 820 | Portrait tablet 820 × 1180 | Phone 390 × 844 | iPad (11", 13") | iPhone Duo |
|---|---|---|---|---|---|
| 0 Swipe | on with the bar; 24 px edges | the same | the bar's 5 tabs; More's pages by More | as a tablet; Safari's edge swipes kept | folded: as a phone, edges measured from the page (the 84 pt strip is not the page's); open: as a tablet |
| A Square cells | 164–179 px (6 × 4) | 3 × 5 square: 198 px | 2 × 4 square: about 152 px | 6 × 4: 168 / 196 px | folded 2 × 4: about 133 px; open 3 × 4: 194 px |
| A2 Side Pane | full height, 444 px beside the 3 × 3 (its Width on other pages) | band under, 276 px | never | as the landscape tablet; portrait a band | folded never; open a 198 px band |
| B Centred | yes | yes | yes | yes | yes |
| C Big Number | T and L | T and L | T (2 × 2 cells are L) | T and L | as a phone / tablet |
| D Bright Glass | Shared Layer; ladder offers Glass on a slow tablet | the same | the same | the same | the same |
| E Wallpaper | drawn once at the screen's size | redrawn on rotation | the same | the same | redrawn on fold |
| F Numbers clock | S bare | S bare | S bare | S bare | S bare |
| G Cameras | Full: 3 × 3 at 16:9 | Full: 3 × 3 | Full: 2 × 4 | Full: 3 × 3 | folded Full: 2 × 4; open Full: 3 × 3 |
| H Near | a near-the-screen sensor ends the screensaver | the same | not used | not used | not used |

## Order and checks

| Work phase | Design phases | Why first |
|---|---|---|
| 1 | 0 Swipe Between Pages | the owner's first pick; touches only the shell and the tab bar |
| 2 | A, A2, B, C, F | the HomeView layout: cells, the pane, tiles, thermostat, clock |
| 3 | D, D2, E | the material and the wallpapers, everywhere |
| 4 | G, H, I | new behaviour: cameras face, near, screensaver faces |

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

All answered on 2026-10-30 (decisions 7–14). Left to measure while building: the Time Behind model's speed and edges
on the house's machine, and the share of the house's photos that qualify.

## Proposed changes to the house DESIGN.md

To apply to `hk_house/docs/DESIGN.md` only with the owner's yes. Shown as text to add, by section.

**The scales → Blur**, a row:

| tier | value | where |
|---|---|---|
| bright | blur(4px) saturate(1.3) brightness(1.08) | Bright Glass: plates (Shared Layer), the tab bar, the menu, chips; its sheets take `blur(34px) saturate(2)` |

**The scales → Spacing**, in the tiles tier: "a Home Grid's square cell 196 × 196 (`HOME_GRID.square`); a centred
tile, measured off HomeView: the glyph's 66 px box (40 in a 64 px well, lit) centred at 33 %, the name 21 / 600 and
the room 20 / 400 on 27 px lines from 57.7 % (in a 150 tall cell: 50 px at 31 %, 17 / 16 on 22 px from 55 %); the
Square screen type's edge 14 px; square cells' gap 13 (HomeView's 6.7 %), 196 × 150 tiles keep 10".

**The scales → Corners**, two rows:

| rule | px | where |
|---|---|---|
| square | 34 | every block on square cells, whatever its size (HomeView's one radius, measured) |
| square screen | 72 | a Square screen's corner block, its outer corner only: concentric with the display |

**The scales → Type roles**, a row:

| role | size / weight / tracking |
|---|---|
| display | min(44cqh, 44cqw) / 500 / −0.03 em, tabular, centred at 42.7 % of its block (the Big Number thermostat; the weather block's Big Temperature is the same rule) |

**The scales → Motion**, a paragraph: "**A page swipe** follows the finger; let go, it lands on `standard` (.34 s)
and the tab bar's highlight on `spring` (.42 s), placed between two tabs by the swipe's fraction while it moves.
Reduce Motion: a cross-fade (`fade`, .2 s), the highlight jumps."

**A new section, after Flat: "Bright Glass (2026-10-30)"**

> The sixth look: clear glass, a light blur and a bright rim, for vivid backgrounds (the Wallpapers). One more
> Appearance Style (`look.glass: bright`, a screen's `glass`), with a Strength (`look.bright`, 50) and the Blur
> look's three Blur Modes.
>
> | role | value |
> |---|---|
> | plate | linear-gradient(160deg, rgba(255,255,255,.24) 0%, rgba(255,255,255,.09) 45%, rgba(255,255,255,.05)), the background's light stop mixed in at 7 % |
> | rim | inset 0 0 0 1.5px rgba(255,255,255,.22), inset 0 1.5px 0 rgba(255,255,255,.30) |
> | glow | inset 0 0 24px rgba(255,255,255,.06) |
> | shadow | 0 6px 20px rgba(40,0,60,.10) |
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
>   one Side Pane per screen, of sections you choose, for the dashboard (Home Only or Every Page) and the screensaver, with one Pane Side, replacing the screensaver's and Now Playing's panes; Centred tiles
>   for the Home Grid and the room pages' Tall pills, not regular pills; a Big Number thermostat; Bright Glass
>   (the sixth look, a blur style for the ladder); twelve wallpapers of our own that tint the tiles; the look
>   reaches every surface except HK Settings. Out of scope: face recognition, an Intercom tile.

**Guards**, a line: "`test_blur` holds the `bright` tier; `test_type` the `display` role; a wallpaper contrast check
in `tests/py/test_settings.py`."
