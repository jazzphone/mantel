# Home Grid blocks and detail sheets: the November review (2026-11-07)

The owner asked for every detail sheet and every Home Grid block to be checked at every size for margins, gaps,
alignment and scale; for the sizes some blocks lack; for options that feel the same from block to block; for every
block to answer a tap, and for blocks with more than one thing in them to answer a tap by where it lands (On Now's
lights open the lights, its fans the fans). The rules are HomeView's Tall tiles, the Apple Home app and DESIGN.md.
Existing designs may change where something better fits those rules.

How it was checked: a live Mantel of my own (the gallery's fictional house with the Home Grid audit's stand-ins, a
real server on 127.0.0.1) with a review screen per block -- every size on square cells with HomeView's tiles, and on
196 x 150 tiles -- and two mixed dashboards shaped like real screens (an iPad on square cells, a wall tablet on
tiles). Looked at in the browser pane at 1180 x 820, 820 x 1180 and 390 x 844, tapped by hand; then the measuring
checks (`home_grid_audit.py`, `block_taps_check.py`, `sheet_review.py`) for the numbers.

## The rules every block keeps (the review's yardstick)

From DESIGN.md and HOMEVIEW-LOOK.md, restated as checks:

1. **One plate, one inset.** 18 px inside a square-cell block, 14 on a tile (`--hk-pad-*`); the corner 34 / 23.5
   outside and 16 inside (`--hk-inner-radius`). Text starts on the inset's left line in every block of a row.
2. **The type roles.** A block's label is the label role (13 / 600 uppercase) in its accent; its name the headline
   (17 / 600); a figure the figure roles; captions 13 / 500 in ink-2. Nothing under 11 px.
3. **Fill the block.** Content fills its block (a flex column whose middle grows) or is laid out as a centered tile
   (the glyph at 33 %, the words from 57.7 %). No band of empty glass over a third of the plate; a list ends on a
   whole row and says "N more".
4. **No holes.** A group of tiles fits its rows and columns to how many it has: three in a 2 x 2 make the last one
   wide, four in a 3 x 2 make a 2 x 2.
5. **Legible on glass.** A colored label or figure on the Blur and Bright looks carries the text glow every other
   word on the glass has.
6. **44 px targets** in the block's own px, a hit area round anything smaller.
7. **Every block answers a tap**: its plate opens its page or sheet (When Tapped chooses); a part that stands for
   something else opens that (a kind of thing, a row, a section).

## What was found

Blocks (square cells unless said):

| block | size | finding | fix |
|---|---|---|---|
| (the band) | iPad 4 columns | The clock was squeezed to 45 % of the left zone and the time ran under the weather glyph | The clock never shrinks; the left zone keeps its own width (hk-weather.js) |
| On Now | T | The kinds (Lights 6, Speakers 1, Fans 1) did nothing when tapped | Each kind opens a sheet of those things |
| On Now | W | A kind's whole chip was its Off: a tap anywhere on "6 Lights" turned every light off | The chip opens that kind; Off is its own key at the chip's end |
| On Now | L, XL | A row did nothing but its Off | A row opens that thing's sheet |
| Room | W | Three things: the speaker and "+2 more" (no light); the row floated mid-block | Two things always, lights first; "N more" moves to the heading's line; the row sits on the foot inset |
| Room | L | Three things left a hole in the 2 x 2 | The last one spans the row (rule 4) |
| Scenes | XL | Four scenes in six slots: two holes | Columns fit to the count (rule 4) |
| People | S | Three faces as two and one, the one left-aligned | The last row centered |
| Everything | W | A row of five icons on the foot under 60 % empty glass | The icons as large as the height allows, centered |
| Vacuum | W | "Docked · 31 min since its last run" wrapped to three lines | "Docked · Ran 31 min ago", one line |
| House Status | T | "+3 more" was a 24 px target | A 44 px hit area |
| Battery, Power, Water, Calendar, Doors, Energy Rings | all | Colored labels (green, blue, red) under 3:1 on the Blur look's glass | The text glow on every colored label (rule 5) |
| Thermostat | XL (dial) | The readings plate: the readings at its top, Mode at its foot, 180 px of glass between | One plate: the readings fill the column |
| Thermostat | L, XL (Big Number) | The picked target's dot sat under the 6 of 68, not centered under its number | Centered under the number it marks |

