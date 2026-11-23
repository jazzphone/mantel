# Phase 34: Every Home Grid card in one kit, with a way back (plan, 2026-11-22)

**Status: the first cards built (2026-11-22).** The owner: "Lets go ahead and implement - the TV Cards ... The house
status cards. The One Now Cards. The Recent Cards. The Vacuum Cards, but for these, i'd rather the icon animation be more
front and center, with there being a Rooms button with a pop up for which rooms you want to select and clean. No need to
have all the rooms on display. The Alert cards", then "You can also add the security cards too!", "the thermostat cards as
well", and of Timers: "I also don't like them separated into separate tiles... any way you can take the best of both and
combine them?" So New covers, first: TV, Security, Thermostat, Timers, House Status, On Now, Recent, Vacuum and Alert; every
other card draws Current on a New screen until it has its own. The switch (`card_design`), the kit (`hk-kit.js`) and the
block-taps check's New pass (every block opens from its plate what Current's opens) are in.

- Line numbers are left out on purpose: search for the names.
- The review page every decision below was made on: https://claude.ai/artifact/VW9DVM3ZipfFEgzrwT6Gj4 (rounds one to
  eleven, 2026-11-22). Its code is a mockup kept out of the repository (it draws a real house and Apple's own glyphs and
  App Store icons); the session that builds this reads the page, not the mockup's code.
- Phase 32's "rules every page follows" and [Building for slow tablets](../development/Slow-tablets.md) bind every card
  touched here. DESIGN.md (the owner's design spec) is read before each step and brought up to date only when the owner
  asks (below, "DESIGN.md").

## The ask (the owner, 2026-11-22)

> I'd like to do all the cards, across all appearances/styles...but if you finish and it just doesn't look great...can I
> go back to the cards we have in place today?

Before it, over the review: bigger touch areas on every card, in HomeView's language, "cohesive, and work together from
a design standpoint ... speak the same language", "close attention to margins/padding/spacing ... that radius follows
through the cards too".

## The way back: a Card Design switch, Current by default

The new cards are built **beside** today's, never over them, and a screen chooses which it draws:

- **Appearance → Card Design: Current / New**, on a screen's page and at All Screens (a screen follows All Screens
  unless it sets its own, as every Appearance row does). Stored as `card_design` (`current` | `new`), checked in
  `hk_core/settings/changes.py` like `tile_style`. **Current is the default**, so no screen changes until the owner
  switches it; switching back is the same row, and takes effect on the next draw (no reload, no release).
- **Today's card code is not edited** by this phase, except to ask which design to draw: a card whose screen says
  Current draws exactly what it draws today. A test pins that (below, "Checks").
- **Releases are tagged** as always (vX.Y.Z), so a release can also be rolled back whole; the switch is the everyday
  way back, the tag the last resort.
- **When the owner has decided**, the losing design is removed in a change of its own (and the switch with it), so the
  repository doesn't carry two designs for longer than the trial.

## What the kit is (the decisions taken on the review page)

One shared module, `web/hk/modules/hk-kit.js`, holds the parts; every new card is built from them and nothing else.

| Part | What it is | Measures (design px, on a 196 cell) |
|---|---|---|
| Edges | Words on the 18 inset; shapes inside a card (keys, covers, app icons, pictures, the alarm's tile) on the 13 edge | |
| Corners | Concentric: a shape on the 13 edge takes the card's corner less 13 | Card 34, inner 21; a round remote pad on the same edges |
| Type | Four styles and a hero, nothing else | Display 24/700 · Title 20/600 · Body 18/400 · Label 15/600 · Hero 64 (52 on short cells), 500, tabular |
| Header | Every plate starts the same: title at 18, body at 42; 300 px and wider, a 28 glyph leads; "N more" at the right end of a list | Content from 74; a Wide plate with only a header and keys centers the header in the room above the keys |
| Key | The only control shape: apps, rooms, the remote, the transport, Clean, All Off, Close It, a mode | 64 tall, corner 21, 8 apart, edge to edge; the foot row 13 from the bottom; chosen = white (near-black on a lit plate) |
| Row | Every list, every set of figures, every forecast day, Security's members | 60 tall (rows sharing a card's height divide it evenly); lead on the 18 inset, words 12 after it; a hairline under all but the last |
| Reading row | House Status and On Now: the name left, the reading right; at rest quieter with a gray glyph | On a narrow card the reading goes under the name |
| Lit | One device that is on (a TV, an alert holding, a tile) is white with dark words | Keys on white: 6.5% black |
| App icon | The Apple TV's own App Store icons (`/api/tv/icon/<app>`, as the TV card has them); the open app's icon is the TV's picture and plays and pauses | 64 at least; 80 on Large |
| Small | Every card at one cell is HomeView's centered tile | DESIGN.md's centered tile |
| White glyphs | The screen's Glyphs option set to White turns a glyph white only at rest; anything on or needing you keeps its color | App icons, covers, rings and calendar colors are pictures, not glyphs |

## The cards (every size each has today)

