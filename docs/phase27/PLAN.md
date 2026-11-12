# Phase 27: The Home block and its sheet (plan, 2026-11-12)

**Status: a plan and a mockup, nothing built.** Waiting on the owner's three decisions below.

- **Mockup:** [mockup/home-sheet.html](mockup/home-sheet.html). Open the file: it stands alone, with the fictional
  house and made-up states, and touches nothing in the house. Published for review at
  https://claude.ai/artifact/HBGLwXZQJuhTMNE8cUsgiu (private to the owner).
- **Line numbers** are left out on purpose, because `main` moves. Search for the names.

## The ask (the owner, 2026-11-12)

From a screen recording of Apple's HomeView on the speaker-stand display: the second row's first tile is a bare house
glyph. A tap opens a sheet holding the Home app's own Home page, the generated one: the house's name at the top, the
time at the right, then each room as a heading ("Kitchen ›") over its accessories as pills, two across on that
square screen. "This would be a great add!"

## What the recording shows

The clip is 9 seconds (2532 x 1844 at 60 fps).

1. **0.0-1.5 s.** The HomeView grid on the stand: a 3 x 3 of square glass tiles over an orange wallpaper. Row two,
   column one is the house glyph alone, with no name under it. The design spec already allows this ("a glyph-only tile
   (the house) | allowed for a block that is only a way somewhere", HomeView table).
2. **1.5-1.8 s.** A tap. The sheet grows out of the tile and covers the whole screen, with large round corners. The
   grid stays under it, blurred.
3. **1.8-2.6 s.** The sheet is the Home page in the light appearance. The title is the house's name, centered, with
   the time at the right. A room heading has a chevron, and the room's pills sit two across: the Home app's wells
   (yellow for lights, teal for shades), and gray for things that are off.
4. **2.6-3.2 s.** A tap on the right of the sheet. The clip does not show what was tapped; it was above the visible
   part, most likely the Security chip. The content cross-fades in place into the **Security** page: an X at the top
   left, the title "Security", status chips under it ("2 Disarmed", "4 Unlocked"), two security scenes, then each room's locks, doors and alarm.
5. **3.2-5.6 s.** A tap on a lock. It opens its own full-sheet control, which is green and reads
   "Unlocked".
6. **5.6-9 s.** A phone beside the real lock. This part is about the lock, not the screen.

So it is **the generated Home page in a sheet**, with its chips and rooms leading further inside the same sheet.

## What Mantel already has

Most of this exists. The work is mostly joining parts that already work.

| Part | Where | What it gives |
|---|---|---|
| The generated Home page | `web/hk/strategy/hk-strategy-views.js`, `views()`: `home = [header, strip, scenes, favorites, rooms...]` | the chips, scenes, favorites and every room section, in the house's order |
| A room as a section | `hk-strategy-rooms.js` `roomSection` | "Room ›" over its pills |
| The category pages | `hk-strategy-pages.js` `categoryPages` | Security, Climate, Lights... |
| A room in a sheet | `web/hk/cards/hk-room.js`, `hk-detail-room`, `hkRoom.openSheet(area)` | a sheet drawing `hkStrategy.roomCards`, 864 px wide (four pills), back from a sheet opened inside it via `hkKeepBack()` |
| A block's sheet | `hk-grid-catalog.js` `sheetSlot`, the `tap_target` option (`auto`, `page`, `sheet`, `none`) | When Tapped on every block |
| The sheet frame | `web/hk/sheets/hk-detail-frame.js` | the one sheet height (680 on a tablet, 643 on a phone), the X, the scroll shadows, focus |

On a Home Grid screen the generated Home list is replaced by the grid (`out[0] = view(homeGridView(...))`), so today
that screen has no way to see the house as the Home app's list. This block brings it back on demand.

## What to build

### 1. The Home block (`home`)

A new Home Grid catalog key, in `hk-grid-catalog.js` and its mirror `hk_core/settings/home_grid.py` `CATALOG` (a test
holds them equal).

- **Small:** the house glyph alone, centered on the optical center, with no words. This is the HomeView reference tile.
  On the Home style (not Centered), the same glyph in the Home app's 42 px well, as every Home-style block has it.
- **Wide:** HomeView's tile laid sideways: the glyph at a quarter of the width, the house's name (600) over one status
  line (400, second ink). The line is the house's most useful summary, in the chip row's own order: "2 unlocked ·
  3 lights on". It reads the same counts the chips already compute, so it never disagrees with them. With nothing to
  report it reads "All quiet".
- **Options:** a Name (the house's name by default). A tap always opens the sheet: a Home Grid screen has no
  generated Home page to go to, so When Tapped has nothing else to offer here.
- **Glyph:** the house glyph from the house's glyph file if it has one, else `mdi:home-outline`, chosen once in
  `hk-icons.js`. The repository's own glyph set has no house today.
- Nothing stretches: Small and Wide only, as Intercom has. A bigger Home would be the sheet's job.

### 2. The Home sheet (`hk-detail-home`)

A panel like `hk-detail-room`, drawing new `hkStrategy.homeCards(client, opts)`:

- **What it draws:** the generated Home's own list, minus the clock and weather header, which the grid already shows.
  In order: the chip row, Scenes, Favorites, then every room section. `homeCards` is cut out of `views()` so the
  generated Home and the sheet share one list. The car home's Security section stays a car-only part.
- **Header:** the sheet frame's own: the X at the top left, and the title (the house's name, from Home Assistant's
  `location_name`) in the middle. It has no clock, because the frame has none and the grid shows the time.
- **Size:** the Room sheet's: 864 px wide (four 196 px pills, 10 apart), the one sheet height, 680 px on the tablet.
  On a phone it is one column at the phone height (643), two pills across, as the Room sheet is.
- **Wells:** kept. DESIGN.md (2026-11-12): sheets and the generated pages keep the Home app's wells; only the Home
  Grid's own HomeView blocks drop them.
- **Live:** the cards bridge the client as the Room sheet's do (`hkSetClient`), so a light turned on elsewhere lights
  here. They are not rebuilt on every state change; they are rebuilt only when the signature of rooms and entities
  changes, as `hk-detail-room` does.

### 3. Going further inside the sheet

This is the part the recording shows at 2.6 s.

- **A chip** (Security, Climate, Lights, Speakers) shows that category's page inside the sheet: its cards from
  `categoryPages`, through a new `hkStrategy.pageCards(client, path)`.
- **A room heading** ("Kitchen ›") shows that room inside the sheet, with the same cards `hk-detail-room` draws.
- **The header on an inner page:** the X stays where it is and closes the whole sheet. A back key ("‹ Home", the
  standard 40 px pill) appears right of the X, and the title becomes the page's name. The rule stands: the X and the
  name are always in the same place.
- **Motion:** the inner page slides in from the right on `standard` (.34 s) and back out to the right. With Reduce
  Motion it is a cross-fade (`fade`, .2 s), which is what the recording shows.
- **A pill** opens its accessory's sheet on top, as everywhere. Back returns to the page inside the Home sheet at its
  scroll position, through `hkKeepBack()`.
- **One level deep.** A chip inside an inner page (Security's own "4 Unlocked") filters in place as it does on the
  page. It does not push again.

### 4. Settings, the MCP and the docs

- Home Grid's editor: the block in the catalog under "Home", with its two sizes and two options.
- `grid_cards` (the MCP) lists it, because it reads the catalog.
- DESIGN.md: only with the owner's OK. The HomeView section's table already allows the glyph-only house tile. The
  Sheets section would gain one paragraph on pages inside a sheet (the back key, the slide).
- The fictional house in `tools/headless/gallery.py` gets a Home block on its HomeView screen, for the screenshots.

## Checks

- `tests/test_hk_core_home_grid.py`: the catalog keys equal on both sides; the new options accepted and refused.
- A headless check, `tools/headless/home_sheet_check.py`, in WebKit and Chromium at 1280 x 800, an iPad (1180 x 820)
  and a phone (390 x 844). It covers: the block at Small and Wide on square cells and tiles; the sheet open; a chip
  pushed and back; a room pushed and back; an accessory sheet over an inner page and back to the same scroll; Reduce
  Motion's fade.
- `sheet_review.py` gains the Home sheet, so it is in the 8-size contact sheet.
- `house_twin.py render --js "hkHome.openSheet()"` on the house's own screens, because a real house has more rooms
  than the gallery.
- Keyboard: Tab stays in the sheet through the inner pages; Escape on an inner page goes back, and on the Home page
  it closes.
- `tools/ci.py quick`, then `full` from a worktree on local disk.

## Not in this plan

- **The sheet growing out of the tile** (the recording's zoom at 1.5 s). Every Mantel sheet rises and fades in today
  (`translateY(24px) scale(.98)`). A zoom from the opener would be a change to every block's sheet, so it belongs in
  its own plan if the owner wants it.
- The full-screen green lock control (5 s). Mantel's lock sheet is its own design.
- The light appearance the recording happens to be in. The sheet follows the screen's look like every sheet.

## The owner's decisions

1. **The sheet's size.** The Room sheet's 864 x 680, four pills across, which is **recommended** because it matches
   the Room sheet and the drill-in is that same sheet. The alternative is near full screen as Apple's is: 1264 x 784, six
   pills across, on a 1280 x 800 tablet. The mockup has a switch for both.
2. **Chips and rooms inside the sheet**, with a back key, which is **recommended** and is what Apple's does. The
   alternative is that they go to the screen's own page and close the sheet.
3. **Sizes.** Small (glyph only) and Wide (name and status line), which is **recommended**. The alternative is Small
   only, as Apple's.

## Build order

One session, Opus 5.5 Medium; agents on Sonnet 5.5.

1. `homeCards` and `pageCards` cut out of `views()` / `categoryPages`, the generated Home unchanged (a test compares
   its cards before and after).
2. The `home` catalog key on both sides, the Small and Wide card, the editor's options.
3. `hk-detail-home`, its header, the chip and room push, Back, Reduce Motion.
4. The headless check, `sheet_review.py`, the twin on the house's screens; screenshots to the owner.