Missing sizes (each block now comes in Small, Wide, Tall, Large and Extra Large where the block can say something at
that size; Cameras stays Extra Large, Full Width and Full, Intercom Small and Wide):

| block | had | added |
|---|---|---|
| Accessory | S, W | T: HomeView's Tall tile -- the glyph and name over a level you drag (a light's brightness, a fan's speed, a shade's position, a speaker's volume), or a tall tile that toggles |
| Accessories | W, L, XL, XXL | T (two tiles, one over the other) |
| Scenes | W, L, XL, XXL | T (two scenes, one over the other) |
| Thermostat | S, T, L, XL | W: Big Number with the modes beside it |
| Calendar | S, T, L, XL | W: the day beside its next events |
| To-do | S, T, L, XL | W: the count beside the first items |
| Timers | S, W | T, L, XL |
| Who's Home | S, W | T, L, XL |
| Security | S, W, C, L, XL | T |
| Suggested Scene | S, W, L | T |
| Camera | S, W, L, XL | T |
| Vacuum | S, W, L, XL | T |
| Power | S, W, L, XL | T |
| Everything | S, W, L, XL | T |
| Room | W, L, XL, XXL | S (the room as one key: its name and what it is doing; a tap opens it), T |
| Action | S | W |
| Recent | W, L, XL | S, T |
| Now Playing | S, W, T, L | XL |

