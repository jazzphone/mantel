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
- more screensaver faces;
- (from HomeView's app screen) a Pages screen of Mantel's own pages, to get around without a nav bar.

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
| 15 | A Pages screen (2026-10-30) | **Yes**: an iPad-style home screen of Mantel's pages, right after Home in the swipe order; navigation without a nav bar |

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

## Phase J. The Pages screen (Phase 4)

The owner, 2026-10-30, from photos of HomeView's app screen: "a swipe right page that looks like the App Screen on
the HomeView … the other pages we have like Music, Lights, Rooms, etc. in a full screen page/menu format … a way to
navigate through Mantel's pages without a Nav bar."

**What you see.** Swipe from Home and the **Pages screen** comes in: an iPad-style home screen of Mantel's own pages
as large icons, over the screen's background (blurred, with the time drawn faintly behind as HomeView does). The
date and time sit top left; who's using the screen top right (their initial or picture). A tap opens the page; a
swipe back, or the Home pill at the bottom, returns to Home.

| Part | Design |
|---|---|
| Icons | one per page in the screen's menu (Lights, Climate, Security, Cameras, Music, Calendar, Weather, Energy, Timers, Vacuums, Live TV, Water, custom pages): a rounded square (22.4 % corner, as iPadOS) in the page's **Accent Color** (`PAGE_ACCENTS`, a top-to-bottom gradient), the page's hk: glyph in white; the name under it, SF Pro 17 / 500, white with a soft shadow |
| Live icons | Calendar shows today's weekday and date; Weather today's temperature; a red badge where something waits (timers running, notifications, an open door on Security) |
| Rooms | a **Rooms** folder icon (four rooms in miniature); a tap opens the rooms as their own icons |
| Widgets (optional) | any Side Pane section (Phase A2) at Less or More, as a 2 × 2 or 2 × 1 tile among the icons: Weather, Calendar, Now Playing, Security… Off by default |
| Grid | landscape tablet 6 × 3 icons (120 px icons in 176 × 200 px slots), portrait 4 × 5, phone 4 × 6; more pages than fit make a second Pages screen, dots at the bottom |
| Home pill | with no tab bar, a pill centred at the bottom: a tap or an upward swipe goes Home (the iPad's home indicator) |

**Where it sits.** Right after Home in the swipe order (Home → Pages screen → the tab bar's other pages; Phase 0's
order is one function this extends). With no tab bar it is the way around: Home ⇄ Pages screen, a tap into a page,
the Home pill back. It is a page of its own (`/pages`), so the menu and the tab bar can show it too.

**Settings** (Settings → Pages Screen, All Screens and per screen, as the Side Pane's page):

| Setting | Key | Values | Default |
|---|---|---|---|
| Pages Screen | `pages_screen.show` | off, on | off |
| Icons | `pages_screen.icons` | the menu's pages (Same as the Menu), or a list of its own, ordered | Same as the Menu |
| Rooms | `pages_screen.rooms` | a folder, each room its own icon, none | a folder |
| Widgets | `pages_screen.widgets` | Side Pane sections with a Size (Less, More) and a place | none |
| Home Pill | `pages_screen.pill` | auto (when there's no tab bar), on, off | auto |

**Code.** A new `web/hk/pages/hk-pages-screen.js` (the page, its icons, the live icons, the folder, the widgets
from `hk-sidepane.js`); `hk-strategy.js` adds the view; the view host and Phase 0's swipe order place it after Home;
`hk-tabbar.js` / `hk-menu.js` list it; `model.py`, `changes.py`, `hk-settings-model.js`, `hk-settings.js` (its
page). Both products.

**Checks.** jsc `test_pagesscreen.js` (the icons follow the menu, the badges, the folder, the grid at each size),
`test_pageswipe.js` (Home → Pages screen), Python settings tests; screenshots at 1180 × 820, 820 × 1180, 390 × 844 in
WebKit, with and without a tab bar, with and without widgets.

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
| 4 | G, H, I, J | new behaviour: cameras face, near, screensaver faces, the Pages screen |

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

## Build log

**2026-10-30, Phases D, D2 and E (Bright Glass, the look everywhere, Wallpapers), branch `homeview-glass`.** Built:
Bright Glass as the sixth Appearance Style, one stored value per Blur Mode as Blur's are (`bright`, `bright_pre`,
`bright_each` in `GLASS` and `BOARD_GLASS`; `bright` in `TAB_BAR_GLASS`), with its Strength (`look.bright`, a
screen's `bright`); `LOOKS.bright` in `hk-settings.js` sets the approved plate, blur, rim, glow, shadow, off glyph,
`--hk-look-sub` and text shadow, mixing in the lightest of the sky's four stops, and caps Strength where white text
would fall under 4.5:1 over it (`brightCap`), following the sky as it changes. `hkCards.BLUR.bright`; `HEAVY_LOOKS`
and Mantel's frame-rate signatures know it. D2: room pills (off glyph, second line, text shadow), the detail sheets
and the pop-ups left as they come (`--hk-sheet-*`: white .22 over blur(34px) saturate(2), the rim; set-in .14), the
tab bar, the side menu and More (white pill, the accent deepened to read on it), the Edit mode bar (`--hk-bar-*`);
HK Settings untouched. The screensaver's music controls already wear white .14 keys over the song's art and were
left as they are. E: `web/hk/modules/hk-wallpapers.js` (twelve SVG builders, six families, night versions, four
stops measured off the art by `tools/headless/wallpaper_stops.cjs`), loaded by `hk-loader.js` on both products' pages
and by HK Settings; `hk-sky.js` paints one as a still over its stops with a crossfade to the night version; a
Wallpaper background for All Screens, a screen and a page, with its picker and Night Version. **Two calls for the
owner:** (1) the mock-ups' day palettes gave white text 1.4–3.7:1 at the lightest stop and broke the sky's luma caps,
so the day palettes are deepened per family (rose 0.84 … teal 0.6) until both rules hold at Strength 50 — the day
wallpapers are visibly deeper than the mock; relaxing the rule to 3:1 would allow brighter ones. (2) The side menu
open *over* the page takes the sheets' blur(34px), not the 4 px tier: with 4 px its rows were unreadable over the page.
Checks: the HA build's JS suites all green (new `test_wallpapers.js`; Bright Glass in `test_glass*.js`, `test_ladder.js`,
`test_settingsmodel.js`, `test_frosttint.js`, `test_blur.js`, `test_detail.js`; `test_csssnapshot` updated on
purpose); its Python suite 779 passed (per-wallpaper luma caps and contrast in `tests/py/test_settings.py`);
`tests/test_hk_core_settings.py`; `tools/ci.py quick` passed. WebKit: `tools/headless/bright_glass_check.py` (new:
four wallpapers, day and night, 1180 × 820, 820 × 1180, 390 × 844; Home, a room, a sheet, the menu, the picker) and
`sheet_review.py --look bright` (new option) at all 8 sizes, the contact sheets looked at. Left: frame timing of
Bright Glass on the slowest wall tablet; `detail_flat_e2e.py` lives in `hk_house`, not here, so its look list is not
changed; Flat's own backgrounds don't offer a Wallpaper; the Home Grid's keys (`HkGridKey`) keep their glyph colours
until Phase B's centred tiles land.

**2026-10-30, Phases G and H (branch `homeview-camnear`).** *G, the Cameras face:* `cameras` in both catalogs
(XL, XXL and the new Full, `F`: `SIZES` 0 x 0 = the grid's own, `home_grid.span()`, at [0, 0] only and alone in its
view by the overlap rule; options `cameras`, `refresh` 5–60). `hk-grid-cameras-card` arranges up to nine (3 × 2,
4 × 2, 3 × 3; 2 × 4 on two columns; fewer cameras, fewer places) and draws them through hk-camera-mosaic-card's new
`grid` layout (the strip's stills, at each tile's size); a tap opens the camera sheet; a doorbell ring makes its tile
live in place for a minute, one face per tablet, never under a sheet. hk-layout spans F (`--hk-span-c/-r`); the
editor places F. *H, More When Near:* `near` in `LISTS`, rule 9a after In Use and the screensaver's own controls,
`near_cm` (30–300, 120) and `near_linger` (10–300, 30); with a near list a touch counts for the shorter of the window
and the linger, and `Sleep.back_to_saver()` brings the photos at once when nobody is near; the Sleep Screen page has
Near the Screen, Closer Than and Back to the Screensaver, and says it needs Decided By HK. Checks: the sleep tests
(+11, run again on Mantel's House), the home grid tests (+20), HA's sleep engine and rules (31 passed, one new: the
screensaver leaving on near and coming back), every JS suite (144 green; CSS snapshot refreshed), the new
`tools/headless/cameras_face_check.py` in WebKit at 1180 × 820, 820 × 1180 and 390 × 844 (passed, looked at),
`ci.py full --only` grid_blocks_check, client_smoke, hk-frontend-js (passed), `ci.py quick` (passed). Left: no
history replay of the Sleep Screen exists to extend; while somebody stands near without touching, the screensaver
still starts at Starts After and the Sleep Screen takes it away again at once (a page-side hold for near is not
built); a ring rebuilds every tile of the face, so the stills are soft for a moment until they reload; the still
cache load test with nine cameras on several tablets was not run.

**2026-10-30, Phases A, B, C and F (branch `homeview-grid`).** Built: square cells (`home_grid.cell: square`, 196 ×
196 with a 13 px gap; one table, `hkCards.HOME_GRID.square` and the catalog's `CELLS`, read by `_place`, `_measure`,
`HkBase._block()` and the editor's `scaleAt()`); the Square (3 × 3) screen type, stored as `home_grid.screen: square`
(a 3 × 3 of square cells is also Home with Pane's grid, so the type needs its own key) with its 14 px edge; corners
through `--hk-block-radius` on each cell (34, and 72 on a Square screen's outer corners: four values), read by
`hkCards.plate()`, the tiles, the keys, the clock, the camera, Now Playing and the vacuum; Cell Shape in Editor →
Screen → Grid (blocks keep their places); hand-written HomeView-style starters filled from the house (Square, 6 × 4
on a landscape tablet, with a hook for Home with Pane before it; Square, 3 × 5; Square, 2 × 4; HomeView-style on the
Square type), all with Centred tiles. Centred tiles: `look.tile_style`, a screen's `tile_style` and a block's `tile`
in both catalogs, HK Settings → Appearance → Tiles (Same as All Screens, Reset) and the block's Appearance; the
measured geometry is `TILE.centred` in hk-base.js, one CSS builder (`hkCards.centredTile`) used by hk-tile.js and the
keys; the Home Grid's accessory and scene tiles name their room, a room page's Tall pills keep their state. Big Number:
`opts.style` (`THERMOSTAT_STYLES`) in both catalogs, drawn in hk-control.js beside `_climate` (steps held on the face,
`set_temperature` 600 ms after the last tap; a hold on the number shows the modes; the name opens the sheet). Analog
Numbers: `FACES.numbers`, in `CLOCK_FACES`, the screensaver's Clock Style list and `SAVER_CLOCK_STYLES`; bare, it
fills its block. Fixed for square heights: the Wide Now Playing cover (it pushed the transport off the side), the
block size's gap (`_block()` used 10), the corners above. Checks: Python home grid, cards and settings tests (180
passed); every HK Frontend jsc suite (144 green; the CSS snapshot refreshed on purpose); `home_grid_audit.py`
(new `--cell square`, `--homeview`; Full Width blocks on a screen of their own) over all 24 cards in tiles and in
square cells: the only differences left are 44 px controls measured on a canvas scaled to 0.74 at 1280 × 800;
`grid_blocks_check.py` (new `--cell square`) passes in tiles and square cells, Chromium and WebKit;
`home_grid_visual_check.py --homeview` (new) passes every starter in Chrome and WebKit at 1180 × 820, 820 × 1180 and
390 × 844 (and the Square type at 800 × 800); the Square starter beside the mock's square screen matches in layout.
Left: the colours of off glyphs and the plate are Bright Glass's (Phase D); Home with Pane's starter is A2's; the
Extra Large thermostat (the sheet in a block) clips its dial in tiles and square cells alike, as before this work.

**2026-10-30, Phase J, the Pages screen** (branch `homeview-pages`). Built: `pages_screen` in `hk_core/settings`
(All Screens' every field, off by default; a screen's own fields or None) with its checks in `changes.py`, the
page's copy in `hk-settings.js` (`pagesScreen()`); `web/hk/cards/hk-pages-screen.js` (in `cards/`, not `pages/`,
so both products load it as a card: Lovelace resource on HK Frontend, lazy on Mantel) with the icons in their
Accent Colors, live Calendar and Weather, badges (timers, Security's open doors and armed alarm, notifications for
a page), the Rooms folder, widgets through `hkSidePane.section(kind, size)` where Phase A2's renderer is there, the
faint time, the Home pill and a second Pages screen with dots; the strategy adds `/pages` after Home only while it is
on; the menu lists it after Home and the tab bar as its second tab (`m.pages`), Edit mode leaves it in place, and
`hkMenu._.pagesAfterHome` is offered to Phase 0's order function if it takes an extension (`extendOrder`,
`extend` or `addOrder`, read defensively); Settings → Pages Screen for All Screens and each screen. Checks:
`test_pagesscreen.js` (62) and the other jsc suites green, `tests/test_hk_core_pages_screen.py`, the HA package's
Python suites, `tools/ci.py quick` and `full --only hk-frontend`, `edit-mode-check`, `side-strip-check` all passed;
`tools/headless/pages_screen_check.py` passed all 12 WebKit cases (three sizes, with and without a tab bar and
widgets), the screenshots compared with the mock-up's Pages screen. Left: the widgets' look waits for Phase A2's
renderer (the check stands one in); the widget kinds (`PAGES_SCREEN_WIDGETS`) are to become Phase A2's
`PANE_SECTIONS` when both are merged (a test says so if they differ); Phase 0's order function name is to be
confirmed at merge; the Pages screen's own screens swipe natively (`data-hk-control`) when there are two or more,
so a page swipe from its last screen to the next page is not there; not yet seen on the iPad or a wall tablet,
where the background blur shows (headless WebKit draws none).

**2026-10-30, Phase 0 (Swipe Between Pages), branch `homeview-phase0`.** Built: `web/hk/modules/hk-pageswipe.js`
(the gesture, the slide and the order; loaded by `hk-loader.js` in both products): the tab bar's pages left to right,
the side menu's Home and Categories with no bar, none on a room or a page under More; the order extendable with
`hkPageSwipe.extend(fn)` (`fn(items, ctx)`, for the Pages screen right after Home), and Automatic on where a tab bar
shows or the screen's `pages_screen` is on (read defensively: `hkSettings.pagesScreen()` if it exists, else the board
key; absent is off). The neighbour is the view host's own when held (`hkViewHost.live().peek()`; `show()` no longer
re-appends a view already in the slot), else a title plate built on landing; also the plate on a tablet the ladder
flagged. The tab bar: `pages()`, `follow(k, path)` (between two tabs, along a bar or down a rail) and `land(path)` on
the spring at .42 s. One list of what moves sideways itself, `hkDrag.sideways` (and `hkDrag.classify`, press()'s
test, shared); Home Grid's views use it, and hand a swipe past their last view over (`hk-swipe-past`), landing on the
last view coming back (`swipeEnter`). Found in the browser: a scroll container takes every sideways pan even when it
has nothing to scroll, so a row that fits (hk-row-card, a room's status row) now says touch-action pan-y
(`hkCards.fitPan`), and hk-control's slider wrappers carry `data-hk-control`. The setting: `menu.swipe_pages` and a
screen's `swipe_pages` (None: Same as All Screens), HK Settings → Menu → Gestures and a screen's Menu Settings.
Checks: jsc `test_pageswipe.js` (70), `test_tabbar.js`, `test_homegrid.js`, `test_settings.js`, `test_settingsmodel.js`
and every other suite green (CSS snapshot updated for the landing rule); `tests/test_hk_core_settings.py`;
`tools/headless/page_swipe_check.py` passed in Chromium (CDP touch) and WebKit (synthetic touch pointer events) at
1180 × 820, 820 × 1180, 390 × 844 and 844 × 390 (added to `ci.py full` as `page-swipe-check`); `ci.py quick` passed;
`full --only` ha-build, hk-frontend-py/-js, grid_blocks_check, edit-mode-check, side-strip-check passed. Left: frame
timing on the slowest wall tablet (`hk-fps.js`, SLOW_FPS) and trying it on the owner's iPad (Safari's own edge
gestures, its pan decision on a real finger); WebKit's touch-action is not exercised headless.

**Phase I, Screensaver faces (2026-10-30, branch `homeview-faces`).** Built: the Shows Glance, Month and Day and the
Forecast's Big layout (Big Weather) in a new `web/hk/modules/hk-saverfaces.js`, sized in units of their own box (so
they fit beside the Side Pane and on a phone), mounted by `hk-saver.js` as Show: Clock is; the weather's readings for
them as `hkWxReadings` in `hk-weather.js`; the clock faces Liquid (a canvas drawn once a minute, drifted by a CSS
transform), Giant Numerals and Scattered Numerals (once a minute; the second hand a layer the browser turns) in
`hk-saverclock.js`, each with colour variants and a ground of its own, also offered by the Clock block (both catalogs);
Photo Titles (the album's name and the year) and Photo, Time Behind (the time behind the photo's subject, the time in
front where a photo doesn't qualify); the options in `model.py` and `hk-settings-model.js` (new Shows, `forecast_layout`,
`photo_titles`, `time_behind`, `day_look`; each default is how the screensaver drew before -- the screensaver's
options are a filled-in mapping, as `saverKnown` needs); HK Settings: Show as a menu with a strip of small pictures of
each Show, the faces' pages, a picture on each Clock Style row, the Forecast Layout, Titles and Time Behind. Mantel:
the cut-out pipeline (`cutout.py`, the worker, `CutoutBackfill`, migration 0027, the routes, the quota, backups, Setup
Check, Photos' badge and Only Photos That Qualify; docs/phase4/PHOTOS.md, "Time Behind"). Checks: the Python suites
for photos, cut-outs, settings and Home Grid; HK's jsc suites (`test_saverclock.js`: each new face at every Clock
block size, `test_saverfaces.js` new, every suite in the HA build); `tools/headless/saver_faces_check.py` in WebKit at
1180 x 820, 820 x 1180 and 390 x 844, compared by eye with the mock-up's faces; `tools/ci.py quick`. Left: **the model
file** (u2netp.onnx and its SHA-256 in `cutout.MODEL_SHA256`; not downloaded), then the cut-out rules tuned and the
cost measured on the house's photos and machine; the Day face's art for Thanksgiving and the July 4th/Valentine's
frames as sprites of their own; Phase F's Analog Numbers face is another branch's -- Glance uses it once it is there
(the analog face until then); the Side Pane beside the faces is Phase A2's (the faces read their box, not the window).

**2026-10-30, Phase A2, the Side Pane (branch `homeview-pane`).** Built: All Screens' `side_pane` and a screen's
sparse own one in `hk_core/settings/model.py` (each group resolving on its own; every screen handed
`side_pane_read`), the writes checked in `changes.py` (eight sections, one Full), the once-only move of the
screensaver's Calendar / Music pane and Now Playing's Show As: Side Pane (`side_pane_lifted`: Home Assistant's entry
1.18, Mantel's start-up, which also sets the older keys back); To-do lists through the `House` port
(`hk_core/todo.py`, `service_response`: HA's own `todo.get_items` as `hk_frontend/todo/items`, Mantel's gateway as
the person; check-off is the page's `todo.update_item`, a command like any other); `web/hk/modules/hk-sidepane.js`
(the twelve sections at four sizes, When There's Something, the doorbell, the fit that never scrolls, the room it
takes; a band upright, never on a phone); the screensaver's pane reading its group on its Pane Side (the older
calendar-and-music shape drawn as before); Now Playing's pane retired into it (the bar gives the music up while the
pane shows it); the Home Grid beside it (`paneRoom`, the band off its height); HK Settings → Side Pane for All
Screens and each screen, and links from Screensaver Options, Now Playing's Show As and the Home Grid editor.
Checks: `tests/test_hk_core_side_pane.py` and `test_hk_core_todo.py` (pass); jsc `test_sidepane`, `test_homegrid`,
`test_settingsmodel`, `test_saver`, `test_strategy`, `test_pager` and the whole JS suite (pass); HK Frontend's
Python suites (pass); `tools/headless/side_pane_check.py` (new, ci `side-pane-check`) in WebKit at 1180 × 820,
820 × 1180 and 390 × 844 (pass); `grid_blocks_check`, `grid_music_turn_check`, `side_strip_check`,
`client_smoke`, `settings_viewports` (pass); `tools/ci.py quick` (pass). Left: the "Home with Pane" starter (the
integrator, after square cells); beside 3 × 3 square cells the 444 px width is computed from the grid's measured
canvas but only seen with today's 196 × 150 cells here; headless WebKit draws no backdrop blur, so the pane's glass
was judged opaque; on a portrait Home Grid the band may cover a few px of the last row (the tab bar's room and the
band's bottom are measured from two variables); notifications are those this page has shown since it loaded; the
Energy section reads the house's power sensor (solar and battery by name), not yet the Energy feature's plan.

**Integration (2026-10-30, the integrator).** The seven branches merged into one, every suite green after each
merge. Found while merging and fixed: the Pages screen joined the swipe order last instead of after Home
(`hk-pageswipe.js` loads after the menu and never announced itself; now it does, and `test_pagesscreen` loads both
in the loader's order); the Side Pane had no way to draw one section as the Pages screen's widget
(`hkSidePane.section`, a chrome-free `widget` mode) and the two named Who's Home differently (`people`, held equal by
a test); test expectations two merges broke (the clock faces' order). Added the **Home with Pane** starter, first on
a landscape tablet: a 3 × 3 of square tiles (Fill the Screen, band off) that turns the screen's Side Pane on for
Home (Weather, Calendar, Now Playing while it plays) in the same write as the layout, unless the screen already
shows a pane (`paneForStarter`, tested).

**Time Behind's model vendored (2026-10-30, the owner's OK).** `u2netp.onnx` (4,574,861 bytes, SHA-256
`309c8469…f4ddd8`) from the rembg project's v0.0.0 release, in `hosts/server/mantel_server/models/` beside its licence;
`cutout.MODEL_SHA256` set. ONNX Runtime loads it (one 320 × 320 input, 320 × 320 masks). On this Mac a cut-out takes
0.16 s: a plain wall with one subject qualifies (16 % cover, 0.90 confidence, 26 % overlap, a 14 KB mask), a landscape
with no subject doesn't (size), so it keeps the time in front. The two tests of the unavailable path now make the
model absent themselves; the vendored-file checksum test runs instead of skipping.

### The owner's feedback on 0.1.89 / 1.17.0 (2026-10-30)

Thirteen items, the owner's go-ahead for all of them ("do all the proposed changes"); the decisions left to us are
marked **Decision**.

1. **The Side Pane wasn't blurred.** It was a near-solid navy plate (.92–.97 alpha) with its blur hidden under it,
   by design when it was built; the Now Playing pane it replaced had been a frosted sheet. It now wears the docked
   side menu's material in the screen's look (`hk-sidepane.js`, the host's `look`): one live blur (34 px) under
   `rgba(28,28,32,.52)` in Blur, the white wash and light blur in Bright Glass, its slice of the sky's picture in
   Pre-rendered (`hkGlass.pin`), near-solid with no blur in Frosted, Tinted and Flat. A MutationObserver on
   `data-hk-glass` follows the slow-tablet ladder too. `side_pane_check` asserts the material per look.
2. **Words cut by the corners** ("ff" for Off, "ood Morning"): a Square screen's 72 px outer corner, not the 34 px
   one. A corner block's padding grows by ⌈(72 − 34) × (1 − 1/√2)⌉ + 1 = 13 px on the two sides that meet at the
   outer corner (`cellInset`, `--hk-in-t/-r/-b/-l`, read by the tile). `home_grid_visual_check --homeview` now runs
   every starter in the Home Tile Style too and fails any line of text whose ends fall outside its plate's corner
   circle (it caught "Movie Night" before the fix).
3. and 11. **Tiles not HomeView's / the format should follow Square.** **Decision:** Tile Style **Automatic**, the
   new default: Centred on a Home Grid of square cells, Home on 196 × 150 tiles and the room pages; Home and
   Centred stay as overrides, and a block's own choice still wins (`hk-strategy.js`, settings `tile_style`
   `auto`). A screen that saved Home outright keeps Home.
4. and 4b. **Looks.** **Decision:** eight, in `hk_core/settings/looks.py` (the JS copy compared by a jsc test):
   HomeView, Flat, Performance, Holiday Whimsy, Active Weather, Calming Backgrounds, Night & Bedside, Photo Frame.
   Each sets the style and colours (accent, tab bar glass, flat theme), the background and sky (wallpaper and its
   Motion, weather, animations, decorations, liveliness), Tile Style, the Side Pane, Swipe Between Pages and the
   screensaver (a patch over the screen's options), and names its layout: the editor's starters it prefers per
   screen type (square starters for HomeView and Calming, the house's tile starters for the others, the
   nightstand's for Night), so a phone, an upright tablet and a Square screen each get their own. Two places: a
   screen's **Looks** page (the settings; its layout stays), each Look's page listing what it changes (was →
   becomes, only what differs); and **Layout + Look** in the editor's starters (the layout too, in one Save).
   Undo: the screen's own values before are stored as `look_undo` (each checked as the setting itself), and
   Looks → Undo puts them back. `looks_check` (ci full) applies each, draws Home at three sizes, undoes it, and
   saves Layout + Look from the editor.
5. **Missing icons.** Mantel serves a subset of Material Design Icons (`web/mdi/icons.json`, 660, built from an old
   snapshot); seven names the HomeView work used weren't in it, so they drew blank in Mantel only (Home Assistant
   ships them all). Swapped for names the subset has (`dock-left`, `clock`, `account`, `clipboard-check`, `card`,
   `home-thermometer`); `test_every_glyph_hks_own_frontend_names_is_served` now fails on any name HK's frontend uses
   that Mantel doesn't serve. **Open:** regenerating the subset from `@mdi/js` (a download, waiting for the owner's
   OK in that session) would bring back `dock-right`, `account-multiple` and `format-list-checks` themselves.
6. **A preview on the Side Pane page:** the screen's live preview at the top at every width (a screen that follows
   All Screens on All Screens' page).
7. **Headings in the pane.** **Decision:** none; the sections sit straight on the pane's glass with a hairline
   between them (a to-do list keeps its own name: which list is content). Pages-screen widgets keep their plate.
8. **The shared blur layer's shape.** `hk-glass.js` read only the top-left radius, in the plate's unscaled px, while
   a Home Grid's canvas scales its blocks: the cut came out tighter than the plate's own curve, and a Square screen's
   four corners were one. It now reads all four, at the size the plate is drawn (`rrect` takes four radii). The grid
   check fails a layer not cut at its plate's drawn corner (caught when the fix is taken out).
9. **Big Number.** A dot under the picked target instead of the underline; the dash between the targets a drawn bar
   about half an en dash; the foot's arrows out to 4 % with 12 px gaps, and the name on up to two lines before it is
   cut.
10. **Columns for square cells.** **Decision:** a segmented 6 / 5 / 4 / 3 / 2 (`home_grid.COLS` adds 4 and 5). On
    square cells the rows follow the screen's shape (`rowsFor`: the frame, less the Side Pane's ~400 px beside it on
    a screen on its side) and the blocks flow onto the new grid in reading order; tile grids change columns only
    when every block still fits, as before.
12. **Animated wallpapers.** **Decision:** Wallpaper **Motion** Off / Slow / Medium / Fast (90 / 45 / 20 s each way),
    **Off by default** (wall tablets run all day); the Looks turn it on (HomeView, Calming: Slow) or off
    (Performance). Each shape moves its own way (ribbons sway, petals breathe, shards drift, pinwheels turn): a
    transform on the pre-drawn layer, 10 % past each edge, no repaint and no filter. It stops where the sky stops
    (hidden, held under the black screen), with Animations off and for Reduce Motion, and counts as animation on
    the slow-tablet ladder (`ladderFacts`, `hkSettings.ladderSignature`). `bright_glass_check` measures it moving by
    transform alone at 50+ fps in WebKit at 1180 × 820, and still under Reduce Motion. The shared live blur follows
    it frame by frame; Pre-rendered's picture does not (as with the clouds).
13. **The Rooms pop-up in Bright Glass.** Bright Glass's sheets were white .22 over a blur that brightened
    (saturate 2): over the blue wallpaper, a bright clear blue. Now a deep tint under a white sheen over the blur held
    down (`BRIGHT.sheet`, `sheetBlur: blur(34px) saturate(1.5) brightness(0.86)`), keeping white text at 4.5:1 over
    each wallpaper's lightest stop; the page dims behind an open sheet; the Rooms icons sit in white circles in the
    accent deepened; a long room name has three lines. `bright_glass_check` opens the Rooms sheet at each size and
    checks the contrast. **For the house DESIGN.md:** its Bright Glass line "its sheets take blur(34px) saturate(2)"
    is now this sheet plate (not edited: the house docs are the owner's).

**14. The album art behind the whole Side Pane (2026-10-30, on 0.1.90).** At More and Full, Now Playing held the
music pane with its own blurred-art backdrop in a 540 px box: a dark rectangle in the middle of the pane. The owner:
"if something is playing, the whole pane should have the album art blur". Now, while Now Playing is one of the pane's
sections and has a song, the pane's own ground is the song's art: drawn 10 px, then 20 px, then 64 px with a 2–3 px
blur and darkened by 0.38, as a small PNG on a plain layer (a scaled-up canvas was left unpainted by WebKit at
1440 × 900), under a shade for its words, edge to edge. The next song's art cross-fades over the last; stopped (Now
Playing stepping aside after Hide After a Pause), it fades back to the screen's glass. The music card in the pane
(`nobg`) draws no backdrop or box of its own. Where the look has no blur (Flat, Tinted, Frosted, Glass —
Performance's), a flat tint from the art's mean colour at 42 %. The screensaver's pane does the same. No live filter
anywhere; a picture that can't be read (another origin) falls back to itself under a CSS blur rasterised once.
`side_pane_check` plays a bright cover and checks the pane takes it on both sides and at 1180 × 820 and 1440 × 900,
white words at 4.5:1 or better over its lightest part, the tint in Tinted, and the glass again once it stops.

**15–17 and the owner's evening notes (2026-10-30, after 0.1.91).**

- **Dividers that came and went (15).** `hk-sidepane.js` built its stylesheet once and kept it. Built before hkCards had
  loaded, its design values had no fallbacks, and the pane hangs under `<body>`, where no `--hk-*` value is set: that
  load's pane had no hairlines and no second ink (the grey "Tomorrow" went white), until a reload won the race. The
  sheet now carries fallbacks of its own, isn't kept until hkCards is here, and is replaced once it is.
- **The weather (and other data) going away and coming back (16).** Mantel narrows a page's state subscription to
  what its cards read in a recorded pass; the Side Pane, the menu, the tab bar and the screensaver draw outside that
  pass, so what only they read was dropped, then asked for again on their next read by name (`onMiss`) — away, then
  back. And the pane found its weather by listing the `weather.` states it held, which a narrowed page has none of,
  so nothing was asked for: "No weather" stuck. Now Mantel's host keeps every state read at any time outside the
  strategy's whole-house pass (`Host.seen`), and narrowing keeps those too; the pane names a domain's entities from
  the house's registry as well (reading one by name asks for it); and the weather section keeps its last state while
  the live one is away — "No weather" only where the house has none.
- **Section Headings (17).** **Decision:** a Side Pane setting, On by default (the owner leaned back toward them),
  All Screens' or a screen's own: the small uppercase title with its icon over every section but the Clock and the
  Weather (the music pane gets room for it above itself). The Looks set it: HomeView on, Active Weather off.
- **Width did nothing beside a Home Grid.** The pane took whatever the grid left (444 px beside a 3 × 3), so Narrow,
  Standard and Wide all looked the same on Home. **Decision:** its Width always; the grid fits itself in the rest.
- **A Side Pane change rebuilt the whole page.** `side_pane` (and the screen's resolved `side_pane_read`) weren't on
  the strategy's list of settings no build reads; the pane reads them live, so now nothing is rebuilt.
- **The Rooms sheet** reads as before Bright Glass (soft circles, the glyph in the accent) on the darker sheet plate,
  and every icon sits on one line however many lines its name takes.
- **The tab bar in Bright Glass** is a little darker under its wash (`rgba(14,18,30,.30)`), its names' shadow
  stronger, for light pages such as Climate.
- **Bright Glass On.** **Decision:** a new setting, Home Only (the default) or Every Page, All Screens' or a
  screen's own: with Home Only, every page but Home wears Blur in the same mode (Shared Layer, Pre-rendered, Each
  Plate). The owner: "I like the radius and everything else of the Bright Glass... but the blur appearance just
  looks nicer" on the other pages.

Checks: `side_pane_check` asserts the headings, the dividers and the second ink in the Dashboard's and the
screensaver's panes, the Width beside the grid, and the weather on a page Mantel has narrowed (in the gallery a
page's header keeps the weather, so the sticky case is covered by `test_sidepane.js`'s registry and last-state test
rather than in the browser); `bright_glass_check`, a room page in Blur; `test_strategy_rebuild`, a Side Pane change
rebuilding nothing.

**The Side Pane's sections, and the Security block (2026-10-30, the owner directly).**

- **At the top or at the foot.** **Decision:** a section's Place, Top (default) or Bottom, rather than two lists:
  the top ones in order, a space, then the bottom ones (Now Playing at the foot, say).
- **The pane's player had lost Speakers and Browse.** The music view hid them when it was made before
  `hk-saver-panel.js` had loaded, and never looked again; it now looks on every draw.
- **Less / More / Full that barely differed.** Now Playing at More is the player without Up Next and the album (its
  art smaller), Full all of it; the Calendar's Less the next two, More every event of its Days (3 unless set),
  Full a week's, the list scrolling inside the section where it doesn't fit (the pane itself still never
  scrolls); Energy's Less what the house uses, More with the panels, the battery and today's, Full each as a row;
  Climate's Less the temperatures, More and Full where each is set to; Who's Home at Full each person, where and
  since when; Timers at More and Full offer the quick ones even with none running.
- **Every section does something when tapped.** **Decision:** a section's When Tapped: Automatic (default: its page
  where this screen has one, else its detail sheet), Its Page, Its Sheet or Nothing; a tap on one thing in it (an
  event, a person, a lock, a thermostat, a source of power) opens that thing's sheet.
