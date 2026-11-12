# Phase 27: The Home block and its sheet (plan, 2026-11-12)

**Status: built (2026-11-12), on `main`, not on the house.** All three decisions were answered on 2026-11-12: the Room
sheet's size, chips and rooms inside the sheet, and all five block sizes. "As built" below says where the build differs
from this plan, and why.

- **Mockup:** [mockup/home-sheet.html](mockup/home-sheet.html). Open the file: it stands alone, with the fictional
  house and made-up states, and touches nothing in the house. Published for review at
  https://claude.ai/artifact/HBGLwXZQJuhTMNE8cUsgiu (private to the owner).
- **Line numbers** are left out on purpose, because `main` moves. Search for the names.

## As built (2026-11-12)

- **Files:** the block and the sheet are `web/hk/cards/hk-home-block.js` (`hk-home-block-card`, `hk-detail-home`), loaded
  on first use (`hk_cards.py` LAZY). The catalog key `home` is in `hk-grid-catalog.js` and `home_grid.py`, with a Name
  (`title`) and Glyphs. The editor lists it first under Rooms & Lights.
- **The sheet's list is `views()`'s own, not a cut-out.** `hkStrategy.homeSheet(client)` (`hk-strategy-views.js`) runs
  `views()` for this screen with its Home set to the generated one. It takes Home's cards less the header's clock and the
  pop-ups, the chip row without its menu key (`lead: false`), and each room page's cards less its title bar. The
  generated Home itself is untouched, so the before-and-after test step 1 asked for isn't needed: the same function
  builds both.
- **Only the rooms open inside the sheet (the owner, 2026-11-12, after trying it).** He found a chip's page inside the
  sheet "not the best place for it", and had read "inside the sheet" as meaning the chips themselves are inside it. So
  a chip and "Cameras ›" go to the screen's own page, as they do everywhere, and the sheet goes as the screen moves. A
  room's heading still opens the room inside the sheet. The block does the same: its categories go to their page, as
  House Status's do, and its rooms open the sheet at that room.
- **One hook keeps a room inside the sheet.** `hkCards.navigate(path, el)` (`hk-base-card-core.js`) first asks any
  ancestor with `hkCatchNav(path)`, across shadow roots. The Home sheet answers yes for a room's page and no for any
  other, so the room headings open inside it with no change to those cards.
- **The back key** is "‹ Home" at the start of the header, where every Mantel sheet has its back key
  (`hk-detail.js`), not beside the X: the frame's X is at the top right.
- **The glyph** is `hk:homekit`, Apple's Home symbol (SF Symbols' `apple.homekit`: the house with a smaller house inside
  it), as HomeView's house tile has it. The owner asked for it on 2026-11-12 ("is there any way to match the one in the
  screenshot/video"). It comes from the house's glyph file; without one, Material's `home-outline` stands in
  (`hk-icons.js` MDI_ALIAS). Small's glyph is half the block's shorter side, so its ink spans about 44% of the tile, as
  Apple's does. The owner, after trying it: "could probably be a bit bigger".
- **The rooms' readings** are the Room block's own short line (`hkGridCards._.roomLine`), plus "Unlocked" and "Open".
  Their glyphs come from the area's icon, else the sofa, as the Room block's do.
- **House Status's shared parts** are `window.hkHouseStatus.parts`. That covers its headline and sentence (`summary()`,
  which House Status now calls too), the chip model's mixin, a section's glyph, colors and words, `lines()` and
  `headline()`.
- **The size** is five pills across (decision 1 below), `hkWidthKind()` 5 x 196 + 4 x 10 + 48 + 2 = 1070.
- **Sideways:** the sheet clips sideways (`overflow-x: clip`), because the camera mosaic's row bleeds 22 px past its
  column, as it does on the page.