Options (the editor's Content and Appearance) made alike: every block whose plate does something has When Tapped
(Vacuum and Everything gain it); every tile-like block has Color (Accessory gains it).

Detail sheets: see "Sheets" below.

## Build log

- 2026-11-07: the band's clock (hk-weather.js `.bl` / `.band-clock`).
- 2026-11-07: sheets. The wide thermostat and water heater keep their history card when there is no history yet ("No
  readings in the last 24 hours"), so the right column ends with the dial's; the wide Weather sheet fills its height
  (the summary centered and large, HomeView's Weather; the days share the right column); the Person sheet's history
  axis starts at its bar (it took the charts' 48 px y-axis inset). `sheet_review.py` gains the owner's 1280 x 800 and
  a bottom-heavy check (glass under a non-scrolling sheet's last thing beyond its side margin + 40).
- 2026-11-07: Security Small takes HomeView's centered tile in the Centered style (it alone sat on the inset's corner);
  the widget blocks' labels (Battery, Energy Rings: `WIDGET_CSS`) carry the glass glow; Battery Small is one ring the
  size of the block with the level inside, Large's rows sit on the top and foot insets with a larger ring, Extra
  Large labels its ring column beside "Today". `home_grid_audit.py` counts a `::before` hit area as it does `::after`.
- 2026-11-07: Timers T and L (hk-home.js, hk-grid-catalog.js, home_grid.py): Tall stacks as many running timers as fit (the orange name, the time, the ring that pauses, a red Stop; "N more" at the foot; a second place says Start another), Large puts up to four in a 2 x 2 (fewer are bigger: one fills the block, two are rows); none running, the quick starts as round keys in a grid filling the block. Small and Wide are as before.
- 2026-11-07: Who's Home T and L (hk-home.js): Tall a list, each person a 44 face row with first name, where and since, spread down the block, "N more" when cut; Large the faces in a grid as large as fits (to 88) with name and where under each (a 2 + 1 for three, the last row centered). Small keeps three faces in one row, and a last short row is centered (`faceGrid`, `lastRow`).
- 2026-11-07: Vacuum T (hk-home.js): Small's parts stacked -- glyph, name, the battery ring in the middle, the state line, Clean with Dock. Wide says "Docked · Ran 31 min ago" on one line and its keys end on the text's foot. Vacuum gains When Tapped (`tap`) in both catalogs and `_tapTarget()` (the Vacuums page, else the vacuum's sheet; the battery ring answers too).
- 2026-11-07: Calendar W (hk-calendar.js): the weekday and big date left, the next events as rows right (Large's markup), "N more" at the foot. A block with no `days` of its own reads the week ahead, so T and L fill their height, a quiet "Nothing else this week" in what is left; the foot's line holds a word while the rows are measured (the last row kept was cut by it); the month's arrows sit on the inset.
- 2026-11-07: To-do W (hk-calendar.js): the list's name in its color and the count left, the items as rows right that stretch to fill the height (44 to 64), "N more".
- 2026-11-07: Camera T (hk-cameras.js): the still fills the 1 x 2 block; the name tag follows the block's inset, Tall's has the full width, and is hidden on square cells only (a tile's tall blocks showed none before).
- 2026-11-07: Colored labels get the glass glow: Calendar's weekday and Month View's month, To-do's list name, Timers' orange names (hk-calendar.js, hk-home.js).
- 2026-11-07: the calendar event sheet's left column fits at 1280 x 800 and 1180 x 820: the little month's rows are 32 (a 44 reach from an ::after), so the Color card ends inside the sheet.
- 2026-11-07: Calendar Wide drops the day headings and says the day in each event's line ("Tomorrow · 9:00 AM"), so two to three events fit where one did.
- 2026-11-07: On Now tap zones (hk-grid-widgets.js): T each kind a 44 px button opening a sheet of those things ("Lights On", "Fans On", "Speakers Playing", "Switches On"; one thing, its own sheet); W a chip's body opens its kind and Off / Pause is its own small key at the chip's end (44 px hit area); L, XL each thing's row opens that thing's sheet, its Off stays; S and the plate unchanged. All of them buttons, so the plate's tap leaves them be.
- 2026-11-07: Everything (hk-grid-widgets.js): Wide's icons sized to the height and the row centered (no band of glass over it); Tall (new) two columns of labeled icons, as many rows as fit, the last "+N"; When Tapped (`tap`) in both mirrors, the plate opening the tab bar's More as Small does.
- 2026-11-07: Action Wide (new; hk-grid-widgets.js): the glyph left, name over state beside it, the pair centered -- Home style Apple Home's wide tile (42 px well), Centered style HomeView's tile laid sideways (glyph at 25 % of the width, text 16 px beside it).
- 2026-11-07: Suggested Scene Small (new): the scene as a centered tile (Centered: HomeView's; Home: glyph at the top, two lines at the foot), its time of day as the second line.
- 2026-11-07: Thermostat (hk-control.js, hk-grid-panel.js): Wide (new) always Big Number -- the number over the foot in the left part, the modes a 2 x 2 of 44 px keys; Tall's mode row kept on the block's inset (four keys share the width, a hit area out to 44); the dial's Extra Large readings are three rows that share the plate's free height (no band between Inside and Mode). The Big Number's picked-target dot sits in an inline-block box of its own, centered on it (measured at its middle in Chromium before and after; the owner's "under the 6" is the seam of 6 and 8, which is the middle of "68").
- 2026-11-07: Power Tall (new), and the text glow on every colored label and figure of Power, Water, Doors and On Now (on the widget plate, hk-grid-panel.js WG_CSS). Doors Tall, Large and Extra Large: rows grow to the block (44 to 64 px, Extra Large 88), a headline each, the hero count large, a foot saying how many ("3 total · 2 closed").
- 2026-11-07: Recent (hk-timeline-block.js): Small (new) the newest event as a centered tile -- glyph, title, time; Tall (new) rows stacked, the time under the title, "N more" last.
- 2026-11-07: Now Playing Extra Large (new; hk-media-now.js): the cover square at the inner radius on the left, the label, song, progress, transport and volume in the column beside it; the block's background option kept.
- 2026-11-07: Clock (hk-grid-faces.js): a round face (Analog, Classic, Analog Numbers) in Wide, Tall, Extra Large and Full Width is as large as its block lets it, the weekday, date and time beside or under it.
- 2026-11-07: On Now Tall's kinds share the height between the count and All Off (up to 60 px a row).
- 2026-11-07: the digital Clock block centers its time and date (StandBy's clock), Large and Extra Large set the time larger to the block's width.
- 2026-11-07: Accessory T (hk-tile.js `levelOf`, `_levelDraw`; hk-grid-room.js): HomeView's Tall tile -- the glyph and name on top, under them a vertical capsule (the detail sheet's dimmer: `--hk-inner-radius`, the filled part in the light's color or white, the percent) for a light's brightness, a fan's speed, a shade's position, a speaker's volume: a drag up or down sets it (sent on letting go, through the card's action port), a tap toggles; a thing with no level is the tall tile with a larger glyph. `touch-action:none` on the capsule only.
- 2026-11-07: Accessory gains the `color` option (hk-grid-catalog.js and home_grid.py) and the entity card draws a lit accessory on its own color's gradient (`block_color`).
- 2026-11-07: Accessories T and Scenes T (two tiles, one over the other; capacity 2: `PER_PAGE`, home_grid.py `_capacity`, the audit's stand-in list, the pager test).
- 2026-11-07: No holes (hk-chip.js `gridShape`, hk-grid-math.js `shape`): Scenes, Accessories and Room fit columns and rows to the count -- three in a 2 x 2 make the last one span both, four in a 3 x 2 become 2 x 2, five in a 3 x 2 the last spans two -- and at Full Width three things are three wide tiles across the block, not the left half.
- 2026-11-07: Room W: two things always (the lights first, the speaker only when there is room), "+N more" in the heading's right-hand line (it was a third tile with no light), the heading on the top inset and the row on the bottom one.
- 2026-11-07: Room S (the room as one tile: its glyph, name and "71° · 1 light on"; a tap opens its page) and Room T (the heading with "+N more" in its line over two stacked tiles).
- 2026-11-07: One Wide tile for Accessory W, Scene W and Intercom W (hk-tile.js `wideTile`): Home style is Apple Home's wide tile (the 42 px well at the left, the name over its state, centered); Centred is HomeView's tile laid sideways -- the glyph's box centered on a quarter of the width, the words a gutter right of it, the pair centered on the glyph, ellipsis at the right inset.
- 2026-11-07: Intercom: the glyph is five rounded vertical bars (Apple's waveform), the second line says the rooms last picked or "Everywhere" (Wide's room chips are gone, the line carries them), and the sheet's talk group is centered on the rooms panel's line on a tablet (hk-intercom.js).
- 2026-11-07: a spanning tile (Room, Scenes, Accessories) keeps its row's tile type; a centered tile takes the square type from 170 px tall (an Extra Large group's 2 x 2 tiles are ~178).
- 2026-11-07: Security T (hk-grid-security.js; both mirrors): the shield and state on top (the state line may take two lines), the rows through the middle, at the foot Home and Away side by side with Disarm under them (three 44 px keys do not fit 168 px); a tap on the heading opens the alarm's sheet. The rows of every size share the room they are given, 44 to 64 px (`--rh`), the shown rows and "N more" filling it, a short list centered. In the HomeView presentation T is Large's composition at 1 x 2 (the plate says L; no chevron, the heading's line free to take two lines); its entry rows share the band, 54 to 64 px, and an entry given 92 px or more is HomeView's stack -- the glyph over the name over its state.
- 2026-11-07: Timers XL (hk-home.js; both mirrors): up to six running timers, each the existing column (orange name, time, ring = pause, red Stop) -- one or two are big across (the time 72 px, as Large's one), three go three across (time 44, ring 88), four are 2 x 2, five and six a 3 x 2, the sixth place saying Start another when there are five; none running, the quick starts as round keys in a 3 x 2 grid (to 112 px) filling the block. `lx()` writes Large's rules and Extra Large's as one selector list, so the file does not grow.
- 2026-11-07: Who's Home XL (hk-home.js; both mirrors): Large's grid with the faces to 120 (one or two people to 160), the first name and where and since under each ("Home · 10:51 PM"; the since drops where a cell is under 120 px wide). `faceGrid` gives a grid whose last row is full 1.8 times the weight, so four are 2 x 2 and six 3 x 2, not 3 + 1 and 5 + 1; three stay 2 + 1 on a tall block.
- 2026-11-07: Suggested Scene T (hk-grid-widgets.js; both mirrors): Large's composition at 1 x 2 -- the gradient plate and time-of-day art, the glyph at the top, label, name and "Until 5:00 AM" at the foot.
- 2026-11-07: the Centered Wide tile's glyph at a third of the block's width (a quarter left the pair 70 px from the left and 140 from the right).
- 2026-11-07: sheet_review's 'sits high' check (more glass under a sheet's content than over it) replaces the first bottom-heavy rule, which misread the sheets' one fixed height; the Intercom's two columns are exempt from left/right balance. All 35 sheets pass at 1280 x 800 and 390 x 844.

## Round two (2026-11-08): On Now, House Status, Everything

What the owner said, on his tablets:

- **On Now.** "The wide on now card isn't really utilizing its space very well either with the large number and the 4
  pills.. These are pretty small touch areas and it just looks rushed in design, but the tall card looks good! The
  large card seems cluttered... I prefer the categories, but more info for each category in the larger cards makes
  more sense... vs just showing only lights. Each category should either show a pop up or go to those pages... users
  decisions."
- **House Status.** "The Home Status cards across the board really need a redesign for all sizes... I like the
  information, but the layouts don't follow anything else. It would be great if On Now and Home Status shared a
  similar look, wherever that may land."
- **Everything.** "The everything cards should offer to the user if they want to scroll within the card or go to the
  page with the + button."
- Then, for every block: things that do not fit move to a sheet; **nothing stretches** ("entities in a card should
  maintain dimensions"); and a fixed size must still fill the plate deliberately, weighted and centered.

### One look for On Now and House Status

**First pass, tiles.** Three directions were drawn on the fictional house at 1280 x 800 (screenshots `dirA`, `dB`, `dC`):
A, category tiles (the Room block's inner tiles); B, rows on hairlines; C, HomeView's centered tiles. A was built at
every size with fixed tile sizes. The lead's review found the two blocks shared a material but not a tile layout, names
cut in narrow tiles ("Doors & Win..."), and a reading said twice ("All Locked / All locked"); then the owner: "I'm not a
fan of the new On Now layout either... we don't necessarily have to use Tiles to display this data... Let's be
intentional on layout here."

**Second pass, a headline over lines** (what shipped), built from the block he did like, On Now's first Tall:

- **The headline answers the glance.** On Now: the count with "On" (the hero's 44, or 72 where it has a column or a
  square Tall of its own); quiet, a calm "All Off" said once. House Status: the one thing that matters most in words
  ("1 Window Open", "8:38 Left"), its section and how many more to check under it; nothing to check, "All Good" with a
  green check.
- **The categories as lines, not boxes.** Each a row: the glyph on a disc -- lit in the kind's color while something is
  on (the Home app's lit glyph), a neutral disc at rest -- the name, the count or reading at the end, and a short line
  of where under the name (the rooms; on Large and Extra Large also the brightness as a small bar, the fan's speed, the
  song). The whole row is the tap; hairlines between; a kind at rest reads in the secondary ink, never hidden.
- **Nothing stretches.** Rows are 44 on Wide and Tall, 56 on Large and Extra Large (48 on a tile cell's Large); the group
  is centered where it is shorter than the block.

Two ways were drawn for Wide and Large (busy, square and tile cells; `options/`):

- Wide: the headline in its third with the kinds as lines two across, or as their discs with the count and name under
  each (the Batteries widget's way). Lines two across cut "Speakers" and "Switches" to "Spe..." and "S..."; **the discs
  won** for On Now. House Status keeps lines on Wide (its readings are words: "All Locked", "1 Window"), one across.
- Large: the headline and a sentence over the lines, or the headline in a column beside them. Beside them squeezed the
  label ("HOU...") and cut every line's detail; **the headline on top won**, and the column is Extra Large's alone.

| | On Now | House Status |
| --- | --- | --- |
| S | the count over the kinds' discs | the headline in words, its section and how many more |
| W | the count in a third, All Off (44 px) at its foot; the kinds as discs with counts | the headline in a third, "+N more" at its foot; three lines (two on tiles) |
| T | the label and All Off, the count (72 on square cells), the four kinds as lines | the label and "+N", the headline, six lines (four on tiles) |
| L | the count and a sentence ("6 lights, 1 speaker and 1 fan"), the kinds as lines of 56 with the brightness bar and the song | the headline and its sentence, four lines of 56 (three of 48 on tiles) |
| XL | a column: the label, the count at 72, the sentence, All Off; the lines beside it | the same column with "+N more", six lines beside it (five on tiles) |

### On Now

- Every kind the house has is a line, always in the same place (Lights, Speakers, Fans, Switches): with something on,
  its disc lit, its count, where; at rest, a neutral disc, "Off" ("Idle" for speakers) and how many it has. So the quiet
  house is the same layout, finished, and says "All Off" once -- never "0" with "Nothing is on" twice.
- **Moved to a sheet:** Wide's per-kind Off keys and Large's per-thing rows with their Off keys -- the small targets he
  called rushed and cluttered. A kind's sheet (or page) has every thing with its own control. All Off stays: the label
  row's key on Tall and Large, a 44 px key at the foot of the count's column on Wide and Extra Large.
- **Categories** (`open`, both mirrors; the editor's "Categories: Show a Sheet / Go to Its Page"): Show a Sheet (the
  default) opens the things of that kind that are on -- or, none on, all of them; one thing, its own sheet -- and Go
  to Its Page opens the kind's page on this screen (Lights; Speakers the music page; Fans the Climate page; a kind with
  no page here, its sheet).

### House Status

Keeps its information, order and taps (each line opens its chip's page; Small, "+N more" and the plate open the sheet).
Its label takes the Security page's teal. The sheet is unchanged.

### Everything

**More Places** (`more`, both mirrors; the editor's "More Places: + Opens the Page / Scroll in the Block", not on
Small): + Opens the Page (the default, today's behavior: the last place, "+N", opens More -- and the Pages screen
instead, where the screen has one) or Scroll in the Block (every place, the rows the size shows at a time, the rest
scrolled up to; a row stops where a row starts; up and down is the block's, sideways stays the pager's).

### Checked

- `home_grid_audit.py` for the three keys, `--state busy` and `quiet`, Blur Day and Flat Light, square HomeView and
  tiles, 1280 x 800, and Everything with `--opts everything='{"more":"scroll"}'` (its "text hidden" lines are the
  places scrolled out of sight, on purpose).
- `block_taps_check.py --parts` (new: each part that stands for something is tapped too -- On Now's kinds, House
  Status's lines, Everything's "+N" -- and where it went printed; `--opts` sets a block's options): every kind under
  Show a Sheet and Go to Its Page, every line, "+N", at 1280 x 800 and 390 x 844, both cells.
- `house_status_check.py` (WebKit and Chromium, the blocks and the sheet at every window size).

### For the controls audit

The label row's key (All Off on Tall and Large, "+N more") is a 24 px capsule whose 44 px reach (`::after`) goes 14 px
up into the inset and 6 px down: it ends 2 px above the first line's hit area and never overlaps it. The ~8 px clear
between hit areas the new rule asks for would need a taller label row on every block; it was left at 2 px. Wide's and
Extra Large's All Off is a 44 px key of its own.
