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