| Card | New design | Sizes |
|---|---|---|
| Accessory, Scene, Action, Intercom | HomeView's centered tile; Wide its sideways tile | XS, S, W, T (as each has) |
| Accessories, Scenes, Suggested Scene, Doors & Locks, Home, Room, People, Cameras, Music, Everything, Laundry | A set of tiles; the last "N more" | as each has |
| Thermostat | HomeView's Big Number (dot under the setpoint, numbers at 42.7%); each control owns a whole region; XL adds the modes as rows | S-XL |
| Timers | A tile per timer (its ring, Pause and Stop owning the foot's halves) and Start a Timer | S-XL |
| Security | The alarm as a key-shaped tile (white when armed, "Armed" with the mode under it), every member a row, what needs you first; Compact is the alarm and four; XL square adds the keypad | S, W, C, T, L, XL |
| Calendar, To-do, Recent, Live TV | A list plate: header, rows, "N more"; two columns on XL; Live TV's channels as badges, no picture art | S-XL |
| House Status, On Now | A headline that answers the glance, then one reading row per category; the list scrolls; On Now's All Off a foot key | S-XL |
| Now Playing | The screensaver's music slide: the cover's own dark surface, the cover (it plays and pauses), the room with its chevron, the song, progress with times, volume, the transport as keys; Up Next on XL | S-XL |
| TV | The remote first: the open app's icon and name, power, the pad, Back / Home / Mute / Play / − / +, a row of app icons on Large, a column on XL | S-XL |
| Vacuum | Header, its rooms as keys (the chosen white), Clean and Dock | S-XL |
| Weather | The reading (place, hero, details), the hours, the days as rows with range bars | S-XL |
| Clock | The face; the time and date beside it on wider cards | S-XXL |
| Battery, Power, Water | The reading, then its other figures as rows | S-XL |
| Energy Rings | The rings, their figures as rows beside them | S-XL |
| Alert | Lit while its rule holds: header, the camera's picture, its action as the foot key | S-XL |
| Camera | The picture to the edge, its name on it | S-XL |
| Swipe | Unchanged: it shows the pages' new cards and its dots | S-XL |

Square cells (196 x 196) and short cells (196 x 150) both, at the screen's scale (the 0.8 tablets included).

## Every style

Each card is drawn and checked in every style the Appearance page offers: **Glass** (Clear, Blurred, Bright, and
Pre-rendered glass), **Frosted**, **Tinted**, **Flat** (Light and Dark), with the Glyphs option at Color and White,
Text Glow on and off, Motion on and off. The kit takes its colors only from the style's existing tokens (no color of its
own), so a new style later works without touching a card. Glass is `hk-glass`'s, never a card's own `backdrop-filter`;
nothing above a glass layer is transformed at rest.

## Order of the work

1. **The switch and the kit**: `card_design` in `hk_core` (choice, default, words, search), the Appearance row at a
   screen and at All Screens, `hk-kit.js` with its parts, and the base card's `cardDesign()` that every card asks.
   Tests: the setting's checks; the kit's measures (jsc).
2. **Tiles and groups** (most cards already draw HomeView's tile; their New is the same tile with the kit's edges).
3. **Thermostat, Timers, Security.**
4. **The lists**: Calendar, To-do, Recent, Live TV, then House Status and On Now.
5. **Media**: Now Playing, TV, Music.
6. **Devices and readings**: Vacuum, Alert, Camera, Weather, Clock, Battery, Power, Water, Energy Rings.
7. **Every style pass**: each card at every size in each style (the tools below), fixing what they show.
8. **On the house's own screens** with `tools/headless/house_twin.py`, then the owner's review. Nothing goes to the
   house without the owner's OK for that release; when it does, every screen is still Current until one is switched.

Each step is its own commits on main, pushed when its checks pass.

## Checks (within the checks' budget)

- **Current is untouched**: a jsc test draws a sample of cards with `card_design: current` and compares them with
  today's output.
- **The kit's measures**: jsc tests that a part's numbers are the table's (edges, corners, heights, type).
- **Edges and corners**: a script that measures every shape near a card's edge (its inset from each edge, its corner)
  and names any off the 13 edge or not concentric. Run by hand when a card's drawing changes (it is a one-off, like
  `house_twin.py`), never a step in `full`.
- **Looks**: `tools/headless/home_grid_audit.py` and `sheet_review.py`'s way of drawing every size in WebKit, at the wall
  tablet's 1280 x 800, an iPad's and a phone's.
- **Slow tablets**: before it ships, a swipe and a tab tap on the slowest tablet with New on, measured (rule 13): the
  kit adds no layer, loop or filter, and a card reads its states only when told.

## For the owner to decide (none blocks step 1)

1. **DESIGN.md**: when New is chosen, its sections (the centered tile's neighbors, the controls, the type, the radius)
   are rewritten from this plan; until then it stays as it is. Shall it be updated when the trial ends, or now?
2. **The touch sizes against DESIGN.md**: the review settled on 64 px keys and 60 px rows; Wide Security's three rows
   share 170 px (57 each). Keep that one exception, or show two rows there?
3. **Card Design at All Screens**: one switch for the whole house first (simpler to try), or per screen from the start
   (as planned)?
