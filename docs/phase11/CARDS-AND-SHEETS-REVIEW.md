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

## Round two (2026-11-08)

The owner looked at round one on his tablets and sent notes block by block. Each block's part follows.

### Recent (hk-timeline-block.js)

**What he said:** "The recent cards REALLY need work. They are just essentially text on a card. No glyphs, no
pictures, nothing... These could be made to look a lot prettier with our design guidelines. Please rework this
completely." Later, for every block: nothing stretches ("entities in a card should maintain dimensions"), the space
is used by how many things show and by one element made to be big, and anything that does not fit goes to a sheet.

**Three directions, tried at 1280 x 800 on square HomeView cells and tiles:** A, a list under the latest picture
(the Home app's activity and the Timeline page's rows, the picture large); B, every event a tile (a picture where one
was kept, else its glyph); C, a rail down the block with the times at its left. **A was kept:** it is the only one
that is both pictures and information. B looked most like HomeView, but it held 3 to 6 events, repeated the same
camera's picture tile after tile, dropped the room and who, and cut its words at Wide. C spent a fifth of the width
on a time column, so Tall's titles cut after five letters, and it was still mostly text.

**What it is now:**

- **A row** is the Timeline page's, with its glyph white on its kind's solid color, the Home app's lit well (a 22 %
  tint all but vanished on the Blur look). A row with a picture shows the picture instead, 44 square at the snapshots'
  12, its glyph on a small badge in the same color. Then the title in the headline role, the room and who under it,
  how long ago on the title's line ("Now", "4 min", "2 hr", then the clock, "Yesterday", the weekday). A row is 44
  high on Wide and Tall and 56 on Large and Extra Large, never grown. The block shows as many whole rows as fit, and
  what it read but could not show is "N more" in the label's line (the block reads the newest 25; "22+ more" when
  there were more than it read).
- **The latest picture** is the hero at Tall, Large and Extra Large: the newest row that kept one, at the inner
  radius, its glyph, title, room and "3 min ago" on it with the camera tiles' halo. At Tall and Large it takes the
  height the rows leave; at Extra Large it is the left half beside the rows. With no picture kept, **the newest event
  is the hero**: its glyph on a large well, its words in the title role (Large a row of 84; Tall and Extra Large
  stacked and centered). With a few events at Large and Extra Large, the stacked hero and the rows under it are one
  centered column, rather than the hero at the left and two rows floating at the right.
- **Small** is HomeView's centered tile: the newest event's glyph in its kind's color, the thing ("Front Door",
  "Person", "Doorbell", "Alex"), and what it did and when ("Unlocked · 41m", "Front Door · 3m", "Armed night · Yest.").
- **The morning summary** (`show: digest`, and Automatic from 5 to 11 AM) is glyphs, not lines. It leads with a
  status: what is still open or unlocked (orange), else how the house is right now (green), else "A quiet night" under
  a moon. The night's kinds are tiles of a fixed size, each with its glyph, count and name, as a centered group. At
  Large the night's newest picture sits between the status and a row of the kinds; at Extra Large it is beside them.
  Tall lists the kinds as 44 px rows and Wide puts the status beside small tiles, as many as fit inside the inset. A quiet night is the moon alone,
  centered.
- **Empty** (a new house) and **a quiet night** are scaled to their block: the glyph 56 px on Tall and 76 on Large and
  Extra Large, the words in the title role, one group centered a touch above the middle. Empty is the history glyph in teal, "Nothing yet", "Doors,
  locks and cameras show up here". **A quiet day** (a row or two): the newest is the hero, the rest under it, and
  "Nothing earlier" closes the group, which is centered a touch above the middle.
- **Taps:** a row opens what it stands for. A camera's row (doorbell, detection, motion) opens its camera, or the
  camera on the same device when a sensor heard it. A door, lock, garage, alarm or person row opens that thing's
  sheet. Mantel's own rows, a refused command, and a thing the house no longer has open the row's sheet on the
  Timeline (`hkTimeline.openSheet`). The picture opens its camera; the plate opens the Timeline page. A thing counts
  as known when its state **or its registry entry** is there: a client loads states as they are wanted, and the
  first check missed a person whose state had not come yet.