- **The Wide and Extra Large Security blocks on square cells.** Tile Style Automatic put the Centred layout on the
  Wide block, whose mode buttons then piled over its name: a Security block past Small now keeps its own layout
  unless it chooses Centred itself. The Extra Large keypad's keys grow to 88 px, so four rows fill a square cell's
  height instead of leaving a band under them.

`side_pane_check` (a pane with the music at its foot: the space, the player's Speakers and Browse, a person's sheet
and the weather's page on a tap), `test_sidepane.js` (the calendar's sizes and targets) and the grid check's
Security screen.

**18–23: the Pages Screen and the columns (2026-10-30, on 0.1.91).**

- **18, the resize on first load.** Going from Home to another page, the Side Pane changed width: beside Home's grid
  it took what the grid left, elsewhere its Width, so Home was laid out again under the new width before the next
  page showed (the reflowed grid in the recording), and again on the way back. With the pane always its Width
  (item 15's batch) it stays put; `side_pane_check` now asserts the same `--hk-pane-r` on Home and on another page.
- **19, the huge clock.** **Decision:** the Pages Screen's **Background Clock**, Off by default (All Screens' or a
  screen's own).
- **20, the blur.** The Pages Screen's background blur goes from 26 px to 8 px (saturate 1.15): the wallpaper, the
  sky or a photo still reads behind the icons.
- **21, Launchpad's entrance** (taken back below: no entrance). The icons settle from 116 % and faint into place, 8 ms apart (at most 20 steps), 260 ms
  each: about 0.4 s in all, transform and opacity only; leaving by an icon or the Home pill, the reverse (170 ms)
  before the page changes. Only when the page is shown (connected, or a navigation that leaves it visible), never on
  a redraw; never for Reduce Motion, Animations off or Flat (Performance turns Animations off). Leaving through the
  tab bar changes page at once: the bar isn't the card's to hold.
- **22, the Weather icon's sky.** The icon draws the Live Sky's own scene for the weather entity
  (`hk-grid-weather-sky`, now with a `still` mode: one frame, paused, drawn again only as the weather or the time of
  day changes) under its glyph and temperature; Flat keeps the plain icon. The Home Grid's Weather block already has
  its Sky option (opt-in) and keeps it: its larger plate carries the forecast's words, which the owner hasn't asked
  to put over a sky.
- **The Side Pane's art ground, near black.** Two causes: a dark cover darkened by a fixed amount, and WebKit leaving
  the layer whose picture changed mid-fade unpainted (the pane's own ground alone showed). Each cover is now evened
  out (its mean brightness to 78, no pixel past 132, so white words keep 4.5:1 under the lighter shade), and each
  song gets a new layer, its picture set before it is in the page, faded in over the last.
- **23, columns.** The editor made the rows follow the columns (5 columns became 5 × 5 in the 4 × 4's square). The
  rows now stay what they are (they come from the height); a column more extends the grid sideways at the same cell
  size while the width holds it, and only then does the grid get smaller (`hk-layout.js` already scales by whichever
  of height and width runs out). The Grid group says how many columns fit at full size (`fullColumns`). At
  1440 × 900 beside the pane, 4 and 5 columns of 4 rows both draw 180 px cells; at 1180 × 820 five no longer fit and
  the grid shrinks. A grid saved as 5 × 5 keeps its rows until they are set back.

**After 0.1.92 (2026-10-30).**

- **21 taken back: no entrance at all.** The owner: the Pages Screen's animation "is not great at all ... just have
  the page load in at the right size ... so it doesn't jump". The entrance and the leaving fade are gone, and so is
  the jump under them: the page used to draw first at the window's size, then again at its own once laid out (the
  tab bar, the Side Pane and the safe areas take their share). It now draws only once it has a size of its own, and
  draws again only when that size changes. `pages_screen_check` asserts the first drawing was at the size it has
  when measured, at every size it tries.
- **Lists that give way in the Side Pane.** The owner: the calendar, the to-do list and the like "should contract
  vertically when there isn't enough room". The Calendar, To-do, Timers, Climate, Notifications and Who's Home at
  Full put their rows in a list that scrolls inside the section; down the pane, such a section gets shorter where
  the pane is short, to its heading and one row (and what sits under its rows: the timers' keys, the to-do list's
  Add), and fades out at its foot where rows are cut off. Only past that does a size step down or a section go.
  `side_pane_check` draws a 400 px pane 900, 640 and 480 px tall with eight events: at 640 every section keeps its
  Size and the calendar scrolls; at every height the pane never scrolls and no list is under its floor.
- **The Vacuum block, Small and Wide, on square cells.** The owner: they "don't really look good in the homeview
  layout". On a square cell they now read as the blocks beside them: a tall tile's padding, the glyph's well at the
  top left, the name and one line of status at the foot (the chips as words, "Docked · 92%", a warning in its
  colour), and the commands as round keys at the top right -- Start and Dock on Small, all four on Wide (whose last
  one was cut off on a phone). Tiles keep their layout. `home_grid_visual_check --homeview` draws a Vacuum screen.
- **A button's second line.** The owner: an input_button added among the accessories "looks a bit funny next to
  the other entities with a status line". A button or input_button added to a room, a page or a Home Grid block is
  now a tile with **Tap** under its name (it was a scene's pill, one line); a tap anywhere presses it and it lights
  a moment, as before. In a scenes row it is still a scene's pill.
- **24, Time Behind: one place for the time.** The time is now always upper centre, the same spot and size on every
  photo (6 % down, a line 28 % of the shorter side, the figures 24 %); the place Mantel chose per photo is gone.
  Mantel keeps the cut-out for any photo with a clear subject (8-60 % of the frame, sure) and no place
  (`cutout_by` "u2netp/2"; the backfill judges again the photos the old rules turned down), and each screen decides
  as it draws: the stored mask, laid out as the photo is (its fit and focus), is weighed under the figures, and
  the subject goes over the time only where it covers 5-35 % of them -- else the time in front, no cut-out. The
  share is weighed once per photo and screen, the time hidden until then (at most 1.5 s). Mantel's shell passed a
  cut-out on only with a place, so it now passes the mask alone.
- **25, the weather with Time Behind.** It sat in the corner column, jammed against the time's left. With Time
  Behind the corner clock goes and the rest of the column -- the weather, the timers -- sits under the time,
  centred, in the photo's box beside any pane; on a phone the weather at 70 % (its tablet sizes ran off both
  sides), the photo's title above what is playing, and what is playing as wide as the phone allows (it read
  "Bl..."). `saver_faces_check` draws a person at the left, the middle and the right and one filling the top of the
  frame, and checks the time's place and each decision at each size; `saver_shows_check` uploads a photo to a
  Mantel album, starts the screensaver as a house does, and checks the weather is there, under the time and
  centred, on a tablet and a phone, and screenshots the Settings preview.

**The blocks audited at their five sizes (2026-10-30, the owner: "a full Audit and fix around all the buttons in
their 5 sizes ... Alignment, proper use of space and proper understanding of edge padding").** Every catalog block
at each size it allows, on tiles and on square cells, at an iPad's and a phone's size, measured and looked at
(nine different edge insets, 6 to 23 px, were the main finding). Fixed:

- **One inset for every block** (`hkCards.blockPad`): the grid's cell sets `--hk-pad-*` -- 14 px on tiles, 18 on
  square cells (a 34 px corner's curve comes 10 px in) -- and a Square screen's outer-corner inset on top, which
  only the tiles read before (the Security and Vacuum wells were cut by the 72 px corner). Read by the full and
  panel blocks, Room and Accessories (W's heading was 6 px from the top), Scenes, Timers, People, the suggested
  scene, Calendar, Clock, Weather (its L and XL too), Now Playing, the thermostat and the vacuum. The tiles and the
  S keys keep the tile's measured padding (DESIGN.md Rule 5), with the corner inset added.
- **Concentric pills** on square cells: a group's pills take the block's radius less its inset (16 px), not 23.5
  inside 34.
- **The Thermostat XL dial** ran out of its column: a block's parts are size containers of their own now, so a card
  inside one sizes itself to its part. Its readings grow with their plate.
- **Clock Tall**: its time and AM / PM ran past the plate; Tall has its own sizes.
- **Scenes**: 20 px at the foot against 12 elsewhere with no pager to clear; fewer scenes than cells now fill the
  block (one row of them, else fewer columns), and **Room XL** with a row's worth of things draws one row of taller
  pills, not a second row of nothing.
- **Vacuum L / XL** without Clean Areas: the card sat at its own 150 px at the top of an empty block; it fills it.
- **Now Playing Tall**: Speakers and Browse sat 4 px from the corners, in the curve; 12 px in. Its blurred art kept
  the tile's corner under a square cell's.
- **Weather XL**: both columns from the top (the place and the hours level; centred, they weren't).
- **Timers** on a square cell: the ring and the name at the tiles' scale.

Left for the owner's eye (the audit's notes, docs/phase11/BLOCKS-AUDIT.md): one type scale for the blocks' names on
square cells, the scene pills' layout in tall slots, the empty middles of Now Playing Tall and Weather Tall on
square cells, Doors XL's callouts over its activity row, the Power and Water blocks' plates.
- **26, photo options that couldn't be turned off.** The owner: switched to Clock with Time Behind left on from
  Photos, "there is no way to turn it off". It still applied on Clock over photos (and with Soft photos hid both the
  clock and its own time: no time at all). Photo Titles and Time Behind now apply only where the photos are shown as
  photos -- Show: Photos and Both, and Clock on Photos that aren't Soft, where the Screensaver page offers both
  toggles -- and do nothing anywhere else (Clock on Soft photos, Landscapes or its own background, the Forecast,
  Glance, Month, Day). `test_saverfaces.js` checks each Show.

**The screen settings tidied (2026-10-30, the owner: "things are starting to become a bit of a mess. Menu,
Screensaver, Appearance").** An audit of every settings page at an iPad's and a phone's size found each feature of
the week with its own page, its own way of saying Same as All Screens (six in all) and, on a screen's page, its own
one-row group. Presentation only -- no stored key or value changed, every old address opens its page, every search
key stays:

- **All Screens** in the order a screen is set up: Appearance, Menu, Pages Screen, Side Pane (an icon of its own,
  not Menu's), Now Playing, Screensaver, Notifications, Status Chips, Rooms, Wall Tablets.
- **A screen's page**: Menu & Header, Home Page, Pages, Look (Appearance, Looks, Side Pane together), Now Playing (a
  switch and **Now Playing Options**, a page of its own, as the screensaver has), Pop-ups, Notifications,
  Screensaver. The menu's Tablets & Computers / Phones choices moved to the top of the screen's Menu page.
- **Appearance** in three groups, Tile Style under Style; a slider says whose value it is in its sub-line.
- **Side Pane**: each row says whose it is, one Reset at the foot, Show a pop-up, the sections' lists on pages of
  their own -- 1,517 px tall on an iPad, from 3,334.
- **Screensaver**: one group order for every Show, one Show control (the pop-up over the pictures went), the
  pictures three across on a phone, the photo source beside the photos' settings ("Slideshow" under it, never a
  second "Photos"); Glance, Month and Day link to the Side Pane instead of the switches it overrides.
- **Pages Screen** shows nothing else while it is off; a Look's page opens with its picture.
- Words: US spelling in labels (stored values unchanged), "Background" for "Sky / Background", menu values as
  "Button, Tab Bar on Phones", "Same as All Screens" for "House".

The audit and its notes: the shared notes' settings-layout-audit.md; `looks_check`, `settings_viewports`,
`saver_shows_check`, `side_pane_check` and `pages_screen_check` pass.

**2026-10-31, the mock-ups against what was built.** The owner asked whether everything in the artifact had been built
and compared. Every section had been built; four had been compared (the Square starter, the Pages screen, the
screensaver faces, Bright Glass). The other eleven were shot in WebKit beside the artifact's own sections
(`home_grid_visual_check --homeview`, `side_pane_check`, `cameras_face_check`, `bright_glass_check`,
`page_swipe_check`, `home_grid_audit --cell square`):

- **As the mock-up:** the full 6 × 4 and Home with Pane (3 × 3 at 216 px beside the pane), Centred tiles, the
  numbered analog face, Swipe Between Pages (the plates move, the wallpaper stays), the Cameras face's 3 × 3 and
  2 × 4, its LIVE ring on a doorbell, the settings' keys, and the per-screen table.
- **Different on purpose (the owner's later calls):** the Side Pane's sections sit on the pane's glass with
  hairlines, not on plates of their own (7, 17); Big Number marks the picked target with a dot, not a rule; Bright
  Glass's sheets are a deep tint, not white .22 (the Rooms sheet over the blue wallpaper was hard to read); a tap on
  the Cameras face opens the camera's sheet, as the plan says, rather than making that tile the live one.
- **Fixed:** the Side Pane's calendar stopped at 300 px with a space under it (the owner: "a gap/space above Who's
  Home that could be filled") -- down the pane its events now run to the sections at the foot, and where the pane is
  short it is the first to give way, the other lists keeping their rows (`side_pane_check`'s tall pane);
  Weather Wide on a square cell left its lower half bare -- it is the medium Weather widget now (the owner's widget
  references: the same 2 : 1), the next six hours along its foot, where there are hours; the Camera block on the Home
  Grid names its camera, as the mock-up's did (the name at the foot, the age at the top, the Cameras face's tags).
- **Left:** More When Near has no page-side hold -- somebody near the screen without touching it still sees the
  screensaver start at Starts After and the Sleep Screen take it away again (the Phase H entry's note); the Cameras
  face's stills are soft for a moment after a ring, until each reloads; Weather Tall and XL and Now Playing Tall on
  square cells keep their empty middles, for the widget pass the owner's references start.

**2026-10-31, More and Rooms as app icons; Home Only takes in the Pages screen; the All Screens Side Pane preview.**
The owner picked from a mock-up of three (round wells, bare glyphs, app icons): "App Icons, Roomy, and the Rooms
having their own Color". Every page and room in the tab bar's More and Rooms sheets, and in More with the rooms in
it, is the Pages screen's app icon: a rounded square, lighter at the top. A page takes its accent, a room its tint by
its place in the menu's rooms, so a room is the same colour on both. Anything else (Home Assistant's pages,
Notifications, This Page) is grey; Calendar shows the day's date. `hkCards.roomTint` and `iconGradient` (hk-base.js)
are now shared with hk-pages-screen.js. On a tablet (its shorter side 600 or more) the sheet is bigger: up to 1040
wide, 72 px clear of each side, its icons 76 px (the owner: "a lot bigger on the tablet, as long as there is enough
room around it to tap out"). The phone keeps 60 px icons, and the list (More Style: List) its bare glyphs. Bright
Glass On: Home Only now counts the Pages screen as Home ("they are essentially shared"). The Side Pane's All Screens
page in Settings had no preview when every screen has a pane of its own; it now previews the first screen drawing
All Screens' pane (`hkSidePane.previewHouse`). Checks: `bright_glass_check` (each room an app icon in its own
colour; a tablet's sheet with 72 px of page each side; More with the rooms in it), `side_pane_check` (the Settings
preview, both ways), `test_tabbar`, `test_glass` (Home Only on the Pages screen).

**2026-10-31, an Accessory block Centred: its Line Under Name, and its glyph.** The owner put an alarm's keypad in an
Accessory block, set Line Under Name to State, and it still said its room, its glyph a speck beside the others. A
Centred block put the room under every accessory's name whatever Line Under Name said; now a chosen line (State,
Brightness, an attribute, Hidden) wins and the room shows only for Automatic. And a Centred block now draws every glyph
at its own size, in its circle when on: the alarm's tile came from the room pages bare, at their 27 px. The app icons
in the tab bar's sheets now take their corner (22.4 %) and Calendar's date from the icon's size, as the Pages screen
does, rather than as new off-scale pixels (the radii and type ratchets). Checks: `test_gridcards` (+3),
`home_grid_visual_check --homeview` (a new Accessory screen: the alarm armed, and with Line Under Name State).

**2026-10-31, Centred tiles without circles; a Small camera; Who's Home spread out.** The owner, beside HomeView's
own picture: "No circle/wells behind icons. fairly large icons". A Centred tile now draws every glyph bare at the
glyph size (66 px in a square cell, 50 in a 196 × 150), off and on alike; on, it is in its own colour on the white
plate (hk-tile.js draws a Centred tile's glyph as `bare_icon`). The measured places were checked against that picture
again and hold: the glyph's centre 33 % down, the name 57.7 % (21 / 600), the second line under it (20 / 400) on 27 px
lines. `TILE.centred` loses `well` and `lit`. The Camera block comes Small (one still in a cell; both catalogs). The
Side Pane's Who's Home spreads its people evenly across the pane, as the block does, not packed to the left.
`home_grid_visual_check` gains `--only SCREEN`, and its "page scroll" now says by how much, the band's height and any
bottom margin left on the page: Home with Pane at 4 columns, upright, scrolled by exactly the band (276 px) twice in
full runs and never when run alone -- not yet caught in the act.

**2026-10-31, a block pager at rest on its page.** The owner's Camera block (nine cameras, on the sixth) sat a few px
to the right of the column under it, its left edge out of line too. The pager's pages are exact (each page the
track's width, `PAGER_ROOM` either side), but a smooth turn cut short -- a camera following motion while the block was
drawn again, or a hidden tab -- left the track a few px past its page, and nothing put it back. Once the track has
been still for `PAGER_STILL`, it now sits exactly on the page it is nearest (`test_pager`).
