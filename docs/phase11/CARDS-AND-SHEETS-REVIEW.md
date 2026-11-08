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
| Timers | S, W | T, L |
| Who's Home | S, W | T, L |
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