- **The text glow** is on the plate, as on the widget blocks. Gray (a closed door, a disarmed alarm) is the theme's
  second ink, since the icon palette's light gray vanished on Flat Light. The label stays the widget blocks' 15 / 600
  (On Now's, which the owner likes), so a screen's labels match.
- **Moved to a sheet:** nothing. Recent has no controls. Its rows are list rows the full width of the block, 44 or
  56 high. The detail behind the block is the Timeline page, and behind a row it is the row's own sheet.

**Checked:** `home_grid_audit.py` gains the Timeline's states, seeded into Mantel's own store (`seed_timeline`): busy
(the default: a day with pictures from the two cameras, and a night in the digest's window), `recent_quiet` (two rows
last evening, nothing since, everything locked) and `recent_empty` (none). Every size, Latest and Morning Summary,
was shot on square HomeView cells and on tiles in Blur (day), Flat Light and Flat Dark, with the audit clean;
`block_taps_check.py --expect` passes on tiles, square cells and HomeView; every row's and picture's tap was clicked
and read back; `timeline_check.py --block` passes at 1180 x 820, 820 x 1180 and 390 x 844.

## Round two: Now Playing (2026-11-08)

What the owner said: "The X-Large Now playing card, why is the title / artist so close to the top and the media controls so
close to the bottom on the right side. This info and media controls should follow similar to how we have all the other
players set up on the Music slide for the screensavers. All the player cards should follow this. The tall card also needs
work - The album art isn't centered in the card, and the text/controls can also go a bit closer to the edges of the card in
order to have more room." Then, for every block: a card may have a detail sheet that exposes more controls; nothing
stretches; each size must be weighted and use its space deliberately.

The reference is the screensaver's Music slide (hk-saver-music.js, hk-saver-css.js `.mu`): the room, the title, the artist,
then the progress 22 px under them, the buttons, the volume -- one tight group that is not pinned to the top and bottom of
its column -- beside the cover, which is the hero.

What was done (web/hk/media/hk-media-now.js, the `ON A HOME GRID` rules; hk-grid-catalog.js; the audit):

- **XL**: the label, title, artist, progress, keys and volume are one group between two flexible rows, so it stands on the
  cover's axis with the same air above and below (the slide's 20-22 px between the artist and the progress). Measured on the
  square cell, the group's center is the block's center; the cover keeps the room (as large as the group's 282 px column
  allows).
- **L**: rebuilt on the same grid. The cover no longer sets a grid track, so the song sits 14 px from it (on a tile it sat
  a whole track away) and the cover takes the room the song's 160 px and the controls leave; a fixed 22 px gap, the
  whole stack centered in the block.