- **Checks:** `tests/test_home_block.py` covers the pure part, both catalogs, the saved layout and the wiring.
  `tools/headless/home_sheet_check.py` (WebKit and Chromium) covers every size of block on square and tile cells, each
  tap opening the sheet at its place or going to its page, the sheet at 1280 x 800, an iPad and a phone, a room inside
  it and back, an accessory opened there and back, a chip and Cameras going to their page with the sheet, Escape, Reduce
  Motion's fade, a car's screen, and no command. The Home sheet is in `sheet_review.py`; the review now cuts a box to its nearest sideways clip, as it is
  painted.
- **Not done:** the gallery's Wall Display is a starter layout, and a block there would move every doc screenshot of it,
  so the new check's own screens on the fictional house show the block instead. DESIGN.md is unchanged: the owner says
  when.

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
| The generated Home page | `web/hk/strategy/hk-strategy-views.js`, `views()`: `home = [header, strip, scenes, favorites, rooms...]` | the chips, the camera strip, scenes, favorites and every room section, in the house's order |
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
- **Tall, Large and Extra Large** (the owner, 2026-11-12: "If you could do all sizes that would be great...and as it
  gets bigger, more data of the house can be placed on it. Maybe it's a mixture of This and Home Status?"). From Tall
  up, the block speaks House Status's language (docs/phase11/HOUSE-STATUS.md, `hk-house-status.js`): the house's name
  as the label (19 px row, 8 under it), the one thing that matters most as the headline in words ("Back Door
  Unlocked", "All Good" in green), the rest as a sentence ("3 lights on · 1 playing · 66–69° inside"), and lines of
  56 px that scroll inside the block, with no "+N more". Bare glyphs, no wells (HomeView). The headline is upper
  left at every size. What House Status doesn't have is the rooms, so the bigger sizes add them:
  - **Tall:** the label, the headline, then the categories as lines with the reading under the name (Security
    1 Unlocked, Lights 3 On, Climate 66–69°, Speakers & TVs 1 Playing).
  - **Large:** the label, the headline and its sentence, the categories as one row of standard pills (glyph and
    reading, 40 px), then the rooms as lines: the room's glyph, its name, and its reading at the right ("68° · 1 on",
    "1 on · Unlocked", "All off").
  - **Extra Large:** a column of its own for the label, the headline, the sentence and the category lines; the rooms'
    lines beside it.
  - **Every part is a way in:** the plate opens the sheet at Home, a room opens the sheet at that room, and a category
    goes to its own page as its chip does (changed 2026-11-12, decision 2). Nothing in the block turns anything on or
    off, as with House Status.
- **Home and House Status stay two blocks.** The headline, sentence and category readings come from the same
  `hkChip.status` model House Status draws, so the two never disagree; the Home block's own part is the rooms and the
  sheet. A screen with a Large or Extra Large Home rarely needs House Status beside it. A screen that wants only what
  needs a look keeps House Status. The shared parts (label, headline, sentence, line) move into one place both files
  use, not a copy.

### 2. The Home sheet (`hk-detail-home`)

A panel like `hk-detail-room`, drawing new `hkStrategy.homeCards(client, opts)`:

- **What it draws:** everything a generated dashboard's Home draws, minus the clock and weather header, which the grid
  already shows (the owner, 2026-11-12: "it looks like the Home Button actually loads what a generated dashboard would
  load...Cameras, Scenes, Favorites as well"). In the generated Home's own order: the chip row, the camera mosaic
  (`cameraStrip`: "Cameras ›" over `hk-camera-mosaic-card`, one live 16:9 tile then stills in 4:3 columns, 195 px
  high, scrolling sideways; where the house has cameras and the screen has the strip on), Scenes, Favorites, then every
  room section. `homeCards` is cut out of `views()` so the generated Home and the sheet share one list, and anything
  the generated Home gains later shows up in the sheet too. The car home's Security section stays a car-only part. A
  camera in the mosaic opens its own live sheet on top, as on the generated Home, and Back returns to the Home sheet.
  The mosaic keeps its sideways scroll in the sheet: it fetches only the cameras on screen, which on a 4 GB wall
  tablet is the point (`hk-cameras-mosaic.js`).
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

This is the part the recording shows at 2.6 s. **Changed 2026-11-12 (decision 2): only the rooms go further inside.**

- **A chip** (Security, Climate, Lights, Speakers) goes to the screen's own page, as chips do everywhere, and the sheet
  goes with it. (Planned at first: the category's page inside the sheet.)
- **A room heading** ("Kitchen ›") shows that room inside the sheet, with the same cards `hk-detail-room` draws.
- **"Cameras ›"** goes to the screen's Cameras page, as a chip does.
- **The header on an inner page:** the X stays where it is and closes the whole sheet. A back key ("‹ Home", the
  standard 40 px pill) appears right of the X, and the title becomes the page's name. The rule stands: the X and the
  name are always in the same place.
- **Motion:** the inner page slides in from the right on `standard` (.34 s) and back out to the right. With Reduce
  Motion it is a cross-fade (`fade`, .2 s), which is what the recording shows.
- **A pill** opens its accessory's sheet on top, as everywhere. Back returns to the page inside the Home sheet at its
  scroll position, through `hkKeepBack()`.
- **One level deep.** A room's page that leads to another room's replaces it in place; Back is always Home.

### 4. Settings, the MCP and the docs

- Home Grid's editor: the block in the catalog under "Home", with its two sizes and two options.
- `grid_cards` (the MCP) lists it, because it reads the catalog.
- DESIGN.md: only with the owner's OK. The HomeView section's table already allows the glyph-only house tile. The
  Sheets section would gain one paragraph on pages inside a sheet (the back key, the slide).
- The fictional house in `tools/headless/gallery.py` gets a Home block on its HomeView screen, for the screenshots.

## Checks

- `tests/test_hk_core_home_grid.py`: the catalog keys equal on both sides; the new options accepted and refused.
- A headless check, `tools/headless/home_sheet_check.py`, in WebKit and Chromium at 1280 x 800, an iPad (1180 x 820)
  and a phone (390 x 844). It covers: the block at every size on square cells and tiles, a category and a room in it each opening the sheet at that place; the sheet open; a chip
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

1. **The sheet's size: five pills across, 1070 x 680 (2026-11-12, changed after trying it).** First agreed as the Room
   sheet's 864 x 680, four across. On the house the owner asked whether it should fill the screen; full screen would add
   only one column (six don't fit in 1280 with the padding) and about a row, hide the grid and break the one sheet
   height. So the sheet is one pill wider than the Room sheet, at the same height. It is never wider than the window:
   five across at 1280 and 1180, four in a 1024 px window, three on an iPad upright, two on a phone.
2. **Chips go to their page, rooms open inside the sheet: agreed (2026-11-12).** First answered "Inside the sheet", and
   built that way. After trying it the owner found a chip's page inside the sheet "not the best place for it": he had
   read "inside the sheet" as the chips being inside it. So a chip and Cameras go to the screen's own page, the sheet
   with them, as chips do everywhere. A room's heading still opens the room inside the sheet, with the "‹ Home" key.
   The chips stay together at the top of the sheet.
3. **Sizes: all five (2026-11-12).** Small, Wide, Tall, Large and Extra Large, from Tall up the House Status mixture
   above, laid out as the mockup's "Every size" strip shows.

## Build order

One session, Opus 5.5 Medium; agents on Sonnet 5.5.

1. `homeCards` and `pageCards` cut out of `views()` / `categoryPages`, the generated Home unchanged (a test compares
   its cards before and after).
2. The `home` catalog key on both sides, every size, the editor's options; House Status's label, headline, sentence
   and line moved to one shared place first, House Status unchanged (its check, `house_status_check.py`, passes as before).
3. `hk-detail-home`, its header, the chip and room push, Back, Reduce Motion.
4. The headless check, `sheet_review.py`, the twin on the house's screens; screenshots to the owner.
