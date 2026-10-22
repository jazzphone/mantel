# Phase 11: Home Grid — a tablet Home page you arrange (plan, 2026-10-22)

The ask: a tablet Home page that **never scrolls**, laid out on a grid, where the size and place of each card
follow how often it is tapped (concept A, "Tap Weight", and C, "Glance Up, Touch Down", on the concept canvas:
https://claude.ai/artifact/JnMmSXDneGVE1e81BWYuid, A preferred). An Owner or Admin **arranges it on a desktop**,
using HK's own cards. A block can hold **several pages** that swipe: cameras, rooms, thermostats, scene pages.
Mantel first; HK Frontend as well, which comes at little extra cost (below).

**Status: G1 done (2026-10-22, `d7e2287`). G2, G3 and G4 in progress (2026-10-22), side by side, each in its own session; each keeps its own subsection under "Progress". No release.** See "Progress", at the end.

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
  The rows share the height under the top band, about 162 px each.
- **Top band** (optional, on by default): the screen's existing header (clock, weather, chips, people), at 60 px.
  Off gives the grid the whole height (concept C puts its glance cards in the grid instead).
- A tablet always fills its own screen (`100dvh`), keeping the grid's columns and rows; the frame is the editor's
  (decision 2, under "Progress").
- **No scrolling, ever.** The view is `height: 100dvh; overflow: hidden`. A card that cannot fit its cell clips
  its own contents. It never grows the page.

### The tab bar (added 2026-10-22)

The screen's **tab bar** (`web/hk/modules/hk-tabbar.js`) is a Home Grid screen's primary menu and navigation, as
on every other screen: its pages, the rooms and the full menu. The grid works around it:

- **The grid stops at the bar.** The view's height is `calc(100dvh - var(--hk-tabbar-h, 0px))`, where
  `--hk-tabbar-h` is the room the bar reserves (set on `<html>` while it shows). The rows share what's left under
  the top band, so cells are shorter than the numbers below whenever the bar shows. Cards read their cell from
  `--hk-cell-w` / `--hk-cell-h`, never from fixed numbers. The view follows the bar showing or hiding. (G4 makes
  this change in `hk-layout.js`.)
- **Nothing sits under the bar**, and a pager never claims a drag that starts on it.
- **`everything` is for screens without a tab bar.** With the bar on, it already opens the pages and the menu, so
  `everything` is an optional S card for a screen whose bar is off. It opens the same menu, through the shell's
  navigation. The starter layouts leave it out while the bar is on. (G3.)
- **The render audit** (G2) runs with the bar showing, the usual case, and once with it hidden.
- **The editor** (G5) draws the bar in the frame, as the tablet shows it, so the grid is arranged in the space that
  is really there.

### Size classes

| Class | Cells | At 1280 × 800, 6 × 4 |
|---|---|---|
| S | 1 × 1 | 196 × 162 (less with the tab bar showing) |
| W | 2 × 1 | 402 × 162 |
| T | 1 × 2 | 196 × 334 |
| L | 2 × 2 | 402 × 334 |
| XL | 3 × 2 | 608 × 334 |

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
   (`100dvh`), keeping the grid's columns and rows. No letterboxing. (This replaces "scales its cells to fit" above.)
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

### G2 (2026-10-22, in progress)

**The render audit's Home Grid pass:** `tools/headless/home_grid_audit.py`. A real Mantel Server with the gallery's
fictional house (`tools/headless/gallery.py`), headless Chrome at 1280 × 800, a 6-column grid. Each card gets a
screen per look, its Home holding the card once at every size it has (XL, L and T across the top, W and S below).
The four looks: Flat Light, Flat Dark, and Blur under a day sky and a night one. (On HK's own screens a card is
white on the sky, never light: `tone()` in hk-base.js; so Blur's light and dark are the sky's.) It measures, in each
block's cell, every text node's box (inside the cell, and not cut off unless an ellipsis ends it), every icon,
picture, button and control (inside the cell), that the card's plates cover the block, and no page scroll and no
script error. `--long` names every thing at twice its length.

**Text scale:** HK draws its type roles in px (`hkCards.TYPE`) and a tablet's text size never reaches them (the
Mantel app's web view sets `-webkit-text-size-adjust:100%`), so there is one
scale and the audit runs at it. PLAN-2026-10-12-text-scale is the ink colours, not sizes. The `--long` pass stands
in for larger text.

**Shared:** hk-base.js: an HkBase card watches its `size` attribute and is rebuilt when it changes (`_cellSize()`
reads it); `BASE_CSS` makes a sized card and its root the block's height; `hkCards.typeCss(role)` writes a type
role as declarations.

**Done** (audited: every size, four looks, nothing clipped):

| Card | Sizes | Layout |
|---|---|---|
| `accessory` | S, W | the tall tile's layout (glyph at the top, name and state at the foot), filling the block |
| `scene` | S, W | the same, the scene's bare glyph and two-line name |
| `scenes` | W, L, XL | a scene tile per cell: W two, L four, XL six; no heading |
| `now_playing` | W, T, L | W the cover beside the song and transport; T the cover on top; L the cover beside the song and its speaker, a larger transport along the foot. No progress or volume (the sheet has them) |

**Left:** thermostat, camera, security, timers, weather, calendar, battery, people, vacuum, clock.

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
- **`tablet_room`** is `hkGridCatalog.tabletRoom(client)`: `hkSettings.tablet(client).room`, the settings' own
  answer to "which tablet is this", never `hass`. G3 can use it for its options.
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