- **T**: the cover is centered on the block's axis and as wide as the content box allows (it was at the start of its row);
  the label, song, progress and three keys follow it at their own sizes; the stack is centered with the same air above and
  below. The keys' ink lines up with the text's inset (skip's ink is the middle half of its glyph).
- **W**: the song, the progress and the three keys are one group centered on the cover's axis (the song was pinned to the
  cover's top, the keys to its foot).
- **S**: the cover top left, play / pause top right, the song at the foot.
- **What moved to the player's sheet (a tap on the plate opens it)**: Small lost back / next and Speakers; Wide lost
  Speakers, Browse and the volume; Tall lost Speakers, Browse and the volume. They did not fit with 44 px targets and 8 px
  between hit areas. L and XL keep Speakers, Browse and the volume.
- **Nothing stretches**: the keys are a cluster at fixed pitch (44 px with 8 or 12 between on W and T; 44 / 48 / 52 / 48 / 44
  with 8 between on L and XL), centered in the column -- not spread to its edges by a flexible track. The progress and volume
  bars are the column's width, as the slide's are.
- **States** (audit `--state`): `art` (a cover), `noart` (the house's default), `paused`, `pausednoart`, `idle` (a stopped
  player: no song, times or cover), `off`, `longsong`, `longsongnoart`. Nothing playing: the label names the room a play
  would start in (the slide's), not "Not Playing" over "Nothing Playing"; the progress goes (the slide's `[idle] .mprog`); the
  note placeholder is 40 % of the cover. A long title takes two lines on L and XL (the slide's clamp), one elsewhere.
- A Flat look draws no blur (hk-base.js flatCss takes every filter), which left the cover sharp behind the controls; the
  plate is now the flat gradient there.
- The audit no longer calls the clipped third line of a `-webkit-line-clamp` title "hidden by a box".
- Tests: grid_music_turn_check.py (the keys' 44 px and 8 px clear, no Speakers / Browse / volume on S, W, T; XL added),
  media_card_check.cjs, test_blocks_media.js, test_edit_grid.js (Wide and Tall are now the same card: the progress only).
## Round two (2026-11-08): Weather XL, Live TV, Security L and XL, the editor's previews

What the owner said, and what was done (the rules he added on the way: a control is 44 px with ~8 px clear round it; anything that
does not fit cleanly goes to the detail sheet; NOTHING STRETCHES -- every element has its designed size at each block size, a block
fills its space by how many things it shows and where it puts them, the group centered; DESIGN.md "Using the space").

- **Weather XL, HomeView layout** -- "could show more information and space things out ... the area where Feels like and Rain are is
  pretty bunched up when there is a bunch of space above ... the days forecast on the right side is also pretty far apart ... tighter".
  The readings are rows of one designed height (46 px on a square cell, 40 on a tile) filling the free height of the left column
  under the hours, up to six, the group centered (a short last row centered too, never spanning); pressure, visibility and dew point
  join feels like, humidity, wind (its direction now in its label: "Wind NW" over "6 mph"), rain, sunset or sunrise and UV, where the
  house has them and the block has room. The seven days are one block of rows of one height (32 px square, 26 tile, 4 px apart)
  centered in the column under its label (it had been spread to the column's height: 38 to 46 px a row). No forecast: the left
  column takes the whole block. Why the readings are capped at six: the hours and the temperature are the left column's weight;
  a seventh row would make the plate crowded (the owner's second rule), so pressure and the others only appear when something
  above them is absent.
- **Live TV tiles** -- "the What's On artwork that the Live TV page displays as the background for the channels ... a little dim".
  The page draws the now sensor's `image` attribute behind each channel (hk-cameras.js `_tile`, through `_artImage`); the block does
  the same behind each channel tile, the channel's color over it at a third and a scrim over that (30 % at the top where the mark is,
  38 % in the middle, 74 % under the words) so the white mark and words pass 4.5:1 on any picture; no picture (or one that never
  loads), the channel's color alone. A mixed house shows both. Tiles keep ONE designed shape, 16 : 10 (the guide's pictures are
  16 : 9), as wide as the block's columns make them, as many as the room holds, centered with equal margins and the last row
  centered (they had been grid cells stretched to the plate, the last one spanning the row). A chosen channel and Small fill the
  block as they did.
- **Security L and XL** -- "the touch points for the locks/garage door a tad bigger ... XL: the keypad first, the locks and garage door
  represented cleanly and easy to interact with ... then open windows and doors in a compact way". The locks and the garage are
  tiles of one designed size (116 x 96 stacked at Large, 136 x 112 at Extra Large; 150 x 64 or 168 x 64 laid in a row where the
  stacked ones would show fewer), as many as fit, the last place "N more", the group centered with the strip under it; a tile not
  secured (unlocked, open) is the white of HomeView's lit tile; a tap opens that thing's sheet (no command from here, the alarm's PIN
  stays behind its sheet or keypad). The doors and windows are one 44 px strip: "All closed" (a tap opens Doors & Windows) or the open
  ones by name, in orange. Extra Large loses its heading (the keypad's readout says the state, the strip what is open): the keypad is
  the hero and the right column its tiles and strip. Wide's rows are 44 px keys 8 px apart (no longer 44 to 64 and flexed), up to what
  fits and "N more"; Tall is the shield and state centered between the heading and the three ways to arm: the lock list moved out of
  it (it is the Security page's and the block's Custom Detail Sheet's, and the heading says what is open and opens the alarm's sheet).
- **Editor previews** -- "the card previews followed the appearance default for tiles (centered vs home)". The picker's previews were
  cells with no tile style at all. They resolve it as the screen does (hk-strategy.js homeGridView): this screen's own Tile Style, else
  All Screens', Automatic being Centered on square cells and Home on tiles; Security past Small keeps its own look, as on the screen.
  `editor_preview_tile_check.py` checks the four combinations. The live preview of the draft was already the screen.
- Checks: `home_grid_audit.py --state` gains wx_few, wx_five (the weather), tv_art, tv_noart (Live TV; the default house is mixed: four
  channels with art, two without), sec_armed, sec_trig, sec_open, sec_many (Security); `AUDIT_VIEW=390x844` draws the audit at a phone's
  size (the grid is the same, scaled).
- Round two, the lead's review: (1) Security Wide's rows are the glyph and two lines, the name whole over its state (they were one line, and
  "Front Door" was cut beside the shield's column); (2) Live TV Large and Extra Large open with a label row -- LIVE TV at the label role and
  "N more" (the channels the guide has beyond those shown) at its right -- and the tiles stand under it in a group of their own; the tile
  shape is the tallest of 4 : 3, 3 : 2 and 16 : 10 that shows every channel the block names in the room it has (still one shape per
  block, never stretched), which fills the plate to about an eighth of margin where the 16 : 10 tiles left a fifth; `tv_many`
  (twelve channels) shows six and "6 more"; (3) the keypad's Home, Away and Disarm were 44 px in the block's own px (33 on the HomeView
  screen's 0.74 scale): they are now as tall as the block's keys where it has the room (53 px on a square cell, 56 on a tile), 44 at
  the least (`--hk-kp-pill`, set by the grid block; the alarm's sheet keeps its 44). The audit's `AUDIT_PROBE='<js>'` prints a probe of
  one's own for each block (measured them).
## Round two (2026-11-08): the owner on his tablets -- Timers, Vacuum, Thermostat Tall

What he said: "the card when no timer is displayed is not good looking at all... when a timer is running the cards look great"; "the Tall and Wide Vacuum cards should offer a rooms or areas button that pops up a detail sheet [...] those rooms should be noted on the card [...] If no rooms are selected, it would just be a standard clean. For the Large and X-Large Cards... do the rooms scroll in the card if there are more than what the card allows? If not, it should."; "for the thermostat tall card [...] the modes are too close to the temp up and down arrows [...] the modes get hit while using them", then "I don't really like the modes at the top, it really throws the card off". Rules that arrived while this was built: any card may send more controls to its detail sheet (Small is its state and one action; Wide and Tall two or three controls, each 44 px with clear space; Large and Extra Large may show more, never crowded) and nothing stretches (DESIGN.md "Using the space").

How it was checked: every state in the audit (`home_grid_audit.py --state NAME`, `--hits`), tiles and square HomeView at 1280 x 800, a phone at 390 x 844 (`block_taps_check.py --size 390x844`), taps by `block_taps_check.py --expect`; the states are STATES entries: `quiet`, `timers_one`, `timers_many`, `timers_paused`, `vacuum_cleaning`, `vacuum_paused`, `vacuum_returning`, `vacuum_error`, `vacuum_picked`, `vacuum_picked3`, `vacuum_twelve`, `vacuum_twelve_picked` (twelve Clean Areas rooms, four of them ticked).

- **The audit.** `--state` gains the states above; `--hits` fails where one control's touchable box (its `::after` or `::before` too, clipped by whatever scrolls or clips it) overlaps another's, or where a control's `::after` is not anchored to it (an unpositioned control's hit area reaches over its whole block); the text check lets a row a scrolling list has scrolled away be (it is reached by scrolling).
- **Timers, none running (hk-home.js).** The running timer's own column: the orange name, a line in the time's light type in the time's place ("Start a timer", the hero), and the quick starts as rings in the running ring's shape -- each draws its length as the share of an hour its orange arc covers, the length inside, and an orange + for any other. Small is its state and one key (the orange "+ Start a timer"); Wide three rings (5 and 10 minutes and +) beside the words, the group centered; Tall three stacked; Large all five and + in a 3 x 2, Extra Large the same beside the 72 px line. Each size has one ring size (tile cell / square cell: 52 / 64, 56 / 72, 72 / 96, 80 / 104), never fitted to the room; the second place a running Wide, Tall, Large or Extra Large block leaves ("Start another") is one + ring. One timer, many and a paused one were looked at at every size: unchanged apart from that.
- **Vacuum Tall and Wide (hk-home.js).** With Clean Areas (or the house's script) a Rooms key: Tall a 44 px row under the state saying "All rooms", or the rooms picked -- one or two by name ("Kitchen, Office"), three or more as a count -- with a chevron; Wide Clean over Rooms and Dock, the Rooms key counting them and the names under the state line. It opens the Rooms to Clean sheet: the Vacuums page's own picker (`hk-area-select-card`, new config `pick: <vacuum>`), its Start Cleaning replaced by Done. The picks are one Set a vacuum (`window.hkHome.picked`), shared by the block and the sheet and told to each other by `hk-vacuum-rooms`, so they cannot differ; the Clean key sends them through Clean Areas (the Vacuums page's `_start`) and, with none picked, starts a standard clean. While it cleans, returns or is paused the Rooms key is gone (there is nothing to pick).
- **Vacuum Large and Extra Large.** The rooms are rows of their own size (48 px) and scroll in the block when it holds fewer than there are (a cut row says so); a few are centered in what is left (`data-fit`). The "N more" tile and the over-the-page list are gone: the list is the list. Tried with twelve rooms.
- **Vacuum Small** is its state and one key (Clean, Pause, Resume): Dock went to the vacuum's sheet (Dock, Locate and the rest are there).
- **Thermostat Tall, Big Number (hk-control.js).** Root cause of "the modes get hit": the name's hit area (`.nm::after`) was anchored to nothing -- `all:unset` after `position:relative` left `.nm` static, so the block's whole box was the name's key and a tap on a mode could open the sheet. Fixed (anchored), and the hit areas of the arrows, name and modes no longer overlap. The card is rebuilt round its centre of weight: the name heads the block, the target (a range's two, not stretched) with its arrows either side, and one 44 px Mode key at the foot that opens the thermostat sheet, where the modes are. Tried and dropped: the four modes as a row on top (the owner: "throws the card off") and as a row at the foot (six controls on a Tall block). The dial's Tall keeps its Mode key and ring; nothing of it overlaps.
- **Moved to a sheet:** the thermostat's four modes (Tall), the vacuum's Dock (Small) and its room picking (Tall and Wide: a new sheet).
- **Left as they were, said so:** the running timers' columns (the owner likes them); the foot key rows (Clean beside Dock) take the block's inset width, which is a row's designed width at that size, not a stretch.
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

The lead's last review: Extra Large's column is one group (the headline, its sentence, its key) centered on the lines'
own center, not the headline at the top and All Off at the foot with bare glass between; quiet, On Now's Extra Large
says "All Off", "Nothing is on" and shows the kinds' discs at rest; House Status's Small puts the leading section's
glyph on its lit disc (a green check when all is good) over the words, as a HomeView tile has.

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

## Round three (2026-11-08): Calendar's empty day, Doors & Windows, Who's Home Tall, the keys that stretched

The lead's review of round two found these (`--state quiet`, `--stretch`, `--hits`); the owner's round-three rules are "nothing
stretches" and "every state". Each was fixed, then checked at every size, tiles and square HomeView, 1280 x 800.

- **Calendar with nothing scheduled (hk-calendar.js).** Wide, Tall and Large drew the date and a small "Nothing scheduled" floating in
  a mostly empty plate. Now the empty day is one group on the plate's optical center: the weekday and the date as the hero (Tall the
  busy block's own number, Large 72 -- a sparse size gets a bigger hero, not stretched things), "Nothing
  scheduled" in the title role, and under it a calm line ("The next 7 days are clear") or, when only later days have something
  (Wide), "Nothing scheduled today" over the next event as its row ("Dentist / Tomorrow · 9:00 AM", the row opens the event's
  sheet). Wide is the same group in a row. Small is the same language (date, line, centered). Tall and Large with later events keep
  their list (they show more, and say "N more"). Extra Large's month keeps its grid and says "Nothing scheduled" in the same title
  role, centered in the day's column ("Nothing planned" is gone). `--hits` found the XL month's two arrows overlapping by 3-4 px
  (not the day chips): `.mh span` also matched the arrows inside the wrapper, each with the wrapper's -4 px margin; the pair is now
  a wrapper only, the arrows 8 px apart. New audit state `cal_later` (nothing today, the events from tomorrow).
- **Doors & Windows (hk-grid-panel.js).** (a) Extra Large, Large and Tall spread their rows to fill the block (rows 44 to 88 px, the
  `grow` list): rows keep 48 px, as many as fit with "N more", and the hero and the rows are one group centered under the label
  (the hero is 72 px where three rows still fit under it; else one compact line). The "N total · N closed"
  foot is gone (the hero and the list say it). (b) The copy said "1 open" over "All doors closed" while a window was open. Now
  "1 Open" over the open ones by name ("Office Window", "Front Door · Garage Door", "Front Door + 10 more"); nothing open is
  "All Closed" with a check over what the block watches ("2 doors · 1 window"). (c) Small quiet showed "0": now the check, "All Closed"
  and "Doors & Windows"; Small with one open keeps the glyph and the count. Tall says "Since 8:51 AM" (it was cut short at 145 px).
  New states `doors_window`, `doors_two`, `doors_many`.
- **Who's Home Tall (hk-home.js).** The rows were spread over the whole height (`space-between`, 64 px at most). They are 52 px
  high (56 on a square cell), the group centered under the label; the rows that do not fit are "N more". New states
  `people_home`, `people_four`.
- **Keys that stretched.** Vacuum Tall's Clean key (`flex: 1 1 auto`) grew with the block: it is as wide as its word now (Clean,
  Pause, Resume; the play icon is dropped on Tall, where the word says it), Dock round beside it, the pair centered. Energy Rings
  Tall's Today / Week / Month switch (`space-between`, `flex: 1`) is as wide as its three words, centered.
- **Checked.** `--stretch` and `--hits` are clean for calendar, doors, people, vacuum and energy_rings, tiles and HomeView, in
  busy, quiet and each new state (vacuum cleaning and paused too); `block_taps_check.py` passes for all five at both cells.
  hk-calendar.js, hk-home.js and hk-energy.js did not grow (CSS lines joined to make room).
