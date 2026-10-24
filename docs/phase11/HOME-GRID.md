# Phase 11: Home Grid — a tablet Home page you arrange (plan, 2026-10-22)

The ask: a tablet Home page that **never scrolls**, laid out on a grid, where the size and place of each card
follow how often it is tapped (concept A, "Tap Weight", and C, "Glance Up, Touch Down", on the concept canvas:
https://claude.ai/artifact/JnMmSXDneGVE1e81BWYuid, A preferred). An Owner or Admin **arranges it on a desktop**,
using HK's own cards. A block can hold **several pages** that swipe: cameras, rooms, thermostats, scene pages.
Mantel first; HK Frontend as well, which comes at little extra cost (below).

**Status (2026-10-23): Mantel App 0.1.64 is installed on the house, including shared room-page glyphs for standalone blocks, optional fixed-size room scrolling, missing entity icon repairs, accessory collections and captions, compact person sheets, desktop paging, right-aligned chips, group visibility, announcement filtering and shared-blur/page-control fixes. Physical-tablet visual and touch acceptance remains with the owner. HK Frontend remains a separate release (1.10.7 on the house).** Older slice notes describe their state at the time.

## The answers (2026-10-22)

| # | Question | Answer |
|---|---|---|
| 1 | Size classes or free resizing? | **Size classes.** Free sizing over-complicates it and causes styling problems |
| 2 | Whose layout? | **The screen's.** A screen is a tablet: each wall tablet runs its own screen |
| 3 | Phones and portrait? | **No phone design.** But the grid must also come **2 or 3 blocks wide** (not only 6) for nightstand displays later, which are phone-like |
| 4 | Where is it arranged? | **On a desktop, by an Owner or Admin.** Not on the tablet |
| 5 | Whole-screen swiping? | **Not yet.** Each block can swipe between its own pages: cameras, rooms, thermostats, etc. |
| 6 | Name | **Home Grid** (the screen's Home Style: Generated / Home Grid) |

## Why it can work in both products

- **The layout is a screen setting.** A screen is a board document (`hk_core/settings/model.py` `board()`; in
  Mantel a versioned document in `hosts/server/mantel_server/settings_store.py`, scope `board`; in HK Frontend its
  dashboard subentry). Every write goes through `hk_core/settings/changes.py`, which checks it the same way in
  both hosts. One key, `home_grid`, checked once in `hk_core`, is stored by both.
- **One strategy builds Home in both.** `web/hk/cards/hk-strategy.js` reads the screen's board (`boardOf(seg)`)
  and emits the views. With `home_style: grid` it emits a Home Grid view in place of the generated Home. Lovelace
  draws it in HK Frontend, and `web/hk/shell/hk-view-host.js` in Mantel.
- **A Mantel screen drawn by Home Assistant** (`where: ha`) already gets Mantel's settings through the linked
  mirror (`linked_settings.py`; docs/phase9/TWO-PRODUCTS.md, "One copy of the settings when linked"), so its
  grid comes with it.
- **The editor is shared JS.** It writes through the settings path each host already has: Mantel's settings
  write (Owner and Admin, audited, versioned) and HK Frontend's `hk_frontend/board/set` (`panel.py`).

Mantel-only, because Home Assistant has nothing like it: the layout's history with Restore, and Copy Layout To….

## The model

### The grid

- **Columns: 6, 3 or 2.** 6 is the wall tablet (designed now). 3 and 2 are for nightstand displays later: the
  model, checks and view support them now, but no card is designed or polished for them in this phase.
- **Rows: 2 to 6**, 4 by default.
- **The frame: the tablet's size**, default **1280 × 800**. It is stored with the layout so the desktop editor
  draws the screen at the tablet's real size, not at the desktop's.
- At 1280 × 800 with 6 × 4: HK's own grid, six 196 px columns with 10 px gaps and `--hk-side` margins (27 px).
  Each logical row is a 150 px tall tile. The whole canvas scales uniformly to fit the display and dock.
- **Top band** (optional, on by default): the screen's existing header (clock, weather, chips, people), at 60 px.
  Off gives the grid the whole height (concept C puts its glance cards in the grid instead).
- The viewport fills the screen (`100dvh`); fixed-size cells are centered and uniformly scaled down when necessary. The frame is the editor’s preview viewport.
- **No scrolling, ever.** The view is `height: 100dvh; overflow: hidden`. A card that cannot fit its cell clips
  its own contents. It never grows the page.

### The tab bar (added 2026-10-22)

The screen's **tab bar** (`web/hk/modules/hk-tabbar.js`) is a Home Grid screen's primary menu and navigation, as
on every other screen: its pages, the rooms and the full menu. The grid works around it:

- **The grid stops at the bar.** The view's height is `calc(100dvh - var(--hk-tabbar-h, 0px))`, where
  `--hk-tabbar-h` is the room the bar reserves (set on `<html>` while it shows). The whole canvas fits what remains under
  the top band, preserving fixed logical cell dimensions. Cards read `--hk-cell-w` / `--hk-cell-h`
  (196 × 150). The view updates the uniform scale when the bar shows or hides. (G4 makes
  this change in `hk-layout.js`.)
- **Nothing sits under the bar**, and a pager never claims a drag that starts on it.
- **`everything` is for screens without a tab bar.** With the bar on, it already opens the pages and the menu, so
  `everything` is an optional S card for a screen whose bar is off. It opens the same menu, through the shell's
  navigation. The starter layouts leave it out while the bar is on. (G3.)
- **The render audit** (G2) runs with the bar showing, the usual case, and once with it hidden.
- **The editor** (G5) draws the bar in the frame, as the tablet shows it, so the grid is arranged in the space that
  is really there.

### Size classes

| Class | Cells | Logical size before uniform scaling |
|---|---|---|
| S | 1 × 1 | 196 × 150 |
| W | 2 × 1 | 402 × 150 |
| T | 1 × 2 | 196 × 310 |
| L | 2 × 2 | 402 × 310 |
| XL | 3 × 2 | 608 × 310 |
| XXL | 6 × 2 | 1226 × 310 (room and scene groups) |

Each card lists the classes it supports and is designed for each one, the way iOS widgets are. A card learns its
class from a `size` attribute plus `--hk-cell-w` / `--hk-cell-h`, and lays itself out with container queries. A
class wider than the grid (XL on a 2-column grid) isn't offered.

### `home_grid` (stored on the screen)

```json
{
  "v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": true,
  "items": [
    {"id": "a1", "card": "scene_suggested", "size": "L", "at": [0, 0]},
    {"id": "a2", "card": "room", "size": "L", "at": [2, 0],
     "pages": {"source": "rooms", "start": "tablet_room"}},
    {"id": "a3", "card": "now_playing", "size": "L", "at": [4, 0], "opts": {"speaker": "tablet_room"}},
    {"id": "a4", "card": "scenes", "size": "W", "at": [0, 2],
     "pages": {"source": "list", "list": [{"opts": {"scenes": ["scene.dinner", "scene.movie_night"]}},
                                         {"opts": {"scenes": ["scene.good_night", "scene.good_morning"]}}]}},
    {"id": "a5", "card": "camera", "size": "L", "at": [2, 2], "pages": {"source": "cameras"}},
    {"id": "a6", "card": "thermostat", "size": "T", "at": [4, 2], "pages": {"source": "thermostats"}},
    {"id": "a7", "card": "timers", "size": "S", "at": [5, 2]},
    {"id": "a8", "card": "action", "size": "S", "at": [5, 3], "opts": {"action": "lock_up"}}
  ]
}
```

- `card` is a key from the **Home Grid catalog**, not a raw Lovelace type. The catalog
  (`web/hk/cards/hk-grid-catalog.js`) turns a key, a size and its options into a real HK card config. `hk_core`
  knows each key's allowed sizes, options and page sources (a Python mirror, kept equal by a test, as `kinds.py`
  and the chips are now). So a saved layout can't name a card HK doesn't have, a size that card can't draw,
  a source it can't page, or two items in the same cell.
- `at` is `[column, row]` from the top left. Overlaps and items past the grid's edge are refused (`Invalid`).
  At most 24 items, at most 12 pages per block.
- `pages` makes the block swipe (below). Without it, the block is one card.
- Options name the house's things (scenes, entities, areas) or the tablet's own: `tablet_room` is the Wall
  Tablets room of the tablet showing it.

### Blocks that swipe

`hk-pager-card` (new, `web/hk/cards/hk-layout.js`) holds pages that swipe sideways with scroll-snap, with dots
under them. Only a block swipes, never the whole screen (whole-screen pages: not in this phase).

| Source | Pages | For |
|---|---|---|
| `list` | the pages you set up, each the same catalog card with its own options | Scenes 1, Scenes 2; any card |
| `rooms` | one room card per room, in the screen's room order; `start: tablet_room` opens on this tablet's room | `room` |
| `cameras` | one per camera, in Cameras' order; a doorbell ring jumps to the doorbell's page | `camera` |
| `thermostats` | one per climate entity, in room order; starts on the tablet's room | `thermostat` |
| `speakers` | one per speaker or group; starts on the one playing, else the tablet's room | `now_playing` |
| `scenes` | all scenes, split into as many pages as the size holds (W: 2, L: 4, XL: 6) | `scenes` |

- **It goes back to its start page** when the screen's Return to Home idle timer fires (hk-idle), so the kitchen
  tablet doesn't stay on the den.
- **Gestures:** the pager claims only horizontal drags that start outside a control (a slider, the thermostat's
  dial). The menu's edge swipe (`swipe`) keeps the left 20 px. Room cards in a pager use tap and press-and-hold
  for dimming, not horizontal sliders.
- Dots are tappable (44 px targets), and a pager says "2 of 5" to VoiceOver.

## The cards

### Existing cards that get size classes (G2)

| Catalog key | Card today | Sizes | Swipes through |
|---|---|---|---|
| `accessory` | pill tile (`hk-tile.js`) | S, W | — |
| `scene` | scene tile | S, W | — |
| `scenes` | the scenes row | W, L, XL | `list`, `scenes` |
| `now_playing` | `hk-now-playing-card` (`hk-media.js`) | W, T, L | `speakers` |
| `thermostat` | `hk-control-card` (climate) | T, L | `thermostats` |
| `camera` | camera mosaic / doorbell (`hk-cameras.js`) | W, L, XL | `cameras` |
| `security` | page status (`hk-room.js`) + the alarm sheet | S, W | — |
| `timers` | `hk-timer-strip-card` (`hk-home.js`) | S, W | — |
| `weather` | weather band (`hk-weather.js`) | W, XL | — |
| `calendar` | the screensaver's calendar pane (`hk-calendar.js`) | T, L | — |
| `battery` | the house battery (`hk-energy.js`) | S, W | — |
| `people` | person tiles (`hk-person.js`) | W | — |
| `vacuum` | `hk-vacuum-card` (`hk-home.js`) | S, W | — |
| `clock` | the header's clock, as a card (concept C) | W, XL | — |

### New cards (G3)

| Catalog key | What | Sizes | Swipes through |
|---|---|---|---|
| `room` | a room in one card: its name and status line, its lights as tiles (tap toggles, press-and-hold dims), its speaker | W, L, XL | `rooms` |
| `scene_suggested` | the scene for this time of day, from windows set in its options (Morning 5–10 → Good Morning…); the art follows the scene | W, L | — |
| `action` | one tap for one job: Lock Up, All Lights Off, Garage, or any scene or script; shows the state it changes (`hk-key` with a state) | S | — |
| `everything` | opens the full screen (the menu's pages and rooms) | S | — |

## Arranging (G5, G6): on a desktop, Owner or Admin

- **Where:** Mantel Settings → Screens → the screen → **Arrange Home Grid**. In HK Frontend: HK Settings → the
  screen → Home Style → **Arrange Home Grid** (Home Assistant admins). Both open the editor in the browser,
  drawing the screen at its frame (1280 × 800), scaled to fit the window, with the house's live data.
- **Not on the tablet.** A tablet shows the grid and never offers editing.
- **The editor:**
  - The grid shows its cells.
  - Drag a block with the mouse; it snaps to cells. Dropping on a block of the same size swaps them. A drop that
    doesn't fit outlines the cells in red and goes back.
  - Each block has a size menu (only the sizes that card has) and Remove.
  - **+ Add** opens the catalog as a side panel, each card previewed at its sizes; drag one in, or click to place
    it in the first space that fits.
  - Click a block to edit its options in the side panel: the existing visual editors' fields (the Lovelace
    editors in HA; the settings kit's forms in Mantel, `web/hk/panels/hk-settings-kit.js`). A block's **Pages**
    section picks its source, and for `list` adds, reorders and removes pages.
  - Grid settings: columns (6 / 3 / 2), rows, frame, top band.
  - **Save** writes the whole layout as one change. **Cancel** throws the edits away. Nothing reaches the tablet
    until Save.
- **Starter layouts:** switching a screen to Home Grid offers A (Tap Weight) or C (Glance Up, Touch Down), filled
  from the house: its scenes, the tablet's room, its cameras and thermostats. Nobody starts from an empty grid.
- The editor is `web/hk/panels/hk-grid-editor.js`. It is host-neutral and saves through each host's settings
  write.

### Mantel only (G6)

- **History and Restore:** the editor's **History** lists earlier versions (who, when) from `settings_history`,
  with a preview and Restore.
- **Copy Layout To…** another screen, with the `tablet_room` options left as they are.
- **Audit:** every save is an audit row like any other setting.

## Slices

| # | Slice | Scope | How it's checked |
|---|---|---|---|
| G1 | **Model + view, no editor** | `hk_core`: `home_style` and `home_grid`, the catalog's Python mirror, checks and refusals, the two starter layouts. `hk-strategy.js`: a Home Grid view when `home_style: grid`. The view type `hk-home-grid-view`: columns × rows, the frame, top band, `100dvh`, no scroll, the size attribute and cell variables; today's cards placed as they are (not yet sized). | `hk_core` tests (refusals, overlaps, catalog parity, 6/3/2 columns); Mantel's smoke and the scratch HA draw a Home Grid screen at 1280 × 800 with nothing scrolling, and a 3-column grid without errors |
| G2 | **Size classes on existing cards** | The 14 cards in the table, each laid out per size with container queries; Flat and Blur, light and dark, text scale | the render audit gains a Home Grid pass: every card × every size × the four looks, at 6 columns, nothing clipped (geometry checked, not only screenshots) |
| G3 | **New cards** | `room`, `scene_suggested`, `action`, `everything` (and their editors) | unit tests per card; render audit; the Mantel smoke taps one and it lands in the audit log |
| G4 | **Blocks that swipe** | `hk-pager-card`; the six sources; back to the start page on idle; gestures; dots; VoiceOver | unit tests (sources, idle return, the doorbell jump); a headless swipe in Mantel and HA; on the kitchen tablet |
| G5 | **The desktop editor** | `hk-grid-editor.js`: drag and snap, swap, sizes, + Add, block options and Pages, grid settings, Save / Cancel, the starter layouts | unit tests on the placement logic (snap, swap, refusal); a headless drag in both hosts |
| G6 | **Mantel's extras** | History and Restore, Copy Layout To…, the entry in Mantel Settings → Screens | Mantel tests (permission, audit row, restore); the smoke |
| G7 | **HK Frontend** | HK Settings → the screen → Home Style and Arrange Home Grid; publish; release notes | the scratch HA; `tests/test_ha_build.py` |
| G8 | **Docs** | Mantel's guide (`docs/guide/Home-Grid.md`), HK Frontend's wiki page, screenshots at 1280 × 800, CHANGELOG | the docs link check |

## Order and parallelism

G1 first: it fixes the data and the view. Then **G2, G3 and G4 can run side by side** in their own worktrees.
They touch different card files, and G4's pager needs only G1's view. G5 can start once G1 lands, using unsized
cards, and gets better as G2 lands. G6 and G7 follow G5. G8 last.

A tablet you can try comes early: **after G1 and part of G2** a Home Grid screen can be set up through its
settings (no editor yet) and hung on the kitchen tablet, to see whether concept A holds up in use before the
editor is built.

## Size

| Slice | Size |
|---|---|
| G1 | medium |
| G2 | **large**: most of the work; 14 cards × 2–3 sizes each, every one designed |
| G3 | medium |
| G4 | medium |
| G5 | medium–large |
| G6 | small–medium |
| G7 | small |
| G8 | small |

## Risks

- **Cards that look cramped at S.** The fix is to drop that size from the card, not to shrink the text below
  HK's type roles.
- **Gesture fights** between the pager, the menu's edge swipe and sliders. That's why the room card dims with
  press-and-hold.
- **Text scale** (PLAN-2026-10-12-text-scale) at its largest won't fit every size. Cards end with an ellipsis,
  and the render audit runs at the largest scale.
- **Two products, one layout:** a `where: ha` screen arranged in Mantel shows in HA after the mirror's push. That
  needs a test with both linked.
- **Cards that think they're on a stranger's dashboard.** HK cards check what view they sit in
  (`hk-base.js` `HK_PAGE`). A view missing from that map makes every card lay itself out for someone else's
  dashboard.

## Starting G1

**Scope: G1 only.** Stop when it is done and report; G2–G4 go to separate sessions after it lands.

**Where to work:** this repository (`/Volumes/data/mantel`), on a branch or worktree, never on `main` directly.
**Not** the live house's copy under `/Volumes/config/custom_components/hk_frontend`: that is the running house.

**Read first:** `docs/development/Rules.md` (above all rule 1, `hass` only in the host adapters, and rule 2,
`hk_core` owns feature decisions), `docs/development/Architecture.md`, `docs/phase2/VIEW-HOST.md`, and this page.

**What to change:**

| File | Change |
|---|---|
| `hk_core/settings/model.py` | `home_style` (`generated` / `grid`, default `generated`) and `home_grid` (default `None`) in `BOARD_DEFAULTS`; `board()` and `board_stored()` read and clean them; the catalog's Python mirror (keys → sizes, options, page sources); the two starter layouts, built from the house's scenes, rooms, cameras and climate |
| `hk_core/settings/changes.py` | checks for both keys: grid size, item limits, sizes per card, sizes that fit the columns, `at` inside the grid, no overlaps, page sources per card; refused with `Invalid` and a code the page can word |
| `web/hk/cards/hk-grid-catalog.js` (new) | the catalog: key + size + options → an HK card config (G1 maps each key to today's card, unsized) |
| `web/hk/cards/hk-layout.js` | the view type `hk-home-grid-view`, registered beside `hk-grid-view`: columns × rows filling `100dvh` under the optional band, `size` and `--hk-cell-w/-h` on each card, no scroll |
| `web/hk/cards/hk-base.js` | `HK_PAGE` (line ~2989) gains `hk-home-grid-view`; the size-class table (`hkCards.HOME_GRID`: `GRID` was taken) beside `TILE` and `CARD` |
| `web/hk/cards/hk-strategy.js` | in `HkDashboardStrategy.generate`, when the screen's `home_style` is `grid` and `home_grid` is set, Home is the Home Grid view (the screen's other pages unchanged) |
| tests | `tests/test_hk_core_*.py` for the model and checks, a catalog-parity test (JS keys and sizes = Python's), a JS test for the view's placement |

**How to check:**

```bash
.venv/bin/python -m pytest -q
```

Then the Mantel smoke (`tools/headless/client_smoke.py`) with a test screen set to Home Grid, and the scratch
Home Assistant (`tools/testha/`: `testha.py up --fresh`, `check.py`, `testha.py down`), per
`docs/development/Building-and-Testing.md`. Screenshots at 1280 × 800 show both concept A's starter layout and
a 3-column grid, with no page scroll.

**Ground rules:**

- No release, tag or deploy to the house without the owner's OK. Pushing to GitHub `main` follows the usual
  rule (check that the repo is private first; fetch and merge, never force).
- On this SMB checkout, merge with `git merge --no-autostash -s ort`.
- Keep the docs' and code comments' plain voice, as the rest of the repository has it.
- **Follow DESIGN.md** (`/Volumes/config/hk_house/docs/DESIGN.md`, read-only): type roles, spacing, corner radii,
  plates and materials (Flat and Blur), colors, glyphs, motion and 44 px touch targets, in every card, size, the
  pager, the view and the editor (the settings kit's iOS-Settings style). Build from HK's existing pieces, not
  look-alikes. Each slice checks its work against it and lists, in its Progress subsection, anything that can't
  follow it and why.

## Progress

### G1 (2026-10-22)

**Decisions** (agreed with the owner before G1):

1. **Starter layouts** are a pure `hk_core` function, `home_grid.starter(concept, scenes, rooms, cameras, climate,
   tablet_room)`. It is handed the house's scenes, rooms, cameras and climate entities, and the tablet's room, and
   returns concept A's or C's layout. Both hosts call it (the editor, G5). Not built in JS.
2. **The frame** (1280 × 800) is only for the desktop editor's drawing. A tablet always fills its real screen
   (`100dvh`). **Superseded by the 2026-10-23 fixed-tile review:** the grid now keeps tall-tile proportions, uniformly scales down to fit, and centers any spare space.
3. **`tablet_room`**: G1 only stores and checks it as an option value (`speaker`, `area`, a thermostat's `entity`,
   and `pages.start` for `rooms`, `thermostats` and `speakers`). Resolving it to a room is G3/G4.
4. **`HK_PAGE`** (hk-base.js) has `hk-home-grid-view`, with a test that a card on a Home Grid view knows it's on its
   own screen (`test_editors.js`, "where a card is").

**Done:**

- `hk_core/settings/home_grid.py` (new): `HOME_STYLES`, the grid's numbers, `SIZES`, `CATALOG` (the catalog's
  mirror: sizes, page sources besides `list`, options and their kinds), `check()` (the write's: refuses with
  `GridInvalid(code)`), `layout()` (the read's: a block that no longer checks is left out; a grid that doesn't is
  `None`), `starter()`. Kept out of `model.py`, which is 3,000 lines; `model.py` and `changes.py` import it.
- `model.py`: `home_style` (`generated` / `grid`) and `home_grid` (`None`) in `BOARD_DEFAULTS`; `board()` reads
  them (so `board_stored()` does too).
- `changes.py`: `BOARD["home_style"]` and `BOARD["home_grid"]` (the layout is written whole; `None` takes it away).
  Codes: `grid`, `grid_cols`, `grid_rows`, `grid_frame`, `grid_items`, `grid_item` (bad id, unknown key, a
  repeated id), `grid_card`, `grid_size`, `grid_fit` (wider or taller than the grid), `grid_place`,
  `grid_overlap`, `grid_pages`, `grid_source`, `grid_option`. Each is worded in `hk-settings-model.js` `ERRORS`.
- `web/hk/cards/hk-grid-catalog.js` (new): `window.hkGridCatalog` — `config(item, ctx)` maps a key, size and
  options to today's card, unsized (`room` → `hk-room-status-card`; `scene_suggested`, `action`, `everything`,
  `battery` and `people` are `hk-key-card` stand-ins until G2/G3). A block with `list` pages shows its first page
  (G4 makes them swipe). `ctx` is the house as the screen sees it (`cameras`, `climate`, `rooms`, `weather`,
  `vacuum`) for a block that names nothing. Plain data, loaded at parse time; it fires `hk-grid-catalog-ready`.
- `hk-base.js`: `HK_PAGE` gains `hk-home-grid-view`; the size-class table is **`hkCards.HOME_GRID`** (not
  `hkCards.GRID`: that name was already the Sections view's card sizes, `gridFor`), with `gap: 10, band: 60`.
- `hk-layout.js`: the view type `hk-home-grid-view`. Config: `grid: {cols, rows, band}` and `cards`, matched to
  the built elements by index — the band's card (`hk_band: true`), then one per block with
  `hk_cell: {id, size, at}`, then the cards that only listen (the `#alarm` pop-up, the docked bar), in a
  zero-size `.aside` slot. Each block is in its own `.cell` (grid-column/row from `at` and the size, `size`
  attribute on the cell and the card, `data-id`, `overflow: hidden`, `container-type: size`,
  `container-name: hk-cell`). The grid sets `--hk-cell-w` / `--hk-cell-h` in px — one cell — measured by a
  ResizeObserver (a calc of container units would resolve against the cell, which is a container itself).
  `:host` is `height: 100dvh; overflow: hidden`. Side, top and foot padding `100cqw × --hk-side + 8px`, the page's edge to its
  plates as `hk-grid-view` has it (27 px at 1,280), 10 px gaps, the band 60 px. It reconciles like `hk-grid-view` and says `hk-view-ready`.
- `hk-strategy.js`: `homeGridView()` and `gridReady()`; in `views()`, with `home_style: grid` and a layout (and
  no `home_view` of its own), Home is the Home Grid view: the band is the generated Home's header (header, chips
  row) without its `view_layout`. The screen's other pages are unchanged. `generate()` waits up to 3 s for the
  catalog; without it, Home is generated.
- `hk-sky.js` (`ANNOUNCING`) and Mantel's shell (`viewTags`) know the new view; `test_glass_hostview.js`'s
  `MANTEL_VIEW_TAGS` follows.
- Copy Settings From never copies `home_style` and `home_grid` (`COPY_NEVER`): Copy Layout To… (G6) does that.
- Tests: `tests/test_hk_core_home_grid.py` (the model, every refusal, 6/3/2 columns, both starters, the catalog's
  parity with the JS — through `jsc`); `hosts/ha/custom_components/hk_frontend/tests/test_homegrid.js` (the
  catalog, the view's placement, the strategy); `test_editors.js` (`HK_PAGE`).

- `hk-room.js`: the status row (`hk-room-status-card`, `hk-page-status-card`) pulls itself 8 px up with its own
  `:host` margin, `!important`, which wins over anything the view sets (an inner `:host !important` beats the outer
  page's, inline too). It now drops it on a Home Grid: `:host([size]){margin:0 !important}`. (The CSS snapshot
  fixture, `tests/fixtures/css_snapshot.json`, follows: three status cards gain that rule.) **A card that sets its
  own `:host` margin needs the same rule (G2).**

**Checked (2026-10-22):**

- `pytest -q tests`: 3,368 passed, 21 skipped. The HK Frontend build (publish.py into a scratch clone of hk-frontend, build
  only): its py tests (757) and every JS suite green.
- A local test Mantel (`tools/app_dev_server.py`), at 1280 × 800, a screen set to Home Grid through its settings
  write (`hk_frontend/board/set`):
  - **Concept A's starter** (`starter("A", …)` with the fictional house): no page scroll, the view doesn't scroll,
    every card inside its cell, all cells on screen. 27.2 px gutters, six 195.9 px columns, the band 60 px, four
    161.4 px rows: S 196 × 161, W 402 × 161, T 196 × 333, L 402 × 333 — the table above.
  - **A 3-column grid** (5 rows of blocks: XL, W, S, W, S): the same, no errors. 3 columns of 401.9 px.
  - The only 404s are SF Pro and the HK glyphs, which the repository never ships (Rules, 5).
- Not checked: the scratch Home Assistant (G7 is HK Frontend's own check; the view and strategy are shared JS).

**For G2–G4:**

- **Where a card is:** a block's card sits in `.cell` (in the view's shadow root), which has `size` and is a size
  container named `hk-cell`; the card has `size` too. Lay out per class with `@container hk-cell (…)` or
  `:host([size=L])`; `--hk-cell-w` / `--hk-cell-h` are one cell in px. The cell clips; nothing may grow it.
- **Today's cards in a cell are unsized:** most draw at their page size, top-left, clipped. The band's header
  (clock, weather, chips) is taller than 60 px and is clipped too. The band's own design is G2's (the header at
  60 px, or a band card of its own).
- **The catalog** is `web/hk/cards/hk-grid-catalog.js` `CARDS[key].card(size, opts, ctx)`; change a key's card
  there, and its sizes or sources in both it and `home_grid.CATALOG` (the parity test holds them together).
  Options a new card needs (G3: `scene_suggested`'s time windows, `action`'s state) go in `CATALOG[key]["opts"]`
  with an `OPTION_KINDS` checker, and in the catalog's `card()`.
- **`tablet_room`** reaches a card unresolved: `own()` in the catalog drops it today, and `ctx.rooms[0]` stands
  in. G3/G4 resolve it from the tablet showing the screen (`tablets`, TABLET_DEFAULTS `room`).
- **Pages (G4):** `config()` shows a block's first `list` page; G4 replaces the block's card with `hk-pager-card`
  holding one card per page. `ctx` already has the house's cameras, climate entities and rooms in the screen's
  order.
- **Live rebuild:** on the local test Mantel the open page did not rebuild after a screen setting changed (any
  setting, `pages` too, not only Home Grid's); a reload shows it. Worth knowing for the editor (G5).

**G1 is done.** Next: G2, G3 and G4, side by side, each in its own session and worktree.

### G2 (2026-10-22)

**The render audit's Home Grid pass:** `tools/headless/home_grid_audit.py` (`--only KEY…`, `--looks`, `--no-bar`,
`--long`, `--shots DIR`, `--json FILE`). A real Mantel Server with the gallery's fictional house
(`tools/headless/gallery.py`), headless Chrome at 1280 × 800, a 6-column grid. Each card gets a screen per look,
its Home holding the card once at every size it has (XL, L and T across the top, W and S below). The four looks:
Flat Light, Flat Dark, and Blur under a day sky and a night one. (On HK's own screens a card is white on the sky,
never light: `tone()` in hk-base.js; so Blur's light and dark are the sky's.) It runs with the tab bar showing
(the screen's `menu: tabbar`, the usual case) and once more without it (Flat Dark). In each block's cell it
measures:

- every text node's box: inside the cell, not cut off unless an ellipsis ends it, no word broken across lines;
- every icon, picture, button and control: inside the cell;
- that the card's plates cover the block, and that the card says its size;
- DESIGN.md, what can be measured: no text under the smallest type role (11 px), every control at least 44 px
  (a segmented control's choice by its 44 px track), every painted box's corner on the scale (23.5, 22, 20, 12,
  8, a capsule, square) and the block's own plate at 23.5;
- the screen's own: no page scroll, nothing under the tab bar, no script error (printed as `VIEW` lines).

The house it draws has what the blocks show: two forecast sensors, a family calendar with events today and
tomorrow, running timers, a vacuum, two people, and the Energy feature's house battery (stood in on the page:
the test server's settings feed has no Energy feature). `--long` names every thing at twice its length.

**Measured cells** at 1280 × 800, 6 × 4, the band on: with the tab bar showing, S 196 × 137, W 402 × 137,
T 196 × 285, L 402 × 285, XL 608 × 285; without it, S 196 × 161, W 402 × 161, T 196 × 333, L 402 × 333,
XL 608 × 333. Every card reads its block from `--hk-cell-w` / `-h` (`_block()`) or the cell's container units,
never a fixed number, and is designed for the shorter cell.

**Text scale:** HK draws its type roles in px (`hkCards.TYPE`) and a tablet's text size never reaches them (the
Mantel app's web view sets `-webkit-text-size-adjust:100%`), so there is one scale and the audit runs at it.
PLAN-2026-10-12-text-scale is the ink colours, not sizes. The `--long` pass stands in for larger text.

**Shared:** hk-base.js: an HkBase card watches its `size` attribute and is rebuilt when it changes (`_cellSize()`
reads it), `_block()` gives the block in px from `--hk-cell-w` / `-h`, and `_watchBlock()` draws a card again when
that changes (the view measures after the cards are in, and again when the tab bar comes or goes); `BASE_CSS`
makes a sized card and its root the block's height; `hkCards.typeCss(role)` writes a type role as declarations.
The strategy hands the catalog the Energy feature's house battery (`ctx.battery`).

**Done**: all 14 cards, every size the table gives them; no size dropped. Audited 2026-10-22: 14 cards × every
size × the four looks with the tab bar, Flat Dark without it, and the `--long` pass: nothing clipped, nothing off
DESIGN.md's measurable rules. Every plate is `hkCards.plate('card')` at 23.5 with a page card's padding
(`CARD.pad`, 20 / 22); a tile-sized block (the tiles, the vacuum at S) the tall tile's.

| Card | Sizes | Layout |
|---|---|---|
| `accessory` | S, W | the tall tile's layout (glyph at the top, name and state at the foot), filling the block |
| `scene` | S, W | the same, the scene's bare glyph and two-line name |
| `scenes` | W, L, XL | a scene tile per cell: W two, L four, XL six; no heading |
| `now_playing` | W, T, L | W the cover beside the song and transport; T the cover on top; L the cover beside the song and its speaker, a larger transport along the foot. No progress or volume (the sheet has them); 48 / 64 px buttons |
| `thermostat` | T, L | the dial (`hk-control-card`, in place of the climate tile), as large as the block leaves it, the setpoint at the figure role on one line; L has the mode row, T doesn't (below) |
| `camera` | W, L, XL | the camera mosaic sized from the block: W and XL one camera filling it, L two stacked |
| `security` | S, W | a plate with the Security page's items one per 44 px line (two columns at W), as many as the block's height holds, alerts first |
| `timers` | S, W | a plate of the running timers (glyph, name, time left), soonest first, as many as fit (two columns at W); none running, it says so; Flat's lit circle has a white glyph |
| `weather` | W, XL | a plate: the symbol, the temperature, the condition with today's high and low and the place, the outlook; at XL the band's 76 px temperature and the next hours, as many as the width holds |
| `calendar` | T, L | a plate: today's date, then what is still to come today and tomorrow, one line each, as many as fit; at T the time goes under the title |
| `battery` | S, W | `hk-house-battery-card` (in place of the stand-in), from the Energy feature's house battery: S its level (hero) and a small battery; W the battery itself, the level, stored kWh and backup inside. Without a house battery: the stand-in |
| `people` | W | `hk-people-card` (new, hk-home.js; there were no person tiles): each person their picture or initials, ringed green at home, name and where; a tap opens their sheet; as many as the width holds |
| `vacuum` | S, W | the vacuum card filling the block: its glyph beside the status and chips, 44 px capsule commands along the foot; S Start and Dock only |
| `clock` | W, XL | a plate, the time and date: the header's 72 px time at W, the screensaver's 150 px at XL |

**What doesn't follow DESIGN.md, and why:**

- **The thermostat at T has no mode row.** Four choices in a 196 px block are 34 px wide, under the 44 px a
  touch needs. The dial still sets the temperature; the modes are at L and on the sheet.
- **The clock's 72 / 150 px time and the weather's 76 px temperature** aren't type roles. DESIGN.md names the
  clock (72) and the weather band's temperature (76) as exceptions; 150 is the screensaver clock's own size.
- **The vacuum's status chips** keep their 12 px text and 11 px corners (the card's own, unchanged from its page);
  the audit only measures corners on boxes 24 px and larger, and the chips are 22 px tall.
- **The thermostat's name and reading line** keep the dial's own sizes (19 / 13.5 px, not roles), as on the
  Climate page.
- **Blur has no light theme** on HK's own screens (`tone()`); Blur is checked under a day and a night sky instead.

**Not G2's, seen on the way:** the band's clock (the screen's header, 60 px tall) is clipped at its top, as G1
noted; its design at 60 px is still open (a band card of its own, or the header at that height).

### G4 (2026-10-22)

**Done:**

- `hk-pager-card` (`web/hk/cards/hk-layout.js`): a block's pages side by side, each one cell wide, in a track that
  the browser scrolls with scroll-snap (`x mandatory`, `scroll-snap-stop: always`, `overscroll-behavior-x:
  contain`). The dots sit in a 20 px row under the pages; each is a button with a 44 px target that reaches up over
  the page's foot (narrower only when the dots wouldn't fit across). Each page and dot is labelled "2 of 5", and a
  polite live region says it when the page changes. One page: no dots. A page's card is made when it is on screen
  or next to it, and kept. Each page is the cell its card lays itself out in: `size` on the page and the card, and
  the page is a size container named `hk-cell`, so G2's container queries see the page (the cell less the dots).
- **The catalog** (`hk-grid-catalog.js`): `config()` turns a block with `pages` (a source its card has, or a `list`)
  into `{type: 'custom:hk-pager-card', item, ctx}`. `pages(item, ctx)` gives the pages, each `{card, area, entity}`,
  at most 12. The block's own options go to every page, under the page's.

  | Source | Pages |
  |---|---|
  | `list` | each page set up, the block's card with its own options |
  | `rooms` | `ctx.rooms`, the screen's room order |
  | `cameras` | `ctx.cameras`, Cameras' order |
  | `thermostats` | `ctx.climate`, sorted by its room's place in `ctx.rooms` (no room last) |
  | `speakers` | the Music feature's speakers (`hkMusic.speakers()`), each room's first, then the groups; asked again when they change |
  | `scenes` | `ctx.scenes`, W 2, L 4, XL 6 to a page |

  Nothing to show: one page, the block's card as it is. A scenes page carries `room: true` (the scenes row's "Just
  These Scenes"), or the screen's own Scenes choice would replace its scenes.
- **The strategy** (`hk-strategy.js`) adds to the Home Grid's `ctx`: `areas` (each camera's and thermostat's
  room) and `scenes` (the screen's Scenes choice, else every scene A to Z).
- **The start page:** the first; with `start: tablet_room`, `rooms` and `thermostats` open on the tablet's room;
  `speakers` on the one playing, else this user's own speaker (`hkMusic.home()`), else the tablet's room. Until
  somebody touches the block, the start follows a new client (what is playing may arrive after the first draw).
- **`tablet_room`** is `hkGridCatalog.tabletRoom(client)`, never `hass`. G3 has since routed it through the host
  (`hkShell.tabletRoom`: Home Assistant's Wall Tablets entry, Mantel's tablet device), with `hkSettings.tablet()`
  as the fallback. The pager's start page uses the same call.
- **The idle return** (`hk-idle.js`): a pager off its start page calls `hkIdle.away(key, true)`; the Return to Home
  timer then arms on Home too (the tablet's, with its return on), and when it fires it sends the window event
  `hk-idle-return`. On Home that is all it does. From another page it navigates Home and sends it too. Every pager
  goes back to its start page at once.
- **The doorbell:** the house's notification (`hk-house-event`, `kind: doorbell`) turns a `cameras` block to the
  camera it names, else to a camera called doorbell.
- **Gestures:** the browser scrolls the track, so there's no drag code of our own. A touch that starts on a control
  holds the track still until it lifts (`overflow-x: hidden`). A control is a range input, `role=slider`,
  `data-hk-control`, or anything with `touch-action` `pan-y` or `none` (the thermostat's dial and slider already
  have `pan-y`). A touch in the left 20 px is held too: that strip is the menu's edge swipe.
- **Found in the headless swipe:** a row inside a page that fits its width but keeps its own swipe
  (`overscroll-behavior-x: contain`: the scenes row, a chips row) stopped the pager's swipe from starting on it,
  because the browser never passes the drag on. For the length of a touch, such a row is set to `auto`. A row that
  really scrolls keeps its swipe, as a control does.
- `hk-pager-card` isn't in the card picker (`test_editors.js` `NOT_IN_PICKER`): the catalog builds it.

**Decisions:**

1. Native scroll-snap, not a drag of our own: a page that scrolls vertically keeps doing so, and controls keep
   theirs through `touch-action`.
2. Pages are built from the stored block when the pager draws, not by the strategy, because a speakers block's
   speakers arrive after the strategy has run.
3. `start: tablet_room` counts only for `rooms` and `thermostats`, as hk_core checks it. `speakers` always starts
   on the one playing and falls back to the tablet's room.
4. The idle return is an event, `hk-idle-return`, and not a navigation, since on Home there is nowhere to go.
   hk-idle arms on Home only while something is away, so Home gets no periodic wakeups.

**Checked (2026-10-22):**

- `tests/test_pager.js` (new, 57): each source, PAGES_MAX, the empty case, `tabletRoom`, the start page for each
  source, the doorbell's page, the gesture rules (tile, range, dial, slider, `data-hk-control`, the 20 px edge, a row
  that lets go), and the element: pages and dots, "2 of 3", the start on the tablet's room, lazy pages, a dot's tap,
  a swipe coming to rest, the idle return, the doorbell jump, a new `size` (G2's rebuild) keeping its page, a speakers
  block starting on the one playing.
  `test_idle.js`: away on Home arms the timer and fires `hk-idle-return` without navigating; not for a desk; the
  return from a page says it too. `test_homegrid.js`: G1's checks follow (a block with pages is now a pager).
- `pytest -q tests`: 3,368 passed, 21 skipped. The HK Frontend build (publish.py into a scratch clone, build only):
  757 py tests and every JS suite green. The CSS snapshot gains only `hk-pager-card.CSS`.
- A local test Mantel (`tools/app_dev_server.py`) at 1280 × 800, with a Home Grid written through
  `hk_frontend/board/set`: a `rooms` pager (L, 3 rooms) and a `list` scenes pager (W, 2 pages). Touch swipes
  (CDP `synthesizeScrollGesture`) turned the rooms block to page 2, then 3, with `scrollLeft` 402 and 804. A tap on
  dot 1 went back to page 1. The scenes block swiped to page 2. `hk-idle-return` took both back to page 1. Every
  page is 402 px wide, the track is inside its cell (L: 313 px of 333, W: 141 of 161, the rest is the dots), and
  the dots are 44 × 44. No page or view scroll, no console errors.
- The same swipe again after merging G2's first cards (its `size` rebuild in hk-base.js): unchanged.
- Not checked: the scratch Home Assistant (G7); a real doorbell ring and a real idle timer on a tablet (unit tests
  only); the kitchen tablet (the owner, after a release).

**For the others:**

- **G2:** a card in a pager is in `.page` (the pager's shadow root), which has `size` and is the `hk-cell` container,
  20 px shorter than the cell. A card that is a sideways scroller (the scenes row) should fit its page at a Home
  Grid size. If it really scrolls, it keeps the swipe and the pager can't be swiped from it.
- **G3:** `hkGridCatalog.tabletRoom(client)` resolves `tablet_room`. The room card in a `rooms` pager should dim with
  press-and-hold, not a sideways slider. If it has a slider, mark it `data-hk-control` or give it `touch-action:
  pan-y`, and the pager leaves it alone.
- **G5:** a block's Pages section writes `pages` as hk_core checks it; `hkGridCatalog.pages(item, ctx)` previews them.

**The tab bar, and DESIGN.md (2026-10-22, asked after the first push).** The tab bar is the screen's
navigation, so the grid leaves room for it. I read DESIGN.md (hk_house/docs) and checked the pager and G1's
view against it.

- **The grid's height** is `calc(100dvh - var(--hk-bar-room, var(--hk-tabbar-h, 0px)))`. hk-tabbar.js pads the
  view on the bar's side and sets `--hk-bar-room` on it, for a bar at the top or the bottom. `--hk-tabbar-h` on
  `<html>` is the fallback. The rows share what's left under the band, and the cells and `--hk-cell-h` follow the
  bar live (the view's ResizeObserver). DESIGN.md's page edges hold: the last row's plates end a gutter above the
  bar. A top bar that shifts the page (Shrink or Hide) pads nothing and so takes nothing. A side rail scales the page
  aside and leaves the grid's height as it is.
- **The pager and the bar:** a drag that starts on the bar never reaches a pager. The grid ends at the bar's top, and
  the bar is its own layer over the page, so the bar keeps its taps and sheets. No rule in the pager is needed for it.
- **Plates keep their shadows** (DESIGN.md: every plate wears the look's shadow). A plate fills its cell, and G1's
  cell clipped at its edge, which cut the shadow off. A cell now clips a gap out (`clip-path: inset(-gap)`, paint
  only: the grid still sizes it). The pager's track reaches a gap past its block on each side, with its pages two
  gaps apart, so a page's shadow shows and its neighbour doesn't.
- **The dots** are DESIGN.md's surface scale, written with `v()`: `mark` (as notches and ticks are), and `ink` for the
  page you're on (Flat's maps carry both). They fade between the two over `DUR.fade`, with no fade under Reduce
  Motion. Each is 7 px (iOS's page control) with a 44 px target. In Flat, the dots get the focus ring from
  `flatCss`.
- **Motion:** under Reduce Motion, and in Flat (motion off, `hkSettings.rendering()`), a dot's tap turns the page
  without the slide. The swipe is the finger's own, with scroll-snap. The pager has no motion of its own and nothing
  to build in.
- **Gutters, gaps, band:** G1's view already matches. The sides, top and foot are the page gutter (`--hk-side` + 8,
  27.2 px at 1,280 and 22.7 with the menu docked: measured), the gaps are the house's 10 px, and the band is 60 px.
- **Checked:** `test_pager.js` (now 66) covers the grid's height less the bar's room, the cell's clip, the dots'
  tokens, fade and 44 px targets, the track's shadow room, and no slide under Reduce Motion or in Flat.
  `test_homegrid.js`'s G1 checks follow. On the local test Mantel at 1280 × 800 with the screen's tab bar on (96 px
  of room), the view ends at 704, the bar's top. The lowest plates end 27.2 px above it, the same as the left
  gutter. Probed across the bar's height, no point of the grid is under it, and there is no page scroll. Turning
  the bar off live, without a reload, gave the grid 800 px back and the cells re-measured (137.3 → 163.6 px tall, with the
  menu docked). Each pager's page is its cell's width at both.

**What doesn't follow DESIGN.md yet, and why:**

- **The dot's 7 px** has no name in `T` or a scale. It's geometry, as the tiles' numbers are, and there's no page
  control scale to put it in. It needs one if a second card draws dots.
- **A glass plate's shadow** (`0 8px 22px`) reaches about 30 px. A cell lets 10 px show (the gap), so the softest
  part of its tail is still cut. Any more would let a card that overflows draw over its neighbour's cell.
- **The band's header** (clock, weather, chips) is taller than 60 px and clipped (G1's note). It's G2's to design.
- **Not checked here:** WebKit (DESIGN.md asks for Flat in Safari as well as Chrome). The headless checks are
  Chrome's. Flat and Blur were checked through the tokens and `flatCss`, not with a screenshot of each look.

**G4 is done.** Pushed to `main`; no version bump, no release, nothing on the house.

### G3 (2026-10-22)

**Done: the four new cards**, in `web/hk/cards/hk-grid-cards.js`, each with its editor fields, in the catalog and
its Python mirror.

| Key | Card | Sizes | What it is |
|---|---|---|---|
| `room` | `hk-grid-room-card` | W, L, XL | the room's name (a room heading, › to its page), its status (L, XL: the room page's own `hk-room-status-card`; W: the same items as one line), its lights as the room page's own light pills (`hkStrategy.roomCards`: its hidden accessories left out, its order, its looks) and its speaker's pill, last. As many whole rows of pills as the cell holds (measured, so the tab bar's shorter cells get fewer); W: one row, no speaker |
| `scene_suggested` | `hk-suggested-scene-card` | W, L | the scene for this time of day: the block's windows, else its own (Morning 05:00–10:00, Day, Evening, Night, each finding its scene by name). Out of every window: the next one ("Next · Night, From 10:00 PM"). A tap runs it as a scene pill does (`hkCards.sceneTap`) |
| `action` | `hk-action-card` | S | a key with a state: Lock Up (locks every unlocked lock; "1 Unlocked" / "All Locked"), All Lights Off ("2 Lights On"; with `area`, one room's: Lights Off), Garage (its state; a tap opens its sheet), or any scene or script |
| `everything` | `hk-everything-card` | S | the screen's pages and rooms, as its own navigation opens them: the tab bar's More sheet (`hkTabBar.open('more')`) while the bar shows, else the side menu (`hkCards.menu.open`), never a menu of its own; the menu button's own glyph. Optional, for a screen whose tab bar is off |

**Decisions:**

1. **Built from HK's pieces.** The room card holds the room page's own cards (status row, light pills, the
   speaker's media pill) made with `hkCards.createCard`; no look-alike tiles. The S cards draw the tall tile's
   measured pieces (42 px well, 15 / 600 on 16.5 px lines, the pill's padding) on `hkCards.plate('tile')`; the
   suggested scene is a page card (`plate('card')`, `CARD.pad`, label / title / caption roles).
2. **Press and hold dims, without a sideways slider.** A tap anywhere on a light pill toggles it. Held still for
   450 ms it becomes the dimmer: a drag up or down (160 px is the whole range) shows the readout over the pill
   (`overlay-solid`, the percent at `title`), and letting go sends one `light.turn_on` (`brightness_pct`) or
   `light.turn_off` at 0. Held without moving: the light's sheet. A light that doesn't dim opens its sheet at
   once. The click after a hold is eaten. A sideways drag of more than 10 px before the hold cancels it, and the
   pill is `touch-action: pan-x`, so a `rooms` pager (G4) keeps its swipe from a room's pills (they are no
   control to it). A finger that drifts far sideways while dimming starts the pager's scroll: the browser cancels
   the touch and the dim is dropped, nothing sent.
   The pager's start page (`hkGridCatalog.tabletRoom`, G4's) now asks the host too, `hkSettings.tablet()` only
   without it, so a Mantel tablet device's own room counts there as well.
3. **`tablet_room` is the host's answer**, a new contract call `hkShell.tabletRoom(client)`
   (`web/client/hk-host-shell.js`): Home Assistant's shell gives the Wall Tablets entry's room
   (`hkSettings.tablet()`); Mantel's gives the tablet device's own room (`GET /api/me` now says `room`, the
   device's room as an area id; null on a person's browser), else the HK tablet's. The cards ask it when they draw
   (the tablet may be known only once the page is up); no card reads `hass`. A block with no room of its own is
   `tablet_room`, falling back to the screen's first room on a page that is no wall tablet.
4. **Commands go through the card's action port** (`HkBase._call` / `_act`): the frontend's own call in Home
   Assistant, the command gateway in Mantel (classified, checked, audited). Lists of entities, never an area
   target (the gateway refuses those): one call per domain. A garage door is never one tap (HK's rule): Garage
   opens its sheet. A refused command says "Couldn't Send" in the state's place for 3 s.
5. **Options** (hk_core `home_grid.CATALOG`, mirrored by the catalog's `opts`): `scene_suggested.windows` (a new
   kind: 1–8 of `{start, end, scene, label?}`, `HH:MM`, may run past midnight, a scene or a script); `action.area`
   (an area or `tablet_room`; only All Lights Off reads it). A test holds every `opts` the JS declares equal to
   the mirror's (`tests/test_hk_core_home_grid_cards.py`).
6. **The tab bar is the screen's navigation** (the plan's "The tab bar"). `everything` is an optional S card for a
   screen whose bar is off, and opens what the screen's own navigation opens (above). The starters leave it out
   while the bar is on: `starter(..., tab_bar=True)` (the default) puts an All Lights Off action in its cell;
   `tab_bar=False` keeps Everything (the editor, G5, passes the screen's own). The cards read their cell from
   `--hk-cell-w` / `--hk-cell-h` and their own measured height, so the bar's shorter cells just hold fewer pills.
7. **Lock Up and Garage read the house's lists** (Status & Chips' `kinds`, as the header's security line does);
   with none chosen, every lock or garage door the house has.

**Checked (2026-10-22):**

- `test_gridcards.js` (69: catalog and the rooms pager's pages, the host's room, the room's parts and fit, the hold — a drag sends one call,
  the click eaten, a sideways drag cancels, held still opens the sheet —, the windows, every action's plan and tap,
  a refused command, Everything); the design guards (type, radii, blur, motion, overlays, surfaces, breakpoints,
  text scale, the CSS snapshot: its four new entries) and `test_editors.js` now read the new file.
- `pytest -q tests` (merged with G2 and G4): 3,397 passed (the `/api/me` dicts updated for `room`); the HK Frontend build (publish.py into
  a scratch clone, build only): 757 py tests, every JS suite green.
- The local test Mantel at 1280 × 800, a screen with eleven G3 blocks (room L, W, XL; suggested scene L, W; six
  S): every card fills its cell, nothing scrolls without the bar; a tap on All Lights Off wrote the audit row
  (`light.turn_off` on `light.kitchen`, allowed, ok) and the card then said All Off.

**Can't follow DESIGN.md / left as it is:**

- The suggested scene's art is four skies (hex gradients): content, not design values (DESIGN.md rule 4).
- The status row in a room card keeps its own 12 px shadow room (`.row{margin:0 -12px}`); the cell clips it.
- The room's name is the section heading's measured 19.7 / 700 (a Home-app size, not a role), as on a room page.
  Its line is 28 px tall; its target is 44 px (an `::after` 8 px above and below), which the cell clips at the
  top edge of a block in the first row.
- The S keys' name and state are the tile text's measured 15 px (600 / 500), as the tall tile has them.
- The editors are the cards' Lovelace schemas (`hkCards.register`), as every HK card's; the iOS-Settings forms of
  the settings kit come with the desktop editor (G5).
- Checked against DESIGN.md: type roles (`body`, `caption`, `title`, `label`), `v()` tokens only, `plate('tile')`
  and `plate('card')` (Flat and Blur through the plates), `R.small` / the glass radius, `overlay-solid` for the
  dimmer's readout, `DUR` for presses, reduced motion; the guards (type, radii, blur, motion, overlays, surfaces,
  breakpoints, text scale, CSS snapshot) read the file.

**Left for others:**

- **The grid doesn't stop at the tab bar yet:** "The tab bar" above gives G4 the view's
  `calc(100dvh - var(--hk-tabbar-h, 0px))`, and it isn't on `main` (G4's push has the pager only). With the bar
  showing, the page is 896 px tall at 800 and the bar covers the bottom row. The room card measures its own
  height, so it follows once the view does.
- G5: the editor's block options for `windows` (a list editor) and `action` (the jobs, a scene or script, a room).
- The default windows find scenes by words in their names; a house whose scenes are named otherwise sets windows.

**G3 is done.**


### G5–G8 continuation (2026-10-22, Codex)

**G5–G8 implementation:**

- `web/hk/panels/hk-grid-editor.js`: desktop draft editor using the existing settings kit. Pointer drag with cell snap, same-size swap, refusal outline, arrow-key moves, supported size choices and Remove. The catalog offers real card previews at every supported size, click-to-first-fit and drag-to-place. Block fields cover the Python catalog's options, including suggested-scene windows, action jobs/scene/script and room, scene/calendar lists, automatic page sources and custom pages with add/move-up/remove. Grid settings cover columns, rows, frame and band.
- The actual screen runs in a same-origin, inert iframe. A strategy preview argument draws the draft with the existing cards, live client data, appearance and tab bar. It changes no settings feed. The editing overlay measures actual cells, including the bar's reserved space. Both shadow-root and light-DOM host views are supported. Pointer and keyboard interaction with the preview's household controls is blocked.
- Save sends `home_style` and the entire `home_grid` in one existing `board/set` action. Failed saves keep the draft. Cancel confirms discarding edits and writes nothing. Drafts survive a settings-panel redraw; the editor has no tablet editing controls.
- Both hosts have `hk_frontend/grid/starter`, an admin/configure-only read. It delegates to the bounded `hk_core.settings.home_grid.starter_request()` and the existing Python starter. No starter layout is duplicated in JS. The JS catalog now exposes the existing Python option kinds for the old cards too; calendar blocks now consume their stored calendar selection.
- Mantel's settings host supplies the history read through `gridHistory`, keeping its transport out of shared code. History includes the actor's display name, version and date. Selecting a version restores **only the layout into the draft**; Save applies it through the existing checked/audited write. Copy Layout confirms and saves only layout/style to the selected screen, preserving other settings and relative `tablet_room` options.
- The shared Screens page offers Home Style and Arrange Home Grid for generated screens. Both hosts load the editor after the catalog. The HA settings-panel cache stamp includes the new module.
- Guides: `docs/guide/Home-Grid.md`, HK Frontend's `docs/Home-Grid.md`, wiki sidebar, guide index and CHANGELOG. `docs/images/home-grid.png` is 1280 × 800; `home-grid-editor.png` shows the desktop editor. Fictional data, Arial, no shipped Apple font/glyph files; the demo camera has no live image.

**Validation:**

- Mantel main suite: **3,411 passed, 21 skipped**. The first full run found the host-history transport in shared code; it was moved behind the host hook. An unrelated gateway test also hit its existing random-ID substring assertion; it passed on rerun and the final suite is green.
- `tests/test_grid_editor.py`: pure placement checks in JavaScriptCore (snap, equal-size swap, overlap/edge/resize refusal, first fit, item limit and immutable drafts), both starter concepts and malformed-input refusals. Settings-store tests cover role denial, history, layout-only restore, copy preserving target settings and relative tablet-room options.
- The built HA package's JavaScript suites are green. Its full Python suite passes: **758 passed**, including the new admin-only checked starter read.
- `tools/headless/grid_editor_smoke.py`: real mouse drag swaps blocks; every overlay rectangle matches its real cell within 2 px with the tab bar showing; real catalog cards draw; refusal retains the draft; Save applies once; history restores a draft without a write; Copy preserves the target's other options; Cancel writes nothing; the saved 1280 × 800 Home Grid does not scroll. No browser exceptions.
- `tools/testha/grid_editor_check.py`: real scratch Home Assistant (fictional demo integration, isolated config) opens the editor, renders the draft with real cards, swaps two blocks with a real mouse drag and saves successfully. The host-specific history control is absent. The scratch wrapper has light DOM, which the preview now handles.
- Link check: no broken links. No production files under `/Volumes/config` were edited. The pre-existing Xcode project modification was left untouched.

**Remaining / exact continuation:**

1. The owner requested delivery to `main`. Version bumps, publication and releases remain separate from this code delivery.
2. Publish HK Frontend with its release notes, and release Mantel using the normal release procedure. G7's publication portion is still pending.
3. On the kitchen tablet, validate the grid, block swipes, real idle return, doorbell jump, tab bar and touch controls. Desktop/headless checks do not establish physical-device behavior.
4. The visual refinement entry below supersedes the top-band clipping and WebKit/Flat items. Narrow 2/3-column card polish remains outside this phase's design scope.


### Visual refinement (2026-10-22)

The owner's review reopened G2 visual acceptance before publication. Work stays on `main`.

- The 60 px top band uses a compact mode of the shared header: clock/date, weather and existing chips fit together. Normal page headers retain their own layout. Keyboard and touch navigation remain available.
- Clock blocks fit their time to the available width and height, with a quieter date underneath. Both use the existing shared clock renderer.
- Grid thermostats use consistent title insets, readable temperature/humidity and a dial whose value stays inside the track. T puts the readings on separate lines and offers one full-width Mode button opening the shared thermostat sheet. L retains its mode segments. Size changes rebuild the markup unless a dial drag is active.
- Swipe pages now fill the entire block, with dots over its foot. This supersedes G4's separate 20 px dots row: paged and ordinary plates align. Thermostat and music controls reserve space above the dots' 44 px targets; the compact music layout adjusts to fit.
- Room groups retain shared status and accessory pills. Their heading is inset and status touch targets meet 44 px.
- The render audit now checks the band's actual text and the thermostat's dial centre. Room groups are checked as groups of shared pills rather than requiring a single outer plate.

**Validation:** the main suite passes (3,411 passed, 21 skipped); the HA package passes its Python suite (758 passed) and all frontend JavaScript suites, including refreshed intentional CSS snapshots. Grid/build regression checks after the final room change pass (83 tests). The fourteen existing cards pass every size across four looks plus Flat dark without the tab bar, with no clipping. Packaging and links pass.

**Browser validation:** `tools/headless/home_grid_visual_check.py` runs both starter layouts at 1280 × 800 in Chrome and WebKit, in Flat light, Flat dark and Blur. It checks full-height pages, dial text, dots clear of controls, no page scroll, pager navigation/idle return, and opening the T thermostat's sheet without a command. Fictional home only; external requests blocked. The reusable harness accepts an installed Playwright module via `PLAYWRIGHT_PATH`, a Node path and an optional browser executable. Documentation screenshots use Arial and fictional devices; camera pictures are illustrative landscapes.

**Remaining:** release publication and physical kitchen-tablet acceptance, including real swipes, touch controls, idle return and doorbell jump. Browser checks do not establish device behavior.


### Top-band baseline alignment (2026-10-22)

The compact clock and weather now share a lower text baseline instead of independently centring stacks of different heights. This lowers the weather alongside the time. The composed-layout check measures the date/weather-caption alignment within 1 px; both starter layouts pass in Chrome and WebKit across Flat light, Flat dark and Blur. The header CSS snapshot and documentation preview are refreshed; all frontend JavaScript suites pass.


### Owner review fixes (2026-10-22)

The owner's review of the Tap Weight screen, fixed on `main` (no release):

- **Pager dots** are iOS's page control: 7 px dots, one every 16 px, in one centred group (they had a 44 px slot each, so nine rooms' dots spread across the block). The group is the 44 px target: a dot goes to its page, a tap beside the current dot steps a page that way. Swipes are unchanged.
- **Room block:** its status row no longer repeats the lights or the speaker, which are its own pills (the "Light · Off" row over the Chandelier).
- **Thermostat T:** the dial is the block. It's as wide as the block, with the setpoint the largest type. The name is the way to the sheet ("Main Floor ›"), with one reading under it ("Currently 71°"). The face says the mode and what it is doing ("Auto · Idle"). The Mode button is gone.
- **Timers:** with none or one running, the block is a tile like the grid's other small blocks: its glyph's well at the top, "Timers / None Running" (or the timer and its time left) at the foot. A tap opens the Timers page. Two or more running keep the list.
- **Now Playing:** T and L show the progress above the transport, and L the volume below it (a 44 px slider row). The cover's blur shows through a lighter wash, clipped to the plate. The plate has the look's shadow, not the page player's 0 22px 60px one.
- **Shadows:** a cell now clips 40 px out (a shadow's reach), and a pager's track 28 px, so the plates' shadows fade instead of ending in a grey box round the block. A pager's track takes no touches of its own, so its wider reach never takes a tap meant for the block beside it.

**Checked:** the render audit passes every block in all five looks. It still reports a band text warning on every view, and that warning is there on the unchanged code too. A CDP touch check covered swipe, dot taps, side taps and a neighbour's tap at the track's reach. Blur, Flat Light and Flat Dark were checked from screenshots. The guide's pictures are refreshed (Arial, fictional house). The kitchen tablet has not been checked.


## Next: owner review, round 2 (2026-10-22)

The owner's review of 0.1.58 on the house. Code progress is recorded under each item; publication and physical-tablet acceptance remain open. Every item follows DESIGN.md
(/Volumes/config/hk_house/docs/DESIGN.md, read-only) and is checked with the render audit
(`tools/headless/home_grid_audit.py`), screenshots in every look (Flat Light, Flat Dark, Blur), and the editor smoke
(`tools/headless/grid_editor_smoke.py`). Record each item's progress under it as you go.

### R1. The card picker (+ Add) — rebuild it

**Progress (2026-10-23): implemented.** Searchable groups, descriptions, one live preview in the screen’s own rendering context, named sizes and no-space labels, Add/drag, and the same gallery for changing primary/fallback cards. Preview controls remain inert.


"A horrible layout." Today it is a flat list of every card times every size. Its previews are broken (white bars
over empty grey boxes: the preview cards get no house data and no sized cell), and its sizes are bare letters.
Rebuild it like iOS's widget gallery:

- Cards in groups (Rooms & Lights, Scenes, Climate, Music, Security & Cameras, Info), each row its glyph, name and
  a one-line description, and a search field.
- Choosing one shows **one large live preview**, drawn by the real card in a sized cell (`container-type:size`,
  `hk-cell`, `--hk-cell-w/-h` as `hk-home-grid-view` gives them), with the house's data. Under it is a segmented
  size control with real names (Small, Wide, Tall, Large, Extra Large), only the card's own sizes. A size with no
  free space is dimmed and says so.
- **Add** places it at the first fit; the preview also drags onto the grid.
- The same picker, or its parts, picks a block's **card when its options are edited** (below, R7).

(A session card with this brief was proposed on 2026-10-22, task_bf793631; this section supersedes it.)

### R2. The room block — the mock-up's, only what turns on and off

**Progress (2026-10-23): implemented.** Refined after the owner clarified the surrounding tile: a shared plate surrounds the heading and regular 70 px accessory pills. No status row or stretched entity tile. Includes lights, switches/outlets shown as lights, fans and speaker; overflow uses +N more. Paged scenes also have a surrounding plate with dots inside.


It "looks way different than the mock-up" (concept A on the canvas, https://claude.ai/artifact/JnMmSXDneGVE1e81BWYuid).
It **must not include the room's status chips** (temperature, humidity, doors, motion and so on): drop the status
row (`hk-room-status-card`) from `hk-grid-room-card` (web/hk/cards/hk-grid-cards.js) entirely. It shows **only the
room's entities that turn on and off**: lights, switches and outlets shown as lights, fans, its speaker. Lay them out
as the mock-up does, filling the block (no tall empty space under one pill). Keep tap to toggle and press-and-hold
to dim. A room with more than fits says "+N more", which opens the room page.

### R3. A weather block like Apple's Weather widget

**Progress (2026-10-23): implemented.** Wide shows conditions, Large adds six hours, and Extra Large adds five days with range bars positioned on the week’s span. Uses the Weather page’s sources and glyphs.


The owner's reference (a screenshot of Apple's large Weather widget, not committed). It is one plate with:

- top left the place's name, and under it the current temperature very large; top right the condition glyph, the
  condition ("Clear") and "H:74° L:45°";
- a hairline, then a row of six hours, each its time ("9 PM"), its glyph and its temperature;
- a hairline, then five days, each its weekday, its glyph, the low (dimmed), a range bar coloured cool to warm
  (positioned on the week's span, as Apple's is) and the high.

Sizes: **W** the top part only, **L** the top and the hours, **XL** (or a T/L variant) all three. It replaces
today's `weather` block (`hk-weather-band-card section: hero`), using the Weather page's own data and glyphs
(`hk-weather.js`), and fits the block exactly with no scrolling. The band's weather stays as it is.

### R4. One camera

**Progress (2026-10-23): implemented.** A single card defaults to the first camera. The editor explicitly labels Camera; each automatic page names exactly one entity. A browser check verifies the selected camera is the only one.


"I can't seem to only show one camera; it always wants to show at least two." A camera block with one camera
chosen (or one page of a `cameras` source) must draw that camera alone, filling the block. Find why two show:
the `camera` entry in `hk-grid-catalog.js` hands `hk-camera-mosaic-card` the screen's cameras when no `entity` is
set, the starter uses `pages: {source: 'cameras'}`, and the editor may offer no way to pick one camera. Fix it so
that choosing one camera is obvious in the editor and draws one.

### R5. The security block — a real design

**Progress (2026-10-23): implemented.** A tile with shield and alarm state. Wide adds entry/lock summary and Home/Away/Disarm affordances opening shared alarm controls. The block sends no alarm command; the shared sheet retains its PIN flow.


"Doesn't fit with the format of all the other cards; looks lazy." Today it is the Security page's status row
(`hk-page-status-card page: security`) in a plate. Design a proper block in the grid's tile language (as the
action, timers and scene tiles):

- **S:** the system's glyph in its well (colored when armed), "Security" and its state ("Disarmed", "Armed
  Away"); a tap opens the alarm's sheet, with the PIN as now.
- **W:** the same, plus a second line of locks and doors ("2 Locks Locked · 1 Window Open") and the arm/disarm
  choices as the sheet's, never sent without the PIN.

### R6. Timers with controls

**Progress (2026-10-23): implemented.** Countdown rings, pause/resume and cancel. Paused quick timers stay visible even if removed from the running sensor. Empty opens the existing keypad; Wide uses the Timers page’s configured durations and quick-start script. Checked through fake action ports.


"Shouldn't the timer card have some controls on it?" Give the block the Timers page's own controls:

- **S:** none running: a tap opens Create a Timer (the keypad sheet, `hk-timer-new-card`); one running: its ring
  of time left, with pause/resume and cancel (44 px).
- **W:** the running timers with their controls, plus quick starts (the house's timer presets, the page's chips)
  when none are running.

Calls go through the same scripts as the Timers page (`script.quick_timer_create`, `timer.*`).

### R7. Conditional blocks

**Progress (2026-10-23): implemented.** Bounded named conditions and same-size fallbacks checked in hk_core, with catalog parity. Only the active card is mounted. Editor supports both cards’ options, automatic fallback pages and Live/Primary/Fallback preview. Tests cover malformed/nested fallbacks, persistence, live state changes and fixed geometry. Doorbell events last 60 seconds.


"May be cool to make some of these cards conditional." A block option, **Show When**: always (default), or a
condition. Examples are "music playing", "a timer running", "the alarm armed", "someone at the door", "after
sunset", or an entity's state. While the condition is false, the block's space goes to a **fallback block** the
owner chooses, so the grid never shows a hole and never reflows. It's checked in `hk_core` like the rest of
`home_grid` (a Python mirror kept equal by a test), and the editor shows both states, with a toggle to preview the
other one.

### R8. Every block follows the screen's look

**Progress (2026-10-23): implemented.** Thermostat identifies itself on shared-glass join/leave and notifies it after rebuilding. Scene groups join/leave their surrounding plate. Audit checks glass registration, Flat filters and look shadows. Media progress has 12 px of separation below the title/artwork region.


"Not all cards follow the appearance selected; the Thermostat card isn't blurred." In Blur (glass) the thermostat
block's plate is not frosted like the others. Audit **every catalog card at every size** in each look for the
look's own plate (`hkCards.plate()` / `--hk-look-shadow` / the glass blur), and fix the ones that draw their own
surface (the thermostat's `.surface.tstat` in web/hk/cards/hk-control.js is the known one). Add the check to
`home_grid_audit.py`, so a block whose plate doesn't match its look fails.

### Also open

- **Resolved (2026-10-23):** the band warning measured unused font ascent/descent reserve. The audit now checks actual glyph ink with canvas metrics; the visible clock fits without changing alignment.
- The kitchen tablet hasn't been checked with a Home Grid screen (real swipes, touch, idle return, doorbell jump).
- HK Frontend's next build (1.10.8) carries all of this; it needs the owner's OK, as does each release.


### Round 2 delivery checks (2026-10-23)

- All eight review items have code and editor support. The owner's follow-up is included: room and scene groups have surrounding plates with regular pills, and the music progress bar has more breathing room.
- Main suite: **3,428 passed, 21 skipped**. HK Frontend Python: **758 passed**. All frontend JavaScript suites pass, with intentional CSS snapshots refreshed. Focused model/editor tests cover the conditional schema, catalog parity, refusals and persistence.
- All **18 catalog cards** pass every size in Flat Light, Flat Dark, Blur Day and Blur Night, plus Flat Dark without the tab bar. The final room pass also checks the surrounding plate and shared material. No band-clipping warning remains.
- Both starters pass composed layout checks in **Chrome and WebKit**, across Flat Light, Flat Dark and Blur. Editor smoke passes real drag/swap, overlay geometry, populated picker, conditional previews, save/refusal, history, copy and cancel.
- `tools/headless/grid_review_check.py` covers live primary/fallback swaps without reflow, the single chosen camera, no room status row, timer pause/resume/cancel through a fake action port, paused countdowns, timer creation and the shared alarm sheet (including armed-state rendering).
- Package and documentation links pass. Screenshots use fictional devices and Arial. Production files and the unrelated Xcode project edit remain untouched.

**Still open:** owner's visual acceptance on the kitchen tablet, real touch/swipe/idle/doorbell behavior, and separately approved releases. This commit does not publish HK Frontend or deploy Mantel.


### Group appearance and alignment follow-up (2026-10-23)

- Large Now Playing balances the artwork against the title/artist/speaker group, using equal space above and below the metadata. Composed-layout checks measure their shared vertical centre within 1 px.
- Scene pills fill their allocated rows inside the surrounding plate; the page control retains its own clear footer. Their regular horizontal pill layout is preserved.
- Room and scene groups offer Custom Group Background: a color, opacity slider and Follow Screen / None / Light / Medium / Heavy blur. The default remains the screen's appearance. Only the outer plate changes; child pills keep their own material and opacity. Custom values are bounded in hk_core and mirrored in the catalog. Glass registration refreshes when a group changes its own blur.
- The picker is implemented: searchable categories, readable descriptions, one populated live preview, named sizes and first-fit/drag placement. Its list now scrolls within the available desktop height. The preview waits for the shared screen/client rather than a host-specific ready flag, so both hosts can load it.
- Validation includes editor toggle/slider and saved-layout checks, background independence from child pills, browser measurements for filled scene rows and music alignment, Chrome/WebKit starters, card render checks in three looks, model/boundary tests and all frontend suites. These changes still require the normal release and tablet acceptance.

Final follow-up checks: **3,439 passed, 21 skipped** in the complete main suite; all frontend JavaScript suites pass with intentional tile/media snapshots refreshed. The focused model, host-boundary and settings run passes 156 tests. Chrome and WebKit both pass the two starters in three looks, including explicit artwork-centre and scene-row-fill measurements. The editor smoke checks the actual background toggle/opacity slider and saves their values; the interaction check verifies tint/blur without changing pill backgrounds. Card geometry/material checks, packaging and links pass. No release or household command was performed.


### Editor scrolling follow-up (2026-10-23)

The gallery previously had its own scroll area, but the editor itself could still grow with long settings, moving the dashboard preview out of view. The desktop editor is now bounded to the window: toolbar and preview stay in place, and the entire right-hand options panel has one independent scroll area with scroll chaining contained. The frame scales to the stage's actual remaining height, including wrapped instructions, and follows both stage and instruction-size changes.

Checked with real wheel input in the picker and block settings at 1600 × 1000 and 1280 × 650, including extra input at the bottom of the panel. Chrome and WebKit keep the preview in the same position and fully visible. The editor smoke also retains drag/swap, overlay geometry, background controls, conditional previews, save/refusal, history, copy and cancel checks. Focused editor/settings/host-boundary tests pass. No release or production setting was changed.

### House update: Mantel App 0.1.59 (2026-10-23)

The owner authorized a new app release to the house. Main commit `1995bb8` was staged through the existing local-app process and installed as 0.1.59, including all second-review refinements and the editor scrolling fix. Home Assistant created a protected backup of Mantel 0.1.58 before the update. The installed app reports 0.1.59; strict health returns OK with Home Assistant connected and build `614dc07f88fc0d3b`, matching the staged artifact. Startup logs contain no errors or traceback.

This was a local Home Assistant App update; no public image/tag publication or HK Frontend release was performed. Physical kitchen-tablet visual and touch/swipe acceptance remains with the owner. A release-test assumption that private-word injection always belongs in Unreleased was corrected to cover both Unreleased and a versioned section; the publication/version tests pass.

### Owner review, round 3 (2026-10-23)

- **One camera:** the mosaic was replacing the block's configured camera with the screen's camera list. Grid cameras now keep their own list, including each page of a carousel. Picking a Camera switches the block to One Camera; Camera Display → Swipe All Cameras explicitly restores automatic paging. The browser check asserts the resolved camera list, not just the config.
- **Screen Settings:** columns, rows, frame dimensions and header controls are behind a collapsed disclosure. Clock and weather can be hidden independently while keeping the header's status chips. Both flags are checked and preserved by the shared settings model.
- **Thermostat appearance:** the dial uses the same positioned `hk-plate` element as its neighbours. Chrome and WebKit compare its material with the room's across Flat Light, Flat Dark and Blur.
- **Page controls:** centred dots sit inside a small pill, retaining their touch targets. Browser checks measure their centre against the card and exercise actual dot clicks and idle return.
- **Picker:** all 18 icons use available bundled glyphs. Illustrative readings populate climate, weather, music, lights, presence, vacuum, alarm, timers and calendar previews. Sample clients are read-only and excluded from the live client hub, including nested controls in either host; adding a card still saves actual home entities and options.
- **Room tiles:** Large uses at most two rows of two tall accessory tiles; Extra Large uses two rows of three. Rows stretch to fill the plate, with compact wells on short rows to retain names and states. Wide retains regular pills; overflow still opens the room.
- **Weather:** Large adds humidity/wind/feels-like readings when available, six hours and three days. Extra Large puts current conditions beside six hours and five days. Weather Sky Background is an opt-in, initially off, reuse of Sky's own sky-only renderer. It follows the block's chosen weather entity, stays clipped inside the card, pauses for reduced motion, disabled animations, sleep, hidden pages and offscreen cards, and disposes its scene when turned off or removed.

Validation: the full main suite passed **3,447 tests, 21 skipped**, plus two explicit preview-client regressions for Mantel and Home Assistant. All frontend JavaScript suites pass with intentional CSS snapshots refreshed. Chrome and WebKit pass both starters in three appearances, including thermostat material parity, centred dots, real dot clicks and idle return. Room/weather/thermostat render audits pass; a populated-room audit also checks short tall-tile rows. The editor smoke passes real drag/swap, independent scrolling at two window sizes, all picker icons, populated previews, camera selection, header toggles, conditional preview, save/refusal, history, copy and cancel. The interaction check covers selected-entity Sky rendering, card bounds, reduced motion, toggle cleanup and the resolved single-camera list. Packaging and documentation links pass.

**Continuation:** publish the next Mantel App release when authorized, then review the actual kitchen tablet. This round does not change the installed 0.1.59 app or publish HK Frontend. Keep the unrelated local Xcode project changes out of the commit.


### Fixed tall-tile review (2026-10-23)

The owner requested consistent tile sizes using the existing design, with 1280 × 800 as the reference and Apple HomeView as a layout reference. Home Grid now uses `TILE.w` (196), `TILE.tall` (150) and `TILE.gridGap` (10). Blocks retain logical dimensions as the display changes. The whole canvas scales down uniformly to fit the available viewport after navigation, never enlarges beyond its design size, and centers spare space. Screen Settings → Grid Scale offers Automatic Fit and 50–90% of Fit. Saved positions and size classes remain intact; frame dimensions continue to describe the editor’s preview display.

Room and scene groups add XXL (six columns by two rows). Room groups explicitly reserve two rows even when only one accessory is present; Wide reserves one row. The picker uses the same logical dimensions, and editor overlays account for scaled gaps.

Person portraits now rewrite HA `/api/image/serve/...` and `/local/...` paths to a prefix-aware Mantel route. Only viewers of that person may fetch it; HA credentials stay on the server, with no browser-supplied upstream address and no redirect following. Absolute URLs on the configured HA origin are supported too. People strips and person sheets fall back to initials when an image fails.

Continuation: these changes require the next authorized app release and physical-tablet acceptance. The installed house app remains 0.1.59. Keep unrelated Xcode changes out of the commit.

Validation: **3,452 main tests passed, 21 skipped**; all frontend JavaScript suites pass with intentional room-row and icon-well snapshots refreshed. Chrome and WebKit pass both starters in Flat Light, Flat Dark and Blur, including sparse-room row reservation, standard 42 px wells, glyph containment, missing-portrait initials, six-column room geometry, uniform proportions at 1280 × 800, 1920 × 1080, 1024 × 768, 800 × 1280 and 390 × 844, real dot clicks and idle return. The editor smoke passes drag/swap, overlay geometry, populated previews, independent scrolling, save/refusal, history, copy and cancel. Packaging and 80 documentation-link checks pass. No house controls or deployment were invoked.


### House update: Mantel App 0.1.60 (2026-10-23)

The owner authorized deployment of the completed fixes. Release commit `47c5ace` was pushed on main and staged through the local-app process. Home Assistant created protected backup `a719cf98` of Mantel 0.1.59 before installing 0.1.60. The update request timed out while waiting; durable update state confirmed it was already in progress, so it was not repeated. Installation then completed: installed/latest version 0.1.60, no pending update, strict health OK, Home Assistant connected, and running build `4620f64abdedc2cd` matching the staged artifact. The latest 100 startup log lines contain no errors or traceback; command settings retain their existing role checks.

This deploys fixed tile proportions and scaling, reserved room rows and standard accessory circles, full-width groups, portrait routing/fallbacks, and the third-review picker/camera/header/weather improvements. No HK Frontend publication or public release tag was made. The kitchen tablet still needs the owner’s visual and touch review after a reload.


### Room controls and starter-layout follow-up (2026-10-23)

Owner review of 0.1.60 identified two editor issues. Starter Layouts remained visible among a selected card’s controls; they now sit inside collapsed Screen Settings once a layout exists, while a new layout still offers them directly. The description states that a starter replaces the draft.

A room’s Area option was silently overridden by automatic Rooms paging, while the tablet-room start fell back to Dining Room on an unassigned desktop. Room Display now distinguishes One Room (Room selector), Swipe Between Rooms (Starting Room selector), and Custom Pages (Default Room and per-page Room). Automatic room paging opens on the selected starting room and returns there on idle. Explicit rooms take priority over legacy tablet-room flags; Tablet’s Room still resolves per device. The UI hides the duplicate Area and tablet-start toggle in room swipe mode and explains desktop/unavailable-room fallback beside the relevant control. This preserves the saved schema and the rest of the screen’s room order.

Validation: all frontend JavaScript suites pass, including four opening-page regressions; 75 focused grid, preview-safety and documentation tests pass. The desktop editor smoke exercises Kitchen as the opening room, switching between single and swipe modes, idle return, collapsed starters, drag/swap, independent scrolling, save/refusal, history, copy and cancel. House deployment remains on 0.1.60 until another release is authorized.


### Editor outline polish and 0.1.61 release preparation (2026-10-23)

The owner requested matching corner radii for placement guides and selected cards, and authorized the next house release with the room-control follow-up. Editor grid slots, selected blocks and drag outlines now read the card radius and apply the preview’s uniform scale. This removes the separate 10 px editor-outline radius. The release is prepared as 0.1.61; deployment verification follows below when complete.

Validation: Chrome and WebKit compare placement/selection radii against the card’s computed radius at the preview scale. The full frontend JavaScript suite passes; 100 focused grid/release/documentation tests pass, 3 skipped. The editor smoke retains room-start/idle behavior, drag geometry, scrolling, save/refusal, history, copy and cancel checks.


### House update: Mantel App 0.1.61 (2026-10-23)

The owner authorized deployment, including corner polish if usage allowed. Chrome and WebKit checks passed, so the update includes both that polish and the room-control fixes. Release commit `3a9324d` was pushed to main and staged through the local-app process. Home Assistant created protected backup `91e7cdd2` of Mantel 0.1.60 before installing 0.1.61. The install request timed out while waiting, but durable update state confirmed it was in progress; the request was not repeated. Installation completed with installed/latest version 0.1.61, no pending update, strict health OK and Home Assistant connected. Build `0585bc0be6880d32` matches the staged release. The latest 100 startup log lines contain no errors or traceback.

This was a local house App update. No public release tag or HK Frontend update was made. Reload the editor and dashboard for the new controls; physical-tablet acceptance remains with the owner.


### Shared-layer blur and page-control width follow-up (2026-10-23)

The owner’s 0.1.61 screenshot showed sharp wallpaper behind a correctly registered thermostat. The Home Grid cell’s `clip-path: inset(-40px)` created a backdrop root around the shared blur inside its swipe track, preventing that layer from sampling the wallpaper. The view now lets cell shadows extend between cards, while cards/tracks clip their own content and the grid clips its outer edge. Removing the cell clip-path restores live shared blur for paged thermostats, room groups and scene groups. No per-card blur fallback was added.

Page controls now set their desired width from the page count. The enclosing pill stays within the card; dot targets can shrink horizontally on narrow cards so every dot remains inside its background. Vertical touch targets remain 44 px and idle return is unchanged.

Validation: Chrome’s controlled checkerboard test measured background contrast of 111.84 before the fix and 0.98 afterward (standalone blur baseline 0.64), confirming painted blur rather than matching CSS colors alone. Both starters pass Flat Light, Flat Dark and Blur structural/interaction checks in Chrome and WebKit, including registration, absence of backdrop-blocking ancestor clip-paths, 2/6/12-dot containment, actual last-dot clicks, room idle return, display scaling and editor geometry. This headless WebKit renderer does not paint even a standalone baseline backdrop blur; its pixel assertion is explicitly reported unavailable rather than counted as a visual pass. Live Safari/tablet appearance therefore remains an acceptance check for the next authorized release. All frontend JavaScript suites, 75 focused grid/preview/documentation tests, packaging and documentation links pass. The house remains on 0.1.61.


### Desktop paging, right-aligned chips, group controls and announcements (2026-10-23)

Desktop paging now supports mouse dragging, horizontal trackpad scrolling and Shift + wheel. Mouse drags suppress the following click so a scene or light is not activated accidentally, respect drag controls, account for whole-grid scaling, and settle on the nearest page. Wheel input turns one page per gesture (including its momentum tail), avoiding WebKit’s native snap-back. These inputs mark the page as user-chosen before state updates arrive; automatic starting-page selection no longer resets them. Idle return still works.

Header chip rows use spare space on the left when they fit and keep the first chip reachable when overflowing. Other scrolling rows keep their existing alignment.

Group controls were absent from Lights and accessory type lists because those lists reused the status inventory, which excludes groups to avoid double-counting members. Light groups now appear as category controls, and grouped accessories appear in their type lists. Registry hiding, screen exclusions and explicit group exclusions are respected. Counts and light-history headers keep using the counting inventory. Blind groups also remain available as controls without treating garage-door groups as blinds.

Mantel’s music feed previously always sent an empty announcement list. Its read-only HA connection now observes service events, forwarding only relevant target IDs and the announcement flag to a transient tracker. TTS, announced media and Music Assistant announcements are matched to configured speakers and native/MA counterparts by device/MAC identity. Failed starts, maximum lifetime, completion, resumed music, ordinary play and disconnect clear markers. Spoken text is not retained or sent to screens. The existing Ignore Announcements switch controls display suppression; no audio or automation commands were added.

Validation: both starters in Flat Light, Flat Dark and Blur pass Chrome and WebKit interaction/layout checks, including real mouse drag and wheel input followed by state updates, idle return, fitting and overflowing chips, and zero house commands. All frontend suites pass; the final explicit group-hide refinement passes all 339 strategy-family assertions. Backend validation includes 106 focused music/feed/lifecycle checks. The broad Python run passed 3,460 tests with 21 skips; its one outdated source-text guard was corrected to distinguish observing a service event from sending a service command, then all 44 configuration/connection checks passed. Documentation links, version consistency and diff checks pass. WebKit’s backdrop pixel limitation remains as documented above.

Continuation: changes are on main, not deployed. The house remains on App 0.1.61. Next release should include these changes and the preceding thermostat shared-blur/page-pill fixes, followed by live Safari/tablet checks and observation of a normal household announcement. No test announcement was played during development. The unrelated Xcode project edit remains untouched.


### Accessory collections, captions and content-sized person sheets (2026-10-23)

Added Accessory Group to the catalog, using the room card’s plate, reserved rows, tall tile sizing and existing accessory controls. Selected accessories can come from any room. Automatic Swipe Pages chunks their ordered list by size (2/4/6/12); Choose Each Page exposes separate ordered sets, page names and Add/Move/Remove Page controls. The model validates every entry and refuses overflowing manual pages rather than silently discarding controls. The editor explains per-page capacity and refuses shrinking a custom page past it.

Single accessories and each collection entry can choose Line Under Name: Automatic, State, Brightness, An Attribute or Hidden. Attribute choices come from scalar values currently reported by that entity; optional units are plain text. Missing/structured values display a dash, with no executable templates. Choices persist per block/page and render through the existing tile text path.

Person sheets now request content height instead of the fixed control-sheet height. The desktop map retains a useful minimum; phone layout keeps its fixed map height and scrolls within the capped sheet. Other detail-sheet kinds retain their existing sizing.

Validation: the real-browser collection check covers automatic/custom page contents, sparse fixed rows, attribute updates, caption editing and persistence after Save. The person check covers desktop content sizing with a phone battery row and scrolling at 390 × 600. The existing complete editor smoke check passes with 19 catalog cards. Full frontend suites and focused model/editor/release tests pass; complete backend and release checks are recorded with the deployment below. Only fictional controls were used during development.

Release intent: house App 0.1.62, including the previous undeployed paging/chips/groups/announcements and shared-blur/page-pill fixes. No public release tag or HK Frontend update is requested. The unrelated Xcode project edit remains untouched.


0.1.62 release checks: all frontend suites pass. The complete backend run passed 3,470 tests with 21 skips; one PIN-leak assertion matched the test PIN as a random substring inside a generated identifier, rather than leaked command data. The full PIN suite and focused grid/editor/release checks then passed (159 passed, 3 skipped), with no unrelated test or product changes. Chrome and WebKit both verify collection paging/captions and compact person sheets with phone scrolling. Version consistency, release packaging and documentation links pass.


### House App 0.1.62 deployed (2026-10-23)

Release commit `799d4a0` was pushed to main and staged to the house’s local Mantel App source (2,991 files). Home Assistant created protected pre-update backup `863703ea` of Mantel 0.1.61. The install request timed out while waiting, but durable update state confirmed it was in progress; it was not repeated. Installation finished with installed/latest version 0.1.62, no pending update, strict health OK and Home Assistant connected. Build `62465ee86393a735` matches the staged release and `/api/version`. The latest 100 App log lines have no ERROR, CRITICAL or traceback entries.

This house update includes the new accessory collections/captions and compact person sheet, plus all preceding undeployed paging, chip, group, announcement, thermostat shared-blur and page-pill fixes. Reload the dashboard/settings for the new editor controls. Real Safari/tablet appearance and observation of a normal household announcement remain owner acceptance checks; no test announcement or household action was sent. No public tag/release or HK Frontend update was made. The unrelated Xcode edit is unchanged.

### Room scrolling and missing entity icons (2026-10-23, App 0.1.63)

Room blocks now offer Accessory Display: Summary (the existing default) or Scroll All Accessories. Scrolling reuses the full room page's supported control selection and ordering, including locks, covers, climate controls and speakers, while respecting visibility settings. Diagnostic sensors are not automatically added. Two visible rows retain their tile heights; Wide retains one. The title and pager foot remain outside the vertical viewport. Quick vertical pans scroll; a held dimmable light owns its dimming gesture; sideways swipes still change rooms.

Coffee Maker requests `mdi:coffee-maker`, absent from Mantel's bundled subset; it now resolves to the bundled coffee-maker outline. Good Morning is an `input_button` helper, whose domain had no default, and the previous generic bookmark was also absent. Button helpers now have a supported default. Missing entity icons fall back to a bundled domain glyph; script and siren defaults also use available paths. No licensed glyph artwork was added.

Validation: 152 focused model/editor/staging/release tests pass (3 skips), all shared JavaScript suites pass, and version, release packaging and documentation-link checks pass. The fictional room browser check covers fixed row heights, all supported controls, mouse-wheel vertical scrolling without a page change, final-row visibility, entity icons and fallback, and editor persistence in Chromium and WebKit. Chromium additionally exercises native vertical touch scrolling, horizontal room swiping and long-press dimming. Real tablet acceptance remains with the owner. Release deployment details follow when installation is verified.

### House App 0.1.63 deployed (2026-10-23)

Release commit `4ba5f6d` was pushed to main and staged to the house's local Mantel App source (2,991 files). Home Assistant created protected pre-update backup `6b8dbfda` of Mantel 0.1.62. The install request timed out while waiting; durable update state confirmed installation in progress, so the request was not repeated. Installed/latest version is now 0.1.63 with no pending update, strict health OK and Home Assistant connected. Build `368d66814f41e4de` matches the staged release and `/api/version`. The latest 100 App log lines contain no ERROR, CRITICAL or traceback entries.

Reload the dashboard/settings for the icon fixes and Accessory Display selector. Select a room block and choose Scroll All Accessories to enable vertical scrolling; Summary remains the default. No public tag/release or HK Frontend update was made. Real Safari/tablet acceptance remains with the owner. The unrelated Xcode edit is unchanged.

### Shared room-page glyphs for standalone blocks (2026-10-23, implemented on main)

Standalone Accessory and Scene blocks now resolve their nested card through the existing room-page builders (`hkStrategy.tileFor` and `hkChip.scenes.pill`). Accessory Groups already used the shared accessory builder. The internal runtime wrapper preserves saved names, glyphs, measured icon sizes, colors, state-specific icons and accessory behavior, while the grid retains its fixed size and caption override. It resolves using its own client, including preview clients, and refreshes the mounted child when saved choices change. Unchanged pushes retain the child. Paged and conditional blocks use the same catalog path.

Validation: all shared frontend suites and 138 focused model/editor tests pass. Chromium and WebKit compare saved accessory and scene glyph/color choices against the room builders, verify actual SVG paths, unchanged card height and hidden-caption overrides, and retain the room scrolling/paging checks. No household controls were exercised. This change is on main for the next App release; the house remains on verified 0.1.63. The unrelated Xcode edit is unchanged.

### House App 0.1.64 deployed (2026-10-23)

Release commit `d46d8b5` includes shared-glyph implementation `d58e1a9`, was pushed to main and staged to the house's local Mantel App source (2,991 files). Home Assistant created protected pre-update backup `b446c83f` of Mantel 0.1.63. The install request timed out while waiting; durable update state confirmed installation in progress, so the request was not repeated. Installed/latest version is now 0.1.64 with no pending update, strict health OK and Home Assistant connected. Build `953e64d7b80d1d4f` matches the staged release and `/api/version`. The latest 100 App log lines contain no ERROR, CRITICAL or traceback entries.

Version consistency, release packaging and documentation links pass; staging/release tests pass (14 passed, 3 skipped). The implementation's full frontend suite, 138 focused model/editor tests, and Chromium/WebKit glyph/geometry/caption checks passed before release preparation. Reload the dashboard/settings for the shared accessory and scene glyphs. No public tag/release or HK Frontend update was made. Real tablet acceptance remains with the owner. The unrelated Xcode edit is unchanged.

### Audit of the Home Grid commits (2026-10-23, Claude)

The owner asked for every Home Grid commit to be checked against the plan and DESIGN.md
(/Volumes/config/hk_house/docs/DESIGN.md). The model, the hk_core checks and their JS mirror, the strategy, the
view, the pager, the cards, the editor, both hosts' routes (starter, history, `tablet_room`, the portrait route) and
the announcement observer were read. All of these match the plan and follow its rules. Commands go through each
card's action port, there is no `hass` outside the adapters, and drafts never reach the settings feed. Fixed on main:

- **A conditional block kept its old card after its options changed.** It rebuilt only when the condition flipped,
  so a saved change reached the screen only on the next flip. It now rebuilds when the condition, the block or its
  house context changes (hk-layout.js `HkGridConditionalCard`).
- **An Accessory Group as a fallback couldn't be saved at Wide.** The editor gave it four sample accessories with no
  pages, and hk_core refused them (two fit a Wide page). A fallback now starts the way a new block does, with
  automatic pages (hk-grid-editor.js `variantFor`).
- **The Security block said "Entries Closed" in a house with no door or window sensors.** It now says nothing about
  entries there.
- **The timers block's first-pass tile styles were dead code.** R6 replaced the `.tl`, `.tm` and `.one` styles and
  `this._one` without removing them. They carried literal colors against DESIGN.md rule 1. Removed. The block
  renders as before; the CSS snapshot is refreshed and its controls' text uses the caption role.
- **The room card's registered description still said "its name and status".** The status row went in R2.
- **The camera strip's comment had been separated from `cameraStrip`.** `homeGridView` was inserted between them in
  hk-strategy.js.

Left for the owner (decisions, not defects):

- The page control's pill is `rgba(30,30,36,.22)`, a literal with no token (DESIGN.md rules 1 and 3). It reads as a
  scrim over camera pictures. Naming it, or moving it to `overlay`, changes how it looks.
- The Security block's Wide **Home / Away / Disarm** buttons all open the same alarm sheet. The sheet still asks for
  the PIN, but it doesn't open on the mode that was tapped.
- The Weather block's opt-in sky pauses for Reduce Motion and Sky Animations off, but not for Flat with motion off.

Checked after the fixes: the main suite (3,474 passed and 21 skipped), every HA JavaScript suite on the built package,
232 focused grid, editor, settings and boundary tests, `grid_editor_smoke.py` and `grid_review_check.py`. Nothing
was released or deployed. The house stays on App 0.1.64 until the next release the owner approves.

### Swipes that land, and the editor rebuilt around a palette (2026-10-23, Claude)

The owner asked for a dashboard designer where cards are dragged out of a menu, a pass over how a block's settings are
laid out, and a look at why block swipes were unreliable.

**Swipes.** `tools/headless/pager_swipe_check.py` drives real touch input over every paged block: rooms, cameras,
thermostats, scenes, an accessory group and a scrolling room. It swipes from a grid of starting points, as flicks,
slow drags and short swipes. Against the browser's own scroll-snap, 13 of 75 flicks missed: short flicks snapped
back, and a swipe that started on the page dots went nowhere (the dots sit outside the scroller).

The pager now does the drag itself (hk-layout.js, GESTURES):

- Pages say `touch-action: pan-y`, so up-and-down pans stay with the browser and a room's list still scrolls.
- A sideways drag comes to the pager as pointer events, for touch, pen and mouse alike.
- On release it turns a page if the drag went a fifth of the width or was a flick (0.3 px/ms); otherwise it goes
  back.
- When the swipe takes over, the card under the finger gets a `pointercancel`, so a light's press-and-hold never
  fires mid-swipe. A light already dimming says `data-hk-control` and keeps its drag.
- Taking pointer capture fires `lostpointercapture` on the card underneath, and that is ignored.

Results: 225 of 225 swipes now turn the page and come back. A tap still toggles a light, a swipe across a light sends
nothing, hold-and-drag still dims without turning the page, a room list still scrolls, a dot tap and a swipe on the
dots both work, and a mouse drag works. WebKit couldn't be run here because Playwright isn't installed, so Safari on
a tablet is part of the owner's check.

**The editor** (hk-grid-editor.js) now has three panes:

- **Cards (left).** Grouped and searchable, each with its size chips. Drag a card onto the grid: a label follows the
  pointer, and the block's real footprint shows where it lands, red where there's no room. Click a card for its live
  preview and **Add**. **Change Card…** and the fallback chooser use the same list, limited to the block's size.
- **The screen (middle).** A block's label shows only on hover or selection, above the block, so it no longer covers
  the card's own title.
- **Settings (right).** For a selected block, in order:
  1. A header (card, size, place, Done)
  2. A **Size** segmented control and **Change Card…**
  3. **Content:** one **Show** choice (One Room / Swipe Between Rooms / Choose Each Page, and the same for cameras,
     thermostats, speakers and scenes), followed only by the options that apply, with real names (Thermostat,
     Camera, Speaker) in place of "Entity"
  4. **Appearance**
  5. **Show When** (with Otherwise Show and Preview)
  6. **Remove Block**

  With nothing selected it shows the screen's settings: Grid, Header, Preview Size and Starters, and Mantel's
  History and Copy.
- **Also new:** **Start Empty**, **Undo** (⌘Z), Delete to remove the selected block, and Escape to let it go.

Checked: every HA JavaScript suite (the pager's CSS snapshot and unit tests updated); the editor smoke, which now adds
a real mouse drag out of the palette, a refused drag onto a taken space, Undo and Delete; the accessory-pages and
review checks; the swipe check; and the editor in a scratch Home Assistant (open, preview, real drag and save). Both
guides and their screenshots are rewritten for the new editor; `home-grid-gallery.png` is gone.

### House App 0.1.65 deployed (2026-10-23)

The owner asked for this release. Release commit `718db98` (the swipe gesture, the palette editor and the audit fixes)
was pushed to main and staged to the house's local Mantel App source (2,991 files). The update installed on the
first request: installed and latest version 0.1.65, no pending update, strict health OK, Home Assistant connected.
Build `6036a4394615f81d` matches the staged release and `/api/version`. The app log has no ERROR or Traceback
entries, and a screen loaded the new files right after the restart. No public tag, release or HK Frontend update was
made. Reload the dashboards and Settings to pick it up. Real-tablet swipes in Safari and the new editor remain for
the owner to try. The unrelated Xcode edit is unchanged.

### The frost follows a swipe again (2026-10-24)

The owner saw the background slide out of line while swiping blocks in Safari. The cause was 0.1.65's track change.
The shared blur (hk-glass.js) puts its layer inside the nearest element that can scroll, so the frost moves with the
cards for free. 0.1.65 had made the track a clipped box (`overflow: hidden`), so the layer went on the page instead.
There it is re-measured behind the moving pages, and Safari lagged. The track is a sideways scroller again
(`overflow-x: auto`), but no finger scrolls it: its pages still say `touch-action: pan-y`, and the pager sets
`scrollLeft` itself.

`pager_swipe_check.py` now runs in the Blur look and checks that each frosted block's blur layer sits inside its
track. 225 of 225 swipes still land, with taps, dimming, list scrolling, the dots and a mouse drag unchanged.

The owner also asked why a room block shows "+4 more" instead of scrolling. That was the default (**Content →
Accessories → Summary**); **Scroll All** scrolls the whole room. At the owner's request, new room blocks (the editor's
and the starters') now start on Scroll All. A saved room without the option stays Summary.

### House App 0.1.66 deployed (2026-10-24)

The owner asked for this release. Release commit `3c6de05` (the frost fix and new rooms starting on Scroll All) was
pushed to main and staged to the house's local App source (2,991 files). The update installed on the first request:
installed and latest version 0.1.66, strict health OK, Home Assistant connected. Build `24cdd9049f6fb054` matches the
staged release, and uptime kept climbing across checks. The app log has no Traceback. The only lines matching "ERROR"
are two INFO camera-still connection resets from just before the restart. No public tag, release or HK Frontend
update was made. Reload the tablets to pick it up. Rooms saved before this release keep Summary until changed.

### Nothing slides over the blocks beside a swipe (2026-10-24)

After 0.1.66 the owner still saw glitches on the tiles beside a swiping block. Mid-swipe screenshots in the Blur look
showed the cause. The track reaches 28 px past the block on each side (PAGER_ROOM) so the plates' shadows aren't
clipped at rest. A page passing through that reach drew slivers of its tiles across the gap and over the neighbouring
blocks' edges.

While a page moves (a drag, its slide home, a dot or wheel turn), the pager now marks itself as moving:

- The block clips at its own rounded edge (`overflow: clip` with the plate radius). This is not `clip-path`, so it
  doesn't stop the shared blur from reaching the wallpaper.
- The host casts the plate's look shadow in place of the clipped pages' shadows, so nothing pops as a swipe starts or
  stops. A `clip-path` on that pseudo-element keeps only the shadow's outside, so the look's inset highlight doesn't
  draw a line across the gap between pages.
- The clip lets go 180 ms after the track rests, unless a finger is still holding it.

`pager_swipe_check.py` checks the clip mid-swipe and its release at rest. 225 of 225 swipes still land.

### More starter layouts, each with a map (2026-10-24)

The owner asked for more starting points, each with a picture. hk_core's `STARTERS` adds Room Focus (R), Music &
Scenes (M), Security & Cameras (S), Family Hub (F) and Essentials (Q) to Tap Weight (A) and Glance Up, Touch Down (C).
Each fills all 24 cells of a 6 × 4 grid from the house, and a new test checks every starter for that and for passing
the write. New room blocks scroll through all their accessories.

In the editor, the starters are a gallery (Start With, or Start Over With inside Preview Size and Starters). Each row
has a small map of the blocks that starter would put on this screen. The map comes from the same read-only
`hk_frontend/grid/starter` request, made once per starter, with each block in its palette group's color and glyph.
Choosing a starter uses the layout already fetched. The editor smoke checks all eight rows and their maps, then picks
Room Focus and Tap Weight. The guide shows the gallery (`home-grid-starters.png`).

### House App 0.1.67 deployed (2026-10-24)

The owner asked to ship three things together:

- the clipped, steady-shadow swipe (`fb5057f`)
- the seven starters with maps (`c1ca577`)
- the Glass looks' Image Look (`99fd8ae`, outside Home Grid: Flat's photo treatment for the other looks' Photo and
  Landscapes, `sky.image_look` / `sky_image_look`, checked by `tests/test_glass_image_look.py` and
  `tools/headless/glass_image_look_check.py`)

Release commit `a92ec03` was pushed and staged to the house's local App source (2,991 files). The update installed on
the first request. Strict health is OK with Home Assistant connected, and build `09a081f5407dfe67` matches the staged
release and `/api/version`. The App log has no ERROR or Traceback entries. Before release, the main suite passed
(3,495 tests, 21 skipped), as did the HA package's Python suite (758) and every JavaScript suite. No public tag,
release or HK Frontend update was made.

### The editor on a slow connection (2026-10-24)

The owner's editor sat blank for minutes on a slow connection, and a throttled browser reproduced it. The preview is
the whole screen in a frame. At 60 KB/s that frame takes about two minutes to become ready, but the editor stopped
asking after 20 seconds and never looked again. Fixes:

- **The preview waits.** It keeps asking with backoff (0.3 s up to 2 s between tries, giving up only after many
  minutes), and its frame's load asks at once. The frame shows "Loading the preview…", then "Still loading…" after a
  while, in place of a red error.
- **The card preview waits too, and is kept.** It now waits up to three minutes instead of ten seconds, and is made
  once per card and size. Before, every draft change rebuilt it, which reloaded the whole screen again.
- **`/api/registry` is compressed and revalidated.** It is about 1.85 MB of JSON on the house, read by every page as
  it loads. It is now gzipped, and an ETag answers a browser that already has it with a 304. It is private and
  revalidated every time, since it is filtered per person (`tests/test_wiring.py`).
- **The web files are precompressed in both images.** aiohttp sends `name.js.gz` to a browser that takes gzip:
  `hk-base.js`, for example, goes from 235 KB to 81 KB.

### House App 0.1.68 deployed (2026-10-24)

The owner asked for this release. Release commit `33cfec1` (the editor waiting for a slow preview, the compressed
registry with its ETag, and the precompressed web files) was pushed and staged. The staged Dockerfile carries the
gzip step. The update installed on the first request. Strict health is OK with Home Assistant connected, and build
`0545787b8b3f29a0` matches the staged release. The App log has no ERROR or Traceback.

A file request from the MCP side is refused without a session (403), so the compressed responses were not observed on
the house itself; the local server check showed `Content-Encoding: gzip` for a file with a `.gz` beside it.

### The editor says what it is waiting for (2026-10-24)

After 0.1.68 the owner's editor still showed no preview, although the house log showed the preview frame fully
loaded within about 20 seconds and still running (camera stills every 10 s). The owner's exact `screen-test`
settings, read from the Mantel mirror in HA storage, loaded at once in Chrome and in WebKit (Playwright 1.62, the
cached WebKit 2336), with the fictional house. The difference is the real house (about 4,500 entities and 24 areas)
behind the remote proxy, which can't be reached from here.

So the editor now reports where it stopped instead of only saying it is loading. It names what it is waiting for (the
screen to load, the screen's code, the screen's page, the home's accessories, a Home page, or Home Grid itself) or,
if something failed, the error text. After about 30 seconds, or straight away on an error, the cover shrinks to a
strip at the foot with that reason, and the blocks can be arranged without the live picture. The editor smoke forces
a failure and checks the reason, the usable blocks and the recovery.

### House App 0.1.69 deployed (2026-10-24)

The owner asked for this release. Release commit `dd62629` (the editor's preview reasons and its usable fallback) was
pushed and staged. The update installed on the first request. Strict health is OK with Home Assistant connected, and
build `889734375329acb7` matches the staged release. There is no Traceback; the only lines matching "ERROR" are INFO
camera-still connection resets from just before the restart. Next: the owner reads the editor's "Waiting for …" line
on the real house.

### The editor on an iPad, and Settings in dark mode (2026-10-24)

What the owner actually saw was the editor's own note: "Arrange Home Grid on a desktop with a mouse or trackpad".
The owner was on an iPad (Safari reports itself as a Mac). The editor hid itself for any `pointer: coarse` device,
following the plan's "arrange on a desktop", and did so without saying why. The earlier load and preview fixes
(0.1.68, 0.1.69) stand on their own, but they were not this.

- **Touch is welcome.** The editor's drags are pointer events. Only a window under 900 px wide still gets the note,
  now with **Open Anyway**, which keeps the three panes and scrolls sideways.
- **Settings follows the device's dark appearance.** When Mantel manages the house's settings, the settings page took
  its themes from HA's `frontend/get_themes`, which never says dark or light, so Mantel Settings was always light.
  `settings-page.js` now sets `darkMode` from `prefers-color-scheme` on that path too, and follows changes.

The editor smoke now opens the editor with touch emulation and a dark device. It checks that the three panes show
and Settings is dark, then turns the device light and checks that Settings follows.

### House App 0.1.70 deployed (2026-10-24)

The owner asked for this release. Release commit `c992504` (the editor opening on an iPad, and Settings following dark
mode) was pushed and staged. The update installed on the first request. Strict health is OK with Home Assistant
connected, build `63df91a1943686e7` matches the staged release, and there is no Traceback. The owner's iPad check
of the editor and of dark mode is next.

### Detail sheets as blocks, rules, and cameras that follow (2026-10-24)

The owner asked for three things after 0.1.70.

- **The alarm keypad and the vacuum as blocks.** Security and Vacuum gain Large and Extra Large. Large Security is
  `hk-grid-keypad-card`: the Security page's own keypad (`hk-alarm-keypad-card`, new `layout: 'side'`) with the keys on
  the left and the alarm's state and ways to arm stacked on the right. The keys are sized to the block (36 to 64 px).
  The alarm is the block's, else the home's (`security.alarm`), else the first. The PIN is still checked by the alarm.
  Large Vacuum is `hk-grid-vacuum-card`: the vacuum card filling the block, or, with HK Clean Areas added, the vacuum
  card over the Clean Areas panel, whose rooms scroll inside its own plate.
- **Rules.** `rules: [{when: {all: [...]}, card, opts?, pages?}]` (up to 4 rules, up to 3 conditions each) replaces
  `when` + `fallback`; the two are never saved together. The block's own card is the default and the first rule that
  holds wins. New conditions: `time` (from/to on the clock, may cross midnight) and `alarm_disarmed`. A legacy block
  reads as one rule (`rulesOf`). The editor's Show When lists the rules, with Preview: Live, Default or Rule N.
- **Cameras that follow.** A camera block's Show offers Follow Motion or a Selector (`opts.follow`: `motion` or
  `selector`, with `follow_select`). Motion pairs a camera with the motion, occupancy, moving or presence sensors in its
  area; a sensor that is on beats one that has gone off, then the latest, within 15 minutes. The selector option names a
  camera by its name's start, as the camera strip's does. A block touched within the last minute is left alone.

`grid_blocks_check.py` checks the keypad (side by side, every key inside the block, the arm buttons stacked, the
home's alarm), both vacuum layouts, the rules switching in place (default, music, armed in the window, priority) and a
cameras block following motion from the porch to the yard. It also runs in WebKit at iPad sizes with touch, with no
page errors.

### An iPad scrolled a Home Grid that fits (2026-10-24)

The owner saw the test dashboard scroll on an iPad although everything was visible. The grid is `100dvh` less the tab
bar's room, but the view's minimum height (the rule that answers Kiosk Mode's `hui-view{min-height:100vh}`) used
`100vh`. On an iPad in Safari, `100vh` is the window with its toolbars hidden, so the page was taller than the visible
window by the toolbars' height. The rule, and Home Assistant's own `#view` minimum, now use `100dvh` (with `100vh` for
older browsers). Playwright doesn't reproduce Safari's toolbars, so the owner confirms it on the iPad.

### The calendar block's days, and the room block's hidden accessories (2026-10-24)

The owner asked for more calendar options: how many days to show, scrolling within the block, and events that open
their detail sheet. The calendar block gains `days` (1 to 7; 2, today and tomorrow, when unset). What is still to come
is listed day by day, a later day under its own heading, and the lines scroll inside the plate under the date (the
scroll position survives a redraw). A line is a button that opens the event's sheet (`show`, the HK event sheet when
hk-detail is loaded).

The owner also saw accessories hidden in Hidden Accessories on a room block. The block asked `hkStrategy.roomCards`
for the room without the build's options, so the house's `generated` exclusions (Everywhere, a device, a room) never
applied; only an accessory's `room: false` did. It now passes them, as the room's page gets them.

`grid_blocks_check.py` hides the living room's ceiling light and checks the room block leaves it out, and hands a
seven-day calendar block two events a day: headings from Tomorrow on, the list scrolling inside the block, and a tap
on the last event opening its sheet.

### House App 0.1.71 deployed (2026-10-24)

The owner asked for this release. Release commit `b8d8915` (the keypad and vacuum blocks, rules, cameras that follow,
the calendar's days, scroll and taps, the room block's hidden accessories, and the iPad scroll fix) was pushed and
staged. The update installed on the first request. Strict health is OK with Home Assistant connected, and build
`5237cbfeb53285ed` matches the staged release. There is no Traceback; the only lines matching "ERROR" are Music
Assistant queue warnings from before the restart. Next: the owner checks on the iPad that the test dashboard no longer
scrolls.

### The pages' panels as blocks (2026-10-24)

The owner asked for all six suggestions: power flow, music favorites, doors and locks, the thermostat's full controls,
Live TV and water. Each is `hk-grid-panel-card` (hk-grid-cards.js) with a `panel`, which mounts the page's own card
and reads what it needs live from the settings and states the page reads, so a block follows a change without the
screen being built again. A panel with nothing set up says where to set it up.

| Block | Sizes | What it mounts |
| --- | --- | --- |
| `power` | W, L, XL | W: `hk-power-status-card`, shrunk to fit and laid out wider so it still spans the block. L, XL: `hk-power-house-card` (or `hk-power-flow-card` when the plan has no picture), shrunk to fit and centred |
| `music` | L, XL | `hk-speaker-picker-card` on a plate; it scrolls inside the plate |
| `doors` | L, XL | `hk-security-overview-card` with the house's inventory (`hkStrategy.inventory`, less Hidden Accessories); its 360 px minimum is lifted |
| `thermostat` | XL (new) | the dial (`hk-control-card` at T) in one column; the readings, modes and fan in the other two |
| `live_tv` | L, XL | `hk-tv-guide-card` on a plate; its channels scroll inside it |
| `water` | L, XL | `hk-water-day-card`; XL adds `hk-water-supply-card` beside it, half each |

Some sizes were tried and dropped because the page's card couldn't fit: Doors & Locks at Wide (the overview needs about
290 px) and Water at Wide (the day's chart needs about 190 px). The thermostat sheet itself (`hk-detail-climate`) was
too tall for a block, so the XL block splits the dial from its controls instead.

`grid_panels_check.py` draws every panel against the fictional home, with the Energy power plan, a water meter and
supply, a fan and Live TV channels stood in. It checks that each panel draws inside its block (Music and Live TV may
scroll inside their own plates), that the thermostat's current mode and fan are pressed, and that a block whose
feature isn't set up says so. It was also drawn in WebKit at iPad size with touch, with no page errors.

### Screen types and the Clock block (2026-10-24)

The owner asked for size recommendations for a phone (portrait and landscape), a tablet (portrait and landscape) and
a car, chose Screen Type presets in the editor, and added: a phone on its side is a nightstand clock (Apple's
StandBy as the example), so it wants many clocks, with or without a box, analog and digital; phones don't need the
band or chips by default; and a landscape phone can put the tab bar on the left or right.

**The numbers.** The grid's canvas is `cols × 196 + gaps + 2 × pad` by `rows × 150 + gaps + 2 × pad (+ band)`, scaled
uniformly to the room left by the tab bar and never above 1. Every columns × rows × band choice was scored for each
screen by its scale and the share of the screen it fills:

| Screen Type | Grid | Band | Preview | Scale |
| --- | --- | --- | --- | --- |
| Phone, Portrait | 2 × 5 | off | 390 × 844 | 0.80 |
| Phone, Landscape | 3 × 2 | off | 844 × 390 | 1.0 with a side tab bar (0.77 with it at the bottom) |
| Tablet, Portrait | 3 × 6 | on | 820 × 1180 | 0.98, filling 79%: 6 columns would be 0.64 |
| Tablet, Landscape | 6 × 4 | on | 1180 × 820 | 0.91 |
| Large Tablet | 6 × 5 | on | 1376 × 1032 | 0.98 |
| Car | 6 × 3 | on | 1280 × 720 | 0.94; the car browser's real size is still to be measured |

A type is the grid's columns, rows and band; the editor names the current one, or Custom. Choosing one re-packs the
blocks in reading order (`reflow`). A block wider than the grid, or with no room left, is named in a confirmation
before it leaves the draft. Starters and Start Empty keep the screen's type. Phone, Landscape shows three nightstand
starters in place of the house ones: Big Clock (Classic, XL, no box), Clock and Calendar, and Analog and Weather. The
tab bar's side is the screen's own Tab Bar Position, so the type's note says to set it.

**The Clock block** (`hk-grid-clock-card`) comes in S, W, T, L, XL and XXL. `clock_style` is HK's clock (unset), or
one of the screensaver's faces (hk-saverclock.js), which are sized in container units and so fit a block as they fit a
screen. `bare` drops the plate; HK's clock then takes the header's glow to read on the wallpaper. Poster (it fills its
screen edge to edge) and Glass (a pane of its own) were tried and left out. HK's clock gained sizes for S (the time at
20cqw, so AM/PM fits) and L.

`grid_editor_smoke.py` re-packs a starter onto Phone, Portrait, answers the confirmation and undoes it.
`grid_panels_check.py` draws a bare Classic face and a boxed Small clock on a phone held sideways.

**The nightstand's spacing** (the owner: "the spacing on some of these things is pretty off"). Measured on a phone
held sideways with the tab bar at the left: a rail that shrinks or hides scaled the whole page aside (88%) from its
top, so the grid, which already fits itself, shrank a second time and left 82 px under it against 35 above. Beside a
Home Grid the rail now takes its strip from the grid's width (`room(…, grid)`: `pad`, not `scale`), and the grid fits
the full height: 39 px above and 41 below, and about even at the sides. A screensaver face is sized for a whole
screen, its time about a third of the height, so in a block it scales up until its drawing reaches the block, less a
margin (8% bare, 20% in its box). It is measured again as the block resizes and once the fonts load, and is never
shrunk.

**Icons Only** (the owner: "an icon only mode for the navbar"). A new tab bar setting, `tab_bar_labels` (house
`menu.bar_labels`): `show` or `icons`, through the same places as Tab Bar Size (model.py, changes.py, the settings
model and page, hk-base.js's menu defaults and the strategy's live keys). Icons Only hides the names, takes 10 px off
the bar's thickness (`step()`: a rail narrower, its tabs shorter) and draws the icons 2 px larger. Each tab now carries
its name as `aria-label`. `grid_panels_check.py` checks the rail's names are hidden but labelled, and that the grid
beside it keeps the full height.

### House App 0.1.72 deployed (2026-10-24)

The owner asked for this release. Release commit `ed96d4d` (the pages' panels as blocks, Screen Types, the nightstand
starters and spacing, the Clock block's faces, and the tab bar's Icons Only) was pushed and staged. The update
installed on the first request. Strict health is OK with Home Assistant connected, and build `195485553478bce8`
matches the staged release. No log line matches "Traceback" or "ERROR". Next: the owner checks the iPad scroll fix
and a phone on its side, and the car browser's usable size is measured to confirm the Car type.

### The card list scrolls under a finger (2026-10-24)

On an iPad the card list "keeps thinking I want to move a card". Each row was `touch-action: none` and picked a card
up on any 5 px movement, so the list scrolled only from the gaps between rows. A row is now `pan-y`: a finger moving
mostly up or down scrolls the list. A card is picked up by a drag mostly sideways (towards the grid; |dx| > 1.2 |dy|
past 8 px) or by a hold of 350 ms, after which it can go any way. The row lifts while it is carried, and a non-passive
`touchmove` keeps the list from scrolling under it. A tap opens the preview as before, and a mouse is unchanged.
Blocks on the grid still pick up at once: the grid never scrolls.

`grid_editor_touch_check.py` uses Chrome's real touch input: a touch scroll of the list moves it 300 px and adds
nothing; a sideways drag and a hold carried down and then over each place a card; a tap opens the preview. Against
the editor before this change, the scroll step fails (0 px). WebKit wasn't run with touch: Playwright's WebKit offers
taps, not touch drags.

### Hide Box, Show Boxes and Fill the Screen (2026-10-24)

From the nightstand review against StandBy: a black background is the screen's own choice already (Background →
Color → Black, the Sky's animations off), so nothing new there. What was missing:

- **Hide Box**, a block's `bare: true`, and the screen's `boxes: false`. The block's cell gets `data-bare`, which sets
  `--hk-block-*`. Only a card's or a panel's plate (`hkCards.plate('card' | 'panel')`) reads those variables: clear,
  no edge, no shadow, and `--hk-glass-surface` 0, so the shared blur leaves it out. A first try overrode the look's
  own variables (`--hk-plate-here` and the others), and the room's speaker tile and the thermostat's mode track lost
  their surfaces too. A tile's plate never reads `--hk-block-*`. The clock reads `--hk-bare` for its glow. The Clock
  block's own `opts.bare` from 0.1.72 still works, and the editor moves it to the block's Hide Box.
- **Fill the Screen**, the grid's `grow: true`: the fit's cap of 1 is lifted, so a grid smaller than its screen grows
  to fill it. The phone screen types turn it on.
- The nightstand starters draw without boxes. Clock faces now follow the screensaver's 24-Hour Clock: the old test
  read the house clock, which is always `HH:MM`, so they showed 24-hour time. A face too big for a Tall block (the
  analog dial) is scaled down to fit, and the block clips it rather than the face's own box.

**Month View and Big Temperature.** The Calendar block's `month` draws the month: its name in the calendar's red,
the week's initials, and a 5 or 6 row grid sharing the block's height. Today is circled, a day with an event gets a
dot, and it reads the weeks the grid shows. A day is a button that opens the Calendar page at that day (`?day=`, as a
calendar notification's Go To does). The Weather block's `big` draws the place, the temperature at
`min(44cqh, 30cqw)`, the condition and today's high and low. The new Tall size is always drawn big. The nightstand
starters use both.

**Sheets on a phone held sideways (844 × 390), not yet designed for.** A light's sheet runs its slider past the
sheet's foot. The event sheet's two columns are squeezed into 358 px, its mini month cut off. The Calendar page's Day
view works, with about three hours in view. The sheets size by width (the phone breakpoint is 640 px wide), and
nothing yet answers a screen this short.

### Detail sheets on a short screen (2026-10-24)

On a phone held sideways (844 × 390) every sheet scrolled, by 114 to 322 px: the sheets sized by width alone (the
phone breakpoint is 640 px wide), so a short landscape screen got the tablet's 680 px sheet capped at the screen
less 32 px. `SHORT_MQ` (landscape, under 500 px tall, wider than a phone) now gives:

- **The frame**: the screen's height less 12 px a side, the sheet 120 px wider than its tablet width, 16 px padding
  on every side (so the X is 17 px from the top and the right, as the phone's is equal), and the phone's 40 px
  header, glyph, X and title. These are the phone's own rules, shared with `@media (max-width:640px), SHORT_MQ`
  rather than repeated, so the design-scale tests (corners, type) stay where they were.
- **Two columns** for a sheet with a control (`TWO`: a panel holding the slider, the switch, the shade, the lock,
  the disc, the glyph, the dial or the player). The control is on the left at the body's height (`--hk-short-h`).
  What it reads and its buttons are centred beside it by a flexible row above and below (`::before`, `::after`).
  There is no row gap, because an empty row would still take one: the pieces are 12 apart by their own margins. A
  slider with only its reading (a dimmable light, a fan, an outlet, a lock) is one centred pair, not a reading lost
  in a wide column.
- **Their own layouts**: the thermostat's ring alone on the left, measured to the body (`_fitShort`: the card's
  height less the ring's, the ring 0.866 as tall as wide), with its modes, fan and readings in the side column
  (`_sideRows`; the card's own rows hidden by `--hk-tstat-rows`). Media is the cover at the body's height, with the
  track, transport, volume and Browse Music centred beside it in a 760 px sheet. A sensor is its reading over its
  stats, beside its range over the chart, the plot's height what the body leaves. An event is the event card and
  its details beside its day, without the mini month or Color (set from a taller screen), the day as "Sat, Oct 24".
  The vacuum's commands and a colour light's swatches are a step smaller to sit inside the column.
- In passing, the event's hours open 12 px above the hour before it, so that hour's label is never cut in half under
  the day's header (every screen).

`sheet_short_check.py` opens 15 sheets at 844 × 390 and 667 × 375, and at 1180 × 820 and 390 × 844 to hold those as
they were. Each must be inside the screen with a 7 px margin, keep every control 12 px inside its padding, keep the
X as far from the top as from the right, and scroll 2 px at most. All 60 pass. In WebKit at 844 × 390 the light,
thermostat and media sheets fit with nothing to scroll. Its "ResizeObserver loop" message is logged as the page loads
and was there before this change.
